# Design note: the Leksis grammar layer

**Status:** **Layers 1, 2 and 3 are implemented and superseded by ADR-0006, ADR-0007 and ADR-0008** — for
anything they cover, the ADRs and the code are authoritative and this note is history. Layers 4–6 are
designed, not implemented, and this note remains their source.
**Date:** 2026-07-30; rewritten 2026-08-01 around the layer model; layers renumbered 2026-08-01 (old layer 3
merged into 1 + 2); layer 1 reconciled with what shipped 2026-08-02; layer 2 reconciled 2026-08-02; layer 3
reconciled 2026-08-03.
**For:** The morphology arc (`leksis-evolution` skill). **The next build is layer 5 — planned in
`docs/design/paradigm-rules.md`, which is authoritative over this note for that layer.**
**Related:** **ADR-0006 (layer 1, accepted)**, **ADR-0007 (layer 2, accepted)**,
**ADR-0008 (layer 3 + the label inversion, accepted)**,
`lexicons/eu.leksis.entry.json`, `lexicons/eu.leksis.language.json`, `lexicons/eu.leksis.defs.json`,
ADR-0004 (the labels read model, amended by 0006 and re-keyed by 0010), ADR-0002 (the browser is the write path)

> **How to read this.** §0 is binding on every session. §1 is what has been **verified at source** — treat
> anything absent from it as unknown, and §6 as the list of things nobody has checked. §§2–4 are the design.
> Decisions are referred to **by name**, not by number, so references survive edits.
>
> **Where this note and the shipped layers 1–3 differ, the code wins** and the difference is marked
> `[shipped]` inline. Two decisions changed during the layer-1 build and are recorded in ADR-0006: the XOR
> rule became a strict per-site type split (§2.3), and `grammar`'s shape became three arrays with a
> `values` row naming its feature (§2.2). Two more changed at layer 2 and are recorded in ADR-0007:
> `inherent` rows are singular `(category, feature)` with a bare feature name, and the `Tag` shape moved to
> a shared `eu.leksis.defs` lexicon. **Two more changed at layer 3 and are recorded in ADR-0008: an `axes`
> row names its values in order and keys on a bare feature name; and invariant 3's "free annotation never
> disappears" is REVERSED as to storage — the free pair is gone from the entry record, so §2.3's
> `annotations` column and §5's second bullet are history.**

---

## 0. Governing rules

**Follow UD, and only UD.** Where another schema disagrees, UD wins by default and **the disagreement is
not adjudicated** — it is not a design input. Do not import UniMorph's decompositions, POS inventory or
feature algebra "because it is more expressive". When UD is awkward for a language, the escape hatch is a
**language-declared tag**, never a UniMorph-shaped one. *What UniMorph is still for:* an **export target at
layer 6**, nothing else — its bundles are `;`-joined bare atoms whose dimension is implicit and whose atoms
are not globally unique, so they cannot safely ride on a record other AppViews read. Apertium and Hunspell
are unaffected: they supply the paradigm architecture and generation model, which UD does not define at all,
and are not competing tagsets. The rule is provisional; revisiting it is a decision to be recorded, not
something a session may do implicitly.

**UD supplies the vocabulary; Leksis defines its lexicographic use.** UD is the base because its ecosystem
is mature, not because Leksis is a treebank — and the two annotate different objects (§1.1). A language may
bind a UD item and use it in a way a UD treebank would not; the binding's homolingual label is what tells a
reader what it means *here*. This is the semantics of use, not the import of another schema, so the rule
above is untouched. **Its cost must be declared, not discovered:** layer 6's CoNLL-U carries FEATS that look
interoperable but are lexicographic. A deterministic UD→UniMorph mapping reaches only ~64% recall even
between the two published schemas, so lossy export is normal — lossy *by declaration* is acceptable, lossy
by accident is not.

**Never invent a tag name, feature name or value.** Anything written into a lexicon, a type or the UI must
be traceable to a published inventory **or** explicitly minted as a language-declared tag. If you cannot
cite it and it is not language-declared, you do not know it.

**Verify at the source; do not trust this file's summary and do not trust model recall.** Tagset details are
exactly what an LLM reproduces confidently and wrongly. **An explicit "I don't know yet" is a valid
deliverable** and beats a confident wrong vocabulary. Pre-1.0 a wrong shape costs a bot republish; from 1.0
it is permanent.

**Tags are machine data; labels are homolingual display, and the two never coexist on one item.** A tag is
an identifier, not reader-facing text, so it rides on the entry record while the **language record carries
the binding `tag → {long, short}`**. Never render a raw tag as prose; never store an English label inside an
entry.

**Design for the language that has nothing.** A low-resource language usually has no UD treebank, so no
documented feature set exists for it at all. That is not a gap in Leksis — it is Leksis's job: the language
record is where that language's tagset gets *declared*. Never design a flow that assumes a published tagset
already exists.

---

## 1. What UD is — verified at source

### 1.1 UD annotates a token in a sentence; Leksis annotates a lexeme in a dictionary

UPOS is a **token-level** tagset being used here as a **lexeme-level** classification. That mismatch is real
and bites in three places: **AUX** (Breton *bezañ* is a VERB lemma that *functions* as an auxiliary — let
each language decide whether it binds AUX at all), **PROPN**, and participles (settled: `VerbForm=` on a
VERB, not separate parts of speech, which also keeps them inside the verb's paradigm instead of scattered
across headwords).

### 1.2 UPOS — exactly 17, in three groups

*Open:* ADJ ADV INTJ NOUN PROPN VERB · *Closed:* ADP AUX CCONJ DET **NUM** PART PRON SCONJ ·
*Other:* PUNCT SYM X.

UPOS is its **own CoNLL-U column**, not a feature — never mint `UPOS` as a pseudo-feature name. The page
states **no extension policy either way**; an earlier draft claimed "extension is not offered", which was
stronger than the source. The **14 headword-eligible** tags are 17 minus PUNCT/SYM/X — **a Leksis editorial
judgement, not UD's.** ART is not really missing: it routes to `DET` + `PronType=Art`. COMP routes to SCONJ.

### 1.3 FEATS — the vocabulary and the storage grammar

