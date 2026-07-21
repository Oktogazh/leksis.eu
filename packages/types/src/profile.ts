// Contract for the eu.leksis.profile lexicon (lexicons/eu.leksis.profile.json).
// Unlike language/entry, this is per-user client configuration, NOT dictionary
// content: the AppView never indexes it (no Jetstream collection, no ArangoDB
// doc). The browser reads and writes it directly on the user's own PDS. Types
// are the contract: the lexicon JSON and this shape move together.

/** AT Proto collection NSID for profile records. */
export const LEKSIS_PROFILE_COLLECTION = "eu.leksis.profile";

/** Record key of the singleton profile record (one per repo). */
export const LEKSIS_PROFILE_RKEY = "self";

/**
 * The eu.leksis.profile record as written to a user's PDS. Holds the two
 * settings gathered at onboarding and editable from the profile menu: the UI
 * interface language and the languages of interest that populate the search
 * bar. `languages` may be empty; both tags are normalized lowercase BCP 47.
 */
export interface LeksisProfileRecord {
  $type: typeof LEKSIS_PROFILE_COLLECTION;
  /** BCP 47 tag of the UI language (e.g. "en"). */
  interfaceLanguage: string;
  /** Languages of interest, most relevant first; may be empty. */
  languages: string[];
  createdAt: string;
}
