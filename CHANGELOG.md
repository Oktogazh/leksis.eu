# Changelog

All notable changes to Leksis. Each section is one loop — a unit of work, not a
unit of time: the content loops grow the dictionary outward, the grammar loops
(the morphology arc) grow the entry deeper, and the two interleave.

## The semantic network — translations as a graph of senses

Content loop 5. A word's translations are no longer a gap in the model: they are
**relations between senses**, published as records by whoever knows them, and
walked by the AppView to answer "what is this word in that language" even when
nobody has asserted the pair directly. Breton *gwerzenn* reaches English *verse*
through French *vers* — and never through *vers* meaning "worms" or "toward",
because a path enters and leaves an intermediate word through the *same* sense.
See `docs/design/semantic-network.md`.

> **This entry covers the backend: the record, the ingest lifecycle and the read
> surface.** The reader and writer interfaces are the loop's remaining slices, so
> nothing in the web app consumes any of it yet. Additive throughout — no entry
> record changes, though an entry version indexed before this ships carries no
> `places` and parks its relations until its author republishes (pre-1.0, a bot
> republish).

### The lexicon — `eu.leksis.relation`

- **One record, two sides, no direction.** Equivalence is symmetric, so it is one
  standalone record rather than a field on either entry: two directions cannot
  disagree, and adding a translation republishes nobody's entry.
- **A synonym is a translation whose languages are equal** — no separate kind and
  no separate machinery. `kind` is absent for equivalence, `"antonym"` for the one
  relation that is stored and displayed but **never traversed**, since an antonym
  step inverts meaning. An unrecognised kind is indexed and shown, never
  traversed: a kind a later version introduces cannot corrupt results.
- **A side names senses, not words** — an `at://` URI of an entry record *version*
  plus a **canonical place prefix**, where `[]` means every sense. Never an
  AppView-minted key.
- Denormalised `languageID`/`orthography` on a side are display fallback only,
  and are the one thing a worklist can print for a side that cannot be resolved.
- Versioned exactly as entries are: `subject`, last-write-wins across authors,
  archival, and removal from the index when the record leaves its author's PDS.

### The graph

- **`senses`** — one vertex per definition leaf of every current entry version.
  **The vertex is the sense**: that is what makes indirect translation
  meaning-preserving, structurally rather than by a check. Materialising *every*
  leaf (not only the related ones) keeps a vertex key a pure computation and gives
  the untranslated-senses counter away for free.
- **`relationEdges`** — the cartesian product of the two sides' expanded sense
  sets, for **live relations only**. Overlapping prefixes on one entry drop the
  degenerate self-loops and keep the real pairs.
- **`relations`** — the versioned mirror, one doc per version, carrying each
  side's expansion against the version it pinned.
- **`entries` gains `places`** — the canonical places of a version's definition
  leaves, cached at ingest exactly as `tags` already is, so a prefix can be
  expanded and drift detected **without fetching any record from a PDS**.
- **Expansion dissolves nesting; there are no subset edges.** Two relations naming
  overlapping sense sets of one entry meet on the same vertex. An edge between a
  group and its leaves is never added: it would be traversable in the *widening*
  direction, letting a path climb out of sense II and descend into sense III.

### Ingest — pin to the version, compare the subtree, park what drifted

- A relation is **live** only while, for each side, the leaf set under the prefix
  is identical between the version it pinned and the entry's **current** version.
  The comparison is **structure-only**: a typo fix must not park a translation.
