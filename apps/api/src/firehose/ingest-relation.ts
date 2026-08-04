import { createHash } from "node:crypto";
import { aql, type Database } from "arangojs";
import {
  canonicalizePlacePrefix,
  expandPlacePrefix,
  isCoarseExpansion,
  isTraversableKind,
  leafSetsEqual,
  MAX_RELATION_EDGES,
  normalizeLanguageTag,
  normalizeRelationKind,
  placePathKey,
  senseKey,
  validateRelation,
  type RelationSide,
  type RelationState,
} from "@leksis/types";
import { db } from "../db";
import type { IngestResult } from "./ingest-language";

// Decomposition of eu.leksis.relation records into the semantic network.
//
// **The record is the truth; the edge is its shadow.** Three collections:
//
// - `relations` — versioned mirror, one doc per relation version, exactly as
//   `entries` works (many docs per relationKey, one current, archival on
//   supersession, removal when the record leaves its author's PDS).
// - `senses` — derived vertices, one per definition leaf of every current entry
//   version. **The vertex is the sense**, which is what makes indirect
//   translation meaning-preserving: a path enters and leaves an intermediate
//   word through the *same* sense, so Breton "gwerzenn" reached through the
//   "verse" sense of French "vers" can never continue into its "worms" sense.
// - `relationEdges` — derived edges, the cartesian product of the two sides'
//   expanded sense sets, written only for relations the AppView can currently
//   vouch for.
//
// The two derived collections are rebuildable from `relations` + `entries` and
// so may be emptied and rewritten freely (the `labels` precedent). Relation
// *content* — the notes on the assertion — stays on the record, like definition
// texts: the AppView indexes shape and pointers, never content.
//
// Functions that touch the database take it explicitly, as the labels model's
// do, so db:init can drive them on its own connection.
//
// See docs/design/semantic-network.md for the reasoning; decisions referred to
// by name below are that note's.

/** One end of a relation as indexed: the record's claim, plus what it resolved to. */
interface RelationSideDoc {
  /** at:// URI of the pinned entry record version, from the record. */
  recordURI: string;
  /** Stable key of the entry that version belongs to; null while unresolved. */
  entryKey: string | null;
  /**
   * BCP 47 tag of this side's language. Seeded from the record (which
   * denormalizes it for legibility) and **replaced by the resolved entry's own
   * language** — the record stays the truth about the assertion, but this index
   * should not repeat a claim it can verify, or a parked relation would queue
   * on a dashboard whose language it is not actually in.
   */
  languageID: string;
  /** The canonical place prefix this side refers to; [] = every sense. */
  place: number[];
  /**
   * The canonical spelling the record carried. Display fallback only, never
   * matched on: it is the one thing a worklist can print for a side whose entry
   * this AppView cannot resolve, which is precisely when it is needed.
   */
  orthography: string | null;
  /**
   * The prefix expanded against the **pinned** version's tree, cached at
   * ingest so the drift comparison never needs an entry doc that has since
   * been archived or deleted.
   */
  leafPlaces: number[][];
  /**
   * Whether this side's prefix resolved to more than one sense — so the
   * assertion covers all of them. **Coarseness is recorded, not blocked.**
   */
  coarse: boolean;
}

/** One relation version as indexed. */
interface RelationDoc {
  /** Stable relation identity across versions. */
  relationKey: string;
  /**
   * What the relation asserts: null for equivalence (translation *or*
   * synonymy), "antonym", or a value this version of Leksis does not know —
   * kept verbatim, indexed and displayed, never traversed.
   */
  kind: string | null;
  sides: [RelationSideDoc, RelationSideDoc];
  state: RelationState;
  recordURI: string;
  cid: string;
  authorDID: string;
  createdAt: string;
  indexedAt: string;
  current: boolean;
}

type StoredRelation = RelationDoc & { _key: string };

/** What a relation record contributes to the index; content fields are dropped. */
interface ParsedRelation {
  kind: string | null;
  sides: [RelationSide, RelationSide];
  subject: string | null;
  createdAt: string;
}

/** A sense row: one definition leaf of a current entry version. */
interface SenseDoc {
  _key: string;
  entryKey: string;
  languageID: string;
  place: number[];
}

