import { createHash } from "node:crypto";
import { aql, type Database } from "arangojs";
import {
  normalizeLanguageTag,
  validateCognate,
  type CognateSide,
  type CognateState,
} from "@leksis/types";
import { db } from "../db";
import type { IngestResult } from "./ingest-language";

// Decomposition of eu.leksis.cognate records into the cognate network.
//
// The word-level sibling of ingest-relation.ts, and deliberately its mirror:
// same three-collection shape, same versioning, same park-never-serve rule.
// What differs is what a vertex *is*, and everything follows from that.
//
// - `cognates` — versioned mirror, one doc per cognate version, exactly as
//   `relations` and `entries` work.
// - `lexemes` — derived vertices, one per **entry** in the network. The vertex
//   is the word, not the sense: a word's history belongs to all of its senses
//   at once, so there is no place to address, no expansion, no coarseness and
//   no drift. Unlike `senses`, these are materialized **on demand** — only for
//   entries a live cognate actually touches — because a lexeme vertex would
//   otherwise be a second copy of the entire `entries` collection keyed
//   identically, and nothing needs one for a word nobody has linked.
// - `cognateEdges` — derived edges, exactly one per live cognate version.
//
// The vertex denormalizes what the network endpoint prints (language,
// orthography, record URI, author) so serving a component is one traversal and
// no join. That is only safe because every entry version transition refreshes
// it — see syncEntryCognates, which is the hook that keeps it true.
//
// Cognate *content* — the notes on the assertion — stays on the record, as
// relation notes and definition texts do: the AppView indexes shape and
// pointers, never content.
//
// Functions that touch the database take it explicitly, as the relation and
// labels models' do, so db:init can drive them on its own connection.
//
// See docs/adr/0013-cognates-and-etymology.md for the reasoning.

/** One end of a cognate as indexed: the record's claim, plus what it resolved to. */
interface CognateSideDoc {
  /** at:// URI of the pinned entry record version, from the record. */
  recordURI: string;
  /** Stable key of the entry that version belongs to; null while unresolved. */
  entryKey: string | null;
  /**
   * BCP 47 tag of this side's language. Seeded from the record (which
   * denormalizes it for legibility) and **replaced by the resolved entry's own
   * language**, on the relation model's reasoning: the index should not repeat
   * a claim it can verify.
   */
  languageID: string;
  /**
   * The canonical spelling the record carried. Display fallback only, never
   * matched on: it is the one thing a worklist can print for a side whose entry
   * this AppView cannot resolve, which is precisely when it is needed.
   */
  orthography: string | null;
}

/** One cognate version as indexed. */
interface CognateDoc {
  /** Stable cognate identity across versions. */
  cognateKey: string;
  sides: [CognateSideDoc, CognateSideDoc];
  state: CognateState;
  recordURI: string;
  cid: string;
  authorDID: string;
  createdAt: string;
  indexedAt: string;
  current: boolean;
  /** When this version last entered its current state — what a worklist orders by. */
  stateChangedAt?: string;
}

type StoredCognate = CognateDoc & { _key: string };

/** What a cognate record contributes to the index; content fields are dropped. */
interface ParsedCognate {
  sides: [CognateSide, CognateSide];
  subject: string | null;
  createdAt: string;
}

/** A lexeme vertex: one word the cognate network touches. */
interface LexemeDoc {
  _key: string;
  entryKey: string;
  languageID: string;
  orthography: string[];
  recordURI: string;
  authorDID: string;
}

async function queryOne<T>(database: Database, query: ReturnType<typeof aql>): Promise<T | null> {
  const cursor = await database.query<T>(query);
  return (await cursor.next()) ?? null;
}

/** Write documents in bounded batches, so one dictionary is not one giant request. */
const INSERT_BATCH = 2000;

const vertexId = (entryKey: string) => `lexemes/${entryKey}`;

/**
 * Validate an incoming record (unknown shape — anyone can put anything on their
 * PDS) and return only what the index keeps. Rejected whole when malformed, so
 * a cognate never half-loads.
 *
 * As with relations, a side pointing at an entry this AppView has never seen is
 * *not* a rejection: Jetstream delivers records in arbitrary order, so a
 * cognate legitimately arrives before the entries it links, and it resolves
 * later (see reviveUnresolvedCognates).
 */
