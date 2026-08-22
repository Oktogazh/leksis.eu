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
| **`qtl`** | the **full** fixture language — everything that is supposed to work | layers 1 and 2 declared in the merged shape (primitives, inherence, and seven categories carrying their axes and defaults), seven paradigms with their own tables, `grammarIssues` **empty**, permanently |
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
references: [{ "text": "Leksis fixture lxt-07 — a lemma that carries nothing: the whole table is generated" }]
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
- **`preview.ts` derives the `expect` lines** by running the shared generator,
  `resolveParadigmTables` and `placeForms` exactly as the reader does. Writing them from the rules by
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
      "covers": ["E-17", "P-01", "P-06"],
      "expect": "the table is drawn as authored and filled by generation; one cell is manual-only and one is structural filler"
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
| L-09 | **conflicting** labels | two declarations sharing a `short` with different `long` → `conflictsWith` populated on `GET /languages/qtl/labels` |
| L-10 | bound label, **zero usage** | declared and used by no entry — `count: 0` is legitimate, not a bug |
| L-11 | layer 2 `inherent` on a bare POS | e.g. Gender inherent to `{NOUN}` |
| L-12 | layer 2 `inherent` on a **combination** | inherent to `{NOUN, Gender=…}` — sets narrowing depth |
| L-13 | a category identified by a feature nothing is cited **at** | a ≥2-atom `categories` row whose second atom names the form itself → renders as **one chip** (exact match). An infinitive is the natural case: there is no second flavour to tell it from |
| L-14 | a bundle **no category names** | atoms all bound, matching no declared category tag → renders as **several chips** (decomposition). The unenumerated combination staying authorable |
| L-16 | a category at **one** citation value | the ordinary case: a part of speech plus the value its headwords are cited at, named once — the value rides into the bundle of every entry created through it |
| L-17 | **two flavours, two categories** | the case the axis existed for, declared the way ADR-0020 declares it: `{NOUN, Gender=Masc, Number=Sing}` and `{NOUN, Gender=Masc, Number=Plur}` are two rows with two abbreviations (the *anv-kadarn stroll* beside the ordinary masculine noun), and the feature telling them apart is declared inherent one level up |
| L-18 | a category whose bundle carries a **minted value** | the row writes the minting scheme exactly as the entry editor does (`Number=Sgv`, scheme `qtl`), so the atom is bound, the chip finds its label and the selector finds the entry |
| L-19 | a **multivalue** value, bound | one value spanning two (`Fem,Masc`, `Person=1,2`), which is what a syncretic paradigm cell is addressed by and what gives the merged cell its heading |

### 3.2 Language records — `qtm` (bare) and `qto` (defective)

| # | Covers | Fixture requirement |
|---|---|---|
| L-20 | **no grammar at all** | `qtm` record with the endonym and no `grammar` key |
| L-21 | an abbreviation's three fields | `qtl`: a row whose ASCII `value` keys it, whose `short` is what the dictionary prints, and whose `note` says when to reach for it — the printed form is editable, the identity is not (ADR-0020) |
| L-22b | verbatim rendering | `qtm` entries carrying well-formed tags nobody bound → unbound-styled chips |
| L-22 | the tag worklist | those tags appear on `GET /languages/qtm/labels` as rows **with a count and no `long`** |
| L-30 | `unbound-feature` | `qto`: a value whose feature name is not bound |
| L-31 | `unbound-atom` | `qto`: a layer-2 row built on an unbound atom |
| L-32 | `duplicate` | `qto`: two `categories` rows keying the same category — which would make the label a reader sees depend on array order |
| L-33 | `ungrounded-combination` | `qto`: a named category no inherence chain reaches |
| L-40 | `lexicographic-in-grammar` | `qto`: a feature flagged `lexicographic` declared inherent to a category. "Archaic" is not something a word *is*, and the grammatical layers must never reach for that vocabulary (ADR-0010) |
| L-41 | `duplicate-abbreviation` | `qto`: two `abbreviations` rows under one `value` — two front-matter entries under one identity, which is what a lookup travels through (ADR-0010, re-keyed by ADR-0020) |