async function queryOne<T>(database: Database, query: ReturnType<typeof aql>): Promise<T | null> {
  const cursor = await database.query<T>(query);
  return (await cursor.next()) ?? null;
}

/** Write documents in bounded batches, so one dictionary is not one giant request. */
const INSERT_BATCH = 2000;

/**
 * Validate an incoming record (unknown shape — anyone can put anything on
 * their PDS) and return only what the index keeps. Rejected whole when
 * malformed, so a relation never half-loads.
 *
 * Two things are deliberately *not* rejections. An unknown `kind` is kept: it
 * is indexed and shown, and only withheld from traversal, so a kind a later
 * version (or another AppView) introduces cannot silently corrupt translation
 * results. A side pointing at an entry this AppView has never seen is resolved
 * later, not refused — Jetstream delivers records in arbitrary order, so a
 * relation legitimately arrives before its entry.
 */
function parseRecord(recordURI: string, record: unknown): ParsedRelation | null {
  if (typeof record !== "object" || record === null) return null;
  const r = record as Record<string, unknown>;

  if (!Array.isArray(r.sides) || r.sides.length !== 2) return null;
  const sides: RelationSide[] = [];
  for (const item of r.sides) {
    if (typeof item !== "object" || item === null) return null;
    const s = item as Record<string, unknown>;
    if (typeof s.entry !== "string") return null;
    if (typeof s.languageID !== "string") return null;
    const languageID = normalizeLanguageTag(s.languageID);
    let orthography: string | undefined;
    if (s.orthography !== undefined) {
      if (typeof s.orthography !== "string") return null;
      const trimmed = s.orthography.trim();
      if (trimmed !== "") orthography = trimmed;
    }
    sides.push({
      entry: s.entry,
      languageID,
      // Shape-checked by validateRelation immediately below.
      place: s.place as number[],
      ...(orthography !== undefined ? { orthography } : {}),
    });
  }

  const pair = sides as [RelationSide, RelationSide];
  const error = validateRelation({ sides: pair });
  if (error !== "ok") {
    console.warn(`firehose: relation ${recordURI} is invalid (${error})`);
    return null;
  }

  let kind: string | null = null;
  if (r.kind !== undefined) {
    if (typeof r.kind !== "string") return null;
    // The explicit spelling of the default converges on the default: the doc
    // stores null for equivalence however the record wrote it, so nothing
    // downstream has to know there are two spellings.
    kind = normalizeRelationKind(r.kind) === "equivalence" ? null : r.kind;
  }

  // Notes are free prose about the assertion — record-only content. Validated
  // so a malformed record is rejected whole, then dropped.
  if (r.notes !== undefined) {
    if (!Array.isArray(r.notes)) return null;
    for (const item of r.notes) if (typeof item !== "string") return null;
  }

  let subject: string | null = null;
  if (r.subject !== undefined) {
    if (typeof r.subject !== "string" || !r.subject.startsWith("at://")) return null;
    subject = r.subject;
  }

  const createdAt = typeof r.createdAt === "string" ? r.createdAt : new Date().toISOString();
  return { kind, sides: pair, subject, createdAt };
}

/**
 * Mint a stable relation key: `{langA}-{langB}-{hash}` with the two tags
 * sorted, e.g. "br-fr-1b76" — same convention and collision handling as
 * `entryKey`. Sorting the tags keeps the key symmetric, like the relation
 * itself. Callers must first look the record URI up (see relationKeyForRecord):
 * minting is only for a record this index has never seen.
 */
async function mintRelationKey(
  database: Database,
  languages: [string, string],
  recordURI: string,
): Promise<string> {
  const slug = (tag: string) => tag.replace(/[^a-z0-9-]/g, "").slice(0, 16);
  const [a, b] = [...languages].sort();
  const hash = createHash("sha256").update(recordURI).digest("hex");

  for (let len = 4; len <= hash.length; len += 4) {
    const key = [slug(a!), slug(b!), hash.slice(0, len)].filter(Boolean).join("-");
    const taken = await queryOne<boolean>(
      database,
      aql`RETURN LENGTH(FOR r IN relations FILTER r.relationKey == ${key} LIMIT 1 RETURN 1) > 0`,
    );
    if (!taken) return key;
  }
  throw new Error(`could not mint a unique relation key for ${recordURI}`);
}

