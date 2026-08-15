# Design note: layer 5 — the paradigm lexicon (inflection rules)

**Status:** Draft — designed 2026-08-15, not yet built. This file is the plan the layer-5 build
sessions execute; where it and shipped code later disagree, the code and the layer-5 ADR win.
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

**The rule editor** opens from an **empty cell of the layout** (and from a dashboard door): it is
scoped to the paradigm matching that entry's category, pre-addressed to the clicked cell, and
states plainly that **an irregular form belongs in this entry's own `otherForms`, not in a rule** —
the two affordances sit side by side in the cell's popover. Publishing follows the standard shape:
full-rewrite record from the editor's own PDS, `paradigmIssues` blocking on any defect, a
stale-rewrite `cid` guard (paradigms are edited by strangers, like sources). The editor shows a
**live preview**: the current entry's lemma run through the draft rules into the layout.

**The search results** gain the headword/word-form filter (§2.2), rendered as a small kind toggle
on word results; a form hit prints its entry's headword plus the form's labels.

**Voting:** `paradigms` joins the upgradable collections in
`docs/design/weighted-voting.md` §2.1 (shared key `paradigmKey`) — recorded there, nothing to build
here now; §7.6 of that note (language records' blast radius) applies to paradigms identically.

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
4. **The reader.** Entry-page generation: resolve paradigms via the new endpoint + PDS cache, run
   the generator, merge into the layout with the §1.3 precedence and syncretism merging, style
   generated vs asserted vs missing, render `formIssues` nowhere (reader) while the dashboard queue
   lists them (already served by slice 3).
5. **The rule editor.** The `SourceEditorDialog`-class dialog of §5, the empty-cell door, live
   preview, publish path with issue blocking and cid guard.
6. **Testset + recording.** Fixture paradigm records (quarantined per `leksis-testset`, including
   one `requires`-missing case exercising the queue), the U-flow additions to the coverage matrix,
   the browser pass, `docker compose build`, CHANGELOG, **ADR-0016**, skill/status updates, and the
   one-line §2.1 edit to `weighted-voting.md` (done with this note — verify it survived). Then
   propose the tag.

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