function parseRecord(recordURI: string, record: unknown): ParsedCognate | null {
  if (typeof record !== "object" || record === null) return null;
  const r = record as Record<string, unknown>;

  if (!Array.isArray(r.sides) || r.sides.length !== 2) return null;
  const sides: CognateSide[] = [];
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
      ...(orthography !== undefined ? { orthography } : {}),
    });
  }

  const pair = sides as [CognateSide, CognateSide];
  const error = validateCognate({ sides: pair });
  if (error !== "ok") {
    console.warn(`firehose: cognate ${recordURI} is invalid (${error})`);
    return null;
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
  return { sides: pair, subject, createdAt };
}

/**
 * Mint a stable cognate key: `{langA}-{langB}-{hash}` with the two tags sorted,
 * e.g. "br-cy-1b76" — the relationKey convention, for the same reasons (a
 * symmetric key for a symmetric assertion, collisions resolved by extending the
 * hash). Callers must first look the record URI up (see cognateKeyForRecord):
 * minting is only for a record this index has never seen.
 */
async function mintCognateKey(
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
      aql`RETURN LENGTH(FOR c IN cognates FILTER c.cognateKey == ${key} LIMIT 1 RETURN 1) > 0`,
    );
    if (!taken) return key;
  }
  throw new Error(`could not mint a unique cognate key for ${recordURI}`);
}

/**
 * The cognate a record URI already belongs to, across **all** versions —
 * current or archived. The lookup that makes ingestion replay-safe; see
 * relationKeyForRecord for why restricting it to current versions mints
 * phantom identities.
 */
async function cognateKeyForRecord(database: Database, recordURI: string): Promise<string | null> {
  return queryOne<string>(
    database,
    aql`FOR c IN cognates FILTER c.recordURI == ${recordURI} LIMIT 1 RETURN c.cognateKey`,
  );
}

/** The entry index, as anchoring reads it. */
interface PinnedEntry {
  entryKey: string;
  languageID: string;
}
interface CurrentEntry {
  languageID: string;
  deleted: boolean;
}

/**
 * How anchoring reads the entry index. The consumer queries per side; the
 * wholesale rebuild pre-loads every current entry and answers from memory.
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
            RETURN { entryKey: e.entryKey, languageID: e.languageID }
        `,
      ),
    current: (entryKey) =>
      queryOne<CurrentEntry>(
        database,
        aql`
          FOR e IN entries
            FILTER e.entryKey == ${entryKey} AND e.current == true
            LIMIT 1
            RETURN { languageID: e.languageID, deleted: e.deleted == true }
        `,
      ),
  };
}

type SideState = "live" | "stale" | "unresolved";

/**
 * Resolve one side to an entry.
 *
 * Much shorter than its relation counterpart, and the omission is the design:
 * there is no subtree to compare, because a cognate addresses the word and
 * every version of an entry is the same word. Restructuring the definitions,
 * re-spelling the headword or adding a sense cannot invalidate a claim about
 * where the word came from — so a cognate survives edits that would park a
 * translation, and only two things can unseat it: the entry going away, or
 * being withdrawn.
 */
async function anchorSide(
  lookup: EntryLookup,
  side: CognateSideDoc,
): Promise<{ side: CognateSideDoc; state: SideState }> {
  let entryKey = side.entryKey;
  let languageID = side.languageID;
  const out = (state: SideState) => ({ side: { ...side, entryKey, languageID }, state });

  if (entryKey === null) {
    const pinned = await lookup.pinned(side.recordURI);
    if (!pinned) return out("unresolved");
    entryKey = pinned.entryKey;
    languageID = pinned.languageID;
  }

  let current = await lookup.current(entryKey);

  // The cached entryKey can go dead: an entry whose every version was deleted
  // and then republished at the same rkey is indexed under a **new** entryKey
  // while its record URI is unchanged. Re-resolve the pin's identity so such a
  // cognate can leave the worklist instead of parking forever.
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
  // dashboards this side counts on — a re-languaged entry must not leave its
  // edge claiming the old tag.
  languageID = current.languageID;

  // A withdrawn entry parks the cognate rather than removing it: the claim is
  // still somebody's, and it revives untouched if the withdrawal is contested.
  // `redirectTo` is deliberately **not** followed — re-pointing a historical
  // claim at a different word is an editorial act, not an index repair (the
  // relation model's identical ruling, ADR-0011).
  if (current.deleted) return out("stale");

  return out("live");
}

