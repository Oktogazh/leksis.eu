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

- [ ] **Slice 1** — counts + random-entry links in the grammar editor; language-record link on
  the dashboard footer. (Non-breaking.)
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

2026-08-21 — planning session only. Design note and this staging ADR written; no code touched.
Facts gathered: latest tag v0.27.3 (package.json files drifted at 0.26.0 — realigned in slice 6);
labels docs hold `entries[]` DB-side, API serves counts only; no usage counts exist in
`GrammarBindingDialog` today; `LanguagePage` has no record link; paradigm matching is containment
over `inherentAtoms` in three places (`expand-forms.ts:336-343`, `mergeParadigms`,
`paradigmsReaching`); the `br` republish must check the current record's author before publishing
under testaccount (last-write-wins makes the testaccount version current — intended).

## Decision

*(To be written at acceptance, from what was actually built.)*

## Consequences

*(To be written at acceptance.)*

## Action items

- [ ] Slice 6: verify `scripts/publish-lexicons.mjs` output includes `eu.leksis.paradigm` and the
  reshaped `eu.leksis.language` (the published lexicons already lagged the code before this arc).
- [ ] Slice 6: retire or update `docs/design/grammatical-tagging.md` layer-3/4 sections and
  `docs/design/paradigm-rules.md` with pointers here.
