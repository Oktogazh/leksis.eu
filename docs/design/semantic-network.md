# Design note: the semantic network

**Status:** Designed, not implemented. This note is the source for **content loop 5 (translations)**
and the reference frame for everything that later grows on the same graph (weighting, cognates,
etymology, sentence translation memory). When the loop ships, its ADR and the code become
authoritative over this note for anything they cover.
**Date:** 2026-08-04.
**For:** Content loop 5 — "cross-language graph traversal" — and the search/entry-page surfaces it needs.
**Related:** the white paper (word-to-word translation sections, superseded where marked),
ADR-0003 (firehose + versioned indexing), ADR-0004 (derived read models),
`lexicons/eu.leksis.entry.json` (the `place` addressing this loop was promised),
`docs/design/grammatical-tagging.md` (style precedent; the sense-level tagging this note joins onto).

> **How to read this.** §0 is binding on every session that touches the network. §1 is what has been
> **verified at source** — treat anything absent from it as unknown. §§2–4 are the design; §5 the build
> slices; §6 the seams reserved for future arcs; §7 what is deliberately open. Decisions are referred to
> **by name**, in bold, so references survive edits.

---

## 0. Governing rules

**Meaning is the invariant; the gwerzenn test is the acceptance test.** The network exists to make
indirect translation *meaning-preserving*: Breton *gwerzenn* ("verse") reaches English *verse* through
French *vers*, and must never reach *worms* or *toward*, which are translations of the *other* senses of
*vers*. Any design change that could let a path jump senses inside an intermediate word is wrong even if
it works. The white paper identified this as the reason word-to-word translation alone is "too simple
for a prototype"; this note is the answer.

**A wrong translation is worse than a missing one.** Wherever the design must choose between serving
possibly-drifted data and going quiet, it goes quiet — and loud on a worklist. This is the rule behind
**pin to the version, compare the subtree, park what drifted** (§3.3).

**Every relation is a user-authored record.** The default answer for new linguistic knowledge is a new
`eu.leksis.*` lexicon, not a table only admins can write. Relations live on their authors' PDSs; the
AppView indexes shape and pointers, never content. Definition texts stay out of the database — the
frontend resolves them from the author's PDS exactly as it does today.

**No AppView-minted keys inside records.** A record references another record by its `at://` URI, never
by `entryKey` or any other index key — same principle as `subject`. A reference the AppView cannot
resolve degrades (parks), it never rejects.

**Records prove authorship, not ownership.** Relations follow the entries model exactly: full rewrites,
`subject`-style versioning, last-write-wins across authors, archival with `current: false`, deletion
mirroring the network. Version history is the substrate the voting mechanism will act on.

**Weighting is a seam, not a feature.** The weighted semantic network (scores on edges, trust-ranked
paths) is out of scope and must stay buildable without reshaping anything here. §6.1 names the seam and
its one hard constraint (AQL forbids negative weights).

**Verify at the source.** §1's ArangoDB facts were fetched from the 3.12 documentation on 2026-08-04.
Do not extend them from model recall; re-fetch before relying on anything not listed there.

---

## 1. Verified at source

### 1.1 ArangoDB 3.12 graph queries (docs fetched 2026-08-04)

- **Traversals** (`FOR v, e, p IN min..max OUTBOUND|INBOUND|ANY start edgeCol1, …`) work on
  **anonymous edge-collection sets** — no named graph object required; vertex collections are
  determined by the edges. `p.vertices` / `p.edges` expose the whole path.
- **`PRUNE`** stops expansion early (one clause per traversal, arbitrary conditions, can be assigned
  to a variable and reused in `FILTER`). The edge variable is `null` at depth 0 — prune conditions on
  edges must guard against it.
- **`OPTIONS`**: `order: "bfs"` returns results by increasing depth; `order: "weighted"` by increasing
  cost using `weightAttribute` + `defaultWeight` (both ignored for other orders).
  **Negative weights abort the query with an error** — load-bearing for §6.1.
  `uniqueVertices: "path"` guarantees no cycle within a returned path. `parallelism` exists for
  many-start-vertex workloads. Vertex-centric index hints exist from 3.12.1.
