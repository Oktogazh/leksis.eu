import { aql } from "arangojs";
import {
  compareDefinitionPlaces,
  placePathKey,
  TRANSLATE_MAX_DEPTH,
  type EntryRelationsResponse,
  type RelationSideView,
  type RelationState,
  type RelationView,
  type TranslateResponse,
  type TranslationEntry,
  type TranslationHop,
  type TranslationSenseGroup,
  type TranslationTarget,
} from "@leksis/types";
import { db } from "./db";

// Read path of the semantic network. Unlike the grammar layers, this loop's API
// cost is deliberately non-zero: the traversal cannot run anywhere but the
// AppView. What it serves is still only shape and pointers — definition texts
// and a relation's notes stay on their authors' PDSs, and the client resolves
// them exactly as it already does for an entry.

/** Source entries one translation search will traverse from. */
const TRANSLATE_SOURCE_LIMIT = 20;
/**
 * Paths kept per source sense. A well-connected sense can be reached by very
 * many equivalent routes; the ranking only ever shows the best per target, so
 * this bounds the work without changing the answer in practice.
 */
const TRANSLATE_PATHS_PER_SENSE = 200;
/** Parked relations served on one language dashboard. */
const PARKED_LIMIT = 100;

/**
 * A side, joined to its entry's current version. Written once because the entry
 * page and the dashboard queue both need it: the record's own spelling is the
 * fallback, the resolved entry's is the truth.
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
      entryKey: side.entryKey,
      languageID: side.languageID,
      place: side.place,
      orthography: entry.orthography[0],
      recordedOrthography: side.orthography
    }
`;

interface RelationRow {
  relationKey: string;
  kind: string | null;
  state: RelationState;
  recordURI: string;
  authorDID: string;
  indexedAt: string;
  sides: RelationSideView[];
}

function toRelationView(row: RelationRow): RelationView {
  return { ...row, sides: [row.sides[0]!, row.sides[1]!] };
}

/**
 * Every current relation touching one entry, split into what can be shown and
 * what needs repair. `sides[0]` is always this entry's side, so the caller can
 * group by its own senses without inspecting both ends.
 *
 * Read from `relations` rather than from the edges, deliberately: the edges have
 * had the prefix expanded away, and the entry page needs the distinction back —
 * a whole-entry relation belongs on the header, a sense's under its definition.
 * It is also what makes the parked ones available in the same pass, since a
 * parked relation has no edges at all.
 */
export async function getEntryRelations(entryKey: string): Promise<EntryRelationsResponse> {
  const cursor = await db.query<RelationRow>(aql`
    FOR r IN relations
      FILTER r.current == true AND ${entryKey} IN r.sides[*].entryKey
      LET ordered = r.sides[0].entryKey == ${entryKey} ? r.sides : REVERSE(r.sides)
      LET sides = (${sideView})
      SORT LENGTH(sides[0].place), sides[0].place, sides[1].languageID, sides[1].orthography
      RETURN {
        relationKey: r.relationKey,
        kind: r.kind,
        state: r.state,
        recordURI: r.recordURI,
        authorDID: r.authorDID,
        indexedAt: r.indexedAt,
        sides
      }
  `);
  const rows = await cursor.all();
  return {
    entryKey,
    relations: rows.filter((r) => r.state === "live").map(toRelationView),
    parked: rows.filter((r) => r.state !== "live").map(toRelationView),
  };
}

/** One vertex of a returned path. Attributes are null when a vertex is missing. */
interface PathVertex {
  id: string | null;
  entryKey: string | null;
  languageID: string | null;
  place: number[] | null;
}

interface PathRow {
  hops: number;
  coarseHops: number;
  vertices: PathVertex[];
  edges: { from: string; to: string; coarseFrom: boolean; coarseTo: boolean }[];
}

interface SourceRow {
  entry: {
    entryKey: string;
    languageID: string;
    orthography: string[];
    recordURI: string;
    authorDID: string;
  };
  groups: { place: number[]; paths: PathRow[] }[];
}

interface EntryMeta {
  entryKey: string;
  languageID: string;
  orthography: string[];
  recordURI: string;
  authorDID: string;
}

/** Hops first, then coarse hops — the pre-voting quality signal. */
function betterPath(a: PathRow, b: PathRow): number {
  return a.hops - b.hops || a.coarseHops - b.coarseHops;
}

/**
 * Whether the assertion that reached `vertices[index]` covered every sense of
 * that word.
 *
 * The flags are stored relative to the edge's own `_from`/`_to`, while the
 * traversal is `ANY` and so crosses half its edges backwards — hence the
 * comparison rather than a plain read.
 */
