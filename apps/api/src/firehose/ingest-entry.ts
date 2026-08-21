import { createHash } from "node:crypto";
import { aql } from "arangojs";
import {
  collectLeafPlaces,
  featsMatchKey,
  inherentAtomKeys,
  isLeafPlace,
  isValidDefinitionPlace,
  isValidLanguageTag,
  isValidTag,
  MAX_DEFINITION_EXAMPLES,
  MAX_ENTRY_ETYMOLOGY,
  MAX_ENTRY_TODO,
  normalizeLanguageTag,
  normalizeOclc,
  tagKey,
  validateDefinitions,
  type EntryDefinition,
  type EntryExample,
  type EntryInflectedForm,
  type GrammarInherent,
  type Tag,
} from "@leksis/types";
import { db } from "../db";
import { expandEntry } from "./expand-forms";
import { syncEntryTags } from "./labels";
import type { IngestResult } from "./ingest-language";
import { reviveUnresolvedCognates, syncEntryCognates } from "./ingest-cognate";
import { reviveUnresolvedRelations, syncEntrySenses } from "./ingest-relation";

// Decomposition of eu.leksis.entry records into the `entries` collection.
// The record on the author's PDS is the source of truth for content; the
// AppView indexes only what search needs — orthographies, the other forms, the
// language tag, the record reference — plus the few derived keys the read
// models join on without re-fetching a record (`tags`, `places`, and layer 5's
// `inherentAtoms`). Versioned like `languages`: many docs per entry
// (sharing `entryKey`), one with current: true; previous versions are
// archived, never deleted (Wikipedia model, last write wins across authors).
//
// Entry identity: a record carrying `subject` (the AT URI of the version it
// modifies) becomes a new version of the entry owning that record; a record
// without one is a brand-new entry and gets a freshly minted entryKey.

/**
 * One inflected form of an entry as the index holds it — the search half of the
 * doc that used to be a handful of undifferentiated strings in `search`.
 *
 * Four fields and each earns its place: `search` is what a query prefix-matches,
 * `form` what a reader is shown, `feats` the scheme-blind join key a cell
 * address is matched on (`coordsMatchKey` computes the same string from a
 * rule's coordinates, with no grammar in hand), and `tag` the address itself,
 * kept because a reader is shown the form's **labels** and a key cannot be
 * resolved back into one.
 *
 * `origin` is what makes a rule edit surgical: generated rows carry the
 * `paradigmKey` that produced them, so re-running one paradigm replaces exactly
 * its own output and never touches what an author asserted. Layer 5's expansion
 * job writes those; ingest writes only `record` rows.
 */
export interface IndexedForm {
  form: string;
  /** Lowercased `form`, for case-insensitive prefix search. */
  search: string;
  /** `featsMatchKey` of the tag — the address, scheme- and part-of-speech-blind. */
  feats: string;
  tag: Tag;
  origin: "record" | "rule";
  /** Present on a generated row only: which paradigm produced it. */
  paradigmKey?: string;
}

interface EntryDoc {
  entryKey: string;
  languageID: string;
  orthography: string[];
  /**
   * Lowercased orthographies — the **headword** half of the search index.
   *
   * Split from the forms (below) rather than pooled as the former flat `search`
   * array, because a hit has to be able to say which half it came from: finding
   * *молодий* under its own spelling and finding it under *молода* are different
   * answers, and one of them has to name the form and print its labels.
   */
  orthographySearch: string[];
  /** The **form** half of the search index, one row per form. */
  otherForms: IndexedForm[];
  /**
   * The atom keys of this version's inherent bundle — its part of speech plus
   * the features the language declares inherent for the categories carrying them
   * (`inherentAtomKeys`).
   *
   * This is the join a paradigm reaches an entry through: a selector's atoms are
   * keyed the same way, so "every entry this rule applies to" is an indexed
   * intersection filter rather than a scan of the language and a bundle
   * comparison per doc. Only *inherent* features are stored — a form's feature
   * on a headword is noise a rule must not select on — which is also what makes
   * the stored set tell layer 5's expansion job precisely which entries a newly
   * published rule reaches.
   */
  inherentAtoms: string[];
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
  /**
   * Canonical places of this version's definition leaves — its senses. Cached
   * at ingest, exactly as `tags` is, so the semantic network can expand a
   * relation's place prefix and detect that a tree was restructured **without
   * ever fetching a record from a PDS**. Small (a place is at most three small
   * integers) and derived: an entry version indexed before this field existed
   * carries none, and gets them when its author republishes.
   */
  places: number[][];
  createdAt: string;
  indexedAt: string;
  current: boolean;
}

