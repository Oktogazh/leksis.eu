# Design note: the category–axis merge (+ usage counts, record links)

**Status:** **Planned** — designed 2026-08-21, not yet built. This file is the unified plan for
one feature arc executed across several sessions. Progress is tracked in the staging ADR,
**`docs/adr/0019-category-axis-merge.md`** — read it first in every build session, update it last.
**For:** the grammatical tagging system's structural revision (merging axes back into categories)
plus two small independent surfaces (usage counts / random-entry links in the grammar editor, the
language-record link on the dashboard).
**Supersedes, when built:** ADR-0008's `grammar.axes` (removed), ADR-0009's `grammar.layout`
(removed — table shape moves into the paradigm record), and ADR-0016's containment selector
(replaced by exact match). ADR-0006/0007 (primitives, inherence) stand. Where this note and the
code eventually disagree, the code and the finalized ADR-0019 win.

> **How to read this.** §1 is the model — what changes and why. §2 the new shapes (lexicon +
> types). §3 storage and API. §4 the interfaces. §5 the build slices — **one slice = one full
> Opus session = one prompt**; each slice leaves the repo typechecking, deployable and committed
> (untagged). Only the final slice carries the version bump and the release tag, because the arc
> contains breaking changes and a half-finished feature must not deploy. §6 what is deliberately
> open.

---

## 1. The model

### 1.1 Why the merge

Layers 2 and 3 separated *what a headword is* (inherent combinations) from *what its forms vary
over* (axes). Real conventions couple them: the **headword's own position on the axis** is part of
what the category means. Breton nouns show all three cases at once — ordinary nouns
(`NOUN Gender=Fem|Masc`, headword is `Number=Sing`), collective-only nouns whose headword is
`Number=Coll`, and *anv-kadarn stroll* whose **headword is the plural** (`Number=Plur`), the
singular being derived by `-enn` through paradigm rules. So one category may contain headwords
sitting at **different default values of the same axis, each with its own abbreviation** — which
the separated model cannot express.

The merge: **a category declares its axis and its default value(s) together.** The standalone
`grammar.axes` notion disappears entirely.

### 1.2 The new category flow (authoring semantics)

- The base stands: a new category is a **POS tag + inherent feature value(s)** (now including
  POS-only categories — the old ≥2-atom floor on `bindings` goes).
- **No axis attached** → the category takes one annotation (a `{long, short}` pair), as today.
- **An axis attached** (one bare feature name) → the first annotation **must** be created attached
  to what will be the **default axis value** for the category, and further optional annotations
  each define **another default value** with its own abbreviation. That is how `NOUN Gender=Masc`
  holds both a Sing-headword abbreviation and a Plur-headword one (*anv-stroll*).
- The category declares **feature + defaults only, never the axis's value inventory** (settled
  2026-08-21): the inventory is the layer-1 bound values of that feature, and the paradigm tables
  enumerate their cells by hand anyway. `otherForms` pickers offer the bound values of the
  category's axis feature.

### 1.3 The entry carries its default value

The narrowing tree emits the chosen annotation's default value **into the entry's category
bundle** — an anv-stroll headword is tagged `NOUN Gender=Masc|Number=Plur` on the record itself,
so the record self-describes without the language record in hand. This reverses the earlier
"never store the axis value on the entry" rule, and the justification is the selector (§1.4):
the value is now identifying, not derivable.

Sense-level tags may still refine (the *dour* case: headword `NOUN Gender=Masc`, sense group I
tagged `Number=Coll`, group II `Number=Sing`) — sense tags are unchanged by this arc.

### 1.4 The paradigm selector becomes exact-match

A paradigm defines the combination(s) it applies to by **exact match** on the full headword
bundle — POS + inherent features **+ the default axis value** (settled 2026-08-21). `NOUN` alone
selects only entries whose bundle is literally bare `NOUN`; it does not capture the flavors. A
paradigm may still list **several** combinations it applies to (`selectors: Tag[]`). Containment,
`inherentAtoms`, and the whole most-specific-selector-wins machinery are removed: exact match
means paradigms cannot overlap on an entry's bundle, and two records with identical selectors are
one identity (rkey).

### 1.5 Tables are authored cell by cell; `grammar.layout` is removed

