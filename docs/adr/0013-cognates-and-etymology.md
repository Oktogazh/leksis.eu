# ADR-0013 — Cognates as a network, etymology as prose

- **Status:** Accepted
- **Date:** 2026-08-12
- **Deciders:** Alan Kersaudy
- **Relates to:** ADR-0011 (the semantic network), whose §6.2 reserved this as a
  future lexicon rather than a `kind` of relation. That reservation is honoured;
  what this ADR adds is the split between what gets formalized and what does not.

## Context

The entry lexicon has carried "etymology / cognates" in its deferred-fields list
since Loop 2, always as one item. Designing them turned out to require pulling
them apart, because they are not one thing at two levels of detail — they are two
kinds of knowledge with opposite properties.

**Etymology is a narrative.** A word's history is a chain of forms across
historical languages, carrying dates, uncertainty, competing accounts, and
mechanisms whose borders blur: inherited, borrowed, calqued, derived, and the
frequent honest answer of "one of these, disputed". A schema for it would have to
encode a type on every link, and most of those types would be a guess dressed as
data. It would also read worse than the paragraph it replaced, for the person the
entry is actually for.

**Cognacy is an assertion.** Two words share a historical origin, or they do not.
It is simple enough to be stated, contested and corrected by people who are not
lexicographers, and — unlike an etymological chain — it is worth having as a
graph, because the *shape* of the graph means something: how densely two
languages' words link is itself evidence about how those languages relate,
directly or through intermediates. The quality of a cognate link can then be read
off the relationship between the languages it joins, rather than declared on the
link.

So the question was not "how do we model etymology", it was "which half of this
knowledge earns a schema". Formalizing the ambiguous half would have bought false
precision at the cost of readability; leaving the unambiguous half as prose would
have thrown away the only part a machine can use.

## Decision

### Cognacy gets a lexicon; etymology gets a field

**`eu.leksis.cognate`** is a new record: symmetric, pairwise, **entry-level**, no
kind, no direction, no mechanism. It is `eu.leksis.relation` with the sense
machinery amputated — same record pattern (symmetric record → derived edges,
versioned by `subject`, last-write-wins, archived), one altitude up.

**`eu.leksis.entry` gains `etymology?: string[]`** — prose paragraphs in the
entry's own language, one item per paragraph so a competing account sits beside
the main one. Record-only content, never indexed, exactly like `notes`. Additive,
so no existing record is invalidated and no bot republishes.

The two are designed to hand off to each other: the prose names historical forms,
and each of those becomes a cognate link once that language and that form have
records of their own. **A proto-language is an ordinary language record and a
reconstructed form an ordinary entry** — nothing in the system needs to know they
are reconstructed, which is why no "etymon" vertex class was invented.

### The vertex is the lexeme

Where a relation joins senses — because a translation chained through a word as a
whole would drift in meaning — a cognate joins whole entries. **Every sense of a
word shares the word's history**, so there is no sense to address, and with it no
place prefix, no expansion, no coarseness, and no drift.

The practical consequence is the important one: **a cognate survives edits that
park a translation.** Restructured definitions, a re-spelled headword, a new
sense — none of them touch it. Only two things unseat one: the entry being
withdrawn, or the AppView not knowing it. That asymmetry is not a simplification
of the relation model, it is the correct behaviour falling out of the altitude.

### Three states, not four

`live | unresolved | stale`. There is no `oversize`: a cognate always yields
exactly one edge, so there is no cartesian product to cap. `stale` covers two
causes — an entry withdrawn (`redirectTo` deliberately **not** followed, on
ADR-0011's ruling: re-pointing somebody's historical claim at a different word is
an editorial act, not an index repair), and both sides resolving to the *same
entry*, which validation cannot catch because two versions of one entry are two
distinct record URIs, and which asserts nothing.

### The whole component is served, not the direct cognates

`GET /entries/:key/cognates` returns the **connected component** the entry sits
in, with each word's distance in assertions, plus every link between served
nodes, plus that entry's own parked assertions. This is the one Leksis read
surface that deliberately shows more than what was asserted about the thing you
are looking at, and it follows from what a cognate network is *for*: a
translation search has a target and an answer, a cognate network has a shape.

**Computed per request, cached nowhere.** A component is derived data twice over
— it is exactly the transitive closure of the edges — so storing it would add an
invalidation problem (every write reshapes an unbounded number of components) to
buy a traversal already bounded at 500 vertices and depth 20. Truncation is
detected **from the graph** (any edge with one end inside the served set and one
end outside), which catches the node cap, the depth cap and a dropped vertex with
one check, where counting rows would miss the depth case entirely.

