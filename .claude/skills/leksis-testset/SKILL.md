---
name: leksis-testset
description: >
  The Leksis **testset protocol** — a set of tests the agent itself runs against a small, deliberately feature-complete set of live eu.leksis.* fixture records (languages, entries, sources, and later paradigms and other lexicons) published under quarantined private-use language tags. Use this skill (a) as the MANDATORY final slice of every feature implementation — publish/refresh the fixture rows the feature added to the coverage matrix, then drive the affected flows in the browser against the manifest's expect lines — and (b) before ANY release tag, since a tag deploys to production (see leksis-evolution's pre-tag gate). Also use it when building, extending or resetting the fixture set itself: it defines the quarantine rule, the size budget, the on-record addressing convention, the manifest, and the coverage matrix every shipped design feature must appear in. It is NOT for importing real dictionary content — that is `leksis-ingest`, which this skill assumes you have read for the lexicon shapes and the PDS mechanics.
---

# Leksis testset — live fixture records, and the protocol that tests against them

## What this is, and when it runs

Originally this skill specified a fixture *bot* to be built in another project.
That bot was never built, and it turned out not to be needed: **the agent
reading this skill is the test runner.** It publishes and maintains the fixture
records itself — by running `scripts/publish-fixtures.ts` (§2.3), from the
account §4.1 names — and it drives the browser against them.

**When the protocol runs (decided 2026-08-14):**

1. **As the final slice of every feature.** A feature implementation plan ends
   with a dedicated verification slice: add the feature's rows to the coverage
   matrix (§3), publish/refresh the fixtures those rows need, regenerate the
   manifest, then drive the affected flows in the browser (§5) and assert
   against the `expect` lines. A feature without this slice is not finished.
