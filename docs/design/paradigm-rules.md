# Design note: layer 5 — the paradigm lexicon (inflection rules)

**Status:** **Built** — designed 2026-08-15, all six slices shipped 2026-08-16 (**ADR-0016**). This
file was the plan the build sessions executed and is kept for its reasoning and its "as built"
notes; where it and shipped code disagree, **the code and ADR-0016 win**. The §7 questions are still
open and are still not to be answered by guessing.
**For:** the morphology arc's layer 5 (`leksis-evolution` skill). Supersedes the "Layer 5 — Rules"
section of `docs/design/grammatical-tagging.md`, which now points here.
**Related:** ADR-0009 (layout — the cell space rules fill), ADR-0008 (axes), ADR-0007 (inherence),
ADR-0015 (the ingest gate this layer extends), `docs/design/weighted-voting.md` §2.1 (paradigms are
the sixth upgradable collection), `lexicons/eu.leksis.defs.json` (the shared `Tag`).

> **How to read this.** §1 is the model — what a paradigm record is and how it reaches readers. §2
> is the two storage changes on the `entries` doc. §3 is the background expansion job. §4 the ingest
> gate. §5 the interfaces. §6 the build slices, one Opus session each. §7 what is deliberately open.
> Inherited constraints are cited by name from the tagging note and its ADRs, not restated.

---

## 1. The model

### 1.1 What a paradigm record is

A **paradigm** is one language's generation recipe for one category of words: Hunspell-shaped rules
that fill the cells layer 4 laid out, from an entry's lemma (and, when the language needs it, from
designated base forms the entry must supply). It lives in its own lexicon, `eu.leksis.paradigm` —
settled at layer 2: rules are large, per-class, and written at a different cadence than the
`grammar` object.

```typescript
eu.leksis.paradigm = {
  languageID: string          // lowercase BCP 47 tag
  selector: Tag               // the category this paradigm applies to — a bundle over the
                              //   language's INHERENT vocabulary, e.g. {NOUN, Declension=1}
                              //   or {VERB, Conjugation=2}. Immutable per identity (§1.2).
  label?: { long, short? }    // homolingual name of the paradigm ("1st declension")
  requires?: [{               // base forms the rules need beyond the lemma —
    coords: [Coord]           //   the cell address of the required form (bare Coord,
                              //   re-qualified before use, exactly as layout does)
    message: string           //   HOMOLINGUAL error text shown when an entry lacks this
                              //   form ("mankout a ra ar stumm tremenet…"). Written here,
                              //   in the rule, so the dashboard message needs no translation
                              //   layer — the rule's author is a speaker.
  }]
  rules: [{                   // one row per generated cell (or cell set)
    coords: [Coord]           // the target cell address; a multivalue Coord value
                              //   ("Fem,Masc") spans cells — the settled spelling of
                              //   "one form covers the axis", never a wildcard
    base?: [Coord]            // which form the transformation starts from: absent = the
                              //   lemma (orthography[0]); else a cell address, which must
                              //   be a `requires` row or another rule's target
    match?: string            // regex the END of the base must satisfy for this row to
                              //   apply (Hunspell SFX condition); absent = always
    strip?: string            // literal suffix removed from the base
    add?: string              // literal suffix appended
    prefix?: { strip?, add? } // the same pair at the front (mutations, augments)
  }]
  notes?: string[]
  references?: [{ text, url? }]
  subject?: string            // at:// URI of the version this rewrites (audit trail only —
                              //   identity is the rkey, §1.2)
  createdAt: string
}
```

Several rule rows may target the same cell with different `match` conditions (Hunspell's normal
shape — `-y → -ies` vs `-s`); the **first matching row in author order wins**. A cell no row
matches for a given lemma is simply not generated — an empty cell, not an error. The only error
state is a missing `requires` form (§3.3).

**The generator is one pure function in `packages/types`** (invariant 6): record + entry facts in,
`{form, coords}[]` out. The api's expansion job and the web viewer call the same function; the
layer-6 exporters will too. It must be deterministic and total (a malformed regex is a validation
issue, never a runtime throw).