/**
 * Anchor both sides and combine their verdicts. **Park, never serve**: anything
 * short of `live` has no edge and shows up on a worklist instead.
 *
 * The last branch is the one validation cannot reach. `validateCognate` rejects
 * two sides naming the same *record*, but two sides naming different *versions*
 * of one entry look distinct until the index resolves them — and a word shares
 * an origin with itself trivially, so the assertion carries nothing. It parks
 * rather than being dropped, because by then it is an indexed record whose
 * author should see why it is not in the network.
 */
async function anchorSides(
  lookup: EntryLookup,
  sides: [CognateSideDoc, CognateSideDoc],
): Promise<{ sides: [CognateSideDoc, CognateSideDoc]; state: CognateState }> {
  const a = await anchorSide(lookup, sides[0]);
  const b = await anchorSide(lookup, sides[1]);
  const anchored: [CognateSideDoc, CognateSideDoc] = [a.side, b.side];

  let state: CognateState;
  if (a.state === "unresolved" || b.state === "unresolved") state = "unresolved";
  else if (a.state === "stale" || b.state === "stale") state = "stale";
  else if (a.side.entryKey !== null && a.side.entryKey === b.side.entryKey) state = "stale";
  else state = "live";

  return { sides: anchored, state };
}

/** An edge document as stored. */
type CognateEdgeDoc = Record<string, unknown> & { cognateKey: string };

/**
 * The edge a cognate version contributes: none unless it is live, otherwise
 * exactly one. There is no product to take — that is the whole difference from
 * a relation, and the reason no cap is needed here.
 */
function cognateEdgeDocs(doc: CognateDoc): CognateEdgeDoc[] {
  if (doc.state !== "live") return [];
  const [a, b] = doc.sides;
  if (a.entryKey === null || b.entryKey === null) return [];
  if (a.entryKey === b.entryKey) return [];

  return [
    {
      _from: vertexId(a.entryKey),
      _to: vertexId(b.entryKey),
      cognateKey: doc.cognateKey,
      // Aligned with _from/_to, not sorted — a consumer grouping a component by
      // language reads them off the vertices anyway; this is for the edge's own
      // legibility in aardvark and for a language-scoped query.
      languages: [a.languageID, b.languageID],
    },
  ];
}

/**
 * Bring the lexeme vertices of the given entries in line with the edges: a word
 * the network touches has a vertex carrying what the endpoint prints, a word it
 * no longer touches has none.
 *
 * Both halves run over the same key list because the two cases are one
 * question asked per entry ("does any edge still reach it?"), and the answer
 * flips in both directions — a new cognate materializes a vertex, a deleted one
 * removes it.
 */
async function syncLexemes(database: Database, entryKeys: readonly string[]): Promise<void> {
  const keys = [...new Set(entryKeys)];
  if (keys.length === 0) return;

  // Kept vertices are REPLACEd rather than merely inserted: this is also the
  // path that refreshes a denormalized orthography or language after the entry
  // is republished.
  await database.query(aql`
    FOR key IN ${keys}
      LET vertex = CONCAT("lexemes/", key)
      LET used = LENGTH(
        FOR e IN cognateEdges
          FILTER e._from == vertex OR e._to == vertex
          LIMIT 1
          RETURN 1
      ) > 0
      FILTER used
      LET entry = FIRST(
        FOR e IN entries
          FILTER e.entryKey == key AND e.current == true
          LIMIT 1
          RETURN e
      )
      FILTER entry != null
      LET doc = {
        _key: key,
        entryKey: key,
        languageID: entry.languageID,
        orthography: entry.orthography,
        recordURI: entry.recordURI,
        authorDID: entry.authorDID
      }
      UPSERT { _key: key } INSERT doc REPLACE doc IN lexemes
  `);

  await database.query(aql`
    FOR key IN ${keys}
      LET vertex = CONCAT("lexemes/", key)
      LET used = LENGTH(
        FOR e IN cognateEdges
          FILTER e._from == vertex OR e._to == vertex
          LIMIT 1
          RETURN 1
      ) > 0
      FILTER !used
      FOR l IN lexemes
        FILTER l._key == key
        REMOVE l IN lexemes
  `);
}

