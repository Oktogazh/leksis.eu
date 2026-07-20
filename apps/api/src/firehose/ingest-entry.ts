import { createHash } from "node:crypto";
import { aql } from "arangojs";
import {
  isValidDefinitionPlace,
  isValidLanguageTag,
  normalizeLanguageTag,
  validDefinitionPlaces,
  type EntryAnnotation,
} from "@leksis/types";
import { db } from "../db";
import { syncEntryAbbreviations, type AbbreviationPair } from "./abbreviations";
import type { IngestResult } from "./ingest-language";

// Decomposition of eu.leksis.entry records into the `entries` collection.
// The record on the author's PDS is the source of truth for content; the
// AppView indexes only what search needs — orthographies, the language tag,
// and the record reference. Versioned like `languages`: many docs per entry
// (sharing `entryKey`), one with current: true; previous versions are
// archived, never deleted (Wikipedia model, last write wins across authors).
//
// Entry identity: a record carrying `subject` (the AT URI of the version it
// modifies) becomes a new version of the entry owning that record; a record
// without one is a brand-new entry and gets a freshly minted entryKey.

interface EntryDoc {
  entryKey: string;
  languageID: string;
  orthography: string[];
  /** Lowercased orthographies, kept for case-insensitive search only. */
  search: string[];
  recordURI: string;
  cid: string;
  authorDID: string;
  /** Whether this version carries a non-empty `todo` note (needs attention). */
  todo: boolean;
  /**
   * Distinct annotation pairs (categories + definition notes) of this
   * version, kept so the abbreviations read model can be maintained across
   * version transitions and deletions without re-fetching records.
   */
  abbreviations: AbbreviationPair[];
  createdAt: string;
  indexedAt: string;
  current: boolean;
}

interface ParsedEntry {
  languageID: string;
  orthography: string[];
  subject: string | null;
  todo: boolean;
  abbreviations: AbbreviationPair[];
  createdAt: string;
}

function parseAnnotations(value: unknown): EntryAnnotation[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const annotations: EntryAnnotation[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return null;
    const a = item as Record<string, unknown>;
    // `long` is the only required half; a `short` that is present must be a
    // string, and an empty one counts as absent.
    if (typeof a.long !== "string") return null;
    const long = a.long.trim();
    if (long === "") return null;
    if (a.short !== undefined && typeof a.short !== "string") return null;
    const short = typeof a.short === "string" ? a.short.trim() : "";
    annotations.push(short === "" ? { long } : { short, long });
  }
  return annotations;
}

/**
 * Validate the flat definitions list: a non-empty array of
 * {place, notes?, text} definitions whose places, in array order, satisfy
 * the whole-list invariants (sorted reading order, contiguous sibling
 * indices, no place a prefix of another). Returns every definition's notes
 * (they feed the abbreviations read model), or null when the list is
 * invalid.
 */
function collectDefinitionNotes(value: unknown): EntryAnnotation[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const places: number[][] = [];
  const notes: EntryAnnotation[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return null;
    const def = item as Record<string, unknown>;
    if (typeof def.text !== "string" || def.text.trim() === "") return null;
    const defNotes = parseAnnotations(def.notes);
    if (defNotes === null) return null;
    notes.push(...defNotes);
    if (!isValidDefinitionPlace(def.place)) return null;
    places.push(def.place);
  }
  return validDefinitionPlaces(places) ? notes : null;
}

/**
 * Validate an incoming record (unknown shape — anyone can put anything on
 * their PDS). The content fields (categories, definitions) are validated so
 * malformed records are rejected whole, but only the indexed fields are
 * returned — the DB never stores the content.
 */