interface ParsedEntry {
  languageID: string;
  orthography: string[];
  /**
   * The entry's lexeme-level categories, kept whole rather than folded into
   * `tags`: `inherentAtoms` is computed from these alone, and the deduped union
   * of all three altitudes cannot be split back into which tag was a headword's.
   */
  categories: Tag[];
  /** The entry's other grammatical forms — the tag and the spelling, both indexed. */
  otherForms: EntryInflectedForm[];
  places: number[][];
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
 * Validate a definition leaf's example sentences: at most sixteen, each with a
 * non-empty `text`, and — when one cites a work — a `source` whose `oclc` reads
 * as an OCLC number, stored in the normal form so it addresses the same source
 * record a differently-punctuated catalogue export would.
 *
 * Strict, like every other site here: a malformed example takes the whole
 * record with it. The number is a reference, and a reference this AppView
 * cannot normalize is one no reader could resolve — silently dropping it would
 * publish an entry whose citation vanished without anybody being told.
 *
 * Nothing about examples is indexed: they are content, like `text`. This exists
 * to reject what is malformed and to hand `validateDefinitions` the group-node
 * rule's input.
 */
function parseExamples(value: unknown): EntryExample[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_DEFINITION_EXAMPLES) return null;
  const examples: EntryExample[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return null;
    const example = item as Record<string, unknown>;
    if (typeof example.text !== "string") return null;
    const text = example.text.trim();
    if (text === "") return null;
    if (example.source === undefined) {
      examples.push({ text });
      continue;
    }
    if (typeof example.source !== "object" || example.source === null) return null;
    const source = example.source as Record<string, unknown>;
    if (typeof source.oclc !== "string") return null;
    const oclc = normalizeOclc(source.oclc);
    if (oclc === null) return null;
    let locator: string | undefined;
    if (source.locator !== undefined) {
      if (typeof source.locator !== "string") return null;
      const trimmed = source.locator.trim();
      if (trimmed !== "") locator = trimmed;
    }
    examples.push({
      text,
      source: { oclc, ...(locator !== undefined ? { locator } : {}) },
    });
  }
  return examples;
}

/**
 * Validate the definitions tree and harvest what the read models need: each
 * node's sense-level `categories` tags, and the canonical places of the
 * leaves — the version's senses, which the semantic network addresses. A node
 * whose place ends non-zero is a leaf (text required); a node ending in 0 is a
 * group (no text, and no examples). The whole-tree invariants are checked by
 * `validateDefinitions`. Returns null when the list is invalid.
 */
function parseDefinitions(value: unknown): { tags: Tag[]; places: number[][] } | null {
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
    const examples = parseExamples(def.examples);
    if (examples === null) return null;
    const leaf = isLeafPlace(def.place);
    definitions.push({
      place: def.place,
      notes,
      ...(leaf ? { text } : {}),
      // Kept on both node kinds, unlike `text`: it is what lets
      // validateDefinitions see — and refuse — examples on a group node.
      examples,
    });
  }
  if (validateDefinitions(definitions) !== "ok") return null;
  return { tags, places: collectLeafPlaces(definitions) };
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
function parseOtherForms(value: unknown): EntryInflectedForm[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const forms: EntryInflectedForm[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return null;
    const f = item as Record<string, unknown>;
    if (typeof f.form !== "string") return null;
    const form = f.form.trim();
    if (form === "") return null;
    if (!isValidTag(f.tag)) return null;
    forms.push({ tag: f.tag, form });
  }
  return forms;
}

/**
 * One asserted form as the index holds it. The lowercased spelling is what a
 * query matches, the canonical feats key what a cell address is joined on.
 */