/**
 * Rewrite one cognate's edge in place. Single-writer path (the consumer).
 *
 * Ordering is the same lesson syncEntrySenses records: vertices in before
 * edges, vertices out after. A gap the other way round would leave a live edge
 * hanging off a vertex that does not exist — and if the process died in
 * between, until the next db:init, because a redelivered commit is skipped as a
 * duplicate.
 */
async function rebuildCognateEdges(database: Database, doc: CognateDoc): Promise<void> {
  const edges = cognateEdgeDocs(doc);
  const nextKeys = doc.sides.map((s) => s.entryKey).filter((k): k is string => k !== null);

  // Materialize before the edge exists, so an edge is never written dangling.
  // Written directly rather than through syncLexemes, which decides by asking
  // whether an edge already reaches the vertex — and here the edge that
  // justifies it is the one about to be inserted below.
  if (edges.length > 0) {
    await database.query(aql`
      FOR key IN ${nextKeys}
        LET entry = FIRST(
          FOR e IN entries
            FILTER e.entryKey == key AND e.current == true
            LIMIT 1
            RETURN e
        )
        FILTER entry != null
        LET vdoc = {
          _key: key,
          entryKey: key,
          languageID: entry.languageID,
          orthography: entry.orthography,
          recordURI: entry.recordURI,
          authorDID: entry.authorDID
        }
        UPSERT { _key: key } INSERT vdoc REPLACE vdoc IN lexemes
    `);
  }

  const removedCursor = await database.query<{ from: string; to: string }>(aql`
    FOR e IN cognateEdges
      FILTER e.cognateKey == ${doc.cognateKey}
      REMOVE e IN cognateEdges
      RETURN { from: OLD._from, to: OLD._to }
  `);
  const removed = await removedCursor.all();

  if (edges.length > 0) {
    await database.query(aql`FOR e IN ${edges} INSERT e INTO cognateEdges`);
  }

  // Every endpoint this rewrite touched — the old edge's and the new sides' —
  // is re-evaluated, and syncLexemes is the single place that decides, by
  // asking whether any edge still reaches the vertex.
  //
  // Note `nextKeys` is NOT a set of survivors: a parked cognate still names
  // both its entryKeys, so excluding them here (as an earlier version did)
  // strands the far endpoint's vertex in the network with no edge on it.
  const touched = [
    ...removed.flatMap((e) => [e.from, e.to]).map((id) => id.slice("lexemes/".length)),
    ...nextKeys,
  ];
  await syncLexemes(database, touched);
}

/** Whether re-anchoring changed anything worth writing. */
function anchorUnchanged(
  doc: CognateDoc,
  sides: [CognateSideDoc, CognateSideDoc],
  state: CognateState,
): boolean {
  if (doc.state !== state) return false;
  return doc.sides.every((before, i) => {
    const after = sides[i]!;
    return before.entryKey === after.entryKey && before.languageID === after.languageID;
  });
}

/**
 * Re-resolve one indexed cognate and rewrite its edge. A withdrawal parks it, a
 * restoration revives it — with no record fetched from any PDS and nothing
 * written to anyone's repository.
 */
async function reanchorCognate(database: Database, doc: StoredCognate): Promise<void> {
  const { sides, state } = await anchorSides(dbLookup(database), doc.sides);
  if (anchorUnchanged(doc, sides, state)) return;

  const stateChangedAt = doc.state === state ? undefined : new Date().toISOString();
  await database.query(aql`
    UPDATE ${doc._key}
      WITH ${{ sides, state, ...(stateChangedAt ? { stateChangedAt } : {}) }}
      IN cognates
  `);
  await rebuildCognateEdges(database, { ...doc, sides, state });
  console.log(`firehose: cognate "${doc.cognateKey}" re-anchored ${doc.state} → ${state}`);
}

/**
 * Index a created/updated eu.leksis.cognate record. Idempotent on
 * recordURI + cid, and versioned exactly as relations and entries are:
 * `subject` attaches the record to an existing cognate, the superseded version
 * is archived, and last write wins across authors.
 */
