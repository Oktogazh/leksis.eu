import { createHash } from "node:crypto";
import { aql } from "arangojs";
import {
  isLeafPlace,
  isValidDefinitionPlace,
  isValidLanguageTag,
  isValidTag,
  normalizeLanguageTag,
  tagKey,
  validateDefinitions,
  type EntryDefinition,
  type Tag,
} from "@leksis/types";
import { db } from "../db";
import { syncEntryTags } from "./labels";
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
  /** True when this version withdraws the entry (see LeksisEntryRecord.deleted). */
  deleted: boolean;
  deletionReason: string | null;
  redirectTo: string | null;
  /**
   * Distinct grammatical tags this version uses, at all three altitudes —
   * lexeme (`categories`), sense (a definition node's `categories`) and form
   * (an `otherForms` tag). Kept so the labels read model can be
   * maintained across version transitions and deletions without re-fetching
   * records, and it is what lets that model show a tag in use which no
   * language declaration has named yet.
   */
  tags: Tag[];
  createdAt: string;
  indexedAt: string;
  current: boolean;
}

interface ParsedEntry {
  languageID: string;
  orthography: string[];
  /** Spellings of the entry's other grammatical forms, indexed for search. */
  otherForms: string[];
  subject: string | null;
  todo: boolean;
  deleted: boolean;
  deletionReason: string | null;
  redirectTo: string | null;
  tags: Tag[];
  createdAt: string;
}

/** Validate a `string[]` field; empty items are dropped, others trimmed. */
function parsePlainNotes(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    const trimmed = item.trim();
    if (trimmed !== "") out.push(trimmed);
  }
  return out;
}

/**
 * Validate a tag-only annotation site. Shape only: a tag naming vocabulary no
 * UD snapshot knows is perfectly legal — that is the whole point of letting a
 * language declare its own.
 */
function parseTags(value: unknown): Tag[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const tags: Tag[] = [];
  for (const item of value) {
    if (!isValidTag(item)) return null;
    tags.push(item);
  }
  return tags;
}

/**
 * Validate the definitions tree and harvest what the read model needs: each
 * node's sense-level `categories` tags. A node whose place ends non-zero is a
 * leaf (text required); a node ending in 0 is a group (no text). The
 * whole-tree invariants are checked by `validateDefinitions`. Returns null
 * when the list is invalid.
 */
function collectDefinitionTags(value: unknown): Tag[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const definitions: EntryDefinition[] = [];
  const tags: Tag[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return null;
    const def = item as Record<string, unknown>;
    if (!isValidDefinitionPlace(def.place)) return null;
    const defTags = parseTags(def.categories);
    if (defTags === null) return null;
    tags.push(...defTags);
    const notes = parsePlainNotes(def.notes);
    if (notes === null) return null;
    // `text` must be a string when present; the leaf/group text rule is
    // enforced by validateDefinitions below.
    let text: string | undefined;
    if (def.text !== undefined) {
      if (typeof def.text !== "string") return null;
      text = def.text.trim();
    }
    const leaf = isLeafPlace(def.place);
    definitions.push({
      place: def.place,
      notes,
      ...(leaf ? { text } : {}),
    });
  }
  return validateDefinitions(definitions) === "ok" ? tags : null;
}

/**
 * Validate the entry's other grammatical forms: each is the tag saying which
 * form it is, plus a non-empty spelling (indexed for search). Returns null
 * when the list is malformed.
 *
 * A form written to the older shape — a `{short, long}` pair under
 * `annotation` — has no `tag` and is rejected here, taking the whole record
 * with it. That is the wanted loud failure: a record whose forms are labelled
 * in a way this AppView can no longer resolve should not half-load.
 */