/**
 * The relation a record URI already belongs to, across **all** versions —
 * current or archived.
 *
 * This lookup is what makes ingestion replay-safe. Jetstream's cursor is saved
 * every few seconds and a reconnect resumes from it, so a create commit is
 * routinely delivered twice; if the record's own version has since been
 * archived by a correction, a lookup restricted to `current` finds nothing, and
 * minting would then hand the same record a *second* identity whose hash is
 * merely extended past the collision — a phantom relation with a duplicate set
 * of edges that no later event repairs.
 */
async function relationKeyForRecord(database: Database, recordURI: string): Promise<string | null> {
  return queryOne<string>(
    database,
    aql`FOR r IN relations FILTER r.recordURI == ${recordURI} LIMIT 1 RETURN r.relationKey`,
  );
}

/** The entry index, as anchoring reads it. */
interface PinnedEntry {
  entryKey: string;
  languageID: string;
  places: number[][] | null;
}
interface CurrentEntry {
  languageID: string;
  places: number[][] | null;
  deleted: boolean;
}

/**
 * How anchoring reads the entry index. The consumer queries per side; the
 * wholesale rebuild pre-loads every current entry and answers from memory,
 * which is what keeps a deploy's rebuild to a handful of round trips instead of
 * one per relation.
 */
interface EntryLookup {
  /** The version at a record URI — any version, current or archived. */
  pinned(recordURI: string): Promise<PinnedEntry | null>;
  /** The entry's current version. */
  current(entryKey: string): Promise<CurrentEntry | null>;
}

function dbLookup(database: Database): EntryLookup {
  return {
    /**
     * A republished record keeps its URI, so several versions can share one:
     * the most recently indexed is the one that URI now stands for.
     */
    pinned: (recordURI) =>
      queryOne<PinnedEntry>(
        database,
        aql`
          FOR e IN entries
            FILTER e.recordURI == ${recordURI}
            SORT e.indexedAt DESC
            LIMIT 1
            RETURN { entryKey: e.entryKey, languageID: e.languageID, places: e.places }
        `,
      ),
    current: (entryKey) =>
      queryOne<CurrentEntry>(
        database,
        aql`
          FOR e IN entries
            FILTER e.entryKey == ${entryKey} AND e.current == true
            LIMIT 1
            RETURN { languageID: e.languageID, places: e.places, deleted: e.deleted == true }
        `,
      ),
  };
}

type SideState = "live" | "stale" | "unresolved";

/**
 * **Pin to the version, compare the subtree, park what drifted** — for one
 * side.
 *
 * Resolves the pinned entry version (once, then cached), expands the prefix
 * against *its* tree, and compares that leaf set with the same prefix expanded
 * against the entry's **current** version. Identical → this side is live;
 * different → the entry was restructured under the assertion, so it parks.
 *
 * The comparison is structure-only by design (see leafSetsEqual): a typo fix
 * must not park a translation.
 */
