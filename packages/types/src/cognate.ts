// Contract for the eu.leksis.cognate lexicon (lexicons/eu.leksis.cognate.json)
// and the cognate network built from it. Types are the contract: the lexicon
// JSON, these shapes, and the ArangoDB `cognates` / `lexemes` / `cognateEdges`
// collections move together.
//
// A cognate is a standalone, symmetric assertion that two words share a
// historical origin. It is the *word*-level sibling of eu.leksis.relation: same
// record pattern (symmetric record → derived edges, versioned by `subject`,
// last-write-wins), one altitude up. Where a relation joins senses — because a
// translation chained through a word as a whole would drift in meaning — a
// cognate joins whole entries, because every sense of a word shares its history.
//
// What it deliberately does NOT carry is direction or mechanism. Inherited,
// borrowed, calqued and derived blur into one another, and a word's history is
// a chain of forms across historical languages carrying dates, uncertainty and
// disagreement between sources; formalizing that would encode false precision
// and read worse than the paragraph it replaced. So the story stays prose on the
// entry (`LeksisEntryRecord.etymology`) and only the machine-checkable half —
// "these two share an origin" — becomes a record. That half is the one worth
// having as a graph: how densely two languages' words link is itself evidence of
// how related those languages are.
//
// See docs/adr/0013-cognates-and-etymology.md for the reasoning.

import { isValidLanguageTag } from "./bcp47.js";

/** AT Proto collection NSID for cognate records. */
export const LEKSIS_COGNATE_COLLECTION = "eu.leksis.cognate";

/**
 * One end of a cognate: which word, in which language.
 *
 * Note what is absent next to RelationSide: there is no `place`. A cognate
 * addresses the lexeme, so there is no sense to name — and consequently none of
 * the expansion, coarseness or drift machinery relations need.
 */
export interface CognateSide {
  /**
   * AT URI of the eu.leksis.entry record **version** this side refers to.
   *
   * A version rather than an identity for the same reason a relation pins one:
   * an entryKey is AppView-minted and meaningless off this index, so a record
   * must reference the network. But unlike a relation the pin carries no drift
   * semantics — every version of an entry is the same word — so the AppView
   * resolves the version to its entry and follows it forward.
   */
  entry: string;
  /** BCP 47 tag of this side's language, lowercase. Denormalized for legibility. */
  languageID: string;
  /**
   * The entry's canonical spelling when the cognate was authored. Display
   * fallback only — never matched on, and harmlessly stale after a re-spelling.
   */
  orthography?: string;
}

/**
 * The eu.leksis.cognate record as written to a user's PDS.
 * Records prove authorship, not ownership: a record with a `subject` reference
 * is a proposed new version of the cognate that record belongs to. The AppView
 * keeps the latest version current and archives earlier ones.
 */
export interface LeksisCognateRecord {
  $type: typeof LEKSIS_COGNATE_COLLECTION;
  /** Exactly two, in no meaningful order — cognacy is symmetric. */
  sides: [CognateSide, CognateSide];
  /**
   * Free-text remarks about the assertion itself — a source, a caveat that the
   * cognacy is contested, a mechanism worth naming even though the record does
   * not encode one. Record-only content, never indexed.
   */
  notes?: string[];
  /** AT URI of the cognate record version this modifies; absent for a new cognate. */
  subject?: string;
  createdAt: string;
}

/**
 * Lifecycle state of an indexed cognate version. Only `live` cognates have an
 * edge in the graph, on the same principle as relations: a claim the AppView
 * cannot currently vouch for is withheld from the network and surfaced as work
 * to do instead.
 *
 *  - `live`       — both sides resolve to an entry that is currently readable
 *  - `unresolved` — a side's entry version is not (or no longer) indexed, so
 *                   the cognate cannot be placed. Records arrive from the
 *                   firehose in arbitrary order, so this is routinely temporary
 *  - `stale`      — both sides resolve, but the assertion must not be served.
 *                   Two causes. Either an entry's current version is withdrawn
 *                   (`deleted`) — parked rather than followed, and `redirectTo`
 *                   deliberately NOT followed, since re-pointing somebody's
 *                   historical claim at a different word is an editorial act,
 *                   not an index repair (ADR-0011's identical ruling for
 *                   relations). Or both sides resolved to the *same entry*,
 *                   which validation cannot catch because two versions of one
 *                   entry are two distinct record URIs — and a word shares an
 *                   origin with itself trivially, so the claim carries nothing
 *
 * There is no `oversize`: a cognate always yields exactly one edge.
 */
export type CognateState = "live" | "unresolved" | "stale";

/**
 * Whole-record validation, mirroring validateRelation: returns a machine code so
 * the editor and the API report the same failure, with `ok` the sole success
 * value.
 *
 * Rules:
 *  - exactly two sides ("sides");
 *  - each side's `entry` is an AT URI ("entry-uri");
 *  - each side's `languageID` is a well-formed BCP 47 tag ("language");
 *  - the two sides do not name the same record ("self").
 *
 * Two things are deliberately NOT failures here. A side pointing at an entry
 * this AppView has never seen parks as `unresolved` at ingest. And two sides
 * naming *different versions of the same entry* cannot be caught from URIs
 * alone — it needs the index — so it is ingest's job to drop it once both sides
 * resolve to one entryKey; asserting that a word shares an origin with itself
 * says nothing.
 *
 * Note that two sides sharing a *language* is valid and expected: a doublet —
 * two words of one language descended from one origin by different routes — is
 * an ordinary cognate pair.
 */
