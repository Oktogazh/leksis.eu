import { aql } from "arangojs";
import {
  grammarIssues,
  isValidGrammar,
  isValidLanguageTag,
  normalizeLanguageTag,
  type Grammar,
  type GrammarInherent,
  type LanguageTranslation,
} from "@leksis/types";
import { db } from "../db";
import { grammarLabelRows, syncLanguageLabels, type DeclaredLabel } from "./labels";
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
   * The labels this version's grammar declares. The grammar itself is not
   * indexed (the record is its source of truth), but its *labels* are, for the
   * same reason entry docs store their tags: the labels read model has to
   * survive version transitions and a wholesale db:init rebuild without
   * re-fetching every record from its PDS.
   */
  labels: DeclaredLabel[];
  /**
   * This version's inherence declarations, cached for the same reason `labels`
   * is and for one more.
   *
   * The reason it shares: an entry's ingest has to know which of its categories'
   * features this language considers inherent, and it cannot resolve a record
   * from a PDS to find out — the consumer is a sequential writer, not an HTTP
   * client. The reason it does not: `labels` is a read model's input, while this
   * is a **matching** input — it decides what goes into an entry's
   * `inherentAtoms`, and so which entries a paradigm's selector reaches
   * (layer 5, docs/design/paradigm-rules.md §2.1).
   *
   * Stored raw, not resolved: an orphan cannot survive here (a row naming an
   * unbound feature costs the record its place in the index, ADR-0015), and the
   * one filter `inherentFeatures` applies — dropping a lexicographic label set —
   * is likewise impossible in an indexed grammar.
   */
  inherent: GrammarInherent[];
  createdAt: string;
  indexedAt: string;
  current: boolean;
}

export type IngestResult = "indexed" | "skipped-duplicate" | "skipped-invalid";

/**
 * Validate an incoming record (unknown shape — anyone can put anything on
 * their PDS). Returns the normalized document fields, or null when invalid.
 * Rules: well-formed lowercase BCP 47 tag, non-empty translations of the
 * right shape, the endonym present (an item whose languageID === tag), and a
 * `grammar` that is both well-formed and coherent (ADR-0015).
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

  // The grammar must be well-formed AND coherent (ADR-0015). Shape and
  // cardinality first — a malformed or oversized one rejects the whole record,
  // exactly like any other field — then the cascade's own checks, which used to
  // be indexed-and-flagged.
  //
  // Rejecting incoherence is what keeps the interface out of a deadlock. The
  // binding editor navigates the cascade, so it can neither produce a row
  // hanging off something unbound nor offer a way to remove one; a record like
  // that was indexed, reported on the dashboard as needing repair, and then
  // unrepairable there. Refusing it leaves the previous version current — the
  // language keeps a grammar every editor can still work on — and the record
  // stays on its author's PDS, indexed the moment it is fixed.
  //
  // Vocabulary is still never judged: a language may bind items no UD snapshot
  // knows, and a tag nothing has bound still renders. What is refused is a
  // record that contradicts itself.
  let grammar: Grammar | null = null;
  if (r.grammar !== undefined) {
    if (!isValidGrammar(r.grammar)) return null;
    // Named in the log, unlike every other failure here: this one is a bot's
    // output being refused row by row, and "invalid record" alone would leave
    // its author nothing to fix.
    const issues = grammarIssues(r.grammar);
    if (issues.length > 0) {
      console.warn(
        `firehose: language "${tag}" rejected — ${issues.length} incoherent grammar row(s): ` +
          issues.map((i) => `${i.kind}(${i.key})`).join(", "),
      );
      return null;
    }
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

  const labels = parsed.grammar === null ? [] : grammarLabelRows(parsed.grammar);

  const doc: LanguageDoc = {
    tag: parsed.tag,
    recordURI,
    cid,
    authorDID,
    labels,
    inherent: parsed.grammar?.inherent ?? [],
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
  // read model, and its declared labels into the labels model — where a
  // label joins the language's own list even before any entry uses it.
  await syncLocalLanguages(db, parsed.tag, parsed.translations);
  await syncLanguageLabels(db, parsed.tag, labels);
  // Nothing recomputes the entries' `inherentAtoms` here, deliberately: a
  // grammar edit would otherwise re-read every entry of the language on every
  // save. Each entry refreshes its own on its next republication, and whether a
  // language-record transition should trigger a language-wide recompute waits
  // for a real language's grammar to churn (design note §7.2).
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
