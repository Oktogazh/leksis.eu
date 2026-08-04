// Contract for the eu.leksis.relation lexicon (lexicons/eu.leksis.relation.json)
// and the semantic network built from it. Types are the contract: the lexicon
// JSON, these shapes, and the ArangoDB `relations` / `senses` / `relationEdges`
// collections move together.
//
// A relation is a standalone, symmetric assertion between two sets of senses.
// It is not a field on either entry, so the two directions cannot disagree and
// neither entry is republished when a relation is added. Both sides address
// senses precisely, which is what makes indirect translation meaning-preserving:
// a chain through an intermediate language passes through one sense of the
// intermediate word, never through the word as a whole.
//
// See docs/design/semantic-network.md for the reasoning behind every decision
// named in these comments.

import { isValidLanguageTag } from "./bcp47.js";
import { ENTRY_DEFINITIONS_MAX_DEPTH, isLeafPlace, type EntryDefinition } from "./entry.js";

/** AT Proto collection NSID for semantic relation records. */
export const LEKSIS_RELATION_COLLECTION = "eu.leksis.relation";

/**
 * What a relation asserts.
 *
 * `equivalence` covers translation *and* synonymy: a synonym is a translation
 * whose two languages are equal, so there is no separate relation for it.
 * `antonym` is stored and displayed but never traversed when chaining
 * translations — an antonym step inverts meaning.
 *
 * Cognates and etymological links are deliberately absent: they relate words,
 * not senses, and belong to their own lexicons at a different altitude.
 */
export type RelationKind = "equivalence" | "antonym";

/**
 * Resolve a record's `kind` to a known relation kind, or null when the value is
 * one this version of Leksis does not know.
 *
 * Absent (and empty) means `equivalence`; the string "equivalence" is accepted
 * as the explicit spelling of the same thing, so the two spellings converge
 * here and nowhere else has to care. An unknown kind returns **null rather than
 * throwing**: such a relation is still indexed and shown, it is only kept out of
 * traversal, so a kind added by a future version (or by another AppView) can
 * never silently corrupt translation results.
 */
export function normalizeRelationKind(kind: string | undefined | null): RelationKind | null {
  if (kind === undefined || kind === null || kind === "") return "equivalence";
  if (kind === "equivalence") return "equivalence";
  if (kind === "antonym") return "antonym";
  return null;
}

/** Whether a kind may be crossed when chaining translations across languages. */
export function isTraversableKind(kind: RelationKind | null): boolean {
  return kind === "equivalence";
}

/**
 * One end of a relation: which senses, of which entry version, in which
 * language.
 */
export interface RelationSide {
  /**
   * AT URI of the eu.leksis.entry record **version** this side refers to.
   * A version, deliberately: pinning it is what lets the AppView notice that
   * the entry's tree has since been restructured and withhold the relation
   * rather than silently point it at a different meaning. Never an entryKey.
   */
  entry: string;
  /** BCP 47 tag of this side's language, lowercase. Denormalized for legibility. */
  languageID: string;
  /**
   * Which senses this side refers to, as an address in the entry's definition
   * tree. Empty = every sense of the entry (see canonicalizePlacePrefix).
   */
  place: number[];
  /**
   * The entry's canonical spelling when the relation was authored. Display
   * fallback only — never matched on, and harmlessly stale after a re-spelling.
   */
  orthography?: string;
}

/**
 * The eu.leksis.relation record as written to a user's PDS.
 * Records prove authorship, not ownership: a record with a `subject` reference
 * is a proposed new version of the relation that record belongs to. The AppView
 * keeps the latest version current and archives earlier ones.
 */
export interface LeksisRelationRecord {
  $type: typeof LEKSIS_RELATION_COLLECTION;
  /** Absent means equivalence. See normalizeRelationKind. */
  kind?: string;
  /** Exactly two, in no meaningful order — the relation is symmetric. */
  sides: [RelationSide, RelationSide];
  /** Free-text remarks about the assertion itself. Record-only content. */
  notes?: string[];
  /** AT URI of the relation record version this modifies; absent for a new relation. */
  subject?: string;
  createdAt: string;
}

/**
 * Reduce a place to its canonical form: the sequence of its non-zero indices.
 *
 * Zeros are padding in the entry's place model — a non-last 0 means "no
 * grouping at that dimension" and a trailing 0 marks a group node — and display
 * already skips them, so [0,2,0] (the group "II."), [2,0] and [2] are one
 * address. Canonicalizing makes that identity structural instead of a matching
 * special case, and the result never ends in 0.
 *
 * The empty array is the canonical form of "every sense of the entry".
 */