export type CognateError = "sides" | "entry-uri" | "language" | "self";

export function validateCognate(
  record: Pick<LeksisCognateRecord, "sides">,
): CognateError | "ok" {
  const sides = record.sides;
  if (!Array.isArray(sides) || sides.length !== 2) return "sides";

  for (const side of sides) {
    if (typeof side?.entry !== "string" || !side.entry.startsWith("at://")) return "entry-uri";
    if (typeof side.languageID !== "string" || !isValidLanguageTag(side.languageID)) {
      return "language";
    }
  }

  const [a, b] = sides;
  if (a.entry === b.entry) return "self";

  return "ok";
}

/**
 * One end of a cognate as the API serves it: what the record said, plus what the
 * AppView resolved it to.
 *
 * `orthography` comes from the referenced entry's current version and is the one
 * to display; `recordedOrthography` is the record's own denormalized spelling
 * and exists for exactly one case — a side whose entry cannot be resolved, where
 * it is all a worklist has to print.
 */
export interface CognateSideView {
  /** null when this side's entry is not (or no longer) indexed. */
  entryKey: string | null;
  languageID: string;
  /** Canonical spelling of the entry's current version; null when unresolved. */
  orthography: string | null;
  /** The spelling the record carried; null when it carried none. */
  recordedOrthography: string | null;
}

/**
 * One cognate version as served. The cognate's own `notes` are absent by design:
 * the client resolves the record from its author's PDS, exactly as it does for
 * an entry or a relation.
 */
export interface CognateView {
  cognateKey: string;
  state: CognateState;
  /** at:// URI of this version's record — the client resolves it for the notes. */
  recordURI: string;
  authorDID: string;
  indexedAt: string;
  /**
   * The two sides. Where the request is about one entry, that one is `sides[0]`,
   * so a reader never has to work out which end is theirs.
   */
  sides: [CognateSideView, CognateSideView];
}

/**
 * One word in a cognate network: a node of the connected component, not merely
 * a direct cognate of the entry that was asked for.
 *
 * This is the one place the cognate network diverges from the semantic network's
 * read model rather than mirroring it. A translation is served as a ranked
 * answer to a question ("what is this in Welsh?"), so the traversal is pruned at
 * a target language and the path is provenance. A cognate network has no target
 * and no answer: the *shape of the whole component* is the thing worth seeing,
 * because that shape is the evidence about how the languages relate. So the
 * endpoint returns the component and the client draws it.
 */
export interface CognateNode {
  entryKey: string;
  languageID: string;
  orthography: string[];
  /** at:// URI of the current record — the client resolves it for the content. */
  recordURI: string;
  authorDID: string;
  /**
   * Assertions between this word and the one the network was requested for;
   * 0 for that word itself, 1 for a directly asserted cognate.
   *
   * Distance is a display concern, not a truth claim: a word two hops away is
   * not "less cognate", it is only related through somebody else's assertion.
   * The UI uses it to distinguish the direct claims — the ones this entry's
   * authors made — from the rest of the component.
   */
  distance: number;
}

/**
 * One asserted cognate pair inside a served network — an edge of the graph the
 * client draws.
 *
 * Called a link rather than an edge so that "edge" keeps meaning the ArangoDB
 * row: several current cognate records may assert the same pair, and each is its
 * own link here (parallel assertions are evidence, and collapsing them would
 * hide how many people independently claimed the pair).
 */
export interface CognateLink {
  cognateKey: string;
  /** entryKeys of the two words, in the order the record named them. */
  sides: [string, string];
  /** at:// URI of the current record — the client resolves it for the notes. */
  recordURI: string;
  authorDID: string;
}

/** Response shape of GET /entries/:key/cognates. */
export interface CognateNetworkResponse {
  entryKey: string;
  /**
   * Every word in the connected component, including the requested entry
   * (`distance` 0). Empty only when the entry has no live cognate at all.
   */
  nodes: CognateNode[];
  /** Every assertion between two nodes above. */
  links: CognateLink[];
  /**
   * Parked cognates touching **this** entry — the repair strip, and the reason
   * a contributor learns that a cognate they authored has fallen out of the
   * network. Parked cognates of other words in the component are not served:
   * they are that entry's worklist, not this one's.
   */
  parked: CognateView[];
  /**
   * True when the component was cut short at MAX_COGNATE_NETWORK_NODES. The
   * served graph is then a valid neighbourhood but not the whole component, and
   * the UI must say so rather than let a reader believe they see everything.
   */
  truncated: boolean;
}

/**
 * Caps on one served network. A cognate component is unbounded in principle —
 * one well-attested Indo-European root could eventually link thousands of
 * entries — and the endpoint computes it per request with no stored component,
 * so the traversal is bounded on both axes and reports when it cut.
 */
export const MAX_COGNATE_NETWORK_NODES = 500;
export const MAX_COGNATE_NETWORK_DEPTH = 20;