Conjugation tables are arbitrary — not cartesian products (a `Person=0` with no Number, massive
or weird shapes). So the derived-cells layout model goes, and **the table shape moves into the
paradigm record** (settled 2026-08-21), defined cell by cell:

- a **title cell** is plain text explaining rows/columns;
- a **form cell** carries an exact feature combination (its address, e.g.
  `Number=Sing|Person=1|Tense=Pres|Mood=Ind`) and optionally an ordered list of rules of the
  existing Hunspell shape (first matching rule wins); a form cell with no rule is manual-only;
- **merged cells** (rowSpan/colSpan, vertical or horizontal) are allowed and behave like normal
  cells of their kind.

The fallback ladder becomes: paradigm tables → flat `otherForms` list. "No layout declared →
flat list" survives with "layout" now meaning "paradigm with tables".

### 1.6 What this arc does NOT change

The labels read model's architecture (single-sourced, keyed on the tag), the ingest gate
(ADR-0015 — a self-contradicting record is refused), abbreviations and lexicographic label sets
(ADR-0010), inherence (ADR-0007), primitives (ADR-0006), and every invariant in
`leksis-evolution` except where explicitly superseded above.

---

## 2. The new shapes

### 2.1 `eu.leksis.language` — the `grammar` object

Removed: `axes`, `layout` (both keys **rejected at validation** when present — pre-1.0 break; the
`br` record is republished without them in slice 2 before the gate lands).
Kept unchanged: `pos`, `features`, `values`, `inherent`, `abbreviations`.
Replaced: `bindings` → **`categories`**:

```typescript
categories?: [{
  category: Tag            // POS + inherent feature values, ≥1 atom (POS-only allowed)
  axis?: string            // bare feature name whose default value identifies the headword
  annotations: [{          // ≥1, ≤16
    long: string           // homolingual label ("anv-kadarn gourel")
    short?: string         // abbreviation ("g.")
    default?: string       // the axis value this headword form carries;
                           //   REQUIRED on every annotation iff axis is set, FORBIDDEN otherwise
  }]
}]
```

**Coherence rules** (new/changed `grammarIssues` kinds — the old axis/layout kinds go):

| kind | fires when |
|---|---|
| `category-unbound` (renames the grounding checks as needed) | an atom of `category` is unbound — grounding rule of ADR-0007 unchanged |
| `category-axis-unbound` | `axis` names a feature not bound at layer 1 |
| `category-axis-inherent` | `axis` is declared inherent for this category (successor of `inherent-axis-conflict`) |
| `category-default-unbound` | an annotation's `default` is not a bound value of `axis` |
| `category-default-missing` / `category-default-forbidden` | the iff rule of §2.1 |
| `category-duplicate-default` | two annotations of one category share a `default` |
| `lexicographic-in-grammar` | widened: `axis` may not be a lexicographic feature |

Removed issue kinds: `empty-axis`, `inherent-axis-conflict`, `layout-unknown-axis`,
`layout-repeated-axis`, `layout-foreign-coordinate`, `empty-layout-block`, `layout-too-large`.

**Labels model mapping** (no collection change): each annotation is one labelled tag whose tag is
`category ∪ {axis: default}` when an axis is set, else `category` itself — so an entry carrying
the full bundle resolves by `resolveTag`'s exact branch, exactly as combinations did. Kind stays
`combination` in storage (renaming the enum is optional polish, not required).

### 2.2 `eu.leksis.paradigm` — v2

```typescript
{
  languageID: string
  selectors: Tag[]         // 1–8 full headword bundles, EXACT match (canonical-key equality)
  label?: GrammarLabel
  requires?: [{ coords, message }]      // unchanged shape
  tables: [{               // 1–16
    name?: string          // homolingual caption
    rows: Cell[][]         // the grid; rectangular AFTER span accounting
  }]
  notes?, references?, subject?, createdAt
}

Cell =
  | { kind: "title", text: string, rowSpan?, colSpan? }
  | { kind: "empty", rowSpan?, colSpan? }               // structural filler
  | { kind: "form",  coords: {feature, value}[],        // the cell address; multivalue value
                                                        //   still expresses syncretism
      rules?: Rule[],                                   // ordered, first `match` hit wins;
                                                        //   absent = manual-only cell
      rowSpan?, colSpan? }

Rule = { base?, match?, strip?, add?, prefix? }         // ADR-0016 shape minus coords
                                                        //   (the address is the cell's)
```

