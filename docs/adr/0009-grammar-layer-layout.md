# 0009 — The grammar layer, layer 4: the shape of the tables

- **Status:** Accepted
- **Date:** 2026-08-03
- **Deciders:** Alan (with Claude)
- **Builds on:** ADR-0006 (layer 1: tags, bindings, the annotation-site split),
  ADR-0007 (layer 2: inherence and named combinations), ADR-0008 (layer 3:
  value-ordered axes)
- **Supersedes:** `docs/design/grammatical-tagging.md` for layer 4 only — in
  particular its "the `layout` sub-object's inner shape" open question, which
  this ADR closes. That note remains the design source for layers 5–6

> **Superseded on one point by ADR-0015** (2026-08-14): this layer's five
> `layout-*` issue kinds no longer reach a dashboard worklist — a record carrying
> one is refused at ingest. The kinds and the resolver's skip-don't-break
> behaviour are untouched: a layout read from a PDS may still be defective, since
> a language record's rkey is its tag and the content behind an indexed pointer
> can be rewritten under it.

## Context

Layer 3 gave a category its **cell space**: which features vary across its
forms, over which values, in which order. It could not say what the table looks
like, and **axes alone underdetermine presentation** — four axes could be one
grid with nested headers or four separate tables, and nothing in a list of axes
distinguishes those. A Latin conjugation is not one grid at all: it is a table
per mood and tense, plus a handful of forms (infinitive, gerund, supine) that no
cell of the finite grid reaches.

The note left the inner shape deliberately undesigned "until a real conjugation
table has been drawn by hand", and warned that layer 3 had proved paradigms may
be non-rectangular, so a dense grid is not a safe default. This ADR records the
shape that came out of drawing them.

Layer 4 is **additive**: no entry-lexicon change, no bot republish. Every
entry-shape break of this arc was taken at layer 3.

## Decision

### 1. `grammar.layout` — axis-mapped blocks, with the cells derived

```
layout = [{ category: Tag, blocks: LayoutBlock[] }]

LayoutBlock = { kind: "table", fixed?: LayoutCoord[], summary?: boolean,
                rows?: string[], columns?: string[], exclude?: LayoutCell[] }
            | { kind: "list",  fixed?: LayoutCoord[], summary?: boolean,
                items: LayoutCell[] }

LayoutCoord = { feature: string, value: string }     // bare, no scheme
LayoutCell  = { coords: LayoutCoord[] }
```

**The cells are not stored.** A table names axis *features* per dimension and
the cartesian product of their declared values **is** its cell set. A stored
matrix would be a second copy of layer 3's value lists, free to drift from them,
and a Latin verb would carry hundreds of rows in a record that is rewritten
whole on every edit.

**Non-rectangularity is expressed three composable ways**, which is why a dense
grid is not the default and why no cell list was needed:

1. **several blocks** with different `fixed` constants — one table per mood and
   tense, the way a grammar prints them;
2. **`exclude`** for holes inside one grid;
3. a **list block** for what no grid reaches at all.

`rows`/`columns` hold feature names **outermost first**: nesting is what makes a
header span, and a paradigm's dimensions are not always two (a possessive
declension nests possessor number under possessor person). Either may be absent —
one axis on `rows` alone is a one-column table, an ordinary way to print a
fifteen-case declension.

**A `LayoutCell` wraps its coordinates in an object** rather than being a bare
`LayoutCoord[]`, because AT Proto lexicons do not take arrays of arrays. The
shape follows the lexicon rather than the other way round.

### 2. `summary` is a flag per block, not a list of indices on the layout

The design sketch had the layout naming which blocks to show by index. A flag on
the block is **reorder-safe**: renumbering indices on every move is a bug waiting
to happen, and an out-of-range index would be a defect a flag cannot have.

With **no block marked, every block is shown**. A language that has said nothing
about summarising is not asking for anything to be hidden; a Latin dictionary
that prints "rosa, rosae" and leaves the rest to the reader marks the list block
and gets the grid behind an expander.

### 3. Coordinates are bare and **re-qualified before use**

A coordinate carries no `scheme` and no label, exactly as an axis names its
values bare: a layout is a *selection* from what the language declared, never a
second place to declare it.