- **Path filters** on `p.edges[*].x ALL/NONE/ANY == v` are optimizer-recognized and prune during the
  traversal, not after.
- **`K_SHORTEST_PATHS`** (`FOR path IN ANY K_SHORTEST_PATHS a TO b edgeCols`) is
  **single-source-to-single-target**, emits `{vertices, edges, weight}`, takes the same weight
  options, and the docs strongly recommend a `LIMIT`.

**Consequence:** the live query shape follows directly. "Nearest equivalents in language X" is a
**BFS traversal** from the source senses with `PRUNE`/`FILTER` on the target language (multi-target —
`K_SHORTEST_PATHS` cannot express it); the per-pair path panel is `K_SHORTEST_PATHS` between two known
vertices. Both run on anonymous collections; both upgrade to weighted order without schema change.

### 1.2 What the codebase already settled (do not re-derive)

- **A definition is addressed by its `place`** — chosen in Loop 2 *explicitly because* "future fields
  (loop-5 translations etc.) reference a definition by its place". The validators and semantics live in
  `packages/types/src/entry.ts` (`isLeafPlace`, `compareDefinitionPlaces`, `validateDefinitions`):
  last index non-zero → leaf, 0 → group node, non-last 0 → "no grouping at that dimension", so
  `[1]`, `[0,1]` display identically. Any place handling here must reuse those helpers.
- **`subject`-style versioning** (entries): a record carrying `subject` is a proposed new version of
  the thing owning that record; unknown subject degrades to a new thing; idempotency on
  `recordURI + cid`; deletion removes the version and promotes the most recently indexed survivor.
- **Derived, rebuildable collections may be deleted when emptied** — the sanctioned exception to
  archive-forever, already used by `labels` and `localLanguages`.
- **The entries doc already caches derived record facts** (`tags`, `search`, `todo`) so read models
  update on version transitions without re-fetching records — the precedent §3.2 extends.
- The foundation-loop `translations` edge collection was **dropped in Loop 2, never written to**,
  precisely so this loop could design storage freshly.

### 1.3 The white paper's positions (kept, superseded, or answered)

- **Kept:** translations attach to *definitions* (senses), not to words; the hierarchy of validity that
  voting will later provide "provides weighted edges between words, which can be leveraged by
  pathfinding algorithms" — the weighted seam was always the plan.
- **Superseded:** the `translations` field *on the entry record* (one-directional, forces mirrored
  writes) — replaced by the standalone symmetric record (§2). "Links resolve to the new structure of
  the target entry at update time" — replaced by **pin to the version, compare the subtree, park what
  drifted** (§3.3), because silent re-resolution is exactly how a link comes to point at the wrong
  meaning.