- **Park, never serve.** `stale` (restructured under the assertion),
  `unresolved` (a side's entry not indexed, or withdrawn to nothing) and
  `oversize` (past `MAX_RELATION_EDGES`, 256) have no edges at all and appear on
  worklists instead — because **a wrong translation is worse than a missing one**.
- Entry version transitions rebuild that entry's senses and re-anchor its
  relations: a restructure parks them, a reversion revives them, with no record
  fetched and nothing written to anyone's repository. A relation that arrives
  before the entry it references is revived by the index join when that entry
  appears — Jetstream delivers records in arbitrary order.
- **A withdrawn entry parks its relations** and `redirectTo` is *not* followed:
  re-pointing an assertion at another entry without its author is exactly the
  drift the mechanism exists to prevent.
- **Coarseness is recorded, not blocked.** A prefix covering more than one sense
  is kept, flagged on the edge, ranked below precise assertions and disclosed in
  the path — blocking it would discard translations that are usually right, and
  hiding it would hand the reader a confident wrong answer.

### The read surface

- **`GET /translate?q=&from=&to=&depth=`** — one BFS traversal per source sense,
  pruned at the target language, filtered to traversable edges. Results group by
  **the sense you searched from, never the sense you landed on**, so a sense with
  no equivalent shows as an empty group and partial coverage needs no flag.
  Ranked **hops first, then coarse hops**. Each answer carries its via-chain,
  hop by hop, with the coarse hops named — until voting exists, *how* a
  translation was reached is the only quality signal a reader has. Depth defaults
  to 3, capped at 5.
- **`GET /entries/:key/relations`** — this entry's relations in reading order of
  its own senses, plus its parked ones. Read from the records rather than the
  edges, so whole-entry relations stay distinguishable from per-sense ones.
- **The language dashboard** gains relation counters by state, the
  untranslated-senses count, and the parked queue — a parked relation lists on
  **both** sides' languages, since either side's editor may be able to repair it.
- Definition texts and a relation's `notes` are **not served**: the client
  resolves records from their authors' PDSs, exactly as it already does for an
  entry. Unlike the grammar layers, this loop's API cost is deliberately non-zero
   — the traversal cannot run anywhere but the AppView.

## Labelled tags — lexicographic labels, abbreviations, and identity on the tag

The front matter of a dictionary is more than grammar. A language can now declare
**lexicographic label sets** (register, domain, editorial usage — "archaic",
"neologism", "by extension") and **plain abbreviations** ("udb." for "un dra
bennak"), beside the parts of speech, features and inflection classes it already
declared. And the read model behind all of them is re-keyed: **the tag is the
identity, the label is what it is called**. See **ADR-0010**.

> **Additive to the lexicon, breaking for the API and the database.** No entry
> record changes and no bot republish. The `abbreviations` collection and its
> endpoint are renamed `labels`; `db:init` drops the old collection and rebuilds
> the new one from `languages` and `entries`.

### Lexicon & types

- **`grammar.features[].lexicographic`** — marks a feature as a lexicographic
  label set. Structurally a minted feature with values, so its values are
  ordinary tags an entry or a sense may carry; the flag withholds only
  participation in the grammatical layers. "By extension" is not something a word
  *is* nor something its forms *vary over*, so it is never an inherent feature,
  an axis, a layout dimension or part of a named combination.
- **`grammar.abbreviations`** — `[{short, long, references?}]`. A shallow row
  standing for **no tag at all**. Both strings are required, unlike a label's
  optional `short`, because the short form *is* the identity; no `scheme`, since
  the only possible provenance is this language's own tradition.
- **A flag rather than a sixth array** for the lexicographic sets: the machinery
  is a feature's exactly, and a fact keeps one home.
- Two new issues, reported and never rejected: `lexicographic-in-grammar` (a
  label set used where the grammatical layers expect grammar) and
  `duplicate-abbreviation` (two rows sharing the short form that identifies
  them).

### The read model, re-keyed

- **`abbreviations` → `labels`**, and "a tagged abbreviation" → **a labelled
  tag**. The doc `_key` is now `(language, canonical row key)` and nothing else,
  so **ArangoDB's primary key enforces one row per tag per language** — no extra
  index, because it *is* the key.
- **Renaming a label keeps its usage.** Keyed on the pair, "n." → "an." used to
  destroy one row and create another; it is an in-place update now.
- **Two atoms named identically stay two rows** and flag each other as
  conflicting, instead of silently collapsing into one. `conflictsBetween` was
  widened accordingly: the same full form clashes however either row is
  abbreviated.
- **The join is free.** A declaration and the entry usage of the same tag compute
  the same key, so `syncEntryTags` no longer looks the row up, and the
  "declarations before usage" ordering in the rebuild stops being load-bearing.
- Abbreviations reach the model through `grammarRows` like every other row, so
  the **API cost was zero endpoints** — the fourth layer running.

### Interface

- The dialog is retitled **"Grammar & labels"**: it declares three kinds of thing
  now, and "Grammatical labels" named one.
- Two new doors on its root level, beside parts of speech, features and
  inflection classes: **Lexicographic labels** (the same three levels as a
  class — nothing is fetched from UD, since UD defines none of this) and
  **Abbreviations** (two levels, not three: there is nothing underneath a row
  that is not a set of options).
- The exclusion from layers 2–4 is rendered **as navigation**: lexicographic sets
  are simply absent from the inherence and axis pickers, never disabled.
- Which section a feature belongs to is **derived from the row**, so reopening
  the dialog puts it back where it was.
- The dashboard's list becomes a **shelf**: one tab per kind of thing a language
  names, in the editor's own order, so the badge that used to say what a row
  *is* one row at a time is the tab the row lives on. The three tabs whose rows
  are *sets of options* — features, inflection classes, lexicographic labels —
  ask for a feature before showing anything, since `Gender` is a question and
  `Gender=Fem` an answer; its values then arrive as a table ordered by full form
  or by how many entries use them. An inflection class appears under both
  Features and Inflection classes, exactly as it does in the editor: it is a
  minted feature and nothing more.
- **The shelf's structure is read from the language record, its counts from the
  `labels` model** — ADR-0010's own asymmetry, a language supplying the label and
  an entry only the usage, so the two meet on the canonical key they already
  share and the tabs cost **no endpoint, no index and no ingest change**. Where
  the record cannot be resolved the section degrades to the flat list, badge
  included, as the editor button already degrades to disabled.

### Fixed

- **A grammar holding only abbreviations was silently dropped on publish**: the
  editor checked three of the object's arrays before deciding it had anything to
  write.
- The language doc's cached label rows are **migrated forward, not away**
  (`toDeclaredLabel`). They are what a rebuild uses instead of resolving every
  record from its PDS, so renaming the field alone would have erased every label
  in production until each language record was republished.
- Stale copy retired: the dashboard no longer says abbreviations are "harvested"
  from entries (single-sourced since ADR-0008), and the lexicon's `grammar`
  description no longer says layout "will be added".

## Grammar layer — layer 4: the shape of the tables

A language can now say **what its paradigms look like** — which axis runs down
the table, which runs across, one table or several, what a reader sees without
asking — and an entry's hand-entered forms arrive in that shape instead of a flat
list. See **ADR-0009**.

> **Additive.** No entry record changes and no bot republish. A language that
> declares no layout behaves exactly as before: the flat list, which is the
> fallback this layer was required not to break.

### Lexicon & types

- **`grammar.layout`** — `[{category, blocks[]}]`, a block being a **table**
  (axis feature names per dimension, outermost first) or a **list** (explicit
  addresses in order). Both may pin constants with `fixed` and be marked
  `summary`.
- **Cells are derived, never stored**: the cartesian product of the assigned
  axes' declared values *is* the cell set. A stored matrix would be a second copy
  of layer 3's value lists, free to drift from them.
- **Non-rectangularity, three composable ways**: several blocks with different
  `fixed` constants (one table per mood and tense), `exclude` for holes inside a
  grid, and a list block for what no grid reaches — a Latin infinitive, gerund
  and supine.
- **`summary` is a flag per block**, not indices on the layout: reordering blocks
  would silently renumber indices. Mark nothing and every block shows.
- **Coordinates are bare and re-qualified before use.** `coordTag` puts the
  minting scheme back from the `values` row that bound it, or a Breton
  `Number=Sgv` cell would neither find its label nor match the form it addresses.
  The join itself (`featsMatchKey`) is scheme- and POS-blind, since a bot and the
  editor write the same form differently.
- **Placement**: exact, then containment — a form carrying *more* than the address
  still lands, most specific cell first; one carrying *less* stays a **leftover**
  printed below the blocks. Nothing is ever dropped.
- **Five new issue kinds** (`layout-unknown-axis`, `layout-repeated-axis`,
  `layout-foreign-coordinate`, `empty-layout-block`, `layout-too-large`), reusing
  `unbound-atom`/`duplicate` where the repair is identical. `MAX_LAYOUT_CELLS`
  (4096) is counted before the product is built.
- **`layoutView`** composes the whole viewer path in one call, so the component
  drawing a paradigm holds no arithmetic and every degradation is one shape.

### AppView

- **No change at all** — third layer running. Verified against a throwaway
  ArangoDB with real ingest: a coherent layout indexes, a defective one indexes
  *and* reports its issues, a malformed block is rejected whole, and the
  abbreviations model is untouched (a layout carries no labels).

### Web

- **Layout tab** in the binding editor: pick a category (only those with a
  declared axis are offered), order its blocks, and edit one block — axes onto
  each dimension with ↑↓ for nesting, value chips to pin a constant, and a
  **derived grid whose every cell shows its identifier** in UD form. Clicking a
  cell excludes it; clicking again puts it back, because the grid is resolved with
  the exclusions set aside.
- **The category level previews the whole layout through the shipped resolver**,
  so the preview cannot drift from the page it previews.
- **Inflection classes** — a third root section beside Parts of speech and
  Features. Same machinery, but nothing is fetched from UD and the mint box starts
  ticked: a class, and every value of a minted feature, is necessarily the
  language's own. No storage change — a class *is* a minted feature.
- **The entry page hydrates with its language's grammar** (pointer from the
  AppView, record from the author's PDS, cached per tag) and draws the paradigm:
  summary blocks beside the headword, the rest behind an expander, leftovers
  below. A cell the language says cannot exist and a cell nobody has filled in
  render **differently**.
- Every failure degrades to the flat list — no record, no grammar, no layout, no
  matching category, nothing filled.

## Grammar layer — layer 3: axes, and labels that live on the language

A language can now say what a word's **forms** vary over — which features, over
which values, **in which order** — and with that the last reader-facing string
left the entry record. See **ADR-0008**.

> **Breaking.** The entry lexicon loses every free `{long, short}` label and
> `otherForms` is retagged. Ingestion bots must reset and republish.

### Lexicon & types

- **`grammar.axes`** — `{category, feature, values[]}`, "for this category this
  feature varies across its forms, over these values, in this order". The values
  are **named rather than inherited** from the whole inventory, because a
  language's inventory and one category's paradigm are not the same set: three
  genders in the adjectives, a split masculine in the nouns. Naming them fixes
  the order layer 4 will print — the alphabetical order of an identifier is not
  a grammatical order.
- **Keyed exactly as `inherent`** (a `Tag` category, a bare feature name), which
  is what makes the conflict between the two detectable. An axis category is
  checked for **bound atoms only, never grounding** — that is what lets a
  paradigm be non-rectangular, so a finite verb can take a Person axis while an
  infinitive simply never declares one.
- **Two new issue kinds**, both issues rather than shape rejections:
  `inherent-axis-conflict` and `empty-axis`. The no-orphan diff needed **no
  change** — unbinding a value an axis uses already surfaces as `unbound-atom`.
- **`applicableAxes`** walks an entry's sub-bundles, so an axis declared on
  `{NOUN}` reaches an entry categorised `{NOUN, Gender=Fem}`.
- **Entry lexicon break (one, deliberate, pre-1.0):** entry-level `annotations`,
  definition-node `annotations` and the `#annotation` def are **removed**;
  `otherForms[].annotation` becomes **`otherForms[].tag`** — one `Tag` bundle,
  because a form's label is its address in the paradigm ("gen. pl." is one
  coordinate in two dimensions). An evicted editorial label goes to `notes` as
  prose, or becomes a minted feature bound on the language record.

### AppView

- **The `abbreviations` model is single-sourced.** A *language* supplies the
  label, an *entry* supplies only usage, joined on the canonical tag key. A row
  is either a bound label — count legitimately **zero** when declared before
  use — or **a tag in use that nothing has named yet**, which is the worklist
  item. `syncEntryAbbreviations` became `syncEntryTags`; entry docs lost their
  `abbreviations` array.
- **Form tags now reach the worklist**: an entry's tags are collected at all
  three altitudes — lexeme, sense and form. An unnamed `Number=Plur` on a plural
  is as much a gap as an unnamed `NOUN` on a headword.
- **Strict at ingest, lenient at render.** A record whose `otherForms` carry the
  old free pair is rejected whole; the retired `annotations` fields are simply
  ignored (AT Proto extensibility), because refusing would drop the entry from
  search until someone republished it. The web parser drops an old-shape form
  rather than failing the record.
- `db:init` rebuilds **bindings first, then usage** — an order that is
  load-bearing. Axis orphan detection needed **no API change at all**.

### Web

- **Axes tab** in the binding editor, same path-scoped discipline as the other
  two: pick a category, pick a feature, then tick and **order** its values.
- **The gate is navigation on both sides**: the Axes tab does not offer a
  feature already inherent to the category, and the Categories tab does not
  offer one already an axis of it.
- **Form tags in the entry editor** — one selector per declared axis. Axes are
  orthogonal dimensions, not layer 2's narrowing tree: a cell address takes one
  value from each independently. Degrades to the flat bound-tag picker plus
  manual entry when nothing is declared.
- Every free-pair authoring surface is gone (the chip row, its editor, the
  entry-level and definition-node sections). Prose notes are untouched. Both
  viewers render a form's tag through the existing
  exact → decomposition → verbatim chain.

## Grammar layer — layer 2: inherence, and the editor that narrows

A language can now say how its atoms go together — that gender is part of what
a French noun *is*, while number is something its forms vary by — and the entry
editor derives its whole narrowing flow from that one statement. See
**ADR-0007**.

> **Additive.** No entry record changes and no bot republish: a language that
> declares nothing behaves exactly as before.

### Lexicon & types

- **`grammar.inherent`** — `{category, feature}`, "for this category, this
  feature is inherent". Both halves are variables and no category is
  privileged: `VERB × Aspect`, `ADJ × Degree` and `ADP × Conjugation` (Breton
  conjugates its prepositions) are as ordinary as `NOUN × Gender`. Since the
  category is itself a tag, inherence can be declared on a *combination*, which
  is what sets the depth of the editor's narrowing.
- **`grammar.bindings`** — a label for a combination of **two or more** atoms:
  French `nf.` for NOUN + Gender=Fem, where a language that prints `n. f.`
  simply binds the two atoms separately and never adds a row. A one-atom row
  already has a home in `pos`/`values`.
- **New `eu.leksis.defs` lexicon** holds `tag`/`tagUpos`/`tagFeat`, referenced
  by both the entry and language lexicons — the AT Proto convention, and the
  shape layer 5's paradigms will want too. Def names are not record content, so
  nothing republishes.
- **Grounding, the gate.** A named combination must be reachable by removing
  one feature at a time, each removal licensed by an inherence declaration, down
  to a bound atom — layer 1's value-behind-name rule one level up, and the exact
  inverse of the walk the editor takes forwards. Three new issue kinds
  (`unbound-atom`, `ungrounded-combination`, `single-item-binding`), browser-
  refused when *introduced*, AppView-detected and never rejected.
- `categoryRoots`/`categoryRefinements`/`inherentFeatures` — the narrowing tree
  as a **derived view** of layers 1–2, in `packages/types` so later layers and
  the layer-6 exporters share it.

### API (`apps/api`)

- **No changes were needed.** Combinations reach the `abbreviations` read model
  through `grammarRows` alone, so a new version, the firehose sync and the
  wholesale `db:init` rebuild all carried them unmodified — verified against a
  live stack, rebuild byte-identical. The layer's API cost was zero, which is
  the strongest evidence layer 1's shapes were right.

### Web (`apps/web`)

- **The binding editor gains its second tab.** Same path-scoped tree one level
  up: pick a category → declare which features are inherent → name the
  combinations it prompts for. Named combinations appear as categories
  themselves, so a language walks deeper one step at a time. The gate is
  navigation, not validation — and withdrawing an inherence declaration is
  refused while a named combination stands on it.
- The enumeration is a **prompt, not a constraint**: "1 of 2 named" is a
  counter, and an incomplete set never blocks a save — a language may bind a
  value for another category's sake entirely.
- **The entry editor narrows.** `n.` → gender → declension, three clicks and no
  typing, every step showing a bound homolingual label. A refinement path
  produces **one bundle**, not an accumulation; an unnamed combination is still
  offered, since layer 2 is a menu and not a whitelist; and with no grammar
  declared it degrades to layer 1's flat picker on the same code path.
- The grammar comes from the language's own record, resolved once at
  editor-open — an authoring surface may pay a PDS round trip where the viewers
  deliberately never do.
- **`resolveTag`'s exact-match branch fires for multi-item bundles** for the
  first time: it shipped at layer 1 and could only ever match single atoms until
  a language had a way to name a combination.
- The dashboard's repair worklist takes one copy string per issue kind, rather
  than a two-branch test that would have silently shown a new kind under an old
  kind's wording.

## Grammar layer — layer 1: the entry break, and tags rendered

The entry lexicon's breaking change, done once, plus the viewer chain that
makes tags readable and the worklist that surfaces the ones nobody has named.

> **Breaking, bots-only.** Old-shape records are rejected whole at ingest and
> the bots reset-and-republish, as with `botSource` in v0.9.

### Lexicon & types

- **Every annotation site holds exactly one type**, at both altitudes — the
  entry and the definition node now carry the same three fields:
  `categories` (tags), `annotations` (free `{long, short}` labels) and `notes`
  (free prose). `plainNotes` is gone; the definition's old `notes` (pairs) is
  now `annotations`, and its old `plainNotes` is now `notes`. A field that
  could hold either a tag or a label would give one displayed string two
  sources of truth, and they can only drift.
- **`categories` is tag-only, and the friction is deliberate.** Requiring a
  tag makes a contributor settle the language's grammar declaration before
  authoring entries, which is what lets every editor step show a bound
  homolingual label instead of a raw identifier. Non-grammatical headword
  labels (`vulg.`, `arch.`) move to the new entry-level `annotations`.
- New `#tag`/`#tagUpos`/`#tagFeat` defs in the entry lexicon.

### API (`apps/api`)

- Ingest validates tags at both altitudes — **shape only**, never vocabulary,
  so a language may use a tag no UD snapshot knows. Free labels are harvested
  from `annotations` and `otherForms`; `categories` no longer contributes a
  label, since a tag resolves to one through the language record.
- Entry docs store their distinct `tags`, and `syncEntryAbbreviations` joins
  them to the row that already carries that tag — so **usage counts land on
  the bound label** rather than beside it. A tag nothing binds gets a row with
  no label at all: that row *is* the worklist item. `db:init` rebuilds from
  all three sources and reproduces the model exactly.

### Web (`apps/web`)

- **The viewer's resolution chain** (`resolveTag`, in `packages/types` so the
  layer-6 exporters can share it): exact bundle match → greedy decomposition
  into bound parts, in the bundle's own order → the raw identifier, styled as
  unbound. A language that bound `nf.` shows `nf.`; one that bound `n.` and
  `f.` separately shows `n. f.`, never a synthesised label nobody authored.
  Partial decomposition still beats a raw tag. The lookup is built from the
  abbreviations response both viewers already fetch — no extra request, no PDS
  round trip.