function parseOtherForms(value: unknown): { tags: Tag[]; forms: string[] } | null {
  if (value === undefined) return { tags: [], forms: [] };
  if (!Array.isArray(value)) return null;
  const tags: Tag[] = [];
  const forms: string[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return null;
    const f = item as Record<string, unknown>;
    if (typeof f.form !== "string") return null;
    const form = f.form.trim();
    if (form === "") return null;
    if (!isValidTag(f.tag)) return null;
    tags.push(f.tag);
    forms.push(form);
  }
  return { tags, forms };
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

  // Every annotation site is tag-only now: an entry carries no reader-facing
  // labels at all. A record written to the older shape — categories as
  // {short, long} pairs — fails here and is rejected whole, which is the
  // wanted loud failure: it never half-loads.
  //
  // The retired free-pair fields (`annotations`, at entry and definition
  // level) are simply not read. Ignoring a field a lexicon no longer defines
  // is how AT Proto records stay extensible, and refusing the record over one
  // would be worse for a reader than the label's absence: the entry would
  // vanish from search entirely until someone republished it.
  const categories = parseTags(r.categories);
  if (categories === null) return null;

  const otherForms = parseOtherForms(r.otherForms);
  if (otherForms === null) return null;

  const definitionTags = collectDefinitionTags(r.definitions);
  if (definitionTags === null) return null;

  // Entry-level free-text notes and references are record-only content: they
  // are validated for well-formedness (so a malformed record is rejected
  // whole), then dropped — the DB never stores the content.
  if (parsePlainNotes(r.notes) === null) return null;
  if (r.references !== undefined) {
    if (!Array.isArray(r.references)) return null;
    for (const item of r.references) {
      if (typeof item !== "object" || item === null) return null;
      const ref = item as Record<string, unknown>;
      if (typeof ref.text !== "string" || ref.text.trim() === "") return null;
      if (ref.url !== undefined && typeof ref.url !== "string") return null;
    }
  }

  // The version's distinct tags, at all three altitudes — lexeme, sense and
  // form. Stored so the read model can count usage against a bound label, and
  // so a tag nobody has bound yet surfaces as a worklist item instead of
  // vanishing. Form tags belong here for exactly that reason: an unnamed
  // `Number=Plur` on a plural is as much a gap in a language's declaration as
  // an unnamed `NOUN` on a headword.
  const tags = new Map<string, Tag>();
  for (const tag of [...categories, ...definitionTags, ...otherForms.tags]) {
    tags.set(tagKey(tag), tag);
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

  // `transcription` (IPA) is record-only content: type-checked so a malformed
  // record is rejected whole, then dropped — the DB never stores it.
  if (r.transcription !== undefined && typeof r.transcription !== "string") return null;

  // A deletion is a full version like any other, marked withdrawn: it must
  // carry a reason (a bare `deleted: true` is rejected), and an optional
  // pointer to the correct entry when the reason is a duplicate.
  const deleted = r.deleted === true;
  if (r.deleted !== undefined && typeof r.deleted !== "boolean") return null;
  let deletionReason: string | null = null;
  if (r.deletionReason !== undefined) {
    if (typeof r.deletionReason !== "string") return null;
    const trimmed = r.deletionReason.trim();
    if (trimmed !== "") deletionReason = trimmed;
  }
  if (deleted && deletionReason === null) return null;
  let redirectTo: string | null = null;
  if (r.redirectTo !== undefined) {
    if (typeof r.redirectTo !== "string") return null;
    const trimmed = r.redirectTo.trim();
    if (trimmed !== "") redirectTo = trimmed;
  }

  const createdAt =
    typeof r.createdAt === "string" ? r.createdAt : new Date().toISOString();
  return {
    languageID,
    orthography,
    otherForms: otherForms.forms,
    subject,
    todo,
    deleted,
    deletionReason,
    redirectTo,
    tags: [...tags.values()],
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
    // A deleted version is withdrawn from search — its entry stays
    // addressable by entryKey, but never surfaces as a search result.
    // Other grammatical forms are searchable too, so an inflected form (e.g.
    // a plural) leads back to its entry.
    search: parsed.deleted
      ? []
      : [
          ...new Set(
            [...parsed.orthography, ...parsed.otherForms].map((o) => o.toLowerCase()),
          ),
        ],
    recordURI,
    cid,
    authorDID,
    todo: parsed.todo,
    deleted: parsed.deleted,
    deletionReason: parsed.deletionReason,
    redirectTo: parsed.redirectTo,
    tags: parsed.tags,
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
  // The read model tracks current, non-withdrawn versions only: declaring
  // the new version's tags also retires the archived version's usage. A
  // deleted version declares none, even though its own `tags` stay stored on
  // the doc in case the entry is restored.
  await syncEntryTags(db, entryKey, doc.languageID, parsed.deleted ? [] : doc.tags);
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
    tags: Tag[] | null;
  }>(aql`
    FOR e IN entries
      FILTER e.entryKey == ${entryKey}
      SORT e.indexedAt DESC
      LIMIT 1
      UPDATE e WITH { current: true } IN entries
      RETURN {
        recordURI: NEW.recordURI,
        languageID: NEW.languageID,
        tags: NEW.tags
      }
  `);
  const promoted = await promotedCursor.next();

  // The entry's usage follows its new current version — or vanishes with the
  // entry. Versions indexed before tags were stored carry none and contribute
  // again once re-published.
  if (promoted) {
    await syncEntryTags(db, entryKey, promoted.languageID, promoted.tags ?? []);
  } else {
    await syncEntryTags(db, entryKey, null, []);
  }
  console.log(
    promoted
      ? `firehose: removed current version of entry "${entryKey}" (record deleted); promoted ${promoted.recordURI}`
      : `firehose: removed entry "${entryKey}" entirely (last record deleted)`,
  );
}