function coarseAt(path: PathRow, index: number): boolean {
  const edge = path.edges[index - 1];
  const vertex = path.vertices[index];
  if (!edge || !vertex) return false;
  return edge.from === vertex.id ? edge.coarseFrom : edge.coarseTo;
}

/**
 * Translation search: from every sense of the entries matching the query in the
 * source language, the nearest equivalents in the target language.
 *
 * Meaning-preservation is structural rather than checked — a path enters and
 * leaves an intermediate word through the *same* sense vertex, so a chain
 * through French *vers* in its "verse" sense cannot continue from its "worms"
 * sense. Antonyms and kinds this AppView does not know are excluded by the
 * edge's own `traversable` flag, so an unrecognised kind is never traversed by
 * default.
 */
export async function getTranslations(
  query: string,
  from: string,
  to: string,
  depth: number,
): Promise<TranslateResponse> {
  const q = query.trim().toLowerCase();
  const clamped = Math.min(Math.max(Math.trunc(depth) || 1, 1), TRANSLATE_MAX_DEPTH);
  const empty: TranslateResponse = { query: q, from, to, depth: clamped, entries: [] };
  if (q === "") return empty;

  const cursor = await db.query<SourceRow>(aql`
    LET sources = (
      FOR e IN entries
        FILTER e.current == true AND e.deleted != true AND e.languageID == ${from}
        FILTER LENGTH(FOR s IN e.search FILTER STARTS_WITH(s, ${q}) LIMIT 1 RETURN 1) > 0
        SORT ${q} IN e.search DESC, e.search[0] ASC
        LIMIT ${TRANSLATE_SOURCE_LIMIT}
        RETURN {
          entryKey: e.entryKey,
          languageID: e.languageID,
          orthography: e.orthography,
          recordURI: e.recordURI,
          authorDID: e.authorDID
        }
    )
    FOR src IN sources
      LET groups = (
        FOR s IN senses
          FILTER s.entryKey == src.entryKey
          SORT s.place
          LET paths = (
            FOR v, e, p IN 1..${clamped} ANY s._id relationEdges
              PRUNE v.languageID == ${to}
              OPTIONS { order: "bfs", uniqueVertices: "path" }
              FILTER v != null AND v.languageID == ${to}
              FILTER p.edges[*].traversable ALL == true
              LIMIT ${TRANSLATE_PATHS_PER_SENSE}
              RETURN {
                hops: LENGTH(p.edges),
                coarseHops: LENGTH(p.edges[* FILTER CURRENT.coarse]),
                vertices: (
                  FOR pv IN p.vertices
                    RETURN {
                      id: pv._id,
                      entryKey: pv.entryKey,
                      languageID: pv.languageID,
                      place: pv.place
                    }
                ),
                edges: (
                  FOR pe IN p.edges
                    RETURN {
                      from: pe._from,
                      to: pe._to,
                      coarseFrom: pe.coarseFrom,
                      coarseTo: pe.coarseTo
                    }
                )
              }
          )
          RETURN { place: s.place, paths }
      )
      RETURN { entry: src, groups }
  `);
  const sources = await cursor.all();
  if (sources.length === 0) return empty;

  // Every hop the answer will print, resolved in one query: the client is given
  // orthographies and record pointers, and fetches the definitions itself.
  const referenced = new Set<string>();
  for (const src of sources) {
    for (const group of src.groups) {
      for (const path of group.paths) {
        for (const vertex of path.vertices) {
          if (vertex.entryKey !== null) referenced.add(vertex.entryKey);
        }
      }
    }
  }
  const metaCursor = await db.query<EntryMeta>(aql`
    FOR e IN entries
      FILTER e.entryKey IN ${[...referenced]} AND e.current == true
      RETURN {
        entryKey: e.entryKey,
        languageID: e.languageID,
        orthography: e.orthography,
        recordURI: e.recordURI,
        authorDID: e.authorDID
      }
  `);
  const meta = new Map((await metaCursor.all()).map((row) => [row.entryKey, row]));

  const entries: TranslationEntry[] = sources.map((src) => {
    const senses: TranslationSenseGroup[] = src.groups.map((group) => {
      // Group by target entry: several senses of one word, or several routes to
      // the same sense, are one answer to the reader.
      const byTarget = new Map<string, { best: PathRow; places: Map<string, number[]> }>();
      for (const path of group.paths) {
        // A vertex can be missing if a sense row was removed while an edge
        // still pointed at it. Such a path is dropped rather than shown with a
        // hole in it.
        if (path.vertices.some((v) => v.id === null || v.entryKey === null)) continue;
        const target = path.vertices[path.vertices.length - 1]!;
        const key = target.entryKey!;
        if (!meta.has(key)) continue;
        const found = byTarget.get(key);
        if (!found) {
          byTarget.set(key, {
            best: path,
            places: new Map([[placePathKey(target.place ?? []), target.place ?? []]]),
          });
          continue;
        }
        found.places.set(placePathKey(target.place ?? []), target.place ?? []);
        if (betterPath(path, found.best) < 0) found.best = path;
      }

      const targets: TranslationTarget[] = [...byTarget.entries()].map(([key, { best, places }]) => {
        const info = meta.get(key)!;
        const via: TranslationHop[] = [];
        for (let i = 1; i < best.vertices.length - 1; i++) {
          const vertex = best.vertices[i]!;
          const hopMeta = meta.get(vertex.entryKey!);
          via.push({
            entryKey: vertex.entryKey!,
            languageID: vertex.languageID ?? hopMeta?.languageID ?? "",
            orthography: hopMeta?.orthography[0] ?? "",
            place: vertex.place ?? [],
            coarse: coarseAt(best, i),
          });
        }
        return {
          entryKey: info.entryKey,
          languageID: info.languageID,
          orthography: info.orthography,
          recordURI: info.recordURI,
          authorDID: info.authorDID,
          senses: [...places.values()].sort(compareDefinitionPlaces),
          hops: best.hops,
          coarseHops: best.coarseHops,
          via,
        };
      });
      targets.sort(
        (a, b) =>
          a.hops - b.hops ||
          a.coarseHops - b.coarseHops ||
          (a.orthography[0] ?? "").localeCompare(b.orthography[0] ?? ""),
      );
      // An empty group is kept: it is how the reader sees which parts of their
      // word the dictionary cannot translate yet.
      return { place: group.place, targets };
    });
    return { ...src.entry, senses };
  });

  return { query: q, from, to, depth: clamped, entries };
}

