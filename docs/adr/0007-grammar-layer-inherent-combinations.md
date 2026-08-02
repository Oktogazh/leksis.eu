# 0007 — The grammar layer, layer 2: inherence, named combinations, and progressive narrowing

- **Status:** Accepted
- **Date:** 2026-08-02
- **Deciders:** Alan (with Claude)
- **Builds on:** ADR-0006 (layer 1: tags, bindings, the annotation-site split)
- **Supersedes:** `docs/design/grammatical-tagging.md` for layer 2 only; that
  note remains the design source for layers 3–6

## Context

Layer 1 gave a language its **atoms**: the parts of speech it uses, the feature
names, the feature values, each bound to a homolingual label. What it could not
say is how those atoms go together — that gender is part of what a French noun
*is*, while number is something its forms vary by.

Without that statement, two things stayed impossible. The entry editor could
only offer a flat multi-select, because narrowing "n." → gender → declension has
to be *derived* from somewhere, and hardcoding which features are inherent to
which part of speech would be exactly the hardcoded language assumption this
project refuses. And a language that prints one label where another prints two
— French `nf.` against Breton `n. f.` — had nowhere to say so, which left
`resolveTag`'s exact-match branch reachable only for single atoms.

Layer 2 supplies both from one declaration.

## Decision

### 1. Two arrays, and the first is the one no earlier design had

On `eu.leksis.language.grammar`, both optional and both additive:

```
inherent = [{ category: Tag, feature: string }]
bindings = [{ tag: Tag, label: {long, short?}, references? }]
```

`inherent` states that a feature is part of what a category *is*. Previously
inherence could only be *implied* by which combinations happened to exist, so
the system could not distinguish "aspect is inherent to verbs" from "somebody
bound one aspectual verb category". `bindings` names a combination of two or
more atoms — the `nf.` case, and nothing else.

**Both halves of an `inherent` row are variables and no category is
privileged.** `VERB × Aspect`, `ADJ × Degree` and `ADP × Conjugation` (Breton
conjugates its prepositions) are as ordinary as `NOUN × Gender`. There is no
per-part-of-speech special case anywhere in the layer.

Because `category` is a `Tag`, inherence can be declared on a *combination*,
and that is what sets the **depth** of the entry editor's narrowing: a
declension inherent to `{NOUN}` is offered straight after "n.", one inherent to
`{NOUN, Gender=Fem}` only once the gender is chosen. Which distinctions are
prerequisite to which is a lexicographic judgement, and it is the language's.

Two deliberate narrowings of the design note's §2.2 sketch:

- **Rows are singular `(category, feature)`**, not a plural `features[]` grouped
  under one category — matching the layer's own prose ("the row is
  `(category, feature)` and *both* halves are variables") and layer 3's `axes`,
  which will key the same way. One shape for one relation.
- **`feature` is a bare name, with no `scheme`**, matched by name exactly as a
  value is matched to its feature. Requiring schemes to agree would break the
  ordinary case of a minted value on a UD feature, and layer 1 already accepts
  the pathological case (a language minting a name UD uses for something else)
  rather than designing around it.

### 2. Grounding is the gate; completeness is a prompt

These are different things and conflating them would break the layer.

**Grounding** is layer 2's gate, and it is layer 1's rule one level up. A named
combination must be reachable by removing one feature item at a time, each
removal licensed by an inherence declaration on what remains, down to a bound
atom. `{NOUN, Gender=Fem, Declension=1}` is grounded when `Declension` is
inherent to `{NOUN, Gender=Fem}` (or to `{NOUN}`) and that smaller bundle is
itself grounded. Only feature items are ever removed, never the part of speech —
which makes the check the exact inverse of the walk the entry editor takes
forwards. Above six items the check is skipped and the combination passes: the
search is exponential, and a bundle that large is pathological rather than worth
an exponential validator. That is the same cap, for the same reason, as the
renderer's decomposition.

**Completeness** — "VERB × Aspect: 2 of 3 values named" — is a **counter and
never a constraint**. An incomplete set is legitimate: a language may bind a
value because another category inflects for it while having no headword of this
one that takes it. Nothing about it blocks a save, and the editor shows the
count without ever disabling publish.

The gate renders as **navigation, not validation** — the combination form is
reached *through* an inherence declaration, so the illegal state has no door.

### 3. Three new issue kinds, detected and never rejected

