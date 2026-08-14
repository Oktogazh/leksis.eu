# ADR-0014 — The source is a record, the citation is a number

- **Status:** Accepted
- **Date:** 2026-08-14
- **Deciders:** Alan Kersaudy
- **Relates to:** ADR-0003 (one small lexicon per loop; the precedent for a record
  keyed on its subject's natural global identifier — there the BCP 47 tag, here
  the OCLC number), ADR-0004 and ADR-0010 (a derived read model caching only what
  a list row needs), ADR-0013 (the immediate style precedent: decide *which half*
  of a body of knowledge earns a schema), and
  `docs/design/sources-and-examples.md`, which this ADR graduates.

## Context

"Example sentences" had sat in the deferred-fields list since Loop 2, and it is
the first thing a reader of a low-resource-language dictionary actually wants:
an attestation. A definition asserts what a word means; an example shows
somebody using it, and — if it is cited — shows *where*, which is the difference
between a claim and evidence.

The feature only looked simple. The hard question was not "where does the
sentence go" (a definition leaf, obviously) but **where the citation lives**, and
that question has a forcing answer.

**Duplicating a citation is unfixable, not merely untidy.** Suppose each example
carried its own citation string. A mistyped title, or a citation style somebody
wants to correct, would then have to be fixed in every entry that quotes the
work — and those entries live on **strangers' PDSs**. We cannot rewrite them, and
neither can the person who noticed the mistake. The usual DRY argument is about
maintenance effort; in a decentralised dictionary it is about whether a
correction is *possible at all*. So the citation has to live in one place per
work, and the entry has to point at it.

Pointing at it, though, immediately conflicts with a rule this project applies
everywhere else. Relations and cognates pin a **record URI** — a specific version
of a specific entry — because the referent's *content* drifts, and drift is
exactly what those layers must detect. A book does not drift. Worse, requiring a
record URI would mean a sentence could not be cited until somebody had described
the work, which inverts the order in which people actually work: you quote the
dictionary you are holding, and describing it is a separate, optional act of
tidying that someone else may well do.

Two further constraints shaped the result. Bibliographic metadata has a **global
registry** (OCLC/WorldCat) whose numbers are stable identifiers the project did
not have to invent — but many of the sources most worth citing for a
low-resource language (pamphlets, local editions, manuscripts) have **never been
catalogued**, so the registry can never be a gate. And the project's own scope
test says a new kind of linguistic knowledge becomes a **record**, not a table
only admins can write.

## Decision

### The OCLC number is the identity; the record is the description

**`eu.leksis.source`** is a new lexicon whose **rkey is the normalized OCLC
number**, following `eu.leksis.language`'s tag rather than the TID-plus-`subject`
pattern of entries, relations and cognates. The subject of the record has a
natural global identifier, so the identifier *is* the key.

Three consequences follow directly, and all three are the point rather than side
effects:

- **No `subject` field.** Identity comes from (collection, rkey), so every
  author's record for one work shares a key and forms that work's ladder —
  last-write-wins now, votable later. Records prove authorship, not ownership,
  as everywhere else.
- **One record per work per repo**, by construction. The key cannot hold two
  descriptions of one book.
- **The key is strict, the field is lenient.** The record's own `oclc` field must
  denote the same work as the key, but it is normalized before comparison while
  the key must already *be* the normal form. A zero-padded MARC export is
  therefore indexed rather than discarded, and a repo still cannot end up with
  two keys for one work.

`normalizeOclc` (`packages/types/src/source.ts`) is the single implementation,
used by the record key, the record's own field, ingest's key-equality check and
the `/sources/:oclc/…` route alike. It strips the `(OCoLC)` wrapper, the
`ocm`/`ocn`/`on` prefixes, interior whitespace and leading zeros, and caps at 16
digits. It is deliberately **fail-closed** — anything it cannot read returns
null rather than guessing, including non-ASCII digit forms — because a false
*merge* fuses two works into one identity while a false *reject* only asks the
contributor to retype.

### A citation references the number, never a record URI

An example's `source` carries `{oclc, locator}` and nothing else. This is the
deliberate opposite of the relation/cognate rule, and the asymmetry has a reason:
those layers pin a version because the referent's content drifts and the drift
matters; **a work's identity never drifts**, so pinning would buy nothing and
cost the two properties that make the scheme work.

