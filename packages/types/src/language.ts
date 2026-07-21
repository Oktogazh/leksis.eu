// Contract for the eu.leksis.language lexicon (lexicons/eu.leksis.language.json)
// and the API's languages endpoint. Types are the contract: the lexicon JSON,
// these shapes, and the ArangoDB `languages` collection move together.

/** AT Proto collection NSID for language records. */
export const LEKSIS_LANGUAGE_COLLECTION = "eu.leksis.language";

/** A language's name written in another (or its own) language. */
export interface LanguageTranslation {
  /** BCP 47 tag of the language this name is written in. */
  languageID: string;
  /** The language's name in that language. */
  translation: string;
}

/**
 * The eu.leksis.language record as written to a user's PDS.
 * `translations` must contain the endonym: an item whose `languageID`
 * equals `tag`. Records prove authorship, not ownership — the AppView keeps
 * the latest record for a tag as current and archives earlier versions.
 */
export interface LeksisLanguageRecord {
  $type: typeof LEKSIS_LANGUAGE_COLLECTION;
  /** Well-formed BCP 47 tag, normalized lowercase (e.g. "br", "br-gw"). */
  tag: string;
  translations: LanguageTranslation[];
  createdAt: string;
}

/**
 * One language as served by GET /languages and as stored in the
 * `localLanguages` read model (one doc per locale, listing every available
 * language). The endonym comes from the record's required self-translation;
 * `name` is the language's name in the requested locale, present only when
 * the language's record carries a translation into it.
 */
export interface LanguageView {
  tag: string;
  endonym: string;
  name?: string;
}

/** Response shape of GET /languages?locale=X. */
export interface LanguagesResponse {
  /** Locale the `name` fields are localized into ("" = none requested). */
  locale: string;
  languages: LanguageView[];
}

/**
 * Response shape of GET /languages/:tag/currentRecord — the reference to a
 * language's current eu.leksis.language record, so the browser can resolve and
 * rewrite it (e.g. to edit its name in another language) without pulling the
 * whole dashboard. Null on the wire is served as 404.
 */
export interface CurrentLanguageRecordResponse {
  tag: string;
  /** at:// URI of the current language record (resolved client-side). */
  recordURI: string;
  authorDID: string;
}