export async function ingestCognate(
  authorDID: string,
  recordURI: string,
  cid: string,
  record: unknown,
): Promise<IngestResult> {
  const parsed = parseRecord(recordURI, record);
  if (!parsed) {
    console.warn(`firehose: skipped invalid cognate record ${recordURI}`);
    return "skipped-invalid";
  }

  // A subject pointing at a record this AppView never indexed degrades to a new
  // cognate rather than being dropped — the entries rule.
  let cognateKey: string | null = null;
  if (parsed.subject) {
    cognateKey = await cognateKeyForRecord(db, parsed.subject);
    if (!cognateKey) {
      console.warn(
        `firehose: cognate ${recordURI} has unknown subject ${parsed.subject}, indexing as new cognate`,
      );
    }
  }
  // This record may already belong to a cognate, even with no subject: a
  // replayed create, or an update of the same rkey.
  cognateKey ??= await cognateKeyForRecord(db, recordURI);

  // Idempotency is checked against **any** version of this record, not just the
  // current one — see ingestRelation for why matching only the current version
  // silently undoes corrections on a Jetstream replay.
  const existing = await queryOne<StoredCognate>(
    db,
    aql`FOR c IN cognates FILTER c.recordURI == ${recordURI} LIMIT 1 RETURN c`,
  );
  if (existing && existing.cid === cid) return "skipped-duplicate";

  const current =
    cognateKey === null
      ? null
      : await queryOne<StoredCognate>(
          db,
          aql`
            FOR c IN cognates
              FILTER c.cognateKey == ${cognateKey} AND c.current == true
              LIMIT 1
              RETURN c
          `,
        );

  const languages: [string, string] = [parsed.sides[0].languageID, parsed.sides[1].languageID];
  cognateKey ??= await mintCognateKey(db, languages, recordURI);

  const seed = (side: CognateSide): CognateSideDoc => ({
    recordURI: side.entry,
    entryKey: null,
    languageID: side.languageID,
    orthography: side.orthography ?? null,
  });
  const { sides, state } = await anchorSides(dbLookup(db), [
    seed(parsed.sides[0]),
    seed(parsed.sides[1]),
  ]);

  const doc: CognateDoc = {
    cognateKey,
    sides,
    state,
    recordURI,
    cid,
    authorDID,
    createdAt: parsed.createdAt,
    indexedAt: new Date().toISOString(),
    current: true,
    stateChangedAt: new Date().toISOString(),
  };

  if (current) {
    await db.query(aql`UPDATE ${current._key} WITH { current: false } IN cognates`);
  }
  // A record updated in place (same rkey, new cid) leaves its previous version
  // as an ordinary archived doc sharing the URI, exactly as entries do.
  if (existing) {
    await db.query(aql`
      FOR c IN cognates
        FILTER c.recordURI == ${recordURI} AND c.current == true
        UPDATE c WITH { current: false } IN cognates
    `);
  }
  await db.query(aql`INSERT ${doc} INTO cognates`);
  await rebuildCognateEdges(db, doc);
  console.log(
    `firehose: indexed cognate [${cognateKey}] ${sides[0].languageID}↔${sides[1].languageID} ` +
      `(${state}, ${current ? "new version" : "new cognate"}) from ${authorDID}`,
  );
  return "indexed";
}

/**
 * Handle a delete op: the index mirrors the network, as with entries and
 * relations. The version whose record is gone is removed; if it was current,
 * the most recently indexed survivor is promoted and re-anchored; when nothing
 * survives, the cognate and its edge disappear.
 */