function parseRecord(record: unknown): ParsedEntry | null {
  if (typeof record !== "object" || record === null) return null;
  const r = record as Record<string, unknown>;

  if (typeof r.languageID !== "string") return null;
  const languageID = normalizeLanguageTag(r.languageID);
  if (!isValidLanguageTag(languageID)) return null;

  if (!Array.isArray(r.orthography) || r.orthography.length === 0) return null;
  const orthography: string[] = [];
  for (const item of r.orthography) {
    if (typeof item !== "string") return null;
    const form = item.trim();
    if (form === "") return null;
    orthography.push(form);
  }

  const categories = parseAnnotations(r.categories);
  if (categories === null) return null;

  const notes = collectDefinitionNotes(r.definitions);
  if (notes === null) return null;

  // The version's distinct annotation pairs — grammatical categories and
  // definition notes alike — for the abbreviations read model.
  const pairs = new Map<string, AbbreviationPair>();
  for (const { short, long } of [...categories, ...notes]) {
    const pair = { short: short ?? null, long };
    pairs.set(`${pair.short ?? ""}\u0000${pair.long}`, pair);
  }

  let subject: string | null = null;
  if (r.subject !== undefined) {
    if (typeof r.subject !== "string" || !r.subject.startsWith("at://")) return null;
    subject = r.subject;
  }

  // `todo` is a list of freeform pending-task notes (one item per task, so
  // several bots or editors can each track their own); the DB stores only
  // whether any non-empty item exists.
  let todo = false;
  if (r.todo !== undefined) {
    if (!Array.isArray(r.todo)) return null;
    for (const item of r.todo) {
      if (typeof item !== "string") return null;
      if (item.trim() !== "") todo = true;
    }
  }

  // `botSource` (bot → source traceability) lives on the record only.
  if (r.botSource !== undefined && typeof r.botSource !== "string") return null;

  const createdAt =
    typeof r.createdAt === "string" ? r.createdAt : new Date().toISOString();
  return {
    languageID,
    orthography,
    subject,
    todo,
    abbreviations: [...pairs.values()],
    createdAt,
  };
}

/**
 * Mint a stable entry key: `{lang}-{orthographySlug}-{hash}`, e.g.
 * "br-gwerzenn-a3f9". The slug is ASCII-only (ArangoDB _key charset);
 * orthographies in other scripts fall back to the hash alone. The hash is
 * derived from the record URI, so replaying the same creation event mints
 * the same key. Collisions with existing entries extend the hash.
 */
async function mintEntryKey(languageID: string, orthography: string, recordURI: string): Promise<string> {
  const slug = orthography
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 8);
  const hash = createHash("sha256").update(recordURI).digest("hex");

  for (let len = 4; len <= hash.length; len += 4) {
    const key = [languageID, slug, hash.slice(0, len)].filter(Boolean).join("-");
    const cursor = await db.query<boolean>(aql`
      RETURN LENGTH(FOR e IN entries FILTER e.entryKey == ${key} LIMIT 1 RETURN 1) > 0
    `);
    if (!(await cursor.next())) return key;
  }
  throw new Error(`could not mint a unique entry key for ${recordURI}`);
}

/**
 * Index a created/updated eu.leksis.entry record. Idempotent: replaying the
 * same commit (same recordURI + cid already current) is a no-op, so
 * cursor-overlap on reconnect is harmless. The consumer is the only writer
 * and processes events sequentially, so read-then-write is race-free.
 */
