import { aql } from "arangojs";
import {
  MAX_COGNATE_NETWORK_DEPTH,
  MAX_COGNATE_NETWORK_NODES,
  type CognateLink,
  type CognateNetworkResponse,
  type CognateNode,
  type CognateSideView,
  type CognateState,
  type CognateView,
} from "@leksis/types";
import { db } from "./db";

// Read path of the cognate network.
//
// One endpoint, and it answers a different *kind* of question than /translate
// does. A translation search is a question with an answer — "what is this in
// Welsh?" — so it prunes at a target language and ranks what it finds. A
// cognate network has no target: the shape of the whole component *is* the
// thing worth showing, because that shape is the evidence about how the
// languages relate. So this serves the component and lets the client draw it.
//
// Computed per request, with no stored component. A component is derived data
// twice over — it is exactly the transitive closure of the edges — so caching
// it would add an invalidation problem (every cognate write reshapes an
// unbounded number of components) to buy a traversal that is bounded at 500
// vertices. As everywhere else, no content is served: the client resolves
// records from their authors' PDSs.

/** Parked cognates served for one entry — the repair strip. */
const PARKED_LIMIT = 100;

interface NodeRow {
  entryKey: string | null;
  languageID: string | null;
  orthography: string[] | null;
  recordURI: string | null;
  authorDID: string | null;
  distance: number;
}

interface LinkRow {
  cognateKey: string;
  sides: [string, string];
  recordURI: string;
  authorDID: string;
}

interface CognateRow {
  cognateKey: string;
  state: CognateState;
  recordURI: string;
  authorDID: string;
  indexedAt: string;
  sides: CognateSideView[];
}

/**
 * A side, joined to its entry's current version — the relation model's
 * `sideView`, minus the sense address.
 */
const sideView = aql`
  FOR side IN ordered
    LET entry = FIRST(
      FOR e IN entries
        FILTER e.entryKey == side.entryKey AND e.current == true
        LIMIT 1
        RETURN e
    )
    RETURN {
      entryKey: entry == null ? null : side.entryKey,
      languageID: side.languageID,
      orthography: entry.orthography[0],
      recordedOrthography: side.orthography
    }
`;
// `entryKey` is nulled when no current entry doc exists: ingest keeps the last
// resolved key on the side so it can re-anchor, but serving it would hand a
// client a link that 404s. What remains is `recordedOrthography` — the whole
// reason the record denormalizes a spelling.

/**
 * The connected component of cognates around one entry, plus that entry's own
 * parked assertions.
 *
 * Everything the nodes print comes off the `lexemes` vertices, which
 * denormalize it precisely so this is one traversal and no join — see
 * ingest-cognate.ts, where every entry version transition refreshes them.
 */