export async function ingestCognateDelete(recordURI: string): Promise<void> {
  const removedCursor = await db.query<{ cognateKey: string; current: boolean }>(aql`
    FOR c IN cognates
      FILTER c.recordURI == ${recordURI}
      REMOVE c IN cognates
      RETURN { cognateKey: OLD.cognateKey, current: OLD.current }
  `);
  const removed = await removedCursor.all();
  if (removed.length === 0) return;

  for (const cognateKey of new Set(removed.map((c) => c.cognateKey))) {
    if (!removed.some((c) => c.current && c.cognateKey === cognateKey)) {
      console.log(`firehose: removed archived version of cognate "${cognateKey}" (record deleted)`);
      continue;
    }

    const promoted = await queryOne<StoredCognate>(
      db,
      aql`
        FOR c IN cognates
          FILTER c.cognateKey == ${cognateKey}
          SORT c.indexedAt DESC
          LIMIT 1
          UPDATE c WITH { current: true } IN cognates
          RETURN NEW
      `,
    );

    if (promoted) {
      // Re-anchor rather than trusting the archived state: entries may have
      // been withdrawn or restored while this version sat in the history.
      const { sides, state } = await anchorSides(dbLookup(db), promoted.sides);
      await db.query(aql`
        UPDATE ${promoted._key} WITH { sides: ${sides}, state: ${state} } IN cognates
      `);
      await rebuildCognateEdges(db, { ...promoted, sides, state });
      console.log(
        `firehose: removed current version of cognate "${cognateKey}" (record deleted); ` +
          `promoted ${promoted.recordURI} (${state})`,
      );
      continue;
    }

    // No survivor: drop the edge, then let the two endpoints go if this was the
    // last thing holding them in the network.
    const orphanCursor = await db.query<{ from: string; to: string }>(aql`
      FOR e IN cognateEdges
        FILTER e.cognateKey == ${cognateKey}
        REMOVE e IN cognateEdges
        RETURN { from: OLD._from, to: OLD._to }
    `);
    const orphans = (await orphanCursor.all())
      .flatMap((e) => [e.from, e.to])
      .map((id) => id.slice("lexemes/".length));
    await syncLexemes(db, orphans);
    console.log(`firehose: removed cognate "${cognateKey}" entirely (last record deleted)`);
  }
}

/**
 * Re-anchor every cognate touching one entry, then bring its lexeme vertex in
 * line with the result.
 *
 * Called on every entry version transition — a new current version, a promotion
 * after a deletion, or the entry's disappearance. Two things depend on it: a
 * withdrawal must park the cognates pinning that entry, and a republication
 * must refresh what the vertex denormalizes, since a re-spelled headword would
 * otherwise keep printing its old orthography in every component it appears in.
 *
 * Takes no language or content argument, unlike syncEntrySenses: a lexeme
 * vertex denormalizes the entry row rather than the record, so the query below
 * reads the truth itself and a vanished entry needs no signalling — no current
 * row means no vertex.
 */
export async function syncEntryCognates(database: Database, entryKey: string): Promise<void> {
  const affectedCursor = await database.query<StoredCognate>(aql`
    FOR c IN cognates
      FILTER c.current == true AND ${entryKey} IN c.sides[*].entryKey
      RETURN c
  `);
  for (const doc of await affectedCursor.all()) {
    await reanchorCognate(database, doc);
  }

  // Refresh (or drop) this entry's vertex last: re-anchoring above is what
  // decides whether any edge still reaches it.
  await syncLexemes(database, [entryKey]);
}

/**
 * Resolve cognates that pin an entry version the AppView had not yet indexed.
 *
 * Jetstream delivers records in arbitrary order, so a cognate routinely arrives
 * before the entries it links; this is the join that revives it the moment such
 * an entry version appears, using the `sides[*].recordURI` index.
 */
export async function reviveUnresolvedCognates(
  database: Database,
  recordURI: string,
): Promise<void> {
  const cursor = await database.query<StoredCognate>(aql`
    FOR c IN cognates
      FILTER c.current == true
        AND c.state == "unresolved"
        AND ${recordURI} IN c.sides[*].recordURI
      RETURN c
  `);
  for (const doc of await cursor.all()) {
    await reanchorCognate(database, doc);
  }
}

/**
 * Rebuild the two derived collections from scratch — used by db:init, which
 * owns the same standing exception to archive-forever that `labels`,
 * `localLanguages` and the semantic network have: every document here is
 * recomputed, so there is nothing in them to lose.
 *
 * Written in bulk because it runs inside the deploy step, on every `v*` tag,
 * while the site is up. The Jetstream consumer keeps ingesting throughout, so
 * the writes are **guarded on the version still being current**.
 */