export function canonicalizePlacePrefix(place: readonly number[]): number[] {
  return place.filter((n) => n !== 0);
}

/**
 * A well-formed place prefix: 0–3 non-negative integers. Unlike an entry's
 * `place`, an empty array is valid and means the whole entry — the strongest
 * and least precise claim a side can make, which is why it is written
 * explicitly rather than by omitting the field.
 */
export function isValidPlacePrefix(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length <= ENTRY_DEFINITIONS_MAX_DEPTH &&
    value.every((n) => Number.isInteger(n) && n >= 0)
  );
}

/**
 * Canonical string form of a place, for document keys and set comparison:
 * the non-zero indices joined with dots ("2.1"). The empty place — the whole
 * entry — is the empty string, which is why it is never used as a sense key.
 */
export function placePathKey(place: readonly number[]): string {
  return canonicalizePlacePrefix(place).join(".");
}

/**
 * Key of a sense vertex: the entry's stable key and the sense's canonical
 * place, e.g. "br-gwerzenn-1b76.2.1". Deterministic on purpose — re-anchoring
 * a relation after an entry version transition is then a pure key computation,
 * with no lookup of the sense row itself.
 *
 * ArangoDB's `_key` charset allows the dot, and both halves are already
 * constrained to it: an entryKey is ASCII-slugged at minting and a place is
 * integers.
 */
export function senseKey(entryKey: string, place: readonly number[]): string {
  return `${entryKey}.${placePathKey(place)}`;
}

/**
 * The canonical places of a definition list's leaves — what an entry document
 * caches as `places`, and the only thing relation ingest needs from an entry's
 * content. Group nodes are absent: a heading is not a sense.
 *
 * **Deduplicated**, because canonicalization can collapse two raw places onto
 * one address: a defective-but-valid record may carry both `[1]` and `[0,1]`,
 * which display identically and are therefore one sense here. Two leaves
 * sharing an address share a vertex — the same over-matching, safe-failure
 * behaviour `placePrefixMatches` documents.
 */
export function collectLeafPlaces(definitions: readonly EntryDefinition[]): number[][] {
  const byKey = new Map<string, number[]>();
  for (const def of definitions) {
    if (!isLeafPlace(def.place)) continue;
    const place = canonicalizePlacePrefix(def.place);
    byKey.set(place.join("."), place);
  }
  return [...byKey.values()];
}

/**
 * Whether two sets of leaf places are the same set — the drift comparison of
 * **pin to the version, compare the subtree, park what drifted**.
 *
 * Order is irrelevant and both sides are canonicalized, so a record
 * re-serialized with padded places compares equal. The comparison is
 * deliberately **structure-only**: definition texts are not in the database,
 * and a typo fix must not park a translation. An in-place rewrite that changes
 * a sense's meaning without changing the tree therefore goes unnoticed — an
 * accepted residual, priced when voting can score it.
 */
export function leafSetsEqual(
  a: readonly (readonly number[])[],
  b: readonly (readonly number[])[],
): boolean {
  const keysA = new Set(a.map(placePathKey));
  const keysB = new Set(b.map(placePathKey));
  if (keysA.size !== keysB.size) return false;
  for (const key of keysA) if (!keysB.has(key)) return false;
  return true;
}

/**
 * Whether a prefix addresses a given definition leaf — true when the prefix,
 * canonically, is a prefix of (or equal to) the leaf's canonical place. An
 * empty prefix matches every leaf.
 *
 * Both arguments are canonicalized here, so callers may pass raw record places.
 *
 * Note the one degenerate case: a defective entry can carry both a top-level
 * leaf and a group node that display identically (e.g. [1] and [0,1,0]), and a
 * prefix then matches both. It over-matches rather than guessing, which the
 * coarse flag on the resulting edges reflects — the safe failure, consistent
 * with how an unplaceable form falls back to the flat list rather than being
 * dropped.
 */
export function placePrefixMatches(prefix: readonly number[], leafPlace: readonly number[]): boolean {
  const p = canonicalizePlacePrefix(prefix);
  const leaf = canonicalizePlacePrefix(leafPlace);
  if (p.length > leaf.length) return false;
  return p.every((n, i) => n === leaf[i]);
}

/**
 * The leaves a side refers to: every one of the entry version's leaf places
 * matched by the prefix, canonicalized. This is the expansion the AppView
 * performs at ingest, and it is what dissolves the containment question — two
 * relations referring to overlapping sense sets of the same entry come out
 * sharing leaves, so the graph needs no edges between a group and its senses.
 *
 * `leafPlaces` are the entry version's definition leaves (its cached `places`).
 */
