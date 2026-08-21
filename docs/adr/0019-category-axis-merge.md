# ADR-0019 — The category–axis merge (staging)

- **Status:** **Staging — in progress.** This ADR is the cross-session progress tracker for the
  arc planned in `docs/design/category-axis-merge.md`. Every build session reads it first and
  updates it last. It is finalized (Status → Accepted, Consequences written from what was built)
  in slice 6, and only then does it become authoritative.
- **Date:** 2026-08-21 (staged) / — (accepted)
- **Deciders:** Alan Kersaudy
- **Supersedes, when accepted:** ADR-0008's `grammar.axes` (removed), ADR-0009's `grammar.layout`
  (removed — table shape moves into the paradigm record), ADR-0016's containment selector
  (replaced by exact match on the full headword bundle).
- **Builds on:** ADR-0006 (primitives), ADR-0007 (inherence — unchanged), ADR-0010 (labels keyed
  on the tag — the annotation-with-default maps onto it with no collection change), ADR-0015 (the
  ingest gate, extended to the new issue kinds).

## Context (summary — the design note holds the full reasoning)

Layers 2 and 3 separated what a headword *is* from what its forms *vary over*; real conventions
couple them — one category may hold headwords at different default values of the same axis, each
with its own abbreviation (Breton's three noun types, incl. the plural-headword *anv-stroll*). The
merge: a category declares its axis feature and default value(s) together; `grammar.axes` and
`grammar.layout` disappear; the entry's bundle carries its default value; the paradigm selector
becomes exact-match on that full bundle; paradigm tables are authored cell by cell (titles, form
cells with per-cell rules, merged cells) inside the paradigm record. Plus two independent
surfaces: usage counts + random-entry links in the grammar editor, and the language-record link
on the dashboard footer.

Decisions settled 2026-08-21 with the user: layout moves to the paradigm record entirely; a
category stores the axis feature + defaults only (never a value inventory); the default axis
value is part of the exact-match selector and is stored on entry docs (`selectorKeys` replaces
`inherentAtoms`); a new one-random-entry-per-label-row endpoint is added
(`GET /languages/:tag/labels/:key/random`).

## Progress

Update the checkbox and the state note at the end of each session. One slice = one session; no
`v*` tag before slice 6 — this arc breaks the lexicons and must deploy whole.

- [x] **Slice 1** — counts + random-entry links in the grammar editor; language-record link on
  the dashboard footer. (Non-breaking.) *Done 2026-08-21.*
- [x] **Slice 2** — grammar merge: language lexicon (`categories` replaces `bindings`; `axes` +
  `layout` removed), types rework, ingest (`selectorKeys`, index swap, validation), minimal web
  compile pass (old tabs removed, paradigm surfaces stubbed). **`br` is not republished** — see the
  state note. *Done 2026-08-21.*
- [x] **Slice 3** — the categories editor (axis + default-value annotations) and the entry
  editor (narrowing emits the full bundle; otherForms picker over the axis feature's bound
  values). *Done 2026-08-21.*
- [x] **Slice 4** — paradigm v2: lexicon (selectors + cell-by-cell tables), types
  (`paradigmIssues`/`generateForms` v2, exact-match reach), ingest + API, basic table reader.
  Ingest gate removed; both verification harnesses rebuilt. **The browser pass is deferred to
  slice 6** — see the state note. *Done 2026-08-21.*
- [ ] **Slice 5** — the paradigm table editor (grid, merges, per-cell rules) + entry-page polish.
- [ ] **Slice 6** — testset pass, docker build gate, lexicon republish, CHANGELOG, skills update,
  finalize this ADR, bump packages to **0.28.0**, propose tag `v0.28.0`.

### State after last session

**2026-08-21, slice 4 — built, typechecked, linted and driven through both
verification harnesses; the browser pass is deliberately deferred to slice 6.**

A paradigm now carries its own tables. `eu.leksis.paradigm` v2 replaces
`selector` with `selectors` (1–8 full headword bundles, exact match) and `rules`
with `tables` (1–16 grids of ≤128 rows of ≤64 cells), a cell being a `title`, an
`empty` or a `form` — the last carrying its address and, in it, the rules that
used to carry an address of their own. `paradigmIssues` judges the eight ways a
record can contradict itself (`no-cells`, `ragged-table`, `duplicate-cell`,
`unknown-base`, `base-cycle`, `invalid-match`, `empty-message`,
`too-many-cells`), ingest recomputes the rkey over the **sorted, deduplicated**
selector keys and refuses a mismatch, and `expand-forms` reaches an entry when
one of its `selectorKeys` *is* one of the paradigm's — one indexed lookup per
selector. The reader draws the stored grid: authored spans, the language's own
labels over each cell, the entry's own form winning its cell, and the two absent
states kept apart.

Seven deviations from the design note, each with its reason:

- **`paradigmSelectorKey` became two functions, and the doc still stores one
  string.** `paradigmSelectorKeys` (sorted, deduped) is what identity is
  computed from; `paradigmIdentityKey` joins them with `;` — a character no
  canonical tag key contains, so no two selector lists can run together into one
  identity. `ParadigmDoc.selectorKey` keeps that joined string rather than the
  list, because `GET /languages/:tag/paradigms` sorts on it and a sort key has to
  be one value.
- **`placeForms` had to learn multivalue *cells*, not merely be re-hosted.** The
  note treats the join as a move. It is not: while cells were derived from a
  layout they were single-valued by construction, and a syncretic cell is now the
  ordinary way to draw one. So each side is expanded to the addresses it spans
  before they meet, and a cell keeps its own key whichever of its addresses a
  form landed on — otherwise the placement map would be keyed by an address the
  viewer never draws. First cell wins a shared address, the tiebreak
  `duplicate-cell` reports the second one under.
- **`selectorKeysOf` tolerates a doc with no `selectors` at all.** Versions
  indexed before this slice carry a single `selector`, and the v2 lexicon makes
  their records unpublishable — so such a doc has to be *inert*, not a throw:
  this code runs inside the firehose consumer's sequential writer and inside
  `db:init`, where an exception stops ingestion or a deploy over a doc nobody can
  republish.
- **`expandForParadigm` does one indexed lookup per selector** rather than an
  `INTERSECTION` over the array. `key IN e.selectorKeys` is what the
  `["languageID", "selectorKeys[*]"]` index answers; a set operation over the
  whole field hands it back a scan. Repeats between selectors are harmless — the
  result map is keyed by doc.
- **A `requires` row resolves exact-then-containment**, the `placeForms` rule read
  from the other side: a form tagged `NOUN|Case=Gen|Number=Sing` answers a
  requirement for `Case=Gen`, closest (fewest extra items) first, ties going to
  the entry's own order. Without it a principal part would only ever be found
  when the entry happened to tag it exactly as the rule author addressed it.
- **`generateForms` iterates cells, not rules**, and memoises base chains: the
  first rule of a cell whose `match` hits wins it, a cell with no rules generates
  nothing *by construction* (that is what makes "manual-only" a state rather than
  an accident), and a cycle yields nothing rather than recursing — the record is
  refused for it, but a draft that has one still has to render.
- **`ParadigmEditorDialog` is still the slice-2 stub.** Only its props widened
  (`selector` → `selectors`), and the Paradigms tab now lists one row per
  paradigm naming every category it serves. Slice 5 owes the grid editor, which
  is exactly where the note put it.

**Verification, and the half deferred.** Full `npm run typecheck` (8/8) and
`npm run lint` (5/5). `verify-paradigms.ts` — the ingest harness, rebuilt over v2
— **50/50**: the identity gate (rkey mismatch, and the order selectors were
written in not changing where a record is filed), every coherence kind refused
with nothing indexed, a paradigm for an undeclared category indexed and inert,
**exact match reaching only the exact bundle** (the same category *without* the
axis default, and the bare part of speech, both index and both reach nothing),
all three expansion trigger paths, a generated form findable by search and
reported as generated, an asserted form winning its cell, several selectors on one
paradigm, the missing-base-form queue appearing on the dashboard in the rule
author's own words and clearing again, withdrawal sweeping generated rows, and a
promoted version re-expanding. `verify-paradigm-reader.ts` — the pure display
path — **37/37**: grid geometry and holes, every issue kind, identity over
selector sets, minted-coordinate re-qualification (and staying bare with no
grammar in hand), generation order, rule precedence within a cell, chained bases,
merge precedence, and the four placement outcomes including a syncretic cell
found by containment and a form addressing no cell staying a leftover.

**The browser pass is slice 6's, by decision rather than by omission.**
`scripts/slice4-fixture.tmp.ts` is written and ready: it publishes a quarantined
`qtl` — the merged grammar with two headword flavours of one category, an
anv-stroll entry whose citation form is the plural, a sibling singular headword
the paradigm must *not* reach, and a two-table paradigm carrying a minted `Sgv`
cell, a rule that declines for this lemma, a manual-only cell and an off-table
form — against a local API (`web-local-api`), with a `teardown` mode. It is a
`.tmp.ts` on purpose: it goes with the two harnesses at slice 6.

**Carried into slice 5:** the grid editor and the selector picker, whose
candidates are `categoryTags(grammar, row)` — each annotation of each category,
labelled. The reader is real now, so the editor has something to preview against.

## Decision

*(To be written at acceptance, from what was actually built.)*

## Consequences

*(To be written at acceptance.)*

## Action items

- [x] **Pre-existing index bug, surfaced by slice 1, fixed as its own change (2026-08-21).**
  `apps/api/src/firehose/ingest-entry.ts` re-declared a promoted version's tags without the
  `deleted` guard its sibling call sites carry, so promoting a **withdrawal** after a record
  deletion put the entry back into every label row it used to occupy. The count then inflated and
  the new sample said "nothing left carrying it" forever — which is how slice 1 found it. Fixed,
  with `verify-entry-promotion.ts` asserting that both routes to becoming current (published and
  promoted) leave the read models in the same state. Rows already inflated in a live index need
  no migration: `db:init` rebuilds `labels` wholesale from current, non-withdrawn versions and
  runs on every deploy — verified by inflating a row by hand and watching the rebuild empty it.
- [ ] **Slice 6 owes the fixture set its rewrite, and it is a blocker rather than
  a tidy-up.** `scripts/fixtures/languages.ts` still declares `bindings`, `axes`
  and `layout`, and `check.ts` still names eight retired issue kinds, so
  `publish-fixtures.ts` does not compile — slice 3 had to publish a bare
  quarantined language by hand to have anything to drive. The testset slice
  cannot run until those files carry `categories`, and the coverage matrix's
  L-13…L-16 and L-50…L-59 rows are what the merge replaced.
- [ ] Slice 6: verify `scripts/publish-lexicons.mjs` output includes `eu.leksis.paradigm` and the
  reshaped `eu.leksis.language` (the published lexicons already lagged the code before this arc).
- [ ] Slice 6: retire or update `docs/design/grammatical-tagging.md` layer-3/4 sections and
  `docs/design/paradigm-rules.md` with pointers here.
- [x] **Slice 4's two verification harnesses are rebuilt over v2** (2026-08-21):
  `verify-paradigms.ts` (ingest, identity, exact-match reach, expansion, the missing-form queue)
  50/50, `verify-paradigm-reader.ts` (grid geometry, issues, generation, placement) 37/37. They
  are temporary by design and go at slice 6, together with `scripts/slice4-fixture.tmp.ts`.
- [ ] **Slice 5 owes the rule-row UI**, deleted with `ParadigmEditorDialog`'s body and
  `lib/paradigm-draft.ts`. Also recoverable at 343516e, as is the reader's table geometry
  (`mergeCellSpans` survives in `packages/types`) and the `entry.*` copy for the two absent states.
- [x] **Slice 2's paradigm-ingest gate is gone** (2026-08-21). `PARADIGM_INGEST_GATED` is deleted
  and the function it guarded now speaks v2: rkey recompute, `paradigmIssues` gate, tables cached
  for the expansion job.
- [ ] **Slice 6 owes slice 4's browser pass**, deferred deliberately rather than skipped: the
  reader has never been driven in a browser, only through `verify-paradigm-reader.ts`.
  `scripts/slice4-fixture.tmp.ts` is written for it — it publishes a quarantined `qtl` (merged
  grammar with two headword flavours of one category, an anv-stroll entry, the sibling singular
  headword the paradigm must not reach, and a two-table paradigm with a minted `Sgv` cell, a
  declining rule, a manual-only cell and an off-table form) against a local API, and tears down
  after. Fold it into the testset slice, which has to publish fixtures anyway.
