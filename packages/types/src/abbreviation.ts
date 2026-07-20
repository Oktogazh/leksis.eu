// Contract for the abbreviations read model and its API endpoint
// (GET /languages/:tag/abbreviations). The model harvests every distinct
// short/long annotation pair used by a language's current entry versions —
// grammatical categories and definition notes alike: the front-matter
// "abbreviations" section of a printed dictionary. The API exposes the
// pairs, their usage counts and their conflicts; the entries behind each
// pair stay in the database only.

import type { EntryAnnotation } from "./entry.js";

/** One (short, long) pair reference, used to describe a conflict partner. */
export interface AbbreviationRef {
  short?: string;
  long: string;
}

/** One abbreviation pair of a language, as served by the API. */
export interface AbbreviationView extends AbbreviationRef {
  /** Number of current entries using the pair (never the entries themselves). */
  count: number;
  /**
   * Same-language pairs whose forms clash with this one: same short with a
   * different long, or same long with a different short. A pair without a
   * short form never conflicts.
   */
  conflictsWith: AbbreviationRef[];
}

/** Response shape of GET /languages/:tag/abbreviations. */
export interface AbbreviationsResponse {
  languageID: string;
  /** Sorted by usage count (descending), then by long form. */
  abbreviations: AbbreviationView[];
}

/** Display form of a pair reference: "n. noun", or just "noun" without a short. */
export function formatAbbreviationRef(ref: AbbreviationRef): string {
  return ref.short === undefined ? ref.long : `${ref.short} ${ref.long}`;
}

/**
 * The conflict partners of one annotation, according to a language's
 * abbreviation list — shared by the entry editor and the entry page to flag
 * clashing pairs in both edit and view mode.
 */
export function annotationConflicts(
  annotation: EntryAnnotation,
  abbreviations: AbbreviationView[],
): AbbreviationRef[] {
  if (annotation.short === undefined) return [];
  const match = abbreviations.find(
    (view) => view.short === annotation.short && view.long === annotation.long,
  );
  return match?.conflictsWith ?? [];
}