export function expandPlacePrefix(
  prefix: readonly number[],
  leafPlaces: readonly (readonly number[])[],
): number[][] {
  return leafPlaces
    .filter((leaf) => placePrefixMatches(prefix, leaf))
    .map((leaf) => canonicalizePlacePrefix(leaf));
}

/**
 * Whether a reference is **coarse**: it resolved to more than one sense, so it
 * asserts that every one of them corresponds to the other side.
 *
 * That is sometimes exactly right (genuine full equivalence) and sometimes an
 * author — often a bulk-importing bot — declining to be precise. The AppView
 * cannot tell them apart and does not try: the edges are kept, flagged, ranked
 * below precise ones and disclosed in the path. Blocking them would discard
 * translations that are usually correct; hiding the imprecision would hand the
 * reader a confident wrong answer.
 */
export function isCoarseExpansion(leaves: readonly (readonly number[])[]): boolean {
  return leaves.length > 1;
}

/**
 * Cap on the edges one relation may produce (the product of its two sides'
 * expansions). A relation above this is indexed and parked as `oversize`
 * rather than flooding the graph — an all-senses-to-all-senses claim between
 * two large polysemous entries carries almost no information anyway.
 */
export const MAX_RELATION_EDGES = 256;

/**
 * Lifecycle state of an indexed relation version. Only `live` relations have
 * edges in the graph: a relation the AppView cannot currently vouch for is
 * withheld from results and surfaced on a repair worklist instead, because a
 * wrong translation is worse than a missing one.
 *
 *  - `live`        — both sides resolve and still match their pinned versions
 *  - `stale`       — an entry has been restructured since the side pinned it
 *  - `unresolved`  — a side's entry version is not (or no longer) indexed
 *  - `oversize`    — the expansion exceeds MAX_RELATION_EDGES
 */
export type RelationState = "live" | "stale" | "unresolved" | "oversize";

/**
 * Whole-record validation, mirroring validateDefinitions: returns a machine
 * code so the editor and the API report the same failure, with `ok` the sole
 * success value.
 *
 * Rules:
 *  - exactly two sides ("sides");
 *  - each side's `entry` is an AT URI ("entry-uri");
 *  - each side's `languageID` is a well-formed BCP 47 tag ("language");
 *  - each side's `place` is a well-formed prefix ("place");
 *  - the two sides do not address the same senses of the same entry ("self").
 *
 * An unknown `kind` is deliberately NOT a failure — it parks (see
 * normalizeRelationKind). Nor is a side pointing at an entry this AppView has
 * never seen: that is resolved at ingest and parks as `unresolved`, since
 * records arrive from the firehose in arbitrary order.
 */
export type RelationError = "sides" | "entry-uri" | "language" | "place" | "self";

/**
 * One end of a relation as the API serves it: what the record said, plus what
 * the AppView resolved it to.
 *
 * `orthography` comes from the referenced entry's current version and is the
 * one to display; `recordedOrthography` is the record's own denormalized
 * spelling and exists for exactly one case — a side whose entry cannot be
 * resolved, where it is all a worklist has to print.
 */
export interface RelationSideView {
  /** null when this side's entry is not (or no longer) indexed. */
  entryKey: string | null;
  languageID: string;
  /** The canonical place prefix the record named; [] = the whole entry. */
  place: number[];
  /** Canonical spelling of the entry's current version; null when unresolved. */
  orthography: string | null;
  /** The spelling the record carried; null when it carried none. */
  recordedOrthography: string | null;
}

/**
 * One relation version as served. Definition texts and the relation's own
 * `notes` are absent by design: the client resolves the record from its
 * author's PDS, exactly as it does for an entry.
 */
export interface RelationView {
  relationKey: string;
  /** null = equivalence; "antonym"; or a kind this AppView does not know. */
  kind: string | null;
  state: RelationState;
  /** at:// URI of this version's record — the client resolves it for the notes. */
  recordURI: string;
  authorDID: string;
  indexedAt: string;
  /**
   * The two sides. Where the request is about one entry or one language, that
   * one is `sides[0]`, so a reader never has to work out which end is theirs.
   */
  sides: [RelationSideView, RelationSideView];
}

