import { aql } from "arangojs";
import {
  isValidLanguageTag,
  normalizeLanguageTag,
  type LanguageTranslation,
} from "@leksis/types";
import { db } from "../db";
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
function parseRecord(
  record: unknown,
): { tag: string; translations: LanguageTranslation[]; createdAt: string } | null {
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

  const createdAt =
    typeof r.createdAt === "string" ? r.createdAt : new Date().toISOString();
  return { tag, translations, createdAt };
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

  const doc: LanguageDoc = {
    tag: parsed.tag,
    recordURI,
    cid,
    authorDID,
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
  // The version just became current: propagate its names into the
  // per-locale read model.
  await syncLocalLanguages(db, parsed.tag, parsed.translations);
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