- **Answered:** the disambiguation problem (§0's gwerzenn test) is answered structurally by
  **the vertex is the sense** (§3.1).

---

## 2. The record — `eu.leksis.relation`

One lexicon for the assertions the network is made of. Name chosen over `eu.leksis.translation`
because the record is broader than translation: **a synonym is a translation whose languages are
equal**, and antonymy rides the same shape. rkey = TID, like entries.

### 2.1 Shape

```typescript
{
  kind?: string             // absent = equivalence (translation / synonym).
                            // "antonym" is the only other known value this loop.
                            // knownValues, not a closed enum: an unknown kind is
                            // indexed but parked, never traversed and never rejected.
  sides: [Side, Side]       // exactly two, unordered — symmetry is structural,
                            // not a property to maintain across two records
  notes?: string[]          // free prose about the assertion (register caveats,
                            // partial-equivalence warnings…) — content, record-only
  subject?: string          // at:// URI of the relation version this modifies
  createdAt: string
}

Side = {
  entry: string             // at:// URI of an eu.leksis.entry record VERSION —
                            // the pin (§3.3). Never an entryKey.
  languageID: string        // lowercase BCP 47 tag — denormalised for readability
  orthography: string       // canonical spelling at authoring time — denormalised
  place: number[]           // canonical place prefix (§2.2); [] = every sense
}
```

Named decisions:

- **One record, two sides, no direction.** Equivalence is symmetric; encoding it as a field on one
  entry pointing at another (the white paper's shape) forces two records to agree. A standalone
  two-sided record cannot be asymmetric.
- **A synonym is a translation whose languages are equal.** No `kind` value, no separate machinery:
  `sides[0].languageID === sides[1].languageID` *is* the synonym case, including two senses of the
  same polysemous entry asserted equivalent. The only invalid degenerate case is both sides naming
  the same entry *and* the same prefix (a self-loop), rejected at validation.
- **Antonyms ride along but never traverse.** `kind: "antonym"` is stored, indexed, and displayed on
  the entry page, but its edges are excluded from every translation traversal — an antonym hop
  inverts meaning. Cognates and etymology are **future lexicons, not kinds here** (§6.2): they relate
  lexemes, not senses, and belong to a different vertex altitude.
- **Denormalised fields are display fallback, never join keys.** `languageID` and `orthography` make
  the record legible on its own PDS and give the UI something to print when the pinned entry is
  unreachable; the AppView joins on the `entry` URI alone. They can go stale when an entry is
  re-spelled; that is cosmetic by construction.

### 2.2 The place prefix

A side references senses by a **canonical place prefix**:

- Canonical form: the prefix as it would address leaves, **leading zeros stripped, never ending in
  0**. `[]` means *every sense of the entry* (the record-level spelling of "index 0 = all meanings").
  A group heading `[0,2,0]` (II.) is referenced as `[2]`; a single leaf `[0,2,3]` (II.3.) as `[2,3]`.
- Matching: a prefix matches a leaf iff, after canonicalising both, the prefix is a prefix of (or
  equal to) the leaf's place. Within a valid tree this is unambiguous — a place is either a leaf or
  has children, never both.
- Semantics: the record asserts **each leaf under side A's prefix is equivalent to each leaf under
  side B's prefix** — the cartesian product. Referencing a group asserts all its senses translate;
  it does *not* assert the group's senses are synonyms of each other (that would be a separate
  same-entry relation).
- The canonicalisation and matching helpers live in `packages/types` beside the existing place
  utilities, and reuse them.

### 2.3 Versioning and identity

Exactly the entries model. A `relationKey` is minted at creation —
`{langA}-{langB}-{hash}` with the two language tags sorted and the hash derived from the creating
record's URI (same convention and collision handling as `entryKey`) — and kept by all versions.
`subject` targets any prior version's URI; last write wins across authors; the superseded version is
archived `current: false`; a version whose record is deleted from its author's PDS is removed and the
most recently indexed survivor promoted; deleting the last version removes the relation. The
correction flow in the UI is "publish a replacement", which is what makes wrong translations fixable
by anyone *before* voting exists, with the full version trail voting will later need.

---

## 3. The graph

### 3.1 Collections

**The record is the truth; the edge is its shadow.** Two derived collections express the current,
live state of the network; they are rebuildable from `relations` + `entries` and deletable when
emptied (the `labels` precedent). One document collection mirrors the records.

**`relations`** — versioned mirror, one doc per relation version (like `entries`):

```
{
  _key,                    // auto-generated
  relationKey: string,     // stable identity across versions
  kind: string | null,     // null = equivalence
  sides: [{
    recordURI: string,     // the pinned entry version (from the record)
    entryKey: string|null, // resolved identity; null while unresolved
    languageID: string,
    place: number[],       // canonical prefix
    leafPlaces: number[][] // the prefix expanded against the PINNED version's
                           // tree at ingest — cached so drift comparison never
                           // needs an archived (or deleted) entry doc
  }],
  state: "live" | "stale" | "unresolved" | "oversize",
  recordURI, cid, authorDID, createdAt, indexedAt, current
}
```

Indexes: `["relationKey","current"]`, `["recordURI"]`, `["sides[*].entryKey"]` (re-anchoring on entry
version transitions), `["sides[*].recordURI"]` (resolving relations that arrived before their entry).

**`senses`** — derived vertex collection, one vertex per definition **leaf of every current entry
version**: `_key = "{entryKey}.{place joined with .}"` (e.g. `br-gwerzenn-1b76.2.1`), fields
`{entryKey, languageID, place}`. Materialising *all* leaves (not only related ones) keeps vertex
keys deterministic, makes re-anchoring a pure key computation, and gives the dashboard an
"untranslated senses" counter for free.

**`relationEdges`** — derived edge collection: one edge per (leaf under side A × leaf under side B)
of every **live, current** relation version, `_from`/`_to` in `senses`, attributes
`{relationKey, kind, languages: [a, b]}`. `MAX_RELATION_EDGES` caps the cartesian expansion of one
relation (proposed 256); a relation exceeding it parks as `oversize` rather than flooding the graph.

Only `state: "live"` relations have edges. **Park, never serve**: stale, unresolved and oversize
relations are absent from the graph and present on worklists — a translation the AppView cannot
currently vouch for is not offered at all.

### 3.2 The entries doc gains `places`

Entry version docs gain `places: number[][]` — the canonical places of the version's definition
leaves, cached at ingest exactly as `tags` already is. This is what lets relation ingest expand a
prefix, and version transitions detect drift, **without ever fetching a record from a PDS**. Small
(a place is ≤3 small ints), derived, and backfillable: pre-1.0 a `db:init` backfill may fetch
records once, or the fixture/import bots simply republish (the sanctioned pre-1.0 cost).

### 3.3 Ingest lifecycle

**Pin to the version, compare the subtree, park what drifted** — the drift rule, named once and used
everywhere below. A side pins an exact entry version; a relation is *live* only while, for each side,
the leaf set under the prefix is identical between the pinned version and the entry's **current**
version. The comparison is **structure-only** (leaf places, not texts): definition texts are not in
the database, and a typo fix must not park a translation. The residual risk — an in-place rewrite
that changes a sense's meaning without changing the tree — is accepted and recorded here; it is
voting-era work, not shape work.

- **Relation record arrives** (validate → resolve → expand → anchor): validate shape, BCP 47 syntax,
  canonical prefixes, side non-identity; resolve each side's `recordURI` against `entries` (any
  version — the `subject` resolution pattern). An unresolvable side → `state: "unresolved"`, no
  edges; the `sides[*].recordURI` index lets entry ingest revive it the moment the entry appears
  (Jetstream delivers records in arbitrary order). Resolved → expand each prefix against the pinned
  version's `places` into `leafPlaces`; then anchor against the current version: identical leaf sets →
  `live`, edges written; differing → `stale`. Idempotent on `recordURI + cid`; `subject` versioning,
  archive and promotion exactly as entries do.