/** Response shape of GET /entries/:key/relations. */
export interface EntryRelationsResponse {
  entryKey: string;
  /**
   * The relations this entry can currently be shown with, in reading order of
   * its own senses. Whole-entry relations (`sides[0].place` empty) sort first
   * and belong on the entry header.
   */
  relations: RelationView[];
  /**
   * Parked relations touching this entry — the repair strip. A relation is
   * here rather than absent because **a wrong translation is worse than a
   * missing one**: it is withheld from results and shown as work to do.
   */
  parked: RelationView[];
}

/**
 * One hop of a translation path: a word the chain passed through, or the word
 * it ended at.
 */
export interface TranslationHop {
  entryKey: string;
  languageID: string;
  /** Canonical spelling of the hop's current entry version. */
  orthography: string;
  /** The sense the path travelled through — its canonical place. */
  place: number[];
  /**
   * Whether **either** assertion touching this word — the one that reached it
   * or the one the path left by — covered every sense of it rather than the one
   * named. Both count: from the reader's side either is the same unchecked
   * assumption, and it is precisely the one they would want to check ("via
   * *vers*, all senses").
   */
  coarse: boolean;
}

/**
 * One sense of a target entry, with the provenance of **its own** best path.
 *
 * Provenance is per sense rather than per entry because two senses of one word
 * can be reached by very different chains — one direct and precise, another
 * three coarse hops away. A single badge for the entry would describe the best
 * of them and silently vouch for the rest.
 */
export interface TranslationSense {
  /** The target sense's canonical place. */
  place: number[];
  /** Hops on this sense's shortest path; 1 = a direct assertion. */
  hops: number;
  /** Coarse hops on that path. */
  coarseHops: number;
  /**
   * The intermediate words of that path, in order — empty for a direct
   * assertion. The trust surface: until voting exists, *how* a translation was
   * reached is the only quality signal a reader has.
   */
  via: TranslationHop[];
  /**
   * Whether the assertion that reached this sense covered every sense of the
   * target entry — the final hop's own coarseness, which no `via` entry carries.
   */
  coarse: boolean;
}

/** One target entry reached from one sense of the source entry. */
export interface TranslationTarget {
  entryKey: string;
  languageID: string;
  orthography: string[];
  /** at:// URI of the current record — the client resolves it for the content. */
  recordURI: string;
  authorDID: string;
  /** The senses reached, in reading order, each with its own provenance. */
  senses: TranslationSense[];
  /** Best hop count over `senses` — the first ranking key. */
  hops: number;
  /** Coarse hops on that same best path — the second ranking key. */
  coarseHops: number;
}

/**
 * The target entries reached from one sense of the source entry.
 *
 * **A result is reported relative to the sense you searched from**, so a sense
 * with no equivalent in the target language is present with an empty `targets`
 * list rather than omitted: that is what makes partial coverage legible
 * without a "partial" flag.
 */
export interface TranslationSenseGroup {
  /** The source sense's canonical place. */
  place: number[];
  targets: TranslationTarget[];
}

/** One source entry matching the query. */
export interface TranslationEntry {
  entryKey: string;
  languageID: string;
  orthography: string[];
  recordURI: string;
  authorDID: string;
  /** One group per sense of the entry, in reading order. */
  senses: TranslationSenseGroup[];
}

/** Response shape of GET /translate?q=&from=&to=&depth=. */
export interface TranslateResponse {
  query: string;
  from: string;
  to: string;
  /** The depth actually used, after clamping. */
  depth: number;
  entries: TranslationEntry[];
}

/**
 * Default and maximum traversal depth. A translation is not a transit station:
 * every hop is another author's judgement, so the chain is kept short, and the
 * server caps what a client may ask for.
 */
export const TRANSLATE_DEFAULT_DEPTH = 3;
export const TRANSLATE_MAX_DEPTH = 5;

export function validateRelation(
  record: Pick<LeksisRelationRecord, "sides">,
): RelationError | "ok" {
  const sides = record.sides;
  if (!Array.isArray(sides) || sides.length !== 2) return "sides";

  for (const side of sides) {
    if (typeof side?.entry !== "string" || !side.entry.startsWith("at://")) return "entry-uri";
    if (typeof side.languageID !== "string" || !isValidLanguageTag(side.languageID)) {
      return "language";
    }
    if (!isValidPlacePrefix(side.place)) return "place";
  }

  const [a, b] = sides;
  if (a.entry === b.entry) {
    const pa = canonicalizePlacePrefix(a.place).join(",");
    const pb = canonicalizePlacePrefix(b.place).join(",");
    if (pa === pb) return "self";
  }

  return "ok";
}