- **rkey / identity**: `{languageID}-{hash16(sorted canonical selector keys, joined)}` —
  recomputed at ingest, refused on mismatch; `selectors` immutable per identity, as before.
- **`paradigmIssues` v2** (still judges only self-contradiction): non-rectangular grid after
  spans; duplicate `coords` address across all tables of the record; `base` referring to a coords
  address no form cell carries; base cycles; invalid regex (issue, never a throw);
  `MAX_TABLE_CELLS` (keep 4096 total per record). A selector nobody's grammar declares stays an
  **inert paradigm, not an error** (unchanged).
- **`generateForms` v2**: iterate form cells in reading order; per cell, first rule whose `match`
  hits wins; `requires` unchanged; still **total** (runs in the sequential writer).
- **Overrides unchanged in spirit**: the entry's own `otherForms` land on cells by canonical key
  of `coords` — exact first, then containment, most specific first (`placeForms` semantics
  survive, re-hosted on paradigm tables instead of layout blocks). Asserted → generated →
  empty/manual is still the display precedence.

### 2.3 `packages/types` — removal inventory (from the 2026-08-21 scout)

Remove/replace in `grammar.ts`: `Grammar.axes` (:443) + `GRAMMAR_LIMITS.axes`, `axesOf` (:734),
`applicableAxes`/`applicableAxisRows` (:758), `resolveAxes` (:865), `ResolvedAxis`; all layout
types and functions — `LayoutBlock`, `GrammarLayout`, `LayoutCoord`, `ResolvedLayoutBlock`,
`MAX_LAYOUT_CELLS` (:910), `coordTag` (:934 — **re-host**: the paradigm editor/reader still needs
bare-coordinate re-qualification against bound values), `layoutKey`/`layoutBlockKey`,
`layoutFor` (:1058), `resolveLayout` (:1134), `layoutView` (:1408), `placeForms` (:1339 —
**re-host** onto paradigm tables), form-ordering-via-axes (:1507–1538 — reorder via the paradigm's
cell reading order, falling back to record order); the axis/layout passes of `grammarIssues`
(:1842–2014) and their kinds (:1688–1703); record validation of `axes`/`layout` (:2416+).
`inherentAtomKeys` (:809) is **replaced** by the headword-key computation of §3.1.
In `paradigm.ts`: `selector` → `selectors`, hash over the sorted key list, `mergeParadigms`
specificity machinery deleted, `generateForms` re-written over tables, `paradigmsReaching`
becomes an exact-key lookup.

---

## 3. Storage and API

### 3.1 `entries` docs: `selectorKeys` replaces `inherentAtoms`

At ingest (`ingest-entry.ts:564` today), compute per category bundle the **headword key**: the
canonical key of (UPOS + the feats the language declares inherent for the category + the axis
default value when the bundle carries one). Store as `selectorKeys: string[]`; index
`["languageID", "selectorKeys[*]"]` (replacing `["languageID","inherentAtoms[*]"]` in
`init-db.ts:232`). The shared computation lives in `packages/types` next to where
`inherentAtomKeys` was, so web previews and the ingester agree. It must flow through **every**
path that echoes `inherentAtoms` today: the doc literal, the archive/promote AQL
(ingest-entry.ts:605/667/684/707), and `expandEntry`'s entry-facts (expand-forms.ts:67/77).