That makes one step load-bearing rather than cosmetic. `coordTag` resolves each
coordinate to the `values` row that bound it and **puts that row's scheme back**
before anything is displayed or matched. Without it a Breton `Number=Sgv` cell
would key as `ud:Number=Sgv` while a form authored through the language's own
picker carries `br:Number=Sgv` — no label found, no form placed, and minted
vocabulary silently broken in exactly the languages this project exists for.

Conversely the **join is scheme-blind**: `featsMatchKey` drops provenance and
ignores the part of speech, because a bot writes `Number=Sgv` with no scheme
where the editor writes it with one, and a form tagged `NOUN|Case=Gen` carries a
part of speech no cell address does. Neither difference means a different form.

### 4. Placement: exact, then containment, and nothing is ever dropped

`placeForms` matches a form's tag to a cell address **exactly** first, then by
**containment** — a form carrying *more* than the address (the entry's inherent
gender repeated on it, a part of speech a bot wrote in) is still that cell's
form, and the most specific containing cell claims it.

A form carrying **less** matches nothing: a table of case and number cannot know
which number a form tagged only for case belongs to, and guessing would put a
word in a reader's mouth. Such a form, and any form addressing no declared cell,
becomes a **leftover** printed below the blocks — the safe failure layer 5 will
lean on when a generated cell and a hand-entered form disagree.

### 5. Exclusions remove by containment, and empty lines are dropped

An `exclude` entry naming **fewer** coordinates than a cell removes every cell
containing it, so a defective plural is one row rather than one per cell. A line
or column left **entirely** excluded is dropped and the headers above it
re-span — printing six blank rows would say nothing.

Two states must therefore look different to a reader, and do: a cell the
language says **cannot exist** (an em dash, "no such form in this language") and
a cell **nobody has filled in** (a faint dot, "not entered yet"). Collapsing
them would make the whole point of `exclude` invisible.

The designer needs the opposite of the renderer here, and gets it from the same
rule: it resolves a block with its exclusions **set aside** so an excluded cell
stays visible and clickable, then asks the exported `excludesCell` which cells
those are. Excluding a cell any other way would be a one-way door.

### 6. Five new issue kinds, and one defect reported once

`layout-unknown-axis` (a dimension naming a feature the category declares no
axis of — layer 4's own gate), `layout-repeated-axis` (one feature on both
dimensions, which would need two of its values in one address),
`layout-foreign-coordinate` (an `exclude` coordinate outside the block's grid —
the exclusion that silently removes nothing), `empty-layout-block`, and
`layout-too-large`. `unbound-atom` and `duplicate` are **reused** where the
repair is identical, rather than minted again per layer.

Issues are keyed `layout#<tagKey>` and, for a block, `layout#<tagKey>[i]`: two
tables of one layout may differ only in a pinned value, and a worklist has to
point at one of them. Following the layer-2 precedent, **a layout whose category
is unbound is not inspected further** — every dimension would be reported
"unknown" on top of the one defect that needs fixing.

An `exclude` coordinate is required to name a coordinate of the grid, while
`fixed` and a list's items are required only to be **bound**. The asymmetry is
deliberate: pinning a constant outside the coordinate system is a legitimate
thing for a table to do, whereas an exclusion outside the grid can only ever be a
no-op, and a silent no-op is what an issue is for.

### 7. `MAX_LAYOUT_CELLS = 4096`, counted before anything is built

A Latin tense table is a dozen cells and a Hungarian possessive declension a few
hundred, so the cap only catches a mistyped declaration — but it catches it
before the product is materialised, and loudly on the dashboard rather than
silently in a reader's browser.

### 8. Inflection classes get a door, not a mechanism

A third root section in the primitives tab, **Inflection classes**, beside Parts
of speech and Features. It is the same machinery — one name, one label, several
values — with one difference: **nothing is fetched from UD**, because UD defines
no paradigm object, so a class and every one of its members is necessarily the
language's own declaration.

**No storage change.** Rows land in `grammar.features`/`values` as before, which
is ADR-0006's "inflection classes are minted primitives and nothing more" taken
at its word: the section is a *view* over minted features, and the entry editor
already offers a class through layer 2 without knowing the section exists. The
mint box is pre-ticked there and for **any value of an already-minted feature** —
not for convenience but for correctness, since UD cannot document a value of a
feature it does not define.

