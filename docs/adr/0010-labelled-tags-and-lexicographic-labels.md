# ADR-0010 — Labelled tags: lexicographic label sets, plain abbreviations, and identity on the tag

- **Status:** Accepted
- **Date:** 2026-08-03
- **Deciders:** Alan Kersaudy
- **Supersedes, in part:** ADR-0004 (the read model's key), ADR-0006 (the "a
  tagged abbreviation" framing)

## Context

Three things arrived at once, and they turned out to be one thing.

**1. A dictionary prints more than grammar.** ADR-0008 removed free `{long,
short}` pairs from the entry lexicon: a label written on an entry is one the
language cannot govern — invisible to the worklist, uncorrectable in one place,
free to drift between two entries. It left an open question behind, recorded in
the evolution skill: *what happens to `arch.`, `fam.`, "by extension" now?* The
answer offered was "prose in `notes`, or a minted feature", and the note said to
watch whether contributors reached for a minted `Register` feature — because if
they did, the triage gate needed a fourth answer.

They would. "Archaic" is a set of named options a language declares, exactly as
an inflection class is. Nothing about the *shape* of an inflection class is
grammatical; what is grammatical is what gets built on it.

**2. A dictionary also prints abbreviations that stand for nothing at all.**
`udb.` → "un dra bennak". `s.o.` → "someone". These are not features, not values,
not options to pick from a list. They belong in the front matter and nowhere
else, and asking a contributor to give one a tag would be asking them to describe
"udb." as a grammatical category.

**3. The read model was keyed on the wrong thing.** ADR-0004 keyed
`abbreviations` on the label pair — `hash(language, short, long)` — because at
the time a row *was* a pair, harvested from entries, that might later acquire a
tag. ADR-0006 named the framing: **"a tagged abbreviation", not "a labelled
tag"**. ADR-0008 then made labels single-sourced from the language record, which
quietly removed the reason for that framing without removing the key.

The consequences were live defects:

- Renaming `n.` to `an.` **destroyed one row and created another**, losing the
  usage list with it.
- Two atoms named identically **collapsed into one row**, so a language that
  called both `ADP` and `SCONJ` "particle" saw one row and no warning — the exact
  defect the conflict machinery exists to surface.
- Nothing prevented two rows describing the same tag.

## Decision

### The tag is the identity; the label is what it is called

The model is renamed **`labels`**, and the framing is inverted to **a labelled
tag**. A doc's `_key` is `labelKey(languageID, canonicalRowKey)` and nothing
else, so ArangoDB's own primary key enforces one row per tag per language — the
policy needs no extra index, because it is the key.

The canonical row key is what `grammarRows` already produced: `tagKey` for a part
of speech, a value or a named combination; `featureKey` for a feature *name*;
and, new here, `abbr#<short>` for a plain abbreviation. Entry usage computes the
same key from the same tag, so a declaration and its usage **meet on one doc by
construction** — the lookup `syncEntryTags` used to perform is gone, and the
"declarations first, then usage" ordering in the wholesale rebuild stops being
load-bearing.

Two consequences follow and are wanted: renaming a label is now an **in-place
update** that keeps its usage, and two rows named identically stay two rows and
**flag each other as conflicting**. `conflictsBetween` was widened to match: the
same full form is a conflict however either row is abbreviated, since two tags
both called "noun" cannot be told apart on a page.

### Lexicographic label sets — a flag on a feature, not a sixth array

`GrammarFeature` gains `lexicographic?: boolean`. Such a feature is structurally
a minted feature with values — one name, several options, a label each — and its
values are **ordinary tags** an entry or a sense may carry, rendering and binding
like any other. What the flag withholds is participation in the grammatical
layers: never an inherent feature, never an axis, never a layout dimension or
coordinate, never part of a named combination.

A flag rather than a new array because the machinery is a feature's exactly, and
a fact keeps one home. The exclusion is enforced the way every gate in this arc
is: **as navigation** — these rows are simply absent from the layer 2/3 pickers —
and reported as the issue `lexicographic-in-grammar` only for a record authored
elsewhere. `resolveAxes` and `inherentFeatures` drop them the way they already
drop an orphan.

### Plain abbreviations — a shallow row identified by its short form

`grammar.abbreviations` is `[{short, long, references?}]`. Both strings are
required, unlike a label's optional `short`: the short form **is** the identity,
so an abbreviation with nothing to abbreviate is just a word. No `scheme`, since
the only possible provenance is this language's own lexicographic tradition. The
editor asks for the short form on the way in and never again — editing it would
be writing a different abbreviation.

They reach the read model through `grammarRows` like everything else, so the API
cost of the whole feature was again **zero endpoints**. The prefixed key keeps
them out of the renderer's tag lookup entirely, which is correct: an abbreviation
stands for no tag, so no tag should resolve to it.

### Renames

`abbreviations` → `labels` throughout: the collection, the endpoint
(`GET /languages/:tag/labels`), `packages/types/src/label.ts`
(`LabelView`, `LabelsResponse`, `labelLookup`, `formatLabelRef`), and the API
modules. No alias is kept — `apps/web` is the only client. The dialog is
retitled **"Grammar & labels"**, since it now declares three kinds of thing and
"Grammatical labels" named one.

## Consequences

- **One row per tag per language, enforced by the primary key.** No two labels
  can describe the same tag; a rename keeps its usage; two identically named
  rows are surfaced instead of silently merged.
- **The `abbreviations` collection is dropped by `db:init`**, unlike an obsolete
  collection, which is only warned about. It is a **derived** model rebuilt
  wholesale from `languages` and `entries` in the same script — the standing
  exception `localLanguages` already has to the archive-forever rule. Nothing is
  lost; keeping it would leave two copies of one read model with only the new
  one maintained.
- **The language doc's cached rows migrate forward, not away.** The field is
  renamed `bindings` → `labels` and the old shape is read alongside the new one
  (`toDeclaredLabel`), because those rows are what a rebuild uses *instead of*
  resolving every record from its PDS — dropping them would have erased every
  label in production until each language record happened to be republished.
  `kind` is recovered from the tag, since the only tagless row the old shape
  could hold was a feature name.
- **A lexicon change, so pre-1.0 rules apply**: no compatibility shim, and a bot
  republish is the whole cost. `lexicographic` and `abbreviations` are both
  additive — a record written before this change stays valid and means the same
  thing.
- **ADR-0008's open question is answered, and the invariant it protected
  stands.** The fourth triage answer is a lexicographic label set on the
  *language*, **not** the return of free pairs on an entry. An entry still
  carries tags and prose and nothing else.
- **Two new issue kinds**, `lexicographic-in-grammar` and
  `duplicate-abbreviation`, both reported and never rejected at ingest, as every
  other grammar issue is.

## Action items

- [ ] Publish the updated `eu.leksis.language` lexicon
      (`scripts/publish-lexicons.mjs`) — it already lagged by `grammar.layout`
      and now lags by these two as well. Requires the user's approval.
- [ ] Drive the two new editor doors in a browser once a test account exists
      (the U-01…U-24 flows in the `leksis-testset` skill).