### 1.2 Identity — one ladder per (language, selector)

rkey = `{languageID}-{hash16(canonical key of selector)}`, computed from the record's own fields;
ingest recomputes and **refuses a mismatch** (the `sources` precedent: rkey = normalized OCLC). So
every author's paradigm for "Breton, `{VERB}`" shares one identity by construction — last-write-wins
across authors now, one voting ladder later — and no repo can hold two paradigms for one selector.
`selector` is therefore **immutable per identity**, like a source's `languages[0]`; changing the
category is creating a different paradigm.

Versioning is the standard mirror: `paradigms` collection, one doc per version, `paradigmKey`
(stable, `{languageID}-{hash}`), `current`, archive-don't-delete. Deletion follows `sources`
(archive and re-promote the surviving version, `recordDeleted` guard): entries in strangers'
languages depend on the rules resolving.

### 1.3 How rules reach a reader

Rules are **content**: the record holds them, the doc is reference-only (`paradigmKey`,
`languageID`, `selector`, `selectorKey` (canonical), `recordURI`, `cid`, `authorDID`, dates,
`current`). The entry page asks the AppView which paradigms are current for the language
(`GET /languages/:tag/paradigms` — pointers only, the first new endpoint of the arc, predicted at
layer 4) and resolves the records from their authors' PDSs through a per-URI session cache
(`source-record.ts` pattern).

**As built (slice 3), on one point this section had wrong.** The doc is *not* reference-only: it
caches `rules` and `requires`, plus `selectorAtoms` (the scheme-blind atom keys the join runs on).
It has to. §3 requires generation to run inside the firehose consumer, which is a **single
sequential writer** — resolving a paradigm record from its author's PDS once per ingested entry
would put a stranger's server in this AppView's write path, which is exactly the argument that put
`inherent` on the language doc at slice 2. The line the code actually holds is narrower and
sharper: **the consumer caches what it needs to compute, the read surface serves pointers only.**
So `GET /languages/:tag/paradigms` returns no rules and no label — a reader still gets its
morphology from the record, and nothing about the index looks like the source of truth for a
language's grammar. The endpoint does serve the list **most specific selector first**, because that
is the precedence the expansion job applied; a client sorting it itself would be a second place for
the two to disagree.

Display precedence in a cell, most authoritative first:

1. **the entry's own `otherForms`** — an irregular form overrides any generated cell, matched by
   canonical key on the cell address, exact-then-containment (`placeForms`, unchanged);