`Feature=Value`, `|`-separated, **features sorted alphabetically**; multivalue values also sorted
alphabetically (`Case=Acc,Dat`, `Gender=Fem,Masc`); layered names `Number[psor]` matching
`[A-Z][A-Za-z0-9]*(\[[a-z0-9]+\])?`; `_` means none.

Two rules re-fetched during the layer-1 build that this section had not recorded, both load-bearing:
**feature *values* match `[A-Z0-9][A-Za-z0-9]*`** — so a value may begin with a digit, which means a minted
`Conjugation=1` is well-formed UD and needs no workaround — and the sort is **case-insensitive**
("uppercase letters are considered identical to their lowercase counterparts"), which the canonical key
follows, with an exact comparison behind it so the ordering stays total. `_` is excluded by the value
pattern, so it is never a value.

Groups: *lexical* (PronType, NumType, Poss, Reflex, Foreign) · *inflectional* (Gender, VerbForm, Animacy,
Mood, NounClass, Tense, Number, Aspect, Case, Voice) · *other* (Abbr, Definite, Evident, Typo, Deixis,
Polarity, DeixisRef, Person, ExtPos, Degree, Polite, Clusivity).

**The extension licence, verbatim:** "UD treebanks may use additional features and values if they are
properly documented." This one sentence is what makes language-declared tags UD-compatible rather than a
divergence.

### 1.4 Three tiers of UD-documented vocabulary

1. **Universal** features, on the features index.
2. **Non-universal with a global description page** — `Subcat` (transitivity) is the known case. Absent from
   the index, but published, therefore citable.
3. **Language-specific**, documented in treebank docs — `Gender[psor]` in UD_Breton-KEB.

**`scheme: "ud"` therefore means "documented anywhere on universaldependencies.org", not "in the universal
set".** Reading it narrowly causes a real failure: a session mints a Breton `Transitivity` when `Subcat=Tran`
was already citable. Only tier 3 needs minting.

### 1.5 Verified inventories

| Feature | Values | Note |
|---|---|---|
| `Number` | Coll Count Dual Grpa Grpl Inv Pauc Plur Ptan Sing Tri | **No singulative.** `Coll` is "a special case of singular", so it covers only the collective half of a Breton-style pair. |
| `VerbForm` | Conv Fin Gdv Ger Inf Part Sup Vnoun | Load-bearing: participles, converbs and verbal nouns route through it. |
| `PronType` | Art Dem Emp Exc Ind Int Neg Prs Rcp Rel Tot | `Art` is how UPOS's missing ART is expressed, on `DET`. |
| `Animacy` | Anim **Hum** Inan Nhum | `Hum` answers "noun denoting a male person" with **no minting**: `{NOUN, Gender=Masc, Animacy=Hum}`. |
| `Aspect` | Hab Imp Iter Perf Prog Prosp | Whether `Perf` means *perfective* or *perfect* does not bind Leksis — see §0. |
| `Gender`, `Case`, `NounClass` | fetched 2026-07-30 | `NounClass` values are **family-specific** (`Bantu1`–`Bantu23`, `Wol1`–`Wol12`) and UD says comparable systems should be developed for other families — **the citation proving that a language declaring its own inventory is UD working as designed.** |

**Altitude is a property of (category × feature), not of a feature** — and UD says so itself. The `Animacy`
page: animacy is "usually a lexical feature of nouns and inflectional feature of other parts of speech". The
`Aspect` page: lexical in Czech and the Slavic languages, inflectional where bound morphemes mark it as in
Turkish. So there is **no global list of inherent features to hardcode**; the language declares it, and §3's
layers 2 and 3 are the two halves of that declaration.

**Neither UD nor UniMorph defines a paradigm object.** UD has no lexeme; UniMorph ships enumerated triples
with no notion of which cells exist. The prior art is Apertium's monodix: `<pardef n="beer__n">` declared
once, entry `<e lm="beer"><i>beer</i><par n="beer__n"/></e>` — stem plus paradigm pointer. Hunspell
`.aff`/`.dic` supplies the generation model (affix rules + per-word flags), and its rules are **not cheaply
invertible** — which is why inflected-form search wants ingest-time expansion.

**Other verified facts.** The AT Proto record ceiling is ~1 MiB (`MAX_CBOR_RECORD_SIZE`), with
`subscribeRepos` commit blocks capped at 2 MB. A full grammar object is ~30 KB, so **size is not a constraint
on this arc and will not become one**; the real pressure is firehose churn, since every edit republishes the
whole record. And `universaldependencies.org` sends `access-control-allow-origin: *` (GitHub Pages), so the
browser may fetch it directly.

---

## 2. The shape

### 2.1 A tag is a bundle, and provenance rides on each item

```
Tag = { upos?: { value, scheme? },
        feats?: [{ feature, value, scheme? }] }        // scheme omitted = "ud"
```

At least one of `upos`/`feats` must be present. **`scheme` is per item, not per bundle:** a bundle-level
scheme cannot describe `{NOUN (ud), Number=Sgv (br)}`, which is the normal shape of a minted category, and
marking the whole bundle `br` would break decomposition against `ud`-scheme bindings, leave the exporter
unable to tell which halves are exportable, and silently relate unrelated languages.

**One bundle = one displayed chip.** Languages abbreviate at different granularities: French `nf.` is *one*
label for NOUN + Gender=Fem where Breton uses two (`n.`, `f.`).

**Bundle equality is computed on a canonicalised key** — feats sorted by feature name, multivalue values
sorted alphabetically, `upos` in its own slot, scheme included — or matching silently fails on ordering.

### 2.2 The language record