- The entry editor's categories become a **picker over what the language has
  bound**, each option showing its homolingual label, plus a manual field for
  a tag nobody has bound yet — which is how a bot's tag, or a language with no
  declaration, stays authorable. Progressive narrowing is *not* here: it is
  derived from layer 2's inherence declarations, so layer 1 offers the flat
  multi-select the design note prescribes as its degradation.
- Definition nodes render their sense-level tags; the **editor** for them is
  deferred (the shape ships, ingest validates it, the viewer draws it).
- The dashboard gains **"tags used here with no name yet"**, each opening the
  binding editor.

## Grammar layer — layer 1: bindings enter the abbreviations model

The `abbreviations` read model gains a second source and **stays the single
home** for a language's labels: the framing is "a tagged abbreviation", not "a
labelled tag", so a binding does not create a parallel collection — a pair
simply acquires a `tag`.

### API (`apps/api`)

- **`firehose/abbreviations.ts`** gains `syncLanguageBindings`, mirroring
  `syncEntryAbbreviations`: a whole desired set is declared, so a new record
  version, an added binding and a removed one are one call. Docs gain
  `bindingKey` and `tag`.
- **The deletion rule changes.** A doc is removed only when no entry uses it
  *and* no binding declares it — so a bound pair survives at **count 0**, which
  is the normal state of a label nobody has used yet and not something the
  entries may delete. Conversely a pair the grammar stops binding keeps its
  entries and merely loses its tag.
- **Identity stays the label pair**, so a binding and an identical free pair
  from an entry are one row: the reader's abbreviation list shows
  `an. anv-kadarn` once, whatever put it there. (Two atoms bound to the same
  label therefore collapse into one row — an authoring mistake, since a reader
  could not tell them apart, and one the language owns.)
- Language docs now store their `grammarIssues` and their harvested
  `bindings`. The pairs are indexed for the same reason entry docs store
  theirs: without them a `db:init` rebuild would have to resolve every record
  from its PDS — or, worse, erase every binding in the model.
- `db:init` rebuilds from **both** sources and ensures an index on
  `bindingKey`. `GET /languages/:tag/abbreviations` serves `bound` and `tag`;
  `GET /languages/:tag/dashboard` serves `grammarIssues`.

### Web (`apps/web`)

- The dashboard's abbreviation list marks bound pairs and shows them at ×0 —
  the count is usage, not existence. A **repair worklist** appears beside it
  when the current record's grammar is incoherent, since the AppView indexes
  such a version rather than rejecting it; it opens the binding editor.

## Grammar layer — layer 1: live UD candidate lists

The binding editor now offers what Universal Dependencies currently documents,
so a contributor picks a feature or a value instead of typing it.

### New workspace (`packages/ud`)

- Fetches and parses UD's documentation pages — the universal feature index
  (27 features) and any feature's page (its values, each with UD's gloss). The
  pages are `text/html`, not an API, so the parsing lives in a shared package:
  if UD restructures, one file changes, and it can move behind an AppView cache
  without touching a caller. Nothing is transcribed into code, so no inventory
  in this repo can go stale — which is also what dissolves the question of what
  `Subcat`'s value list "really" is: the page says, and the contributor picks.
