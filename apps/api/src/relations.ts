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
  type TranslationSense,
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
/** Relations served for one entry, live and parked separately. */
const ENTRY_RELATIONS_LIMIT = 200;
/**
 * Wall-clock and memory ceilings on the traversal. `/translate` is public and
 * unauthenticated, and simple-path enumeration grows with the graph's degree,
 * so the query is bounded by the server rather than trusted to be small: a
 * request that would occupy the database for minutes fails instead.
 */
const TRANSLATE_MAX_RUNTIME_S = 5;
const TRANSLATE_MEMORY_LIMIT = 256 * 1024 * 1024;

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
      entryKey: entry == null ? null : side.entryKey,
      languageID: side.languageID,
      place: side.place,
      orthography: entry.orthography[0],
      recordedOrthography: side.orthography
    }
`;
// `entryKey` is nulled when no current entry doc exists, which is the type's own
// invariant: ingest keeps the last resolved key on the side so it can re-anchor,
// but serving it would hand a client a link that 404s. What remains for such a
// side is `recordedOrthography` — the whole reason the record denormalizes it.

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
  // Live and parked are capped separately: one bot importing thousands of
  // translations for a common word must not crowd the repair strip out of the
  // response, nor make the entry page's request grow without bound.
  const fetch = async (live: boolean): Promise<RelationView[]> => {
    const cursor = await db.query<RelationRow>(aql`
      FOR r IN relations
        FILTER r.current == true AND ${entryKey} IN r.sides[*].entryKey
        FILTER ${live ? aql`r.state == "live"` : aql`r.state != "live"`}
        SORT r.indexedAt DESC
        LIMIT ${live ? ENTRY_RELATIONS_LIMIT : PARKED_LIMIT}
        LET ordered = r.sides[0].entryKey == ${entryKey} ? r.sides : REVERSE(r.sides)
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
    // Reading order comes from the shared place comparator, not from AQL's array
    // ordering: AQL would put sense [2] before sense [1,1], which is not the
    // order the entry itself is displayed in.
    return (await cursor.all())
      .map(toRelationView)
      .sort(
        (a, b) =>
          compareDefinitionPlaces(a.sides[0].place, b.sides[0].place) ||
          compareStrings(a.sides[1].languageID, b.sides[1].languageID) ||
          compareStrings(a.sides[1].orthography ?? "", b.sides[1].orthography ?? ""),
      );
  };
  return { entryKey, relations: await fetch(true), parked: await fetch(false) };
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

/** Byte order, matching how AQL sorts orthographies everywhere else. */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Whether an edge was coarse **on the end that is this vertex**.
 *
 * The flags are stored relative to the edge's own `_from`/`_to`, while the
 * traversal is `ANY` and so crosses half its edges backwards — hence the
 * comparison rather than a plain read.
 */
function coarseOnEdge(
  edge: PathRow["edges"][number] | undefined,
  vertex: PathVertex | undefined,
): boolean {
  if (!edge || !vertex) return false;
  return edge.from === vertex.id ? edge.coarseFrom : edge.coarseTo;
}

/**
 * Whether **either** assertion touching `vertices[index]` covered every sense of
 * that word — the one the path arrived by, or the one it left by.
 *
 * Both matter to a reader: "via *vers*, all senses" is just as true when the
 * imprecise claim is the one the chain departed on, and reading only the
 * incoming edge would print a precise-looking hop for the case §4.2 most wants
 * disclosed.
 */
