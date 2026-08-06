# ADR-0011 — The semantic network: translations as a graph of senses

- **Status:** Accepted
- **Date:** 2026-08-05
- **Deciders:** Alan Kersaudy
- **Supersedes, in part:** the white paper's `translations` field on the entry
- **Design note:** `docs/design/semantic-network.md` — the full reasoning, the
  slice plan, and the seams reserved for later arcs. This ADR records what was
  decided and what it costs; the note remains the "why" for anything below.

## Context

A dictionary that cannot say what a word is in another language is not yet a
dictionary, and translation is the feature the whole project is *for*: the
bottom-up premise is that a low-resource language gains most from being
connected to the languages around it.

The white paper put a `translations` field on the entry. Building it that way
would have broken three things the model had already settled:

1. **Two directions that can disagree.** A field on A saying "B" and a field on
   B saying nothing (or saying "C") is not one fact, it is two, and nothing
   keeps them consistent. In a network where anybody may publish a version of
   anybody's entry, the divergence is not hypothetical.
2. **Adding a translation republishes somebody's entry.** Under last-write-wins,
   asserting "A means B" would mean rewriting A's record wholesale — so a
   translator becomes an editor of content they did not write, and the entry's
   version history fills with edits that changed no definition.
3. **A word is not what gets translated.** *vers* is French for "verse",
   "worms" and "toward(s)" depending on the sense. A translation attached to the
   word licenses a chain — Breton *gwerzenn* → *vers* → German *Vers* → *vers* →
   "worms" — that passes through the word and out the other side by a different
   meaning. Any indirect translation built on word-level links is a meaning
   laundering machine.

The third is the one that shaped everything else: whatever the unit of
translation is, chaining must be **meaning-preserving structurally**, not by a
check that could be forgotten.

## Decision

### A relation is a standalone, symmetric record between two sets of senses

`eu.leksis.relation` (`lexicons/eu.leksis.relation.json`) is its own lexicon:
two `sides`, no direction, published by whoever knows the fact. One record means
the two directions **cannot** disagree, and neither entry is touched when a
translation is added.

A side names an `at://` URI of an entry record **version** plus a canonical
**place prefix** — never an AppView-minted key, so the record stays meaningful
outside this AppView. `place: []` means every sense of the entry.

### A synonym is a translation whose two languages are equal

No separate kind, no separate machinery. `kind` is absent for equivalence and
`"antonym"` for the one relation that is stored and displayed but **never
traversed** — an antonym step inverts meaning. An **unrecognised** kind is
indexed and shown verbatim, never traversed: a kind a later version introduces
cannot corrupt results, and this AppView is not the arbiter of what others may
assert.

### The vertex is the sense

`senses` holds one vertex per definition **leaf of every current entry
version** — *every* leaf, not only the related ones, which keeps a key a pure
computation (`{entryKey}.{place}`) and gives the untranslated-senses counter
away for free. `relationEdges` is the cartesian product of the two sides'
expanded sense sets, for **live** relations only.

Because a path enters and leaves an intermediate word through the *same vertex*,
meaning preservation is a property of the graph rather than a rule the traversal
must remember. That is the whole reason the vertex is the sense and not the
entry.

### Pin the version, compare the subtree, park what drifted

A side pins a *version*, so the AppView can notice that the entry's tree has
been restructured since. When it has, the relation is **parked** — withheld from
results and shown as work on a repair worklist — rather than silently pointing
at a different meaning, because **a wrong translation is worse than a missing
one**. Four states: `live`, `stale`, `unresolved`, `oversize`.

The comparison is deliberately **structure-only**: definition texts are not in
the database, and a typo fix must not park a translation. An in-place rewrite
that changes a sense's meaning without changing the tree therefore goes
unnoticed — an accepted residual, priced when voting can score it.

### Coarse claims are kept, flagged, ranked lower, and disclosed

A side resolving to more than one sense asserts that all of them correspond.
Sometimes that is right; sometimes it is a bulk-importing bot declining to be
precise. The AppView cannot tell them apart and does not try: such edges are
kept, marked `coarse`, ranked below precise ones, and **disclosed in the reader's
via-chain** — on the way in *and* on the way out, since either is the same
unchecked assumption. Blocking them would discard translations that are usually
correct; hiding the imprecision would hand the reader a confident wrong answer.

### The API cost is deliberately non-zero

Unlike the four grammar layers, which each shipped for zero new endpoints, this
loop adds `GET /translate` — the traversal cannot run anywhere but the AppView.
It is capped (`depth` default 3, max 5; per-query `maxRuntime` and `memoryLimit`;
result and path caps) because it is unauthenticated. No content is served: the
client resolves records from their authors' PDSs, as it already does everywhere
else.

## Consequences

- **Three new collections** — `relations` (versioned mirror), `senses` and
  `relationEdges` (both derived, rebuilt wholesale by `db:init`). The two derived
  ones are the sanctioned exception to archive-forever, like `localLanguages`.
- **`entries` gains `places`** — the canonical places of a version's definition
  leaves, cached at ingest exactly as `tags` already is, so a prefix expands and
  drift is detected **without fetching any record from a PDS**. A version indexed
  before this ships carries none and parks its relations until its author
  republishes; pre-1.0, that is a bot republish and no migration code.
- **The foundation-loop `translations` edge collection is dropped** (it was never
  written to), and the white paper's `translations` field is superseded.
- **Cognates and etymology are explicitly *not* kinds of this relation.** They
  relate lexemes and historical forms, not senses, so they traverse a different
  vertex altitude and will get their own lexicons.
- **Two constraints are fixed now for the weighted network** (§6.1 of the note),
  because they shape that future at no cost today: scores map to **positive**
  costs (AQL aborts on negative weights), and **invalid means absent** — a
  relation voted below zero parks, it is never served with a penalty weight.
- **A `place: []` relation is the most fragile thing in the network**: appending
  one sense to either entry parks it, and bots are expected to write exactly
  those. Worth a volume estimate once real data exists.
- **The editor always pins current versions**, which is what makes re-affirming a
  parked relation the ordinary edit flow rather than a special repair mode.

## Action items

- [ ] **Publish the `eu.leksis.relation` lexicon**
      (`scripts/publish-lexicons.mjs`), which now lags by this whole lexicon in
      addition to `grammar.layout`, `lexicographic` and `abbreviations`.
      Requires the user's approval.
- [ ] **Exercise the writer surfaces in a browser.** The reader half was driven
      locally (2026-08-05); the editor's publish / re-affirm / withdraw paths
      were **never executed** — see `docs/design/semantic-network.md` §5c and the
      `leksis-testset` skill §7.4. The re-affirm path is the one the repair
      worklist most encourages and it carries a fix that is typechecked but
      unrun.
- [ ] **Unblock local verification of authenticated surfaces**, which now blocks
      three loops' worth of debt. The `verify` skill's first lead — the `pds`
      service already declared in `docker-compose.yml`, whose sessions could be
      minted by script — is also what would give local fixtures **resolvable**
      records, without which the entry page and every editor on it can never be
      driven locally.
- [ ] **Publish relation fixtures** once a fixture bot exists: a via-chain, one
      coarse assertion, one antonym, one unknown kind, one stale and one
      unresolved side (`leksis-testset` §7.4). The fixture set does not exist
      yet — no `q*` language and no `lxt-` entry is published.
- [ ] **Add a read-path regression test.** `apps/api/src/scripts/verify-network.ts`
      covers the ingest lifecycle (46 assertions) and is where a traversal case
      belongs — starting with the sense-jump fixture, which is three records.
