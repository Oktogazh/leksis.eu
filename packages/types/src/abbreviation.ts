// Contract for the abbreviations read model and its API endpoint
// (GET /languages/:tag/abbreviations). The model harvests every distinct
// short/long annotation pair used by a language's current entry versions —
// grammatical categories and definition notes alike: the front-matter
// "abbreviations" section of a printed dictionary. The API exposes the
// pairs, their usage counts and their conflicts; the entries behind each
// pair stay in the database only.

import type { EntryAnnotation } from "./entry.js";
import type { GrammarLabel } from "./grammar.js";
import { tagKey, type Tag } from "./tag.js";

/** One (short, long) pair reference, used to describe a conflict partner. */
export interface AbbreviationRef {
  short?: string;
  long: string;
}

/** One row of a language's abbreviation list, as served by the API. */
export interface AbbreviationView {
  short?: string;
  /**
   * The full form — **absent when the row is a tag in use that nothing has
   * bound yet**. Such a row is the worklist item: "used here, still needs a
   * name in this language".
   */
  long?: string;
  /**
   * Number of current entries using the pair (never the entries themselves).
   * **Zero is normal** for a pair a language bound but nobody has used yet.
   */
  count: number;
  /**
   * True when the language's grammar binds this label to a grammatical atom.
   * The framing is "a tagged abbreviation": the pair is the object, the tag
   * an attribute it acquired.
   */
  bound: boolean;
  /**
   * The tag the label stands for, when bound and when the bound atom is a tag
   * (a feature *name* is bound but is not a tag). Lets a viewer resolve an
   * entry's tags without resolving the language record.
   */
  tag?: Tag;
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

/**
 * The tag → label map the viewer's resolution chain consumes, built from the
 * abbreviations response a page has already fetched. No extra request and no
 * PDS round trip: the read model carries the binding's tag precisely so a
 * reader never has to resolve a language record to see a word's categories.
 */
export function abbreviationLookup(
  abbreviations: readonly AbbreviationView[],
): Map<string, GrammarLabel> {
  const lookup = new Map<string, GrammarLabel>();
  for (const row of abbreviations) {
    if (row.tag === undefined || row.long === undefined) continue;
    const key = tagKey(row.tag);
    if (lookup.has(key)) continue;
    lookup.set(key, { long: row.long, ...(row.short !== undefined ? { short: row.short } : {}) });
  }
  return lookup;
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
  abbreviations: readonly AbbreviationView[],
): AbbreviationRef[] {
  if (annotation.short === undefined) return [];
  const match = abbreviations.find(
    (view) => view.short === annotation.short && view.long === annotation.long,
  );
  return match?.conflictsWith ?? [];
}
