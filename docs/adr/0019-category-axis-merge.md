# ADR-0019 — The category–axis merge

- **Status:** **Accepted.** Built across six slices on 2026-08-21 and released as **v0.28.0**. This
  file was the arc's cross-session progress tracker and is now its record: the Progress section
  below is history, the Decision and Consequences are what shipped. Where this ADR and
  `docs/design/category-axis-merge.md` disagree, **this ADR wins** — the note is the plan, this is
  the outcome.
- **Date:** 2026-08-21 (staged) / 2026-08-21 (accepted)
- **Deciders:** Alan Kersaudy
- **Supersedes:** ADR-0008's `grammar.axes` (removed), ADR-0009's `grammar.layout`
  (removed — table shape moved into the paradigm record), ADR-0016's containment selector
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
(built as `GET /languages/:tag/labels/random?row=…` — see the Consequences).

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
- [x] **Slice 5** — the paradigm table editor (grid, merges, per-cell rules), the selector walk, the
  identity guard, and the reader's third form state. *Done 2026-08-21.* It also closed slice 4's
  deferred browser pass.
- [x] **Slice 6** — the fixture set rebuilt over the merged shapes, the testset pass driven in a
  browser and torn down, the docker build gate, the CHANGELOG, the skills and docs, this ADR
  finalized, packages bumped to **0.28.0**. *Done 2026-08-21.* The lexicon republish is the one
  step it could not take — see the action items.

### State after slice 6 — the arc is closed

**2026-08-21, slice 6 — the fixture set rebuilt, the testset pass driven in a
browser against a local AppView and torn down, the image build gate passed,
everything recorded, packages at 0.28.0.**

**The fixture set was the blocker and is now the proof.** `qtl` declares seven
categories: a part-of-speech-only one (`{ADJ}`, axis Gender), one with no axis at
all (`{VERB, VerbForm=Inf}`), one whose default is the **minted** `Number=Sgv`,
two inflection classes, the finite verb cited at `Person=1`, and — the row the
whole arc exists for — `{NOUN, Gender=Masc}` with **two** annotations, `ak.g.`
defaulting to Sing and `ak.str.` defaulting to Plur. Seven paradigms: one serving
**two** categories under one identity, one selecting the plural-headword flavour
and demonstrably not its singular sibling, one inert on a category nobody
declared, and one carrying all three blank states in a single table. `qto`'s
rewrite triggers all twelve surviving issue kinds and is refused whole.

**Four things the browser pass established that no harness could.**

- **The merge is legible in the label shelf.** `GET /languages/qtl/labels` serves
  `ak.g.` (×5) and `ak.str.` (×1) as two rows of **one** declaration, told apart
  only by their default — and `ak.un.` at `Number=Sgv` carries `scheme: "qtl"`,
  re-attached by `categoryTags` from the `values` row, which is what lets the
  chip find its label at all.
- **Exact match is visible from the reader's side.** `bezhin` (`Number=Plur`)
  draws the anv-stroll tables and derives `bezhinenn`; `kambr`, the same category
  at `Number=Sing`, draws a different record's table. Containment would have
  given them both.
- **The three blank states are three different marks on one page.** `roska`'s
  first table prints `·` where no rule exists, `—` where a rule declined, and
  nothing at all where the language wrote filler — with a legend naming each, and
  a fourth mark for the entry's own form standing over a generated one.
- **Search sees generation, and sees the override.** `kambroù` and `bezhinenn`
  (generated) both return their entries; `roskarum` returns nothing, because the
  entry's own `roskerum` took that address.

**What the run also showed about production, and why the tag matters.** The
fixtures travel the real PDS, so the live AppView — still on v0.27.3 — ingested
them too: it indexed the three languages and the entries and **refused all seven
paradigms**, whose `selectors`/`tables` its lexicon does not know. That is the
arc's breaking half, observed rather than argued, and the reason no tag was
allowed before this slice. The teardown emptied both indexes; `GET /languages`
carries no `qt*` tag in production.

**Two deviations from the design note were found by driving slice 1's surfaces
and are recorded in the Consequences**: the sample endpoint takes the row key as
`?row=`, not as a path segment, and a row at zero shows no chip at all.