- **A citation is valid before its referent exists.** You may cite a book nobody
  has described, and it resolves the day somebody does. This is the same
  decoupling as an unresolved relation side, one altitude further out: the
  reference is legal before the referent is described.
- **A citation can only degrade, never break.** Every failure mode ends at "the
  reader sees the bare number" — which is still the truth, and still enough to
  find the book.

**Everything a reader sees of the work renders from the source record**: the
`citation.short` form, with `citation.long` on hover. The entry stores the number
and the locator. That is the DRY constraint from the Context made structural.

### The locator is free text

`"p. 142"`, `"s.v. gwerzenn"`, `"§4"`, `"f. 12v"`, `"14:03"`. A `page: integer`
would be false precision the moment the source is a dictionary (headword), a
manuscript (folio) or a recording (timestamp) — the same judgement ADR-0013 made
about etymology, applied to a much smaller field. `year` is a string for the
same reason: real bibliographies carry `"c. 1850"` and `"1904–1911"`.

### An example is content, so the AppView does almost nothing with it

`definitions[].examples` is record-only, resolved from the author's PDS with the
rest of the definitions, and **never stored in ArangoDB**. The slice that added
the feature the whole design exists for cost **no collection, no endpoint and no
`db:init` change**. The only thing the AppView does with an example is refuse a
malformed one.

- **Leaves only.** An example exemplifies one sense, and a group node is a
  heading with no sense of its own — the same asymmetry as `text`.
  `validateDefinitions` gains an `example-rule`, strict at ingest and healed
  leniently in the web parser, exactly like the text rule. Only the group half of
  the rule exists: a leaf with no examples is the ordinary case, not a defect.
- **`source` is optional; everything inside it is not.** An unsourced example is
  a legitimate lexicographic object — a constructed illustration, or one heard
  rather than read — so its absence means "no source", never "the citation is
  missing". A *cited* one must say which work; `locator` stays optional because a
  whole work can be the source.
- **Malformed is refused, not dropped, at ingest.** A number this AppView cannot
  normalize is one no reader could resolve, and silently discarding it would
  publish an entry whose citation vanished with nobody told. The web parser is
  the lenient twin: it drops the citation and keeps the sentence, because an
  unsourced sentence is a thing we are happy to show.

### Sources get a versioned, reference-only collection with two deliberate caches

`sources` mirrors `languages` (many docs per key, one `current: true`) plus the
`entries` search idiom. Two fields bend the reference-only rule the way
`localLanguages` already does, and both are caches of the current record rather
than sources of truth, refreshed on every version transition:

- **`citation`**, because a list of fifty search hits cannot pay fifty PDS round
  trips to print its rows.
- **`search[]`** — lowercased citation forms, title and author — because prefix
  matching needs something lowercased. Title and author are therefore
  **searchable but never served**: search reaches them, the client resolves the
  record for the content.

Four indexes, no derived or edge collections: a source reference is resolved by
key, never traversed.

### Deletion archives *and* re-promotes, and `recordDeleted` is what makes that safe

This is the one place a source deliberately diverges from **both** existing
policies. An `entries` version whose record is deleted is *removed* (an entry's
versions are its own history, and the index mirrors the network); a `languages`
version *archives forever*. A source does neither, because a source is
referenced **by strangers**: leaving a number with no current version would
degrade every example sentence citing it, in entries whose authors did nothing
wrong.

So a deletion archives the version and **promotes the most recent surviving
one**. That is only safe with a flag: `recordDeleted` is set on **every** version
a withdrawn record owns, so a *later* deletion on the same number cannot
resurrect a version whose record is gone and hand every citing entry a dead URI.
The flag was added at the build, by driving the delete path — not by reading the
design, which had missed it.

### `languages[0]` is immutable, compared against the first version ever indexed

`languages` lists the languages present in the source, whose entry editors offer
it; `languages[0]` is the main language and is fixed at creation. A source whose
main language is wrong is deleted and re-created. Additional languages are freely
editable.

**The comparison is against the first version ever indexed for that number, not
against the predecessor.** Immutability is a property of the whole ladder:
comparing with the predecessor detects only the *transition*, so republishing the
changed value once more would compare it against itself and clear the flag —
laundering the change — while an author restoring the original value would be
flagged as the one who broke it.

Enforcement splits along the line this project always uses: **the AppView flags,
the editor refuses.** Ingest sets `mainLanguageConflict` and indexes the version
anyway (an index is not the arbiter of what a contributor may assert — the same
posture as grammar orphan detection), and the editor simply gives the field no
control when editing an existing source.