The accepted cost: a feature minted for something that is *not* a class (a
register, say) also appears under Inflection classes. Both sections edit the same
rows, so the price is a row in two places rather than a fact with two homes.

### 9. Hydration: the viewer resolves the language record from its PDS

Opening an entry now fetches the language's current record — pointer from the
AppView, body from the author's PDS — cached per tag for the session and
invalidated when the reader publishes a new grammar.

This is not a contradiction of ADR-0007's "viewers never pay the PDS round
trip". That rule was about **labels**, which still come from the indexed
`abbreviations` model. A layout is **content**, and content has always been
PDS-resolved; the entry's own definitions arrive the same way. One fetch per
language per page view, cached, buys the whole layer without an endpoint, an
index, or a line of AppView code. If it ever stops being cheap, the escape hatch
is to index `grammar` into a read model — a decision of its own.

The fetch **never rejects**: every failure degrades to the flat list, so an
unreachable PDS costs a reader the grid, not the entry.

### 10. A block no form fills is not drawn

With no rules behind the layout yet, an empty grid is a promise the entry cannot
keep. Revisit at layer 5, where generation fills what nobody entered — that is
exactly when an empty table stops being empty.

## Consequences

- **Additive.** No entry-lexicon change, no bot republish; a language that
  declares no layout behaves exactly as before, which is the fallback this layer
  was required not to break.
- **The API cost was zero for the third layer running** — no endpoint, no index,
  no ingest change, verified against a throwaway ArangoDB with real ingest. The
  new issue kinds reached the dashboard through `grammarIssues`, which
  `ingest-language` already stores.
- **The designer and the reader draw from one function.** `resolveLayout` +
  `placeForms` are in `packages/types`; a shared `ParadigmTable` draws the
  nested headers for both. Invariant 6 ("one generator, shared") now has its
  first real consumer, and the exporters at layer 6 inherit it.
- **`layoutFor` matches by containment, most specific first** — and inherits
  `applicableAxes`'s limitation: an entry that spells "n. f." as **two chips**
  holds `{NOUN}` and `{Gender=Fem}` but not the combination, so a layout declared
  on `{NOUN, Gender=Fem}` does not apply to it and it degrades to the `{NOUN}`
  layout. Breton is precisely a language that binds `n.` and `f.` separately, so
  this will be met in practice. Changing it would change layer 3's shipped
  semantics for every consumer at once; recorded here rather than fixed in
  passing.
- **Layer 5 can now be built.** It has a laid-out cell space to fill, addresses
  to key rules on (`LayoutAddress.tag`), a placement that already overrides
  generated cells with hand-entered forms, and a leftover list for the forms that
  match nothing.
- **The gate/mirror pattern held for a fourth layer** — expect one of each per
  layer, both in the shared validator, both rendered as navigation.
- **Verification was again deliberately non-browser, and this time the debt is
  written down.** Types and draft logic were exercised by direct assertions
  (102 + 44 + 13 + 30), the AppView against a throwaway ArangoDB with real
  ingest, the web app by a clean build. No surface was driven in a browser,
  because the editors sit behind a session that needs an account nobody has yet:
  the authoring flows are listed as **U-01…U-24 in `leksis-testset` §7**, with
  the fixture rows (L-37…L-41, L-50…L-59, E-27…E-29) that will assert the
  reader's side.

## Action items

1. ~~`grammar.layout` in `packages/types` and the language lexicon; the five
   issue kinds; `resolveLayout`, `placeForms`, `layoutView`, `flatFormOrder`~~ (done)
2. ~~Confirm the AppView needs no change — real ingest, dashboard, abbreviations~~ (done)
3. ~~The Inflection classes section; the Layout tab; the entry viewer~~ (done)
4. **Publish the updated `eu.leksis.language` lexicon** (`scripts/publish-lexicons.mjs`)
   — the record shape is live in the app but the published lexicon is not yet updated.
5. **A browser pass with a test account** — `leksis-testset` §7 (U-01…U-24),
   including ADR-0008's still-owed pass carried forward there.
6. **Fixtures for the layer** — the new coverage rows, which are what will assert
   the reader's paradigm rather than the arithmetic behind it.
7. Carried forward from ADR-0007: local dev OAuth fails on a deep-link first
   load (`resolveClientId` passes `window.location`, which embeds the path).
   Now known to block the browser pass above, so it is a prerequisite rather
   than an annoyance.