**Verification.** Full `npm run typecheck` (8/8), `npm run lint` (5/5),
`npx tsc -p scripts/tsconfig.json` clean, `publish-fixtures.ts --check` green
over all four validators, `verify-paradigms.ts` 50/50, `verify-paradigm-reader.ts`
37/37, and `PDS_ADMIN_PASSWORD=x PDS_JWT_SECRET=x PDS_PLC_ROTATION_KEY=x docker
compose build api web` — both images built.

### State after slice 5

**2026-08-21, slice 5 — built, typechecked, linted and driven end to end in a
browser against the quarantined `qtl` fixture, which was torn down after.**

A paradigm's tables are now authored. `ParadigmEditorDialog` is a grid editor:
the selectors are picked by walking the language's own categories, each table is
a rectangle whose rows and columns are inserted and removed at a position, a
cell is a heading, a form or filler, and a form cell carries its address and the
ordered rules that fill it. `lib/paradigm-draft.ts` is the model behind it, and
the Paradigms level of the grammar dialog finally has a door — *Declare a
paradigm* — plus one row per published record.

Eleven decisions worth reading before touching this area:

- **The grid is edited as the rectangle it draws, not as the rows the record
  stores.** A record writes a spanned cell once and omits the positions it
  covers — right for storage, wrong for editing, where inserting a column means
  adding a cell to some rows and widening a span in others. `gridFromTable` /
  `tableFromGrid` convert, and the round trip is exact because `paradigmGrid`
  places each cell at the first free position of its row.
- **Two invariants hold over every operation, and they make `ragged-table`
  unreachable from the interface** — the way the old editor made `unknown-base`
  unreachable by offering only valid bases. The grid always tiles its rectangle,
  and **every row keeps a cell of its own**. The second was found while
  building: a row covered from end to end by spans from above serializes to
  `[]`, which `isValidTable` refuses, so `mergeDown`, `removeColumn` and
  `insertRow` decline instead of producing it.
- **Merge ergonomics (design note §6, decided here):** one column or one row at
  a time, absorbing **only filler**, plus unmerge. Predictable — a wide merge is
  repeated clicks — and no merge can quietly discard a heading somebody wrote or
  a cell's rules. Clearing a cell first is one click; a silent loss is not
  recoverable.
- **`Cell.kind: "empty"` earns its place (§6, decided).** It is the blank corner
  of a header grid, and it has to be a different thing from a heading with no
  text: the latter renders as a `<th>`, which assistive technology announces as
  a column header for the column under it.
- **A selector is picked with the entry editor's own walk**
  (`categoryRoots` / `categoryRefinements`), not from a flat list of
  `categoryTags` as the note proposed. The two nearly agree, and where they
  differ the walk is right: it produces exactly the bundles an entry can be
  created with — a bare part of speech included, which a language that has
  declared no category still has — and a selector no entry can carry reaches
  nothing. The axis step reads *Cited as (niver)*, which is the merge stated in
  the interface.
- **A new paradigm whose categories already have one is refused, with a door to
  the published record.** The concurrency guard is skipped while creating,
  precisely because there is then nobody else's work to lose — so publishing a
  "new" paradigm onto an existing identity would be the one rewrite with no
  guard behind it. `paradigmRkey` is computed from the draft and compared with
  the pointers the level already holds; *Open the published tables* remounts the
  editor on that record.
- **The editor addresses the *published* grammar, never the grammar dialog's
  draft.** A paradigm is a different record with its own publish button, so a
  cell address built from a value that exists only in an unsaved draft would be
  publishable *and* pointing at nothing the moment the draft was abandoned.
- **The cell-address picker offers every bound grammatical feature**, not the
  category's axis. A conjugation cell is addressed by person, number, tense and
  mood at once, and one paradigm may serve several categories; the axis is the
  single feature whose default identifies the *headword*, which is a different
  question. Several values of one feature select together — the settled spelling
  of syncretism.
- **The preview's specimen is a real word.** *Draw one* fills the lemma from
  slice 1's random-entry endpoint, keyed on the first selector, because a
  category's annotation is a labelled tag like any other. That is what the note
  called the reroll, and it is worth more than a reroll: rules written against
  an invented lemma test the author's own spelling.
- **The list waits for the index, but only for a new paradigm.** A rewrite keeps
  its identity, so its row is already on screen and nothing visible changes when
  the new version lands — a notice about it would be a notice about nothing.