/** Current relations with a side in this language, by lifecycle state. */
export async function getRelationCounts(tag: string): Promise<Record<RelationState, number>> {
  const cursor = await db.query<{ state: RelationState; count: number }>(aql`
    FOR r IN relations
      FILTER r.current == true AND ${tag} IN r.sides[*].languageID
      COLLECT state = r.state WITH COUNT INTO count
      RETURN { state, count }
  `);
  const counts: Record<RelationState, number> = { live: 0, stale: 0, unresolved: 0, oversize: 0 };
  for (const row of await cursor.all()) counts[row.state] = row.count;
  return counts;
}

/**
 * Senses of this language no live equivalence assertion reaches — the size of
 * what is left to translate, and the reason every leaf is materialized as a
 * vertex rather than only the related ones.
 *
 * Antonym and unknown-kind edges do not count, which is what `traversable`
 * already means: they are not translations. Neither does a same-language
 * equivalence — a synonym is a legitimate assertion but it is not a
 * translation, and counting one would report a sense as covered while no other
 * language reaches it.
 */
export async function getUntranslatedSenseCount(tag: string): Promise<number> {
  const cursor = await db.query<number>(aql`
    RETURN LENGTH(
      FOR s IN senses
        FILTER s.languageID == ${tag}
        LET reached = FIRST(
          FOR v, e IN 1..1 ANY s._id relationEdges
            FILTER e.traversable == true AND e.languages[0] != e.languages[1]
            LIMIT 1
            RETURN 1
        )
        FILTER reached == null
        RETURN 1
    )
  `);
  return (await cursor.next()) ?? 0;
}

/**
 * The parked-relations queue for one language: repairing drift is expected,
 * recurring lexicographic work, so it gets the same first-class worklist
 * treatment as todo-flagged entries. A relation lists on **both** sides'
 * languages — either side's editor may be the one able to re-affirm it — and
 * `sides[0]` is this language's side.
 */
export async function getParkedRelations(tag: string): Promise<RelationView[]> {
  const cursor = await db.query<RelationRow>(aql`
    FOR r IN relations
      FILTER r.current == true AND r.state != "live" AND ${tag} IN r.sides[*].languageID
      SORT r.indexedAt DESC
      LIMIT ${PARKED_LIMIT}
      LET ordered = r.sides[0].languageID == ${tag} ? r.sides : REVERSE(r.sides)
      LET sides = (${sideView})
      RETURN {
        relationKey: r.relationKey,
        kind: r.kind,
        state: r.state,
        recordURI: r.recordURI,
        authorDID: r.authorDID,
        indexedAt: r.indexedAt,
        sides
      }
  `);
  return (await cursor.all()).map(toRelationView);
}
