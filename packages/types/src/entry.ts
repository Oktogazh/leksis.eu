// Contract for the eu.leksis.entry lexicon (lexicons/eu.leksis.entry.json)
// and the API's entries endpoints. Types are the contract: the lexicon JSON,
// these shapes, and the ArangoDB `entries` collection move together.
//
// The record on the user's PDS is the source of truth for entry content; the
// AppView indexes only what search needs (orthographies + language tag + the
// record reference). The frontend resolves the record itself from the
// author's PDS to render an entry.

/** AT Proto collection NSID for dictionary entry records. */
export const LEKSIS_ENTRY_COLLECTION = "eu.leksis.entry";

/**
 * A short/long annotation pair, used both for an entry's grammatical
 * categories ("n." / "noun") and for a definition's lexicographic notes
 * ("arch." / "archaic"). Freeform, not an enforced vocabulary.
 */
export interface EntryAnnotation {
  /**
   * Full form (e.g. "noun", "botany") — the only required half: a lone form
   * is always the full one, displayed directly with nothing on hover.
   */
  long: string;
  /**
   * Optional abbreviated display form (e.g. "n.", "bot."); when present it
   * is shown instead of the full form, which appears on hover.
   */
  short?: string;
}

/**
 * One definition of an entry. `definitions` is a flat list, each definition
 * carrying its coordinate (`place`) in a hierarchy of up to three dimensions:
 * one 0-based index per dimension, deepest last, so the place's length is the
 * definition's own depth ([0] = first top-level definition; [1, 0] = first
 * sub-definition of the second). Numbering in the UI follows the entry's
 * deepest place length: 1 → arabic; 2 → roman then arabic; 3 → letters,
 * roman, then arabic.
 */
export interface EntryDefinition {
  place: number[];
  /** Ordered lexicographic notes shown before the text. */
  notes: EntryAnnotation[];
  text: string;
}

/** Maximum depth of the definitions hierarchy (a place's maximum length). */
export const ENTRY_DEFINITIONS_MAX_DEPTH = 3;

/** Lexicographic (reading-order) comparison of two definition places. */
export function compareDefinitionPlaces(a: number[], b: number[]): number {
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i++) {
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  }
  return a.length - b.length;
}

/** A well-formed place: 1–3 non-negative integers. */
export function isValidDefinitionPlace(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= ENTRY_DEFINITIONS_MAX_DEPTH &&
    value.every((n) => Number.isInteger(n) && n >= 0)
  );
}

/**
 * Whole-list place invariants, given each place is already well-formed:
 * sorted in reading order, sibling indices contiguous from 0, and no place a
 * prefix of another (a definition cannot also be a group). Walked pairwise:
 * each place must increment its predecessor at exactly one level and reset
 * the deeper ones to 0.
 */
export function validDefinitionPlaces(places: number[][]): boolean {
  let prev: number[] | null = null;
  for (const place of places) {
    if (prev === null) {
      if (place.some((n) => n !== 0)) return false;
    } else {
      let branch = 0;
      while (branch < prev.length && prev[branch] === place[branch]) branch++;
      if (branch >= prev.length || branch >= place.length) return false; // prefix or duplicate
      if (place[branch] !== prev[branch]! + 1) return false; // gap or regression
      if (place.slice(branch + 1).some((n) => n !== 0)) return false;
    }
    prev = place;
  }
  return true;
}

/**
 * The eu.leksis.entry record as written to a user's PDS.
 * Records prove authorship, not ownership: a record with a `subject`
 * reference is a proposed new version of the entry that record belongs to.
 * The AppView keeps the latest version current and archives earlier ones.
 */
export interface LeksisEntryRecord {
  $type: typeof LEKSIS_ENTRY_COLLECTION;
  /** Well-formed BCP 47 tag, normalized lowercase (e.g. "br", "br-gw"). */
  languageID: string;
  /** Valid spellings; the first item is the canonical form. */
  orthography: string[];
  /** Ordered grammatical categories of the entry. */
  categories: EntryAnnotation[];
  /**
   * Flat list of definitions, sorted by `place` (see EntryDefinition).
   * Coordinates are meaningful: future fields reference a definition by its
   * place.
   */
  definitions: EntryDefinition[];
  /** AT URI of the record version this modifies; absent for a new entry. */
  subject?: string;
  /**
   * Pending-work notes: each item is one task this version still needs
   * (e.g. an ingestion bot flagging one unverified aspect), so several bots
   * or editors can each track their own item. Empty or absent means nothing
   * is pending; the AppView indexes only whether any item exists, as a
   * boolean.
   */
  todo?: string[];
  /**
   * Identifier of the external source this record was derived from (a URL
   * or a source-internal ID), set by ingestion bots for maintenance
   * traceability. Lives on the record only — never indexed.
   */
  botSource?: string;
  /**
   * Marks this version as a deletion: the entry is withdrawn from search
   * under this record, but stays reachable at its entryKey for legacy links
   * and to contest the deletion later. Requires `deletionReason`.
   * `orthography`/`categories`/`definitions` still carry content (the
   * lexicon requires them), but the AppView excludes the version's
   * orthography from the search index when this is true.
   */
  deleted?: boolean;
  /** Required when `deleted` is true: why this entry was withdrawn. */
  deletionReason?: string;
  /**
   * When `deleted` is true and the reason is a duplicate, the entryKey of
   * the correct entry to redirect readers to.
   */
  redirectTo?: string;
  createdAt: string;
}

/**
 * One entry as indexed by the AppView and served by the entries endpoints.
 * Deliberately minimal — the DB supports search, it does not hold the
 * content. `recordURI` is what the frontend resolves to render the entry.
 */
export interface EntryView {
  /** ArangoDB entry key, e.g. "br-gwerzenn-a3f9"; stable across versions. */
  key: string;
  languageID: string;
  orthography: string[];
  /** AT URI of the current record version. */
  recordURI: string;
  /** DID of the current version's author. */
  authorDID: string;
  /** True when the current version is a deletion (see LeksisEntryRecord.deleted). */
  deleted?: boolean;
  /** Present when `deleted` is true: why this entry was withdrawn. */
  deletionReason?: string;
  /** Present when `deleted` is true and the reason is a duplicate: the correct entry's key. */
  redirectTo?: string;
}

/** Response shape of GET /entries?q=X&l=Y (orthography search). */
export interface EntriesResponse {
  entries: EntryView[];
}