### The citation has three states, not two

Driving the reader produced a state the design had not named. A number resolves,
or **nobody has described the work**, or **somebody has and the record would not
load** (their PDS is offline or migrated, or our own AppView is unreachable).

Keeping the last two apart is a correctness requirement, not a nicety. Only the
*undescribed* state carries the invitation to describe the work; offering it on a
read failure would invite a stranger's record to be overwritten on the strength
of a network error. So the resolver's `null` means "nobody has described this"
and only that, a genuine failure **rejects** rather than being flattened into
`null`, and rejections are evicted from the per-number cache so a transient
outage does not poison a number for the rest of the session.

### The lookup is an enhancement, never a dependency

`@leksis/oclc` follows the `@leksis/ud` contract verbatim: type a number, get
title/authors/year/link, **null on every failure**, all failures identical to the
caller, parsing split from fetching, and the manual path never gated on the
fetch. It only fills blanks; replacing requires an explicit "look it up again".

**The provider is OpenLibrary** (`/api/books?bibkeys=OCLC:<n>&format=json&jscmd=data`),
verified at source: keyless, and `access-control-allow-origin: *` even with an
`Origin` header, so the browser calls it directly and no proxy sits in a content
path. Two candidates are recorded as rejected so they are not re-proposed:
WorldCat's Search API needs a key (and OCLC has retired public endpoints before —
Classify, xISBN), which would force exactly the keyed proxy this avoids; scraping
the public WorldCat page is fragile and CORS-blocked.

One fact shaped the parser: **an unknown number answers `200 {}`, not a 404**, so
"not catalogued" and "request failed" arrive looking nothing alike and both have
to end as null. This matters more here than for UD, because the works most worth
citing for a low-resource language are precisely the ones no catalogue has seen.
Note also that `identifiers.oclc` may list several numbers for one edition: the
number the contributor typed is the identity, and the lookup fills in prose — it
never rewrites the key.

## Consequences

- **One new collection** (`sources`, versioned, four indexes) and **three
  endpoints**, all in slice 1: `GET /sources?q=&l=`,
  `GET /sources/:oclc/currentRecord`, `GET /languages/:tag/sources`. Slices 2 and
  3 cost **zero** API surface — those three were already the whole read contract,
  and an example is content.
- **Two lexicon changes.** `eu.leksis.source` is new; `eu.leksis.entry` gains
  `examples` on its `definition` def (plus the `#example` and `#exampleSource`
  defs). The entry change is **additive**, so no existing record is invalidated
  and no bot republishes — but both lexicons are **unpublished**, joining the
  backlog behind `grammar.layout` and the four byte/grapheme-widened ones.
- **`examples` is kept on group nodes through ingest's field whitelist**, unlike
  `text`, which is stripped there. That is what lets `validateDefinitions` see
  the violation and refuse the record; strip it and the leaves-only rule would
  silently never fire.
- **The compact preview suppresses examples**, decided rather than inherited:
  `DefinitionList` gained `showExamples`, off by default. The preview already
  omits the etymology, the notes and the forms; examples are the bulkiest thing
  an entry carries, and each cited work costs a resolution the caller did not ask
  for. The entry page — where an example is the point — turns it on.
- **The editor's example row is flat** (`{text, oclc, locator}`), not the record's
  nested shape: a half-typed number should not have to conjure a `source` object
  in order to exist. The record shape is rebuilt on save.
- **Describing a work from an entry page needs a poll** — the same PDS →
  Jetstream → ArangoDB wait every other publish here has. The source editor
  clears the per-number cache at publish time, which is *before* the firehose has
  been round, so the page polls `currentRecord`, then forgets the number and
  re-keys the definitions. Without it a citation stayed degraded until a reload.
- **A source editor needs a stale-rewrite guard, which an entry editor can do
  without.** `CurrentSourceRecordResponse` carries a `cid`; the editor re-reads it
  immediately before publishing and refuses rather than dropping somebody else's
  edit. Unlike an entry, a source is described by *strangers*, so the somebody
  else is usually not you. `fetchSourceRecord` likewise refuses to load a record
  whose `category` is unknown or whose `languages[0]` is unreadable — both are
  rewrites that would silently destroy something (the `isValidGrammar` precedent).
