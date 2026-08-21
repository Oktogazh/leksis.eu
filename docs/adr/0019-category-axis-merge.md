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
- [ ] **Slice 3** — the categories editor (axis + default-value annotations) and the entry
  editor (narrowing emits the full bundle; otherForms picker over the axis feature's bound
  values).
- [ ] **Slice 4** — paradigm v2: lexicon (selectors + cell-by-cell tables), types
  (`paradigmIssues`/`generateForms` v2, exact-match reach), ingest + API, basic table reader.
- [ ] **Slice 5** — the paradigm table editor (grid, merges, per-cell rules) + entry-page polish.
- [ ] **Slice 6** — testset pass, docker build gate, lexicon republish, CHANGELOG, skills update,
  finalize this ADR, bump packages to **0.28.0**, propose tag `v0.28.0`.

### State after last session

**2026-08-21, slice 2 — built and verified; next session starts slice 3.**

The shapes, as built. `grammar.categories` replaces `bindings`: a row is
`{category: Tag, axis?: string, annotations: [{long, short?, default?}]}`, and
**each annotation is a labelled tag of its own** — the category, plus
`{axis: default}` where there is one, with the default's provenance re-attached
from its `values` row (`categoryTags`). So the labels read model needed no change
at all: `grammarRows` emits one row per annotation and everything downstream —
the shelf, the counts, `resolveTag`'s exact branch — joins on the same keys it
always did. `GRAMMAR_LIMITS` lost six entries and gained `annotations: 16`.

Six deviations from the design note, each with its reason:

- **The language doc caches `categories`** beside `inherent`. §3.1 said the
  headword key is computed from the inherence rows, but it cannot be: the default
  axis value is now part of the identity, and only the category rows say which
  feature a category varies over and which of its values is a headword flavour.
  The consumer has no record in hand, so the rows are cached exactly as
  `inherent` is, raw and whole.
- **No `category-unbound` kind was added.** `unbound-atom` and
  `ungrounded-combination` already say it, so the §2.1 table's "renames the
  grounding checks as needed" was answered by renaming nothing. Grounding is now
  skipped for a single-atom category, which is what lets a bare part of speech be
  one.
- **`single-item-binding` was not replaced, it was dissolved** — and this is
  worth knowing before slice 3 designs the Categories tab. A POS-only category
  *with an axis* is the point of dropping the two-atom floor. A POS-only category
  *without* one is a second label for the tag its `pos` row already binds, so it
  is reported as `duplicate` by the sweep that has always enforced one row per
  tag. The verification harness asserts exactly that, after asserting the
  opposite first and being wrong.
- **`paradigmsReaching` and the expansion filter became exact in this slice**,
  not in slice 4 as §2.3 filed them. They had no choice: `inherentAtomKeys` is
  gone, and leaving the browser on containment while the AppView matched exactly
  would break morphology invariant 6 for the duration of the arc. `paradigm.ts`'s
  *shape* is untouched (still one `selector`, no tables) — only the join moved.
  The paradigm doc's `selectorAtoms` is **gone rather than replaced**: the
  equality key is derived from the stored `selector` on demand, because nothing
  indexes it and the AQL filter is built in JS either way.
- **The paradigms tab lists paradigms flat.** Its door was the layout list, which
  no longer exists; rebuilding it belongs to the slice that rebuilds the editor.
- **Two verification harnesses were deleted rather than reworked**:
  `verify-paradigms.ts` and `verify-paradigm-reader.ts`. Their subject — the
  containment selector, most-specific-wins, and `layoutView` — is what this arc
  removed, so there was nothing left in them to adjust. Slice 4 owes both (action
  item below). `verify-ingest-gate.ts` absorbed the paradigm-ingate check.

**Two problems the plan did not anticipate, both found in the browser and both
fixed here.**

1. **A pre-merge record could not be loaded, so it could not be repaired.**
   `fetchLanguageRecord` validates with `isValidGrammar` and refuses a record it
   rejects — and the new lexicon rejects `axes`/`layout` outright. Every language
   declared before the merge (i.e. all of them) therefore loaded as `null`, and
   the Grammar & labels button sat disabled: exactly the ADR-0015 deadlock, from
   the other direction. Fixed with `withoutRetiredGrammar` in `packages/types`:
   the AppView validates the record as it stands, an **editor** validates it with
   the retired keys set aside, and the record is still handed over carrying them
   so the editor can say what publishing will drop.