async function anchorSide(
  lookup: EntryLookup,
  side: RelationSideDoc,
): Promise<{ side: RelationSideDoc; state: SideState }> {
  let entryKey = side.entryKey;
  let languageID = side.languageID;
  let leafPlaces = side.leafPlaces;
  let coarse = side.coarse;
  const out = (state: SideState) => ({
    side: { ...side, entryKey, languageID, leafPlaces, coarse },
    state,
  });

  // An empty expansion means the pin has never resolved *or* resolved to
  // nothing, and both are worth retrying: the entry may have arrived since,
  // or been republished with the tree the prefix expects.
  if (leafPlaces.length === 0) {
    const pinned = await lookup.pinned(side.recordURI);
    if (!pinned) return out("unresolved");
    entryKey = pinned.entryKey;
    languageID = pinned.languageID;
    // A version indexed before entry docs cached their `places` cannot be
    // expanded at all. It resolves when its author republishes — the
    // sanctioned pre-1.0 backfill — so it parks as unresolved rather than
    // claiming a drift nobody caused.
    if (!pinned.places) return out("unresolved");
    leafPlaces = expandPlacePrefix(side.place, pinned.places);
    coarse = isCoarseExpansion(leafPlaces);
    if (leafPlaces.length === 0) {
      // The prefix addresses no sense of the version it pins: an authoring
      // mistake rather than drift, but repaired the same way — publish a new
      // version whose prefix hits — so it joins the same worklist.
      return out("stale");
    }
  }

  let current = entryKey === null ? null : await lookup.current(entryKey);

  // The cached entryKey can go dead: an entry whose every version was deleted
  // and then republished at the same rkey is indexed under a **new** entryKey
  // while its record URI is unchanged. Re-resolve the pin's *identity* — never
  // its cached expansion, which is what the relation was authored against — so
  // such a relation can leave the worklist instead of parking forever.
  if (!current) {
    const pinned = await lookup.pinned(side.recordURI);
    if (!pinned) return out("unresolved");
    if (pinned.entryKey !== entryKey) {
      entryKey = pinned.entryKey;
      current = await lookup.current(entryKey);
    }
    if (!current) return out("unresolved");
  }

  // The *current* version's language is the truth for display and for which
  // dashboards a parked relation queues on — a re-languaged entry must not
  // leave its edges claiming the old tag.
  languageID = current.languageID;

  // A withdrawn entry offers no senses, so the comparison parks the relation:
  // a withdrawal is precisely a claim that these senses should not be offered.
  // `redirectTo` is deliberately **not** followed — re-pointing an assertion at
  // another entry without its author is the meaning drift this whole mechanism
  // exists to prevent; a human re-affirms it through the editor.
  const currentLeaves =
    current.deleted || !current.places ? [] : expandPlacePrefix(side.place, current.places);

  return out(leafSetsEqual(leafPlaces, currentLeaves) ? "live" : "stale");
}

/**
 * Anchor both sides and combine their verdicts into the relation's state.
 * **Park, never serve**: anything short of `live` has no edges and shows up on
 * a worklist instead, because a wrong translation is worse than a missing one.
 */
async function anchorSides(
  lookup: EntryLookup,
  sides: [RelationSideDoc, RelationSideDoc],
): Promise<{ sides: [RelationSideDoc, RelationSideDoc]; state: RelationState }> {
  const a = await anchorSide(lookup, sides[0]);
  const b = await anchorSide(lookup, sides[1]);
  const anchored: [RelationSideDoc, RelationSideDoc] = [a.side, b.side];

  let state: RelationState;
  if (a.state === "unresolved" || b.state === "unresolved") state = "unresolved";
  else if (a.state === "stale" || b.state === "stale") state = "stale";
  else if (a.side.leafPlaces.length * b.side.leafPlaces.length > MAX_RELATION_EDGES) {
    // An all-senses-to-all-senses claim between two large polysemous entries
    // carries almost no information; it parks instead of flooding the graph.
    state = "oversize";
  } else state = "live";

  return { sides: anchored, state };
}

/** An edge document as stored. */
type RelationEdgeDoc = Record<string, unknown> & { relationKey: string };

/**
 * The edges a relation version contributes: none unless it is live, otherwise
 * one per (leaf under side A × leaf under side B).
 */
function relationEdgeDocs(doc: RelationDoc): RelationEdgeDoc[] {
  if (doc.state !== "live") return [];
  const [a, b] = doc.sides;
  if (a.entryKey === null || b.entryKey === null) return [];

  // Traversability is stored on the edge, rather than left to a query that
  // excludes the kinds it knows are wrong, so that an unknown kind is excluded
  // by default: a translation path may only cross assertions of equivalence.
  const traversable = isTraversableKind(normalizeRelationKind(doc.kind));
  const sameEntry = a.entryKey === b.entryKey;
  const edges: RelationEdgeDoc[] = [];
  for (const leafA of a.leafPlaces) {
    for (const leafB of b.leafPlaces) {
      // Two prefixes on one entry may overlap — `[]` and `[1]`, say — and the
      // pairs where they meet on the same sense would be self-loops. The
      // relation as a whole is meaningful (senses of one entry asserted
      // equivalent is the same-language synonym case), so only the degenerate
      // pairs are dropped, not the record. Validation cannot catch these: it
      // sees prefixes, and expansion is what dissolves them into senses.
      if (sameEntry && placePathKey(leafA) === placePathKey(leafB)) continue;
      edges.push({
        _from: `senses/${senseKey(a.entryKey, leafA)}`,
        _to: `senses/${senseKey(b.entryKey, leafB)}`,
        relationKey: doc.relationKey,
        kind: doc.kind,
        traversable,
        // Aligned with _from/_to, not sorted.
        languages: [a.languageID, b.languageID],
        // Either end imprecise — the ranking signal (**hops first, then
        // coarse hops**).
        coarse: a.coarse || b.coarse,
        // Which end, so the via-chain can name the word whose senses were
        // lumped ("via vers, all senses") rather than only that a hop was
        // imprecise. NOTE for consumers: these are _from/_to-relative while
        // the traversal is ANY, so a reader must compare the edge's `_from`
        // with the vertex it arrived from before choosing between them.
        coarseFrom: a.coarse,
        coarseTo: b.coarse,
      });
    }
  }
  return edges;
}