`unbound-atom` (a layer-2 row built on an atom layer 1 does not bind),
`ungrounded-combination` (the gate), and `single-item-binding` (a `bindings` row
holding one atom, which already has a home in `pos` or `values` — two ways to
state one fact is how the two come to disagree).

They follow ADR-0006's split exactly: the browser refuses to publish a version
that **introduces** one, and the AppView **detects and indexes** rather than
rejecting. A one-atom combination is well-formed and merely redundant, so it is
*not* a shape failure — rejecting would discard a whole language's declaration
over one row that says something true in the wrong place.

Where a row's atoms are unbound, grounding necessarily fails too; only the
unbound atoms are reported, so one cause produces one worklist item.

### 4. Combinations ride the read model that already exists

A `bindings` row enters `grammarRows` as a `"combination"` kind and reaches the
`abbreviations` model through `grammarBindingPairs` → `syncLanguageBindings` and
the `db:init` rebuild **with no plumbing of its own**. No new collection, no new
endpoint, no ingest change: the API cost of this layer was zero, and that is the
strongest evidence layer 1's shapes were right.

The visible consequence is that `resolveTag`'s **exact-match branch now fires
for multi-item bundles**. It shipped at layer 1 and could only ever match single
atoms until a language had a way to name a combination.

### 5. The entry editor reads the grammar from the record, not from an index

Progressive narrowing needs the `inherent` rows, which carry no label and
therefore have no business in a label read model. The editor resolves the
language's current record from its PDS — one round trip, at editor-open, paid by
an *authoring* surface where the viewers deliberately never pay it.

Failure is silent and lands on the behaviour the design note already
prescribes: no grammar means the flat picker over bound abbreviations, which is
layer 1's shipped editor unchanged. The degradation is not a special case; it is
the same code path.

The four required properties hold: the tree is a **derived view** of layers 1–2
(`categoryRoots`, `categoryRefinements` in `packages/types`, nothing extra
authored); a refinement path produces **one bundle**, replacing rather than
accumulating; it **degrades to a flat multi-select**; and every step shows a
**bound homolingual label** — a combination's own where the language named it,
otherwise the value's. An option whose combination is unnamed is still offered,
because layer 2 is a menu and not a whitelist.

### 6. `eu.leksis.defs`, a shared lexicon for the tag shape

Layer 2 needs `Tag` inside `eu.leksis.language`, where it previously existed
only inside `eu.leksis.entry`. The three defs move to a new **`eu.leksis.defs`**
lexicon that both reference — the AT Proto convention (`app.bsky.actor.defs`).

No record shape changes, so no republish. The alternative, duplicating the defs,
would have cost a third copy when layer 5's `eu.leksis.paradigm` needs the same
shape; the other, referencing `eu.leksis.entry#tag` from the language lexicon,
would have pointed the dependency at the hottest lexicon in the project.

## Consequences

- **Additive and non-breaking.** No entry record changes, no bot republish. A
  language that declares nothing behaves exactly as before.
- **The gate/mirror pattern held for a second layer**, as ADR-0006 predicted:
  one gate (grounding) and one mirror (withdrawing an inherence declaration is
  refused while a named combination stands on it), both in the shared validator,
  both rendered as navigation.
- **Layer 3 inherits the keying.** Its `axes` rows key on a category — a layer-1
  atom or a layer-2 combination — exactly as `inherent` does, and must validate
  that a (category, feature) pair is not both inherent and an axis.
- **The definition-node category editor stays deferred**, as at layer 1. The
  narrowing component is now reusable for it whenever a contributor wants one.
- **Publishing was not exercised end-to-end.** The editors were verified against
  a local stack with a seeded language; a real `putRecord` needs a session and
  belongs to the live-URL milestone walk.

## Action items

1. ~~`inherent`/`bindings` in `packages/types` and the language lexicon;
   `eu.leksis.defs`~~ (done)
2. ~~Grounding, the three issue kinds, the narrowing view~~ (done)
3. ~~The binding editor's Categories tab; the entry editor's narrowing~~ (done)
4. **Verify a real publish on the live URL** after tagging — both the binding
   editor's Categories tab and an entry authored by narrowing.
5. Local dev OAuth fails when the app is first loaded on a deep link
   (`buildLoopbackClientId` embeds the path); it blocked in-browser verification
   of the logged-in surfaces and was worked around with a temporary stub.
