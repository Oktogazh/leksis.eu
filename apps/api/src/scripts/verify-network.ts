// TEMPORARY verification harness for the semantic network (loop 5, slice 2).
// Drives the real ingest functions against a local ArangoDB, asserts the
// lifecycle, and prints a PASS/FAIL report. Deleted once the slice is verified.
//
//   ARANGO_URL=http://127.0.0.1:8529 ARANGO_PASSWORD=… npx tsx src/scripts/verify-network.ts

import { aql } from "arangojs";
import { db } from "../db";
import { ingestEntry, ingestEntryDelete } from "../firehose/ingest-entry";
import { ingestRelation, ingestRelationDelete } from "../firehose/ingest-relation";
import { rebuildSemanticNetwork } from "../firehose/ingest-relation";

const DID = "did:plc:verifybot";
let failures = 0;
let checks = 0;

function check(name: string, ok: boolean, detail = ""): void {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const entryURI = (rkey: string) => `at://${DID}/eu.leksis.entry/${rkey}`;
const relationURI = (rkey: string) => `at://${DID}/eu.leksis.relation/${rkey}`;

async function one<T>(query: ReturnType<typeof aql>): Promise<T | null> {
  const cursor = await db.query<T>(query);
  return (await cursor.next()) ?? null;
}
async function all<T>(query: ReturnType<typeof aql>): Promise<T[]> {
  const cursor = await db.query<T>(query);
  return cursor.all();
}

/** An entry record with one leaf per definition text. */
function entryRecord(
  languageID: string,
  orthography: string,
  texts: string[],
  extra: Record<string, unknown> = {},
) {
  return {
    $type: "eu.leksis.entry",
    languageID,
    orthography: [orthography],
    categories: [],
    definitions: texts.map((text, i) => ({ place: [i + 1], text })),
    createdAt: "2026-08-04T10:00:00Z",
    ...extra,
  };
}

function relationRecord(
  sides: { uri: string; languageID: string; place: number[]; orthography: string }[],
  extra: Record<string, unknown> = {},
) {
  return {
    $type: "eu.leksis.relation",
    sides: sides.map((s) => ({
      entry: s.uri,
      languageID: s.languageID,
      place: s.place,
      orthography: s.orthography,
    })),
    createdAt: "2026-08-04T10:00:00Z",
    ...extra,
  };
}

async function entryKeyOf(uri: string): Promise<string> {
  const key = await one<string>(aql`
    FOR e IN entries FILTER e.recordURI == ${uri} LIMIT 1 RETURN e.entryKey
  `);
  if (!key) throw new Error(`no entry indexed for ${uri}`);
  return key;
}

async function stateOf(relationRkey: string): Promise<string | null> {
  return one<string>(aql`
    FOR r IN relations
      FILTER r.recordURI == ${relationURI(relationRkey)} AND r.current == true
      LIMIT 1
      RETURN r.state
  `);
}

async function edgeCount(): Promise<number> {
  return (await one<number>(aql`RETURN LENGTH(relationEdges)`)) ?? 0;
}

/**
 * The §3.4 translation traversal: from one sense of the source entry, every
 * shortest path into the target language, ranked hops first then coarse hops.
 */
async function translate(
  senseId: string,
  target: string,
  maxDepth = 3,
): Promise<{ word: string; hops: number; coarse: number }[]> {
  return all<{ word: string; hops: number; coarse: number }>(aql`
    FOR v, e, p IN 1..${maxDepth} ANY ${senseId} relationEdges
      PRUNE v.languageID == ${target}
      OPTIONS { order: "bfs", uniqueVertices: "path" }
      FILTER v.languageID == ${target}
      FILTER p.edges[*].traversable ALL == true
      LET entry = FIRST(
        FOR en IN entries FILTER en.entryKey == v.entryKey AND en.current == true LIMIT 1 RETURN en
      )
      SORT LENGTH(p.edges), LENGTH(p.edges[* FILTER CURRENT.coarse])
      RETURN {
        word: entry.orthography[0],
        hops: LENGTH(p.edges),
        coarse: LENGTH(p.edges[* FILTER CURRENT.coarse])
      }
  `);
}

/**
 * Empties the collections it exercises, so it must never be pointed at a real
 * AppView. The guard is on the URL rather than on a confirmation flag: a
 * mistyped env var is exactly how this would otherwise wipe production.
 */
async function reset(): Promise<void> {
  const url = process.env.ARANGO_URL ?? "";
  if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(url)) {
    throw new Error(
      `refusing to run: this harness empties collections and ARANGO_URL is not local (${url || "unset"})`,
    );
  }
  for (const col of ["entries", "relations", "senses", "relationEdges", "labels"]) {
    await db.query(aql`FOR d IN ${db.collection(col)} REMOVE d IN ${db.collection(col)}`);
  }
}

