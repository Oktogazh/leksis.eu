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
  /**
   * Sentences illustrating this sense — present on a leaf only, for the same
   * reason `text` is: an example exemplifies one meaning, and a group node is
   * a heading with none of its own. Enforced by `validateDefinitions`
   * ("example-rule").
   */
  examples?: EntryExample[];
}

/**
 * One example sentence on a definition leaf: the sentence, and optionally the
 * work it was taken from.
 *
 * An unsourced example is a legitimate lexicographic object — a constructed
 * illustration, or one heard rather than read — so `source` is optional and its
 * absence means "no source", never "the citation is missing".
 */
export interface EntryExample {
  /** The sentence, in the entry's own language. */
  text: string;
  source?: EntryExampleSource;
}

/**
 * The citation half of an example: which work, and where in it.
 *
 * **The work is referenced by its OCLC number, never by a record URI.** The
 * number is the work's identity, so the reference survives every version of the
 * eu.leksis.source record describing it and is valid *before* anybody publishes
 * one — a citation can only degrade to the bare number, never break. What a
 * reader sees of the work (the short and long citation forms) is rendered from
 * that record, so correcting a mistyped citation corrects every entry quoting
 * the work rather than requiring each of them to be republished.
 */
export interface EntryExampleSource {
  /** Normalized OCLC number (`normalizeOclc`) — the key a source record is filed under. */
  oclc: string;
  /**
   * Where in the source: "p. 142", "s.v. gwerzenn", "§4", "14:03". Free text,
   * because pagination, folio, headword and timestamp locators do not share a
   * schema. Absent when the whole work is the source.
   */
  locator?: string;
}

/** Most example sentences one definition leaf may carry (the lexicon's cap). */
export const MAX_DEFINITION_EXAMPLES = 16;

/**
 * Most etymology paragraphs one entry may carry (the lexicon's cap).
 *
 * Enforced at ingest like every other declared limit (ADR-0015): the lexicon's
 * `maxLength` is validation, not documentation.
 */
export const MAX_ENTRY_ETYMOLOGY = 16;

/** Most pending-work notes one entry may carry (the lexicon's cap). */
export const MAX_ENTRY_TODO = 64;

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
 *  - a group node must carry no examples ("example-rule"): an example
 *    exemplifies one sense, and a heading has none of its own. The leaf half of
 *    the text rule has no counterpart here — examples are optional on a leaf.
 *  (`categories`/`notes`, and the well-formedness of each example item, are not
 *  inspected here — they are checked where the record is parsed.)
 *  - places are strictly sorted in reading order ("order");
 *  - sibling indices are contiguous from 1 within each parent, and a group
 *    slot (a non-last index) that some node uses is opened by a matching
 *    group node or leaf beneath it — i.e. no gaps and no orphan depth
 *    ("structure");
 *  - at least one leaf exists ("empty").
 */
export type DefinitionsError =
  | "order"
  | "structure"
  | "text-rule"
  | "example-rule"
  | "empty";

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

    // example-rule: a heading exemplifies nothing. Only the group half exists —
    // a leaf with no examples is the ordinary case, not a defect.
    if (!leaf && Array.isArray(def.examples) && def.examples.length > 0) {
      return "example-rule";
    }

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
   * EntryDefinition). Leaves carry text and any example sentences; group nodes
   * carry notes only.
   */
  definitions: EntryDefinition[];
  /**
   * The word's history, as prose paragraphs in the entry's own language — one
   * item per paragraph, for a competing or complementary account as much as for
   * a long one. Record-only content, never indexed. Absent when the entry has
   * none.
   *
   * Prose deliberately, and not a graph: a word's history is a chain of forms
   * across historical languages carrying dates, uncertainty, mechanisms whose
   * borders blur (inherited, borrowed, calqued, derived) and disagreement
   * between sources. Formalizing that would encode false precision and read
   * worse for the person the entry is for. The machine-checkable half of the
   * same knowledge — that two words share an origin — is formalized instead, as
   * an eu.leksis.cognate record between entries: the prose tells the story, the
   * cognate network makes it traversable, and a historical form named here
   * becomes a link once that language and that form have records of their own.
   */
  etymology?: string[];
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
 * One inflected form the search index holds, as a search hit reports it.
 *
 * `tag` rides along rather than the canonical key the index stores it under,
 * because the reader is shown the form's **labels**, resolved against what the
 * language bound — and a key is not a tag: it has had provenance folded into a
 * string, so a minted item could never find the row that names it. The key is
 * for joining, the tag is for showing.
 */
export interface EntryFormHit {
  /** The spelling, as the entry prints it. */
  form: string;
  /** Which form it is — the cell's address in the paradigm. */
  tag: Tag;
  /** True when a paradigm's rules produced it rather than the entry asserting it. */
  generated: boolean;
}

/**
 * Which half of the index a search hit matched on — the headword, the word's
 * other forms, or both.
 *
 * The two halves are reported rather than merged because they are different
 * answers to the reader: *молодий* found under its own spelling is the entry
 * they searched for, while *молода* found as one of its forms is a step away
 * from it and has to say so. It is also what the results filter is built on.
 */
export interface EntryMatch {
  /** The query prefix-matched one of the entry's orthographies. */
  headword: boolean;
  /** The forms the query prefix-matched — empty when only the headword did. */
  forms: EntryFormHit[];
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
  /**
   * Search hits only: what the query matched on. Absent everywhere a single
   * entry is served by identity, where there is no query and nothing matched.
   */
  match?: EntryMatch;
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