2. **a generated form** from the matching paradigm, rendered visually distinct (it is derived, not
   asserted by the entry's author);
3. the layer-4 states: excluded cell (em dash) vs nobody-filled (faint dot). A block that only
   generation fills **is now drawn** — the layer-4 rule "a block no form fills is not drawn" is
   revised exactly as ADR-0009 predicted.

A paradigm **matches an entry by containment**: the entry's inherent bundle (§2.1) contains the
selector. Several paradigms may match one entry (a `{VERB}` paradigm and a `{VERB, Conjugation=2}`
one); all apply, most-specific-selector's row winning per cell — the same most-specific-first
instinct `placeForms` already has.

**As built (slice 6): that rule was enforced on one side only, and it took fixtures to notice.**
The expansion job filtered on `inherentAtoms` from the day it shipped; the **browser did not**, so
`EntryParadigm` merged *every* paradigm of a language into *every* entry. A language with a noun
declension and a verb conjugation therefore showed conjugated nouns — and, worse than untidy, showed
a different set of forms from the one the AppView had expanded into the search index, which is the
single thing one shared generator exists to prevent. It survived slices 4 and 5 because until this
slice **no language anywhere had two paradigms**, so nothing could disagree.

The filter now lives in `apps/web/src/lib/paradigms.ts` as `paradigmsReaching`, beside the resolver,
and is applied by the entry page. Not inside `EntryParadigm`, which was the first attempt and was
wrong for a reason worth recording: **only a caller holding an entry can answer the question.** The
rule editor's live preview has no entry — its draft is by construction the paradigm for the category
being previewed — so a filter inside the shared renderer computed an inherent bundle from the
selector alone, found the selector not contained in it, and silently rendered nothing. The renderer
draws what it is given; the page decides what reaches the page.

---

## 2. The `entries` doc — two storage changes

Both exist for one reason: the expansion job must find and fill affected entries **without fetching
any record from a PDS**, exactly why `tags` and `places` are cached today.

### 2.1 Cache the inherent bundle

New field `inherent: string` — the canonical key of the entry's inherent bundle, computed at ingest
by filtering the current version's `categories` through the **current language record's `inherent`
declarations** (via `inherentFeatures` in `packages/types`, which already exists): the UPOS plus
every feat the language declares inherent for that category. Persistent index
`["languageID", "inherent"]`? No — containment matching can't use an equality index; store instead
`inherentAtoms: string[]` (canonical key per atom: the UPOS key and each inherent feat's key) with
index `["languageID", "inherentAtoms[*]"]`, so "entries containing selector S" is an indexed
intersection filter. Only inherent features are stored — axis features on a headword are noise for
rule matching, and storing the filtered set is what tells the job precisely which entries a new
rule reaches.

(The language record changing its `inherent` rows stales this cache; v1 accepts that an entry's
`inherentAtoms` refresh on its next republish, and §7 holds the open question of a language-wide
recompute trigger.)

**As built (slice 2), on two points this section left open.** The declarations come from a **cache
on the language doc** — a new `inherent: GrammarInherent[]` beside `labels`, written by
`ingest-language` — because entry ingest cannot resolve a record from a PDS and nothing else in the
index carries inherence; a language indexed before the cache existed contributes none until its
record is republished, exactly as `labels` did. And the stored atom keys are **scheme-blind**
(`tagAtomKeys` / `inherentAtomKeys` in `packages/types`, built on `featsMatchKey`), for the reason
every form-to-cell join already is: a bot writes `Conjugation=2` bare where the language's own editor
writes it carrying the minting scheme, and a paradigm reaching only one of the two would be worse
than one reaching both. Selector atoms must be keyed the same way — that is what `tagAtomKeys` is
for. Inherence *rows* are still matched to a category by the ordinary scheme-ful containment
(`heldKeys`), as layers 3 and 4 match theirs. The part of speech needs no binding of any kind to
enter the bundle: requiring one would make every paradigm of a language whose labels nobody has
written yet silently inert.

### 2.2 Replace `search` with `otherForms`

The flat `search: string[]` (lowercased orthographies + form spellings, undifferentiated) is
retired. The doc now carries:

```
orthographySearch: string[]   // lowercased orthographies — the HEADWORD half
otherForms: [{                // the FORM half, one row per form
  form: string                //   the spelling as displayed
  search: string              //   lowercased, for the index
  feats: string               //   the form's cell address as a canonical feats key
                              //   — `featsMatchKey`, the same string a rule's
                              //   coordinates produce through `coordsMatchKey`
  tag: Tag                    //   the address itself (slice 2): a hit is shown the
                              //   form's LABELS, and a key cannot be resolved back
                              //   into a tag — provenance has been folded into it
  origin: "record" | "rule"   //   author-asserted (from the record's otherForms) or
                              //   generated by the expansion job
  paradigmKey?: string        //   when origin = "rule": which paradigm produced it,
                              //   so one rule edit replaces exactly its own output
}]
```

Indexes: `["languageID", "orthographySearch[*]"]` and `["languageID", "otherForms[*].search"]`
replace `["languageID","search[*]"]`. The search query filters both arrays and **reports which half
matched**, so the results UI gains a headword / word-form filter and a hit like *молода* can say
"form of *молодий* — Case=Nom|Gender=Fem|Number=Sing" (rendered through the labels model, never as
the raw key). Two indexed array filters instead of one is the whole cost; prefix search semantics
are unchanged. **As built:** `EntryView.match` carries `{headword: boolean, forms: EntryFormHit[]}`
on search hits only, a hit reports at most eight matching forms, ranking puts an exact headword
first and a form-only hit last, and the filter is **client-side over the returned hits** — the
response already says which half each one came from, so a query parameter would buy recall past the
50-hit cap and nothing else.

This is a **DB-only reshape** — no lexicon change, no republish. `db:init` rebuilds the two fields
for existing docs from what is already stored (orthography + record refetch is NOT needed: the
record's otherForms tags are re-derivable only from the record, so pre-reshape versions get
`origin: "record"` rows only when their author republishes — pre-1.0, the fixture bot republishes).

---

## 3. The expansion job

One module, `apps/api/src/firehose/expand-forms.ts`, invoked from three places — never a daemon,
always a bounded pass:

1. **A paradigm version becomes current** (ingest, promotion after deletion, later a voting flip):
   re-expand **the whole language slice** the selector reaches — indexed lookup on
   `inherentAtoms[*]`, chunked (e.g. 500 docs per AQL batch), replacing rows with that
   `paradigmKey` and recomputing `formIssues` (§3.3). A rule edit re-expanding an entire language
   is the priced cost of ingest-time expansion — accepted at layer 3, paid here.

   **As built (slice 3), on two points.** *Which entries*: the slice is two queries, not one —
   the entries the selector reaches **now** (indexed), plus the entries still **carrying** that
   `paradigmKey` in a generated row or a `formIssues` row. The second is what makes a withdrawal
   clean up after itself: those entries match nothing any more, so the first query cannot find
   them, and their rows would otherwise sit in search forever. It is also why the archived doc is
   passed to the expander after a deletion — its selector still names the slice, and its key still
   names the rows to sweep.

   *What is rewritten*: **all** matching paradigms are re-run for each affected entry, not just the
   one that transitioned. Per-paradigm row replacement is unsound the moment two paradigms can fill
   one cell, because **precedence is a property of the set** — withdrawing the specific paradigm has
   to hand its cells back to the general one, and no rewrite scoped to the withdrawn key could do
   that. `paradigmKey` on a row therefore makes the *result* attributable; it is not what makes the
   computation surgical. (Verified: `verify-paradigms.ts` asserts the hand-back in both directions.)
2. **An entry version becomes current** (new entry, rewrite, promotion): expand that one entry
   against all current paradigms whose selector its `inherentAtoms` contain. This covers "adding
   inherent features to an existing entry triggers established rules".
3. **`db:init`**: wholesale rebuild, like the semantic network — derived data, never source.

Per entry × matching paradigm: resolve `requires` against the entry's `origin: "record"` forms
(by canonical key, exact-then-containment); run the generator; write `origin: "rule"` rows.
Generated forms **feed search** like asserted ones — that is ingest-time index expansion, the
settled answer to non-invertible Hunspell rules.

The job **never touches a record** (invariant 5) and only ever rewrites `otherForms` rows whose
`paradigmKey` matches, plus `formIssues` — asserted forms and every other doc field are read-only
to it.

### 3.3 Missing base forms

When a `requires` row finds no matching asserted form, the paradigm is skipped for that entry and
the doc gets:

```
formIssues: [{ paradigmKey, requiresKey, message }]   // message copied verbatim from the rule —
                                                      //   homolingual by construction
```

DB-level only: no record is marked, no reader page shows an error banner. The language dashboard
gains a **missing-forms queue** (a counter card + capped list, the `todo` queue's exact shape)
served off a `["languageID", "formIssues[*]"]`-style filter, so human reviewers find the entries
and add the missing forms — which, being an entry edit, re-triggers path 2 and clears the issue.

**As built (slice 3):** capped at 100 like the todo queue, and with **no index of its own** — for
the reason `todo` has none either, that the language's current entries are already the working set
every counter on that dashboard reads. The messages are **deduped per entry**, since two paradigms
reaching one word commonly want the same principal part. The dialog prints them verbatim under the
headword: the whole point of writing the message in the rule is that a speaker wrote it, so the
interface must not paraphrase it.

---

## 4. The ingest gate — silently rejected, per ADR-0015

A paradigm record that contradicts **itself** is refused, logged with its offending rows, surfaced
nowhere; the previous version stays current. `paradigmIssues` in `packages/types` (the
`grammarIssues` twin, shared with the editor, which blocks publishing on any defect):

- rkey ≠ recomputed `{languageID}-{hash16(selector)}` — or a selector that is not a valid `Tag`;
- `rules` empty, or any array over its declared cap (`MAX_PARADIGM_RULES`, `MAX_PARADIGM_REQUIRES`
  — caps are validation, not documentation);
- a `base` naming neither a `requires` row nor another rule's target, or a `requires` cycle
  (a base chain must ground in the lemma or an asserted form);
- an invalid or catastrophic `match` regex (validate compilability and a length cap; the generator
  must never throw);
- a `requires` row with an empty `message` — an error nobody can read is a contradiction of the
  row's purpose.

What is **not** refused, deliberately: a selector or coordinate the language record never declared.
That is a contradiction *between two records* (the paradigm and the language), which ADR-0015 says
is indexed and contested, not refused — and refusing it would create an ingest-order dependency
(paradigm arriving before the language's grammar). Such a paradigm is indexed and simply **inert**:
its selector matches no entry's `inherentAtoms`, or its coordinates address no layout cell, and the
dashboard's existing worklist logic can surface it later if wanted (§7).

---

## 5. The interfaces

**The entry page** generates cells client-side from the resolved paradigms (same generator), merges
syncretic cells (many-to-one: one form spanning cells renders once with a spanned header, never
repeated), styles generated forms as derived, and keeps the three layer-4 cell states distinct.

**As built (slice 4), on four points.** *The shared thing is the **merger**, not only the generator.*
`mergeParadigms` in `packages/types` decides asserted-beats-generated and earlier-paradigm-wins, and
**the AppView's expansion job was refactored onto it**: sharing only `generateForms` would have left
the index and the reader free to disagree about which of two candidates fills a cell, and a word
findable by a form the page does not show is exactly the failure invariant 6 exists against.

*Syncretism is placement, not presentation.* `placeForms` now expands a form's address over its
multivalue items (`Gender=Fem,Masc` → both cells) and puts the **same form object** in each. A form
with no multivalue expands to itself, so single-valued placement is unchanged — the property that
made this safe to put in the shared path.

*The geometry moved into `packages/types` too* (`mergeCellSpans`), because the drawing component's
own contract is that it contains no arithmetic, and because a merged table should be checkable
without a browser. It keys on the form **instance**: two cells merge only when one form spanned
both, never when two forms happen to be spelled alike — the distinction the multivalue notation
exists for, which a spelling comparison would erase.

*The entry page renders the paradigm unconditionally.* The old `otherForms.length > 0` gate would
have hidden precisely what this layer adds — an entry that writes out no form of its own and gets a
full table from the rules. The component returns nothing when there is nothing.

*Not in, deliberately:* `formIssues` reaches no reader surface, as §3.3 says. The unmet-requirement
messages are contributor notes and the dashboard queue is their home.

**The rule editor. ⚠ The doors are inverted — §5.1 below is authoritative over the next paragraph's
framing.** This section put the empty-cell popover first; it is a **complement**. The primary interface is a **Paradigms tab in the
grammar dialog, last, after Layout**, where each layout row is a list item leading to that
category's paradigms. The reason is one this section did not consider: `EntryParadigm` draws no
block none of whose cells hold a form, and nothing at all for an entry with no forms — so on exactly
the entry that most needs rules, a regular word whose author wrote out nothing, **there is no cell to
click**. A door that appears only once the table is half-filled cannot be how a language declares
its morphology; a layout row, which exists because the language declared it, can.

The popover itself is unchanged and still built in the same slice: it opens from an **empty cell of
the layout**, scoped to the paradigm matching that entry's category, pre-addressed to the clicked
cell, and states plainly that **an irregular form belongs in this entry's own `otherForms`, not in a
rule** — the two affordances sit side by side. Publishing follows the standard shape:
full-rewrite record from the editor's own PDS, `paradigmIssues` blocking on any defect, a
stale-rewrite `cid` guard (paradigms are edited by strangers, like sources). The editor shows a
**live preview**: the current entry's lemma run through the draft rules into the layout.

**As built (slice 5), on five points.** *The editor is its own dialog, stacked.* It publishes a
different record — own key, own issue gate, own concurrency guard — and the grammar dialog's single
publish footer is bound to the language record; a second draft behind that one footer is how a
contributor loses an edit. It swallows Escape (capture phase) so closing it cannot also close the
grammar draft behind it, and the same component serves both doors.

*A paradigm files under a layout row by scheme-blind atom containment*, not by `tagKey` — the reason
`inherentAtoms` is keyed that way: a bot writes `Conjugation=2` bare where this editor writes it
carrying the minting scheme, and filing under only one of the two would hide a paradigm from the
person who has to fix it. A selector containing several layout categories files under the most
specific. Paradigms **no layout covers** get their own group at the root, listed and openable but
**not diagnosed** — §7.3 stays open, and a row nobody can reach is the mistake ADR-0015 was written
about.

*The base is a select, not a text field.* Its options are exactly what `unknown-base` accepts — the
lemma, a `requires` address, another rule's target, its own excluded — so the commonest defect is
unreachable from the control while `paradigmIssues` still guards the manual paths.

*The preview is `EntryParadigm`, not a table of its own.* Same argument as the layout designer's,
one layer on: the shared thing at slice 4 was the merger precisely so the index and the reader could
not disagree about a cell, and an editor drawing its own grid would reintroduce the disagreement at
the place the author is looking. Verified in the browser: a `Number=Plur` rule adding `-où` over
`gwerzenn` previews as `lies. gwerzennoù`, italic, under the language's own homolingual label.

*The cell door lives on table cells only.* A list block **skips** an address nothing fills rather
than drawing it, so a list has no empty cell — which is right (a list of forms enumerates what
exists) and worth stating, because it is the second reason the tab had to be the primary door.
Consequently the door could **not** be exercised against live data: the only layout Breton declares
is a one-item list block, so no table cell is drawn anywhere in production. That is slice 6's
fixtures to close, the same gap slice 4 left for the same reason. An excluded cell gets no door, and
no "this word has no such form" affordance was added — §7.1 stays open.

**Closed by slice 6.** `qtl`'s noun layout draws five blocks, so the door finally had table cells to
sit on. On `lxt-04`: **20** unfilled cells are doors and **0** excluded cells are — the asymmetry the
design asks for, verified by counting rather than by looking. The popover prints the cell's address
(`Case=Gen|Number=Sgv`) above both affordances, and "edit the language's rules" opened **lxp-01**,
the most specific paradigm reaching that entry rather than the general `{NOUN}` one behind it, with
the clicked cell seeded as rule 9. The generated table it sits in is the rest of the proof: an
asserted `roskerum` upright beside seven italic generated forms, one faint dot and one em dash in the
same grid.

**The search results** gain the headword/word-form filter (§2.2), rendered as a small kind toggle
on word results; a form hit prints its entry's headword plus the form's labels.

**Voting:** `paradigms` joins the upgradable collections in
`docs/design/weighted-voting.md` §2.1 (shared key `paradigmKey`) — recorded there, nothing to build
here now; §7.6 of that note (language records' blast radius) applies to paradigms identically.

### 5.1 The rule editor, as decided and built

> Merged in from `docs/design/paradigm-rules-slice-5.md`, the separate execution plan slice 5 ran
> from. That file is gone: two design files for one layer, numbered by *step* where this one is
> numbered by *slice*, was a confusion waiting to happen. Its verified-facts table and its
> step-by-step were scaffolding and died with the build; what follows is the part that outlived it.
> **ADR-0016 wins over this section**, as it does over the whole note.

**The primary door is the tab, and the reasoning is the load-bearing part.** §5 above put the editor
behind an empty cell. That is inverted, because the cell door **cannot cold-start a paradigm**:
`EntryParadigm` returns nothing when an entry has no forms at all, and a block none of whose cells
hold a form is not drawn — so on the entry that most needs rules, a regular word whose author wrote
out nothing, there is no cell to click. A door that only appears once the table is already
half-filled cannot be how a language declares its morphology. The grammar dialog has no such
precondition: a layout row exists *because* the language declared it. Layer 5 is a layer of the
cascade like the four before it, so it belongs where the other four live, in the same path-scoped
tree behind the same door on the language dashboard.

**Two levels, mirroring layer 4.** `l5root` lists one item per layout row, labelled by its category
and counting the paradigms filed under it, plus the trailing group for paradigms no layout row
covers. `l5category` lists that category's paradigms, most specific selector first, each opening the
editor. **Clicking a layout row never opens the editor directly, not even when exactly one paradigm
exists** — conditional navigation is the one thing this dialog never does, and the level is also
where "add a narrower paradigm" has to live.

**Adding one.** At `l5category` the offered selectors are: the layout category itself (unless a
paradigm already exists for it — the pointer list is the check), every layer-2 named combination
whose tag contains that category, and a manual tag input. Picking one opens the editor in create
mode with that selector **seeded and locked**.

**The selector is never editable.** Immutable per identity (§1.2): changing the category is
publishing a different paradigm, not editing this one. Displayed locked, the `languages[0]` pattern
from `SourceEditorDialog`.

**Rule order is semantics, so it gets controls.** The first matching row in author order wins a cell,
which means the rules list carries ↑/↓/× exactly as a layout's list items do, and a collapsed row
summarises address + `match` + the affix exchange so ordering is legible without expanding anything.

**`AddressPicker` is shared, and its `id` is required.** Extracted from the grammar dialog because
the rule editor renders **several pickers on one screen** — one per rule target, one per `base`, one
per `requires` row — and duplicate DOM ids across them is a real bug, not a nicety. Its behaviour is
otherwise unchanged, including the one worth stating: **one value per axis, multivalue through the
manual field only.** `Gender=Fem,Masc` (syncretism) is typed, and **no multivalue picker is to be
built** — an axis-spanning form is a deliberate assertion, and a checkbox grid would make it an
accident.

---

## 6. Build slices — one Opus session each

Every slice leaves master typechecking and deployable; the testset slice gates the tag.

1. **The lexicon and the generator.** `lexicons/eu.leksis.paradigm.json` (+ publish script entry),
   `packages/types/src/paradigm.ts`: types, canonical selector key + rkey computation,
   `paradigmIssues`, caps, and the pure generator `generateForms(paradigm, entryFacts)` with
   syncretism-aware output. No api/web change. (The full `npm run typecheck`, since types change.)
2. **The entries reshape.** §2 in full: `inherentAtoms`, `orthographySearch` + `otherForms` rows
   (record-origin only, `origin: "record"`), new indexes, ingest-entry computing both, search AQL +
   `EntriesResponse` reporting match kind, `db:init` reshape, and the web search filter + form-hit
   rendering. Self-contained and useful with zero paradigms in existence.
3. **Paradigm ingest + expansion.** ✅ **built.** `ingest-paradigm.ts` (versioned mirror, §1.2
   identity, §4 gate), the `paradigms` collection + `GET /languages/:tag/paradigms`,
   `expand-forms.ts` with its three trigger paths, `formIssues`, the dashboard missing-forms queue
   endpoint + card. Verified by `apps/api/src/scripts/verify-paradigms.ts` (the
   `verify-ingest-gate.ts` precedent — 42 checks against a local ArangoDB, driving the real ingest
   functions rather than publishing to a PDS, which is slice 6's business), plus curl on both
   endpoints and a browser pass on the card and its dialog. See the three "as built" notes above.
4. **The reader.** ✅ **built.** Entry-page generation: resolve paradigms via the new endpoint + PDS
   cache (`apps/web/src/lib/paradigms.ts`, the `language-grammar.ts` pattern), run the generator,
   merge into the layout with the §1.3 precedence and syncretism merging, style generated vs
   asserted vs missing, render `formIssues` nowhere (reader) while the dashboard queue lists them
   (already served by slice 3). Verified by `apps/api/src/scripts/verify-paradigm-reader.ts` (19
   pure checks over the merge, the spanning and the geometry — no DB, no browser, which is why they
   live in the shared package) plus a browser pass proving the degradation path on real data. **The
   one thing slice 4 cannot prove on its own** is generated forms rendering end to end, since that
   needs paradigm records resolvable from a PDS; those are slice 6's fixtures. See the four "as
   built" notes in §5.
5. **The rule editor.** ✅ **built.** The `SourceEditorDialog`-class dialog of §5, live preview,
   publish path with issue blocking and cid guard — reached primarily from a **Paradigms tab in the
   grammar dialog** (each layout row a list item), with the empty-cell door as its complement.
   `ParadigmEditorDialog` + `lib/paradigm-draft.ts` are new, `AddressPicker` was extracted from the
   grammar dialog (it now needs an `id`: several pickers share one screen here), and
   `GrammarBindingDialog` gained the fifth tab and two levels. **No api, types or lexicon change** —
   the arc's zero-cost pattern held for the fifth layer, and `GET /languages/:tag/paradigms` already
   carried the `cid` the guard needed. Its execution plan lived in a file of its own and has been
   **merged into §5.1**; see also the five "as built" notes in §5.
6. **Testset + recording.** ✅ **built.** And it turned out to be a bigger slice than "add the
   paradigm rows", because **the fixture set had never been published at all** — production held
   `br`, `cy` and `en`, there was no manifest anywhere in the repo, and no fixture bot account
   existed. So this slice built the set from nothing: `scripts/fixtures/` (content, one file per
   lexicon, each record carrying its own `covers` and `expect`) plus `scripts/publish-fixtures.ts`
   (validate → publish → rebuild the manifest), and published three quarantined languages, 25
   entries, three sources and five paradigms live. Coverage matrix gains **P-01…P-12**, **L-42/L-43**
   and **U-60…U-71**; **ADR-0016** covers the layer; the `weighted-voting.md` §2.1 edit was verified
   to have survived. Two things worth carrying forward. The publish is **gated on the AppView's own
   validators** and refuses to start otherwise, because a language version archives forever and an
   incoherent one is refused at ingest and leaves the language silently on its previous version —
   care is not a gate. And the browser pass **found a real defect** (§1.3's containment rule was
   enforced by the AppView and not by the reader), which is what a verification slice is for; see
   the "as built (slice 6)" note in §1.3.

Slices 1–2 and 2–3 are strictly ordered; 4 and 5 both depend on 3 and could swap. If a session runs
long, slice 2's web half (filter UI) can split off cleanly.

## 7. Deliberately open — do not answer by guessing

1. **Per-lexeme defectiveness** ("this verb has no imperative"): an entry-level negative exception
   has no lexicon shape yet. v1 ships without it; a generated form the language's speakers know is
   wrong is the trigger to design it (likely an `otherForms` row asserting absence, which the
   lexicon's non-empty `form` currently forbids — a deliberate pre-1.0 break when it comes).
2. **Language-grammar drift**: `inherentAtoms` and layout-cell validity stale when the language
   record's `inherent`/`axes`/`layout` rows change. v1 refreshes per-entry on republish only;
   whether a language-record transition should trigger a language-wide recompute (path 1's cost for
   every grammar edit) is deferred until a real language's grammar churns.
3. **Surfacing inert paradigms** (selector/coordinates the language never declared) on the
   dashboard worklist — wait for one to exist.
4. **Prefix/infix expressiveness**: `prefix.strip/add` covers mutations; templatic or infixing
   morphology may need more than affix pairs. Do not extend the rule algebra speculatively — a real
   language's paradigm that cannot be written is the trigger, and the record shape can grow
   additively.
5. **Rule-row conflict across paradigms** beyond most-specific-selector (two equally specific
   selectors both matching): v1 takes the higher `indexedAt`; voting will make this principled.
