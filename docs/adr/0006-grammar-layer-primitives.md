# 0006 — The grammar layer, layer 1: tags, bindings, and the annotation-site split

- **Status:** Accepted
- **Date:** 2026-08-02
- **Deciders:** Alan (with Claude)
- **Amends:** ADR-0004 (abbreviations read model) — see "Amendments" below
- **Supersedes:** `docs/design/grammatical-tagging.md` for layer 1 only; that
  note remains the design source for layers 2–6

## Context

The morphology arc's north star (in the `leksis-evolution` skill) is an entry
that renders its full morphology from knowledge declared once at the language
level. It advances in thin layers, each shippable alone. **Layer 1 is the
vocabulary layer**: the atoms a language uses, and the names it gives them.

Two facts force the design. First, a low-resource language usually has **no UD
treebank at all**, so no documented feature set exists for it — declaring one
is Leksis's job, not a gap to work around. Second, entries are **homolingual**:
every piece of text an entry carries is written in the entry's own language, so
a grammatical category cannot be stored as an English word.

Those two together mean a grammatical category has to be split in half: a
machine identifier that rides on the entry, and a reader-facing name that lives
where the language is described. Everything below follows from that split.

## Decision

### 1. A tag is a bundle, and provenance rides on each item

`Tag = { upos?: {value, scheme?}, feats?: [{feature, value, scheme?}] }`, at
least one present. A bundle rather than an atom because languages abbreviate at
different granularities — French `nf.` is one label for NOUN + Gender=Fem where
Breton uses two.

`scheme` is **per item, never per bundle**: a bundle-level scheme could not
describe `{NOUN (ud), Number=Sgv (br)}`, which is the normal shape of a minted
category, and marking the whole bundle `br` would break matching against
`ud`-scheme bindings and leave an exporter unable to tell which halves are
exportable.

Vocabulary follows **Universal Dependencies, and only UD**. Where UD is
awkward, the escape hatch is a **minted** item (`scheme` = the minting
language's BCP 47 tag), which UD's own extension licence permits — "UD
treebanks may use additional features and values if they are properly
documented". Minting is legitimate and expected, not a fallback for not having
checked; a minted row carries `references` because that licence is conditional
on documentation.

### 2. Equality is a canonical key, and it is derived

`tagKey` normalises the four things that can differ without the tag differing:
the part of speech gets its own slot (UPOS is its own CoNLL-U column, never a
feature), features are sorted, a multivalue item's values are sorted, and an
absent `scheme` is written out as `ud`. Without this, two authors listing the
same items in a different order produce tags that silently fail to match.

The key is **derived, never stored on a record**. It may appear in ArangoDB,
which is rebuildable, and its format may change without a lexicon break.

### 3. The `grammar` sub-object: three arrays, one home per fact

On `eu.leksis.language`, optional:

```
grammar = {
  pos:      [{ value, scheme?, label, references? }],
  features: [{ feature, scheme?, label, references? }],
  values:   [{ feature, value, scheme?, label, references? }],
}
```

`values` rows state **which feature the value is an option of** — a declaration
a bundle cannot make, and what turns "list this language's genders" into a
lookup instead of a scan. `features` rows bind a feature *name*: the axis
header layer 4 will print, and the gate every value sits behind.

Only *authored* rows are stored. Absence already means unbound, so a stored
skeleton of empty rows would carry no facts, go stale when UD moves, and invite
writing UD's English names in as placeholders.

Layer 2's arrays (`inherent`, and `bindings` for multi-atom combinations) are
**deliberately absent** from both the type and the lexicon until layer 2 builds
them: a schema field nobody writes is an invitation to write into it, and
adding them later is additive and non-breaking.

**It lives on the language record rather than in a lexicon of its own** because
the layers reference each other — unbinding an atom orphans every higher row
that uses it — and one self-contained object means a single write keeps the
whole cascade consistent.

### 4. Binding is declaring — and the cascade governs authoring, never rendering

What a language has bound *is* its inventory: `Gender=Neut` left unbound in
French means neuter never appears as an option downstream. This is what makes
the flow work for a language with no published tagset.

But a tag arriving unbound — from a bot, or another AppView — **still renders**,
verbatim and styled as unbound. A viewer that rejected unbound tags would make
the AppView the arbiter of a language's grammar. This asymmetry runs through
every decision below.

### 5. Two guards, browser-enforced and AppView-detected

- **The no-orphan rule.** A `values` row's feature name must be bound. Since a
  record is rewritten whole, "unbinding" is not a delete operation: the client
  **diffs proposed against current** (`grammarDiff`, a pure function in
  `packages/types`) and refuses to publish a version that orphans a reference.
  Only defects the edit *introduces* block it — a record that arrived already
  incoherent must stay editable, or the repair worklist is unreachable.
- **Optimistic concurrency.** The editor re-reads the current record
  immediately before writing and refuses on a changed `recordURI`/`cid`:
  last-write-wins can now drop a *reference*, not merely a label.

At the AppView both are **detection only, never rejection**. Rejecting a
version would discard everything else it carries to punish one row, and an
orphan already renders safely. Malformed *shape* still rejects the whole
record, as any other field does. The dashboard surfaces the detected defects as
a repair worklist.

### 6. Every annotation site holds exactly one type

The entry and the definition node carry the same three fields:

| Field | Holds |
|---|---|
| `categories` | tags only |
| `annotations` | free `{long, short?}` labels only |
| `notes` | free prose only |

**This replaces the design note's XOR rule** (an item being *either* a tag or a
pair), and with it the need for a lexicon `union` encoding — that open question
is moot rather than answered. A field that could hold either would give one
displayed string two sources of truth, and they can only drift.