All of L-30…L-41 land in **one** `qto` record — they are rows in one `grammar`
object, and since ADR-0015 that record is **refused whole**, which is what these
rows assert: `GET /languages/qto/currentRecord` still points at the coherent
version, and the ingest log names all six kinds. The place each kind is
*read* is the binding editor's footer (U-16 below), because that is the surface a
contributor repairs them in.

**The kind list has shrunk twice.** ADR-0019 (2026-08-21) retired eight —
`single-item-binding`, `inherent-axis-conflict`, `empty-axis`,
`layout-unknown-axis`, `layout-repeated-axis`, `layout-foreign-coordinate`,
`empty-layout-block`, `layout-too-large` — with the `bindings`, `axes` and
`layout` arrays, and added six `category-*` ones of its own, so the count fell
from fourteen to twelve. ADR-0020 (2026-08-22) then removed those six with the
axis they were about, leaving **six in total**: everything that can go wrong
with a bundle, and nothing about what its forms do. The oversize-grid fixture
went with `MAX_LAYOUT_CELLS` at the first of the two: a table is written out cell
by cell rather than derived from axes, so nobody can produce a million cells by
declaring one more axis, and the successor cap (`MAX_TABLE_CELLS`) is a
`paradigmIssues` kind rather than a `grammarIssues` one.

**Verified 2026-08-16** on the fourteen-kind shape, rebuilt for the twelve-kind
one on 2026-08-21, and re-cut to six on 2026-08-22 (fixtures updated and
validated; the browser pass is owed). The rewrite was refused — `currentRecord` still
served the coherent version's cid — and opening the dialog on `qto` listed every
kind with Publish disabled. Note `qto`'s *history*
survives the teardown even though its record does not, so republishing the set
re-creates this state rather than starting it over. The publisher asserts the refusal itself and fails the run
if the defective version ever becomes current, so a regression in the ADR-0015
gate cannot pass silently.

One of these is worth constructing deliberately rather than by accident. L-32
`duplicate` is the kind that reports something a record can carry *and still
render* — two rows a reader cannot tell apart — so it is the one most likely to
be dismissed as noise. The fixture exists to prove the footer says it, because
the alternative is a language whose two labels mean the same thing and whose
contributors cannot find out why.

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
| E-17 | `otherForms` addressed by a bound feature | one form per value of a feature the language bound; each spelling searchable |
| E-18 | `otherForms` **off** the axis | a form whose tag matches no cell of any paradigm reaching it → stays in the flat list, not dropped |
| E-19 | inflected-form search | asserting `GET /entries?q=<a form spelling>` returns the parent entry |
| E-20 | `todo` queue | exactly **two** entries carrying `todo`, with 1 and 2 items — a known constant to assert the dashboard counter against |
| E-21 | version history | one entry with **≥3 versions** chained by `subject` (last-write-wins, archival) |
| E-22 | homonyms | two entries sharing `orthography[0]` in `qtl` → the entry page's homonym list |
| E-23 | withdrawal | `deleted: true` + `deletionReason` → absent from search, still served at `/entry/<key>` |
| E-24 | withdrawal + redirect | `deleted` + `redirectTo` pointing at E-22's survivor |
| E-25 | volume | one entry with ~8 definitions and ~6 other forms — table stress, and the ceiling on how big any single fixture gets. Its cells are almost all **asserted**, against E-27's almost all generated: the two states of one table, on one language |
| E-26 | the bare language | 2–3 `qtm` entries (covers L-21/L-22) |
| E-27 | forms filling an **authored** table | one entry whose `otherForms` cover most cells of a paradigm's table, with **at least one cell deliberately blank** — a manual-only cell, a rule that declined and a structural filler must not look the same |
| E-28 | a form carrying **more** than its cell address | the inherent gender, or a part of speech, repeated on the form's tag → it must still land in its cell (the placement's superset tolerance) |
| E-29 | a form matching **no cell** | a form whose address no cell of the reaching paradigm carries → the leftover list *below* the tables. Distinct from E-18, where no paradigm reaches the entry at all |
| E-30 | `definitions[].examples` — the three citation states | **one** entry, one leaf carrying three examples: one citing **S-01** with a `locator`, one **unsourced** (no `source` at all), one citing **S-02**'s number, which no source record describes. The whole point is that the three render differently on one line each: the short citation form, the sentence alone, and the bare `OCLC <n>` styled unresolved with a "describe it" invitation |
| E-31 | examples on a **second** leaf, same work | one more leaf citing **S-01** again, with a different locator — the per-number resolution cache, and the DRY claim: one description, two citations, and correcting the source corrects both |
| E-32 | the bundle carries every **identifying** feature | an entry created through a category is tagged with that category's whole bundle on the record itself, so it self-describes without the language record in hand. Verified on **two** entries whose categories differ only in the value they are cited at, which is the only way the row means anything |
| E-33 | the sibling **exact match** does not reach | the other flavour of E-32's category, and a paradigm selecting only one of the two → the sibling draws a different table (or none). Containment would have reached both, which is what the merge replaced |
| E-34 | a value no category names | a bundle carrying a value of an identifying feature that no category row names → the key **keeps** it (ADR-0020: the contributor said the word is cited so), and no paradigm selects that bundle, so the entry falls back to the flat list |