**Expansion** (`expand-forms.ts:329–343`): the AQL INTERSECTION containment filter becomes
equality — `FILTER pk IN e.selectorKeys` over the paradigm's selector keys — a pure indexed
lookup. Staleness rule unchanged: a language-record change does not re-key entries; they refresh
on their next republish (ADR-0016's line, restated).

### 3.2 New endpoint: one random entry per label row

`GET /languages/:tag/labels/:key/random` → `{ entryKey, orthography }` — one uniformly random
member of the row's DB-side `entries` list (AQL over the `labels` doc; 404 on unknown/empty row).
Serving one key at a time keeps ADR-0004's "the dictionary cannot be enumerated through its label
list" intact in practice. No change to `GET /languages/:tag/labels` (counts stay counts).

### 3.3 Paradigms endpoint

`GET /languages/:tag/paradigms` unchanged in role (pointers, no rules/tables served); drop the
most-specific-first sort (meaningless under exact match — sort by selector key for stability).

---

## 4. The interfaces

### 4.1 Usage counts + random-entry links in the grammar editor

`GrammarBindingDialog` fetches `GET /languages/:tag/labels` once on open and joins rows to the
draft by canonical row key (`bindingKey`/`tagKey`), exactly the join the labels model was keyed
for. Next to each **POS, feature value, category and annotation** row (the first two layers +
categories), render: the usage count (`×N`, as `LabelShelf` prints it), a **link to a random
entry** using that tag/combination (from §3.2, rendered as the entry's orthography linking to
`/entry/<key>`), and a **reroll button** beside it that re-calls the endpoint. Count 0 / empty
row → count chip only, no link. Counts describe the **saved** grammar, not the unsaved draft —
say so in a tooltip/hint rather than trying to be live.

### 4.2 Language record link on the dashboard

Bottom of `LanguagePage.tsx` (after the sources section, before the dialogs), a footer mirroring
`EntryPage.tsx:881–892`: anchor to `https://atproto.at/uri/${language.recordURI}` (raw at:// URI,
deliberately un-encoded — copy the comment), text under a new `language.viewRecord` i18n key.
Points at the **currently accepted** version's record.

### 4.3 The categories editor (replacing the combinations + axes + layout tabs)

One **Categories** tab replaces three. Creating a category: pick the bundle exactly as the
combinations flow does today (`grammar-draft.ts:277–297` reworked), then optionally attach an
axis (a picker over bound non-lexicographic, non-inherent-for-this-category feature names), then
the annotation form — with a **default-value picker** (bound values of the axis) that appears iff
an axis is set, plus an "add another abbreviation" affordance for further defaults. Editing keeps
the one-row-per-category rule (`upsertCategory` replaces in place). The removed `l3*`/`l4*` tabs,
paths, i18n keys and `AddressPicker`'s axis-driven mode go with it.

### 4.4 Entry editor

- **Narrowing**: an annotation with a `default` is one more leaf in the derived tree; choosing it
  emits the full bundle *including* the default value (§1.3). Bundles remain one tag, never an
  accumulation; the flat-picker degrade survives.
- **`otherForms` picker** (`CreateEntryPanel.tsx:65–139, 1122–1128`): the axis-driven orthogonal
  selectors are rebuilt over the entry's category axis feature — offer the bound values of that
  feature (and of any feature used by a matching paradigm's cells, when cheap) — degrading to the
  flat bound-tag picker + manual entry as today.

### 4.5 The paradigm table editor and reader

- **Editor** (`ParadigmEditorDialog` rebuilt): selectors picked from the language's **declared
  category+default bundles** (each annotation of each category is one candidate selector, shown
  by its label); a grid editor — add/remove rows and columns, per-cell kind toggle
  (title/empty/form), title text input, form-cell coords built from bound features/values, merge
  handles (span up/left), and the per-cell rules list reusing the ADR-0016 rule row UI (base,
  match, strip, add, prefix). Requires editing unchanged. Footer blocks publishing on any
  `paradigmIssues` defect, listed per kind (the ADR-0015 pattern).
- **Reader** (`ParadigmView` rebuilt): render the stored tables verbatim — titles, spans, and per
  form cell the asserted → generated → state ladder; **"manual-only cell nobody filled" renders
  differently from "generated blank"** (successor of ADR-0009's two-states rule). Leftover
  `otherForms` matching no cell still print below the tables. No paradigm → flat list.

---

## 5. Build slices — one slice per session

**Session protocol (every slice):** (1) read `docs/adr/0019-category-axis-merge.md` for current
position; (2) implement the slice's steps in order — the PostToolUse hook typechecks each edit;
`packages/types` changes require full `npm run typecheck`; (3) verify per the slice's list (verify
skill; browser via the `web` preview + dev session); (4) update the staging ADR's checklist and
"state after this slice" note; (5) propose one commit (hard stop — user approval). **No tag before
slice 6.** Master must typecheck and deploy after every slice.

### Slice 1 — Counts, random-entry links, record link *(independent, non-breaking)*

1. API: add `GET /languages/:tag/labels/:key/random` (§3.2) in `apps/api/src/labels.ts` + route in
   `index.ts`; type the response in `packages/types` (`label.ts`).
2. Web: `LanguagePage.tsx` footer record link (§4.2) + `language.viewRecord` i18n key (all
   locales).
3. Web: `GrammarBindingDialog` — fetch labels on open; count chips + random-entry link + reroll
   button next to POS rows, value rows, and combination rows (§4.1); i18n keys.
4. Verify: curl the endpoint (ArangoDB running, rows with/without entries, unknown key); browser —
   dashboard footer link on `/language/br`, counts and links in the binding dialog, reroll
   changes the target, entry link navigates.
5. Update staging ADR; propose commit.

### Slice 2 — The grammar merge: lexicon, types, ingest, `br` republish, minimal web

1. Lexicon `eu.leksis.language.json`: remove `axes` + `layout` (+ their defs), replace
   `combinationBinding` with the `categories` shape (§2.1); byte/grapheme caps at 10:1.
2. `packages/types/grammar.ts`: the §2.3 removals; new `GrammarCategory` types, limits, canonical
   keys; new issue kinds + passes (§2.1 table), old kinds deleted; labels mapping
   (`grammarRows`/`toDeclaredLabel`) emits one row per annotation with tag
   `category ∪ {axis: default}`; headword-key computation replacing `inherentAtomKeys`; record
   validation rejects `axes`/`layout` keys. Full `npm run typecheck` will fail until steps 3–5
   land — that is the slice's arc, not a stopping point.
3. `apps/api`: `ingest-language.ts` (new validation path), `ingest-entry.ts` `selectorKeys`
   (§3.1 — doc literal + all archive/promote AQL echoes), `expand-forms.ts` equality filter,
   `init-db.ts` index swap. **Paradigm ingest** still compiles against the old lexicon —
   acceptable this slice only if types allow it; otherwise gate `ingest-paradigm` to refuse all
   records this slice (old-shape records are invalid anyway once selectors change; slice 3
   rebuilds it) — prefer the refuse-all stopgap, it is honest and small.
4. `br` republish: one-off script in the scratchpad modeled on `scripts/publish-fixtures.ts`
   (VITE_DEV_* creds from `apps/web/.env.local`): fetch `GET /languages/br/currentRecord`, strip
   `grammar.axes`, `grammar.layout` and `grammar.bindings` (the now-invalid categories), putRecord
   as `testaccount.leksis.eu` (rkey `br`). Last-write-wins makes it current; check the previous
   author first and say what was found. Run it **before** deploying the new gate is moot (no tag
   this slice) but keeps the dev-against-production proxy view coherent while working.
5. `apps/web` minimal compile pass: delete the axes + layout tabs and their draft helpers
   (`grammar-draft.ts:308–352` etc.), point the combinations tab at the new `categories` field
   (rename-level edits only — the full §4.3 editor is slice 3), degrade `CreateEntryPanel`'s
   otherForms picker and `AddressPicker` to the flat picker, stub `ParadigmEditorDialog`/
   `ParadigmView` to compile (readers show the flat list; editor disabled with a "being rebuilt"
   notice + i18n key).
6. Verify: full typecheck; ingest gate exercised with `verify-ingest-gate.ts` reworked or a curl
   sequence; browser — `br` dashboard loads, grammar dialog opens with categories visible, entry
   page falls back to flat forms list.
7. Update staging ADR; propose commit.

### Slice 3 — The categories editor and the entry editor

1. `grammar-draft.ts`: category helpers (find/upsert/remove, axis + annotations with defaults).
2. `GrammarBindingDialog`: the §4.3 Categories tab (axis picker, default-value picker, multiple
   abbreviations per category), footer defect listing for the new issue kinds, repair paths for
   every kind (ADR-0015 rule); slice-1 count/link chips wired to the new rows.
3. Entry editor: narrowing over annotations-with-defaults emitting the full bundle
   (`categoryRoots`/`categoryRefinements` rework); otherForms picker over the category's axis
   feature values (§4.4).
4. i18n for everything above (all locales in `apps/web/src/i18n/locales/`).
5. Verify in browser (dev session): declare on a quarantined fixture language a gendered-noun
   category with axis Number, default Sing + a second Plur abbreviation; create an entry through
   the narrowing choosing each abbreviation; confirm the emitted bundles include the default;
   check every new issue kind can be provoked and repaired in the dialog.
6. Update staging ADR; propose commit.

### Slice 4 — Paradigm v2: lexicon, types, ingest, API, basic reader

1. Lexicon `eu.leksis.paradigm.json`: the §2.2 shape (selectors, tables, cells, per-cell rules).
2. `packages/types/paradigm.ts`: types, limits (`MAX_TABLE_CELLS` 4096, selectors ≤8, tables ≤16),
   rkey over sorted selector keys, `paradigmIssues` v2, `generateForms` v2 (total),
   `paradigmsReaching` as exact-key lookup, response types; re-host `coordTag` and the
   `placeForms` join onto tables.
3. `apps/api`: `ingest-paradigm.ts` v2 (rkey recompute + refuse on mismatch, issues gate),
   `expand-forms.ts` generation over tables, `paradigms.ts` sort change (§3.3).
4. `apps/web`: `lib/paradigms.ts` (fetch/cache unchanged, matching by `selectorKeys`);
   `ParadigmView` v2 basic — stored tables with titles, spans, asserted/generated/manual-empty
   states, leftovers below (§4.5 reader, minus polish).
5. Verify: rework `verify-paradigms.ts` / `verify-paradigm-reader.ts` scripts; curl the paradigms
   endpoint; browser — publish a small fixture paradigm by hand-written record (script), see the
   table render on a matching entry, confirm exact-match reaches only the exact bundle.
6. Update staging ADR; propose commit.

### Slice 5 — The paradigm table editor

1. `ParadigmEditorDialog` v2 (§4.5): selector picker over declared category annotations; grid
   editing (rows/columns, cell kinds, merges, coords builder, per-cell rules, requires); publish
   gate on `paradigmIssues`; stale-rewrite/identity handling as before.
2. Entry-page integration polish: override precedence visible, "no rule" vs "not filled" states,
   reroll of generation preview in the editor (reuse ADR-0016's preview if present).
3. i18n.
4. Verify in browser: build the Breton anv-stroll case end to end on fixtures — category
   `NOUN Gender=Masc` axis Number defaults Sing + Plur; a paradigm selecting the Plur bundle with
   an `-enn` singulative rule; an entry created via the Plur abbreviation showing its generated
   singular; merged cells and title cells render as authored.
5. Update staging ADR; propose commit.

### Slice 6 — Verification slice + release (v0.28.0)

1. `leksis-testset`: update the coverage matrix and fixture definitions (`scripts/fixtures/`) for
   every feature of this arc (counts/links, categories with defaults, exact-match paradigms with
   tables); publish fixtures, run the affected flows against the manifest's expect lines,
   `--teardown` after.
2. Pre-tag gate: `PDS_ADMIN_PASSWORD=x PDS_JWT_SECRET=x PDS_PLC_ROTATION_KEY=x docker compose
   build api web`.
3. `scripts/publish-lexicons.mjs` — the published lexicons owe `layout`-era drift already and now
   these changes; run it.
4. Recording: CHANGELOG section; finalize ADR-0019 (Status → Accepted, consequences filled from
   what was actually built); update the `leksis` + `leksis-evolution` skills (axes/layout removal,
   selector semantics, new shapes) and `docs/design/grammatical-tagging.md` /
   `paradigm-rules.md` pointers.
5. Version: bump every `package.json` (+ lockfile) to **0.28.0** (root, apps/api, apps/web,
   packages/*). Note tags (v0.27.3) and package versions (0.26.0) have drifted; this slice aligns
   them at 0.28.0.
6. Propose commit, then propose `git tag v0.28.0` (hard stop — the tag deploys to production).

---

## 6. Deliberately open — do not answer by guessing

- Whether the storage enum value `combination` in `labels.kind` is renamed `category` (cosmetic;
  decide in slice 2 by whichever costs less).
- Whether the otherForms picker should also offer feature values used by a matching paradigm's
  cells (§4.4 "when cheap") — build the bound-values version first, judge in the browser.
- Grid-editor ergonomics (how merges are drawn/undone) — decide in slice 5 with the UI in hand.
- Whether `Cell.kind: "empty"` earns its place or an empty title cell suffices — decide when the
  first real table is drawn in slice 5.