/** Rewrite one relation's edges in place. Single-writer path (the consumer). */
async function rebuildRelationEdges(database: Database, doc: RelationDoc): Promise<void> {
  await database.query(aql`
    FOR e IN relationEdges
      FILTER e.relationKey == ${doc.relationKey}
      REMOVE e IN relationEdges
  `);
  const edges = relationEdgeDocs(doc);
  if (edges.length > 0) {
    await database.query(aql`FOR e IN ${edges} INSERT e INTO relationEdges`);
  }
}

/** Whether re-anchoring changed anything worth writing. */
function anchorUnchanged(
  doc: RelationDoc,
  sides: [RelationSideDoc, RelationSideDoc],
  state: RelationState,
): boolean {
  if (doc.state !== state) return false;
  return doc.sides.every((before, i) => {
    const after = sides[i]!;
    return (
      before.entryKey === after.entryKey &&
      before.languageID === after.languageID &&
      before.coarse === after.coarse &&
      before.leafPlaces.length === after.leafPlaces.length &&
      leafSetsEqual(before.leafPlaces, after.leafPlaces)
    );
  });
}

/**
 * Re-run the drift comparison for one indexed relation and rewrite its edges.
 * A restructure parks the relation, a reversion revives it — with no record
 * fetched from any PDS and nothing written to anyone's repository.
 */
async function reanchorRelation(database: Database, doc: StoredRelation): Promise<void> {
  const { sides, state } = await anchorSides(dbLookup(database), doc.sides);
  if (anchorUnchanged(doc, sides, state)) return;

  // `stateChangedAt` is when this relation last entered its current state, which
  // is what the repair worklist orders by: a relation that parks today deserves
  // attention today, however old the version that parked is.
  const stateChangedAt = doc.state === state ? undefined : new Date().toISOString();
  await database.query(aql`
    UPDATE ${doc._key}
      WITH ${{ sides, state, ...(stateChangedAt ? { stateChangedAt } : {}) }}
      IN relations
  `);
  await rebuildRelationEdges(database, { ...doc, sides, state });
  console.log(`firehose: relation "${doc.relationKey}" re-anchored ${doc.state} → ${state}`);
}

/**
 * Index a created/updated eu.leksis.relation record. Idempotent on
 * recordURI + cid, and versioned exactly as entries are: `subject` attaches
 * the record to an existing relation, the superseded version is archived, and
 * last write wins across authors — which is what makes a wrong translation
 * fixable by anyone before voting exists, with the version trail voting will
 * need.
 */
