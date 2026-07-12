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

/** One language as served by GET /languages (current version only). */
export interface LanguageView {
  tag: string;
  translations: LanguageTranslation[];
  createdAt: string;
}

/** Response shape of GET /languages. */
export interface LanguagesResponse {
  languages: LanguageView[];
}
