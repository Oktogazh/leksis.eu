// Contract for the eu.leksis.entry lexicon (lexicons/eu.leksis.entry.json)
// and the API's entries endpoints. Types are the contract: the lexicon JSON,
// these shapes, and the ArangoDB `entries` collection move together.
//
// The record on the user's PDS is the source of truth for entry content; the
// AppView indexes only what search needs (orthographies + language tag + the
// record reference). The frontend resolves the record itself from the
// author's PDS to render an entry.

import type { Tag } from "./tag.js";

/** AT Proto collection NSID for dictionary entry records. */
export const LEKSIS_ENTRY_COLLECTION = "eu.leksis.entry";

/**
 * One node of an entry's definition tree. `definitions` is a flat list, each
 * node carrying its address (`place`) in a hierarchy of up to three
 * dimensions. The LAST index of a place is the node type: non-zero means a
 * leaf — the definition proper, which carries `text`; 0 means a group node —
 * a heading that carries notes but no text (e.g. a "transitive" grouping over
 * several senses). A non-last index of 0 means "no grouping at that
 * dimension", so a place can render shallower than its length ([0, 1, 1] =
 * I. 1., [1] = [0, 1] = [0, 0, 1] = 1.). Bare grouping (a group with no notes)
 * is left implicit — such a group need not appear in the list; the hierarchy
 * is inferred from the leaves. Numbering: each non-zero index n shows as the
 * n-th label of its dimension, each 0 is skipped, and the scheme follows the
 * displayed depth (1 → arabic; 2 → roman, arabic; 3 → letters, roman, arabic).
 */
export interface EntryDefinition {
  place: number[];
  /**
   * Grammatical tags of this sense. A verb is VERB at the entry level and
   * transitive on one sense group, intransitive on another — which is what
   * the definition tree exists to express. Declaring a feature inherent to a
   * category does not restrict its use here; a dictionary may legitimately
   * print "v.t." in the headword line *and* split senses by transitivity.
   */
  categories?: Tag[];
  /** Free-text remarks shown before the node's content (neither label nor definition text). */
  notes?: string[];
  /** The definition text — present on and only on a leaf (place ending non-zero). */
  text?: string;
}

/** Maximum depth of the definitions hierarchy (a place's maximum length). */
export const ENTRY_DEFINITIONS_MAX_DEPTH = 3;

/**
 * An inflected/other grammatical form of the word (plural, gerund…): the tag
 * saying *which* form it is, plus its spelling.
 *
 * **One tag, not a list**, because the tag is the form's address in the
 * paradigm: a real dictionary's "gen. pl." is one coordinate in two
 * dimensions, so it is one bundle carrying `Case=Gen` and `Number=Plur`. That
 * is what layer 5 will match a generated cell against by canonical key, and
 * what layer 4 will place in a grid; a list of separate tags could not say
 * which combination it meant.
 *
 * Form-level altitude: these values are the ones the language declares as
 * **axes** of the entry's category. Nothing enforces that here — an axis
 * declaration is a menu, never a whitelist, and a form whose tag matches no
 * declared axis simply stays in the flat list.
 */
export interface EntryInflectedForm {
  tag: Tag;
  form: string;
}

/** A bibliographic reference for the entry: display text and an optional URL. */
export interface EntryReference {
  text: string;
  url?: string;
}

/** Whether a place addresses a leaf (last index non-zero) rather than a group node. */
export function isLeafPlace(place: number[]): boolean {
  return place.length > 0 && place[place.length - 1] !== 0;
}

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
 * Whole-tree validation of a definitions list under the tree model.
 * Each definition must already be well-formed ({ place, notes, plainNotes?,
 * text? }); this checks the coordinate invariants and the leaf/group text
 * rule, and returns a machine code so the editor and the API report the same
 * failure. `ok` is the sole success value.
 *
 * Rules, over the list in its given order:
 *  - a leaf (place ending non-zero) must carry non-empty text; a group node
 *    (place ending in 0) must not carry text ("text-rule");
 *  (`categories`/`notes` are not inspected here — they are
 *  well-formedness, checked where the record is parsed.)
 *  - places are strictly sorted in reading order ("order");
 *  - sibling indices are contiguous from 1 within each parent, and a group
 *    slot (a non-last index) that some node uses is opened by a matching
 *    group node or leaf beneath it — i.e. no gaps and no orphan depth
 *    ("structure");
 *  - at least one leaf exists ("empty").
 */
export type DefinitionsError = "order" | "structure" | "text-rule" | "empty";

