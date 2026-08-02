import { aql } from "arangojs";
import {
  grammarIssues,
  isValidGrammar,
  isValidLanguageTag,
  normalizeLanguageTag,
  type Grammar,
  type GrammarIssue,
  type LanguageTranslation,
} from "@leksis/types";
import { db } from "../db";
import { grammarBindingPairs, syncLanguageBindings, type BindingPair } from "./abbreviations";
import { syncLocalLanguages } from "./local-languages";

// Decomposition of eu.leksis.language records into two collections:
// - `languages` (versioned): only the record reference (URI/cid/author), the
//   tag, and the current flag — no name content. Wikipedia model: records
//   prove authorship, not ownership — the latest record for a tag becomes
//   current regardless of author, the previous version is archived
//   (current: false), nothing is ever deleted.
// - `localLanguages` (read model): per-locale language name lists, re-synced
//   from the record's translations whenever a version becomes current.

interface LanguageDoc {
  tag: string;
  recordURI: string;
  cid: string;
  authorDID: string;
  /**
   * Defects in this version's grammar — a value whose feature name nobody
   * bound, or two rows keying the same. Stored rather than recomputed so the
   * dashboard can serve a repair worklist without resolving the record.
   */
  grammarIssues: GrammarIssue[];
  /**
   * The label pairs this version's grammar binds. The grammar itself is not
   * indexed (the record is its source of truth), but its *pairs* are, for the
   * same reason entry docs store theirs: the abbreviations read model has to
   * survive version transitions and a wholesale db:init rebuild without
   * re-fetching every record from its PDS.
   */
  bindings: BindingPair[];
  createdAt: string;
  indexedAt: string;
  current: boolean;
}

export type IngestResult = "indexed" | "skipped-duplicate" | "skipped-invalid";

/**
 * Validate an incoming record (unknown shape — anyone can put anything on
 * their PDS). Returns the normalized document fields, or null when invalid.
 * Rules: well-formed lowercase BCP 47 tag, non-empty translations of the
 * right shape, and the endonym present (an item whose languageID === tag).
 */
function parseRecord(record: unknown): {
  tag: string;
  translations: LanguageTranslation[];
  grammar: Grammar | null;
  createdAt: string;
} | null {
  if (typeof record !== "object" || record === null) return null;
  const r = record as Record<string, unknown>;

  if (typeof r.tag !== "string") return null;
  const tag = normalizeLanguageTag(r.tag);
  if (!isValidLanguageTag(tag)) return null;

  if (!Array.isArray(r.translations) || r.translations.length === 0) return null;
  const translations: LanguageTranslation[] = [];
  for (const item of r.translations) {
    if (typeof item !== "object" || item === null) return null;
    const t = item as Record<string, unknown>;
    if (typeof t.languageID !== "string" || typeof t.translation !== "string") return null;
    const languageID = normalizeLanguageTag(t.languageID);
    const translation = t.translation.trim();
    if (!isValidLanguageTag(languageID) || translation === "") return null;
    translations.push({ languageID, translation });
  }
  if (!translations.some((t) => t.languageID === tag)) return null; // endonym required

  // The grammar is validated for SHAPE only: a malformed one rejects the whole
  // record, exactly like any other field. Vocabulary is never judged — a
  // language may bind items no UD snapshot knows, which is the point of the
  // layer.
  let grammar: Grammar | null = null;
  if (r.grammar !== undefined) {
    if (!isValidGrammar(r.grammar)) return null;
    grammar = r.grammar;
  }

  const createdAt =
    typeof r.createdAt === "string" ? r.createdAt : new Date().toISOString();
  return { tag, translations, grammar, createdAt };
}

/**
 * Index a created/updated eu.leksis.language record. Idempotent: replaying
 * the same commit (same recordURI + cid already current) is a no-op, so
 * cursor-overlap on reconnect is harmless. The consumer is the only writer
 * and processes events sequentially, so read-then-write is race-free.
 */
export async function ingestLanguage(
  authorDID: string,
  recordURI: string,
  cid: string,
  record: unknown,
): Promise<IngestResult> {
  const parsed = parseRecord(record);
  if (!parsed) {
    console.warn(`firehose: skipped invalid language record ${recordURI}`);
    return "skipped-invalid";
  }

  const currentCursor = await db.query<LanguageDoc & { _key: string }>(aql`
    FOR l IN languages
      FILTER l.tag == ${parsed.tag} AND l.current == true
      RETURN l
  `);
  const current = await currentCursor.next();

  if (current && current.recordURI === recordURI && current.cid === cid) {
    return "skipped-duplicate";
  }

  // A grammar can be well-formed and still incoherent — a value whose feature
  // name nobody bound, two rows keying the same. That is **detected, never
  // rejected**: refusing the version would discard everything else it carries
  // to punish one row, and would make the AppView the arbiter of a language's
  // grammar. An orphan renders safely anyway (by decomposition, or verbatim),
  // so it is a repair worklist item, not a write error.
  const issues = parsed.grammar === null ? [] : grammarIssues(parsed.grammar);
  if (issues.length > 0) {
    console.warn(
      `firehose: language "${parsed.tag}" has ${issues.length} grammar issue(s): ` +
        issues.map((i) => `${i.kind}(${i.key})`).join(", "),
    );
  }

  const bindings = parsed.grammar === null ? [] : grammarBindingPairs(parsed.grammar);

  const doc: LanguageDoc = {
    tag: parsed.tag,
    recordURI,
    cid,
    authorDID,
    grammarIssues: issues,
    bindings,
    createdAt: parsed.createdAt,
    indexedAt: new Date().toISOString(),
    current: true,
  };

  if (current) {
    await db.query(aql`
      UPDATE ${current._key} WITH { current: false } IN languages
    `);
  }
  await db.query(aql`INSERT ${doc} INTO languages`);

  // The version just became current: propagate its names into the per-locale
  // read model, and its bound labels into the abbreviations model — where a
  // binding's label joins the language's own abbreviation list even before
  // any entry uses it.
  await syncLocalLanguages(db, parsed.tag, parsed.translations);
  await syncLanguageBindings(db, parsed.tag, bindings);
  console.log(
    `firehose: indexed language "${doc.tag}" (${current ? "new version" : "new language"}) from ${authorDID}`,
  );
  return "indexed";
}

/**
 * Handle a delete op: archive the current version if it is the one whose
 * record was deleted. Older versions stay archived; no reinstatement
 * (deferred until the voting mechanism).
 */
export async function ingestLanguageDelete(recordURI: string): Promise<void> {
  const cursor = await db.query<string>(aql`
    FOR l IN languages
      FILTER l.recordURI == ${recordURI} AND l.current == true
      UPDATE l WITH { current: false } IN languages
      RETURN l.tag
  `);
  const tag = await cursor.next();
  if (tag) console.log(`firehose: archived language "${tag}" (record deleted)`);
}