function coarseAt(path: PathRow, index: number): boolean {
  const vertex = path.vertices[index];
  return (
    coarseOnEdge(path.edges[index - 1], vertex) || coarseOnEdge(path.edges[index], vertex)
  );
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

  const cursor = await db.query<SourceRow>(
    aql`
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
              PRUNE e != null AND (
                v.languageID == ${to}
                OR v.entryKey IN SLICE(p.vertices, 0, LENGTH(p.vertices) - 1)[*].entryKey
              )
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
    `,
    // The path LIMIT counts *filtered* results, so it binds the traversal only
    // when the target language is richly reachable; when it is not, enumeration
    // runs to exhaustion. These ceilings are what actually bounds a public,
    // unauthenticated request: past them it fails loudly instead of occupying
    // the database.
    { maxRuntime: TRANSLATE_MAX_RUNTIME_S, memoryLimit: TRANSLATE_MEMORY_LIMIT },
  );
  const sources = await cursor.all();
  if (sources.length === 0) return empty;

  // The best path per (source sense → target sense). Provenance is earned by a
  // sense, not by a word: two senses of one target can be reached by very
  // different chains, and one badge for the entry would describe the best of
  // them and vouch for the rest.
  type Chosen = Map<string, Map<string, PathRow>>;
  const chosenPerGroup: Chosen[] = [];
  const referenced = new Set<string>();
  for (const src of sources) {
    for (const group of src.groups) {
      const byTarget: Chosen = new Map();
      for (const path of group.paths) {
        // A vertex can be missing if a sense row was removed while an edge still
        // pointed at it. Such a path is dropped rather than shown with a hole in
        // it — a wrong translation is worse than a missing one.
        if (path.vertices.some((v) => v.id === null || v.entryKey === null)) continue;
        const target = path.vertices[path.vertices.length - 1]!;
        const key = target.entryKey!;
        const senses = byTarget.get(key) ?? new Map<string, PathRow>();
        const sensePath = senses.get(placePathKey(target.place ?? []));
        if (!sensePath || betterPath(path, sensePath) < 0) {
          senses.set(placePathKey(target.place ?? []), path);
        }
        byTarget.set(key, senses);
      }
      // Only the paths that survived selection are printed, so only their hops
      // need resolving.
      for (const senses of byTarget.values()) {
        for (const path of senses.values()) {
          for (const vertex of path.vertices) {
            if (vertex.entryKey !== null) referenced.add(vertex.entryKey);
          }
        }
      }
      chosenPerGroup.push(byTarget);
    }
  }

  // Every hop the answer will print, resolved in one query: the client is given
  // orthographies and record pointers, and fetches the definitions itself.
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

  /** The intermediate words of one path, or null if any of them is unnameable. */
  const buildVia = (path: PathRow): TranslationHop[] | null => {
    const via: TranslationHop[] = [];
    for (let i = 1; i < path.vertices.length - 1; i++) {
      const vertex = path.vertices[i]!;
      const hopMeta = meta.get(vertex.entryKey!);
      // A chain with a hop it cannot name is a hole in the reader's only trust
      // surface, so the path goes rather than the name.
      if (!hopMeta) return null;
      via.push({
        entryKey: vertex.entryKey!,
        languageID: vertex.languageID ?? hopMeta.languageID,
        orthography: hopMeta.orthography[0] ?? "",
        place: vertex.place ?? [],
        coarse: coarseAt(path, i),
      });
    }
    return via;
  };

  let group = 0;
  const entries: TranslationEntry[] = sources.map((src) => {
    const senses: TranslationSenseGroup[] = src.groups.map((sourceSense) => {
      const byTarget = chosenPerGroup[group++]!;
      const targets: TranslationTarget[] = [];
      for (const [key, sensePaths] of byTarget) {
        const info = meta.get(key);
        if (!info) continue;
        const reached: TranslationSense[] = [];
        for (const [, path] of sensePaths) {
          const via = buildVia(path);
          if (via === null) continue;
          const target = path.vertices[path.vertices.length - 1]!;
          reached.push({
            place: target.place ?? [],
            hops: path.hops,
            coarseHops: path.coarseHops,
            via,
            // The final hop's own coarseness — no `via` entry carries it,
            // because the target is not an intermediate.
            coarse: coarseOnEdge(path.edges[path.edges.length - 1], target),
          });
        }
        if (reached.length === 0) continue;
        reached.sort((a, b) => compareDefinitionPlaces(a.place, b.place));
        const best = reached.reduce((a, b) =>
          a.hops - b.hops || a.coarseHops - b.coarseHops <= 0 ? a : b,
        );
        targets.push({
          entryKey: info.entryKey,
          languageID: info.languageID,
          orthography: info.orthography,
          recordURI: info.recordURI,
          authorDID: info.authorDID,
          senses: reached,
          hops: best.hops,
          coarseHops: best.coarseHops,
        });
      }
      targets.sort(
        (a, b) =>
          a.hops - b.hops ||
          a.coarseHops - b.coarseHops ||
          compareStrings(a.orthography[0] ?? "", b.orthography[0] ?? ""),
      );
      // An empty group is kept: it is how the reader sees which parts of their
      // word the dictionary cannot translate yet.
      return { place: sourceSense.place, targets };
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
  // Counted from the edges inward rather than by probing each sense: one pass
  // over a derived collection instead of an index lookup per sense, which on a
  // large language is the difference between one query and a hundred thousand
  // probes on a public route.
  const cursor = await db.query<number>(aql`
    LET total = LENGTH(FOR s IN senses FILTER s.languageID == ${tag} RETURN 1)
    LET translated = LENGTH(UNIQUE(
      FOR e IN relationEdges
        FILTER e.traversable == true AND e.languages[0] != e.languages[1]
        FILTER e.languages[0] == ${tag} OR e.languages[1] == ${tag}
        RETURN e.languages[0] == ${tag} ? e._from : e._to
    ))
    RETURN total - translated
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
      // Ordered by when it PARKED, not when its version was indexed: a relation
      // that drifted today but was published a year ago must not sort below the
      // cap and become permanently invisible on the one list meant to surface it.
      SORT NOT_NULL(r.stateChangedAt, r.indexedAt) DESC
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