async function main(): Promise<void> {
  await reset();
  // `--seed` stops after the fixtures, leaving a live network to curl against.
  const seedOnly = process.argv.includes("--seed");
  console.log("--- ingest: the gwerzenn chain ---");

  // br gwerzenn: one sense. fr vers: three senses (verse / toward / worms) —
  // the polysemous intermediate the whole design exists to pass through safely.
  await ingestEntry(DID, entryURI("gwerzenn"), "cid1", entryRecord("br", "gwerzenn", ["verse"]));
  await ingestEntry(
    DID,
    entryURI("vers"),
    "cid1",
    entryRecord("fr", "vers", ["verse", "toward", "worms"]),
  );
  await ingestEntry(DID, entryURI("verse"), "cid1", entryRecord("en", "verse", ["verse"]));
  await ingestEntry(DID, entryURI("toward"), "cid1", entryRecord("en", "toward", ["toward"]));
  await ingestEntry(DID, entryURI("worms"), "cid1", entryRecord("en", "worms", ["worms"]));
  await ingestEntry(DID, entryURI("prose"), "cid1", entryRecord("en", "prose", ["prose"]));

  const brKey = await entryKeyOf(entryURI("gwerzenn"));
  const senses = await one<number>(aql`RETURN LENGTH(senses)`);
  check("senses materialize one vertex per leaf", senses === 8, `${senses} (expected 8)`);

  // Every relation is sense-targeted except where a coarse case is wanted.
  await ingestRelation(
    DID,
    relationURI("br-fr"),
    "cid1",
    relationRecord([
      { uri: entryURI("gwerzenn"), languageID: "br", place: [1], orthography: "gwerzenn" },
      { uri: entryURI("vers"), languageID: "fr", place: [1], orthography: "vers" },
    ]),
  );
  await ingestRelation(
    DID,
    relationURI("fr-en-verse"),
    "cid1",
    relationRecord([
      { uri: entryURI("vers"), languageID: "fr", place: [1], orthography: "vers" },
      { uri: entryURI("verse"), languageID: "en", place: [], orthography: "verse" },
    ]),
  );
  await ingestRelation(
    DID,
    relationURI("fr-en-toward"),
    "cid1",
    relationRecord([
      { uri: entryURI("vers"), languageID: "fr", place: [2], orthography: "vers" },
      { uri: entryURI("toward"), languageID: "en", place: [], orthography: "toward" },
    ]),
  );
  await ingestRelation(
    DID,
    relationURI("fr-en-worms"),
    "cid1",
    relationRecord([
      { uri: entryURI("vers"), languageID: "fr", place: [3], orthography: "vers" },
      { uri: entryURI("worms"), languageID: "en", place: [], orthography: "worms" },
    ]),
  );
  // An antonym on the very sense the chain travels through: it must be stored
  // and never traversed.
  await ingestRelation(
    DID,
    relationURI("fr-en-prose"),
    "cid1",
    relationRecord(
      [
        { uri: entryURI("vers"), languageID: "fr", place: [1], orthography: "vers" },
        { uri: entryURI("prose"), languageID: "en", place: [], orthography: "prose" },
      ],
      { kind: "antonym" },
    ),
  );

  check("all five relations live", (await Promise.all(
    ["br-fr", "fr-en-verse", "fr-en-toward", "fr-en-worms", "fr-en-prose"].map(stateOf),
  )).every((s) => s === "live"));

  console.log("\n--- the gwerzenn test ---");
  const source = `senses/${brKey}.1`;
  let results = await translate(source, "en");
  check(
    "gwerzenn → en reaches verse",
    results.some((r) => r.word === "verse"),
    JSON.stringify(results),
  );
  check(
    "gwerzenn → en never reaches worms or toward",
    !results.some((r) => r.word === "worms" || r.word === "toward"),
  );
  check("the antonym is not traversed (no prose)", !results.some((r) => r.word === "prose"));
  check("verse is two hops", results.find((r) => r.word === "verse")?.hops === 2);
  const antonymEdges = await one<number>(aql`
    RETURN LENGTH(FOR e IN relationEdges FILTER e.kind == "antonym" RETURN 1)
  `);
  check("the antonym edge exists in the graph", antonymEdges === 1);

  console.log("\n--- coarseness and ranking ---");
  // br kan (2 senses) ↔ fr chant, whole entry on both sides: coarse. A precise
  // rival at the same hop count must outrank it.
  await ingestEntry(DID, entryURI("kan"), "cid1", entryRecord("br", "kan", ["song", "singing"]));
  await ingestEntry(DID, entryURI("chant"), "cid1", entryRecord("fr", "chant", ["song", "chant"]));
  await ingestEntry(DID, entryURI("song"), "cid1", entryRecord("en", "song", ["song"]));
  await ingestEntry(DID, entryURI("tune"), "cid1", entryRecord("en", "tune", ["tune"]));
  const kanKey = await entryKeyOf(entryURI("kan"));
  await ingestRelation(
    DID,
    relationURI("kan-chant"),
    "cid1",
    relationRecord([
      { uri: entryURI("kan"), languageID: "br", place: [], orthography: "kan" },
      { uri: entryURI("chant"), languageID: "fr", place: [], orthography: "chant" },
    ]),
  );
  await ingestRelation(
    DID,
    relationURI("chant-song"),
    "cid1",
    relationRecord([
      { uri: entryURI("chant"), languageID: "fr", place: [1], orthography: "chant" },
      { uri: entryURI("song"), languageID: "en", place: [], orthography: "song" },
    ]),
  );
  // A precise two-hop rival: kan sense 1 → tune directly is one hop, so give
  // it its own two-hop precise route instead via a second fr entry.
  await ingestEntry(DID, entryURI("air"), "cid1", entryRecord("fr", "air", ["tune"]));
  await ingestRelation(
    DID,
    relationURI("kan-air"),
    "cid1",
    relationRecord([
      { uri: entryURI("kan"), languageID: "br", place: [1], orthography: "kan" },
      { uri: entryURI("air"), languageID: "fr", place: [1], orthography: "air" },
    ]),
  );
  await ingestRelation(
    DID,
    relationURI("air-tune"),
    "cid1",
    relationRecord([
      { uri: entryURI("air"), languageID: "fr", place: [1], orthography: "air" },
      { uri: entryURI("tune"), languageID: "en", place: [], orthography: "tune" },
    ]),
  );
  const coarseEdges = await all<{ coarse: boolean; coarseFrom: boolean; coarseTo: boolean }>(aql`
    FOR e IN relationEdges
      FILTER e.relationKey == FIRST(
        FOR r IN relations FILTER r.recordURI == ${relationURI("kan-chant")} RETURN r.relationKey
      )
      RETURN { coarse: e.coarse, coarseFrom: e.coarseFrom, coarseTo: e.coarseTo }
  `);
  check(
    "a whole-entry × whole-entry relation makes 4 coarse edges, coarse on both ends",
    coarseEdges.length === 4 && coarseEdges.every((e) => e.coarse && e.coarseFrom && e.coarseTo),
    `${coarseEdges.length} edges`,
  );
  results = await translate(`senses/${kanKey}.1`, "en");
  const twoHop = results.filter((r) => r.hops === 2);
  check(
    "at equal hops, the precise path outranks the coarse one",
    twoHop.length >= 2 && twoHop[0]!.word === "tune" && twoHop[0]!.coarse === 0,
    JSON.stringify(twoHop),
  );

  if (seedOnly) {
    console.log(
      `\nseeded: ${await edgeCount()} edge(s). Source sense for the gwerzenn test: ${source}`,
    );
    return;
  }

  console.log("\n--- drift: a benign edit changes nothing ---");
  // Appending a fourth sense leaves every existing address untouched, which is
  // the common bot edit: nothing may park.
  await ingestEntry(DID, entryURI("vers"), "cid1b", {
    ...entryRecord("fr", "vers", ["verse", "toward", "worms", "a line of poetry"]),
    subject: entryURI("vers"),
  });
  check(
    "appending a sense parks nothing",
    (await Promise.all(["br-fr", "fr-en-verse", "fr-en-toward", "fr-en-worms"].map(stateOf))).every(
      (s) => s === "live",
    ),
  );
  check(
    "and the chain still resolves",
    (await translate(source, "en")).some((r) => r.word === "verse"),
  );

  console.log("\n--- drift: restructure, park, re-affirm ---");
  const edgesBefore = await edgeCount();
  // A new version that splits sense 1 into two sub-senses. Note the place model
  // forces the *siblings* to gain a level too ([2] becomes II.1.), so a
  // depth-changing edit legitimately parks every relation on the entry — only
  // an append leaves addresses alone.
  await ingestEntry(DID, entryURI("vers"), "cid2", {
    ...entryRecord("fr", "vers", []),
    definitions: [
      { place: [0, 1, 1], text: "verse, a line" },
      { place: [0, 1, 2], text: "verse, a stanza" },
      { place: [0, 2, 1], text: "toward" },
      { place: [0, 3, 1], text: "worms" },
    ],
    subject: entryURI("vers"),
  });
  check("restructuring parks the relation pinned to the changed sense", (await stateOf("br-fr")) === "stale");
  check(
    "and parks the onward hop from that same sense",
    (await stateOf("fr-en-verse")) === "stale",
  );
  check(
    "a depth change renumbers the siblings, so they park too",
    (await stateOf("fr-en-worms")) === "stale" && (await stateOf("fr-en-toward")) === "stale",
    `worms=${await stateOf("fr-en-worms")}, toward=${await stateOf("fr-en-toward")}`,
  );
  check("parked relations lose their edges", (await edgeCount()) < edgesBefore);
  results = await translate(source, "en");
  check("a parked chain returns nothing", results.length === 0, JSON.stringify(results));

  // Re-affirming = publishing a new relation version pinned to the entry's
  // current version. The editor pre-fills exactly this.
  await ingestRelation(
    DID,
    relationURI("br-fr-v2"),
    "cid1",
    relationRecord(
      [
        { uri: entryURI("gwerzenn"), languageID: "br", place: [1], orthography: "gwerzenn" },
        { uri: entryURI("vers"), languageID: "fr", place: [1], orthography: "vers" },
      ],
      { subject: relationURI("br-fr") },
    ),
  );
  await ingestRelation(
    DID,
    relationURI("fr-en-verse-v2"),
    "cid1",
    relationRecord(
      [
        { uri: entryURI("vers"), languageID: "fr", place: [1], orthography: "vers" },
        { uri: entryURI("verse"), languageID: "en", place: [], orthography: "verse" },
      ],
      { subject: relationURI("fr-en-verse") },
    ),
  );
  check("re-affirmation is live again", (await stateOf("br-fr-v2")) === "live");
  const archived = await one<number>(aql`
    RETURN LENGTH(FOR r IN relations FILTER r.recordURI == ${relationURI("br-fr")} RETURN 1)
  `);
  const supersededCurrent = await one<boolean>(aql`
    FOR r IN relations FILTER r.recordURI == ${relationURI("br-fr")} LIMIT 1 RETURN r.current
  `);
  check("the superseded version is archived, not deleted", archived === 1 && supersededCurrent === false);
  results = await translate(source, "en");
  // Two paths now reach the same entry — one per sub-sense of the split — which
  // is why the endpoint groups by target entry rather than returning raw paths.
  const words = [...new Set(results.map((r) => r.word))];
  check(
    "re-affirmed: the chain reaches verse again, and only verse",
    words.length === 1 && words[0] === "verse",
    JSON.stringify(results),
  );
  // The now-coarse expansion: [1] covers two leaves after the split.
  const reaffirmedCoarse = results[0]!.coarse;
  check(
    "the re-affirmed hops are flagged coarse (the split made [1] cover two senses)",
    reaffirmedCoarse > 0,
    `coarse hops = ${reaffirmedCoarse}`,
  );

  console.log("\n--- reversion revives ---");
  await ingestEntry(DID, entryURI("vers"), "cid3", {
    ...entryRecord("fr", "vers", ["verse", "toward", "worms"]),
    subject: entryURI("vers"),
  });
  check(
    "reverting the tree revives the relations pinned to the original version",
    (await stateOf("fr-en-toward")) === "live" && (await stateOf("fr-en-worms")) === "live",
    `toward=${await stateOf("fr-en-toward")}, worms=${await stateOf("fr-en-worms")}`,
  );
  check(
    "and parks the ones re-affirmed against the tree that is gone",
    (await stateOf("br-fr-v2")) === "stale" && (await stateOf("fr-en-verse-v2")) === "stale",
    `br-fr-v2=${await stateOf("br-fr-v2")}`,
  );

  console.log("\n--- firehose replay must not undo a correction ---");
  // Jetstream resumes from a cursor saved seconds earlier, so the create of a
  // record that has since been corrected is redelivered.
  const replay = await ingestRelation(
    DID,
    relationURI("br-fr"),
    "cid1",
    relationRecord([
      { uri: entryURI("gwerzenn"), languageID: "br", place: [1], orthography: "gwerzenn" },
      { uri: entryURI("vers"), languageID: "fr", place: [1], orthography: "vers" },
    ]),
  );
  check("replaying an archived version is a no-op", replay === "skipped-duplicate", replay);
  check(
    "the correction is still current",
    (await one<boolean>(aql`
      FOR r IN relations FILTER r.recordURI == ${relationURI("br-fr-v2")} LIMIT 1 RETURN r.current
    `)) === true,
  );
  check(
    "and no second relation identity was minted for that record",
    (await one<number>(aql`
      RETURN LENGTH(FOR r IN relations FILTER r.recordURI == ${relationURI("br-fr")} RETURN 1)
    `)) === 1,
  );

  console.log("\n--- same-entry relations: senses, not self-loops ---");
  await ingestEntry(DID, entryURI("poly"), "cid1", entryRecord("br", "poly", ["one", "two"]));
  const polyKey = await entryKeyOf(entryURI("poly"));
  await ingestRelation(
    DID,
    relationURI("poly-self"),
    "cid1",
    relationRecord([
      { uri: entryURI("poly"), languageID: "br", place: [], orthography: "poly" },
      { uri: entryURI("poly"), languageID: "br", place: [1], orthography: "poly" },
    ]),
  );
  const selfEdges = await all<{ from: string; to: string }>(aql`
    FOR e IN relationEdges
      FILTER e.relationKey == FIRST(
        FOR r IN relations FILTER r.recordURI == ${relationURI("poly-self")} RETURN r.relationKey
      )
      RETURN { from: e._from, to: e._to }
  `);
  check(
    "overlapping prefixes on one entry drop the self-loop and keep the real pair",
    selfEdges.length === 1 && selfEdges[0]!.from === `senses/${polyKey}.2`,
    JSON.stringify(selfEdges),
  );

  console.log("\n--- arrival order: relation before entry ---");
  await ingestRelation(
    DID,
    relationURI("early"),
    "cid1",
    relationRecord([
      { uri: entryURI("gwerzenn"), languageID: "br", place: [1], orthography: "gwerzenn" },
      { uri: entryURI("later"), languageID: "cy", place: [1], orthography: "pennill" },
    ]),
  );
  check("a relation whose entry is missing parks unresolved", (await stateOf("early")) === "unresolved");
  await ingestEntry(DID, entryURI("later"), "cid1", entryRecord("cy", "pennill", ["verse"]));
  check("indexing that entry revives it", (await stateOf("early")) === "live");
  const revived = await translate(source, "cy");
  check("and it is traversable", revived.length === 1, JSON.stringify(revived));

  console.log("\n--- withdrawal, oversize, unknown kind, deletion ---");
  await ingestEntry(DID, entryURI("later"), "cid2", {
    ...entryRecord("cy", "pennill", ["verse"]),
    deleted: true,
    deletionReason: "duplicate",
    subject: entryURI("later"),
  });
  check("withdrawing an entry parks the relations pinning it", (await stateOf("early")) === "stale");
  check(
    "a withdrawn entry keeps no senses",
    (await one<number>(aql`
      RETURN LENGTH(FOR s IN senses FILTER s.entryKey == ${await entryKeyOf(entryURI("later"))} RETURN 1)
    `)) === 0,
  );

  // 17 × 16 senses = 272 pairs, past MAX_RELATION_EDGES (256).
  const many = (n: number) => Array.from({ length: n }, (_, i) => `sense ${i + 1}`);
  await ingestEntry(DID, entryURI("big-a"), "cid1", entryRecord("br", "bigA", many(17)));
  await ingestEntry(DID, entryURI("big-b"), "cid1", entryRecord("fr", "bigB", many(16)));
  await ingestRelation(
    DID,
    relationURI("oversize"),
    "cid1",
    relationRecord([
      { uri: entryURI("big-a"), languageID: "br", place: [], orthography: "bigA" },
      { uri: entryURI("big-b"), languageID: "fr", place: [], orthography: "bigB" },
    ]),
  );
  check("an expansion past the cap parks as oversize", (await stateOf("oversize")) === "oversize");
  check(
    "and writes no edges",
    (await one<number>(aql`
      RETURN LENGTH(FOR e IN relationEdges FILTER e.languages[0] == "br" AND e.languages[1] == "fr"
        FILTER e._from LIKE "%bigA%" RETURN 1)
    `)) === 0,
  );

  await ingestRelation(
    DID,
    relationURI("unknown-kind"),
    "cid1",
    relationRecord(
      [
        { uri: entryURI("gwerzenn"), languageID: "br", place: [1], orthography: "gwerzenn" },
        { uri: entryURI("song"), languageID: "en", place: [], orthography: "song" },
      ],
      { kind: "hypernym" },
    ),
  );
  check("an unknown kind is indexed, not rejected", (await stateOf("unknown-kind")) === "live");
  const unknownEdge = await one<{ traversable: boolean; kind: string }>(aql`
    FOR e IN relationEdges FILTER e.kind == "hypernym" LIMIT 1 RETURN { traversable: e.traversable, kind: e.kind }
  `);
  check(
    "its edge exists but is not traversable",
    unknownEdge?.traversable === false,
    JSON.stringify(unknownEdge),
  );
  check(
    "so it never appears in translation results",
    !(await translate(source, "en")).some((r) => r.word === "song"),
  );

  const dup = await ingestRelation(
    DID,
    relationURI("unknown-kind"),
    "cid1",
    relationRecord(
      [
        { uri: entryURI("gwerzenn"), languageID: "br", place: [1], orthography: "gwerzenn" },
        { uri: entryURI("song"), languageID: "en", place: [], orthography: "song" },
      ],
      { kind: "hypernym" },
    ),
  );
  check("replaying the same commit is a no-op", dup === "skipped-duplicate", dup);

  await ingestRelationDelete(relationURI("br-fr-v2"));
  check(
    "deleting the current version promotes the survivor",
    (await one<boolean>(aql`
      FOR r IN relations FILTER r.recordURI == ${relationURI("br-fr")} LIMIT 1 RETURN r.current
    `)) === true,
  );
  await ingestRelationDelete(relationURI("br-fr"));
  check(
    "deleting the last version removes the relation entirely",
    (await one<number>(aql`
      RETURN LENGTH(FOR r IN relations FILTER r.sides[0].languageID == "br"
        AND r.sides[1].languageID == "fr" AND r.recordURI LIKE "%br-fr%" RETURN 1)
    `)) === 0,
  );

  await ingestEntryDelete(entryURI("worms"));
  check(
    "deleting an entry record parks the relations pinning it",
    (await stateOf("fr-en-worms")) === "unresolved",
    `${await stateOf("fr-en-worms")}`,
  );

  console.log("\n--- a deleted-then-republished entry is not parked forever ---");
  await ingestEntry(DID, entryURI("phoenix"), "cid1", entryRecord("br", "phoenix", ["rise"]));
  await ingestEntry(DID, entryURI("ashes"), "cid1", entryRecord("fr", "cendres", ["rise"]));
  await ingestRelation(
    DID,
    relationURI("phoenix"),
    "cid1",
    relationRecord([
      { uri: entryURI("phoenix"), languageID: "br", place: [1], orthography: "phoenix" },
      { uri: entryURI("ashes"), languageID: "fr", place: [1], orthography: "cendres" },
    ]),
  );
  check("live before the deletion", (await stateOf("phoenix")) === "live");
  await ingestEntryDelete(entryURI("phoenix"));
  check("parked when the entry's last record is deleted", (await stateOf("phoenix")) === "unresolved");
  // Republishing at the same rkey mints a NEW entryKey, since no doc with that
  // record URI survived — the relation's cached entryKey is dead.
  await ingestEntry(DID, entryURI("phoenix"), "cid2", entryRecord("br", "phoenix", ["rise"]));
  check(
    "republishing at the same rkey revives it under the new entry key",
    (await stateOf("phoenix")) === "live",
    `${await stateOf("phoenix")}`,
  );

  console.log("\n--- an entry changing language updates its edges ---");
  await ingestEntry(DID, entryURI("ashes"), "cid2", {
    ...entryRecord("cy", "cendres", ["rise"]),
    subject: entryURI("ashes"),
  });
  const relanguaged = await one<string[]>(aql`
    FOR e IN relationEdges
      FILTER e.relationKey == FIRST(
        FOR r IN relations FILTER r.recordURI == ${relationURI("phoenix")} RETURN r.relationKey
      )
      LIMIT 1
      RETURN e.languages
  `);
  check(
    "the edge carries the entry's new language, not the record's claim",
    relanguaged?.includes("cy") === true && relanguaged?.includes("fr") === false,
    JSON.stringify(relanguaged),
  );

  console.log("\n--- db:init rebuild is idempotent ---");
  const beforeRebuild = await edgeCount();
  const states = await all<{ recordURI: string; state: string }>(aql`
    FOR r IN relations FILTER r.current == true SORT r.recordURI RETURN { recordURI: r.recordURI, state: r.state }
  `);
  const rebuilt = await rebuildSemanticNetwork(db);
  const afterRebuild = await edgeCount();
  const statesAfter = await all<{ recordURI: string; state: string }>(aql`
    FOR r IN relations FILTER r.current == true SORT r.recordURI RETURN { recordURI: r.recordURI, state: r.state }
  `);
  check(
    "a wholesale rebuild reproduces the same edges",
    beforeRebuild === afterRebuild,
    `${beforeRebuild} → ${afterRebuild}`,
  );
  check(
    "and the same states",
    JSON.stringify(states) === JSON.stringify(statesAfter),
    JSON.stringify(rebuilt.states),
  );

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("verification crashed:", err);
  process.exit(1);
});
