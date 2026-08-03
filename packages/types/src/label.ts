// Contract for the labels read model and its API endpoint
// (GET /languages/:tag/labels) — the front-matter "abbreviations" section of a
// printed dictionary. The API exposes each label, its usage count and its
// conflicts; the entries behind a label stay in the database only.
//
// Every label comes from one place: a declaration on the language record. A
// label is never harvested from an entry, because an entry no longer carries
// one — it carries tags, and what a reader sees is whatever the language bound
// that tag to. One displayed string, one source of truth.
//
// **The tag is the identity, and the label is what it is called.** The earlier
// framing was the reverse — "a tagged abbreviation", a label that happened to
// acquire a tag — and it made the label pair the key of the whole model, so
// renaming "n." to "an." destroyed one row and created another, and two atoms
// named the same words silently became one row. A dictionary's front matter is
// a list of *things*, each with a name; the thing here is the tag. Hence
// **labelled tags**, hence one row per tag per language, enforced by the read
// model's own key.
//
// The one row standing for no tag is a plain abbreviation ("udb." → "un dra
// bennak"), whose identity is its own short form — which is why the model is
// keyed on a canonical *row* key rather than on a tag key.

import type { GrammarLabel, GrammarRowKind } from "./grammar.js";
import { tagKey, type Tag } from "./tag.js";

/** One (short, long) pair reference, used to describe a conflict partner. */
export interface LabelRef {
  short?: string;
  long: string;
}

/** One row of a language's label list, as served by the API. */
export interface LabelView {
  short?: string;
  /**
   * The full form — **absent when the row is a tag in use that nothing has
   * named yet**. Such a row is the worklist item: "used here, still needs a
   * name in this language".
   */
  long?: string;
  /**
   * Number of current entries using the row (never the entries themselves).
   * **Zero is normal** for a label a language declared before anyone used it.
   */
  count: number;
  /**
   * True when the language's grammar declares this label. The framing is a
   * **labelled tag**: the tag is the row, the label is what it is called.
   */
  bound: boolean;
  /**
   * What kind of row the language declared, when it declared one — so a reader
   * can tell a part of speech from an inflection class from a plain
   * abbreviation without decoding a tag. Absent on an unnamed tag in use, which
   * is not yet any kind of thing.
   */
  kind?: GrammarRowKind;
  /**
   * The tag the label stands for, when there is one — a feature *name* and a
   * plain abbreviation are both labelled and neither is a tag. Lets a viewer
   * resolve an entry's tags without resolving the language record.
   */
  tag?: Tag;
  /**
   * Same-language rows whose forms clash with this one: the same short with a
   * different full form, or the same full form at all — two rows a reader
   * cannot tell apart are a defect however they came about.
   */
  conflictsWith: LabelRef[];
}

/** Response shape of GET /languages/:tag/labels. */
export interface LabelsResponse {
  languageID: string;
  /** Sorted by usage count (descending), then by full form. */
  labels: LabelView[];
}

/**
 * The tag → label map the viewer's resolution chain consumes, built from the
 * labels response a page has already fetched. No extra request and no PDS round
 * trip: the read model carries each row's tag precisely so a reader never has
 * to resolve a language record to see a word's categories.
 */
export function labelLookup(labels: readonly LabelView[]): Map<string, GrammarLabel> {
  const lookup = new Map<string, GrammarLabel>();
  for (const row of labels) {
    if (row.tag === undefined || row.long === undefined) continue;
    const key = tagKey(row.tag);
    if (lookup.has(key)) continue;
    lookup.set(key, { long: row.long, ...(row.short !== undefined ? { short: row.short } : {}) });
  }
  return lookup;
}

/** Display form of a row reference: "n. noun", or just "noun" without a short. */
export function formatLabelRef(ref: LabelRef): string {
  return ref.short === undefined ? ref.long : `${ref.short} ${ref.long}`;
}

/**
 * The conflict partners of one label, according to a language's label list —
 * shared by the entry editor and the entry page to flag a clash in both edit
 * and view mode. Two declarations can still collide even though a label has a
 * single source: a language may name two different tags the same way, and that
 * is exactly what this surfaces.
 *
 * A label with no short form is looked up like any other now: two tags whose
 * full forms are identical are indistinguishable to a reader whether or not
 * either was abbreviated.
 */
export function labelConflicts(
  label: GrammarLabel,
  labels: readonly LabelView[],
): LabelRef[] {
  const match = labels.find((view) => view.short === label.short && view.long === label.long);
  return match?.conflictsWith ?? [];
}