```
eu.leksis.language.grammar = {
  // ---- layer 1, AS SHIPPED (ADR-0006) ----
  pos:      [ { value, scheme?, label: {long, short?}, references?: [{text, url}] } ],
  features: [ { feature, scheme?, label: {long, short?}, references?: [{text, url}], note? } ],
  values:   [ { feature, value, scheme?, label: {long, short?}, references?: [{text, url}], note? } ],
  //          `note` = free homolingual PROSE about what the item covers (§4.6). Feature and value
  //          only — a part of speech explains itself and a combination's meaning is its parts'.

  // ---- layer 2, AS SHIPPED (ADR-0007) ----
  inherent: [ { category: Tag, feature: string } ],                                // L2 — one row per (category, feature)
  bindings: [ { tag: Tag, label: {long, short?}, references?: [{text, url}] } ],   // L2 — labelled COMBINATIONS (≥2 items)

  // ---- layer 3, AS SHIPPED (ADR-0008) ----
  axes:     [ { category: Tag, feature: string, values: string[] } ],              // L3 — what varies, over what, in order

  // ---- layer 4, AS SHIPPED (ADR-0009) ----
  layout:   [ { category: Tag, blocks: [ Block ] } ]                               // L4 — the shape of the tables
}

// Block = { kind: "table", fixed?: [Coord], summary?: bool, rows?: [name], columns?: [name], exclude?: [Cell] }
//       | { kind: "list",  fixed?: [Coord], summary?: bool, items: [Cell] }
// Coord = { feature, value }   (bare — no scheme, re-qualified from the `values` row before use)
// Cell  = { coords: [Coord] }  (an object because a lexicon takes no array of arrays)
```

`[shipped]` **Layer 1 authors `pos` + `features` + `values`; `bindings` is layer 2's, and holds
combinations only.** An earlier draft of this section put layer-1 atoms in `bindings` alongside layer-2
combinations and listed `values` beside it, which made `bindings` span two layers and left a bare `{NOUN}`
binding and a `pos`-style declaration as the same fact with no rule saying which to write.

The reason `values` is not folded into bundles: a `values` row states **which feature the value is an
option of**, which is a declaration a bundle cannot make. It is what turns "list this language's genders"
into a lookup rather than a scan over every bound bundle — and the feature name is also the gate the value
sits behind. A `features` row is likewise not a tag: a bare name has no value.

`[shipped]` **Layer 2's rows landed additively**, as predicted — no entry change and no republish. The
`bindings` ≥2-items rule ships as a `single-item-binding` *issue* rather than a shape rejection: the row is
well-formed and merely says something true in the wrong place, and rejecting would discard a whole
language's declaration over it. `inherent` rows carry no label, so they never enter the labels model;
`bindings` rows do, through `grammarRows`, with no plumbing of their own.

One **self-contained `grammar` sub-object** holding layers 0–4. Layer 5's rules get their own
`eu.leksis.paradigm` lexicon: they are large, per-class, and written at a different cadence.

Note what is **absent by design**: no `appliesTo`, and no `enumerated` flag. Both were bespoke fields on the
old inflection-class layer, and `inherent` now does that work generically (§3, layer 2).

