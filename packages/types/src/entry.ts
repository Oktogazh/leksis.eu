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
  /** Abbreviated display form (e.g. "n.", "bot."). */
  short: string;
  /** Full form the abbreviation stands for (e.g. "noun", "botany"). */
  long: string;
}

/** One definition of an entry: ordered notes shown before the text. */
export interface EntryDefinition {
  notes: EntryAnnotation[];
  text: string;
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
  /** Order is meaningful: future fields reference definitions by index. */
  definitions: EntryDefinition[];
  /** AT URI of the record version this modifies; absent for a new entry. */
  subject?: string;
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
}

/** Response shape of GET /entries?q=X&l=Y (orthography search). */
export interface EntriesResponse {
  entries: EntryView[];
}
