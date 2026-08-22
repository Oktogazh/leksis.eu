# ADR-0020 — A category says what a headword is, and nothing about how it varies

- **Status:** **Accepted**, built in one pass on 2026-08-22, released as **v0.29.0**.
- **Date:** 2026-08-22
- **Deciders:** Alan Kersaudy
- **Supersedes:** ADR-0019's `axis` and per-flavour `annotations` on a category declaration (both
  removed), and with them six of its twelve `grammarIssues` kinds. The rest of ADR-0019 stands:
  the tables still live in the paradigm record, a paradigm still selects by exact equality on the
  headword bundle, and `selectorKeys` is still what it is matched against.
- **Builds on:** ADR-0006 (primitives), ADR-0007 (inherence — now the *only* layer-2 declaration),
  ADR-0010 (labels keyed on the tag), ADR-0015 (the ingest gate), ADR-0016 (paradigm rules).

## Context

ADR-0019 asked a language to declare, per category, the one feature its forms **vary over**, and
then one abbreviation per value of that feature its own headwords are **cited at**. Authoring a
real language against it — Breton, whose noun tree is `Number` over `Gender` over `Subgender` —
showed the distinction is not one a language can draw:

- Breton cites an *anv-kadarn stroll* in the **plural**. `Number` is therefore part of what that
  headword *is* — and it is also exactly what an ordinary noun's forms range over. A rule that
  says a feature is one **or** the other has to be wrong about one of the two, and the editor
  enforced it: `category-axis-inherent` refused precisely the record a Breton lexicographer
  needed to write.
- The value inventory of the axis was already layer 1's, and which cells are printed was already
  the paradigm's (ADR-0019 said both). What the axis added on top was one thing only: a slot for
  several abbreviations under one declaration. That is a labelling convenience, paid for with a
  second kind of layer-2 declaration and six of the twelve coherence rules.

Five interface defects had the same root or sat beside it, and are fixed here rather than
separately, because four of them touch the same file:

- **The Bind button hid behind Publish.** A form's own Bind sat at the bottom of a scrolling
  panel with Publish pinned in the footer under it, so the ordinary way to lose an edit was to
  finish typing and press the button that was in front of you.
- **A deep category had no trail.** The path carried one hop (`from`), so walking down four
  levels and clicking a parent lost the grandparent that led to it.
- **A branch with everything under it read as empty.** The count over an inherent feature was of
  its *direct, named* children, and no Breton word is ever cited as just a singular noun — so a
  feature holding sixteen categories printed "0 of 6 named".
- **Lists came out in insertion order**, which is unusable at Breton's size (169 lexicographic
  labels, 55 features).
- **An abbreviation was keyed on the form it prints**, so "udb." could not be corrected to
  "u.d.b." — only deleted and re-added — and a tradition abbreviating in a non-ASCII script had
  its document key made of that script.

## Decision

**A category declares a bundle, a label and a note. Nothing else.**

```ts
interface GrammarCategory {
  category: Tag;
  label: GrammarLabel;   // one, not a list
  note?: string;         // new: the same free prose a feature and a value carry
}
```

- **`inherent` is the only layer-2 declaration.** It answers "which features define a headword of
  this category" — the citation number of an *anv-kadarn stroll* included. A feature declared
  there may perfectly well also vary across the word's forms; that is the ordinary case, and the
  paradigm's tables are what say which cells exist.
- **One flavour, one category, one abbreviation.** `{NOUN, Gender=Masc, Number=Sing}` → "ak. g."
  and `{NOUN, Gender=Masc, Number=Plur}` → "ak. str." are two rows, at the depth the tree
  reaches them.
- **`headwordKeys` filters on inherence alone.** The bundle an entry is indexed under is
  unchanged wherever the language named the flavour — the value that used to survive as a
  "declared default" now survives as an inherent feature, through the rule that was always there —
  and **widens in one case**, below.
- **`grammarIssues` reports six kinds, not twelve.** The six `category-*` kinds went with the
  axis they were about. What is left is what can go wrong with a bundle: `unbound-feature`,
  `duplicate`, `unbound-atom`, `ungrounded-combination`, `lexicographic-in-grammar`,
  `duplicate-abbreviation`.
- **An abbreviation has an identity of its own**: `{value, short, long, note?, references?}`,
  keyed on `value` (`[A-Za-z0-9]+`, never displayed) where `short` is what the dictionary prints.
  It gains a `note` on the same terms a category does: `long` is the *expansion*, and an expansion
  is not always an explanation — the gap a feature's and a value's note already fill.
- **The `otherForms` editor offers every bound grammatical feature.** `categoryAxes` became
  `formAxes` and stopped filtering: with no axis to read, the honest fallback beside the
  paradigm's tables is a superset, because a manual path that withholds a coordinate is worse
  than one that offers a coordinate nobody uses. (Filtering by "not identifying" would have
  hidden `Number` from the one noun whose other form is its singulative.)

**The interface, in the same pass:**

- **Bind replaces Publish while a row is being edited.** One primary action, and on a form level
  it is the one that keeps what is on screen. The destructive button stays in the panel, beside
  what it destroys.
