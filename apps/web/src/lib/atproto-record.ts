import {
  compareDefinitionPlaces,
  isValidDefinitionPlace,
  isValidGrammar,
  isValidTag,
  isValidLanguageTag,
  normalizeLanguageTag,
  LEKSIS_COGNATE_COLLECTION,
  LEKSIS_ENTRY_COLLECTION,
  LEKSIS_LANGUAGE_COLLECTION,
  LEKSIS_RELATION_COLLECTION,
  type EntryDefinition,
  type EntryInflectedForm,
  type EntryReference,
  type Grammar,
  type Tag,
  type LanguageTranslation,
  type LeksisCognateRecord,
  type LeksisEntryRecord,
  type LeksisLanguageRecord,
  type LeksisRelationRecord,
} from "@leksis/types";

// Client-side resolution of eu.leksis.* records from their at:// URIs. The
// AppView only indexes what its read surfaces need; the record on the
// author's PDS is the source of truth for content, so the browser resolves
// it directly: DID → DID document (plc.directory or .well-known) → PDS
// endpoint → com.atproto.repo.getRecord (public, no auth).

interface DidDocument {
  service?: { id: string; type: string; serviceEndpoint: string }[];
}

interface GetRecordResponse {
  uri: string;
  cid?: string;
  value: unknown;
}

/** Split an at:// URI into repo (DID), collection and rkey. */
export function parseAtUri(uri: string): { did: string; collection: string; rkey: string } | null {
  const match = /^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(uri);
  if (!match) return null;
  return { did: match[1]!, collection: match[2]!, rkey: match[3]! };
}

/**
 * Resolve a DID to its PDS base URL via its DID document, memoized for the
 * session. A DID document changes about as often as someone migrates PDS, and
 * a single page can resolve dozens of records from the same author (an entry
 * plus its relations, a profile's whole activity feed) — one lookup per DID
 * instead of one per record.
 */
const pdsCache = new Map<string, Promise<string>>();

export function resolvePds(did: string): Promise<string> {
  const cached = pdsCache.get(did);
  if (cached) return cached;
  // Cache the promise, not the value, so concurrent callers share one request;
  // a rejection is evicted so the next caller retries.
  const pending = resolvePdsUncached(did).catch((err: unknown) => {
    pdsCache.delete(did);
    throw err;
  });
  pdsCache.set(did, pending);
  return pending;
}

async function resolvePdsUncached(did: string): Promise<string> {
  let docUrl: string;
  if (did.startsWith("did:plc:")) {
    docUrl = `https://plc.directory/${did}`;
  } else if (did.startsWith("did:web:")) {
    docUrl = `https://${decodeURIComponent(did.slice("did:web:".length))}/.well-known/did.json`;
  } else {
    throw new Error(`unsupported DID method: ${did}`);
  }

  const res = await fetch(docUrl);
  if (!res.ok) throw new Error(`DID document fetch failed: ${res.status}`);
  const doc = (await res.json()) as DidDocument;
  const pds = doc.service?.find(
    (s) => s.id.endsWith("#atproto_pds") && s.type === "AtprotoPersonalDataServer",
  );
  if (!pds) throw new Error(`no PDS service in DID document of ${did}`);
  return pds.serviceEndpoint;
}

/** Lenient parse of a tag list; malformed tags are dropped, not fatal. */
function parseTags(value: unknown): Tag[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Tag => isValidTag(item));
}

/** Lenient parse of a free-text list; non-string and blank items are dropped. */
function parseTextList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
}

/**
 * Lenient parse of the flat definitions list: each node is
 * `{place, notes?, plainNotes?, text?}` with a well-formed place (1–3
 * non-negative integers). Both node kinds are kept — a leaf carries the
 * definition text, a group node carries only its notes, and dropping the
 * group nodes would lose every heading and the notes that hang on them.
 *
 * Which kind a node is, is decided by **whether it carries text, not by its
 * place**. `isLeafPlace` is the strict rule the API enforces at ingest, but
 * records indexed before the v0.8 tree convention use the older 0-based
 * coordinates (`[0]`, `[1,0]`), so their leaves look like group nodes to it.
 * The record's own content is the reliable signal, and honouring it is what
 * "lenient where ingestion is strict" means here: a node that states its text
 * gets it rendered. Malformed nodes are dropped; survivors are sorted back
 * into reading order so rendering never depends on the record's array order.
 */