- **The reader gained a third form state.** A form the entry asserts **over** a
  generated one is marked and named in the legend. Only the containment case can
  reach it — `mergeParadigms` already suppresses a generated form at the *same*
  address — and it is the case that matters: without it, a rule that is wrong
  for one word and a rule that is wrong for the language look identical.

**Verification.** Full `npm run typecheck` (8/8) and `npm run lint` (5/5). The
browser pass ran against the local API with `scripts/slice4-fixture.tmp.ts`'s
`qtl` fixture, and covered: a v2 record loading into the grid with its merged
title cell intact; the inspector's kind toggle, address picker and rule row; a
column added and its new cell addressed `Number=Ptan` as manual-only, published,
and the entry's off-table form **moving out of the leftover list into that
cell**; the selector walk (`an.` → `g.` → *Cited as (niver)* → `str.` / `g.`);
the identity guard firing on `str.` and its door loading the published tables;
a second paradigm declared for the singular flavour, which reaches `kambr` and
**does not reach** `bezhin` — exact match, seen from the authoring side; the
override marking, driven by giving `kambr` a form tagged
`Gender=Masc|Number=Plur` against a cell addressed `Number=Plur`; merge and
unmerge with their gating (*Merge right* offered only where the neighbour is
filler); and *Draw one* filling the lemma with `bezhin` and the preview
generating `bezhinenn` from it. The fixture was torn down afterwards and the
local index confirmed empty of it.

**Slice 4's browser pass is therefore done, not carried.** The reader drew the
authored spans, the language's labels over each cell, a generated form, an
asserted one, both absent states and a leftover — the whole of what that slice
deferred.

**Carried into slice 6:** the `otherForms` picker still offers only the
category's axis feature values (§6's second open question). It bit exactly once
in this pass — addressing `Gender=Masc|Number=Plur` needed the manual field —
which is evidence for widening it to the features a matching paradigm's cells
use, and not enough to design it against a fixture with no conjugation in it.
Left open deliberately. Also noted while working: the local index still carries
`qaa-x-s2`, `x-gate` and `x-para` from earlier slices, which the fixture-set
rewrite should sweep.

### State after slice 4

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

**A category declares its axis and its default value(s) together, and everything downstream keys on
the bundle that produces.** Six changes, each following from the one before it:

1. **`grammar.categories` replaces `grammar.bindings`, and `grammar.axes` and `grammar.layout` are
   gone.** A row is `{category: Tag, axis?: string, annotations: [{long, short?, default?}]}`. The
   old ≥2-atom floor on a named combination is removed — a bare part of speech is a category like
   any other, and has to be, because a category is now also where an axis is declared. `default` is
   **required iff `axis` is set** and forbidden otherwise; several annotations of one category are
   several headword flavours, each a labelled tag of its own.
2. **A category names its axis feature and its defaults, never a value inventory.** What values
   exist is layer 1's business and which cells are printed is the paradigm record's, so a category
   says only which feature varies and where its own headwords sit. That is the minimum nothing else
   can derive.
3. **The entry's bundle carries its default axis value.** The narrowing tree emits it, so an
   *anv-kadarn stroll* is tagged `NOUN Gender=Masc|Number=Plur` on the record itself and the record
   self-describes without the language record in hand. This reverses ADR-0008's "never store the
   axis value on the entry", and the justification is (4): the value is now identifying.
4. **A paradigm selector is an exact match on the full headword bundle**, and `selectors` is a
   list. Containment, `inherentAtoms` and the whole most-specific-wins machinery are gone: two
   paradigms cannot both reach one entry, and one record serving several categories says so by
   listing them. On the `entries` doc, `selectorKeys` replaces `inherentAtoms` and the index
   becomes `["languageID", "selectorKeys[*]"]` — an indexed **equality** lookup where the old one
   was an intersection.
5. **A paradigm carries its own tables, authored cell by cell.** A cell is a `title`, an `empty`
   filler or a `form` with its address and its ordered rules; merging is authored with
   `rowSpan`/`colSpan`; a rule no longer carries an address, because the cell it sits in is the
   address. Real conjugation tables are not cartesian products of their axes, which is what the
   derived-cell layout model could never express.
6. **Two independent surfaces ride along**: usage counts and a random-entry sample beside every
   declaration in the grammar editor, and a link to the accepted language record on the dashboard
   footer.

## Consequences