- **Every function fails soft.** A network error, a 404 or an unparseable page
  yields no candidates and no exception. UD's uptime is never a precondition
  for authoring, or "design for the language that has nothing" would be a
  slogan rather than a property.

### Web (`apps/web`)

- The binding editor's feature and value levels show the documented candidates
  not yet bound, each a click away from its binding form, above the manual
  field — which stays exactly as it was. Candidates are fetched when a level
  that shows them is opened, so editing a label never touches the network.

> Two findings from checking at source. The `br` → `br_keb` treebank-code
> mapping the design note anticipated is **not needed**: language-specific
> feature pages are keyed by language code (`/cs/feat/Gender.html`), not by
> treebank. And those pages are a *subset* of the universal inventory (Czech
> documents three of UD's four genders) and 404 for low-resource languages
> — `br/feat/index.html` does not exist — so they narrow rather than extend.
> Deferred, with the trigger: a language whose contributors want the treebank's
> narrowing as a filter.

## Grammar layer — layer 1: ingest and the binding editor

A language can now declare its grammatical vocabulary from its dashboard, and
the AppView accepts records carrying that declaration.

### API (`apps/api`)

- **`firehose/ingest-language.ts` validates `grammar`.** Shape is strict — a
  malformed grammar rejects the whole record, like any other field. Coherence
  is **detected, never rejected**: a value whose feature name nobody bound, or
  two rows keying the same, is logged as a warning and the version is still
  indexed. Refusing it would discard everything else the version carries to
  punish one row, and would make the AppView the arbiter of a language's
  grammar — while an orphan already renders safely. Nothing from `grammar` is
  indexed yet; that arrives with the read model.
- `GET /languages/:tag/currentRecord` now returns the version's **`cid`**, the
  baseline the editor's concurrency guard compares against.

### Web (`apps/web`)

- **New `components/GrammarBindingDialog.tsx`** — the binding editor, opened
  from the abbreviations section of the language dashboard. A tab strip (one
  tab today, so layer 2 slots in beside it), a sidebar holding the path, and a
  main panel showing **exactly one level**: parts of speech or features → the
  list → the binding form. The 14 headword-eligible parts of speech are listed
  with UD's English gloss as contributor-facing chrome.
  **The layer-1 gate is rendered as navigation, not as an error**: a feature's
  values simply cannot be reached until the feature name is bound, so there is
  no validation copy to write. Minting is offered where a contributor can see
  nothing fits, behind an explicit "nothing in UD fits" toggle that asks for a
  source — UD's extension licence is conditional on the addition being
  documented. A label may be typed fresh; it need not be an abbreviation the
  entry harvest already collected.
- **Both guards ship with it.** The **no-orphan** rule refuses to publish a
  version that would leave a value pointing at an unbound feature name — only
  defects the edit *introduces*, so an already-incoherent record stays
  repairable; unbinding a feature name deliberately does not cascade to its
  values, since deleting a contributor's bindings as a side effect would be
  worse than making them say so. The **concurrency** guard re-reads the current
  record immediately before writing and refuses on a changed `recordURI`/`cid`:
  last-write-wins can now drop a *reference*, not merely a label.
- **New `lib/grammar-draft.ts`** — the draft edits as pure, keyed functions, so
  what gets published is checkable without a browser.
- **`lib/atproto-record.ts`** carries `grammar` through, and treats a malformed
  one as an unreadable record rather than dropping it: every caller loads a
  record in order to rewrite it, so discarding the grammar would delete a
  language's declaration on the next save.
- **`LanguageRecordDialog` no longer rebuilds the record from literals.** It
  spread only four fields, so once `grammar` existed the first person to
  correct a language's name would have wiped that language's entire
  declaration — a blast radius of one language, silently.

## Grammar layer — layer 1 (primitives): the contract

The first slice of the morphology arc: the type a grammatical tag has, UD's
part-of-speech inventory, and the `grammar` sub-object a language record uses
to declare the vocabulary it actually uses. Contract only — nothing renders or
is indexed yet; the ingest, the binding editor and the read model follow.

Vocabulary comes from **Universal Dependencies, and only UD**, with minting
(`scheme` = the minting language's BCP 47 tag) as the escape hatch UD's own
extension licence provides. Everything below was checked against the published
pages in the session that wrote it, never from recall.

### Types (`packages/types`)

- **New `tag.ts`** — `Tag`, a *bundle* of an optional part of speech plus
  `Feature=Value` items, with **provenance on each item**: a bundle-level
  scheme could not express `{NOUN (ud), Number=Sgv (br)}`, the normal shape of
  a minted category. `tagKey` is the canonical key two tags are equal on — the
  part of speech in its own slot (UPOS is its own CoNLL-U column, never a
  feature), features sorted, multivalue values sorted, an absent `scheme`
  written out as `ud` so it cannot key apart from an explicit one. Derived,
  never stored on a record. Also `formatTagVerbatim` (the resolution chain's
  last resort, deliberately not UD's English gloss, which would read as
  content) and `parseTagInput`, the manual-entry path that keeps authoring
  possible when UD cannot be reached — and which never infers provenance.
  Shape rules are verified from `format.html`: feature names
  `[A-Z][A-Za-z0-9]*(\[[a-z0-9]+\])?`, values `[A-Z0-9][A-Za-z0-9]*` (a value
  may begin with a digit, so a minted `Conjugation=1` needs no workaround),
  `_` never a value, and UD's case-insensitive sort.
- **New `upos.ts`** — the 17 tags in UD's own three groups with its English
  glosses, fetched from `u/pos/`. Embedded because the inventory is closed and
  stable; the FEATS value inventories deliberately are **not**, since a stale
  snapshot used as a validator would reject vocabulary UD has since added.
  `HEADWORD_UPOS` is the 17 minus PUNCT/SYM/X — **a Leksis editorial
  judgement, not UD's**, which states no eligibility policy. Doc URLs are
  derived from an item, never stored.
- **New `grammar.ts`** — the `grammar` object as **three arrays**: `pos`,
  `features` (a feature *name*: the axis header, and the gate) and `values`
  (a value, stating which feature it is an option of). Binding is how a
  language declares its inventory, so only authored rows are stored — absence
  already means unbound. `grammarIssues` reports the layer-1 gate (a value
  whose feature name is unbound, matched by name so a minted value on a UD
  feature passes) and duplicate keys; `grammarDiff` is the no-orphan rule as a
  pure function over (old, new), reporting only what a proposal **introduces**
  so an already-orphaned record stays editable; `grammarLookup` is the single
  derived map the viewer will resolve tags against.
- `LeksisLanguageRecord` gains optional `grammar`.

### Lexicon (`lexicons/eu.leksis.language.json`)

- New optional `grammar` property and the defs behind it (`#grammar`,
  `#posBinding`, `#featureBinding`, `#valueBinding`, `#label`, `#reference`).
  Written as a named def plus a ref rather than an inline object, which is the
  convention every official `app.bsky`/`com.atproto` lexicon follows. Layer 2's
  declarations will be added here as further properties — additive, so nothing
  reserves a slot nobody writes to yet.

> The cascade governs **authoring, never rendering**: a tag arriving unbound
> still renders. A viewer that rejected unbound tags would make the AppView the
> arbiter of a language's grammar.

## Fixes — entry record round-trip fidelity

Groundwork for the grammar layer: the browser's record parser was discarding
most of what v0.8 added, so several shipped features were rendering nothing and
one path was destroying content on save. No lexicon or API change.

### Web (`apps/web`)

- **`lib/atproto-record.ts` — the parser kept only leaves with text.** Group
  nodes were dropped outright (losing every heading and the notes hanging on
  them), and `plainNotes`, `otherForms`, entry-level `notes` and `references`
  were never carried onto the parsed record at all — so the entry page's
  other-forms, notes and references sections, all shipped in v0.8, were dead
  code that could never render. All are now parsed, leniently: malformed items
  are dropped rather than failing the record.
- **A node's kind now follows from whether it carries text, not from its
  place.** `isLeafPlace` is the strict rule the API enforces at ingest, but
  every entry indexed before the v0.8 tree convention uses the older 0-based
  coordinates (`[0]`, `[1,0]`), so its leaves read as group nodes. Two
  consequences were live: `EntryPreview`'s definition list hid the text of any
  node whose place ended in 0 — `br-zoo-587e` rendered with no definition at
  all, `br-torpez-32bd` with one of three — and `fromRecordDefinitions` loaded
  those nodes into the editor as groups, dropping their text, which a full
  rewrite on save would have made permanent. Parser, viewer and editor now
  share the one rule; saving such an entry re-derives correct places, so an
  edit migrates it to the v0.8 convention (its old sub-sense nesting is not
  recoverable and flattens — the bots' republish is the real repair).
- **`DeleteEntryDialog` carried only `orthography`/`categories`/`definitions`
  forward**, so withdrawing an entry silently dropped its transcription, other
  forms, notes and references from the new version. The whole content is now
  carried; `todo` deliberately is not, since a withdrawn entry is not a task.

## Entries — IPA transcription, botSource removed

The entry gains a **phonetic transcription** and drops the bot-only source field.

### Lexicon & types (`lexicons/eu.leksis.entry.json`, `packages/types`)

- **New `transcription` field** — an optional single string holding the word's
  IPA phonetic transcription (e.g. `[ˈbrɛːzɔ̃nɛk]`, ≤128 graphemes).
  Record-only content like `notes`/`references`: the AppView type-checks it (a
  non-string rejects the record) but never indexes it. Added to
  `LeksisEntryRecord`.
- **`botSource` removed** — the bot-maintenance source identifier is dropped
  from the lexicon, types, ingest validation and the entry viewer. Ingestion
  bots now track their source-item → rkey mapping in local state; reader-facing
  provenance goes in `references`.

### Web (`apps/web`)

- The entry editor gains a **Pronunciation (IPA)** input under the spellings;
  both the full entry page and the compact `EntryPreview` render the
  transcription in a monospaced line under the orthography.
- The entry page's references footer no longer shows a `Source:` line, and the
  editor no longer preserves a `botSource` on modification.

> Bots-only lexicon change: old records are absorbed by the bots republishing.

## Entries — tree-shaped definitions, per-node notes, other forms, references

The entry definitions move from a matrix-like coordinate to a **tree** the way
a subchapter organises paragraphs, and the entry gains other grammatical forms,
free-text notes and bibliographic references. The `place` array keeps its
`number[]` shape; only its meaning changes, so no data migration is needed.

### Lexicon & types (`lexicons/eu.leksis.entry.json`, `packages/types`)

- **`place` reinterpreted as a tree address.** The last index is the node type:
  non-zero → a leaf (the definition proper, which carries `text`); 0 → a group
  node (a heading carrying notes but no text — e.g. a "transitive" grouping over
  several senses). A non-last 0 means "no grouping at that dimension", so a
  place can render shallower than its length (`[0,1,1]` = I. 1., `[1]` =
  `[0,1]` = `[0,0,1]` = 1.). A non-zero index `n` shows as the n-th label of its
  dimension; numbering follows the displayed depth (1 → arabic; 2 → roman,
  arabic; 3 → letters, roman, arabic — so `[1,2,0]` = A. II., `[1,1,1]` =
  A. I. 1.). `validDefinitionPlaces` is replaced by `validateDefinitions`
  (returns `"ok"` or a rule code: `order` / `structure` / `text-rule` /
  `empty`), shared by the API (strict at ingest) and the editor (last guard
  before writing). `isLeafPlace` is exported. `EntryDefinition.text` is now
  optional and gains `plainNotes: string[]` (free-text notes on a leaf or group
  node, before the abbreviation notes). Bare grouping stays **implicit** — a
  group appears in the array only when it carries notes.
- **New entry fields:** `otherForms` (`{ annotation, form }[]` — plural, gerund…,
  each an abbreviation from the entry's pool plus the spelling), `notes`
  (`string[]`, entry-level free text below the definitions) and `references`
  (`{ text, url? }[]`, shown with the bot-only `botSource` at the bottom). New
  `#inflectedForm` and `#reference` defs; new `EntryInflectedForm` /
  `EntryReference` types.

### API (`apps/api/src/firehose/ingest-entry.ts`)

- Validates the new definition shape (leaf/group text rule, `plainNotes`,
  tree-place invariants), `otherForms`, entry `notes` and `references` — a
  malformed record is still rejected whole; the new content stays record-only
  and is dropped after validation, except that **each other-form's spelling is
  added to the entry's `search` index** (deduped, lowercased) so an inflected
  form leads back to its entry. Other-form and group-node abbreviations join the
  harvested `abbreviations` read model alongside categories and definition
  notes.

### Web (`apps/web`)

- **`lib/definition-tree.ts`** reworked for the new convention: numbering reads
  a place directly (value → label, 0 skipped); group nodes carry their own
  payload; `toRecordDefinitions` emits leaves and annotated groups (bare groups
  implicit) with tree-correct places and a strict `checkRecordDefinitions`
  guard; `fromRecordDefinitions` rebuilds the tree from mixed group/leaf items
  and synthesises implicit groups. A bare definition beside a group is promoted
  to its own numbered slot (I. 1. / I. 2. / II. 1.) so ordering stays total;
  the round-trip is lossless. `updateGroup` added.
- **Entry editor** (`CreateEntryPanel.tsx`): group nodes get their own notes +
  plain-notes editors; leaves get a plain-notes editor; new *Other forms*,
  *Notes* and *References* fieldsets; submit is blocked (with a message) when
  the tree does not serialize to a valid definitions list. UX distinction
  between a definition proper and a grouping heading is sharpened: a group is a
  dashed heading band with a "grouping" badge and **no move arrows** (it emerges
  and vanishes as its definitions are nested), a definition is a solid card with
  the ↑ ↓ ← → controls. The abbreviation editor is **opt-in** — hidden behind a
  "+ add an abbreviation" action beside "+ add a free-text note", and auto-shown
  only when the node already carries one.
- **Entry viewer** (`EntryPreview.tsx`, `EntryPage.tsx`): the definition list
  renders group headings (notes, no text) and per-node plain notes and indents
  by displayed depth; the entry page shows other forms (by the categories),
  entry notes (below the definitions), and references + the read-only
  `botSource` in the footer.

## Language dashboard reorg — record editing as a first-class action

The per-language dashboard is re-sequenced and its name editing is promoted
from an inline add-only widget into reusable dialogs. New order: counters and
record-editing cards, then the GitHub-style activity (grid + recent changes),
then abbreviations, then the flagged-for-review queue.

### Types & API (`packages/types`, `apps/api`)

- New `CurrentLanguageRecordResponse` and endpoint
  **`GET /languages/:tag/currentRecord`** (`getCurrentLanguageRecord`) — the
  reference to a language's current `eu.leksis.language` record, so the browser
  can resolve and rewrite another language's record (to name it in this
  language) without pulling the whole dashboard. Read-only; reuses the same AQL
  the dashboard already runs for its language ref.

### Web (`apps/web`)

- **New `components/LanguageSearchBar.tsx`** — a reusable search over the known
  languages, matching by UI-locale name, endonym or BCP 47 code (the chip shown
  beside the name). Purely presentational; reused in the record dialogs and
  reserved for future call sites (e.g. the entry editor).
- **New `components/LanguageRecordDialog.tsx`** — edits a `eu.leksis.language`
  record and republishes it (full rewrite, rkey = tag) to the editor's own PDS,
  preserving untouched translations. Two modes: *self* (edit this language's own
  names — endonym plus the user's languages of interest and interface language,
  with the search bar revealing any other locale on demand) and *other* (name a
  language in this language, one translation at a time).
- **`pages/LanguagePage.tsx` reorganized**: the counters row gains an *Edit
  language record* card and a *Names in <language>* card (mode-B target picker);
  the activity grid + feed move directly under the cards; the old inline "The
  language's name" section is removed (the dialogs replace it). The
  to-be-completed counter/queue is renamed **Flagged for review**; its counter
  card is now clickable, opening a dialog with the full flagged list (all the
  entries the endpoint returns — capped server-side at 100, with the existing
  "…and N more" note when `todoCount` exceeds them), replacing the old inline
  list section. `onOpenLanguage` is dropped from `LanguagePage`'s props (the
  named-in list now edits records rather than navigating).

## Profiles & onboarding — interface language + languages of interest

A connected user now has a profile: their UI interface language and the
languages of interest shown first in the search bar. Both are gathered by a
first-run onboarding flow and editable later from the navbar. This graduates
two pieces of `localStorage` state (the UI language and the search shortlist)
onto the user's own PDS.

### Lexicon & types (`lexicons/`, `packages/types`)

- **New `eu.leksis.profile` lexicon** — singleton record (`key: "self"`)
  holding `{ interfaceLanguage, languages[], createdAt }`. Unlike
  language/entry, this is per-user configuration, **not dictionary content**:
  the AppView does not index it (no Jetstream collection, no ArangoDB doc, no
  endpoint). The browser reads/writes it directly on the user's own PDS. See
  ADR-0005.
- New contract `profile.ts` (`LeksisProfileRecord`, `LEKSIS_PROFILE_COLLECTION`,
  `LEKSIS_PROFILE_RKEY`).

### Web (`apps/web`)

- **Onboarding flow** (`components/OnboardingFlow.tsx`), rendered inside
  HomePage when a connected user has no profile yet: step 1 picks the interface
  language (pre-selected from `navigator.languages` where supported — English
  only today), step 2 picks languages of interest (multi-select over known
  languages + reachable "add a language" registering a new `eu.leksis.language`).
  Finishing writes the profile to the user's PDS.
- **Profile preferences dialog** (`components/ProfileDialog.tsx`), opened from
  the handle in the navbar: edits the same two settings and republishes the
  profile record. Each language row also links to that language's dashboard
  (`routes.navigateTo` — pushState + synthetic popstate so HomePage re-routes
  without a router), so the preferences list doubles as a way in.
- `SessionProvider` loads the profile after a session restores, applies the
  interface language from it, and exposes `profile` + `saveProfile`;
  `lib/profile.ts` does the PDS `getRecord`/`putRecord` (a `RecordNotFound`
  read is the onboarding signal).
- The search-bar shortlist now reads from `profile.languages` (single source
  of truth); the old `lib/shortlist.ts` localStorage helper is removed.
  `applyInterfaceLanguage`/`resolveLanguageCode` added to the i18n module.
- Shared `components/LanguageInterestPicker.tsx` powers the languages-of-interest
  multi-select in both onboarding and the profile dialog.

## Post-Loop 2 — Language dashboards, abbreviations & todo lists (released `v0.6.x`)

Every language gets its front matter: a dashboard page with counters, its
harvested abbreviations (conflict-checked), a review queue of entries whose
current version carries pending work, and an activity view. Pending work
itself becomes a per-task list.

### Lexicon & types (`lexicons/`, `packages/types`)

- **`todo` is now an array of strings** — one item per pending task, so
  several bots or editors each track their own on the same entry. The DB
  treatment is unchanged: absent/empty list → `todo: false`, any non-empty
  item → `true`. Breaking change absorbed by the bots-only
  reset-and-republish workflow (old records deleted, bots updated).
- **Annotation `short` is optional; `long` is the required half** — shared
  `#annotation` def, so grammatical categories and definition notes alike. A
  lone form is always the full one (nothing dangles on hover); the editor
  asks for the full form first.
- New contracts: `abbreviation.ts` (`AbbreviationView`,
  `annotationConflicts()`, `formatAbbreviationRef()`) and `dashboard.ts`
  (the dashboard response shapes).

### API & database (`apps/api`)

- **`abbreviations` read model** (ADR-0004): one doc per distinct
  (language, short, long) pair used by *current* entry versions — categories
  and definition notes alike, i.e. a dictionary's front-matter abbreviations
  section. Each doc lists the entryKeys using the pair (the count, and a
  maintenance pointer that stays DB-only — the API never exposes per-pair
  entry lists) plus `conflictsWith`: same-language docs sharing a short with
  a different long, or a long with a different short (a pair without a short
  never conflicts). Maintained by the firehose consumer on every version
  transition, deletion and promotion (`firehose/abbreviations.ts`); rebuilt
  wholesale by `db:init`; derived and disposable like `localLanguages`.
- **Entry version docs store their annotation pairs** so the model needs no
  PDS fetches at ingest — the deliberate doctrine widening recorded in
  ADR-0004.
- New endpoints: `GET /languages/:tag/abbreviations` (pairs + counts +
  conflicts) and `GET /languages/:tag/dashboard` (entries/todo counters, the
  capped todo queue, an activity feed — last 24 h padded to ≥ 10 items — and
  per-day activity counts over a year).
- New indexes: `entries["languageID","current"]`,
  `abbreviations["languageID"]` and `abbreviations["entries[*]"]`.

### Web (`apps/web`)

- **Path routing**: pages moved off query params — `/entry/<key>`,
  `/language/<tag>` — with the query string reserved for the search surface
  (`/?q=&l=`); legacy `?e=` links rewrite themselves. The search bar now
  persists on every page (hand-rolled History routing in `lib/routes.ts`;
  nginx's SPA fallback already covered deep links).
- **Language dashboard page**: counters, the to-be-completed queue linking
  to entry pages, the abbreviations section with ⚠ conflicts, a
  GitHub-style activity grid + recent-changes feed, the language's names —
  existing translations shown from the resolved `eu.leksis.language` record,
  new ones published as a full-rewrite record (rkey = tag) from the
  editor's own PDS — and the "languages named in this language" review list
  (from the existing `/languages?locale=` read model).
- **Entry page**: the language chip moved to the top right and opens the
  dashboard; the raw author DID replaced by an atproto.at source-record
  link; a pending-work panel lists the todo items; category and note chips
  carry ⚠ conflict flags.
- **Editor**: a todo-items section (prefilled when proposing, so tasks are
  cleared deliberately; `botSource` now survives proposals); abbreviation
  suggestions via datalists (most used first) with cross-prefill of the
  matching counterpart form; ⚠ conflict flags on chips; the full form comes
  first and is the only required half.

### Deferred

- **In-dashboard bulk rewrite of conflicting entries**: per-pair entry lists
  stay DB-only, so the browser cannot republish what it cannot list
  (ADR-0004 #3). Bots bulk-fix their own imports via `listRecords` on their
  own repos (leksis-ingest skill).

## Week 4 — Loop 2, Entries (released `v0.5.x`)

Dictionary entries exist: users publish `eu.leksis.entry` records on their
own PDS, the AppView indexes them for search, and an entry page renders the
record straight from its author's PDS.

### Lexicon & types (`lexicons/`, `packages/types`)

- **`lexicons/eu.leksis.entry.json`** (rkey = TID): `{ languageID,
  orthography[], categories[{short,long}], definitions[…], subject?,
  createdAt }`. Grammatical categories and definition notes share one shape
  — an ordered list of short/long annotation pairs ("n." / "noun",
  "arch." / "archaic"); a definition can carry several notes, an entry
  several categories, both freely reordered. The earlier drafts'
  entry-level freeform `grammaticality.notes` and per-definition `tag`
  string are gone.
- **Definitions are a flat list; each definition carries its coordinate**
  (`place`, decided 2026-07-16, superseding the first nested-group draft
  and, before it, the white paper's separate `structure: number[][][]`
  presentation field): `definitions[]` items are `{ place, notes, text }`,
  where `place` is 1–3 non-negative integers — one 0-based index per
  dimension, deepest last, so its length is the definition's own depth
  (`[0]` = first top-level definition, `[1, 0]` = first sub-definition of
  the second). Variable length keeps mixed depths expressible (a standalone
  "II." beside "I. 1."), and the raw record stays human-readable — no
  nested group nodes. Across the entry, places must be sorted in reading
  order, sibling indices contiguous from 0, and no place a prefix of
  another (shared validators in `packages/types/src/entry.ts`). Display
  numbering follows the deepest place length: one dimension → arabic
  (1. 2.), two → roman then arabic (I. 1.), three → letters, roman, then
  arabic (A. I. 1.). Coordinates are meaningful: future fields reference a
  definition by its place.
- **Entry identity is the `subject` field**: a record carrying
  `subject: at://…` (the record version it modifies) is a proposed new
  version of that record's entry; a record without one is a brand-new entry
  (homonyms stay possible). Decentralised — no AppView key baked into
  records.
- **Bot-maintenance fields** (2026-07-16): optional `todo` (freeform note
  on work the version still needs — the AppView indexes only its presence,
  as a boolean) and `botSource` (external-source URL/ID set by ingestion
  bots so a record maps back to its origin — record-only, never indexed).
  Documented for scrapers in `.claude/skills/leksis-ingest/`.
- `packages/types`: `LeksisEntryRecord`, `EntryAnnotation`,
  `EntryDefinition`, `EntryView`, `EntriesResponse`,
  `LEKSIS_ENTRY_COLLECTION`.

### API & database (`apps/api`)

- **The DB supports search; records hold the content.** The `entries`
  collection stores only what search needs — orthographies (plus a
  lowercased `search[*]` copy), the language tag, the record reference
  (`recordURI`/`cid`/`authorDID`), timestamps and `current` — never
  definitions or categories. Versioned like `languages`: many docs per
  `entryKey` (minted as `{lang}-{orthoSlug}-{hash}` from the creating
  record's URI), one current, previous versions archived, never deleted.
- **Ingestion** (`firehose/ingest-entry.ts`): validates the whole record
  (BCP 47 tag, non-empty orthography/definitions, well-formed annotation
  pairs; `todo`/`botSource`, when present, must be strings), resolves
  `subject` → existing entry (unknown subjects index as a new entry rather
  than being dropped), applies last-write-wins across authors with
  archival; idempotent on `recordURI + cid`. Each entry doc stores
  `todo: boolean` (the record's `todo` is non-empty after trimming) so
  needs-attention entries stay queryable without holding content. Jetstream
  `wantedCollections` now includes `eu.leksis.entry`. Definition validation
  checks each `place` (1–3 non-negative integers) and the whole-list
  invariants in one pass: sorted reading order, contiguous sibling indices,
  no place a prefix of another.
- **Entry deletion mirrors the network** (divergence from the
  languages-style archive-forever model, decided 2026-07-15): when a record
  is deleted from its author's PDS, its version docs are **removed** from
  `entries` — the entry version history lives on the network, not in this
  index; only language references archive forever, being structural to the
  app. If the deleted version was current, the most recently indexed
  remaining version is promoted back to current; deleting the last version
  removes the entry from search entirely.
- **`GET /entries?q=&l=`**: case-insensitive orthography prefix search over
  current entries, optionally language-scoped, exact matches first (limit
  50). **`GET /entries/:key`**: one entry's search view (404 when unknown).
- **`db:init`**: drops the never-used week-1 `definitions` and
  `translations` collections (only when empty — a non-empty obsolete
  collection is reported, not dropped); ensures `entries` indexes
  (`entryKey+current`, `recordURI`, `languageID+search[*]`). The
  `grammaticalCategories` frequency harvesting is deferred.

### Web (`apps/web`)

- **Entry editor is live** (`CreateEntryPanel.tsx` → `EntryEditorDialog`):
  submit publishes the record to the logged-in user's PDS via
  `createRecord` (fresh TID per version). Definitions each carry their own
  reorderable short/long note chips (same interaction as the category
  chips, one shared `AnnotationEditor`); the freeform grammar-notes box and
  the definition tag field are gone. The dialog doubles as the
  proposal editor: given `initial` + `subject` it prefills from the current
  record and publishes a full-rewrite modification.
- **Hierarchical definition editor** (`lib/definition-tree.ts`): the editor
  works on a tree (groups make the movement rules natural) and serializes
  to/from the record's flat, place-carrying shape — places are re-derived
  from tree positions on save, so they always satisfy the ingest
  invariants. Arrow controls on each definition: ↑/↓ move it through the
  visual sequence and cross group edges (entering a neighbouring group at
  its head/tail, leaving the parent group at its edges), → nests it one
  dimension deeper (wrapping it in a new group), ← brings it back up;
  groups are never created or deleted explicitly — they emerge from → and
  vanish when emptied. Every definition and group shows its live dictionary
  label (1. / I. 2. / A. II. 1.) recomputed from the tree's depth, and the
  entry page renders each definition flat with its full place label and
  depth indentation (`DefinitionList` in `EntryPage.tsx`).
- **Search results are real** (`SearchResults.tsx`): `GET /entries` renders
  matches (orthographies + language), each opening the entry page; after a
  creation the list polls until the record round-trips PDS → Jetstream →
  ArangoDB.
- **Entry page** (`pages/EntryPage.tsx`, URL `?e=<entry-key>`, same
  no-router History-API pattern; search params survive, so back restores
  the results): fetches the search view from the API, then resolves the
  record content **directly from the author's PDS** (`lib/atproto-record.ts`:
  DID document via plc.directory / did:web → PDS → `getRecord`, public, no
  auth — the API stays out of the content path). Renders spellings,
  category chips, definitions with their notes, current author, and the
  "Propose changes" flow with its own index-sync polling.
- **Homonyms on the entry page** (2026-07-16): a section listing other
  current entries of the same language sharing a written form (reusing
  `GET /entries` narrowed to exact orthography matches, keyed chips with
  the entry key for disambiguation), so readers can hop between homonyms —
  which coexist by design — and spot accidental duplicates. Best-effort:
  a lookup failure never blocks the entry itself.

### Infra (`docker-compose.yml`, `Caddyfile`) — bot PDS

- **Self-hosted AT Proto PDS for scraper bots** (2026-07-16): new `pds`
  service (`ghcr.io/bluesky-social/pds:0.4`, data in the `pds_data` named
  volume) at `pds.leksis.eu`, bot handles directly under the apex
  (`PDS_SERVICE_HANDLE_DOMAINS=.leksis.eu`, e.g. `wikbot.leksis.eu` —
  covered by the existing `*.leksis.eu` DNS wildcard, with Caddy on-demand
  TLS gated by the PDS's `/tls-check`). No app changes: the PDS announces
  itself to the Bluesky relay (`PDS_CRAWLERS`), so bot records reach the
  AppView through the existing Jetstream consumer like any other account's.
  This does make record delivery depend on the relay crawling third-party
  PDSes — standard, but now a recorded dependency. The PDS is public (as
  federation requires) except `com.atproto.server.createAccount`, which
  Caddy restricts to `AARDVARK_ALLOW_IPS`; both Caddy addresses fail closed
  (internal listeners) until set in `.env`, and three new required secrets
  (`PDS_JWT_SECRET`, `PDS_ADMIN_PASSWORD`, `PDS_PLC_ROTATION_KEY`) are
  documented in `.env.example` — **the compose stack refuses to start until
  they are set**.

## Week 4 prep (pre-Loop 2 groundwork, released in `v0.4.x`)

Frontend-only groundwork for Loop 2 (entries), plus a language-indexing
split in the AppView (below). No lexicon changes.

### API & database (`apps/api`, `packages/types`)

- **Languages split into two collections**
  (`firehose/ingest-language.ts`, new `firehose/local-languages.ts`):
  `languages` now stores only the record reference (`recordURI`, `cid`,
  `authorDID`), the tag, timestamps, and the `current` flag — no name
  content. The names live in a new **`localLanguages` read model**: one doc
  per locale (`_key` = locale tag) listing every available language as
  `{ tag, endonym, name? }`, where `name` is that language's name in the
  doc's locale when its record provides one. The read model is re-synced
  whenever a version becomes `current: true` in `languages`, so the future
  voting mechanism can change what's current without touching the sync.
  Locale docs are created the first time any record names the locale (the
  required endonym guarantees each language gets its own), and deleted
  languages stay listed (removal deferred to voting; `languages` keeps
  archiving with `current: false`).
- **`GET /languages` takes `?locale=`** and serves the matching
  `localLanguages` doc; unknown/absent/invalid locales fall back to a
  tag + endonym listing assembled from each language's own doc.
  `LanguageView` is now `{ tag, endonym, name? }` and `LanguagesResponse`
  carries the resolved `locale`.
- **`db:init`** creates `localLanguages` and idempotently backfills it from
  pre-split language docs that still carry `translations` (legacy fields are
  left in place — nothing is migrated destructively).

### Infra & tooling (`Caddyfile`, `apps/api`)

- **Cross-origin API access for local frontends** (`Caddyfile`,
  `apps/api/src/index.ts`): Caddy is now the sole CORS authority for `/api/*`.
  Same-origin `leksis.eu` traffic is untouched from any IP; a developer's
  locally-run frontend (e.g. `http://localhost:5173`) may call the production
  API cross-origin **only** from a source IP in `AARDVARK_ALLOW_IPS` (the
  allowlist is reused), and Caddy echoes the request Origin plus answers the
  preflight for those IPs. All other cross-origin callers get no CORS headers,
  so the browser blocks them. The API's Hono `cors()` and the now-unused
  `WEB_ORIGIN` env were removed to avoid a duplicate `Access-Control-Allow-Origin`.

### Web (`apps/web`)

- **Restyle after atproto.at**: theme tokens moved from slate/indigo to pure
  neutrals + Bluesky blue (`#1185fe`) as the sole accent; monospace styling for
  technical identifiers (language tags, the tag input). Pure token change —
  no component markup touched for the retheme.
- **Language creation dialog sizing fix**: bottom sheet on phones / centered
  card from `sm:` up, height capped with `dvh` (mobile browser chrome no
  longer hides the buttons), wider (`max-w-lg`), responsive padding, and
  translation rows that survive narrow screens (compact `×` remove button).
- **Word search flow** (`components/SearchResults.tsx`,
  `components/CreateEntryPanel.tsx`): the search bar now submits. Default
  scope is **all languages** when no language is selected; results render
  below the bar. The (for now honestly empty) result list is always followed
  by a "create this word" panel prefilled with the searched word and
  carrying the week-4 slice of the `eu.leksis.entry` lexicon:
  `orthography[]`, `grammaticality.{categories,notes}`, and
  `definitions[{tag,text}]`. When the search had no language scope, the panel
  offers its own language picker rather than requiring a prior selection.
  The submit stays disabled until Loop 2 lands the record write + AppView
  ingestion.
- **Create-entry panel → dialog + grammatical-category tags**
  (`components/CreateEntryPanel.tsx`): the always-expanded panel became a
  call-to-action button that opens an `AddLanguageModal`-style dialog (bottom
  sheet on phones, centered card from `sm:` up). Grammatical categories are
  now entered as a short/long pair ("n." / "noun") instead of one
  comma-separated field; each added pair renders as a chip above the inputs
  showing the short form, with the full form in a tooltip on hover/focus (or
  tap on touch screens). Chips are removable (`×`) and reorderable by
  dragging — hand-rolled with pointer events (mouse + touch, arrow keys for
  keyboard), no drag-and-drop dependency added. The chip order is the future
  order of the record's `grammaticality.categories` array; how the short/long
  pair maps onto the lexicon's `categories: string[]` is a Loop 2 decision
  (pairs on the record vs. a per-language abbreviation table).
- **Search state in the URL**: submitting mirrors the query and scope into
  `?q=<word>&l=<tag>` via `history.pushState` (e.g. `/?q=entry&l=en-US`), so a
  search is a shareable/reloadable link; back/forward restores it via
  `popstate`. No router dependency added — plain `URLSearchParams`/History API,
  matching the app's single-page shape.

## Week 3 — Loop 1, Languages (released `v0.3.x`)

The first dictionary loop: languages exist, and **firehose consumption
starts**. Users create languages as `eu.leksis.language` records on their own
PDS; the AppView indexes them from Jetstream into a versioned ArangoDB
collection; the search bar's language selector is now real. See
`docs/adr/0003-language-records-and-firehose.md` for the decisions (dedicated
lexicon, Wikipedia edit model, Jetstream, syntax-only tag validation).

### Lexicon & types

- `lexicons/eu.leksis.language.json`: `{ tag, translations[{languageID,
  translation}], createdAt }`; rkey = the tag; endonym (self-translation)
  required, so the list is human-readable from the very first record.
- `packages/types`: `LeksisLanguageRecord`, `LanguageView`,
  `LanguagesResponse`, `LEKSIS_LANGUAGE_COLLECTION`, and a shared BCP 47
  syntax validator (`isValidLanguageTag` / `normalizeLanguageTag`) used
  identically by the web form and the AppView ingestion.

### API (`apps/api`) — first AppView behaviour

- **Jetstream consumer** (`src/firehose/jetstream.ts`): native Node-22
  WebSocket, `wantedCollections=eu.leksis.language`, cursor persisted in the
  new `firehoseState` collection (resume on restart), capped-backoff
  reconnection; runs inside the api process and can never take down HTTP.
- **Ingestion** (`src/firehose/ingest-language.ts`): validates and normalizes
  records (invalid → logged and skipped), then applies last-write-wins **across
  authors** with archival — the previous version of a tag is marked
  `current: false`, never deleted; record deletion archives the current
  version. Idempotent on `recordURI + cid`, so cursor-replay overlap is safe.
- `GET /languages`: current languages (tag, translations, createdAt), 503
  when ArangoDB is unreachable.
- `db:init`: adds `firehoseState` + a persistent `["tag", "current"]` index on
  the now-versioned `languages` collection.

### Web (`apps/web`) — language selector + creation flow

- `components/LanguageSelector.tsx`: native select showing a "recently used"
  shortlist first (localStorage, promoted on every selection), then all
  languages (endonym display, tag fallback), then "＋ Add a language…".
- `components/AddLanguageModal.tsx`: tag field (live syntax validation +
  advisory duplicate check), endonym field, optional translations in existing
  languages; writes the record straight to the user's PDS
  (`putRecord`, per ADR-0002 — the API never sees it).
- Post-create UX: optimistic insert + shortlist promotion, then polling until
  the record round-trips PDS → Jetstream → ArangoDB.
- `lib/api.ts`: first web→API client (`/api` same-origin in prod, `:8080` dev).

## Week 2 — AT Proto OAuth + frontend foundations (released `v0.2.0`)

Real login replaces the Week-1 placeholder: visitors get a landing page that
introduces the project, and connecting authenticates against their own PDS via
AT Protocol OAuth. Connected users land on a search shell (the search itself
arrives with the dictionary loops). The frontend also grows two foundations —
internationalisation and theming — chosen now to avoid a later refactor. **No
backend changes** (see `docs/adr/0002`): the API stays a pure indexer.

### Authentication — browser-only AT Proto OAuth

- `@atproto/oauth-client-browser` + `@atproto/api`. The SPA is the OAuth client;
  DPoP-bound tokens live client-side. See `docs/adr/0002-atproto-oauth-client-model.md`.
- `src/auth/client.ts`: loads the `BrowserOAuthClient` — a hosted
  `client-metadata.json` in production, the `127.0.0.1` loopback client in dev.
- `src/auth/SessionProvider.tsx`: restores/processes the session on load and
  exposes `{ status, did, handle, agent, signIn, signOut }` via `useSession`.
- `public/client-metadata.json`: production OAuth client id
  (`https://leksis.eu/client-metadata.json`), served by the existing web/nginx
  container — no API route added.
- Local dev pinned to `http://127.0.0.1:5173` (AT Proto loopback callback always
  targets `127.0.0.1`): Vite binds that host, and `ensureLoopbackHost()`
  redirects any `localhost`/`::1` load to it before rendering, so the whole flow
  shares one origin. Production over HTTPS is unaffected.
- Removed the Week-1 placeholder `src/lib/session.ts`; corrected the shared
  `Session` type in `packages/types` (no httpOnly cookie — browser-only).

### Internationalisation (`react-i18next`)

- `src/i18n/`: i18next init, `en.json` resource (all UI copy lives here, keyed by
  feature — `landing.*`, `auth.*`, `search.*`, …), and a typed-key augmentation
  so `t()` keys are checked at compile time.
- `SUPPORTED_LANGUAGES` registry + `setLanguage()` (persists + syncs `<html lang>`).
  English only for now; adding a locale is a JSON file + a registry entry, no
  component changes.

### Theming (CSS-variable tokens)

- `src/index.css`: semantic colour tokens (`--color-canvas`, `--color-content`,
  `--color-primary`, …) as RGB channels; Tailwind maps them so opacity modifiers
  still work. Components paint only with tokens.
- `src/theme/`: a `THEMES` registry + `ThemeProvider` that flips
  `<html data-theme>` and persists the choice. Only the default `light` theme
  ships; adding one (dark, high-contrast…) is a CSS block + a registry line.

### Interface

- Mobile-first throughout (Tailwind base = mobile, `sm:` enhances).
- `pages/LandingPage.tsx`: project pitch + PDS login form.
- `pages/HomePage.tsx`: connected search shell (language scope + term box, inert
  until the dictionary loops wire it up).
- `components/`: `Header` (brand + connected user/logout), `Footer`,
  `LoadingScreen`, `Brand`. `App.tsx` routes loading/landing/home off session.
- `.claude/launch.json`: dev-server config for the preview tooling.

## Week 1 — Foundation & CI/CD (released `v0.1.x`)

Scaffolds a deployable empty shell with a green pipeline. No dictionary
features yet. The only visible UI is a placeholder PDS connect/disconnect
toggle (real AT Proto OAuth is week 2).

### Monorepo

- Turborepo + npm workspaces with three packages: `apps/web`, `apps/api`,
  `packages/types`.
- Root config: `package.json`, `turbo.json`, shared `tsconfig.base.json`,
  flat-config `eslint.config.js`, `.gitignore`, `.dockerignore`.
- `packages/types`: shared `HealthResponse` and `Session` types, consumed by
  both apps via the `@leksis/types` workspace alias.

### API (`apps/api`) — Hono + Node

- Hono server with `GET /` and `GET /health` (reports DB connectivity).
- `src/db.ts`: shared ArangoDB connection (`arangojs`) from env vars + a
  `pingDb()` liveness check.
- `src/scripts/init-db.ts`: idempotent bootstrap that creates the `leksis`
  database and the first empty collections — `languages`, `entries`,
  `definitions` (documents) and `translations` (edge).
- `.env.example` documenting required ArangoDB credentials.

### Web (`apps/web`) — React + Vite + Tailwind

- Vite + React 18 + TailwindCSS scaffold.
- `src/lib/session.ts`: `useSession` hook persisting connect/disconnect state
  to localStorage (placeholder; OAuth-ready shape for week 2).
- `src/App.tsx`: header with connection status, a "Connect your PDS" handle
  form, and a "Disconnect" button. Everything past login is intentionally blank.

### Deployment & CI/CD

- Single-VPS architecture (see `docs/adr/0001-database-hosting.md`):
  `docker-compose.yml` orchestrates four containers — Caddy (reverse proxy,
  the only public service), web (nginx static), api (Hono via `tsx`), and
  arangodb. ArangoDB is internal-only, never published to a host port.
- `Caddyfile`: routes `/api/*` → api (prefix stripped, so same-origin = no
  CORS), everything else → web. HTTP by default; flip `SITE_ADDRESS` to the
  domain for automatic HTTPS.
- `apps/api/Dockerfile` (runtime `tsx`) and `apps/web/Dockerfile`
  (Vite build → nginx), both building from the repo root.
- `apps/web/nginx.conf` with SPA fallback.
- Root `.env.example` for compose secrets (`ARANGO_ROOT_PASSWORD`, etc.).
- `.github/workflows/ci.yml`: typecheck + lint + build on every push/PR;
  deploy to the VPS over SSH **only on a `v*` version tag** (checkout tag →
  `docker compose up -d --build` → `db:init`).

### Database

- Self-hosted **ArangoDB Community Edition** (`arangodb/arangodb:3.12`) in the
  compose stack with a persistent named volume `arango_data`. Replaces the
  ArangoDB Cloud free-tier assumption, which turned out to be ~€58/mo
  always-on. Collections created by `npm run db:init`.

### Changed

- **Dropped Fly.io** in favour of a single VPS (deployer's preference + cost).
  Removed `apps/api/fly.toml` and `apps/web/fly.toml`.