function parseDefinitions(value: unknown): EntryDefinition[] {
  if (!Array.isArray(value)) return [];
  const definitions: EntryDefinition[] = [];
  for (const item of value) {
    const def = item as Record<string, unknown> | null;
    if (!def || typeof def !== "object") continue;
    if (!isValidDefinitionPlace(def.place)) continue;
    const text = typeof def.text === "string" ? def.text : "";
    const categories = parseTags(def.categories);
    const notes = parseTextList(def.notes);
    // A node with nothing to show is dropped: an empty leaf, or a bare group
    // the tree re-derives from its children anyway.
    if (text.trim() === "" && categories.length === 0 && notes.length === 0) {
      continue;
    }
    definitions.push({
      place: def.place,
      ...(categories.length > 0 ? { categories } : {}),
      ...(notes.length > 0 ? { notes } : {}),
      ...(text.trim() !== "" ? { text } : {}),
    });
  }
  return definitions.sort((a, b) => compareDefinitionPlaces(a.place, b.place));
}

/**
 * Lenient parse of the entry's other grammatical forms: each is the tag saying
 * which form it is, plus a non-empty spelling. Malformed items are dropped.
 *
 * A form from a record written before labels moved to the language record
 * carries a free `{short, long}` pair and no tag, so it drops out here. That
 * is deliberate and it is the *lenient* half of the break: the AppView refuses
 * such a record outright, while a copy already indexed renders without the
 * form rather than not rendering at all.
 */
function parseOtherForms(value: unknown): EntryInflectedForm[] {
  if (!Array.isArray(value)) return [];
  const forms: EntryInflectedForm[] = [];
  for (const item of value) {
    const f = item as Record<string, unknown> | null;
    if (!f || typeof f.form !== "string" || f.form.trim() === "") continue;
    if (!isValidTag(f.tag)) continue;
    forms.push({ tag: f.tag, form: f.form });
  }
  return forms;
}

/** Lenient parse of the bibliographic references; items without text are dropped. */
function parseReferences(value: unknown): EntryReference[] {
  if (!Array.isArray(value)) return [];
  const references: EntryReference[] = [];
  for (const item of value) {
    const ref = item as Record<string, unknown> | null;
    if (!ref || typeof ref.text !== "string" || ref.text.trim() === "") continue;
    const url = typeof ref.url === "string" && ref.url.trim() !== "" ? ref.url : undefined;
    references.push(url === undefined ? { text: ref.text } : { text: ref.text, url });
  }
  return references;
}

/**
 * Narrow an unknown PDS payload to the entry contract. Lenient where the
 * AppView's ingestion is strict: the record was already accepted for
 * indexing; rendering drops malformed pieces instead of failing whole.
 */
function parseEntryRecord(value: unknown): LeksisEntryRecord | null {
  if (typeof value !== "object" || value === null) return null;
  const r = value as Record<string, unknown>;

  const languageID = typeof r.languageID === "string" ? normalizeLanguageTag(r.languageID) : "";
  if (!isValidLanguageTag(languageID)) return null;

  const orthography = Array.isArray(r.orthography)
    ? r.orthography.filter((o): o is string => typeof o === "string" && o.trim() !== "")
    : [];
  if (orthography.length === 0) return null;

  const definitions = parseDefinitions(r.definitions);
  if (definitions.length === 0) return null;

  const otherForms = parseOtherForms(r.otherForms);
  const notes = parseTextList(r.notes);
  const references = parseReferences(r.references);
  // Pending-task notes; malformed items are dropped rather than failing the
  // whole record.
  const todo = parseTextList(r.todo);

  return {
    $type: LEKSIS_ENTRY_COLLECTION,
    languageID,
    orthography,
    ...(typeof r.transcription === "string" && r.transcription.trim() !== ""
      ? { transcription: r.transcription }
      : {}),
    categories: parseTags(r.categories),
    ...(otherForms.length > 0 ? { otherForms } : {}),
    definitions,
    ...(notes.length > 0 ? { notes } : {}),
    ...(references.length > 0 ? { references } : {}),
    ...(typeof r.subject === "string" ? { subject: r.subject } : {}),
    ...(todo.length > 0 ? { todo } : {}),
    createdAt: typeof r.createdAt === "string" ? r.createdAt : "",
  };
}

/**
 * Fetch a record's raw value from a repo's PDS, addressed by its three
 * coordinates rather than by an at:// URI — which is how a singleton record
 * (`self`) is reached, since nothing hands out its URI. Public: getRecord
 * needs no auth, so this reads any user's repo, not only the session's.
 *
 * Throws on network/resolution failure; returns null when the record does not
 * exist.
 */
export async function fetchRepoRecord(
  did: string,
  collection: string,
  rkey: string,
): Promise<unknown | null> {
  const pds = await resolvePds(did);
  const params = new URLSearchParams({ repo: did, collection, rkey });
  const res = await fetch(`${pds}/xrpc/com.atproto.repo.getRecord?${params.toString()}`);
  if (res.status === 400 || res.status === 404) return null; // record gone
  if (!res.ok) throw new Error(`getRecord failed: ${res.status}`);
  const body = (await res.json()) as GetRecordResponse;
  return body.value;
}

