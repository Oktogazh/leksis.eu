# 0008 — The grammar layer, layer 3: value-ordered axes, and labels single-sourced from the language

- **Status:** Accepted
- **Date:** 2026-08-03
- **Deciders:** Alan (with Claude)
- **Builds on:** ADR-0006 (layer 1: tags, bindings, the annotation-site split),
  ADR-0007 (layer 2: inherence and named combinations)
- **Amends:** ADR-0004 (abbreviations read model) — see "Amendments" below
- **Supersedes:** `docs/design/grammatical-tagging.md` for layer 3 only, and
  **reverses** part of its invariant 3; that note remains the design source for
  layers 4–6

> **Superseded on one point by ADR-0015** (2026-08-14): this layer's issue kinds
> (`inherent-axis-conflict`, `empty-axis`) are refused at ingest rather than
> indexed and flagged, and the "zero API cost" claim survives in a stronger form —
> the check now runs *before* the first database round trip, so a refused record
> costs less than an accepted one.

## Context

Layer 2 let a language say what a headword *is*. It could not say what that
word's **forms** vary over, so `otherForms` stayed a flat list of free labels
typed by hand — the last place in the system where a reader-facing string lived
on an entry record rather than on the language that owns it.

Two things follow from closing that gap, and this ADR takes both in one break
because pre-1.0 a break costs one bot republish and two breaks cost two.

**The axes themselves.** Together with layer 2's inherence, they are the
paradigm's cell-coordinate system: layer 2 is its inherent half, layer 3 its
varying half. Layer 4 cannot lay out a table without them, and layer 5 cannot
address a cell.

**The end of the free annotation pair.** The design note's invariant 3 said free
annotation "never disappears" — that most of what a dictionary prints (`bot.`,
`arch.`, `fam.`) has no UD equivalent and stays a free `{long, short}` pair
forever. That reasoning was sound about *vocabulary* and wrong about *storage*.
A label written on an entry is a label the language cannot govern: it is
invisible to the abbreviations worklist, it cannot be corrected once, and two
entries can spell the same concept differently with nothing to notice. The
decision is therefore to keep the freedom and move its home — a language may
still mint whatever feature it needs, but the label for it lives on the language
record, bound to a tag, like every other label.

## Decision

### 1. `grammar.axes` — a row names its values, in order

```
axes = [{ category: Tag, feature: string, values: string[] }]
```

"For this category, this feature varies across its forms, over these values, in
this order."

**The values are named rather than inherited from everything the language has
bound**, because a language's inventory and one category's paradigm are not the
same set. A language may distinguish three genders in its adjectives while
splitting the masculine of its nouns in two, personal and non-personal; a
declaration that spanned every bound value could not say that. Naming them also
fixes the **order**, which is what layer 4's table headers will print and what
the flat `otherForms` list is sorted by — the alphabetical order of an
identifier is not a grammatical order, and no grammar prints the accusative
first.

**The row keys exactly as `inherent` does**: a `Tag` category and a **bare**
feature name, matched by name and never by scheme. The design note's §2.2 sketch
had `{feature, scheme?}` and `{value, scheme?}`; ADR-0007 had already settled the
bare-name rule for `inherent`, and following it makes `GrammarAxis` literally
`GrammarInherent` plus an ordered value list. That identical keying is not a
convenience — it is what makes the conflict between the two detectable at all.

**An axis category is checked for bound atoms only, never for layer 2's
grounding.** This is load-bearing: it is what lets a paradigm stop being
rectangular. A language declares Person an axis of `{VERB, VerbForm=Fin}` and
never of `{VERB, VerbForm=Inf}`, so an infinitive has no person cells rather than
empty ones — and that category refines by a value that is itself an axis value,
which grounding would reject. It is also exactly the check `inherent.category`
already gets, so it is one rule, not a new one.

### 2. Two new issue kinds, and the gate rendered from both sides

- **`inherent-axis-conflict`** — a (category, feature) pair declared both
  inherent and an axis. A paradigm cannot be built from a coordinate that is
  also a constant. The apparent counterexample resolves through the keying
  rather than through an exception: `Number` is an axis of `{NOUN}` and inherent
  to `{NOUN, Number=Ptan}`, different categories that never meet.
- **`empty-axis`** — a row declaring that something varies without saying what
  over.

Both are **issues, not shape rejections**, following the `single-item-binding`
precedent: rejecting the record would discard a whole language's declaration
over one row. The lexicon still declares `minLength: 1` on `values`, so the
record-level contract is stricter than the AppView's tolerance — deliberately,
and in the safe direction.

In the editor the conflict is rendered **as navigation from both sides**: the
Axes tab does not offer a feature already inherent to the category, and the
Categories tab does not offer one already an axis of it. The issue kind exists
for records arriving from bots or other clients, not for anything the UI can
produce.

**The no-orphan diff needed no change.** Unbinding a value an axis still uses
surfaces as an introduced `unbound-atom` and the browser refuses the publish —
the payoff of layers 1–2 having put the rule in `grammarIssues` rather than in a
per-layer check.

### 3. The entry lexicon break: no labels on entries at all

Removed: entry-level `annotations`, definition-node `annotations`, and the
`#annotation` def. Changed: `otherForms[].annotation` (a free pair) becomes
`otherForms[].tag` (a `Tag`).

**One tag, not a list**, because the tag is the form's address in the paradigm:
"gen. pl." is one coordinate in two dimensions, so it is one bundle carrying
`Case=Gen` and `Number=Plur`. That is what layer 5 will match a generated cell
against by canonical key, and a list of separate tags could not say which
combination it meant. The field is named `tag` singular for the same reason, and
to match `combinationBinding.tag`.