- **The trail is derived from the bundle, not carried on the path**, and it alternates feature
  and value: `ak. / Number= / Sing / Gender= / Masc / Subgender= / Unstable`. A category's feats
  *are* its ancestry, in the order they were added, so arriving from the root list shows the same
  trail as walking down. Indent is capped at four rungs.
- **Counts are of the whole subtree**, on the category list and on each inherent feature — which
  is also what blocks withdrawing a declaration something below still stands on.
- **Every list is sorted alphabetically for display**, collated in the language being described
  (`labelCollator`). The record keeps the order its author wrote: an array's order is theirs.
- **The dialog is full height on a phone** and a fixed tall panel above that (`h-[100dvh]`,
  `sm:h-[calc(100dvh-2rem)] sm:max-h-[54rem]`).

**Older records are mapped forward in the browser and refused at ingest** — ADR-0015 read from
both sides, and the same asymmetry ADR-0019 used for `axes`/`layout`. `migrateGrammar` in
`packages/types` is now the single forward map, applied at **six** sites — the record reader
(`atproto-record.ts`), the viewers' grammar cache (`language-grammar.ts`), the dashboard shelf, the
binding editor's draft, the **entry editor's own copy** (`CreateEntryPanel`, which fetches the
record itself), and the **names dialog's pass-through** (`LanguageRecordDialog`, where publishing an
unmigrated grammar would have written a record the AppView drops and reported success). It maps three generations: `bindings` → categories (ADR-0019), a category's
`annotations` → one category per annotation **plus an inherence row for the axis** (this ADR), and
an abbreviation's missing `value` → a slug of its printed form, numbered apart on collision. It is
shape-preserving, not a cleaner: what it does not recognise passes through and `isValidGrammar`
still refuses it. Publishing an unchanged draft is therefore what commits the conversion, and the
footer says so before it happens.

## Consequences

- **A refusal at ingest names the shape it refused.** Six kinds that used to be reported by
  `grammarIssues` (which logs the offending rows) moved into the silent shape branch, and the
  ADR-0019 category shape lands there too — so that branch grew a probe for exactly the three
  legacy declarations the browser detects, and logs which one it found. A bot author whose record
  was correct when they wrote it is told what changed rather than "invalid".
- **A migrated grammar is not re-capped.** One legacy category with *n* annotations becomes *n*
  categories, so a record near `GRAMMAR_LIMITS.categories` (1024) could in principle migrate past
  it and be refused by the reader — unopenable in the interface that would repair it. No live
  record is within two orders of magnitude of that (Breton: 28), and the alternatives are a silent
  truncation or a cap raised for a case nobody has met; the bound is recorded here instead.
- **Pre-1.0 breaking change, taken deliberately** (the evolution skill's rule: get the shape
  right, do not design around compatibility). Every live language record is refused at ingest
  until its author republishes through the editor, which the editor makes a two-click act.
- **The API cost is negative**: `languages.categories` (a cache ADR-0019 added for
  `headwordKeys`) is gone from the doc, and `languageDeclarations` reads one field instead of two.
  No endpoint, index or collection changed.
- **A bare part of speech can no longer be a category** in practice — its tag is the one the `pos`
  row binds, so a row for it is a `duplicate`. ADR-0019's "a single atom is allowed" survives in
  the code (grounding still exempts single atoms) but has no use left, and the two-atom floor is
  back de facto rather than as a rule. **So `GrammarPos` gained the `note` a category has**, and
  the category editor's shallowest level reads and writes the `pos` row itself — same label, same
  note, one home, reached through either door. Renaming there keeps the row's `scheme` and
  `references`, and the remove button is absent: unbinding a part of speech belongs under
  Primitives, beside the values it would orphan.
- **The `otherForms` editor is denser**: one selector per bound grammatical feature *that has
  bound values* — fourteen for the live Breton record, which binds 55 feature names but values
  under far fewer, against the one its single declared axis used to give. That is the price of not
  declaring variation, and the place to fix it is the paradigm's own tables — reading the cells a
  paradigm actually draws, which needs the paradigm *records* in the entry editor and is deferred
  until somebody complains.
- **An unnamed value of an identifying feature now survives into the headword key.** A noun
  tagged `{NOUN, Gender=Masc, Number=Coll}` keys as all three atoms where ADR-0019 dropped the
  `Coll` (no annotation declared it). It reaches a paradigm only if one selects exactly that
  bundle, which is the same outcome by a more honest route: the contributor said the word is
  cited in the collective.
- The testset's coverage matrix loses L-15 (a one-atom category), L-34 to L-39 (the six retired
  issue kinds) and gains L-21 (an abbreviation's identity, printed form and note). The `qtl`
  fixture's layer 2 is re-declared as a tree; every paradigm still reaches the same entries, which
  `scripts/fixtures/preview.ts` shows unchanged.

## Action items

- [x] Lexicon, types, ingest, both editors, the shelf, the fixtures, the i18n copy.
- [x] Verified in the browser against the **live Breton record** — a pre-ADR-0020 record that
      loads, maps forward (28 categories, 11 abbreviations, `Number` inherent to `{NOUN}`), reads
      coherently, and enables Publish with the notice shown. Nothing was published.
- [ ] The testset pass (`leksis-testset`) and `docker compose build` before any tag.
- [ ] `scripts/publish-lexicons.mjs` still lags the code; unchanged by this ADR.