export async function ingestRelation(
  authorDID: string,
  recordURI: string,
  cid: string,
  record: unknown,
): Promise<IngestResult> {
  const parsed = parseRecord(recordURI, record);
  if (!parsed) {
    console.warn(`firehose: skipped invalid relation record ${recordURI}`);
    return "skipped-invalid";
  }

  // A subject pointing at a record this AppView never indexed degrades to a
  // new relation rather than being dropped — the entries rule.
  let relationKey: string | null = null;
  if (parsed.subject) {
    relationKey = await relationKeyForRecord(db, parsed.subject);
    if (!relationKey) {
      console.warn(
        `firehose: relation ${recordURI} has unknown subject ${parsed.subject}, indexing as new relation`,
      );
    }
  }
  // This record may already belong to a relation, even with no subject: a
  // replayed create, or an update of the same rkey.
  relationKey ??= await relationKeyForRecord(db, recordURI);

  // Idempotency is checked against **any** version of this record, not just the
  // current one. Jetstream replays a few seconds of commits on every reconnect,
  // so a create whose version has since been archived by a correction gets
  // redelivered; matching only the current version would re-apply it as current
  // and silently undo the correction.
  const existing = await queryOne<StoredRelation>(
    db,
    aql`FOR r IN relations FILTER r.recordURI == ${recordURI} LIMIT 1 RETURN r`,
  );
  if (existing && existing.cid === cid) return "skipped-duplicate";

  const current =
    relationKey === null
      ? null
      : await queryOne<StoredRelation>(
          db,
          aql`
            FOR r IN relations
              FILTER r.relationKey == ${relationKey} AND r.current == true
              LIMIT 1
              RETURN r
          `,
        );

  const languages: [string, string] = [parsed.sides[0].languageID, parsed.sides[1].languageID];
  relationKey ??= await mintRelationKey(db, languages, recordURI);

  const seed = (side: RelationSide): RelationSideDoc => ({
    recordURI: side.entry,
    entryKey: null,
    languageID: side.languageID,
    place: canonicalizePlacePrefix(side.place),
    orthography: side.orthography ?? null,
    leafPlaces: [],
    coarse: false,
  });
  const { sides, state } = await anchorSides(dbLookup(db), [
    seed(parsed.sides[0]),
    seed(parsed.sides[1]),
  ]);

  const doc: RelationDoc = {
    relationKey,
    kind: parsed.kind,
    sides,
    state,
    recordURI,
    cid,
    authorDID,
    createdAt: parsed.createdAt,
    indexedAt: new Date().toISOString(),
    current: true,
  };

  if (current) {
    await db.query(aql`UPDATE ${current._key} WITH { current: false } IN relations`);
  }
  // A record updated in place (same rkey, new cid) leaves its previous version
  // as an ordinary archived doc sharing the URI, exactly as entries do.
  if (existing) {
    await db.query(aql`
      FOR r IN relations
        FILTER r.recordURI == ${recordURI} AND r.current == true
        UPDATE r WITH { current: false } IN relations
    `);
  }
  await db.query(aql`INSERT ${doc} INTO relations`);
  await rebuildRelationEdges(db, doc);
  console.log(
    `firehose: indexed relation [${relationKey}] ${sides[0].languageID}↔${sides[1].languageID} ` +
      `(${state}, ${current ? "new version" : "new relation"}) from ${authorDID}`,
  );
  return "indexed";
}

/**
 * Handle a delete op: the index mirrors the network, as with entries. The
 * version whose record is gone is removed; if it was current, the most
 * recently indexed survivor is promoted and re-anchored (the world moved on
 * while it was archived); when nothing survives, the relation and its edges
 * disappear.
 */
export async function ingestRelationDelete(recordURI: string): Promise<void> {
  const removedCursor = await db.query<{ relationKey: string; current: boolean }>(aql`
    FOR r IN relations
      FILTER r.recordURI == ${recordURI}
      REMOVE r IN relations
      RETURN { relationKey: OLD.relationKey, current: OLD.current }
  `);
  const removed = await removedCursor.all();
  if (removed.length === 0) return;

  // One record backs one relation, but promote per distinct key rather than
  // assuming it: a stray second identity would otherwise keep serving edges
  // whose version has just been removed.
  for (const relationKey of new Set(removed.map((r) => r.relationKey))) {
    if (!removed.some((r) => r.current && r.relationKey === relationKey)) {
      console.log(
        `firehose: removed archived version of relation "${relationKey}" (record deleted)`,
      );
      continue;
    }

    const promoted = await queryOne<StoredRelation>(
      db,
      aql`
        FOR r IN relations
          FILTER r.relationKey == ${relationKey}
          SORT r.indexedAt DESC
          LIMIT 1
          UPDATE r WITH { current: true } IN relations
          RETURN NEW
      `,
    );

    if (promoted) {
      // Re-anchor rather than trusting the archived state: entries may have
      // been restructured while this version sat in the history.
      const { sides, state } = await anchorSides(dbLookup(db), promoted.sides);
      await db.query(aql`
        UPDATE ${promoted._key} WITH { sides: ${sides}, state: ${state} } IN relations
      `);
      await rebuildRelationEdges(db, { ...promoted, sides, state });
      console.log(
        `firehose: removed current version of relation "${relationKey}" (record deleted); ` +
          `promoted ${promoted.recordURI} (${state})`,
      );
      continue;
    }

    await db.query(aql`
      FOR e IN relationEdges FILTER e.relationKey == ${relationKey} REMOVE e IN relationEdges
    `);
    console.log(`firehose: removed relation "${relationKey}" entirely (last record deleted)`);
  }
}