Where the evicted labels go: **`notes`** (free prose, at the entry and at every
definition node, both untouched) for an editorial remark, or a **minted feature**
bound on the language record for anything a language wants as a real category.
No new mechanism was added for them, and none should be.

### 4. The abbreviations read model becomes single-sourced

ADR-0004 built the model by harvesting pairs from entries; ADR-0006 made it
dual-sourced by adding language bindings. It is now **single-sourced from
bindings**, and the two contributors are asymmetric:

- a **language** contributes the label,
- an **entry** contributes only usage,
- the join is the canonical tag key.

A row therefore sits in one of two states, and both are the point of the model: a
bound label whose count may legitimately be zero because the language declared it
before anyone used it, and **a tag in use that nothing has named yet**, which
carries a count and no label at all. The second *is* the worklist item, and it is
why `long` stays nullable.

Entry docs lose their `abbreviations` array and keep `tags`, now collected at
**all three altitudes** — lexeme (`categories`), sense (a definition node's
`categories`) and **form** (an `otherForms` tag). Form tags are new to the
worklist and belong there: an unnamed `Number=Plur` on a plural is as much a gap
in a language's declaration as an unnamed `NOUN` on a headword.

### 5. Old-shape records: strict at ingest, lenient at render

Asymmetric on purpose.

**The AppView rejects** a record whose `otherForms` carry the old free pair,
because `tag` is now required and missing — the loud failure, where it matters.

**It ignores** the retired `annotations` fields rather than rejecting on them.
Ignoring a field a lexicon no longer defines is how AT Proto records stay
extensible, and refusing the record would be worse for a reader than the label's
absence: the entry would vanish from search entirely until someone republished
it. No compatibility shim was added, and none should be.

**The web parser drops an old-shape form** rather than failing the record, which
is the lenient half of the same break: an already-indexed copy renders without
that form rather than not rendering at all.

### 6. `applicableAxes`, and why the form editor is not a narrowing tree

`axesOf(grammar, category)` matches a category exactly. The entry editor needs
more: an axis declared on `{NOUN}` must reach an entry categorised
`{NOUN, Gender=Fem}`, because that entry *is* a noun. `applicableAxes` walks the
entry's sub-bundles — the same containment the renderer's decomposition uses —
and returns one axis per feature in the language's declaration order. Without it
the feature would appear to work while being broken for almost every real entry.

The form editor offers **one selector per axis**, not the progressive narrowing
layer 2 built. Axes are orthogonal dimensions: a cell address takes one value
from each independently, whereas narrowing exists because each inherent choice
conditions what is offered next. Reusing the walk would have made "gen. pl."
unreachable. The documented degradation is unchanged — no axes declared falls
back to the flat bound-tag picker plus manual entry, so a language whose grammar
nobody has declared can still label a form.

## Amendments

**To ADR-0004 (and to ADR-0006's amendment of it).** Decision 1 is narrowed: the
model no longer harvests annotation pairs from entry records, because entries no
longer carry any. Decision 2's dual sourcing is superseded by single sourcing
(§4 above). Decision 3 — per-pair entry lists stay DB-only, the API serves counts
— stands untouched. The doctrine is unchanged and in fact sharpened: one home for
a language's labels, and "a tagged abbreviation" rather than "a labelled tag".

**To the design note's invariant 3.** "Free annotation never disappears" is
**reversed as to storage** and kept as to vocabulary. A language may still name
anything it likes, including concepts UD has no term for, by minting a feature
and binding it. What it may no longer do is write the label on an entry.

## Consequences

- **One breaking lexicon change**, taken deliberately pre-1.0: bots reset and
  republish. Every entry-shape change of this arc is inside it.
- **Register and domain labels lose their structured home.** `arch.`, `fam.`,
  `bot.` become prose notes unless a language mints a feature for them. This is
  the cost of the decision and it is real; it is accepted because a label the
  language cannot govern was worth less than it looked.
- **The API cost of the layer was again zero** — no new endpoint, no new index,
  as layer 2 predicted. Axis orphan detection needed no API change at all: it
  arrived through `grammarIssues`, which `ingest-language` already stores and the
  dashboard already serves.
- **Layer 4 can now be built.** It has a cell space to lay out, and its fallback
  is exactly "no layout declared → flat list", which is today's behaviour.
- **The gate/mirror pattern held for a third layer.** Expect one of each per
  layer, both in the shared validator, both rendered as navigation.
- **Verification was deliberately non-browser.** Types and draft logic were
  exercised by direct checks (30 + 22 + 8 assertions), the AppView against a
  throwaway ArangoDB with real ingest, and the web app by a clean build. No
  surface was driven in a browser and no record was published to a PDS.

## Action items

1. ~~`grammar.axes` in `packages/types` and the language lexicon; the two issue
   kinds; `applicableAxes`~~ (done)
2. ~~The entry-lexicon break; the AppView's single-sourced read model;
   `db:init`~~ (done)
3. ~~The binding editor's Axes tab; the entry editor's form-tag editor; the
   viewers~~ (done)
4. **A full browser pass on the live URL** — the Axes tab, an entry authored
   with a form tag, and both viewers. Deferred to its own session by decision.
5. **Reset and republish the ingestion bots** against the new entry shape.
6. Carry forward from ADR-0007: local dev OAuth still fails on a deep-link first
   load (`buildLoopbackClientId` embeds the path).
