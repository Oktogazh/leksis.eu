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
- [ ] **Slice 4** — paradigm v2: lexicon (selectors + cell-by-cell tables), types
  (`paradigmIssues`/`generateForms` v2, exact-match reach), ingest + API, basic table reader.
- [ ] **Slice 5** — the paradigm table editor (grid, merges, per-cell rules) + entry-page polish.
- [ ] **Slice 6** — testset pass, docker build gate, lexicon republish, CHANGELOG, skills update,
  finalize this ADR, bump packages to **0.28.0**, propose tag `v0.28.0`.

### State after last session

**2026-08-21, slice 3 — built and verified; next session starts slice 4.**

The Categories tab is now **one level per category**, and that level is the
category's whole declaration: what its forms vary over, what this dictionary
calls its headwords, and which features are inherent to it. An annotation is
edited on its own form, with a **default-value picker that appears iff an axis is
set**. The entry editor's narrowing gained the axis as its last step, and the
`otherForms` editor got its per-axis selectors back — derived from the category
rows this time rather than from a standalone `axes` array.

Five deviations from the design note, each with its reason:

- **`l2combinationForm` was not renamed, it was dissolved.** §4.3 kept the
  combinations walk and bolted an axis picker onto it; what shipped points every
  row of the enumeration at **the sub-category's own editor** instead. The old
  shape had a hole nobody had noticed while a combination was only a label: the
  root list shows *declared* categories, so a combination had to be **named
  before anything could be declared about it** — and the merge makes "what its
  forms vary over" exactly the kind of thing one wants to declare about an
  unnamed one. One level per category closes that, and it deleted a level rather
  than adding one.
- **An axis picked before the first name is held in component state, not in the
  draft** (`pendingAxis`). A category row is carried by its annotations — the
  lexicon says `minLength: 1` — so there is nothing for an axis to ride on until
  the category is named. Writing an annotation-less row would have put a shape
  `isValidGrammar` refuses into the draft with **nothing in the footer to say
  so**, because `grammarIssues` judges coherence and not shape: Publish would
  have been enabled and the version dropped in silence. The authoring order §4.3
  asked for is still the one on screen; only the storage waits.
- **`setCategoryAxis` drops every annotation's `default`, whichever way the axis
  moves.** A default is an address under one particular feature, so carrying
  `Sing` across from `Number` to `Case` keeps a string and loses its meaning. The
  labels are the contributor's writing and are kept; the addresses are asked for
  again, and `category-default-missing` is what does the asking.
- **Two of the six new issue kinds cannot be provoked from this editor at all** —
  `category-default-forbidden` and `category-axis-inherent` — because both gates
  are rendered as navigation rather than validation: clearing the axis clears the
  defaults, and a feature already inherent to a category is absent from its axis
  picker (as the axis is absent from its inherence offers). Their repair paths
  were still built, since a record authored elsewhere reaches them: the offending
  axis is **kept in the picker, marked, and selected** so it can be replaced, and
  an orphaned default is shown in red beside the bound values rather than
  silently dropped on save. The other four were provoked and repaired in the
  browser.
- **`categoryRefinements` gained a `kind` discriminator** (`inherent` | `axis`)
  rather than a second function. The two steps are the same walk but ask
  different questions — what the word *is*, then which of its forms this
  dictionary *cites* — and they draw their options from opposite places: an
  inherent feature offers every bound value, while an axis offers only the
  flavours the category named, because an axis has **no declared inventory**.
  The entry editor labels them differently off that flag. `categoryAxes` is the
  `otherForms` half, and it is not the old `applicableAxes` renamed: it reads the
  **category rows by containment** and takes the value inventory from layer 1.

**The browser pass, and the half of it production cannot show.** Master has not
been tagged since **v0.27.3**, which predates slice 1 — so the deployed AppView
knows neither `categories` nor `GET /languages/:tag/labels/random`. Two
consequences met during the pass, both the deploy lag and neither a defect: the
`labels` model carries **no annotation rows** (an entry's bundle appears only as
an unnamed tag in use, which is what the usage chips joined on), and the
random-entry link 404s on every row because **the route does not exist yet** (a
missing `row` param returns 404 rather than the 400 the route would give — that
is how it was told apart). Both halves were checked locally instead, against the
record the editor had just published: `grammarRows` emits the two annotation
rows keyed `upos=ud:NOUN|ud:Gender=Masc|ud:Number=Sing` and `…|ud:Number=Plur`,
and `headwordKeys` puts the created entry under the second of them — the exact
key a slice-4 paradigm selector will match.

Verification: full `npm run typecheck` (8/8) and `npm run lint` (5/5). Browser
against a **bare quarantined `qtl`** published by hand — `scripts/publish-fixtures.ts`
is still on the pre-merge shape and could not run (action item below), and the
whole point of the pass was that the *editor* declares the grammar. Driven end to
end at 1280 px and again at 375 px: NOUN, Gender/Number and their values bound
through Primitives; Gender declared inherent to `{NOUN}`; the axis picker on
`{NOUN, Gender=Masc}` correctly refusing to offer Gender and the inherence offer
correctly refusing to offer Number; **two abbreviations on one category** —
`g.` defaulting to Sing and `str.` (anv-kadarn stroll) defaulting to Plur;
`category-default-missing`, `category-duplicate-default`, `category-default-unbound`
and `category-axis-unbound` each provoked, listed in the footer with Publish
disabled, and repaired from the row they belong to; the record published and
indexed. Then, in the entry editor, the narrowing walked `an.` → `gour.` →
**"Cited as — niver"** → `str.`, and the entry it created carries
`NOUN Gender=Masc|Number=Plur` **on the record** with its other form tagged
`Number=Sing` from the rebuilt axis selector. The quarantine was torn down
afterwards: `GET /entries?q=…&l=qtl` empty, no `qt*` tag in `GET /languages`,
`GET /languages/qtl/currentRecord` 404.

**Carried into slice 4:** `ParadigmEditorDialog` and `ParadigmView` are still the
slice-2 stubs and the Paradigms tab still lists flat. The exact-match join is
already live on both sides (slice 2), so what slice 4 adds is the record's own
shape — selectors and cell-by-cell tables — and the two verification harnesses
slice 2 deleted. The selector picker slice 5 owes now has something real to draw
from: **each annotation of each category is one candidate**, and
`categoryTags(grammar, row)` is the function that produces them, labelled.

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
- [ ] **Slice 4 owes two verification harnesses**, deleted in slice 2 because the arc removed what
  they tested: `verify-paradigms.ts` (ingest, identity, expansion) and `verify-paradigm-reader.ts`
  (the pure display path). Both are recoverable at commit 343516e.
- [ ] **Slice 5 owes the rule-row UI**, deleted with `ParadigmEditorDialog`'s body and
  `lib/paradigm-draft.ts`. Also recoverable at 343516e, as is the reader's table geometry
  (`mergeCellSpans` survives in `packages/types`) and the `entry.*` copy for the two absent states.
- [ ] **Slice 2's paradigm-ingest gate must be removed in slice 4.** `PARADIGM_INGEST_GATED` in
  `apps/api/src/firehose/ingest-paradigm.ts` refuses every paradigm record; slice 4 replaces the
  function it guards.