/** The sense rows of one entry version, keyed deterministically. */
function senseDocs(
  entryKey: string,
  languageID: string,
  places: readonly number[][],
): SenseDoc[] {
  return places.map((place) => ({
    _key: senseKey(entryKey, place),
    entryKey,
    languageID,
    place: [...place],
  }));
}

async function insertBatched(
  database: Database,
  collection: "senses" | "relationEdges",
  docs: readonly object[],
): Promise<void> {
  const target = database.collection(collection);
  for (let i = 0; i < docs.length; i += INSERT_BATCH) {
    const batch = docs.slice(i, i + INSERT_BATCH);
    await database.query(aql`FOR d IN ${batch} INSERT d INTO ${target}`);
  }
}

/**
 * Bring one entry's sense vertices in line with its current version, then
 * re-anchor every relation touching it.
 *
 * Called on every entry version transition — a new current version, a
 * promotion after a deletion, or the entry's disappearance — with the places
 * the new current version declares (and none for a withdrawn or vanished
 * entry). Materializing **every** leaf, not only the related ones, is what
 * keeps a sense key a pure computation and gives the dashboard an
 * untranslated-senses count for free.
 *
 * `languageID` is null when the entry is gone entirely.
 */
export async function syncEntrySenses(
  database: Database,
  entryKey: string,
  languageID: string | null,
  places: readonly number[][],
): Promise<void> {
  const docs = languageID === null ? [] : senseDocs(entryKey, languageID, places);

  // Order matters, and this is the safe one: add the new senses, re-anchor
  // (which withdraws the edges of anything that drifted), and only then remove
  // the senses nothing points at any more. Pruning first would leave a live
  // relation's edges hanging off a vertex that no longer exists for as long as
  // the re-anchor takes — and if the process died in between, until the next
  // db:init, because a redelivered commit is skipped as a duplicate.
  if (docs.length > 0) {
    await database.query(aql`
      FOR d IN ${docs}
        UPSERT { _key: d._key } INSERT d REPLACE d IN senses
    `);
  }

  const affectedCursor = await database.query<StoredRelation>(aql`
    FOR r IN relations
      FILTER r.current == true AND ${entryKey} IN r.sides[*].entryKey
      RETURN r
  `);
  for (const doc of await affectedCursor.all()) {
    await reanchorRelation(database, doc);
  }

  await database.query(aql`
    FOR s IN senses
      FILTER s.entryKey == ${entryKey} AND s._key NOT IN ${docs.map((d) => d._key)}
      REMOVE s IN senses
  `);
}

/**
 * Resolve relations that pin an entry version the AppView had not yet indexed.
 *
 * Jetstream delivers records in arbitrary order, so a relation routinely
 * arrives before the entry it references; this is the join that revives it the
 * moment that entry version appears, using the `sides[*].recordURI` index. A
 * relation whose side is already resolved is untouched — it is reached by
 * entryKey in syncEntrySenses instead.
 */
export async function reviveUnresolvedRelations(
  database: Database,
  recordURI: string,
): Promise<void> {
  const cursor = await database.query<StoredRelation>(aql`
    FOR r IN relations
      FILTER r.current == true
        AND r.state == "unresolved"
        AND ${recordURI} IN r.sides[*].recordURI
      RETURN r
  `);
  for (const doc of await cursor.all()) {
    await reanchorRelation(database, doc);
  }
}

/**
 * Rebuild the two derived collections from scratch — used by db:init, which
 * owns the same standing exception to archive-forever that `labels` and
 * `localLanguages` have: every document here is recomputed, so there is
 * nothing in them to lose.
 *
 * Written in bulk (a handful of round trips, not one per record) because it
 * runs inside the deploy step, on every `v*` tag, while the site is up.
 *
 * The Jetstream consumer keeps ingesting throughout, so both writes are
 * **guarded on the version still being current**: a relation the consumer
 * corrected mid-rebuild must not have this snapshot's state written back over
 * it, nor its predecessor's edges re-inserted beside the new ones.
 */