export function validateDefinitions(
  definitions: readonly EntryDefinition[],
): DefinitionsError | "ok" {
  if (definitions.length === 0) return "empty";

  let prev: number[] | null = null;
  let leaves = 0;
  // For each depth d (0-based dimension), the highest non-zero index seen so
  // far under the current prefix — used to check "contiguous from 1" and to
  // detect gaps. Reset when the prefix above changes.
  for (const def of definitions) {
    const place = def.place;
    const leaf = isLeafPlace(place);
    if (leaf) leaves += 1;

    // text-rule: leaves need text, group nodes must not have it.
    const hasText = typeof def.text === "string" && def.text.trim() !== "";
    if (leaf && !hasText) return "text-rule";
    if (!leaf && hasText) return "text-rule";

    if (prev !== null) {
      if (compareDefinitionPlaces(prev, place) >= 0) return "order";
    }
    prev = place;
  }

  if (leaves === 0) return "empty";

  // structure: rebuild the tree from displayed coordinates and check that
  // every parent's children are contiguous from 1. A place's displayed path
  // is its sequence of non-zero indices (0s are skipped), truncated so that a
  // trailing 0 (group node) is dropped only as the type marker, not the path.
  // We validate on the raw indices per dimension instead: group siblings live
  // at the same prefix and must be 1,2,3,… with no gaps.
  const seen = new Set<string>();
  const childMax = new Map<string, number>(); // prefix → highest child index used
  for (const { place } of definitions) {
    // Walk each dimension; the value at dimension i is a child of the prefix
    // place[0..i-1]. Zero at a non-last dimension = degenerate (no grouping),
    // which is always allowed and shares the "0" slot; a non-zero value must
    // be contiguous with its siblings.
    for (let i = 0; i < place.length; i++) {
      const value = place[i]!;
      const prefix = place.slice(0, i).join(",");
      if (value === 0) continue; // degenerate slot or group marker — no sibling constraint
      const key = `${prefix}|${i}`;
      const max = childMax.get(key) ?? 0;
      if (value > max + 1) return "structure"; // gap (e.g. jumped to 3 with no 2)
      if (value > max) childMax.set(key, value);
    }
    const k = place.join(",");
    if (seen.has(k)) return "structure";
    seen.add(k);
  }

  return "ok";
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
  /**
   * IPA phonetic transcription of the word (e.g. "[ˈbrɛːzɔ̃nɛk]").
   * Record-only content, never indexed. Absent when the entry has none.
   */
  transcription?: string;
  /**
   * Ordered grammatical categories of the entry — **tags only**, never free
   * labels. Requiring a tag makes a contributor settle the language's grammar
   * declaration before authoring entries, so entries come out consistent
   * across the system; the friction is the mechanism working, not a flaw to
   * relax later. Non-grammatical headword labels (`vulg.`, `arch.`, `fam.`)
   * are not categories: they go in `notes` as prose, or become tags in their
   * own right once the language mints and binds a feature for them.
   *
   * Order is the entry author's: it is phrasing, not table geometry.
   * May be empty — a language whose grammar nobody has declared yet must
   * stay fully authorable.
   */
  categories: Tag[];
  /**
   * Other grammatical forms (plural, gerund…), each a tag saying which form it
   * is plus the form's spelling. The AppView indexes each form for search, so
   * an inflected form leads back to its entry. Absent when the entry has none.
   */
  otherForms?: EntryInflectedForm[];
  /**
   * Flat list of definition-tree nodes, sorted by `place` (see
   * EntryDefinition). Leaves carry text; group nodes carry notes only.
   */
  definitions: EntryDefinition[];
  /** Entry-level free-text notes shown below the definitions. Absent when none. */
  notes?: string[];
  /** Bibliographic references shown at the bottom of the entry. Absent when none. */
  references?: EntryReference[];
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

/** How many record URIs one resolve call accepts; extra ones are ignored. */
export const RESOLVE_URI_LIMIT = 100;

/**
 * Response shape of GET /entries/resolve?uri=…&uri=… — the at:// URI of an
 * entry *version* mapped to the stable entry key its page lives at.
 *
 * This exists because the mapping cannot be computed client-side: an entryKey
 * is minted from a hash of the **creating** record's URI and inherited by every
 * later version through the `subject` chain, so a version's own URI says
 * nothing about it. Anything reading records straight from a PDS — a
 * contributor's activity feed, an external tool — needs the index to make the
 * link back.
 *
 * A URI with no entry is simply absent from the map rather than an error: a
 * record the AppView never indexed (too new, or refused at ingest) is an
 * ordinary thing for a caller to hold.
 */
export interface EntryResolveResponse {
  /** recordURI → entryKey, for the URIs that resolved. */
  entries: Record<string, string>;
}
