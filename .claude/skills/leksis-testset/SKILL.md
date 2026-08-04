---
name: leksis-testset
description: >
  Instructions for the Leksis **fixture bot** — the one bot that does not populate the dictionary. It publishes a small, deliberately feature-complete set of live eu.leksis.* records (languages, entries, and later paradigms and other lexicons) under quarantined private-use language tags, to be used as fixed targets for agentic browsing tests of leksis.eu in later programming sessions. Use this skill when building, extending, resetting or consuming that fixture set: it defines the quarantine rule, the size budget, the on-record addressing convention that lets an agent open the right page directly, the manifest, and the coverage matrix every shipped design feature must appear in. It is NOT for importing real dictionary content — that is `leksis-ingest`, which this skill assumes you have read for the lexicon shapes and the PDS mechanics. This skill can also be used by programming agents to verify their changes against the fixture set, and to assert that a new lexicon layer or content loop behave like intended.
---

# Leksis fixture bot — live test records for agentic browsing

## What this bot is

Every other bot exists to grow the dictionary. This one exists to be **looked
at**. It publishes a fixed, small set of `eu.leksis.*` records whose only
purpose is to give a browsing agent — in a future session, on the live site —
a page it can open and assert against for every feature the design has
shipped.

The records are **live and public**. They go through the same PDS, the same
firehose and the same AppView as real content, and they appear in the real
language list. That is deliberate: a fixture that does not travel the whole
path proves nothing. It is also the reason for every rule below.

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
| **`qtl`** | the **full** fixture language — everything that is supposed to work | layers 1–3 declared, `grammarIssues` **empty**, permanently |
| **`qtm`** | the **bare** language — the degrade path the design promises | **no `grammar` at all**; its entries carry tags nobody bound |
| **`qto`** | the **defective** language — the repair worklist's test target | one row per `GrammarIssue` kind, on purpose |

Why three and not one: `qtm` proves the fallbacks (verbatim tag rendering, the
flat `otherForms` list, the flat picker) which are load-bearing promises of the
design and which a fully-declared language can never exercise. `qto` exists so
that a *deliberately broken* grammar never has to live on `qtl` —
**a language version cannot be un-published**: `eu.leksis.language` versions
archive forever, so a broken grammar published on `qtl` stays in its history
and its dashboard permanently. Think before you publish a language version.

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

### 2.3 The manifest, in the bot's repo

`manifest.json`, **regenerated from the live API after every run** — because
`entryKey` is minted by the AppView (`{lang}-{orthoSlug8}-{hash4+}`, hashed
from the record URI) and the bot cannot know it before publishing:

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

All of L-30…L-41 land in **one** `qto` record — they are rows in one `grammar`
object, and the dashboard's repair worklist should show them all at once.

Two of these are worth constructing deliberately rather than by accident. L-39
is the only issue kind that reports something *harmless but useless*, so it is
the one most likely to be dismissed as noise — the fixture exists to prove the
worklist says it. L-41 needs four axes of sixteen values to trip the cap, which
is more vocabulary than the rest of `qto` holds; bind it under a feature nothing
else uses, so it cannot distort another row.

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

That is ~31 entries. Stay under 40.

---

## 4. Publishing rules

1. **Its own account.** The fixture bot has a dedicated PDS account (e.g.
   `testbot.leksis.eu`), so a full reset never touches an ingestion bot's
   records and so every fixture is attributable by DID.
2. **Language records first**, then entries — same reason as any import: tags
   published before their bindings render verbatim until the language catches
   up, which would make half the fixtures temporarily wrong.
3. **Publish in a deliberate order and record it.** The language dashboard's
   activity feed is ordered by index time; a run that publishes everything at
   once makes the feed a single burst. If a fixture needs to test the feed,
   publish it last and note that in `expect`.
4. **`grammarIssues` on `qtl` must be empty** after every run — check
   `GET /languages/qtl/dashboard`. Treat non-empty as a failed run.
5. **Reset = delete then republish.** Entry deletions are mirrored by the
   AppView, so deleting the bot's `eu.leksis.entry` records genuinely cleans
   the index. Language versions do **not** un-publish; a fixture language's
   history accumulates, which is exactly why `qto` carries the deliberate
   breakage and `qtl` never does.
6. **Never `subject`-reference a record outside the fixture set**, and never
   publish a fixture entry under a real `languageID`. A `subject` pointing at a
   real entry would make the fixture a proposed edit to real content.
7. **Regenerate `manifest.json` at the end of every run**, from the live API.
   A stale manifest is worse than none: it sends an agent to a 404 and the
   agent reports a regression that does not exist.

---

## 5. How a browsing agent uses the set

The protocol, in order — put this in the test session's prompt, not in the
agent's guesswork:

1. **Read `manifest.json` first.** If it is missing or stale, rebuild it live:
   `GET https://leksis.eu/api/entries?q=lxt-` returns every fixture with its
   `entryKey`.
2. **Open the specific page** the test needs — `/entry/<entryKey>` or
   `/language/<tag>` — never a blind search, and never "the first result".
3. **Assert against `expect`**, not against a screenshot from a previous
   session.
4. **Fixtures are live records that anybody may overwrite** (records prove
   authorship, not ownership). If a page contradicts the manifest, re-read the
   record from the PDS before concluding the app regressed — someone may have
   published a newer version of that entry, which is itself legal behaviour.
5. **Do not edit fixtures from a test session.** A browsing test that
   publishes a new version changes the fixture for every later session. If a
   test *needs* to write, it writes a new record and the bot cleans it up.

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

Add the new rows to the coverage matrix in §3 in the same loop that ships the
layer. A shipped feature with no fixture row is the failure mode this whole
skill exists to prevent.

---

## 7. Pending UI verification — the debt this set cannot pay

Every fixture above is a **record**, so it proves what a *reader* sees. It proves
nothing about the **authoring surfaces**, because those sit behind a session:
`App.tsx` sends a logged-out visitor to `/`, so the grammar editor and the entry
editor are unreachable without one. A fixture cannot log in.

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

**One caveat that will otherwise waste a session.** Local OAuth builds its client
id from `window.location`, so a **deep link on a cold load throws**
(`Invalid loopback client ID: Value must not contain a path component`) and the
login form never works. Load `http://127.0.0.1:5173/` first, log in, *then*
navigate in-app — or fix `resolveClientId` in `apps/web/src/auth/client.ts` to
pass the origin instead of the location, which is ADR-0007's carried-forward
action item.

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
| U-13 | publishing | the rewritten record round-trips: reopen the dialog and the layout is as authored, `grammarIssues` empty on the dashboard |
| U-14 | the no-orphan guard | withdrawing an axis a layout uses is refused at publish, naming the layout row |
| U-15 | mobile | the whole tab at 375px, including the grid's horizontal scroll |

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

**When the account exists, work through these and delete what passes.** A row
left here after it has been checked is worse than no list, for the reason a stale
manifest is: it sends the next session to re-do work that is already done.

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
- `docs/design/grammatical-tagging.md` + `docs/adr/0006-*`, `0007-*`, `0008-*` —
  the features the matrix must cover
- `packages/types/src/grammar.ts` — `resolveLayout`, `placeForms`,
  `MAX_LAYOUT_CELLS`: what a layout fixture is actually asserted against, since
  the viewer and the designer both draw from it
- `apps/web/src/components/GrammarBindingDialog.tsx` — the authoring surfaces
  §7 owes a pass to