- **Entry version transition** (new current version, promotion, or deletion): rebuild the entry's
  `senses` rows from the new current `places`; for every relation touching the entry (by
  `sides[*].entryKey`), re-run the anchor comparison against the new current version and rebuild its
  edges — a restructure parks relations, a reversion revives them, with no record fetches and no
  writes to anyone's PDS. Entry fully deleted → its senses go, its relations park as `unresolved`.
- **Relation deletion**: the index mirrors the network, as with entries — remove the version, promote
  the survivor, rebuild edges.

**Re-affirming a stale relation is publishing a new version** whose sides pin the entry's *current*
version — the editor pre-fills it (§4.4). The old version stays archived; nothing is repaired in
place.

### 3.4 Queries

**Translation search** — from every sense of the entries matching the query in the source language,
one BFS traversal over the anonymous edge collection:

```aql
FOR v, e, p IN 1..@maxDepth ANY @senseId relationEdges
  OPTIONS { order: "bfs", uniqueVertices: "path" }
  PRUNE v.languageID == @target
  FILTER v.languageID == @target
  FILTER p.edges[*].kind NONE == "antonym"
  RETURN p
```

`PRUNE` on the target language stops expansion at the first hit per path (a translation is not a
transit station); the `NONE == "antonym"` path filter is optimizer-recognized (§1.1). Sense-level
vertices make meaning-preservation structural: a path enters and leaves an intermediate entry through
the *same sense vertex*, so *vers* traversed via its "verse" sense can never continue from its
"worms" sense. Results are grouped by target entry, deduplicated across source senses, ranked by hop
count (§7 holds the tiebreak question). Proposed `maxDepth`: default 3, server cap 5.

**The path panel** — for one (source sense, target sense) pair the UI wants the alternatives:
`K_SHORTEST_PATHS` between the two vertices with a `LIMIT`, per §1.1.

**Entry page** — direct (depth-1) edges grouped by this entry's senses, equivalences and antonyms
separately; plus the entry's parked relations for the worklist strip.

