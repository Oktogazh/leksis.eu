// What the search bar is searching over.
//
// Three kinds, one bar. Words are the dictionary proper; languages and sources
// are the two things a contributor has to be able to reach before they can add
// a word to one or cite the other, and neither was findable at all before —
// a language only through the picker beside the search box, a source not at
// all.

export const SEARCH_KINDS = ["words", "languages", "sources"] as const;

export type SearchKind = (typeof SEARCH_KINDS)[number];

/** The default: the dictionary is what a search bar in a dictionary searches. */
export const DEFAULT_SEARCH_KIND: SearchKind = "words";

/**
 * Read a kind off the URL. Anything unrecognized — including absent — is
 * `words`, so `/?q=…` keeps meaning exactly what it meant before this existed
 * and a link written by a newer build degrades instead of erroring.
 */
export function parseSearchKind(raw: string | null): SearchKind {
  return SEARCH_KINDS.includes(raw as SearchKind) ? (raw as SearchKind) : DEFAULT_SEARCH_KIND;
}