export async function rebuildSemanticNetwork(database: Database): Promise<{
  senses: number;
  edges: number;
  states: Record<RelationState, number>;
}> {
  await database.query(aql`FOR s IN senses REMOVE s IN senses`);
  await database.query(aql`FOR e IN relationEdges REMOVE e IN relationEdges`);

  // One pass over the current entries yields both the sense rows to write and
  // the map anchoring reads, so no relation costs a query of its own.
  const entriesCursor = await database.query<{
    entryKey: string;
    languageID: string;
    places: number[][] | null;
    deleted: boolean;
  }>(aql`
    FOR e IN entries
      FILTER e.current == true
      RETURN {
        entryKey: e.entryKey,
        languageID: e.languageID,
        places: e.places,
        deleted: e.deleted == true
      }
  `);
  const currentEntries = new Map<string, CurrentEntry>();
  const senseRows: SenseDoc[] = [];
  for (const entry of await entriesCursor.all()) {
    currentEntries.set(entry.entryKey, {
      languageID: entry.languageID,
      places: entry.places,
      deleted: entry.deleted,
    });
    // Entry versions indexed before `places` was cached contribute no senses
    // and park their relations; they recover when their author republishes.
    if (entry.deleted || !entry.places) continue;
    senseRows.push(...senseDocs(entry.entryKey, entry.languageID, entry.places));
  }
  await insertBatched(database, "senses", senseRows);

  const lookup: EntryLookup = {
    // Only a side that never resolved needs the index; everything else is
    // answered from the map above.
    pinned: dbLookup(database).pinned,
    current: async (entryKey) => currentEntries.get(entryKey) ?? null,
  };

  const states: Record<RelationState, number> = { live: 0, stale: 0, unresolved: 0, oversize: 0 };
  const updates: { key: string; sides: RelationSideDoc[]; state: RelationState }[] = [];
  // `via` rides along only as the currency guard below; it is stripped on insert.
  const edgeRows: (RelationEdgeDoc & { via: string })[] = [];
  const relationsCursor = await database.query<StoredRelation>(aql`
    FOR r IN relations FILTER r.current == true RETURN r
  `);
  for (const doc of await relationsCursor.all()) {
    // Re-run the comparison, but **keep the cached pin**. A record references
    // an entry by URI, and a republished entry keeps its URI, so the expansion
    // cached when the relation was first indexed is the only surviving record
    // of which tree it was authored against. Re-deriving it here would read
    // whatever version now sits at that URI and could revive a relation the
    // consumer had parked — a rebuild must reproduce the consumer's answer,
    // not a more permissive one.
    const { sides, state } = await anchorSides(lookup, doc.sides);
    updates.push({ key: doc._key, sides, state });
    states[state] += 1;
    for (const edge of relationEdgeDocs({ ...doc, sides, state })) {
      edgeRows.push({ ...edge, via: doc.recordURI });
    }
  }

  if (updates.length > 0) {
    for (let i = 0; i < updates.length; i += INSERT_BATCH) {
      await database.query(aql`
        FOR u IN ${updates.slice(i, i + INSERT_BATCH)}
          FOR r IN relations
            FILTER r._key == u.key AND r.current == true
            UPDATE r WITH { sides: u.sides, state: u.state } IN relations
      `);
    }
  }
  // Same guard for the edges: an edge is written only while the version it came
  // from is still the current one.
  for (let i = 0; i < edgeRows.length; i += INSERT_BATCH) {
    await database.query(aql`
      FOR e IN ${edgeRows.slice(i, i + INSERT_BATCH)}
        LET currentRecord = FIRST(
          FOR r IN relations
            FILTER r.relationKey == e.relationKey AND r.current == true
            LIMIT 1
            RETURN r.recordURI
        )
        FILTER currentRecord == e.via
        INSERT UNSET(e, "via") INTO relationEdges
    `);
  }

  const edges = (await queryOne<number>(database, aql`RETURN LENGTH(relationEdges)`)) ?? 0;
  return { senses: senseRows.length, edges, states };
}