### 3.5 API surface (sketch — final shapes at build time)

- `GET /translate?q=&from=&to=&depth=` — translation search: groups of
  `{targetEntry, senses, paths}`, each path hop `{entryKey, languageID, orthography, place}`.
  Definition texts are **not** served — the client resolves hop records from their authors' PDSs
  exactly as the entry page already does.
- `GET /entries/:key/relations` — the entry page's direct relations + parked relations.
- `GET /languages/:tag/dashboard` — widened with relation counters (live/stale/unresolved, and the
  untranslated-senses count) and a parked-relations queue (the `todo` dialog pattern).

Unlike grammar layers 2–4, this loop's API cost is **deliberately non-zero**: it is a content loop
shipping a new read surface, and the traversal cannot run anywhere but the AppView.

---

## 4. The interface

The backend shape above is the contract; the surfaces below are the loop-5 embryo and are free to
evolve without touching it.

### 4.1 The search bar — one bar, two configurations

The existing bar (query + source language) gains an **optional target-language selector** — the
reserved `LanguageSearchBar` call site. Target empty → monolingual search, exactly today's behaviour
and URL shape (`/?q=&l=`). Target set → translation search (`/?q=&l=&t=`), query string still the
search surface per the routing convention. No mode switch to learn: the presence of a target *is*
the mode.

### 4.2 Results — answers that explain themselves

Translation results group by target entry. Each group shows the matched target senses and a
provenance badge: **direct**, or **via …** with the chain expandable hop by hop — orthography,
language, and the sense's displayed place label (I.2., II.…) at every hop, each hop linking to its
entry page. The chain is the trust surface: until voting exists, *how* a translation was reached is
the only quality signal a reader has, so it is never hidden more than one tap away. Wrong result →
the badge menu offers "propose a correction", opening §4.4 pre-filled.

### 4.3 The entry page

A relations section per sense, under its definition: equivalents grouped by language (synonyms are
simply the same-language group), antonyms marked distinctly. Whole-entry relations (`place: []`)
render on the entry header. Each relation discloses its author and notes, and offers edit
(new version with `subject`) and — for one's own — delete.

### 4.4 The relation editor (embryo)

Launched from an entry sense ("add translation / synonym / antonym") or from a result
("wrong translation?"). Flow: kind (equivalence default, antonym a toggle) → target language →
find the word (the existing search) → **pick the senses on a rendered definition tree** — selecting
a leaf, a group (its subtree), or the whole entry produces the canonical prefix; the same picker
confirms the source side, pre-filled from the launch context → optional notes → publish
`eu.leksis.relation` on the user's own PDS. Editing an existing or stale relation pre-fills sides
pinned to the entries' *current* versions, so re-affirmation after drift is the ordinary edit flow,
not a special one.

### 4.5 Worklists