**What got simpler.** The grammar editor lost two whole tabs — an axis is declared on its category,
a table's shape is a different record — and the walk from a part of speech to a refined category no
longer passes through a naming step, so a language's declarations can go as deep as its inherence
rows do without anything having to be named on the way down. `mergeParadigms`' precedence machinery
is a formality under exact match. The expansion job's AQL became one indexed equality lookup per
selector.

**What got harder, and is the price.** A headword bundle is now longer and an entry authored before
the merge carries a bundle that no longer identifies its flavour; pre-1.0 that costs a bot
republish, which is exactly the window this change had to be taken in. `selectorKeys` **stales** the
same way `inherentAtoms` did: a language-record change does not re-key entries, and they refresh on
their next republish. And a category with an axis now has an *undecidable* state — an annotation
with no default — which is why `category-default-missing` is a reported defect rather than a shape
rejection.

**The issue kinds turned over.** Eight went with the arrays that carried them
(`single-item-binding`, `inherent-axis-conflict`, `empty-axis`, `layout-unknown-axis`,
`layout-repeated-axis`, `layout-foreign-coordinate`, `empty-layout-block`, `layout-too-large`) and
six arrived (`category-axis-unbound`, `category-axis-inherent`, `category-default-missing`,
`category-default-forbidden`, `category-default-unbound`, `category-duplicate-default`) —
`grammarIssues` reports twelve kinds where it reported fourteen. `MAX_LAYOUT_CELLS` was replaced by
`MAX_TABLE_CELLS` (4096) as a `paradigmIssues` kind, guarding the same thing one altitude lower:
a table is written out rather than derived, so nobody can produce a million cells by declaring one
more axis, but a bot can still emit a grid no reader could scroll.

**Deviations from the design note, decided while building.** Each is the code's, and the code wins:

- **The sample endpoint takes the row key as a query parameter**, not a path segment:
  `GET /languages/:tag/labels/random?row=<canonical row key>`. A canonical row key carries `=`, `|`
  and, on a layered feature name, brackets, none of which survive being a path segment.
- **The sample is fetched on demand, one request per click**, not eagerly with the labels response.
  A values level can run to hundreds of rows — an imported abbreviation list does exactly that —
  and pre-fetching an example for each would be hundreds of requests nobody asked for.
- **A row at zero shows no chip at all**, where the note said "count chip only". In a young
  dictionary most rows are at zero and printing it on each would bury the counts that mean
  something; the dashboard's own shelf still prints `0`, because there every row is a declaration.
- **The sample opens in a new tab.** The dialog holds an unpublished draft, so following a link in
  place would throw the contributor's work away to answer a question they asked *about* that work.
- **`paradigmSelectorKey` became two functions** (`paradigmSelectorKeys`, sorted and deduplicated,
  and `paradigmIdentityKey`, joining them with `;`), and `ParadigmDoc.selectorKey` keeps the joined
  string because the paradigms endpoint sorts on it and a sort key has to be one value.
- **`placeForms` had to learn multivalue *cells*, not merely be re-hosted.** While cells were
  derived from a layout they were single-valued by construction; a syncretic cell is now the
  ordinary way to draw one, so each side is expanded to the addresses it spans before they meet.
- **A selector is picked with the entry editor's own walk**, not from a flat list of
  `categoryTags` — the walk produces exactly the bundles an entry can be created with, and a
  selector no entry can carry reaches nothing.
- **The cell-address picker offers every bound grammatical feature**, not the category's axis: a
  conjugation cell is addressed by person, number, tense and mood at once, and one paradigm may
  serve several categories.
- **Merge ergonomics** are one row or column at a time, absorbing only filler, plus unmerge — so no
  merge can silently discard a heading somebody wrote or a cell's rules.
- **`Cell.kind: "empty"` earned its place** (design note §6, decided): it is the blank corner of a
  header grid, and it has to differ from a heading with no text, which renders as a `<th>` and is
  announced as the column header for the column under it.

**What the fixture set now proves** (`leksis-testset` §3, rebuilt in slice 6): the seven `qtl`
categories include one with no axis, one on a bare part of speech, one whose default is a minted
value, and two — the ordinary masculine noun and the *anv-kadarn stroll* — that are the same
category at different defaults, abbreviated differently. Seven paradigms include one serving two
categories under one identity, one reaching the plural-headword flavour and **not** its singular
sibling, and one inert. `qto`'s defective rewrite triggers all twelve issue kinds and is refused
whole.

