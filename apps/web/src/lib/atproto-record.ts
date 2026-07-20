import {
  compareDefinitionPlaces,
  isValidDefinitionPlace,
  isValidLanguageTag,
  normalizeLanguageTag,
  LEKSIS_ENTRY_COLLECTION,
  LEKSIS_LANGUAGE_COLLECTION,
  type EntryAnnotation,
  type EntryDefinition,
  type LanguageTranslation,
  type LeksisEntryRecord,
  type LeksisLanguageRecord,
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

/** Resolve a DID to its PDS base URL via its DID document. */
async function resolvePds(did: string): Promise<string> {
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

function parseAnnotations(value: unknown): EntryAnnotation[] {
  if (!Array.isArray(value)) return [];
  const annotations: EntryAnnotation[] = [];
  for (const item of value) {
    const a = item as Record<string, unknown> | null;
    if (!a || typeof a.long !== "string" || a.long.trim() === "") continue;
    const short = typeof a.short === "string" && a.short.trim() !== "" ? a.short : undefined;
    annotations.push(short === undefined ? { long: a.long } : { short, long: a.long });
  }
  return annotations;
}

/**
 * Lenient parse of the flat definitions list: each definition is
 * `{place, notes?, text}` with a well-formed place (1–3 non-negative
 * integers). Malformed definitions are dropped; survivors are sorted back
 * into reading order so rendering never depends on the record's array order.
 */
function parseDefinitions(value: unknown): EntryDefinition[] {
  if (!Array.isArray(value)) return [];
  const definitions: EntryDefinition[] = [];
  for (const item of value) {
    const def = item as Record<string, unknown> | null;
    if (!def || typeof def !== "object") continue;
    if (typeof def.text !== "string" || def.text.trim() === "") continue;
    if (!isValidDefinitionPlace(def.place)) continue;
    definitions.push({ place: def.place, notes: parseAnnotations(def.notes), text: def.text });
  }
  return definitions.sort((a, b) => compareDefinitionPlaces(a.place, b.place));
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

  // Pending-task notes; malformed items are dropped rather than failing the
  // whole record. `botSource` is carried through so a proposed modification
  // can preserve the content's source traceability.
  const todo = Array.isArray(r.todo)
    ? r.todo.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    : [];

  return {
    $type: LEKSIS_ENTRY_COLLECTION,
    languageID,
    orthography,
    categories: parseAnnotations(r.categories),
    definitions,
    ...(typeof r.subject === "string" ? { subject: r.subject } : {}),
    ...(todo.length > 0 ? { todo } : {}),
    ...(typeof r.botSource === "string" && r.botSource.trim() !== ""
      ? { botSource: r.botSource }
      : {}),
    createdAt: typeof r.createdAt === "string" ? r.createdAt : "",
  };
}

/**
 * Fetch a record's raw value from its author's PDS. Throws on
 * network/resolution failure; returns null when the record no longer exists.
 */
async function fetchRecordValue(recordURI: string): Promise<unknown | null> {
  const parsed = parseAtUri(recordURI);
  if (!parsed) return null;

  const pds = await resolvePds(parsed.did);
  const params = new URLSearchParams({
    repo: parsed.did,
    collection: parsed.collection,
    rkey: parsed.rkey,
  });
  const res = await fetch(`${pds}/xrpc/com.atproto.repo.getRecord?${params.toString()}`);
  if (res.status === 400 || res.status === 404) return null; // record gone
  if (!res.ok) throw new Error(`getRecord failed: ${res.status}`);
  const body = (await res.json()) as GetRecordResponse;
  return body.value;
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
    createdAt: typeof r.createdAt === "string" ? r.createdAt : "",
  };
}