export async function ingestEntry(
  authorDID: string,
  recordURI: string,
  cid: string,
  record: unknown,
): Promise<IngestResult> {
  const parsed = parseRecord(record);
  if (!parsed) {
    console.warn(`firehose: skipped invalid entry record ${recordURI}`);
    return "skipped-invalid";
  }

  // Resolve the entry this record belongs to. A subject pointing at a record
  // this AppView never indexed is treated as a new entry rather than dropped.
  let entryKey: string | null = null;
  if (parsed.subject) {
    const cursor = await db.query<string>(aql`
      FOR e IN entries
        FILTER e.recordURI == ${parsed.subject}
        LIMIT 1
        RETURN e.entryKey
    `);
    entryKey = (await cursor.next()) ?? null;
    if (!entryKey) {
      console.warn(`firehose: entry ${recordURI} has unknown subject ${parsed.subject}, indexing as new entry`);
    }
  }

  const currentCursor = await db.query<EntryDoc & { _key: string }>(aql`
    FOR e IN entries
      FILTER ${entryKey !== null ? aql`e.entryKey == ${entryKey}` : aql`e.recordURI == ${recordURI}`}
        AND e.current == true
      LIMIT 1
      RETURN e
  `);
  const current = await currentCursor.next();

  if (current && current.recordURI === recordURI && current.cid === cid) {
    return "skipped-duplicate";
  }

  if (entryKey === null) {
    entryKey = current?.entryKey ?? (await mintEntryKey(parsed.languageID, parsed.orthography[0]!, recordURI));
  }

  const doc: EntryDoc = {
    entryKey,
    languageID: parsed.languageID,
    orthography: parsed.orthography,
    search: parsed.orthography.map((o) => o.toLowerCase()),
    recordURI,
    cid,
    authorDID,
    todo: parsed.todo,
    abbreviations: parsed.abbreviations,
    createdAt: parsed.createdAt,
    indexedAt: new Date().toISOString(),
    current: true,
  };

  if (current) {
    await db.query(aql`
      UPDATE ${current._key} WITH { current: false } IN entries
    `);
  }
  await db.query(aql`INSERT ${doc} INTO entries`);
  // The read model tracks current versions only: declaring the new
  // version's pairs also retires the archived version's contribution.
  await syncEntryAbbreviations(db, entryKey, doc.languageID, doc.abbreviations);
  console.log(
    `firehose: indexed entry "${doc.orthography[0]}" [${doc.entryKey}] (${current ? "new version" : "new entry"}) from ${authorDID}`,
  );
  return "indexed";
}

/**
 * Handle a delete op: the DB mirrors the state of the network. An entry
 * version whose record is gone from its author's PDS is removed from the
 * index (unlike `languages`, which archive forever — language references
 * are structural to the app; the entry version history lives on the
 * network, not in this index). If the deleted version was current, the
 * most recently indexed remaining version is promoted back to current;
 * when nothing remains, the entry disappears from search.
 */
export async function ingestEntryDelete(recordURI: string): Promise<void> {
  const removedCursor = await db.query<{ entryKey: string; current: boolean }>(aql`
    FOR e IN entries
      FILTER e.recordURI == ${recordURI}
      REMOVE e IN entries
      RETURN { entryKey: OLD.entryKey, current: OLD.current }
  `);
  const removed = await removedCursor.all();
  if (removed.length === 0) return;

  const entryKey = removed[0]!.entryKey;
  if (!removed.some((r) => r.current)) {
    console.log(`firehose: removed archived version of entry "${entryKey}" (record deleted)`);
    return;
  }

  const promotedCursor = await db.query<{
    recordURI: string;
    languageID: string;
    abbreviations: AbbreviationPair[] | null;
  }>(aql`
    FOR e IN entries
      FILTER e.entryKey == ${entryKey}
      SORT e.indexedAt DESC
      LIMIT 1
      UPDATE e WITH { current: true } IN entries
      RETURN { recordURI: NEW.recordURI, languageID: NEW.languageID, abbreviations: NEW.abbreviations }
  `);
  const promoted = await promotedCursor.next();

  // The entry's contribution to the abbreviations model follows its new
  // current version — or vanishes with the entry. Versions indexed before
  // pairs were stored carry none and contribute again once re-published.
  if (promoted) {
    await syncEntryAbbreviations(db, entryKey, promoted.languageID, promoted.abbreviations ?? []);
  } else {
    await syncEntryAbbreviations(db, entryKey, null, []);
  }
  console.log(
    promoted
      ? `firehose: removed current version of entry "${entryKey}" (record deleted); promoted ${promoted.recordURI}`
      : `firehose: removed entry "${entryKey}" entirely (last record deleted)`,
  );
}
