# ADR-0016 — Layer 5: inflection rules in their own lexicon

- **Status:** Accepted
- **Date:** 2026-08-16
- **Deciders:** Alan Kersaudy
- **Completes:** the morphology arc's layer 5, the last layer before export.
  Authoritative over `docs/design/paradigm-rules.md` and over the "Layer 5 —
  Rules" section of `docs/design/grammatical-tagging.md` wherever they disagree.
- **Builds on:** ADR-0006 (primitives), ADR-0007 (inherence), ADR-0008 (axes),
  ADR-0009 (layout — the cell space these rules fill), ADR-0015 (the ingest gate
  this layer extends to a second lexicon).
- **Relates to:** `docs/design/weighted-voting.md` §2.1 (paradigms are the sixth
  upgradable collection), `.claude/skills/leksis-testset` §3.5 (the fixtures).

## Context

Four layers had built a **cell space** and left it empty. A language could say
what a word *is* (layer 2), what its forms *vary over* (layer 3) and what the
table *looks like* (layer 4) — and then every cell had to be typed out by hand,
on every entry, by somebody. For a regular noun in a language with six cases and
three numbers that is seventeen spellings a contributor writes to say nothing
that the language could not have said once.

The arc's premise is the opposite: **the language declares the morphology, and
the entry carries only what cannot be derived**. That is invariant 5 — paradigm
edits must never touch entry records — and it is what makes a wrong rule fixable
in one place instead of across every entry on every contributor's PDS.

The three questions this layer had to answer were where the rules live, what
they may say, and who runs them.

## Decision

### 1. A lexicon of its own, keyed on (language, selector)