2. **Before any release tag.** A tag deploys to production
   (`leksis-evolution`'s pre-tag gate), and a tag is only created at a
   feature's final slice — so in practice gate 1 and gate 2 are the same pass;
   the rule exists so no tag ever ships on a stale pass.

## What the fixture set is

Every ingestion bot exists to grow the dictionary. This record set exists to be
**looked at**. It is a fixed, small set of `eu.leksis.*` records whose only
purpose is to give a browsing agent a page it can open and assert against for
every feature the design has shipped.

The records are **live and public**. They go through the same PDS, the same
firehose and the same AppView as real content, and they appear in the real
language list. That is deliberate: a fixture that does not travel the whole
path proves nothing. It is also the reason for every rule below.

**And they are ephemeral.** The set is **published for a test run and torn down
when it ends** — it does not sit in the production index between sessions. The
lifecycle is one line:

```bash
npx tsx scripts/publish-fixtures.ts            # publish, sweep, write the manifest
#   … drive the flows in the browser against that manifest …
npx tsx scripts/publish-fixtures.ts --teardown # remove it all, blank the manifest
```

Three consequences, all load-bearing:

- **`entryKey`s are minted per run and never repeat** (they hash the creating
  record's URI), so **no URL in this skill is stable** and none is written down.
  The manifest the run writes is the only address book, and it is valid only
  until the teardown.
- **A session that wants to test must publish first.** There is nothing standing
  to open. That costs a couple of minutes and buys a production index that
  carries no fake dictionary between runs.
- **A committed manifest with `tornDownAt` is the correct resting state.** If you
  find one with entries in it, either a run is in progress or a session forgot to
  tear down — treat it as stale, not as an address book.

> Read **`leksis-ingest`** first. It holds the PDS mechanics (account, auth,
> rate limits, `applyWrites`), the exact lexicon shapes, the grammatical
> tagging model and the ingest validation rules. This skill adds only what is
> specific to fixtures, and never restates a shape.

## The two pressures, and how they resolve

| Pressure | Resolution |
|---|---|
| **Small** — an agent that pages through hundreds of records burns its context before it tests anything | Hard ceiling: **40 entries total**, across all fixture languages. Aim for the smallest set that covers the matrix. |
| **Complete** — a feature with no fixture is a feature nobody tests | The **coverage matrix** below is the checklist. Every shipped design feature has a row; a layer that ships without adding its rows is not finished. |
| **Findable** — in a future where thousands of real records exist, stumbling on a fixture by search is hopeless | Three mechanisms, all required: quarantined language tags, an on-record handle, and a regenerated manifest. |

The 40-entry ceiling is not arbitrary: `GET /entries?q=…` caps at **50
results** and an empty `q` returns **nothing** (there is no "list all"
endpoint), so 40 is what keeps the whole set retrievable in one call with
headroom.

---

## 1. Quarantine — the fixture languages

**Never publish a fixture under a real language tag.** ISO 639-3 reserves the
range `qaa`–`qtz` for local use and BCP 47 accepts it syntactically, so the
fixture set lives entirely inside it. Three languages, each with a job:

| tag | role | grammar |
|---|---|---|
| **`qtl`** | the **full** fixture language — everything that is supposed to work | layers 1–5 declared (primitives, inherence, axes, layout, and five paradigms), `grammarIssues` **empty**, permanently |
| **`qtm`** | the **bare** language — the degrade path the design promises | **no `grammar` at all**; its entries carry tags nobody bound |
| **`qto`** | the **defective** language — the *refusal* test target | published coherent first, then rewritten with one row per `GrammarIssue` kind, on purpose |

Why three and not one: `qtm` proves the fallbacks (verbatim tag rendering, the
flat `otherForms` list, the flat picker) which are load-bearing promises of the
design and which a fully-declared language can never exercise. `qto` exists so
that a *deliberately broken* grammar never has to live on `qtl` — a bad version
still **cannot be un-published**, because a language's version *history*
accumulates for as long as the language exists, so a broken grammar published on
`qtl` sits in its history and its dashboard for the life of `qtl`. Think before
you publish a language version.

**What changed (ADR-0018, 2026-08-18): the language itself is no longer
permanent.** Deleting the last version of its record removes it from the index
entirely — `GET /languages`, the picker, `localLanguages`, its declared labels.
So a fourth fixture language is no longer a permanent addition to the production
language list, and the teardown genuinely empties the quarantine. Deletion is an
undo for the *language*, never for one bad *version* of it.

**`qto`'s job changed with ADR-0015 and its shape changed with it.** An
incoherent grammar is no longer indexed-and-flagged, so there is no repair
worklist for it to populate; what it now proves is the pair of properties the
refusal rests on. Publish a **coherent** `qto` first, then the defective rewrite:
the rewrite must be **refused** (the coherent version stays current, so `qto`
stays browsable), while the browser — which reads `getRecord` by rkey, and a
language record's rkey is its tag — reads the *defective* content and the binding
editor must list every defect and block Publish. One consolation in the new rule:
a refused version never enters the record's history at all, so the broken rewrite
is less permanent than a bad version used to be.

Reserve the next tags (`qtp`, `qtq`, …) for future lexicons rather than
crowding an existing fixture language.

**Each fixture language's endonym must announce itself.** The endonym is
required (a `translations` item whose `languageID` equals the record's `tag`)
and it is what a human sees in the live language picker — so make it say
`leksis test (full)` / `leksis test (bare)` / `leksis test (broken grammar)`,
in that language's own "spelling". Add an English translation too, so it reads
sensibly in the default UI locale. Nobody should ever mistake one of these for
a real language.

---

## 2. Addressing — how an agent finds the right page

Three layers, because each fails differently.

### 2.1 The handle, on the record

Every fixture entry carries a **handle** as a non-canonical orthography:

```
orthography: ["tavesk",  "lxt-07"]
              ^ a plausible word in the fake language, so the page renders realistically
                          ^ the handle: stable, greppable, and INDEXED for search
```

The AppView's search index is the lowercased orthographies **plus** the
`otherForms` spellings, and search is prefix-based — so
`GET /entries?q=lxt-&l=` returns **the entire fixture set with its entryKeys**,
in one call, forever. That is the whole trick, and it is why the handle goes in
`orthography` rather than in a field the index never sees.

Cost, accepted: the handle shows on the entry page as a spelling variant. For a
fixture that is a feature — the page announces which fixture it is — and it is
the only on-record slot that is both searchable and free.

### 2.2 The purpose, on the record

Every fixture declares **what it is for**, on the record, so an agent that
opens the page knows what it is supposed to be asserting:

```jsonc
references: [{ "text": "Leksis fixture lxt-07 — otherForms × axes, non-rectangular paradigm" }]
```

`references` renders at the bottom of the entry page and is record-only, so it
costs the index nothing. Two exceptions, both obvious once stated: a fixture
whose *point* is that `references` is absent declares its purpose in `notes`
instead; a fixture whose point is that **both** are absent is identified by its
handle and the manifest alone — there should be exactly one such fixture.

### 2.3 The manifest, in this repo

**`scripts/fixtures/manifest.json`**, written by **`scripts/publish-fixtures.ts`**
and **regenerated from the live API after every run** — because `entryKey` is
minted by the AppView (`{lang}-{orthoSlug8}-{hash4+}`, hashed from the record
URI) and nothing can know it before publishing:

```bash
npx tsx scripts/publish-fixtures.ts --check      # validate the fixtures, write nothing
npx tsx scripts/publish-fixtures.ts --manifest   # rebuild the manifest alone (no credentials)
npx tsx scripts/publish-fixtures.ts --sweep-dry  # list what a test session left behind
npx tsx scripts/publish-fixtures.ts --sweep      # delete it, sparing the declared set
npx tsx scripts/publish-fixtures.ts --teardown   # remove EVERYTHING — RUN THIS WHEN THE TEST ENDS
npx tsx scripts/publish-fixtures.ts              # publish everything, sweep, then rebuild it
npx tsx scripts/fixtures/preview.ts              # what each entry page will render, offline
```

The fixture content lives beside it in `scripts/fixtures/*.ts` — one file per
lexicon, each record carrying its own `covers` and `expect`, so the manifest is
derived rather than maintained. Three properties are worth knowing before
touching it:

- **`--check` runs the AppView's own validators** (`grammarIssues`,
  `validateDefinitions`, `validateSource`, `isValidParadigmRecord`,
  `paradigmIssues`) over every record, and a full publish refuses to start
  unless they all pass. That gate is not politeness: a language version archives
  forever, and one whose grammar is incoherent is refused at ingest, leaving the
  language silently on its previous version.
- **`preview.ts` derives the `expect` lines** by running the shared generator
  and `layoutView` exactly as the reader does. Writing them from the rules by
  eye is how a fixture set starts lying.
- **Entries are swept before republishing** — scoped to records carrying an
  `lxt-` handle, never the whole collection, because the publishing account is
  also the one a human logs the dev build in as. Languages, sources and
  paradigms have derived record keys and simply overwrite.

The manifest's shape:

```jsonc
{
  "generatedAt": "2026-08-03T10:00:00Z",
  "botDID": "did:plc:…",
  "languages": [
    { "tag": "qtl", "role": "full",   "url": "https://leksis.eu/language/qtl",
      "recordURI": "at://…" }
  ],
  "entries": [
    { "handle": "lxt-07", "languageID": "qtl",
      "entryKey": "qtl-tavesk-1b76",
      "url": "https://leksis.eu/entry/qtl-tavesk-1b76",
      "recordURI": "at://…",
      "covers": ["otherForms", "axes", "non-rectangular-paradigm"],
      "expect": "three form rows; the Person axis is offered for the finite form and absent for the infinitive"
    }
  ]
}
```

`covers` keys the coverage matrix; `expect` is one sentence of what a correct
page looks like, so a browsing agent has an assertion and not just a URL.

Rebuild it with `GET /entries?q=lxt-` + `GET /entries/<key>`, never by hand.

---

## 3. The coverage matrix

Every row must be exercised by at least one fixture. Handles are the bot's to
allocate and renumber; the **rows** are not optional. A layer that ships adds
its rows here in the same loop.

### 3.1 Language record — `qtl` (clean)

| # | Covers | Fixture requirement |
|---|---|---|
| L-01 | layer 1 `pos`, UD | at least two bound UD parts of speech (`NOUN`, `VERB`) |
| L-02 | layer 1 `features` + `values`, UD | a bound UD feature name and ≥2 of its values |
| L-03 | minted **value** on a UD feature | `scheme: "qtl"`, with a `references` row |
| L-04 | minted **feature name** + its values | e.g. an inflection-class feature, values `1`/`2` (a value may start with a digit) |
| L-05 | minted **part of speech** | one, with `references` — the reluctant case must still render |
| L-06 | **layered** feature name | a `Feature[psor]`-shaped name, bound with values |
| L-07 | label with `short` **and** `long` | the ordinary case (short shown, long on hover) |
| L-08 | label with `long` **only** | no abbreviated form — must never be treated as a conflict |
| L-09 | **conflicting** labels | two bindings sharing a `short` with different `long` → `conflictsWith` populated on `GET /languages/qtl/labels` |
| L-10 | bound label, **zero usage** | declared and used by no entry — `count: 0` is legitimate, not a bug |
| L-11 | layer 2 `inherent` on a bare POS | e.g. Gender inherent to `{NOUN}` |
| L-12 | layer 2 `inherent` on a **combination** | inherent to `{NOUN, Gender=…}` — sets narrowing depth |
| L-13 | layer 2 named **combination** | a ≥2-item `bindings` row → renders as **one chip** (exact match) |
| L-14 | combination deliberately **left unnamed** | its atoms bound separately → renders as **two chips** (decomposition) |
| L-15 | layer 3 `axes` on a POS | with ≥2 values, in a **non-alphabetical** order, so order is visibly the language's |
| L-16 | layer 3 axis on a **combination** — non-rectangular | an axis declared for one refined category and never for its sibling |
| L-17 | axis value that is **multivalue** | one option spanning two values (`Fem,Masc`), for the "spans the axis" state |
| L-50 | layer 4 `layout`, one table | a layout on a bound POS: one axis down, one across, cells derived from the axes' own value order |
| L-51 | **nested** dimensions | two axes on one dimension, so an outer header spans several lines — the case a flat grid cannot express |
| L-52 | several blocks, told apart by `fixed` | two tables of one category differing only in a pinned value (a mood, a tense) |
| L-53 | a **named** pinned combination | the pinned pair also bound in `bindings` → the block caption is **one** chip, not two decomposed ones |
| L-54 | `exclude`, complete address | one cell removed inside a grid; its line survives on the other value |
| L-55 | `exclude`, **partial** address | one row naming fewer coordinates than a cell → a whole line or column dropped, not printed empty. No editor writes these, so only a fixture covers them |
| L-56 | a `list` block marked `summary` | the "rosa, rosae" case: printed beside the headword with the full table behind the expander |
| L-57 | a list item on a **non-axis** value | a form printed under a value that is bound but declared no axis — legitimate, and must not be reported |
| L-58 | layout on a **combination**, non-rectangular | a layout for one refined category and none for its sibling, so the sibling degrades to the flat list |
| L-59 | axes but **no layout** | a category with declared axes and no layout row → the flat list. The fallback the layer must never break, and the only row here that is verified by *absence* |

### 3.2 Language records — `qtm` (bare) and `qto` (defective)

| # | Covers | Fixture requirement |
|---|---|---|
| L-20 | **no grammar at all** | `qtm` record with the endonym and no `grammar` key |
| L-21 | verbatim rendering | `qtm` entries carrying well-formed tags nobody bound → unbound-styled chips |
| L-22 | the tag worklist | those tags appear on `GET /languages/qtm/labels` as rows **with a count and no `long`** |
| L-30 | `unbound-feature` | `qto`: a value whose feature name is not bound |
| L-31 | `unbound-atom` | `qto`: a layer-2/3 row built on an unbound atom |
| L-32 | `duplicate` | `qto`: two rows keying the same tag |
| L-33 | `ungrounded-combination` | `qto`: a named combination no inherence chain reaches |
| L-34 | `single-item-binding` | `qto`: a one-atom row in `bindings` |
| L-35 | `inherent-axis-conflict` | `qto`: the same (category, feature) declared both ways |
| L-36 | `empty-axis` | `qto`: an axis row with no values |
| L-37 | `layout-unknown-axis` | `qto`: a table dimension naming a feature the category declares no axis of |
| L-38 | `layout-repeated-axis` | `qto`: one feature on both dimensions of a table |
| L-39 | `layout-foreign-coordinate` | `qto`: an `exclude` coordinate outside the block's grid — the exclusion that silently removes nothing |
| L-40 | `empty-layout-block` | `qto`: a table with no dimensions, **and** a list with no items |
| L-41 | `layout-too-large` | `qto`: axes multiplying past `MAX_LAYOUT_CELLS` (4096) → the block draws nothing and says why |
| L-42 | `lexicographic-in-grammar` | `qto`: a feature flagged `lexicographic` declared inherent to a category. "Archaic" is not something a word *is*, and the grammatical layers must never reach for that vocabulary (ADR-0010) |
| L-43 | `duplicate-abbreviation` | `qto`: two `abbreviations` rows under one short form — two front-matter entries under one headword, keyed on the short form because that *is* the identity (ADR-0010) |

All of L-30…L-43 land in **one** `qto` record — they are rows in one `grammar`
object, and since ADR-0015 that record is **refused whole**, which is what these
rows now assert: `GET /languages/qto/currentRecord` still points at the coherent
version, and the ingest log names all fourteen kinds. The place each kind is
*read* is the binding editor's footer (U-16 below), because that is the surface a
contributor repairs them in.

**Verified 2026-08-16**, on a run since torn down. The rewrite was refused —
`currentRecord` still served the coherent version's cid — and opening the dialog
on `qto` listed all fourteen with Publish disabled. Note `qto`'s *history*
survives the teardown even though its record does not, so republishing the set
re-creates this state rather than starting it over. The publisher asserts the refusal itself and fails the run
if the defective version ever becomes current, so a regression in the ADR-0015
gate cannot pass silently.

Two of these are worth constructing deliberately rather than by accident. L-39
is the only issue kind that reports something *harmless but useless*, so it is
the one most likely to be dismissed as noise — the fixture exists to prove the
worklist says it. L-41 needs a grid past the 4096 cap; 8 · 8 · 8 · 9 = 4608 does
it with 33 value rows, bound under features nothing else uses so the oversize
block cannot distort another row's diagnosis.

### 3.3 Entry records

| # | Covers | Fixture requirement |
|---|---|---|
| E-01 | the floor | one orthography, one flat definition, empty `categories`, nothing else |
| E-02 | orthography variants | ≥3 spellings, all searchable |
| E-03 | non-Latin script | an orthography with no ASCII alphanumerics (exercises the empty-slug `entryKey` path) |
| E-04 | `transcription` | an IPA string under the headword |
| E-05 | exact-match category | a category the language named as a combination → one chip |
| E-06 | decomposed category | a bundle whose parts are bound but whose combination is not → several chips |
| E-07 | unbound category | a well-formed tag nobody bound → verbatim, unbound-styled |
| E-08 | mixed bundle | one bound part + one unbound part in the same tag (partial decomposition) |
| E-09 | minted tag in use | a category carrying a `scheme: "qtl"` item |
| E-10 | definitions depth 1 | flat leaves `[1] [2] [3]` |
| E-11 | definitions depth 2, implicit grouping | leaves at `[0,1,1] [0,1,2] [0,2,1]`, **no** group items |
| E-12 | definitions depth 3, explicit groups | group nodes carrying `notes`, leaves beneath (`A. I. 1.`) |
| E-13 | sense-level categories | a group node with its own `categories` — a tag at the sense altitude |
| E-14 | node `notes` | free prose before a node's content |
| E-15 | entry-level `notes` | the evicted editorial label as prose (`arch.`), below the definitions |
| E-16 | `references` | one with a `url`, one without |
| E-17 | `otherForms` on declared axes | one form per declared axis value; each spelling searchable |
| E-18 | `otherForms` **off** the axes | a form whose tag matches no declared axis → stays in the flat list, not dropped |
| E-19 | inflected-form search | asserting `GET /entries?q=<a form spelling>` returns the parent entry |
| E-20 | `todo` queue | exactly **two** entries carrying `todo`, with 1 and 2 items — a known constant to assert the dashboard counter against |
| E-21 | version history | one entry with **≥3 versions** chained by `subject` (last-write-wins, archival) |
| E-22 | homonyms | two entries sharing `orthography[0]` in `qtl` → the entry page's homonym list |
| E-23 | withdrawal | `deleted: true` + `deletionReason` → absent from search, still served at `/entry/<key>` |
| E-24 | withdrawal + redirect | `deleted` + `redirectTo` pointing at E-22's survivor |
| E-25 | volume | one entry with ~8 definitions and ~6 other forms — layout stress, and the ceiling on how big any single fixture gets |
| E-26 | the bare language | 2–3 `qtm` entries (covers L-21/L-22) |
| E-27 | forms filling a **laid-out** table | one entry whose `otherForms` cover most cells of L-50's table, with **at least one cell deliberately empty** — an empty cell and an excluded one must not look the same |
| E-28 | a form carrying **more** than its cell address | the inherent gender, or a part of speech, repeated on the form's tag → it must still land in its cell (the placement's superset tolerance) |
| E-29 | a form matching **no cell** | a form tagged on a declared axis whose value combination the layout does not address → the leftover list *below* the table. Distinct from E-18, where the language declares no axis at all |
| E-30 | `definitions[].examples` — the three citation states | **one** entry, one leaf carrying three examples: one citing **S-01** with a `locator`, one **unsourced** (no `source` at all), one citing **S-02**'s number, which no source record describes. The whole point is that the three render differently on one line each: the short citation form, the sentence alone, and the bare `OCLC <n>` styled unresolved with a "describe it" invitation |
| E-31 | examples on a **second** leaf, same work | one more leaf citing **S-01** again, with a different locator — the per-number resolution cache, and the DRY claim: one description, two citations, and correcting the source corrects both |

That is ~33 entries. Stay under 40.

### 3.4 Source records — the works examples cite

Sources are not entries and are not capped by the 40-entry ceiling, but the
same discipline applies: as few as cover the matrix.

**Quarantine, for a lexicon whose identity is a global registry.** A fixture
source must not claim a real work's OCLC number — a citation resolving to a
fixture description of somebody's actual book is worse than an unresolved one.
Two rules do it:

1. **Use a 16-digit number** (`MAX_OCLC_DIGITS`, the cap `normalizeOclc`
   enforces). Real OCLC numbers are around ten digits, so the top of the
   accepted range is empty by construction and will stay so far longer than
   this fixture set lives. Allocate them `9000000000000000n` (sixteen digits —
   the very top of the range `normalizeOclc` accepts).
2. **`languages` are fixture tags only** (`qtl` first), so the source is offered
   in no real language's entry editor and listed on no real dashboard.

The handle convention of §2.1 carries over to `citation.short`, since that is
what search matches and what every citing entry prints: put the handle in it
(`lxs-01`), so the fixture announces itself wherever it is rendered.

| # | Covers | Fixture requirement |
|---|---|---|
| S-01 | a described work, fully | all fields including `author`, `year`, `url`; `languages` = `["qtl", "qtm"]` (two, so the "offered to both" rule is visible); `citation.short` carries the handle |
| S-02 | **an undescribed number** | *no record at all* — a 16-digit number E-30 cites and nothing describes. Verified by **absence**, like L-59: `GET /sources/<n>/currentRecord` must 404 and `/source/<n>` must read as an invitation, not as a 404 |
| S-03 | the optional fields genuinely absent | a second described work with no `author`, no `year`, no `url` — "no author" must render as nothing, never as an empty row |
| S-04 | a source of the **bare** language | `languages: ["qtm"]` — a work can be cited from a language that has declared no grammar at all |

**Published and verified 2026-08-16** (then torn down, per §4.6 — the set is ephemeral). The three citation states rendered distinctly on one page:
the resolved short form with its locator, the unsourced sentence alone, and the
bare `OCLC …` styled unresolved beside its invitation to describe the work.

### 3.5 Paradigm records — layer 5's rules

The first fixture lexicon with **no searchable field**: the AppView indexes
pointers, and a paradigm has no orthography to carry a handle. So for this
lexicon **the manifest is the only index** (§6), the handles are `lxp-NN`, and
the on-record purpose text goes in `notes` — prose for other contributors, which
reaches no reader.

Five records cover the layer. They are deliberately fewer than the entries they
act on, because what varies is which *entry* a rule meets, not how many rules
there are.

| # | Covers | Fixture requirement |
|---|---|---|
| P-01 | generation from the lemma alone | a paradigm whose rules all start from `orthography[0]`, filling most of a laid-out grid. The arc's promise: a regular word carries nothing |
| P-02 | several rows competing for one cell | two rules targeting one address with different `match` conditions, the narrower written FIRST — rule order is semantics, and the first matching row wins |
| P-03 | a required principal part, **supplied** | a `requires` row the entry answers, so the paradigm runs |
| P-04 | the same row, **missing** | a second entry of the same category lacking it → the paradigm is skipped ENTIRELY (never half-generated) and the entry lands on the dashboard's missing-forms queue carrying the rule's own message, unaltered |
| P-05 | syncretism | a rule whose target carries a multivalue coordinate (`Person=1,2`), producing ONE form that spans two cells under a merged heading — never printed twice, and never confusable with a cell nobody filled |
| P-06 | empty vs excluded, under generation | one cell of a filled grid that no rule reaches (a faint dot) beside one the layout excludes (an em dash). The distinction the whole layer is drawn to preserve |
| P-07 | rules addressing a block's pinned constants | a category laid out as two tables told apart by a `fixed` tense, with rules carrying those constants in their target address |
| P-08 | most-specific-selector precedence | a broad paradigm and a narrow one both reaching one entry and colliding on exactly one cell — the narrow one wins it |
| P-09 | a base chain | a rule based on a `requires` form, and a second based on THAT rule's target: a stem built once and inflected from |
| P-10 | a paradigm no layout row covers | a selector for a category with declared axes and no layout → listed under the Paradigms tab's own "no table covers" heading, LISTED and never diagnosed (design note §7.3), while its forms still reach the flat list |
| P-11 | an asserted form overriding a generated cell | an entry whose own `otherForms` occupy a cell a rule would otherwise fill — the entry wins, and is styled asserted where the rest are styled derived |
| P-12 | a block filled ENTIRELY by generation | a layout block no asserted form touches, drawn anyway — the layer-4 rule "a block no form fills is not drawn", revised exactly as ADR-0009 predicted layer 5 would revise it |

---

## 4. Publishing rules

0. **Run it with the script**, `scripts/publish-fixtures.ts` (§2.3). The rules
   below are what it implements; they are here so the next person can tell
   whether it still implements them, not so anyone publishes by hand.
1. **Its own account — not yet true, and recorded as a deviation.** The rule is
   a dedicated PDS account, so a full reset never touches an ingestion bot's
   records and every fixture is attributable by DID. **As built (2026-08-16) the
   set is published from `testaccount.leksis.eu`**, the dev-session account: no
   fixture bot existed, and an agent may not create PDS accounts. Two
   consequences to live with until one exists. A human's own test entries share
   the repo, which is why the sweep in rule 5 is scoped to the `lxt-` handle
   rather than to the collection. And every fixture is attributable to the same
   DID a human authors from, so "who wrote this" cannot be read off the record —
   the handle and the manifest are the only identification. Creating
   `testbot.leksis.eu` and re-running the publisher is all it would take to fix.
2. **Language records first**, then sources, then entries, **then paradigms** —
   same reason as any
   import: tags published before their bindings render verbatim until the
   language catches up, which would make half the fixtures temporarily wrong,
   and an example published before its source cites a number that resolves to
   nothing. Note the second case is *not* an error — a citation to an
   undescribed number is valid and is S-02's whole subject — but a fixture that
   is meant to show a resolved citation should not spend its first minutes
   showing an unresolved one. Paradigms go **last** for a reason of their own:
   the expansion job's cheap path is "the entries this selector reaches now", so
   publishing rules after their entries exercises it instead of the sweep that
   catches up later.
3. **Publish in a deliberate order and record it.** The language dashboard's
   activity feed is ordered by index time; a run that publishes everything at
   once makes the feed a single burst. If a fixture needs to test the feed,
   publish it last and note that in `expect`.
4. **Every `qtl` version must actually index** — since ADR-0015 an incoherent
   grammar is refused, so a run that publishes one leaves `qtl` silently on its
   previous version. There is no `grammarIssues` field to check any more: confirm
   `GET /languages/qtl/currentRecord` returns the `cid` you just wrote (and watch
   the ingest log, which names the offending rows when it refuses). Treat a stale
   `cid` as a failed run.
5. **A re-run replaces, it never doubles.** An entry's record key is a TID and
   cannot be derived from its handle, so the publisher sweeps the previous run's
   entries before writing new ones — **scoped to records carrying an `lxt-`
   handle** (see rule 1), never the whole collection. Languages, sources and
   paradigms need no sweep: their keys are derived (the tag, the OCLC number, the
   selector hash), so republishing overwrites in place. Note this means a normal
   publish is safe to run twice; it is `--teardown` that ends a run, not a
   republish. And a fixture language's *history* accumulates whatever you do,
   which is exactly why `qto` carries the deliberate breakage and `qtl` never
   does.
7. **Never `subject`-reference a record outside the fixture set**, and never
   publish a fixture entry under a real `languageID`. A `subject` pointing at a
   real entry would make the fixture a proposed edit to real content.
8. **Regenerate `manifest.json` at the end of every run**, from the live API.
   A stale manifest is worse than none: it sends an agent to a 404 and the
   agent reports a regression that does not exist.

---

## 5. How a browsing agent uses the set

The protocol, in order — put this in the test session's prompt, not in the
agent's guesswork:

1. **Publish the set, then read the manifest it writes.** The set is ephemeral,
   so at rest there is nothing to open and `scripts/fixtures/manifest.json`
   carries `tornDownAt` with empty arrays. Run
   `npx tsx scripts/publish-fixtures.ts`; it validates, publishes, sweeps and
   writes the manifest with this run's `entryKey`s — which are minted fresh
   every time and cannot be predicted. (`--manifest` rebuilds it without
   publishing, for a run already in progress; it reads the *repo* rather than
   search, because a withdrawn entry is absent from search by design.)
2. **Open the specific page** the test needs — `/entry/<entryKey>` or
   `/language/<tag>` — never a blind search, and never "the first result".
3. **Assert against `expect`**, not against a screenshot from a previous
   session.
4. **Fixtures are live records that anybody may overwrite** (records prove
   authorship, not ownership). If a page contradicts the manifest, re-read the
   record from the PDS before concluding the app regressed — someone may have
   published a newer version of that entry, which is itself legal behaviour.
5. **Editing a fixture mid-run invalidates the rest of the run.** The set is
   torn down afterwards, so a stray edit no longer haunts *later* sessions — but
   it does desynchronise the manifest you are still asserting against. If a test
   needs to write, write a **new** record and let rule 6 remove it; if you must
   overwrite a fixture, regenerate the manifest (`--manifest`) before trusting
   another `expect` line.
6. **Tear the set down when the test ends. Always.** `--teardown` removes every
   record inside the quarantine — the declared set included — and blanks the
   manifest. This is a **habit, not a judgement call**: the set is ephemeral by
   design (see "What the fixture set is"), and anything left standing sits in the
   *production* index as a fake dictionary that real users can search.
   `--sweep` is the narrower form, sparing what the set declares, and a full
   publish runs it automatically so a run's own leftovers never survive it.
   - **Confirm it landed**, the same way a publish is confirmed: `GET
     /entries?q=lxt-` returns `{"entries":[]}` and
     `GET /languages/qtl/paradigms` returns none. Deletions travel the firehose
     like anything else and take a few seconds.
   - **The languages go too, since ADR-0018** (2026-08-18). This bullet used to
     read "the languages do not go" — `eu.leksis.language` versions archived
     rather than un-publishing, so `qtl`/`qtm`/`qto` stayed on `GET /languages`
     and in the picker permanently, whatever you deleted. They no longer do:
     deleting the last version of a language record removes it from the index,
     and a teardown now empties the quarantine completely. **Confirm it**, the
     same way as the rest — `GET /languages` must carry no `qt*` tag. Verified
     end to end on 2026-08-18; before that run, three fixture languages had been
     sitting in the production language list since the set was first published,
     each pointing at a record that no longer existed.
   - **The boundary is the quarantine, not the account.** Only `qtl`/`qtm`/`qto`
     records and 16-digit sources are touched, because this account is also the
     one a human logs the dev build in as — their `br` work is never in scope.
   - **It still cannot un-publish one *version* of a language.** Deleting the
     record takes the whole language with it; there is no operation that removes
     a single bad version and leaves the language standing. Think before
     publishing a language version; do not rely on this to undo one.
   - `--sweep-dry` lists what would go, and both print the number of records
     scanned, so "nothing left behind" cannot be confused with "scanned nothing".

---

## 6. Extending the set when a new lexicon ships

Layer 5 brings `eu.leksis.paradigm`; loop 5 brings translations; later loops
bring sentences, corpora, ballots and the UI's own interface translations.
Each of them gets fixtures under the same four rules — **quarantined tag,
on-record handle, on-record purpose, manifest row** — plus one thing to decide
deliberately:

**Does the new record type have a searchable field?** The handle trick works
because entry orthographies are indexed. A record type the AppView indexes
differently (or not at all) has no equivalent, and for it **the manifest is the
only index** — so it must be regenerated from whatever endpoint does serve it,
and the fixture's on-record purpose text matters more, not less.

**Layer 5 answered it first, and the answer was no** (2026-08-16).
`eu.leksis.paradigm` has nothing searchable: the AppView serves pointers, and a
paradigm has no orthography a handle could ride on. So its fixtures are addressed
by `GET /languages/:tag/paradigms` plus the manifest, their handles (`lxp-NN`)
live in `notes`, and the manifest carries the `paradigmKey` — which, being
derived from the selector, is at least *predictable* where an `entryKey` is not.
Expect that shape for every lexicon after this one: entries are the exception,
not the rule.

Add the new rows to the coverage matrix in §3 in the same loop that ships the
layer. A shipped feature with no fixture row is the failure mode this whole
skill exists to prevent.

---

## 7. Pending UI verification — the debt this set cannot pay

Every fixture above is a **record**, so it proves what a *reader* sees. It proves
nothing about the **authoring surfaces**, because those need a repository to
write to. A fixture cannot log in.

> **The reader half no longer needs a session at all (ADR-0017, 2026-08-17).**
> This section used to open "`App.tsx` sends a logged-out visitor to `/`, so the
> grammar editor and the entry editor are unreachable without one" — the routing
> half of that is now false. Every fixture page (`/entry/<key>`,
> `/language/<tag>`, `/source/<oclc>`) is **public**, so a browsing agent can
> assert every record-level row above without logging in, and a run against a
> stale or missing dev session can no longer be mistaken for a regression. What
> still needs the session is what always did: publishing. Note also that the
> scripted dev session logs in on *every* load, so to check a reader-facing
> fixture as a stranger sees it, open it with **`?anon=1`** (sticky; `?anon=0`
> undoes it).

So the list below is verification **debt**, not a test plan for this bot. It is
recorded here because this is where "what a later browsing session must do"
lives, and because an unverified authoring flow is exactly the thing that ships
broken and is noticed months later by a contributor.

**What is needed first:** a test account (its own PDS account, like the fixture
bot's, but for *driving the UI* rather than publishing from a script), and a
session an agent can restore.

**The test account now exists.** Handle `testaccount.leksis.eu`, password
`testaccount.leksis.eu`. It is a real PDS account created for exactly this
purpose — logging into the web app and driving the authoring surfaces (grammar
editor, entry editor) that a fixture record can never reach. The password is
not a secret worth guarding: access to the PDS is IP-gated at the Caddy layer,
so the account is unreachable from outside the VPS's allowed sources regardless
of the password. Use it to work through §7.1/§7.2 below; do not create a second
test account without reason to.

> **The session wall is SOLVED (2026-08-14).** An agent still must never type
> the password into a form, but it no longer needs to: the **dev-only scripted
> session** (`apps/web/src/auth/dev-session.ts` + the `VITE_DEV_*` vars in
> `apps/web/.env.local`) logs the dev build in as this account automatically on
> load. See the `verify` skill's *session wall* section and CLAUDE.md for the
> mechanics. §7.1/§7.2 below are therefore workable by an agent.

~~**One caveat that will otherwise waste a session.** Local OAuth builds its
client id from `window.location`, so a deep link on a cold load throws and the
login form never works.~~ **Obsolete** — `resolveClientId` passes the origin now,
and a cold load straight to `/entry/<key>` restores the session normally.
Verified again 2026-08-16.

**One caveat that will.** The page's side data — the language record, the
paradigm records, the labels — is fetched after the first paint, and each hop
goes out to a PDS. A screenshot or `get_page_text` taken immediately after
`navigate` will show the **degraded** state (verbatim tags, a flat list, no
generated forms) and read exactly like a regression. Wait, or read the page
twice, before concluding anything is broken.

### 7.1 Grammar editor — layer 4, the Layout tab (unverified, shipped)

| # | Flow | What must be true |
|---|---|---|
| U-01 | the tab appears | a fourth tab beside Primitives / Categories / Axes; entering it lands on the layout root |
| U-02 | the cascade as navigation | a language with **no axes** is told to declare axes first and offered nothing to lay out; only categories with a declared axis are offered |
| U-03 | declaring a layout | picking a category creates it **with one empty table** and opens that block; the footer refuses to publish, naming `empty-layout-block` |
| U-04 | assigning dimensions | axis chips move onto "down the table" / "across the table"; putting one on the second dimension **takes it off the first** |
| U-05 | nesting order | ↑/↓ reorder a dimension's axes, and the grid's header spans change to match |
| U-06 | pinning a constant | pinning an unplaced axis captions the block and adds the value to every cell's identifier |
| U-07 | the derived grid | each cell shows its identifier in UD form (`Case=Gen\|Number=Sing`), in the axes' **declared order**, and the grid scrolls inside its own box rather than widening the dialog |
| U-08 | excluding a cell | clicking a cell strikes it through; clicking again restores it — the round trip is the point, since a one-way exclusion would be a trap |
| U-09 | list blocks | one value per axis, plus the manual identifier field; items reorder and delete |
| U-10 | the summary flag | marking a block shows it as "beside the headword" in the block list and in the resolved preview |
| U-11 | the preview | the category level draws every block through the *shipped* resolver — an excluded cell is absent there while still clickable in the editor |
| U-12 | removing blocks | removing the last block **withdraws the layout** and returns to the root |
| U-13 | publishing | the rewritten record round-trips: reopen the dialog and the layout is as authored, and the version is **indexed** (it appears in the dashboard's activity feed — a refused one never would) |
| U-14 | the no-orphan guard | withdrawing an axis a layout uses is refused at publish, naming the layout row |
| U-15 | mobile | the whole tab at 375px, including the grid's horizontal scroll |
| U-16 | the defect list (ADR-0015) | open the dialog on **`qto`**, whose live record is the defective rewrite: Publish is disabled and the footer lists **every** kind L-30…L-43 with its own copy — not only the ones this edit would introduce. ✅ **2026-08-16**: all fourteen listed, Publish disabled. The *repair* half is still owed — bind the missing atoms and feature names, declare the grounding inherence, remove the one-atom `bindings` row with its own × control, and confirm the publish succeeds and indexes. Do it in a session that can afford to leave `qto` repaired, since publishing a coherent `qto` retires the fixture until the defective rewrite is republished |

### 7.2 Grammar editor — layer 4's sibling, the Inflection classes section

| # | Flow | What must be true |
|---|---|---|
| U-20 | the third root section | Inflection classes sits beside Parts of speech and Features, counting what is declared |
| U-21 | no suggestions | declaring a class makes **no request** to universaldependencies.org — check the network panel, not just the absence of a list |
| U-22 | minting is pre-ticked | a new class, and every value of a minted feature, opens with the mint box already checked and asking for a reference |
| U-23 | the breadcrumb | a class's trail reads Grammar › Inflection classes › … , and a UD feature's still reads … › Features › … |
| U-24 | nothing is hidden | the class also appears under Features, and unbinding it returns to the classes level |

### 7.3 Carried forward from earlier layers

ADR-0008's action item 4 — a full browser pass on the Axes tab, an entry
authored with a form tag, and both viewers — was deferred by decision and is
still owed. Do it in the same session as §7.1: the same login, the same fixture
language.

### 7.4 The semantic network's reader UI — loop 5 slice 4 (unverified, shipped)

Built, typechecked and linted. **Half of it has now been driven in a browser**
(2026-08-05, local, against the `verify-network.ts --seed` fixtures, with a
human logging in by hand — see the `verify` skill's *session wall* and *the CORS
wall* for the two blockers that made this cost a session). The rows below are
marked accordingly; **only the ✅ ones may be skipped in production**, and even
those are worth a glance since they were proven against synthetic fixtures.

**Why the entry-page rows could not be done locally, and what to do about it.**
The `--seed` fixtures are written straight into ArangoDB under a fabricated
author (`did:plc:verifybot`), so `resolvePds` 404s and the entry page never
leaves its error state — `EntryPage` requires the record to resolve before it
renders anything, relations included. Local fixtures can therefore verify the
**search** surface (which needs no record) but *never* the **entry** surface.
That is the strongest argument for publishing real relation fixtures: it is not
a nicety, it is the only way U-38…U-42 can ever be checked.

**This set cannot assert these rows yet.** The fixture languages carry **no
`eu.leksis.relation` records at all** — §6's "loop 5 brings translations" is
still owed — so a production pass needs relation fixtures published first. The
minimum that exercises the table below: a **via-chain** (three entries in three
languages, two sense-targeted equivalences), one **coarse** assertion
(`place: []` against a polysemous entry), one **antonym**, one **unknown kind**,
one **stale** (restructure one pinned entry afterwards) and one **unresolved
side**. Publish those before working the table, or the pass has nothing to look
at.

| # | Flow | What must be true |
|---|---|---|
| # | Flow | What must be true | |
|---|---|---|---|
| U-30 | the target selector | a second language selector sits beside the scope one; left empty, search behaves exactly as it does today | ✅ |
| U-31 | the URL is the mode | `/?q=&l=&t=` round-trips — reload and back/forward restore term, scope **and** target; clearing the target returns to `/?q=&l=` | ✅ |
| U-32 | **the gwerzenn test, in a browser** | the via-chain's source, with the far language as target, shows the far word — and never the intermediate's *other* senses' translations | ✅ |
| U-33 | provenance is per **sense** | where two senses of one target were reached differently, each shows its own badge; there is **never** one badge for the whole word | ✅ |
| U-34 | partial coverage | a source sense with no equivalent renders as an **empty group**, not omitted — this is the whole point of grouping by source sense | ✅ |
| U-35 | coarse disclosure | "all senses" appears both on a coarse **arrival** and on a hop the chain coarsely **departed** — the second is the one an earlier build got wrong | ✅ |
| U-36 | a target with no source | scope "any language" + a target shows the hint and fires **no request** (check the network panel, not just the absence of results) | ✅ |
| U-37 | same-language target | source == target is a **synonym search** with real results and a synonym heading, never an empty answer | ✅ |
| U-38 | entry page, per sense | a sense's relations render under **that** definition; whole-entry relations render on the header instead | |
| U-39 | an unknown kind | renders verbatim on the entry page, and is **absent** from translation results | |
| U-40 | an unresolved side | the record's own spelling shows as **plain text, never a link** — following one would 404 | |
| U-41 | the repair strip | parked relations list with their state (restructured / not indexed / too broad), below the definitions | |
| U-42 | the untouched path | an entry with no relations renders exactly as it did before this slice | |
| U-43 | mobile | the results and the entry page's relations at 375px. **Not dark mode** — `[data-theme="dark"]` is still commented out in `index.css`, so `light` is the only theme; add this back when a second one ships | search ✅ |

**When the account exists, work through these and delete what passes.** A row
left here after it has been checked is worse than no list, for the reason a stale
manifest is: it sends the next session to re-do work that is already done.

### 7.5 The rule editor — layer 5 slice 5 (verified 2026-08-16)

Driven against the fixtures on the session they were published. Kept rather than
deleted because these are the rows a *regression* would show up in, and because
each names the fixture that exercises it.

| # | Flow | What must be true | |
|---|---|---|---|
| U-60 | the fifth tab | Paradigms sits **after** Layout and is the last tab; entering it lands on a list of the language's layout rows, each counting the rule sets filed under it | ✅ |
| U-61 | filing, and the uncovered group | a paradigm files under the most specific layout category its selector contains; one containing none is listed under "Rules no table covers" — **listed, never diagnosed** (design note §7.3, still open) | ✅ `{ADJ}` / lxp-05 |
| U-62 | the category level | that category's paradigms, **most specific selector first**, beside an "add" affordance offering the category, its named combinations, and a manual tag field | ✅ |
| U-63 | the selector is locked | the editor shows it as text with no control, and says it cannot be changed afterwards: changing the category is publishing a different paradigm | ✅ |
| U-64 | rule order is semantics | rows carry ↑/↓/×, and the level says the first matching row fills the cell. A collapsed row summarises address + condition + affix exchange, so order is legible without expanding anything | ✅ |
| U-65 | the live preview | typing a sample headword renders the generated forms **through the reader's own component**, not a bespoke grid | ✅ `stella` → `stellae` |
| U-66 | defects block the publish | a blank `requires` message and an uncompilable `match` each disable Publish and are named in the footer **with the row's own address** | ✅ both |
| U-67 | stacking | Escape closes the paradigm editor and leaves the grammar dialog open behind it, on the level it was on | ✅ |
| U-68 | the empty-cell door | an unfilled cell opens a popover holding both affordances — the entry's own irregular form, and the language's rules — with the cell's address printed. An **excluded** cell offers no door at all | ✅ 20 doors, 0 on excluded cells |
| U-69 | the door lands on the right rules | "edit the language's rules" opens the **most specific paradigm reaching this entry** with the clicked cell seeded as a new rule target | ✅ opened lxp-01, seeded `Case=Gen\|Number=Sgv` |
| U-70 | mobile | the whole tab and the editor at 375px, including the preview grid's horizontal scroll | |
| U-71 | publishing from the editor | a real rewrite round-trips: reopen and the rules are as authored, the cid guard refuses a stale one, and the version indexes. The set was published by script, so the **editor's own** publish path is proven only up to the enabled button | |

---

## Canonical sources

- **`leksis-ingest`** skill — lexicon shapes, tagging model, PDS mechanics,
  ingest validation. This skill assumes all of it.
- `apps/api/src/entries.ts` — the search endpoint's prefix rule, its 50-result
  cap, and the empty-query behaviour the size budget depends on
- `apps/api/src/firehose/ingest-entry.ts` — `entryKey` minting (why the
  manifest is read back, not predicted)
- `packages/types/src/grammar.ts` — `GrammarIssue` kinds, for §3.2
- `packages/types/src/dashboard.ts`, `label.ts` — what the dashboard and labels
  endpoints serve, i.e. what a fixture is asserted against
- `docs/design/grammatical-tagging.md` + `docs/adr/0006-*`, `0007-*`, `0008-*`,
  `0009-*`, `0010-*` — the features the matrix must cover
- `docs/design/paradigm-rules.md` + `docs/adr/0016-*` — layer 5, which §3.5 covers
- `packages/types/src/paradigm.ts` — `generateForms`, `mergeParadigms`,
  `paradigmIssues`, `paradigmRkey`: what a paradigm fixture is asserted against
- `scripts/fixtures/` — the fixture content, the validator gate and the manifest
- `packages/types/src/grammar.ts` — `resolveLayout`, `placeForms`,
  `MAX_LAYOUT_CELLS`: what a layout fixture is actually asserted against, since
  the viewer and the designer both draw from it
- `apps/web/src/components/GrammarBindingDialog.tsx` — the authoring surfaces
  §7 owes a pass to
