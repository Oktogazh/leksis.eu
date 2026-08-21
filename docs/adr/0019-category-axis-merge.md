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
- [ ] **Slice 2** — grammar merge: language lexicon (`categories` replaces `bindings`; `axes` +
  `layout` removed), types rework, ingest (`selectorKeys`, index swap, validation), **`br`
  republished via testaccount without axes/layout/bindings**, minimal web compile pass (old tabs
  removed, paradigm surfaces stubbed).
- [ ] **Slice 3** — the categories editor (axis + default-value annotations) and the entry
  editor (narrowing emits the full bundle; otherForms picker over the axis feature's bound
  values).
- [ ] **Slice 4** — paradigm v2: lexicon (selectors + cell-by-cell tables), types
  (`paradigmIssues`/`generateForms` v2, exact-match reach), ingest + API, basic table reader.
- [ ] **Slice 5** — the paradigm table editor (grid, merges, per-cell rules) + entry-page polish.
- [ ] **Slice 6** — testset pass, docker build gate, lexicon republish, CHANGELOG, skills update,
  finalize this ADR, bump packages to **0.28.0**, propose tag `v0.28.0`.

### State after last session

**2026-08-21, slice 1 — built and verified; next session starts slice 2.**

What shipped, and the three places it deviates from the design note:

- `GET /languages/:tag/labels/random?**row=**<canonical row key>` — the row is named in the
  **query string**, not as a path segment as §3.2 planned. A canonical row key carries `=`, `|`
  and, on a layered feature name, brackets; a path segment cannot hold them safely through a
  proxy that normalizes paths. Returns `LabelSampleResponse` (`{languageID, row, entry}`), 404
  when the row is unknown, unused, or has only withdrawn members — the caller renders the same
  nothing for all three. Unmetered: see the decision below.
- The join is `tagKey(tag)` alone, and **no `rowKey` was added to `LabelView`**. Usage reaches
  the labels model from entries, an entry carries tags and nothing else, so a row with no tag (a
  feature *name*, a plain abbreviation) is at zero by construction and needs no address.
- The dashboard footer key is `languagePage.viewRecord`, not `language.viewRecord` — the page's
  own namespace.
- Chips are on POS rows, feature-value rows, layer-2 category rows and the enumerated
  combination rows. A **zero renders as nothing**: in a young dictionary most rows are zero and
  printing it on each would bury the counts that mean something. The sample opens in a **new
  tab**, because this dialog holds an unpublished draft.

**Decision recorded here rather than slipped in: the sample route is deliberately unmetered.**
It does weaken the *practical* half of ADR-0004's "the dictionary cannot be enumerated through
its label list" — about n·ln(n) unmetered calls would collect a row. The structural half is
untouched (no response is ever a list). It is accepted because an entryKey is a public
identifier for a public record that a crawler reads from the authors' PDSs anyway; because the
query is strictly cheaper than the unmetered `GET /languages/:tag/labels` the same page already
calls; and because metering would break the one control it exists for — a button whose purpose
is being pressed again. Revisit if a crawler ever makes it visible in the logs.

Verification: full `turbo typecheck lint --force` (13/13); the endpoint curled for success,
404-unused-row, 404-unknown-row, 400-missing-row and 400-bad-tag, plus a 24-draw distribution
check (10/14 over a two-entry row) and a direct AQL check that `RAND()` is re-evaluated per
subquery row on ArangoDB 3.12.4 and that `SORT RAND() LIMIT 1` is not optimized away; browser
against a local API for all four chip sites, the reroll, the link's landing page, dark mode,
375 px, and both degraded branches forced (empty and failed).

**Carried into slice 2, from the pre-slice-1 planning session:** latest tag v0.27.3 while every
`package.json` says 0.26.0 (realigned at 0.28.0 in slice 6); paradigm matching is containment
over `inherentAtoms` in three places that must stay in step (`expand-forms.ts:336-343`,
`mergeParadigms`, `paradigmsReaching`); the `br` republish must check the current record's
author before publishing under testaccount (last-write-wins makes the testaccount version
current — intended).

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
- [ ] Slice 6: verify `scripts/publish-lexicons.mjs` output includes `eu.leksis.paradigm` and the
  reshaped `eu.leksis.language` (the published lexicons already lagged the code before this arc).
- [ ] Slice 6: retire or update `docs/design/grammatical-tagging.md` layer-3/4 sections and
  `docs/design/paradigm-rules.md` with pointers here.