The language dashboard gains the parked-relations queue (stale + unresolved + oversize, the `todo`
dialog pattern — a parked relation lists on both sides' languages) and the untranslated-senses
counter. Repairing drift is expected, recurring lexicographic work; it gets the same first-class
worklist treatment as unbound tags and todo-flagged entries.

---

## 5. The slices

Each slice leaves master typechecking and deployable alone, per the working method; verification per
the verify skill, with fixture records from the `leksis-testset` bot (which gains coverage rows for
every reader-facing state this loop ships: live, via-chain, stale, antonym).

1. **Lexicon + types** — `lexicons/eu.leksis.relation.json`; relation types, validation and
   canonical-prefix helpers in `packages/types` (full `npm run typecheck`). Nothing consumes yet.
2. **Ingest** — `places` on entry docs; `relations`, `senses`, `relationEdges` collections +
   `db:init`; the lifecycle of §3.3. Proof: fixture relations flow through Jetstream into edges;
   a restructured fixture entry parks its relation.
3. **Read surface** — `/translate`, `/entries/:key/relations`, dashboard widening. Proof: curl
   against fixture data.
4. **Reader UI** — search-bar target mode, translation results with path disclosure, entry-page
   relations.
5. **Writer UI + worklists** — the relation editor, correction flow, dashboard queues.

**Definition of done — the gwerzenn test, on the live URL:** with the fixture chain
*gwerzenn* →fr *vers* (sense-targeted) →en, searching *gwerzenn* with target English returns *verse*
with its via-chain displayed, and never *worms* or *toward(s)*; restructuring the fixture *vers*
entry parks the relation out of results and into the worklist; re-affirming it through the editor
revives it.

---

## 6. Seams — reserved, not built

### 6.1 The weighted semantic network

Voting attaches scores to relation versions; the graph consumes them as an edge attribute and the
traversal switches `order: "bfs"` → `order: "weighted"`. Two constraints are fixed **now** because
they shape that future without costing anything today: **scores map to positive costs** — AQL aborts
on negative weights (§1.1), so the weight is a monotone-decreasing positive function of trust, never
the raw score; and **invalid means absent** — a relation voted below zero parks (record archived,
edges removed), it is never served with a penalty weight. Ranking then replaces hop count; nothing
else in §3 changes shape.

### 6.2 Cognates and etymology

Future **separate lexicons**, not `kind` values: they relate *lexemes* (and historical forms), not
senses, so they traverse a different vertex altitude — entry-level or their own vertex class, decided
when designed. They share the pattern of this note (symmetric-or-directed record → derived edges),
not its collections.

### 6.3 Sentences, translation memory, and the interface's own translations

Example sentences will point at **senses** — the `senses` vertex collection is the anchor they
inherit — and sentence-pair records will mirror the relation shape one level up. The app's interface
translation system builds on that memory, and further translation surfaces (books, subtitles) on it
in turn. None of this is designed here; what this note fixes is only that the sense vertex is the
join point they all share.

---

## 7. Open questions — decided at build time or later, never silently

- **Ranking tiebreak pre-voting**: among equal-hop results, does the count of parallel current
  assertions rank higher? Proposed yes, but decided when real data exists to look at.
- **Text drift** is accepted as a structure-only residual (§3.3); revisit when voting can price it.
- **Unresolved-side revival mechanics**: index-join on entry ingest (proposed) vs a periodic sweep —
  measured at slice 2.
- **Depth/limit defaults** (`maxDepth` 3, cap 5, `K_SHORTEST_PATHS` limit): proposals, tuned on
  fixture data.
- **The prefix picker's UX** on deep trees, and where the whole-entry option lives visually.
- **Whether `/translate` folds into `GET /entries`** as a parameter or stays its own endpoint.
- **`places` backfill** for entry versions indexed before slice 2: one-off PDS fetch in `db:init`
  vs bot republish — pre-1.0, either is cheap; pick at slice 2.
- **The untranslated-senses counter's exact definition** (any live edge vs any equivalence edge).

---

## Named decisions (recap for cross-reference)

**meaning is the invariant / the gwerzenn test** · **a wrong translation is worse than a missing
one** · **one record, two sides, no direction** · **a synonym is a translation whose languages are
equal** · **antonyms ride along but never traverse** · **sides are at:// URIs, denormalised fields
are display fallback** · **a reference is a canonical place prefix, [] = every sense** ·
**the vertex is the sense** · **the record is the truth, the edge is its shadow** ·
**pin to the version, compare the subtree, park what drifted** · **structure-only drift comparison**
· **park, never serve** · **subject-style versioning, one mechanism everywhere** ·
**paths are explained, not just answered** · **scores map to positive costs; invalid means absent** ·
**cognates and etymology are future lexicons, not kinds**.

---

## Sources

- ArangoDB 3.12 documentation, fetched 2026-08-04: *Graph traversals in AQL*
  (docs.arango.ai/arangodb/3.12/aql/graph-queries/traversals/), *k Shortest Paths in AQL*
  (…/aql/graph-queries/k-shortest-paths/).
- Distributed Dictionary White Paper (`Oktogazh.github.io`, `src/content/prevez/leksis.eu/`) —
  word-to-word translation, the *gwerzenn/vers* scenario, the superseded `translations` field.
- `packages/types/src/entry.ts` — place semantics and validators; `lexicons/eu.leksis.entry.json`.
- ADR-0003 (versioned indexing, firehose), ADR-0004 (derived read models), Loop 2 decisions
  (flat `place` addressing, index-mirrors-network deletion).