function indexedForm(form: EntryInflectedForm): IndexedForm {
  return {
    form: form.form,
    search: form.form.toLowerCase(),
    feats: featsMatchKey(form.tag),
    tag: form.tag,
    origin: "record",
  };
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

  const definitions = parseDefinitions(r.definitions);
  if (definitions === null) return null;

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
  for (const tag of [...categories, ...definitions.tags, ...otherForms.map((f) => f.tag)]) {
    tags.set(tagKey(tag), tag);
  }

  let subject: string | null = null;
  if (r.subject !== undefined) {
    if (typeof r.subject !== "string" || !r.subject.startsWith("at://")) return null;
    subject = r.subject;
  }

  // `todo` is a list of freeform pending-task notes (one item per task, so
  // several bots or editors can each track their own); the DB stores only
  // whether any non-empty item exists. Capped as the lexicon declares
  // (ADR-0015): the entry page renders every item.
  let todo = false;
  if (r.todo !== undefined) {
    if (!Array.isArray(r.todo) || r.todo.length > MAX_ENTRY_TODO) return null;
    for (const item of r.todo) {
      if (typeof item !== "string") return null;
      if (item.trim() !== "") todo = true;
    }
  }

  // `etymology` is record-only content like `notes`, and is validated for the
  // same reason: a record whose prose is not prose should be rejected whole
  // rather than indexed and left to fail in a reader's browser.
  const etymology = parsePlainNotes(r.etymology);
  if (etymology === null || etymology.length > MAX_ENTRY_ETYMOLOGY) return null;

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
    categories,
    otherForms,
    places: definitions.places,
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
 * The inherence declarations of the language this entry is in, read from the
 * cache on its current language doc.
 *
 * From the index, never from a PDS: the consumer is a sequential writer, and an
 * HTTP round trip per entry would put every author's server in the middle of
 * this one's ingest. A language nobody has described yet — or one described
 * before this cache existed — yields none, which costs nothing more than the
 * entry's inherent bundle shrinking to its part of speech until either record is
 * republished.
 */
async function languageInherent(languageID: string): Promise<GrammarInherent[]> {
  const cursor = await db.query<GrammarInherent[] | null>(aql`
    FOR l IN languages
      FILTER l.tag == ${languageID} AND l.current == true
      LIMIT 1
      RETURN l.inherent
  `);
  return (await cursor.next()) ?? [];
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

  const inherent = await languageInherent(parsed.languageID);

  const doc: EntryDoc = {
    entryKey,
    languageID: parsed.languageID,
    orthography: parsed.orthography,
    // A deleted version is withdrawn from search — its entry stays
    // addressable by entryKey, but never surfaces as a search result. Both
    // halves go, and so does the inherent bundle: a withdrawn entry is one its
    // author says should not be offered, which no paradigm should be generating
    // forms for either.
    orthographySearch: parsed.deleted
      ? []
      : [...new Set(parsed.orthography.map((o) => o.toLowerCase()))],
    // Other grammatical forms are searchable too, so an inflected form (e.g. a
    // plural) leads back to its entry. Every row here is `record` — asserted by
    // the entry's author — since generation runs after ingest and writes its
    // own rows beside these.
    otherForms: parsed.deleted ? [] : parsed.otherForms.map(indexedForm),
    inherentAtoms: parsed.deleted ? [] : inherentAtomKeys(inherent, parsed.categories),
    recordURI,
    cid,
    authorDID,
    todo: parsed.todo,
    deleted: parsed.deleted,
    deletionReason: parsed.deletionReason,
    redirectTo: parsed.redirectTo,
    tags: parsed.tags,
    // Stored even on a withdrawn version, like `tags`: the doc stays a
    // faithful mirror of the record, and a restoration needs them back. What a
    // withdrawal suppresses is the *senses* derived from them, below.
    places: parsed.places,
    createdAt: parsed.createdAt,
    indexedAt: new Date().toISOString(),
    current: true,
  };

  if (current) {
    await db.query(aql`
      UPDATE ${current._key} WITH { current: false } IN entries
    `);
  }
  const insertedCursor = await db.query<string>(aql`INSERT ${doc} INTO entries RETURN NEW._key`);
  const insertedKey = await insertedCursor.next();
  // Layer 5's generation: run every paradigm of the language over the version
  // that just became current, so an inflected form leads back to its entry
  // whether its author wrote it out or a rule produced it. Straight after the
  // insert, before the networks below, because it rewrites the doc's own
  // `otherForms` — the search half — and nothing downstream should read a
  // half-expanded version.
  //
  // Nothing is declared to the labels model from here: a generated form's
  // address comes from coordinates the language itself declared, so counting it
  // as usage would put a language's own declarations on its own worklist.
  if (insertedKey !== undefined) {
    await expandEntry(db, insertedKey, {
      entryKey,
      languageID: doc.languageID,
      orthography: doc.orthography,
      otherForms: doc.otherForms,
      inherentAtoms: doc.inherentAtoms,
      deleted: parsed.deleted,
    });
  }
  // The read model tracks current, non-withdrawn versions only: declaring
  // the new version's tags also retires the archived version's usage. A
  // deleted version declares none, even though its own `tags` stay stored on
  // the doc in case the entry is restored.
  await syncEntryTags(db, entryKey, doc.languageID, parsed.deleted ? [] : doc.tags);
  // The semantic network follows the same transition. A withdrawn version
  // offers no senses, so its own relations park and it stops being reachable
  // as a translation — a withdrawal is a claim that these senses should not be
  // offered.
  await syncEntrySenses(db, entryKey, doc.languageID, parsed.deleted ? [] : doc.places);
  // The cognate network follows too, but for different reasons: a withdrawal
  // parks the cognates pinning this entry, and an ordinary republication
  // refreshes what its lexeme vertex denormalizes (a re-spelled headword would
  // otherwise keep printing its old orthography in every component it is in).
  // Restructured definitions, by contrast, are none of this network's business.
  await syncEntryCognates(db, entryKey);
  // A relation or a cognate may have arrived before the entry version it pins:
  // Jetstream delivers records in arbitrary order. These are the joins that
  // revive them.
  await reviveUnresolvedRelations(db, recordURI);
  await reviveUnresolvedCognates(db, recordURI);
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
    docKey: string;
    recordURI: string;
    languageID: string;
    orthography: string[] | null;
    otherForms: IndexedForm[] | null;
    inherentAtoms: string[] | null;
    formIssues: unknown[] | null;
    tags: Tag[] | null;
    places: number[][] | null;
    deleted: boolean;
  }>(aql`
    FOR e IN entries
      FILTER e.entryKey == ${entryKey}
      SORT e.indexedAt DESC
      LIMIT 1
      UPDATE e WITH { current: true } IN entries
      RETURN {
        docKey: NEW._key,
        recordURI: NEW.recordURI,
        languageID: NEW.languageID,
        orthography: NEW.orthography,
        otherForms: NEW.otherForms,
        inherentAtoms: NEW.inherentAtoms,
        formIssues: NEW.formIssues,
        tags: NEW.tags,
        places: NEW.places,
        deleted: NEW.deleted == true
      }
  `);
  const promoted = await promotedCursor.next();

  // The entry's usage follows its new current version — or vanishes with the
  // entry. Versions indexed before tags were stored carry none and contribute
  // again once re-published.
  //
  // A promoted **withdrawal** declares none, exactly as a published one does
  // (see the ingest path above): the two routes to becoming current must leave
  // the read models in the same state, or the index would record something no
  // sequence of records could have said. A withdrawn version keeps its `tags`
  // on the doc — a restoration needs them back — so this is the guard that
  // stops them being counted as usage again.
  if (promoted) {
    // A promotion makes a different version's forms the ones search holds, so
    // generation is re-run over it exactly as it is over a newly ingested
    // version. The promoted doc may still carry the generated rows it had when
    // it was last current; `expandEntry` recomputes them from the asserted half,
    // so a rule published in the meantime is applied and a withdrawn one is not.
    await expandEntry(db, promoted.docKey, {
      entryKey,
      languageID: promoted.languageID,
      orthography: promoted.orthography ?? [],
      otherForms: promoted.otherForms ?? [],
      inherentAtoms: promoted.inherentAtoms ?? [],
      deleted: promoted.deleted,
      hadIssues: (promoted.formIssues ?? []).length > 0,
    });
    await syncEntryTags(
      db,
      entryKey,
      promoted.languageID,
      promoted.deleted ? [] : (promoted.tags ?? []),
    );
    // Same for its senses, and with them the relations pinning this entry: a
    // reversion to a version whose tree matches an assertion revives it, a
    // reversion away from it parks it. Versions indexed before `places` was
    // stored contribute none and park their relations until republished.
    await syncEntrySenses(
      db,
      entryKey,
      promoted.languageID,
      promoted.deleted ? [] : (promoted.places ?? []),
    );
  } else {
    await syncEntryTags(db, entryKey, null, []);
    await syncEntrySenses(db, entryKey, null, []);
  }
  // The cognate network needs no version content to follow the same transition:
  // it re-reads the entry row, so one call covers both branches — a promotion
  // (which may revive or park the cognates pinning this entry) and the entry's
  // disappearance (which orphans its vertex).
  await syncEntryCognates(db, entryKey);
  console.log(
    promoted
      ? `firehose: removed current version of entry "${entryKey}" (record deleted); promoted ${promoted.recordURI}`
      : `firehose: removed entry "${entryKey}" entirely (last record deleted)`,
  );
}