**Store sparse, display complete.** The record holds only *authored* rows. The closed 17-item UPOS inventory
is a constant in `packages/types`; the dashboard left-joins it to present a complete worklist ("4 of 14
bound"). A stored skeleton of empty rows carries no facts, makes "complete" a stored state that goes stale
when UD moves, and invites writing UD's English names in as placeholders. Absence already means unbound,
which is what the rendering fallback depends on. **One representation, not two.**

Corollary: embed **UPOS** (closed, stable since UD v2); do **not** embed the FEATS value inventories (27
features, hundreds of values, released twice a year). A harvested FEATS inventory may exist as dated
reference data feeding suggestions, but **never as a validator** — the AppView must not reject a tag for
being absent from a snapshot.

### 2.3 The four annotation sites

`[shipped]` **Each site holds exactly one type, and the entry and the definition node carry the same three
fields.** This *replaces* the XOR rule below.

| Field | entry | definition node (leaf and group) |
|---|---|---|
| `categories` | tags only | tags only |
| `notes` | free prose | free prose |

`[shipped, ADR-0008]` **The `annotations` row is gone from this table.** Layer 3 removed the free pair from
both sites and converted `otherForms[].annotation` into `otherForms[].tag` — a single `Tag`, because a
form's label is its address in the paradigm. Two predictions in the sentence this replaces proved wrong:
that layer 3 would *add* a tag field beside the pair, and that a pair had to survive for a language with no
declaration. What keeps such a language authorable is the form editor's flat picker and manual tag entry,
not a second storage shape. An evicted editorial label goes to `notes`, or becomes a minted feature bound
on the language record.

> **Superseded — the XOR rule.** The original design let one item be *either* a free pair *or* a tag, to be
> encoded as a lexicon `union`. Splitting by field instead makes the illegal state unrepresentable with no
> union at all, which is why §6's "confirm `union` validates for local object refs" is struck: the question
> is moot, not answered. The *reasoning* survives unchanged and is what both designs protect — two sources
> of truth for one displayed string can only drift, and the language-level one has to win.

**Still open, and untouched by the split:** whether the entry-level site should also accept a *tag*.
Recorded as free-pairs-only, which leaves a whole-entry non-grammatical tag with no home.

**`categories` is tag-only, and the friction is deliberate.** Non-grammatical headword labels (`vulg.`,
`arch.`, `fam.`) are not categories: they go to the entry-level site. The reasoning is a **forcing
function** — requiring a tag makes a contributor settle the language's grammar declaration *before*
authoring entries, so entries come out consistent across the system. Authoring convenience is deliberately
not what is being optimised. Two corollaries: do **not** mint `Register=Vulg` to smuggle a register label
into the headword line, and do **not** relax `categories` to XOR later on the grounds that contributors find
it hard — the difficulty is the mechanism working.

**Sense-level tagging is why the definition node gets its own `categories`.** A verb is `VERB` at the entry
level and transitive on one sense group, intransitive on another — which is what the tree-shaped definitions
of v0.8 were built to express. Declaring a feature inherent at layer 2 does **not** restrict its use at a
definition node: a dictionary may legitimately print `v.t.` in the headword line *and* split senses by
transitivity. Do not build a cross-check that forbids it.

`[shipped]` The **shape** ships and the viewer renders it; the *editor* for sense-level tags is deferred to
the first contributor who wants one.

**`categories` order belongs to the entry author** (order-as-phrasing); `otherForms` order belongs to the
language (order-as-table-geometry — it is the one-dimensional degenerate case of layer 4's layout).

### 2.4 Rendering precedence: exact → decomposition → verbatim

This ordering is *how the viewer chooses* between valid renderings, not merely a fallback chain.

1. **Exact bundle match.** French, having bound `{NOUN, Gender=Fem}` → `nf.`, shows **`nf.`**
2. **Decomposition.** No exact match, but the parts are bound → render the parts **in the bundle's own
   order**. A language that bound `{NOUN}` → `n.` and `{Gender=Fem}` → `f.` but never the pair shows
   **`n. f.`** — never a synthesised `nf.` nobody authored. Decomposition is **greedy** (largest bound
   sub-bundles first), so `{NOUN, Gender=Fem, Number=Plur}` in a language that bound `nf.` and `pl.` renders
   `nf. pl.`. **Partial decomposition still beats a raw tag:** bound parts render as labels and only the
   unbound remainder falls to rule 3.
3. **Verbatim tag**, visibly styled as unbound. It must **not** be UD's English documentation name, which
   would look like content and breach the homolingual rule. An untranslated identifier reads as "this needs
   binding", which is the wanted signal and the affordance that opens the binding flow. Bots typically know
   the UD tag before any abbreviation exists, so this is the common path, not an edge case.

---

## 3. The layers

Each layer draws its options from the layer below, and each must ship and be useful alone.

> **The cascade is the core mechanism.** In layer 1 a language binds only the tags it uses; `Gender=Neut`
> left unbound in French means neuter never appears as an option in layers 2–5. **Binding is therefore not
> merely labelling — it is how a language declares its inventory**, which is what makes the flow work for a
> language with no published tagset. A language's inventory is exactly what it has bound; "considered and
> rejected" and "not got to it yet" look identical, and the dashboard worklist makes that harmless.
>
> **The cascade governs authoring, never rendering.** A tag arriving unbound from a bot or another AppView
> still renders (§2.4 rule 3). A viewer that *rejected* unbound tags would make the AppView the arbiter of a
> language's grammar.

| Layer | Declares | Home |
|---|---|---|
| **0 Abbreviations** | free homolingual pairs bound to nothing | entry records (shipped v0.8) |
| **1 Primitives** ✅ | the atoms this language uses: 14 UPOS, feature *names*, feature *values*; minting | `grammar.pos/features/values` |
| **2 Inherent combinations** ✅ | which features are **inherent** to a category, and the resulting labelled headword categories | `grammar.inherent`, `grammar.bindings` |
| **3 Axes** ✅ | which features **vary across the forms** of a category, over which values, in order | `grammar.axes` |
| **4 Layout** ✅ | table shape, order, default visibility; `otherForms` list order | `grammar.layout` |
| **5 Rules** | Hunspell-like generation filling cells | `eu.leksis.paradigm` |
| **6 Export** | Hunspell, UniMorph TSV, CoNLL-U, XPOS as derived output | — |

### Layer 1 — Primitives ✅ shipped

> **Implemented; see ADR-0006 for what was actually decided.** Kept here for the reasoning. Three
> deltas from the text below: the arrays are `pos`/`features`/`values` (§2.2); annotation sites split by
> type instead of XOR (§2.3); and §4.2's progressive narrowing was **cut**, because it derives from layer
> 2 — layer 1 ships the flat multi-select this note itself names as its degradation, plus a manual field.

*In:* the `Tag` type and canonical key in `packages/types`; `grammar.bindings` + `grammar.features`; the
`labels` read model widened to carry the tag and to surface **unbound tags in use** as a worklist; the
binding editor; the entry editor's suggestion flow; the viewer's resolution chain.

**Two row kinds, and both are needed:** a feature *value* row is the chip (`Gender=Fem` → `b.`); a feature
*name* row is the axis header layer 4 will print (`Case` → `troad`). **They are gated — a feature name must
be bound before any of its values can be**, and its mirror holds: a name cannot be unbound while a value is
bound.

**Layer 1 binds form-level vocabulary too**, not only headword vocabulary: Tense and Case values are bound
here although they never appear in `categories`. So layer 1 applies **no altitude filter** — altitude is not
a property of a bound item, it *emerges from which higher layer references it* (layer 2 makes it inherent,
layer 3 makes it an axis, a definition-node tag makes it sense-level).

**Minting is in scope on day one and is non-negotiable** (`scheme` = the language's BCP 47 tag), at three
granularities: a new **value** on a UD feature (`Number=Sgv`, since UD's Number has none); a new **feature
name**; and, reluctantly and as a justified exception, a **POS**.

**Inflection classes are minted primitives — nothing more.** A Latin declension or a French conjugation group
is a minted *feature* (`Conjugation`, scheme `fr`) whose *values* (`1`, `2`, `3`) are minted and bound, both
here. There is no separate class mechanism: which category a class applies to is a layer-2 inherence
declaration, and the completeness of its value set is layer 2's enumeration prompt. Since neither UD nor
UniMorph defines a paradigm object, these values are *necessarily* language-declared — the clearest
legitimate minting in the arc, and the reason layer 1 must support minting from the start.

*Also in — the whole entry-lexicon break, done once:* `categories` narrowed to tag-only, the new entry-level
annotation site, and `definition.notes` becoming annotation-XOR-tag. Pre-1.0 one break costs one bot
republish; two breaks cost two. The *editor UI* for sense-level tagging may follow later; the shape must be
right now.

*Out:* inherence, axes, layout, rules, export.

### Layer 2 — Inherent combinations ✅ shipped

> **Implemented; see ADR-0007 for what was actually decided.** Kept here for the reasoning. Three deltas
> from the text below: `inherent` rows are **singular `(category, feature)`**, not a plural `features[]`
> per category (§2.2's sketch), matching this section's own prose and layer 3's `axes`; the `feature` is a
> **bare name with no `scheme`**, matched by name as a value is matched to its feature; and **grounding**
> is the name given here to the gate — a named combination must be reachable by removing one feature at a
> time, each removal licensed by an inherence declaration, down to a bound atom.

Two steps, and the first is the one that was missing: **before any value-combination can be bound, the
language must declare that the feature is inherent to the category at all.**

**This applies to every category, not to nouns.** `NOUN × Gender` is only the running example below; the
mechanism is identical and equally expected for `VERB × Aspect`, `VERB × Subcat`, `VERB × Conjugation`,
`ADJ × Degree`, `PRON × Person`, `ADP × Conjugation` (Breton conjugates its prepositions), `NOUN × Animacy`,
`NOUN × Declension`. There is no privileged category and no per-UPOS special-casing anywhere in the layer:
the row is `(category, feature)` and *both* halves are variables.

1. **Declare inherence:** `{category: <Tag>, feature: <feature>}` — e.g.
   `{category: {upos: {value: "VERB"}}, feature: {feature: "Aspect"}}`, "for verbs, aspect is inherent".
   This is the explicit statement no earlier design had; previously inherence was only *implied* by which
   value-combinations happened to exist, so the system could not distinguish "aspect is inherent to verbs"
   from "somebody bound one aspectual verb category".
2. **Enumerate the combinations:** the editor then prompts for one combination per bound value of that
   feature — `{VERB, Aspect=Perf}`, `{VERB, Aspect=Imp}`, … — each getting its own label. These rows are
   ordinary `grammar.bindings` entries whose tag carries both a `upos` and one or more `feats` items.

**`category` is a `Tag`, so inherence can be declared on a combination, not only on a bare UPOS.** This is
what controls the *depth* of the entry editor's narrowing tree (§4.2). A language that declares
`Declension` inherent to `{NOUN}` offers declension immediately after `n.`; one that declares it inherent to
`{NOUN, Gender=Fem}` offers it only after the gender is chosen. Both are legitimate — the choice is a
lexicographic judgement about which distinctions are prerequisite to which, and it is the language's to make.

**The enumeration is a prompt, not a constraint.** The dashboard shows "VERB × Aspect: 2 of 3 bound values
combined", but an incomplete set is legitimate and must not block a save — a language may bind a value
because *another* category inflects for it while having no headword of this category that takes it (French
binds `Gender=Neut` for nothing at all; a language may bind `Aspect=Prog` for a periphrastic construction
without a perfective/progressive lexeme split). Enforcing completeness would make that unexpressible.

**Note the gate symmetry.** Layer 1 gates value-behind-name; layer 2 gates value-combination-behind-inherence
declaration. It is one rule applied at two levels, which is why both can be rendered as navigation rather
than as validation errors (§4.1).

**Never a whitelist.** A combination nobody enumerated must stay authorable and simply renders by
decomposition, or a missing row blocks a contributor.

*Out:* anything concerning forms.

### Layer 3 — Axes ✅ shipped

> **Implemented; see ADR-0008 for what was actually decided.** Kept here for the reasoning. Three deltas
> from the text below: a row **names its values, in order** (`{category, feature, values[]}`), because a
> language's inventory and one category's paradigm are not the same set and because that order is what
> layer 4 prints; the `feature` is a **bare name** as `inherent`'s is, not a `{feature, scheme?}`; and an
> axis category is checked for **bound atoms only, never grounding**, which is what lets a paradigm be
> non-rectangular (`{VERB, VerbForm=Fin}` takes a Person axis, `{VERB, VerbForm=Inf}` simply never
> declares one). The layer also carried the **entry-lexicon break** that removed free pairs entirely.

Per category, which features **vary across its forms** — the `otherForms` editor's option set, filtered by
the cascade to bound tags only. Together with layer 2 this completes invariant 1's declaration: layer 2 is
its inherent half, layer 3 its axis half, and the pair *is* the paradigm's cell-coordinate system.

**Keyed on a category — a layer-1 atom or a layer-2 combination — not on a UPOS alone:** a Slavic perfective
verb's cell space differs from an imperfective one's, and UPOS-only keying cannot say that.

**A (category, feature) pair should not be both inherent and an axis.** Validate it. The apparent
counterexample resolves through the keying: `Number` is an *axis* for `{NOUN}` and *inherent* for
`{NOUN, Number=Ptan}` — different categories, no conflict.

`otherForms[].annotation` also pluralises to a bundle here — a form's label is "gen. pl." in real
dictionaries. Inflected-form search must keep working unchanged. *Out:* generated forms.

### Layer 4 — Layout ✅ shipped

> **Implemented; see ADR-0009 for what was actually decided.** Kept here for the reasoning. Four deltas from
> the text below: **cells are derived, never stored** — a block names axis *features* per dimension and their
> declared values make the grid, so non-rectangularity is expressed by several blocks with different `fixed`
> constants, plus `exclude` for holes and a list block for what no grid reaches; **what is shown by default**
> is a `summary` **flag per block**, not a list of indices, because reordering blocks would renumber indices;
> a coordinate is **bare and re-qualified from the `values` row before use**, which is what makes minted
> vocabulary match at all; and a form is placed **exact-then-containment**, with anything unplaced kept as a
> **leftover** rather than dropped.

Layer 3 gives the cell space; it does **not** say what the table looks like, and **axes alone underdetermine
presentation** — four axes could be one grid with nested headers or four separate tables. So, per category:
which axis sits on which dimension, one table or several, the order tables appear in, and **what is shown by
default** (a Latin dictionary prints the genitive and expects the reader to derive the rest, so a full table
is not always wanted). It also fixes the display order of the flat `otherForms` list — **not** of category
chips.

**Ships alone and is immediately useful:** with no rules behind it, an entry's own hand-entered forms land in
a proper grid instead of a flat list. The old "no paradigm → flat list" fallback becomes exactly "no layout
declared → flat list". *Out:* generation.

`[shipped]` Two things the build added that this section did not anticipate, both because a reader needs
them. **A cell the language says cannot exist and a cell nobody has filled in must render differently** — an
em dash against a faint dot — or `exclude` does no visible work; a line or column left entirely excluded is
dropped and the headers above it re-span. And **the entry page resolves the language record from its PDS** to
get the layout at all: that is not a breach of "viewers never pay the PDS round trip" (ADR-0007), which was
about *labels* — those still come from the indexed `labels` model — because a layout is **content**,
and content was always PDS-resolved.

### Layer 5 — Rules

**Designed in its own note — `docs/design/paradigm-rules.md` (2026-08-15), which supersedes this
section.** What this section had already settled carries over unchanged and is restated there: the
`eu.leksis.paradigm` lexicon; entry `otherForms` overriding any generated cell by canonical key;
entries storing selectors and exceptions, never generated forms; the rule keying on whatever bundle
its author chooses; one shared generator; syncretism merging; ingest-time index expansion and its
re-expansion cost; the three cell states of §5. *Out:* export formats.

### Layer 6 — Export

Hunspell `.aff`/`.dic`, UniMorph TSV, CoNLL-U FEATS out of the graph: the annotation *becomes* the NLP
resource the white paper promises. XPOS belongs here too — a string *generated* from layers 1–2, never
storage, because XPOS is a single opaque token-level string and collapsing the layers into `Ncmsp` throws
away the structure they exist to create.

### Referential integrity — the cost of the cascade

Unbinding a layer-1 atom orphans every higher row referencing it. Hence one `grammar` sub-object, and two
guards required at layer 1:

- **The no-orphan rule.** Unbinding is refused while any higher layer depends on the row. Note "unbinding" is
  not a delete operation — the whole object is rewritten, so a client cannot check it row by row; the check
  is a pure function over the *whole* object in `packages/types` (`grammarIssues`), shared by every client.
  **Enforced in the browser AND at the AppView, as one rule — ADR-0015 replaced this paragraph's original
  answer.** It used to read "detection only, never rejection": the AppView indexed an orphaned version,
  flagged it, and the dashboard surfaced a **repair worklist**. The reasoning was that rejecting discards a
  version's good content over one bad row, and that an orphan renders safely anyway. Both halves are true
  and neither was the problem: **the editor navigates the cascade, so it has no level that lists a row
  hanging off something unbound** — the worklist named rows nobody could reach, and the interface was
  deadlocked by a record that came in through the front door. So an incoherent grammar is now refused at
  ingest, the previous version stays current, and the browser blocks publishing any defect rather than only
  a newly introduced one. The unbound-*tag* worklist is untouched: that is a gap between two records, not a
  contradiction inside one. Rendering stays lenient in every case — refusing to *display* an orphan would
  make the AppView the arbiter of a language's grammar, which this note's original objection was right
  about.
- **An optimistic-concurrency guard.** Refuse the write if the record changed since load: last-write-wins can
  now drop a *reference*, not merely a label.

**Every layer's constraint is a gate, and every gate has a mirror.** Expect each new layer to add one of
each, and expect both to live in the shared validator.

**Records prove authorship, not ownership.** Every layer is a record like any other: last-write-wins,
archived, contestable, votable later. A language record's blast radius is an entire language, which makes
version history *more* important here, not less.

---

## 4. The interface

### 4.1 The binding editor — a tabbed, path-scoped tree

One tab per layer. Inside a tab a sidebar holds the *path* through a tree while the main panel shows exactly
one level. Layer 1:

1. choose **UPOS** or **FEATS**;
2. UPOS → the flat list of UPOS; FEATS → the flat list of feature names;
3. opening an item — or "add" at the top of the list — → the binding form;
4. opening a *feature* → two options: **bind the feature name**, and, revealed only once that binding exists,
   **open its values**.

Layer 2 has the same shape one level up: pick a category → declare which features are inherent to it →
the value-combinations for a declared feature become available to bind.

In both, the gate is rendered **as navigation rather than as an error**: the illegal action is simply not
offered, so no validation copy is needed.

**The discipline to preserve: one level visible at a time, the path in the sidebar, everything inside the
layer's own tab.** The failure mode of a binding UI is a single screen showing POS, features, values and
combinations at once.

**Candidate lists are fetched from UD live; the contributor chooses what to bind.** The editor builds the
list from the universal inventory **plus the language's own treebank pages**, resolved from its BCP 47 tag,
and the contributor picks. This dissolves questions like "does `Subcat` have two values or four" — the editor
shows what the page currently offers and the contributor calls the shot, so no inventory needs transcribing
into code. CORS is open (§1.5), so fetch directly; keep the **HTML parser in a shared package** (the pages
are `text/html`, not an API) so it can move behind an AppView cache if UD restructures. Implied small piece
of work: a BCP 47 → treebank code mapping (`br` → `br_keb`).

**Non-negotiable guardrail: the editor must degrade to manual entry.** If the fetch fails, a contributor must
still be able to type a tag and bind it — otherwise UD's uptime becomes a hard dependency for authoring,
which breaks "design for the language that has nothing".

### 4.2 The entry editor — progressive narrowing by clicking labels

> `[shipped]` **Built at layer 2** (ADR-0007), and all four properties below hold. The grammar is
> resolved from the language's own record at editor-open — an authoring surface may pay a PDS round trip
> where the viewers deliberately never do — and a failure lands on this section's own documented
> degradation (the flat multi-select) along the same code path, not a special case.

The contributor never types a criterion. They are shown the language's named **parts of speech**, and each
click narrows what is offered next, drawn from layer 2's declarations:

> A Latin first-declension feminine noun: click **`n.`** → gender options appear (because Gender is declared
> inherent to NOUN) → click the abbreviation for `{NOUN, Gender=Fem}` → declension options appear (because
> `Declension` is declared inherent too) → click **`1.`**. Three clicks, no typing.

Four properties this must have:

- **The suggestion tree is a derived view of layers 1–2, not a separate declaration.** The inherence
  declarations and the enumerated combinations are what generate the narrowing; nothing extra is authored to
  get it. *(This is also what makes deleting the old class layer free: `appliesTo` existed only to drive this
  narrowing, and inherence now does it.)*
- **A refinement path produces one bundle, not an accumulation.** Clicking `n.` then `nf.` stores
  `{NOUN, Gender=Fem}` — *not* `{NOUN}` and `{NOUN, Gender=Fem}` both. Whether it displays as one chip or two
  is decided by the rendering chain (§2.4), not by the editor. To add a genuinely separate category the
  contributor starts a new path.
- **It degrades to a flat multi-select.** A language that has declared no inherence offers nothing to narrow
  to, so atoms are picked independently — and an *unenumerated* combination must stay reachable, since layer
  2 is a menu and not a whitelist.
- **Every step shows a bound homolingual label, never a raw tag.** This is only possible because the grammar
  was declared first — the payoff of tag-only `categories` (§2.3). The entry editor can be entirely
  homolingual precisely because the forcing function did its work.

Binding **from inside the entry editor is allowed**: publish a new language-record version, then save the
entry. Language records are already user-editable this way, and records prove authorship, not ownership.

### 4.3 The contributor's walk

1. Language dashboard → **Grammatical labels**. The 14 headword-eligible UPOS appear as rows, each glossed
   **in the reader's interface language**, with a bind affordance. The list is closed, so the task visibly
   ends. *(That gloss is UI chrome sourced from UD's English docs — never entry content, so the homolingual
   rule is untouched. It is a real layer-1 deliverable: without it a non-linguist cannot bind `NOUN`.)*
2. Bind `NOUN` → `anv-kadarn` / `an.`. Done once for every entry in the language.
3. Bind `Gender`, then its values — `Gender=Fem` → `benel` / `b.`. Leave `Gender=Neut` unbound and it never
   appears again downstream.
4. Layer 2: declare **Gender is inherent to NOUN**, then bind the combinations the editor prompts for. Where
   the tradition prints one chip for two atoms, that combination's label is `an.b.`; where it prints two, the
   combination is left unbound and decomposition renders `an. b.`.
5. Look for a singulative under `Number`; it is not there. **Mint at the value level**: `Number=Sgv`, scheme
   `br`, bound to `unanennek` / `un.`, with a `references` row citing a Breton grammar. Minting happens
   exactly where the contributor can see nothing in UD fits, which makes it a justified act rather than a
   shrug.
6. Mint a `Conjugation` feature and its values, declare it inherent to VERB, bind each combination — useful
   in the headword line with no generation behind it.
7. Layer 3: declare that a verb's forms vary by person, number, tense and mood — which is what the
   `otherForms` editor then offers.

### 4.4 The triage gate — run it in order before minting anything

Minting is legitimate and expected, but reaching for it first is how "follow UD only" dies quietly.

1. **Is it a grammatical feature at all?** Register, domain, dialect and editorial hedges stay free pairs
   forever. "Masculine but sometimes used as feminine" fails here: a bundle cannot rank or hedge its values,
   and inventing a way to would be exactly the algebra §0 bars. True épicène is different — that is
   multivalue `Gender=Fem,Masc`.
2. **Which altitude?** Lexeme (`categories`) / form (`otherForms`, later a cell) / **sense** (the definition
   group node). Transitivity is sense-level in most dictionaries.
3. **Does UD already express it** — across all three tiers (§1.4), and via its own routing rules (articles →
   `DET` + `PronType=Art`; participles → `VerbForm=`; "spans the axis" → multivalue enumeration)? Check at
   source; the assumption that UD lacks something is often wrong.
4. **Only then mint**, and record why.

### 4.5 Sources of trust

For a `ud`-scheme item the documentation URL is **derivable** from the item itself (`u/pos/`,
`u/feat/<Feature>.html`) — compute it in the UI and store nothing, which keeps records small and links
unrotted. For a **minted** item and for a **plain abbreviation** the source is not derivable, so the row
carries `references: [{text, url}]`, reusing the entry lexicon's existing shape. On a minted item this is not
decoration: UD's licence is conditional on being "properly documented", so the reference is what makes the
compatibility claim honest.

### 4.6 The third thing a row can say

A `label` **names** an item and is a display string sized for a chip; `references` say **where the claim
comes from** and are a citation. Neither can hold *"this language's `Number=Sgv` is the singulative, a form
derived from a collective — not the plural"* — which is the sentence a printed dictionary puts under the
heading in its front matter, and the one a contributor needs before choosing between two values. So a
feature row and a value row each carry an optional **`note`**: free prose, homolingual like the label,
written for a reader of the language being described.

Three things fix its shape. It is a **single string**, not a list: an entry's `notes[]` is a list of
independent remarks about a word, where this is one remark about one row, so paragraphs are newlines. It
sits on **feature and value only** — those two shapes are what grammatical features, inflection classes and
lexicographic label sets are all made of, while `NOUN` explains itself, a named combination's meaning is its
parts', and an abbreviation's expansion *is* its explanation. And it is **outside the minting gate**, where
`references` is not: UD's extension licence is what makes a source obligatory on a minted row, but explaining
what a feature covers here is wanted whether or not the name was borrowed — a borrowed name is often exactly
the case that needs it, since a language's `Case` is never quite UD's.

It is **content**, so it is indexed nowhere — the precedent is `layout` (ADR-0009) and an example sentence
(ADR-0014). It reaches a reader on the language record the dashboard already resolves from its author's PDS
for the shelf's shape, so it cost no collection, no endpoint and no ingest logic beyond `isValidNote`.

---

## 5. Consequences to design for

- `[shipped, ADR-0008]` **The read model inverts, and stays the single home.** It is **single-sourced**: a
  *language* supplies the label, an *entry* supplies only usage, joined on the canonical row key. The
  dashboard's question becomes *"which tags are in use with no label yet?"* — a **naming worklist** — and
  the model must tolerate a named row at count 0 and a used row carrying no label at all.
  **The framing was "a tagged abbreviation, not a labelled tag"; ADR-0010 reversed it, and the collection is
  now `labels`.** Keying a row on its label pair had three live defects: renaming `n.` to `an.` destroyed one
  row and created another, losing its usage; two atoms named identically collapsed into one row, hiding
  exactly the clash the conflict machinery exists to surface; and nothing stopped two rows describing one
  tag. **The tag is the identity and the label is what it is called**, so the doc key is
  `(language, canonical row key)` and ArangoDB's primary key enforces the policy on its own.
- ~~**Most labels a real dictionary uses stay free pairs forever.**~~ **Reversed by ADR-0008 as to
  storage.** The *freedom* stands — a language may name anything, minting a feature where UD has no term —
  but the label lives on the language record, never on an entry. A label written on an entry is one the
  language cannot govern: invisible to the worklist, uncorrectable in one place, free to drift between two
  entries. An entry in a language whose tagset nobody has declared stays editable through the form editor's
  flat picker and manual tag entry.
- **Four different things live at annotation sites — do not let them collapse.** (a) a taggable grammatical
  feature; (b) an editorial/domain/register label; (c) a free prose remark — `plainNotes`; (d) a
  **collocation or example phrase**, which is *content*, not annotation, and needs its own field rather than
  being smuggled into notes. The project's bet is that structure substitutes for corpus size, so a
  mislabelled note is structure lost.
  **(b) got its home at ADR-0010 and it is not a free pair.** A **lexicographic label set** is a feature
  flagged `lexicographic` on the language record: structurally a minted feature with values, so its values
  are ordinary tags an entry or a sense carries, but excluded from layers 2 to 4 — a word is not inflected
  for "by extension". This is the fourth answer to the triage gate that ADR-0008 left open, and it is
  emphatically **not** the return of free pairs to the entry lexicon. The one row that stands for no tag at
  all is a **plain abbreviation** (`udb.` → "un dra bennak"), identified by its own short form.
- **Syncretism makes cells many-to-one** (layers 4–5): a generated table must merge cells, not repeat a form
  four times. Cell-address-as-bundle handles this; an ordinal grid does not.
- **"Cell absent" and "cell spans the axis" must render differently.** Three states, not two: a feature that
  *does not apply*; a cell covering **every** value of an axis; a cell with one specific value. Collapse the
  first two and the table renders identically for "this language has no imperative for this verb" and "this
  verb's imperative is one form for all persons" — the reader cannot tell an absent form from an incomplete
  entry. Express the middle state as a **UD multivalue over the language's declared inventory**
  (`Gender=Fem,Masc`), never as a wildcard. Absence stays absence: the feature is simply not in the bundle.
  This also covers an indeclinable borrowing (one form spanning the whole Case axis, stored once) and rule
  economy at layer 5. If layer 4 enumerates cells Apertium-style, the three states fall out of the structure;
  a dense grid must say it explicitly.
- **Inflected-form search** (layer 5): query-side normalisation needs the *inverse* of the generator, and
  Hunspell affix rules are not cheaply invertible. Ingest-time index expansion is the leaning answer, at the
  cost that a rule edit re-expands a whole language. No PDS record is touched either way.
- **Per-lexeme defectiveness is an entry-level exception at layer 5**, not a property of any declaration.

---

## 6. Not verified — fetch before relying on any of this

- **The remaining ~19 UD FEATS value inventories.** Under "store sparse" and the live-fetch editor this is
  **not a layer-1 blocker** — layer 1 validates shape, not vocabulary — but nothing in §1.5 may be extended
  from memory.
- ~~**`Subcat`'s value list.**~~ **Dissolved as designed, not settled in code.** The live editor fetched the
  page during the layer-1 build and it lists four values (`Intr Indir Tran Ditr`); nothing is hardcoded, and
  nothing should be — the editor shows whatever the page currently offers.
- ~~**The lexicon `union` encoding for annotation-XOR-tag.**~~ **Moot** — the strict per-site type split
  (§2.3) needs no union. *Verified separately during the build:* the real `@atproto/lexicon` validator does
  accept the nesting `grammar` needs (record → ref → object → array → ref → ref), and **no official
  `app.bsky`/`com.atproto` lexicon uses an inline `type: "object"` property** — the convention is a named
  def plus a ref, which is what shipped.
- ~~**The `layout` sub-object's inner shape** (layer 4).~~ **Closed by ADR-0009** — axis-mapped blocks with
  derived cells (§ layer 4 above). What it leaves open is narrower and inherited: `layoutFor` matches by
  containment, so an entry spelling "n. f." as **two chips** never matches a layout declared on the
  combination `{NOUN, Gender=Fem}` and degrades to the `{NOUN}` one. That is `applicableAxes`'s shipped
  semantics from layer 3, not layout's, and Breton — which binds `n.` and `f.` separately — will meet it.
- ~~**Whether the entry-level annotation site should also accept a tag.**~~ **Dissolved by ADR-0008** — the
  site is gone. What remains open: a whole-entry label that is not a grammatical category has only prose
  `notes` or a minted feature.
- **Wikidata Lexemes.** Lexeme/Form/Sense split, plausible prior art. **Closed for now by decision** — do
  not spend a layer on it.
- **Whether a PDS validates a third-party NSID against our lexicon before accepting a write.** The
  data-validation guide does not say. Nothing depends on it — the AppView validates regardless — but do not
  assume either way.
- ~~**Language-specific UD pages** (`/{lang}/feat/Gender.html`).~~ **Closed 2026-08-18, and the rule
  generalised.** They were checked during the layer-1 build and *not* used: they are a **subset** of the
  universal inventory (Czech documents three of UD's four genders) and 404 for low-resource languages
  (neither `br/feat/index.html` nor `cy/feat/index.html` exists), so they narrow rather than extend. What
  went unnoticed then is that the source actually chosen — the **universal features index** — narrows too,
  by a whole tier: it is a glossary of the universal features alone, so `Subcat`, `AdpType`, `NumForm`,
  `VerbType`, `Style` and every layered name were withheld from every contributor. The candidate list is
  now read off **`u/feat/all.html`**, the whole documented inventory (66 names against the index's 27, a
  strict superset), and the rule is stated rather than left implicit: **a candidate list widens the
  contributor's options, never narrows them** — no scoping by language, tier or treebank, because a
  language's grammar is what its speakers declare, not what a corpus attested. The only filter is the
  editor's: an already-bound row is not offered twice. Note this also removes the "implied small piece of
  work" in §4.1: those pages are keyed by **language code, not treebank code**, so no BCP 47 → `br_keb`
  mapping is needed for them.

---

## Sources

**UD:** [POS](https://universaldependencies.org/u/pos/) ·
[all features](https://universaldependencies.org/u/feat/all.html) (the candidate source) · [features index](https://universaldependencies.org/u/feat/index.html) (universal tier only) ·
[CoNLL-U format](https://universaldependencies.org/format.html) ·
[Gender](https://universaldependencies.org/u/feat/Gender.html) ·
[Case](https://universaldependencies.org/u/feat/Case.html) ·
[NounClass](https://universaldependencies.org/u/feat/NounClass.html) ·
[Number](https://universaldependencies.org/u/feat/Number.html) ·
[VerbForm](https://universaldependencies.org/u/feat/VerbForm.html) ·
[PronType](https://universaldependencies.org/u/feat/PronType.html) ·
[Animacy](https://universaldependencies.org/u/feat/Animacy.html) ·
[Aspect](https://universaldependencies.org/u/feat/Aspect.html) ·
[Subcat](https://universaldependencies.org/u/feat/Subcat.html) (values unsettled) ·
[UD_Breton-KEB](https://universaldependencies.org/treebanks/br_keb/index.html) — uses only `Sing`/`Plur` and
the layered `Gender[psor]`: **a treebank existing is not a usable tagset existing.**

**Other:** [Apertium monodix](https://wiki.apertium.org/wiki/Monodix_basics) · `man 5 hunspell` ·
[AT Proto data validation](https://atproto.com/guides/data-validation) ·
[UD↔UniMorph mismatches](https://arxiv.org/abs/1810.06743) (the ~64% figure; export only)