### Vertices are materialized on demand

`lexemes` holds one document per entry the network actually touches, not per
entry — unlike `senses`, which materializes every leaf of every current entry.
The reason they differ: a sense key must be a pure computation and the
untranslated-senses counter must be free, whereas a lexeme vertex keyed by
`entryKey` would otherwise be a second copy of the whole `entries` collection.
It denormalizes what the endpoint prints (language, orthography, record URI,
author), so serving a component is one traversal and no join — safe only because
every entry version transition refreshes it.

### Parallel assertions are kept, not collapsed

Several current cognate records may assert the same pair, and each is its own
link in the response. How many people independently claimed a pair is evidence,
and it is what voting will score.

### Cognates are upgradable

`cognates` joins `languages`, `entries` and `relations` as a voting-upgradable
collection, with `cognateKey` as its shared key, and inherits the relation's
cross-language rule verbatim: a cognate record touches both of its sides'
languages, so whatever §7.3 of the voting note settles for relations applies here
unchanged. Recorded now because it costs nothing today and would be a schema
change later.

### Named graphs, for looking rather than querying

`db:init` now declares two general graphs, `semanticNetwork` (senses ×
`relationEdges`) and `cognateNetwork` (lexemes × `cognateEdges`). They exist so
the two networks are browsable in aardvark's graph viewer. **Nothing in the API
reads through the general-graph API**: every traversal still names its edge
collection directly in AQL, which is the anonymous-graph form and stays how this
codebase queries.

## Consequences

- **Three new collections** — `cognates` (versioned mirror), `lexemes` and
  `cognateEdges` (both derived, rebuilt wholesale by `db:init`), joining the
  sanctioned exception to archive-forever.
- **The API cost is one endpoint**, matching ADR-0011's honesty about this being
  the kind of layer that cannot be zero-cost: a component traversal can run
  nowhere but the AppView. What it serves is still only shape and pointers — the
  assertion's own notes stay on the record, resolved by the client.
- **No change to `entries` indexing.** `etymology` is content, so ingest is
  untouched; the cognate lifecycle rides the `sides[*].entryKey` /
  `sides[*].recordURI` indexes exactly as relations do.
- **The entry lexicon change is additive**, so unlike ADR-0011's `places` there
  is no pre-1.0 republish debt: an entry indexed before this ships is already
  correct.
- **Legacy bootstrap code was removed** in the same pass: the `obsoleteCollections`
  (`definitions`, `translations`) and `renamedCollections` (`abbreviations`)
  blocks in `init-db.ts`. They existed to migrate a database that is about to be
  replaced wholesale under a new name, so their remaining value was zero.
- **A doublet renders as a same-language pair** (`fr ↔ fr`) and traverses like any
  other — two words of one language descended from one origin by different routes
  is an ordinary cognate, not an edge case to special-case.
- **Cognacy here includes borrowing.** The record asserts shared origin and
  refuses to say by which mechanism, so a loanword pair is a cognate pair. This
  is a deliberate cost: it slightly blunts the "language relatedness" reading of
  the graph, since contact and inheritance land in the same edge. The alternative
  — a mechanism field — is exactly the false precision this ADR exists to avoid,
  and the honest distinction lives in the entry's prose and the record's notes.
- **The entry editor's `laterFields` hint was corrected**; it still promised
  etymology, translations and hierarchical structure as future work, all three of
  which have shipped.

## Action items

- [ ] **Publish the `eu.leksis.cognate` lexicon and the widened
      `eu.leksis.entry`** (`scripts/publish-lexicons.mjs`), which now lags by two
      lexicons in addition to `eu.leksis.relation`, `grammar.layout`,
      `lexicographic` and `abbreviations`. Requires the user's approval.
- [ ] **Exercise the cognate surfaces in a browser.** The ingest lifecycle and
      the endpoint were driven against a local database (2026-08-12, 41 + 16
      assertions); the reader section, the editor dialog and the repair strip
      were **never rendered** — the app is session-gated and the verifying agent
      cannot authenticate. Same blocker as ADR-0011's second action item, now
      carried by two loops.
- [ ] **Consider a drawn graph for the component.** The reader currently gets a
      list grouped by language, which is readable at any size and degrades to
      nothing when empty. The shape argument in this ADR is an argument for
      eventually drawing it; the trigger is a component large enough that the
      list stops conveying it.
- [ ] **Watch whether contributors reach for a mechanism.** If the notes on
      cognate records fill up with "borrowed, not inherited", that is evidence
      the triage was too coarse — and the answer would be a lexicographic-style
      declared vocabulary, never a free string on the record.