`eu.leksis.paradigm` is a record type, not a field on the language record — the
one place the arc breaks its own "one self-contained `grammar` object" pattern,
and deliberately. Layers 0–4 share one object because they *reference* each
other: unbinding an atom orphans every higher row, so a single write is what
keeps the cascade consistent. Rules reference the layers below but nothing
references rules, so the coupling argument does not reach them — and three facts
push the other way. Rules are **large** (a Latin verb is hundreds of rows against
a grammar object's tens), they are written **per inflection class** rather than
per language, and they are edited at a **different cadence** by different people.
Putting them on the language record would mean every rule edit republishes every
binding, on a record that is already hot.

Identity is `rkey = {languageID}-{hash16(canonical key of selector)}`, computed
from the record's own fields — the `eu.leksis.source` precedent, with a hash
standing in for the OCLC number because a category has no catalogue. Ingest
recomputes it and **refuses a mismatch**. Three properties fall out: every
author's paradigm for one category lands on one identity by construction, no
repository can hold two paradigms for one category, and `selector` is therefore
**immutable per identity** — changing the category is publishing a different
paradigm, not editing this one.

The hash is FNV-1a, 64-bit, and **not cryptographic on purpose**. It must be
synchronous, because the editor computes a key while building a record and
WebCrypto's digest is a promise; and it must be *one* implementation, because the
browser minting the key and the AppView recomputing it have to agree forever. A
crafted collision buys an attacker nothing — paradigms are last-write-wins across
authors and anybody may publish for a selector directly — so honest collisions
are the only real risk, and a language has tens of paradigms against 2⁶⁴ keys.

### 2. What a rule may say, and what it deliberately may not

A rule is `{coords, base?, match?, strip?, add?, prefix?}` — Hunspell's affix
shape, no more. `coords` is the target cell; `base` is another cell (a `requires`
row or an earlier rule's target), absent meaning the lemma; `match` is a regex the
**end** of the base must satisfy, anchored by the generator so a pattern carries
no anchor of its own.

Four consequences worth stating:

- **Several rows may target one cell**, and the **first matching row in author
  order wins**. That is Hunspell's normal shape (`-y → -ies` beside `-s`), and it
  makes rule order *semantics* — which is why the editor gives the list ↑/↓/×
  and says so.
- **A cell no row matches is not an error.** It is an empty cell. The only error
  state a paradigm has is a missing required base form.
- **Syncretism is expressed, not expanded.** A rule targeting `Person=1,2`
  produces **one** form whose address spans both cells; the table merges them
  under a spanning header rather than printing the form twice. Deliberately not a
  wildcard: a form covering an axis and a form nobody entered must never look the
  same to a reader.
- **`requires` skips, it does not half-generate.** A paradigm whose principal
  part the entry has not supplied produces *nothing* for that entry, and the
  entry lands on the language dashboard's missing-forms queue carrying the rule
  author's **own message, verbatim**. That message lives in the rule rather than
  in the interface because the person who wrote the rule is a speaker of the
  language — which is what lets the queue be homolingual with no translation
  layer anywhere in the system.

What the algebra does **not** have is anything speculative. `prefix.strip/add`
covers mutations and augments; templatic and infixing morphology are not
addressed, and the trigger to extend is a real language's paradigm that cannot be
written, not an anticipated one. The record shape can grow additively.

### 3. One generator, and the AppView is not the source of truth

`generateForms(paradigm, facts)` in `packages/types` is the only place an
inflected form is derived (invariant 6). The browser calls it to render, the
firehose consumer calls it to expand the search index, and the layer-6 exporters
will call it too. It is **total** — a malformed `match` is a validation issue and
never a runtime throw, a base cycle yields nothing rather than recursing — because
the same function runs inside a single sequential writer where a throw costs more
than a wrong answer.

**Rules are content.** The read surface `GET /languages/:tag/paradigms` serves
pointers only: `paradigmKey`, `selector`, `recordURI`, `cid`, `authorDID`, most
specific selector first. A reader gets its morphology from the record, resolved
from the author's PDS through a session cache — so a language's morphology has
exactly one source of truth and the index is not it.

The consumer's copy is the deliberate exception, and the line is narrower than
"reference-only": **the consumer caches what it needs to compute, the read
surface serves pointers only.** Its `paradigms` doc holds `rules`, `requires` and
`selectorAtoms`, because expanding an entry at ingest cannot put a stranger's PDS
in this AppView's write path — the same argument that put `inherent` on the
language doc at slice 2. The endpoint returns none of it, not even the label.

### 4. A paradigm matches an entry by containment, on its **inherent** bundle

The entry doc caches `inherentAtoms`: the part of speech, plus every feature the
language declares **inherent** for the category carrying it. A paradigm reaches an
entry when the entry's inherent bundle contains the selector; several may reach
one entry, and the **most specific selector wins** each cell they both fill.

Filtering on the *inherent* bundle rather than on all of `categories` is the
whole point. `categories` is lexeme-level but nothing stops a record from
carrying a form's feature there, and an atom that is not inherent is noise a rule
must not select on. Storing the filtered set is also what tells the expansion job
precisely which entries a new rule reaches — an indexed intersection, not a scan.

Display precedence in a cell, most authoritative first: **the entry's own
`otherForms`**, then a **generated form** rendered visually distinct, then the
layer-4 states — excluded (em dash) against nobody-filled (faint dot). And the
layer-4 rule "a block no form fills is not drawn" is **revised exactly as
ADR-0009 predicted**: a block that only generation fills is now drawn, because
generation is precisely what makes an empty table stop being empty.

### 5. The ingest gate extends to a second lexicon

`paradigmIssues` is `grammarIssues` for this record: five kinds (`empty-rules`,
`unknown-base`, `base-cycle`, `invalid-match`, `empty-message`), **empty is the
condition for publishing one and the condition for indexing one — the same
condition, checked twice**, which is ADR-0015 generalised rather than re-argued.

What it deliberately does **not** judge is anything the *language* record says. A
selector or a coordinate nobody declared is a contradiction between two records,
which ADR-0015 indexes and contests rather than refuses — and refusing it would
create an ingest-order dependency, since a paradigm may legitimately arrive
before the grammar it addresses. Such a paradigm is simply **inert**: it matches
no entry, or addresses no cell. The Paradigms tab **lists** inert paradigms under
their own heading and does not diagnose them; surfacing them as a worklist is
still open (design note §7.3), and answering it in passing would have been the
mistake ADR-0015 was written about.

### 6. The rule editor's primary door is the grammar dialog, not the empty cell

The design note put the editor behind "an empty cell of the layout (and a
dashboard door)". **That is inverted, and slice 5 inverted it.** The cell door
cannot cold-start a paradigm: `EntryParadigm` renders nothing when an entry has
no forms at all, and a block none of whose cells hold a form is not drawn — so on
the entry that most needs rules, a regular word whose author wrote out nothing,
there is no cell to click. A door that appears only once the table is already
half-filled cannot be how a language declares its morphology.

So the primary interface is a **Paradigms tab in the grammar dialog**, added
after Layout: layer 5 is a layer of the cascade like the four before it, and it
belongs where the other four live, reached from the same door on the language
dashboard, with each layout row a list item leading to that category's paradigms.
The empty-cell popover is a **complement**, built in the same slice and opening
the same component — and it offers two things side by side, because the choice it
exists to present is exactly "is this word irregular, or is this how the language
works?"

The editor is a **standalone stacked dialog**, not a level of the grammar dialog:
it publishes a different record, with its own issue gate, its own cid guard and
its own footer. One draft per publish button is how a contributor does not lose
an edit.

## Consequences

- **The API cost was one endpoint for the whole layer** — `GET
  /languages/:tag/paradigms`, predicted at layer 4 — plus the `paradigms`
  collection and two cached fields on `entries`. Slices 4, 5 and 6 added
  **nothing**: the zero-cost pattern of layers 2–4 held for the reader, the
  editor and the fixtures, and the `cid` the editor's concurrency guard needed
  was already on the pointer.
- **A rule edit re-expands a language.** That is the price of inflected-form
  search, and it is paid by the consumer, not by any contributor's PDS. Nobody
  republishes anything.
- **A paradigm's blast radius is every entry of a category**, which makes version
  history *more* important here, not less — and makes this the sixth collection
  the voting mechanism will act on.
- **`inherentAtoms` goes stale** when the language record's `inherent` rows
  change. v1 refreshes per entry on republish; a language-wide recompute trigger
  is deferred until a real language's grammar churns (design note §7.2).
- **The browser must apply the same containment filter as the consumer**, and for
  a while it did not — the reader merged every paradigm of a language into every
  entry, so a verb conjugation ran over the nouns and the page disagreed with the
  search index. Found by building the fixtures, which is what a testset slice is
  for. The filter now lives in `apps/web/src/lib/paradigms.ts` beside the
  resolver, applied by the entry page, because **only a caller holding an entry
  can answer the question** — the rule editor's live preview has no entry, its
  draft is by construction the paradigm for the category being previewed, and
  putting the filter inside the shared renderer silently emptied that preview.
- **Five open questions stay open**, and the interfaces are built so that none of
  them is answered by accident: per-lexeme defectiveness (the popover grows no
  "this form does not exist" control), language-grammar drift, surfacing inert
  paradigms, prefix/infix expressiveness, and equal-specificity conflicts between
  paradigms.

## Action items

- [x] `lexicons/eu.leksis.paradigm.json`, the shared types, the identity scheme,
      `paradigmIssues` and the generator (slice 1).
- [x] The `entries` reshape — `inherentAtoms`, record-origin `otherForms` rows,
      the new indexes, the search filter and form-hit rendering (slice 2).
- [x] Ingest, the `paradigms` collection, `GET /languages/:tag/paradigms`, the
      expansion job and the dashboard missing-forms queue (slice 3), verified by
      `apps/api/src/scripts/verify-paradigms.ts` — 42 checks against a local
      ArangoDB.
- [x] The reader (slice 4), verified by
      `apps/api/src/scripts/verify-paradigm-reader.ts` — 19 pure checks over the
      merge, the spanning and the geometry.
- [x] The rule editor, the Paradigms tab and the empty-cell door (slice 5).
- [x] The fixture set (slice 6): `scripts/fixtures/` and
      `scripts/publish-fixtures.ts`, three quarantined languages, 25 entries,
      three sources and five paradigms, published live and gated on the AppView's
      own validators. Coverage-matrix rows P-01…P-12, L-42, L-43 and U-60…U-71
      added to `leksis-testset`.
- [x] Browser pass against the published fixtures: generation, override, empty
      vs excluded, nested and generation-only blocks, syncretism spanning, named
      vs decomposed block captions, the flat-list fallback, the missing-forms
      queue, the Paradigms tab, the locked selector, the live preview, both
      defect gates, Escape stacking, and the empty-cell door.
- [x] The reader's containment filter, found by that pass and fixed.
- [ ] **Publish the lexicons.** `scripts/publish-lexicons.mjs` has not been run
      since `grammar.layout` shipped, and now owes `eu.leksis.paradigm` too.
      Inherited from ADR-0015, not created here.
- [ ] The editor's **own** publish path end to end — the set was published by
      script, so the dialog is proven up to the enabled button (U-71), and the
      cid guard has never refused a real stale write.
- [ ] `qto`'s **repair** half (U-16): the defect list renders, but nobody has
      walked the fourteen repairs back to a publishable record.
- [ ] Mobile at 375px for the tab and the editor (U-70).