That is ~34 entries. Stay under 40.

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

Seven records cover the layer. They are deliberately fewer than the entries they
act on, because what varies is which *entry* a paradigm meets, not how many
paradigms there are.

**The shape changed at ADR-0019 and these rows changed with it.** A paradigm now
carries its own tables, authored cell by cell, and names the headword bundles it
applies to by **exact match** rather than by containment — so the retired rows
are P-07 (constants pinned by a *layout* block, now simply part of a cell's
address), P-08's old reading (most-specific-selector precedence, which exact
match makes unreachable) and P-12's old reading (a layout block drawn although
no asserted form fills it, which is what every generated table now is).

| # | Covers | Fixture requirement |
|---|---|---|
| P-01 | generation from the lemma alone | a paradigm whose rules all start from `orthography[0]`, filling most of a table. The arc's promise: a regular word carries nothing |
| P-02 | several rules competing for one cell | two rules **in one cell** with different `match` conditions, the narrower written FIRST — order is semantics, and the first matching rule wins |
| P-03 | a required principal part, **supplied** | a `requires` row the entry answers, so the paradigm runs |
| P-04 | the same row, **missing** | a second entry of the same category lacking it → the paradigm is skipped ENTIRELY (never half-generated) and the entry lands on the dashboard's missing-forms queue carrying the rule's own message, unaltered |
| P-05 | syncretism | a **cell** whose address carries a multivalue coordinate (`Person=1,2`), merged across the positions it covers, holding ONE form — never printed twice, and never confusable with a cell nobody filled. Verified generated *and* asserted, since a spanning cell an entry fills is the other half of the same claim |
| P-06 | the three blank states, side by side | in one table: a cell with **no rules** (manual-only — an invitation), a cell whose rule **declined** for this lemma (the language's own "no form here"), and a `kind: "empty"` **filler** (a cell that cannot exist). The distinction the whole layer is drawn to preserve, now three-way rather than two |
| P-07 | a base chain | a rule based on a `requires` form, and a second based on THAT rule's target: a stem built once and inflected from |
| P-08 | **exact match**, seen from the reader | two entries of one category at different defaults, and a paradigm selecting only one bundle → it reaches that entry and **not** its sibling. What replaced most-specific precedence, and the reason two paradigms can never collide on a cell |
| P-09 | **several selectors on one record** | one set of tables serving two categories (a declension shared by two genders), reachable from both entries under **one** `paradigmKey` — the identity being the *sorted* selector set, so the order they were written in says nothing |
| P-10 | a selector nobody declared | a paradigm for a category the grammar declares nothing about and no entry carries → indexed, listed, and **inert**: a disagreement between two records, never a defect inside one. A paradigm arriving before its grammar is the same state |
| P-11 | an asserted form overriding a generated cell | an entry whose own `otherForms` occupy a cell a rule would otherwise fill — the entry wins, and is **marked** as asserted over a generated one, which is the third form state and the one that tells a rule wrong for a word from a rule wrong for the language |
| P-12 | **authored geometry** | in one record: a `title` cell spanning a whole table, a blank corner drawn as `empty` rather than as an untitled heading, and a merged form cell — the table shape the paradigm record took over from `grammar.layout` |

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
   import: tags published before the declarations naming them render verbatim until the
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

0. **Decide which AppView the run reads back from, and say so.** The publisher
   writes to the **real PDS** either way — that is what makes a fixture travel
   the whole path — but it reads the index back through `LEKSIS_API`, which
   defaults to production. **A run verifying a release that changes a lexicon
   must point at a local AppView** (`LEKSIS_API=http://127.0.0.1:8080
   LEKSIS_SITE=http://127.0.0.1:5173`, with the `api` and `web-local-api`
   preview servers up), because production is still on the *previous* release
   and cannot index the new shapes — the run would fail on its first
   `waitForLanguage` and prove nothing. Verified on ADR-0019's slice 6: the live
   AppView indexed the languages and entries and **refused all seven
   paradigms**, whose v2 shape its lexicon did not know. That refusal is worth
   *watching for* — it is the cleanest evidence a change really is breaking —
   but it is not the pass. Tear down as usual afterwards, and confirm the
   teardown in **both** indexes.

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

### 7.1 Grammar editor — the Categories tab (ADR-0019, corrected by ADR-0020)

**This section replaced the Layout tab's rows.** The merge removed the Axes and
Layout tabs entirely — an axis is declared on its category, a table's shape lives
in the paradigm record — so U-01…U-15 named controls that no longer exist and
have been retired rather than carried. What survives is U-16, which is about the
defect footer and not about layout, and the rows below, which are the merged
declaration's own.

| # | Flow | What must be true |
|---|---|---|
| U-01 | three tabs, not five | Primitives / Categories / Paradigms, and nothing between the last two. A path is derived from the level, so a stale deep link into an axis or a layout level must land somewhere sane rather than blank |
| U-02 | the walk goes as deep as the declarations do | from a bound part of speech, each inherent feature opens an enumeration of its bound values, and each of those opens **another category's editor** — no naming step in between, which is what the merge removed. A language that has declared nothing still offers its parts of speech |
| U-03 | declaring what defines a headword | the feature chips offer bound names that are **not** lexicographic and not already declared here; adding one opens an enumeration of its bound values, each leading to a category of its own |
| U-04 | Bind replaces Publish | on any form level the footer offers **Bind** and no Publish, disabled until the row is complete; binding returns to the level and the footer offers Publish again. No form carries a second Bind of its own (ADR-0020) |
| U-05 | the whole line of descent | the sidebar of a deep category alternates feature and value all the way down (`ak. / Number= / Sing / Gender= / Masc / Subgender= / Unstable`), every rung navigates, and clicking a parent keeps the rungs above it (ADR-0020) |
| U-06 | a **minted** value in a category | a category built on `Number=Sgv` (scheme `qtl`) round-trips: the chip finds its label, and the row is reachable from the enumeration under its feature |
| U-07 | editing keeps one row per category | renaming a category rewrites the existing row in place rather than appending a second one — the defect `duplicate` exists precisely because appending is the easy bug |
| U-08 | counting the subtree | a branch prints how many categories are declared **below** it at any depth, not how many of its direct children are named — and that count is what blocks withdrawing the declaration they stand on (ADR-0020) |
| U-09 | the count and sample chips | every category row carries its usage count from `GET /languages/:tag/labels`, joined by canonical row key; a non-zero row also carries a random entry's orthography linking to `/entry/<key>`, and a reroll beside it that changes the target. A zero row shows the count and no link, and the hint says counts describe the **saved** grammar, not the draft |
| U-10 | the no-orphan guard | unbinding a value a category is built on is refused at publish, naming the category row |
| U-11 | publishing | the rewritten record round-trips: reopen the dialog and every category is as authored, and the version is **indexed** (it appears in the dashboard's activity feed — a refused one never would) |
| U-12 | mobile | the whole tab at 375px, the dialog filling the screen's height |
| U-13 | alphabetical lists | every list in the dialog — values, features, abbreviations, categories — reads alphabetically, whatever order the record was written in |
| U-14 | an older record loads | open the dialog on a language declared before ADR-0019 or ADR-0020: the draft is the forward map, the footer says publishing rewrites the record, and Publish is enabled with nothing touched |
| U-16 | the defect list (ADR-0015) | open the dialog on **`qto`**, whose live record is the defective rewrite: Publish is disabled and the footer lists **every** kind L-30…L-41 with its own copy — not only the ones this edit would introduce. The *repair* half is still owed — bind the missing atoms and feature names, declare the grounding inherence, remove the duplicate row — and confirm the publish then succeeds and indexes. Do it in a session that can afford to leave `qto` repaired, since publishing a coherent `qto` retires the fixture until the defective rewrite is republished |


### 7.2 Grammar editor — layer 4's sibling, the Inflection classes section

| # | Flow | What must be true |
|---|---|---|
| U-20 | the third root section | Inflection classes sits beside Parts of speech and Features, counting what is declared |
| U-21 | no suggestions | declaring a class makes **no request** to universaldependencies.org — check the network panel, not just the absence of a list |
| U-22 | minting is pre-ticked | a new class, and every value of a minted feature, opens with the mint box already checked and asking for a reference |
| U-23 | the breadcrumb | a class's trail reads Grammar › Inflection classes › … , and a UD feature's still reads … › Features › … |
| U-24 | nothing is hidden | the class also appears under Features, and unbinding it returns to the classes level |

### 7.3 Carried forward from earlier layers

ADR-0008's action item 4 — a full browser pass on the Axes tab — is **moot**:
ADR-0019 removed that tab, and what it declared is now §7.1's business. What
remains of it, and is still owed, is the other half: an entry authored through
the narrowing with a form tag on it, seen in both viewers. Do it in the same
session as §7.1 — the same login, the same fixture language.

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

### 7.5 The paradigm table editor — ADR-0019 (verified 2026-08-21)

**This section replaced the rule editor's rows.** The v1 editor listed rules
under a *layout* category and locked a single selector; v2 walks the language's
own categories to pick selectors and edits a grid. U-60…U-69 named that older
surface and are retired; the rows below were driven end to end against a
quarantined fixture on the session the editor was built, and are kept because
they are where a *regression* would show up.

| # | Flow | What must be true | |
|---|---|---|---|
| U-60 | the third tab | Paradigms is the last tab and lands on a list of the language's published paradigms, each naming every category it serves, beside a *Declare a paradigm* door | ✅ |
| U-61 | the selector walk | selectors are picked with the **entry editor's own** narrowing (`categoryRoots` / `categoryRefinements`), so the bundles offered are exactly the ones an entry can be created with — a bare part of speech included — and the axis step reads *Cited as (‹axis label›)* | ✅ |
| U-62 | the identity guard | declaring a "new" paradigm whose categories already have one is refused, with a door onto the published record. The concurrency guard is skipped while creating, so this is the one rewrite that would otherwise have nothing behind it | ✅ |
| U-63 | the grid is edited as the rectangle it draws | rows and columns insert and remove **at a position**; the record's own rows (where a spanned cell is written once and the positions it covers are omitted) are converted in and out, and the round trip is exact | ✅ |
| U-64 | two invariants make `ragged-table` unreachable | the grid always tiles its rectangle and **every row keeps a cell of its own**, so `mergeDown`, `removeColumn` and `insertRow` decline rather than produce a row that serialises to `[]` | ✅ |
| U-65 | the cell inspector | kind toggle (heading / form / filler), heading text, the address picker over **every bound grammatical feature** (not the category's axis — a conjugation cell is addressed by person, number, tense and mood at once), and the ordered rule rows: base, condition, both affix pairs, reorder, remove | ✅ |
| U-66 | merging | one column or one row at a time, absorbing **only filler**, plus unmerge — so no merge can quietly discard a heading somebody wrote or a cell's rules. *Merge right* is offered only where the neighbour is filler | ✅ |
| U-67 | the editor addresses the **published** grammar | never the grammar dialog's unsaved draft: a paradigm is a different record with its own publish button, so a cell address built from a value that exists only in a draft would be publishable and point at nothing | ✅ |
| U-68 | the preview's specimen is a real word | *Draw one* fills the lemma from slice 1's random-entry endpoint, keyed on the first selector — rules written against an invented lemma test the author's own spelling instead of the language's | ✅ |
| U-69 | defects block the publish | every `paradigmIssues` kind is listed in the footer with the offending cell's own address, and Publish is disabled | ✅ blank `requires` message, uncompilable `match` |
| U-70 | mobile | the whole tab and the editor at 375px, including the grid's horizontal scroll | |
| U-71 | publishing from the editor | a real rewrite round-trips: reopen and the tables are as authored, the cid guard refuses a stale one, and the version indexes. The list waits for the index only for a **new** paradigm — a rewrite keeps its identity, so its row is already on screen | ✅ |
| U-72 | the reader's third form state | a form the entry asserts **over** a generated one is marked and named in the legend. Only the containment case reaches it, and it is the case that matters: without it, a rule wrong for one word and a rule wrong for the language look identical | ✅ |

### 7.6 Counts, samples and the record link — ADR-0019 slice 1 (shipped)

Three small surfaces the merge arc carried alongside it. They are listed
separately because they are independent of the grammar model and would survive
another revision of it.

| # | Flow | What must be true |
|---|---|---|
| U-80 | the count chip | every POS, feature-value, category and annotation row in the grammar dialog carries `×N` from `GET /languages/:tag/labels`, joined by canonical row key. **A row at zero carries nothing** — deliberate, and the opposite of the dashboard's shelf, which prints `×0` because there every row is a declaration and here most rows of a young dictionary would be |
| U-81 | the sample link | pressing the row's ↻ draws a random entry using that tag and links it by its orthography, in a **new tab** (the dialog holds an unpublished draft, so following a link in place would throw the contributor's work away). It is fetched **on demand**, never eagerly: a values level can run to hundreds of rows |
| U-82 | the reroll | the control beside it re-calls `GET /languages/:tag/labels/random?row=<canonical row key>` — the key is a **query parameter**, not a path segment, because it carries `=`, `\|` and, on a layered feature name, brackets — and changes the target on a row with more than one member. A row with exactly one member legitimately re-draws the same entry, and a row with none 404s |
| U-83 | counts describe the **saved** grammar | the hint says so, and editing a draft does not move a count |
| U-84 | the language-record link | the dashboard footer links to `https://atproto.at/uri/<the raw at:// URI>` of the **currently accepted** version, under the `language.viewRecord` key, in every locale |


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
- `docs/design/grammatical-tagging.md` + `docs/adr/0006-*`, `0007-*`, `0010-*`,
  **`0019-*`** (the category–axis merge, which superseded `0008-*`'s axes and
  `0009-*`'s layout) and **`0020-*`** (which removed the merged category's own
  axis) — the features the matrix must cover
- `docs/design/paradigm-rules.md` + `docs/adr/0016-*` — layer 5, reshaped by
  `docs/design/category-axis-merge.md` + ADR-0019, which §3.5 covers
- `packages/types/src/paradigm.ts` — `generateForms`, `mergeParadigms`,
  `paradigmIssues`, `paradigmRkey`, `paradigmGrid`, `resolveParadigmTables`:
  what a paradigm fixture is asserted against
- `scripts/fixtures/` — the fixture content, the validator gate and the manifest
- `packages/types/src/grammar.ts` — `headwordKeys`, `placeForms`, `coordTag`,
  `migrateGrammar`: which bundle a paradigm's selector is compared with, where a
  form lands, and how a record written under an older shape is read
- `apps/web/src/components/GrammarBindingDialog.tsx` — the authoring surfaces
  §7 owes a pass to