- **The search bar gained a kind filter** (words | languages | sources), mirrored
  into `/?q=&l=&kind=` and **omitted when the kind is words**, so every link
  written before the filter round-trips unchanged. Languages match client-side
  (the whole list is already loaded for the scope picker, so searching it is a
  filter, not a request). `kind` and the pre-existing translation target `t` had
  to be reconciled — only words can be translated, so the target is dropped at
  the one place a submitted search is built, which keeps the translation path free
  of any knowledge of kinds.
- **The create panel moved above the results and learned to ask what** — entry |
  language | source, with the active tab preselected. Note the design note's
  "`LanguageRecordDialog` (creation mode)" **does not exist**: its modes are
  *self* and *other*, and language creation has always been `AddLanguageModal`,
  which is what the chooser opens.
- **`/source/<oclc>` has a state no other resource page has: cited but
  undescribed.** An example references a number, not a record, so a valid
  citation can land on that page before anybody has written the description. That
  is an invitation, not a 404 — and it is the whole reason the reference scheme
  can only degrade.
- **Sources become the fifth upgradable collection** for the future weighted
  voting mechanism (`docs/design/weighted-voting.md` §2.1): a source ladder is
  per-work and cross-author by construction, so it is the cleanest ballot subject
  in the system.
- **The byte/grapheme cap defect was found in this pass**, not by it: AT Proto's
  `maxLength` counts UTF-8 bytes while `maxGraphemes` counts characters, and every
  Leksis lexicon had paired them at 2:1, so for any script above one byte per
  character the byte cap bound first. All 20 capped fields across the four older
  lexicons were widened to the 10:1 ratio Bluesky's own lexicons use;
  `eu.leksis.source` was born at 10:1. Widening only, so no record is invalidated
  — but it is a lexicon change, and it is in the publishing backlog.
- **Nothing about examples is searchable.** Indexing example *text* is the same
  deferred decision as definition full-text search and must be decided with it,
  not separately.
- **Fixture coverage is specified but unpublished.** `leksis-testset` gained rows
  E-30 and E-31 (the three citation states on one leaf; the same work cited from
  two leaves) and a new §3.4 source matrix S-01…S-04, including a quarantine rule
  the other lexicons do not need: a fixture source must use a 16-digit number and
  fixture-only `languages`, because a citation resolving to a fixture description
  of somebody's actual book is worse than an unresolved one.

## Action items

- [ ] **Publish the lexicons** (`scripts/publish-lexicons.mjs`): `eu.leksis.source`,
      the widened `eu.leksis.entry`, and the backlog it joins —
      `grammar.layout` on `eu.leksis.language` plus the four byte/grapheme-widened
      lexicons. One batch. **Requires the user's approval** (it writes to a PDS).
- [ ] **One end-to-end publish through a real PDS** — still the unexercised path
      after three slices. Publish a source record, then an entry citing it, and
      watch the citation resolve through Jetstream. Everything so far was proven
      by typecheck/lint/build across five workspaces, direct harnesses over the
      OCLC parser and the kind/route/matcher logic, and browser checks against
      stubbed responses.
- [ ] **Publish the fixture rows** (E-30, E-31, S-01…S-04) from the fixture bot's
      own repo. Until they exist, the three citation states have never been
      rendered against real records.
- [ ] **Drive the authoring surfaces in a browser.** The source editor, the kind
      tabs, the create chooser, the examples editor and the describe-from-an-entry
      flow all sit behind a login an agent cannot perform (`verify` skill, *the
      session wall*). The test account exists (`testaccount.leksis.eu`); this is a
      pass nobody has done, not a blocked one. Carried jointly with ADR-0009's and
      ADR-0013's identical items.
- [ ] **Decide example-text and definition full-text indexing together**, in the
      search work. Two questions, one answer.
- [ ] **Watch for a work with no OCLC number.** Today's answer is the entry-level
      `references` field or an unsourced example. Whether `eu.leksis.source` gains
      a second `category` with a different identity scheme is exactly what the
      `category` field is for; the trigger is a contributor holding a real source
      the OCLC scheme cannot name.
- [ ] **Watch for a source somebody wants to withdraw.** Deletion archives rather
      than removes, so citations keep resolving; whether a *deliberately
      withdrawn* source needs the entry's `deleted: true` idiom is deferred until
      somebody publishes a wrong source they cannot fix by republishing.