export async function rebuildCognateNetwork(database: Database): Promise<{
  lexemes: number;
  edges: number;
  states: Record<CognateState, number>;
}> {
  await database.query(aql`FOR l IN lexemes REMOVE l IN lexemes`);
  await database.query(aql`FOR e IN cognateEdges REMOVE e IN cognateEdges`);

  // One pass over the current entries answers every anchor from memory and
  // carries what a vertex denormalizes, so no cognate costs a query of its own.
  const entriesCursor = await database.query<{
    entryKey: string;
    languageID: string;
    orthography: string[];
    recordURI: string;
    authorDID: string;
    deleted: boolean;
  }>(aql`
    FOR e IN entries
      FILTER e.current == true
      RETURN {
        entryKey: e.entryKey,
        languageID: e.languageID,
        orthography: e.orthography,
        recordURI: e.recordURI,
        authorDID: e.authorDID,
        deleted: e.deleted == true
      }
  `);
  const currentEntries = new Map<
    string,
    { languageID: string; orthography: string[]; recordURI: string; authorDID: string; deleted: boolean }
  >();
  for (const entry of await entriesCursor.all()) {
    currentEntries.set(entry.entryKey, {
      languageID: entry.languageID,
      orthography: entry.orthography,
      recordURI: entry.recordURI,
      authorDID: entry.authorDID,
      deleted: entry.deleted,
    });
  }

  const lookup: EntryLookup = {
    // Only a side that never resolved needs the index; everything else is
    // answered from the map above.
    pinned: dbLookup(database).pinned,
    current: async (entryKey) => {
      const entry = currentEntries.get(entryKey);
      return entry ? { languageID: entry.languageID, deleted: entry.deleted } : null;
    },
  };

  const states: Record<CognateState, number> = { live: 0, stale: 0, unresolved: 0 };
  const updates: { key: string; sides: CognateSideDoc[]; state: CognateState }[] = [];
  // `via` rides along only as the currency guard below; it is stripped on insert.
  const edgeRows: (CognateEdgeDoc & { via: string })[] = [];
  const liveKeys = new Set<string>();
  const cognatesCursor = await database.query<StoredCognate>(aql`
    FOR c IN cognates FILTER c.current == true RETURN c
  `);
  for (const doc of await cognatesCursor.all()) {
    const { sides, state } = await anchorSides(lookup, doc.sides);
    updates.push({ key: doc._key, sides, state });
    states[state] += 1;
    for (const edge of cognateEdgeDocs({ ...doc, sides, state })) {
      edgeRows.push({ ...edge, via: doc.recordURI });
      for (const side of sides) if (side.entryKey !== null) liveKeys.add(side.entryKey);
    }
  }

  // Vertices first, so no edge is ever written dangling. Only entries a live
  // cognate touches get one — the on-demand rule, applied wholesale.
  const lexemeRows: LexemeDoc[] = [];
  for (const entryKey of liveKeys) {
    const entry = currentEntries.get(entryKey);
    if (!entry) continue;
    lexemeRows.push({
      _key: entryKey,
      entryKey,
      languageID: entry.languageID,
      orthography: entry.orthography,
      recordURI: entry.recordURI,
      authorDID: entry.authorDID,
    });
  }
  for (let i = 0; i < lexemeRows.length; i += INSERT_BATCH) {
    const batch = lexemeRows.slice(i, i + INSERT_BATCH);
    await database.query(aql`FOR d IN ${batch} INSERT d INTO lexemes`);
  }

  if (updates.length > 0) {
    for (let i = 0; i < updates.length; i += INSERT_BATCH) {
      await database.query(aql`
        FOR u IN ${updates.slice(i, i + INSERT_BATCH)}
          FOR c IN cognates
            FILTER c._key == u.key AND c.current == true
            UPDATE c WITH { sides: u.sides, state: u.state } IN cognates
      `);
    }
  }
  // Same guard for the edges: an edge is written only while the version it came
  // from is still the current one.
  for (let i = 0; i < edgeRows.length; i += INSERT_BATCH) {
    await database.query(aql`
      FOR e IN ${edgeRows.slice(i, i + INSERT_BATCH)}
        LET currentRecord = FIRST(
          FOR c IN cognates
            FILTER c.cognateKey == e.cognateKey AND c.current == true
            LIMIT 1
            RETURN c.recordURI
        )
        FILTER currentRecord == e.via
        INSERT UNSET(e, "via") INTO cognateEdges
    `);
  }

  const edges = (await queryOne<number>(database, aql`RETURN LENGTH(cognateEdges)`)) ?? 0;
  return { lexemes: lexemeRows.length, edges, states };
}