`categories` being tag-only is a **forcing function**, and the friction is the
mechanism working: requiring a tag makes a contributor settle the language's
grammar declaration *before* authoring entries, which is the only reason every
step of the entry editor can show a bound homolingual label instead of a raw
identifier. Two corollaries: do not mint `Register=Vulg` to smuggle a register
label into the headword line, and do not relax `categories` to accept pairs
later on the grounds that contributors find it hard.

Sense-level tagging is why the definition node gets `categories` too: a verb is
`VERB` at the entry level and transitive on one sense group, intransitive on
another.

### 7. Rendering: exact → decomposition → verbatim

This is how the viewer *chooses* between valid renderings, not merely a
fallback chain. Exact bundle match first; else greedy decomposition into the
largest bound sub-bundles, rendered **in the bundle's own order** — a language
that bound `n.` and `f.` separately shows `n. f.`, never a synthesised `nf.`
nobody authored. Partial decomposition still beats a raw tag. What remains
renders verbatim, styled as unbound, and **never as UD's English gloss**, which
would read as content and breach the homolingual rule; an untranslated
identifier reads as "this needs binding", which is the wanted signal.

One shared implementation (`resolveTag`, in `packages/types`), because it
serves the viewers now and the layer-6 exporters later.

### 8. UD is fetched live, and must degrade to manual

The binding editor offers what UD currently documents so a contributor picks
rather than types — which dissolves questions like "does `Subcat` have two
values or four": the page says, and the contributor calls the shot. Nothing is
transcribed into code, so no inventory in this repo can go stale.

**Non-negotiable:** a failed fetch leaves manual entry fully functional. UD's
uptime is never a precondition for authoring, or "design for the language that
has nothing" is a slogan rather than a property.

The one UD vocabulary embedded is the **17 UPOS**, because that inventory is
closed and stable since UD v2. The FEATS value inventories deliberately are
not: 27 features, hundreds of values, released twice a year, and a stale
snapshot used as a validator would reject vocabulary UD has since added. The
**14 headword-eligible** tags (17 minus PUNCT/SYM/X) are a **Leksis editorial
judgement, not UD's** — the POS page states no eligibility policy.

## Amendments to ADR-0004

ADR-0004's doctrine continues — the `abbreviations` model stays the single home
for a language's labels, and the framing is **"a tagged abbreviation", not "a
labelled tag"**, so a binding does not grow a parallel collection. Its
mechanics change:

- **Decision 1 (entry docs store their pairs) is extended.** Entry docs also
  store their distinct **tags**, and language docs store their harvested
  **binding pairs** and `grammarIssues`. The reason is ADR-0004's own: a
  wholesale `db:init` rebuild must not have to resolve every record from its
  PDS — and without the stored bindings it would *erase* every binding the
  model carries.
- **Decision 2 (the derived collection) is extended.** A doc gains
  `bindingKey` (a language binding declares this row), `tagKey`/`tag` (the tag
  it is about), and `long` becomes nullable. **The deletion rule changes**: a
  doc is removed only when no entry uses it *and* no binding declares it, so a
  bound pair survives at **count 0** — the normal state of a label nobody has
  used yet, and not something the entries may delete. The pair stays the row's
  identity, so a binding and an identical free pair are one row: the reader's
  list shows `an. anv-kadarn` once, whatever put it there. A tag nothing binds
  gets a row with no label at all — that row *is* the "needs a name here"
  worklist item.
- **Decision 3 (never expose per-pair entry lists) stands untouched.**

## Consequences

- **A breaking entry-lexicon change, absorbed by a bot reset-and-republish** —
  the `botSource` precedent (v0.9). Old-shape records are rejected *whole* at
  ingest, which is the wanted loud failure: they never half-load. Pre-1.0 one
  break costs one republish, which is why the whole break was done at once
  rather than spread across layers.
- **The entry editor's progressive narrowing is not built.** It is derived from
  layer 2's inherence declarations; building it now would mean hardcoding
  inherence, which breaks "no hardcoded language assumptions". Layer 1 ships
  the flat multi-select the design note prescribes as its degradation, plus a
  manual field so a bot's tag or an undeclared language stays authorable.
- **The definition-level category editor is deferred.** The shape ships, ingest
  validates it and the viewer renders it; nobody authors it from the UI yet.
- A language that has declared nothing is **fully usable**: entries carry no
  categories, or carry tags that render verbatim.
- Every later layer inherits the gate/mirror pattern — expect each to add one
  of each, in the shared validator.

## Action items

1. ~~`Tag` + canonical key + UPOS inventory in `packages/types`~~ (done)
2. ~~`grammar` on the language lexicon, ingest, both guards, binding editor~~ (done)
3. ~~Live UD candidate lists in `packages/ud`, degrading to manual~~ (done)
4. ~~`abbreviations` widened; repair and unbound-tag worklists~~ (done)
5. ~~The entry break, the resolution chain, sense-level tag rendering~~ (done)
6. **Bot reset-and-republish** in the new entry shape (operator).
7. **Verify the UI in a browser** — the React surfaces are typechecked and
   their logic is tested, but no screen has been rendered.
8. Language-specific UD pages (`/{lang}/feat/`) are *not* consulted: they are a
   subset of the universal inventory (Czech documents three of UD's four
   genders) and 404 for low-resource languages. Revisit if a language's
   contributors want the treebank's narrowing as a filter.