/**
 * Fetch a record's raw value from its author's PDS. Throws on
 * network/resolution failure; returns null when the record no longer exists.
 */
async function fetchRecordValue(recordURI: string): Promise<unknown | null> {
  const parsed = parseAtUri(recordURI);
  if (!parsed) return null;
  return fetchRepoRecord(parsed.did, parsed.collection, parsed.rkey);
}

/**
 * Fetch and validate a eu.leksis.entry record from its author's PDS.
 * Throws on network/resolution failure; returns null when the record no
 * longer exists or does not parse as an entry.
 */
export async function fetchEntryRecord(recordURI: string): Promise<LeksisEntryRecord | null> {
  const value = await fetchRecordValue(recordURI);
  return value === null ? null : parseEntryRecord(value);
}

/**
 * Fetch a eu.leksis.relation record from its author's PDS. The AppView serves a
 * relation's shape and pointers; its `notes` — the register caveats and
 * partial-equivalence warnings that are the assertion's own content — stay on
 * the record, exactly as definition texts do.
 *
 * Lenient like the others: the sides are not re-validated here, because the
 * caller already has the AppView's resolved view of them and only needs what
 * the index does not carry. Returns null when the record is gone or does not
 * parse.
 */
export async function fetchRelationRecord(
  recordURI: string,
): Promise<LeksisRelationRecord | null> {
  const value = await fetchRecordValue(recordURI);
  if (value === null || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  if (!Array.isArray(r.sides) || r.sides.length !== 2) return null;

  const notes = parseTextList(r.notes);
  return {
    $type: LEKSIS_RELATION_COLLECTION,
    ...(typeof r.kind === "string" && r.kind !== "" ? { kind: r.kind } : {}),
    sides: r.sides as LeksisRelationRecord["sides"],
    ...(notes.length > 0 ? { notes } : {}),
    ...(typeof r.subject === "string" ? { subject: r.subject } : {}),
    createdAt: typeof r.createdAt === "string" ? r.createdAt : "",
  };
}

/**
 * Fetch a eu.leksis.cognate record from its author's PDS — the same split as
 * relations: the AppView serves the assertion's shape, its `notes` (the source,
 * the caveat that the cognacy is contested) stay on the record.
 *
 * Lenient for the same reason: the caller already holds the AppView's resolved
 * view of the sides and needs only what the index does not carry.
 */
export async function fetchCognateRecord(
  recordURI: string,
): Promise<LeksisCognateRecord | null> {
  const value = await fetchRecordValue(recordURI);
  if (value === null || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  if (!Array.isArray(r.sides) || r.sides.length !== 2) return null;

  const notes = parseTextList(r.notes);
  return {
    $type: LEKSIS_COGNATE_COLLECTION,
    sides: r.sides as LeksisCognateRecord["sides"],
    ...(notes.length > 0 ? { notes } : {}),
    ...(typeof r.subject === "string" ? { subject: r.subject } : {}),
    createdAt: typeof r.createdAt === "string" ? r.createdAt : "",
  };
}

/**
 * Fetch and validate a eu.leksis.language record from its author's PDS —
 * the language dashboard resolves it to show and extend the language's
 * names. Lenient: malformed translation items are dropped.
 */
export async function fetchLanguageRecord(
  recordURI: string,
): Promise<LeksisLanguageRecord | null> {
  const value = await fetchRecordValue(recordURI);
  if (value === null || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;

  const tag = typeof r.tag === "string" ? normalizeLanguageTag(r.tag) : "";
  if (!isValidLanguageTag(tag)) return null;

  // A malformed grammar makes the whole record unreadable rather than being
  // dropped like a bad translation row. Every caller here loads a record in
  // order to rewrite it, so silently discarding the grammar would delete a
  // language's entire declaration on the next save — refusing to edit is the
  // safe failure. (The AppView rejects such records at ingest, so an indexed
  // record never hits this.)
  if (r.grammar !== undefined && !isValidGrammar(r.grammar)) {
    console.warn(`language record ${recordURI} has a malformed grammar; refusing to load it`);
    return null;
  }

  const translations: LanguageTranslation[] = [];
  if (Array.isArray(r.translations)) {
    for (const item of r.translations) {
      const entry = item as Record<string, unknown> | null;
      if (!entry || typeof entry.languageID !== "string" || typeof entry.translation !== "string") {
        continue;
      }
      const languageID = normalizeLanguageTag(entry.languageID);
      if (!isValidLanguageTag(languageID) || entry.translation.trim() === "") continue;
      translations.push({ languageID, translation: entry.translation });
    }
  }

  return {
    $type: LEKSIS_LANGUAGE_COLLECTION,
    tag,
    translations,
    ...(r.grammar !== undefined ? { grammar: r.grammar as Grammar } : {}),
    createdAt: typeof r.createdAt === "string" ? r.createdAt : "",
  };
}