**The reader gained a third form state and a third blank state.** A form the entry asserts *over* a
generated one is marked, so a rule wrong for one word and a rule wrong for the language stop looking
identical. And a cell is now blank in three distinguishable ways: no rule at all (manual-only, an
invitation), a rule whose condition declined for this lemma, and structural filler the language says
cannot exist. ADR-0009's two-state rule is the middle two of those three.

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
- [x] **The fixture set is rebuilt over the merged shapes** (2026-08-21).
  `scripts/fixtures/languages.ts` declares seven `categories` with their axes and defaults,
  `paradigms.ts` seven v2 records with authored tables, `check.ts` the twelve surviving issue
  kinds, `preview.ts` runs `resolveParadigmTables` + `placeForms` where it ran `layoutView`, and
  `entries.ts` carries the default axis value on every bundle plus one new entry — the
  *anv-kadarn stroll* whose singular sibling proves exact match. The coverage matrix's L-13…L-19,
  L-30…L-41, E-32…E-34 and P-01…P-12 rows were rewritten with it.
- [x] **`scripts/publish-lexicons.mjs`' output is verified** (2026-08-21): a `DRY_RUN=1` run emits
  all eight schema records, including `eu.leksis.paradigm` and the reshaped `eu.leksis.language`.
  **Running it for real is still owed and was not this session's to take** — the script needs the
  `lexicons.leksis.eu` app password and must run from an IP the PDS allowlists. The gap it has to
  close is wider than this arc: `getRecord` against that repo today resolves **only**
  `eu.leksis.language` (pre-grammar) and `eu.leksis.entry` (still carrying `botSource`, removed at
  v0.9); `defs`, `source`, `relation`, `cognate`, `profile` and `paradigm` have never been
  published at all.
- [x] Slice 6: `docs/design/grammatical-tagging.md` and `docs/design/paradigm-rules.md` now point
  here for everything the merge changed, and their layer-3/4 sections are marked superseded.
- [x] **Slice 4's two verification harnesses are rebuilt over v2** (2026-08-21):
  `verify-paradigms.ts` (ingest, identity, exact-match reach, expansion, the missing-form queue)
  50/50, `verify-paradigm-reader.ts` (grid geometry, issues, generation, placement) 37/37.
  **Kept rather than deleted** (slice 6, reversing slice 4's "temporary by design"): every other
  `verify-*.ts` in `apps/api/src/scripts/` has outlived the loop that wrote it, ADR-0011 has an
  open action item asking for *more* of them, and these two are the only executable check on the
  exact-match reach and the grid arithmetic layer 6's exporter will read. Both re-run green at
  slice 6. `scripts/slice4-fixture.tmp.ts` **was** deleted: the rebuilt fixture set publishes
  everything it did, through the same path a testset run uses.
- [x] **Slice 5's rule-row UI is rebuilt** (2026-08-21), recovered from 343516e and re-hosted
  inside the cell it fills: base, condition, both affix pairs, reordering, removal. It sits in the
  cell inspector rather than in a flat list, because a rule no longer carries an address of its own.
- [x] **Slice 2's paradigm-ingest gate is gone** (2026-08-21). `PARADIGM_INGEST_GATED` is deleted
  and the function it guarded now speaks v2: rkey recompute, `paradigmIssues` gate, tables cached
  for the expansion job.
- [x] **Slice 4's browser pass is done** (2026-08-21), inside slice 5 rather than deferred to the
  testset slice: the same `scripts/slice4-fixture.tmp.ts` fixture the editor had to be built
  against is the one the reader needed, so driving one drove both. Titles, authored spans, the
  minted `Sgv` cell's label, a generated form, an asserted one, both absent states and a leftover
  all render as the harness said they would. The script was deleted at slice 6; the two harnesses
  were kept.
- [ ] **The local dev index carries three ghost languages, and two of them are not leftovers.**
  `x-gate` and `x-para` are `verify-ingest-gate.ts`'s and `verify-paradigms.ts`'s own fixture
  languages, re-created on every run of those harnesses — nothing a testset teardown can sweep,
  because they never travelled the PDS. `qaa-x-s2` is a genuine leftover from an earlier slice.
  All three are **local only** (production's language list is clean, verified after slice 6's
  teardown) and removing them means deleting ArangoDB documents, which is a hard stop; the cheap
  fix is a fresh local database rather than a surgical delete.