export async function getCognateNetwork(entryKey: string): Promise<CognateNetworkResponse> {
  const start = `lexemes/${entryKey}`;

  // Breadth-first with globally unique vertices, so a vertex is visited once
  // and by its shortest route — which is what makes `distance` the number of
  // assertions between this word and that one rather than the length of
  // whichever path the traversal happened to walk first.
  //
  // One over the cap is fetched so that hitting it is distinguishable from
  // fitting exactly inside it.
  const nodesCursor = await db.query<NodeRow>(aql`
    FOR v, e, p IN 0..${MAX_COGNATE_NETWORK_DEPTH} ANY ${start} cognateEdges
      OPTIONS { bfs: true, uniqueVertices: "global" }
      FILTER v != null
      LIMIT ${MAX_COGNATE_NETWORK_NODES + 1}
      RETURN {
        entryKey: v.entryKey,
        languageID: v.languageID,
        orthography: v.orthography,
        recordURI: v.recordURI,
        authorDID: v.authorDID,
        distance: LENGTH(p.edges)
      }
  `);
  const rows = await nodesCursor.all();
  const capped = rows.slice(0, MAX_COGNATE_NETWORK_NODES);

  const nodes: CognateNode[] = capped
    // A vertex whose entry vanished between the traversal and now would print
    // as a blank; it is dropped rather than served half-formed. Its edges then
    // read as reaching outside the set, which is what `truncated` reports.
    .filter(
      (row): row is NodeRow & CognateNode =>
        row.entryKey !== null &&
        row.languageID !== null &&
        row.orthography !== null &&
        row.recordURI !== null &&
        row.authorDID !== null,
    )
    .map((row) => ({
      entryKey: row.entryKey,
      languageID: row.languageID,
      orthography: row.orthography,
      recordURI: row.recordURI,
      authorDID: row.authorDID,
      distance: row.distance,
    }));

  const ids = nodes.map((n) => `lexemes/${n.entryKey}`);

  // Links *within* the served set, and whether anything was left outside it.
  //
  // The outside check is exact and independent of which cap bit: any edge with
  // one end in the set and one end out means the reader is not seeing the whole
  // component, whether the node cap, the depth cap or a dropped vertex caused
  // it. Reporting that from the graph itself beats inferring it from
  // `rows.length`, which would miss the depth case entirely.
  const linksCursor = await db.query<{ links: LinkRow[]; outside: boolean }>(aql`
    LET ids = ${ids}
    LET links = (
      FOR e IN cognateEdges
        FILTER e._from IN ids AND e._to IN ids
        LET c = FIRST(
          FOR c IN cognates
            FILTER c.cognateKey == e.cognateKey AND c.current == true
            LIMIT 1
            RETURN c
        )
        FILTER c != null
        RETURN {
          cognateKey: e.cognateKey,
          sides: [PARSE_IDENTIFIER(e._from).key, PARSE_IDENTIFIER(e._to).key],
          recordURI: c.recordURI,
          authorDID: c.authorDID
        }
    )
    LET outside = LENGTH(
      FOR e IN cognateEdges
        FILTER (e._from IN ids AND e._to NOT IN ids)
          OR (e._to IN ids AND e._from NOT IN ids)
        LIMIT 1
        RETURN 1
    ) > 0
    RETURN { links, outside }
  `);
  const linkResult = (await linksCursor.next()) ?? { links: [], outside: false };

  // Parallel assertions of the same pair are kept as separate links rather than
  // collapsed: how many people independently claimed a pair is evidence, and it
  // is what voting will eventually score.
  const links: CognateLink[] = linkResult.links.map((row) => ({
    cognateKey: row.cognateKey,
    sides: row.sides,
    recordURI: row.recordURI,
    authorDID: row.authorDID,
  }));

  const parkedCursor = await db.query<CognateRow>(aql`
    FOR c IN cognates
      FILTER c.current == true AND ${entryKey} IN c.sides[*].entryKey
      FILTER c.state != "live"
      SORT NOT_NULL(c.stateChangedAt, c.indexedAt) DESC
      LIMIT ${PARKED_LIMIT}
      LET ordered = c.sides[0].entryKey == ${entryKey} ? c.sides : REVERSE(c.sides)
      LET sides = (${sideView})
      RETURN {
        cognateKey: c.cognateKey,
        state: c.state,
        recordURI: c.recordURI,
        authorDID: c.authorDID,
        indexedAt: c.indexedAt,
        sides
      }
  `);
  const parked: CognateView[] = (await parkedCursor.all()).map((row) => ({
    ...row,
    sides: [row.sides[0]!, row.sides[1]!],
  }));

  // Nodes are ordered by distance, then language, then spelling: a stable order
  // the client can render without sorting, and one that puts the word asked
  // about first and its direct cognates next.
  nodes.sort(
    (a, b) =>
      a.distance - b.distance ||
      compareStrings(a.languageID, b.languageID) ||
      compareStrings(a.orthography[0] ?? "", b.orthography[0] ?? ""),
  );

  return {
    entryKey,
    nodes,
    links,
    parked,
    truncated: rows.length > MAX_COGNATE_NETWORK_NODES || linkResult.outside,
  };
}

/** Byte order, matching how AQL sorts orthographies everywhere else. */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