2. **`draftFromRecord` forward-maps `bindings` → `categories`**, one category per
   row with a single annotation, and drops `axes`/`layout`. Without it a
   contributor would load those keys invisibly into the draft, see no defect —
   `grammarIssues` cannot report a field it does not know — and have every
   publish silently refused. `axes` is deliberately *not* carried forward: the
   feature could be, but which of its values a headword sits at is the
   lexicographic judgement the merge exists to capture, and a guessed default
   would be incoherent on arrival. `carriesRetiredGrammar` drives a one-line
   notice in the footer, because a Publish button that is enabled on open with
   nothing visibly changed should not quietly drop somebody's declaration.

**A third fix, in a function this slice had to rewrite anyway:** `tidy` in
`grammar-draft.ts` rebuilds the grammar object from a fixed list of arrays and
**`abbreviations` was not on it**, so every abbreviation a contributor added was
discarded by the very call that added it. Pre-existing, unrelated to the merge,
and invisible until the list was rewritten.

**`br` was deliberately not republished, and the plan's mechanism is retired.**
Its current record is authored by **the developer's own account**
(`alankersaudy.bsky.social`), not by a bot — so §5's "putRecord as
testaccount.leksis.eu, last-write-wins makes it current" would have displaced the
user's own version with the test account's. It is also no longer necessary: the
editor now loads that record, maps it forward and publishes the migration itself,
which is a better path on every count (the record stays its author's, the new
code path gets exercised, no impersonation). **Proposed instead:** open Grammar &
labels on `/language/br` while logged in as the author and press Publish. Nothing
in slice 2 depends on it — the indexed version stays current until someone
publishes over it.

**One visible behaviour change to expect, and it is the merge working.** `br`'s
one paradigm selects `{NOUN}`; its entry *biz* is `{NOUN, Gender=Masc}`. Under
containment the paradigm reached it and generated *bizied*; under exact match it
does not, and the entry shows only the form its author wrote. Every language's
paradigms go inert until its categories declare an axis with defaults and its
entries are republished carrying them. This is §1.4 as designed, and it is the
concrete reason the arc must not be tagged before slice 6.

Verification: full `turbo typecheck lint --force` (13/13); `verify-ingest-gate.ts`
reworked and **37/37** against a local ArangoDB, covering every new issue kind,
the outright refusal of `axes`/`layout`, the headword bundle an entry is indexed
under (both that it keeps the inherent feature and the default, and that it drops
an undeclared one), and the paradigm stopgap; `db:init` run locally — the
`idx_language_selectors` index ensured, `idx_language_inherent` dropped, generated
forms swept to zero; browser at 1280 and 375 px against the production API — the
`br` dashboard and its record-link footer, the dialog opening on the forward-mapped
record with three tabs, the two carried-over categories at the foot of the
Categories list with their slice-1 usage chips intact, the Paradigms tab's notice
and the stub editor behind it, and `/entry/br-biz-962d` degrading to the flat form
list. One unrelated 400 was observed on `com.atproto.server.refreshSession` before
a successful `getSession`; the dev session works and it predates this slice.

**Carried into slice 3:** the Categories tab is still the old combinations walk
(pick a category → a feature → one value at a time), writing one axis-less
annotation per row — the axis picker, the default-value picker and the
several-abbreviations affordance are slice 3's, and `upsertCategory` /
`removeCategory` / `findCategory` in `grammar-draft.ts` are what they build on.
The entry editor's narrowing still emits bundles without defaults, and
`FormTagEditor` is on the flat picker. Also still true from before slice 1: the
latest tag is v0.27.3 while every `package.json` says 0.26.0 (realigned at 0.28.0
in slice 6).

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
- [ ] **Slice 4 owes two verification harnesses**, deleted in slice 2 because the arc removed what
  they tested: `verify-paradigms.ts` (ingest, identity, expansion) and `verify-paradigm-reader.ts`
  (the pure display path). Both are recoverable at commit 343516e.
- [ ] **Slice 5 owes the rule-row UI**, deleted with `ParadigmEditorDialog`'s body and
  `lib/paradigm-draft.ts`. Also recoverable at 343516e, as is the reader's table geometry
  (`mergeCellSpans` survives in `packages/types`) and the `entry.*` copy for the two absent states.
- [ ] **Slice 2's paradigm-ingest gate must be removed in slice 4.** `PARADIGM_INGEST_GATED` in
  `apps/api/src/firehose/ingest-paradigm.ts` refuses every paradigm record; slice 4 replaces the
  function it guards.
