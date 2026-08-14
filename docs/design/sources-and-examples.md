# Design note: sources and example sentences

**Status:** **Complete — all four slices built (2026-08-12 → 2026-08-14, v0.19.0–v0.21.0).**
This note is now **superseded as the authority by [ADR-0014](../adr/0014-sources-and-example-sentences.md)**,
which slice 4 graduated it into; it is kept as the design record — the reasoning, the rejected
alternatives and the open questions — while the ADR holds what was decided.
Shapes and surfaces settled in the 2026-08-12 design session. Slice 1 shipped the lexicon, the
`sources` collection with firehose ingest, and the three read surfaces; slice 2 shipped the OCLC
lookup package, the source editor, the search bar's kind filter, the create chooser, the
`/source/<oclc>` page and the dashboard's source list; slice 3 shipped `definitions[].examples`,
the leaf-card editor and the resolve-or-degrade citation — the last two at **zero API cost**.
What remains unverified is one end-to-end publish through a real PDS and **every interface these
slices add**: all of them sit behind a login an agent cannot perform (`verify` skill, *the session
wall*), so they were proven by typecheck/lint/build across five workspaces plus direct harnesses
over the OCLC parser, the kind/route/matcher logic and the example round-trip (§5). The fixture
rows that would assert the reader's side are specified and unpublished.
**Date:** 2026-08-12, revised 2026-08-13, closed 2026-08-14.
**For:** Example sentences on definitions — the first slice of the white paper's "example
sentences" deferred item — and the `eu.leksis.source` lexicon that makes their citations
first-class, contestable records instead of free strings.
**Related:** the `leksis` skill (entry lexicon, ArangoDB schema), ADR-0013 (the style precedent for
a two-sided design: prose where a schema would lie, a record where the fact is simple), the UD
live-candidate pattern (`packages/ud` — the fetch-and-degrade model §2.3 copies),
`docs/design/weighted-voting.md` §2.1 (sources become the fifth upgradable collection).

> **How to read this.** §0 is binding. §1 is the model in one paragraph. §2 is the two lexicon
> changes; §3 the AppView; §4 the interfaces (search, editors, rendering, dashboard); §5 the build
> slices; §6 what stays out; §7 the open questions. Decisions are named in **bold** so references
> survive edits.

---

## 0. Governing rules

**A source is a record, not a table.** Per the evolution skill's scope test, bibliographic sources
are user-authored `eu.leksis.source` records on the author's own PDS — versioned, archived,
last-write-wins now, votable later. Never an admin-curated table.

**The OCLC number is the identity; the record is the description.** An example sentence references
a source by OCLC number alone, never by record URI — so a sentence can cite a book whose source
record nobody has published yet, and the citation resolves the day someone publishes it. This is
the same decoupling as an unresolved relation side: the reference is valid before the referent is
described, and it degrades visibly, never breaks.

**Citation text renders from the source record only — DRY.** The entry stores the OCLC number and
a locator (page number etc.), nothing else. The short/long citation form a reader sees after an
example sentence comes from the current `eu.leksis.source` record, resolved at render time.
Duplicating the citation into every entry would let the two drift, and fixing a typo in a citation
would mean republishing every entry that quotes the book.

**Fetched metadata is an enhancement, never a dependency** — the `packages/ud` contract, verbatim.
The OCLC lookup pre-fills the source editor; when it fails (offline, CORS, unknown number) every
field stays manually editable. A source can always be authored by hand.

**An example is content; the AppView indexes only what its read surfaces need.** Example sentences
are record-only, resolved from the PDS like definitions — never stored in ArangoDB. Sources get a
reference-only versioned collection (like `languages`) because two read surfaces need it: source
search and the per-language source list.

---

## 1. The model

A **definition leaf** gains an optional list of **example sentences**; each is at least a sentence
in the entry's language, optionally citing a **source** by OCLC number plus a **locator** (where in
the source). A source is its own `eu.leksis.source` record keyed on the OCLC number, carrying its
category (only `bibliographic` for now), the fetched-or-typed bibliographic identity, the languages
whose entries may cite it, and the short/long citation forms every citing entry renders. The search
bar learns to find languages and sources besides words; the create flow asks which of the three to
create; each language dashboard lists its sources.

---

## 2. Lexicon changes

### 2.1 `eu.leksis.entry` — the `examples` sub-object

Additive change on the `definition` def (pre-1.0, but non-breaking anyway):

```typescript
definition: {
  place: number[]
  categories?: Tag[]
  notes?: string[]
  text?: string
  examples?: {              // NEW — allowed on LEAVES ONLY (a group heading has no
                            //   sense to exemplify), max ~16 per leaf
    text: string            // the sentence, in the entry's own language (required,
                            //   maxGraphemes ~1024)
    source?: {              // absent = an unsourced example (constructed, or oral)
      oclc: string          // OCLC number of the cited work — digits only, normalized
                            //   (no "ocm"/"ocn"/"(OCoLC)" prefixes), maxLength 16.
                            //   References the source IDENTITY, not any record version.
      locator?: string      // where in the source: "p. 142", "s.v. gwerzenn", "§4" —
                            //   free text, maxGraphemes ~128, because pagination,
                            //   column, folio and headword locators don't share a schema
    }
  }[]
}
```

Named decisions:

- **Leaves only.** An example exemplifies one sense; `validateDefinitions` gains the rule
  *group node ⇒ no examples*, enforced strictly at ingest and healed leniently in the web parser,
  exactly like the text rule.
- **`source` is optional on the example, everything inside it isn't.** An unsourced example is a
  legitimate lexicographic object (a constructed illustration). But a cited one must say *which
  work* — and `locator` stays optional because a whole work can be the source (a proverb
  collection cited in bulk).
- **The locator is free text.** A `page: integer` field would be false precision the moment the
  source is a dictionary (s.v.), a manuscript (folio) or an audio archive (timestamp). Same
  judgement as ADR-0013's prose etymology: don't schema what doesn't share a shape.
- **No record URI, no strong ref.** Citing by OCLC number keeps the reference stable across source
  record versions and valid before any version exists (§0). This is deliberate and different from
  relations/cognates, which pin a version because *drift of the referent's content* matters there;
  a book's identity never drifts.

### 2.2 `eu.leksis.source` — the new lexicon

```typescript
// rkey = the normalized OCLC number (like eu.leksis.language uses the tag):
//   readable, and one record per work per repo by construction.
{
  category: "bibliographic"   // knownValues: ["bibliographic"] — the only value today;
                              //   the field exists so audio/web/oral-informant categories
                              //   can be added without a lexicon break
  oclc: string                // required while category is bibliographic (i.e. always,
                              //   today); must denote the same work as the rkey. Strict on
                              //   the KEY (it must be the normal form exactly, so one repo
                              //   cannot hold two records for one work), lenient on the
                              //   FIELD (normalized before comparison, so a zero-padded
                              //   MARC export is indexed rather than discarded) — built
                              //   2026-08-12
  title: string               // required — fetched from the OCLC lookup or typed
  author?: string             // fetched or typed; optional (anonymous/collective works)
  year?: string               // string, not integer: "1732", "c. 1850", "1904–1911"
  url?: string                // link to the source (WorldCat page, digitized copy…)
  languages: string[]         // BCP 47 tags, lowercase, minLength 1 — the languages
                              //   present in the source, whose entry editors offer it.
                              //   languages[0] is the MAIN language and is IMMUTABLE
                              //   across versions (see below).
  citation: {                 // what a citing entry renders after the example
    short: string             // "GBAV" / "Ernault 1904" — required
    long: string              // the full bibliographic line — required
  }
  createdAt: string
}
```

Named decisions:

- **rkey = OCLC number.** The precedent is `eu.leksis.language` (rkey = tag): the record's subject
  has a natural global identifier, so the rkey carries it. Two authors publishing records for the
  same OCLC number form that source's ladder (last-write-wins now, votable later) — records prove
  authorship, not ownership, as everywhere. Consequence: **no `subject` field** — identity comes
  from (collection, rkey), exactly as it does for languages.
- **All fields required except `author`, `year`, `url`.** The user-facing rule is "all required";
  the three relaxations are works where the value genuinely doesn't exist (anonymous, undated,
  offline-only), where forcing a value would force a lie. `title`, `languages`, `citation.short`,
  `citation.long` are hard-required.
- **`languages[0]` is immutable.** The main language is set at creation and never edited; a source
  whose main language is wrong is deleted (PDS record delete) and re-created. Additional languages
  (index ≥ 1) are freely editable across versions. Enforcement: ingest **flags, never rejects** a
  version whose `languages[0]` differs (the AppView must not be the arbiter — same posture as
  grammar orphan detection); the *editor* refuses to publish such a version (the field is read-only
  in the UI). Surfaced as a source issue on the ladder.
  **The comparison is against the FIRST version ever indexed for that number, not the predecessor**
  (settled at the build, 2026-08-12). Immutability is a property of the whole ladder: comparing with
  the predecessor detects only the *transition*, so republishing the changed value once more would
  compare it against itself and clear the flag — laundering the change — while an author restoring
  the original would be flagged as the one breaking it. Flag cleared on restoration, set on every
  version that disagrees with the original.
- **`category` is an enum of one.** Pre-filled, not hidden: the field teaches contributors the
  record will grow, and adding `knownValues` later is non-breaking.
- **`citation` lives on the source, not the entry** — the DRY rule of §0 made structural.

Both lexicons ship through `scripts/publish-lexicons.mjs` as usual (noting the existing lag on
`grammar.layout` — publish both together).

### 2.3 The OCLC lookup — pattern, not yet a provider

The source editor imitates `packages/ud`: type an OCLC number → fetch title/author/year/link →
pre-fill the form → **degrade to manual on any failure**. A new `packages/oclc` (or a module in
`packages/ud`'s image) isolates fetching and parsing from components.

**The provider is settled: OpenLibrary** (verified live 2026-08-12, closing open question 1).

```
GET https://openlibrary.org/api/books?bibkeys=OCLC:<n>&format=json&jscmd=data
```

Keyless JSON, keyed `"OCLC:<n>"`, carrying `title`, `authors[].name`, `publish_date`, `url` and an
`identifiers.oclc` array — and it answers `access-control-allow-origin: *` even with an `Origin`
header, so the browser can call it directly and no server-side proxy sits in a content path.

The two rejected candidates, recorded so they are not re-proposed: **WorldCat's** Search API needs a
key (and OCLC has retired public endpoints before — Classify, xISBN), which would force exactly the
keyed proxy this avoids; **scraping the public WorldCat page** is fragile and CORS-blocked.

Note `identifiers.oclc` may list **several** numbers for one edition, so a lookup can legitimately
answer about a work whose number differs from the one typed. The number the contributor entered is
the identity — the lookup fills in prose, it never rewrites the key.

Whatever is chosen, the contract is the UD one: `null` on any failure, all failures identical to
the caller, parsing in one file, and the manual path never gated on the fetch. The `url` field
defaults to the provider's page for the number but stays editable.

---

## 3. AppView

### 3.1 The `sources` collection — versioned, reference-only

Mirrors `languages` (versioned, many docs per key, one `current: true`) plus the `search` idiom
from `entries`:

```
{
  _key: string,           // auto-generated (archived versions coexist)
  oclc: string,           // the identity — from the rkey
  category: string,       // "bibliographic"
  languages: string[],    // lowercase BCP 47 tags; [0] = main
  search: string[],       // lowercased citation.short, citation.long, title, author —
                          //   what source search matches on (the entries precedent:
                          //   index what search needs, never serve content from it)
  citation: { short, long }, // cached for render fallback and search-result display —
                          //   cache of the current record, never the source of truth
  mainLanguageConflict: boolean, // this version's languages[0] differs from its
                          //   predecessor's — flagged, never rejected (§2.2)
  recordURI, cid, authorDID, createdAt, indexedAt, current
}
```

Indexes: `["oclc", "current"]`, `["recordURI"]`, `["languages[*]", "current"]` (the dashboard
list), `["search[*]"]`.

> Caching `citation` bends the pure reference-only rule the way `localLanguages` already does:
> search results and example-sentence rendering need a display string without one PDS round-trip
> per source per page. The record stays the source of truth; the client resolves it (cached per
> OCLC, the `language-grammar.ts` pattern) for the full source view, and the DB copy is refreshed
> on every version transition — rebuildable, like every read model.

### 3.2 Ingest

New `apps/api/src/firehose/ingest-source.ts`, registered in `jetstream.ts` (NSID added to
`WANTED_COLLECTIONS`, dispatch branch), following `ingest-cognate.ts`'s file shape:

1. Validate (`validateSource` in `packages/types/src/source.ts`): category known, `oclc`
   normalized digits and equal to the rkey, `languages` non-empty valid lowercase BCP 47,
   citation forms non-empty. Invalid → logged + skipped.
2. Identity = (oclc). Idempotency on `recordURI + cid`.
3. Archive the current version, insert the new one as current (last-write-wins across authors);
   set `mainLanguageConflict` when `languages[0]` changed.
4. Deletion: **archive, don't remove** — like `languages`, not like `entries`, because example
   sentences across many strangers' entries reference the OCLC number; the citation must keep
   resolving. (The entries exception exists because an entry's versions are its *own* history;
   a source is referenced *by others*.) If the deleted version was current, promote the most
   recent remaining version; if none remains, the source has no current version and citing
   entries degrade to rendering the bare OCLC number (§4.3).

`db:init`: add `"sources"` to the document-collections list. No derived/edge collections — a
source reference is resolved by key, never traversed.

### 3.3 Read surfaces

- `GET /sources?q=&l=` — source search: case-insensitive prefix match over `search[*]`, optional
  language filter; returns oclc, citation, languages, recordURI of current versions.
- `GET /sources/:oclc/currentRecord` — recordURI of the current version (the
  `languages/:tag/currentRecord` precedent), for the client-side resolver and the editor's
  edit-existing flow.
- `GET /languages/:tag/sources` — current sources whose `languages` include the tag, main-language
  ones first. Kept out of the dashboard payload (side data loads there are already best-effort
  and this list has its own natural cap/paging later).

---

## 4. Interfaces

### 4.1 The search bar — three filters

The home search surface (`HomePage.tsx` + `SearchResults.tsx`) gains a **kind filter**:
**words | languages | sources**, defaulting to words, mirrored into the URL
(`/?q=&l=&kind=`, absent = words) so results stay shareable.

- **Words** — unchanged (`GET /entries?q=&l=`, plus the target-language translation path).
- **Languages** — reuses the `LanguageSearchBar` matching logic (tag, endonym, locale name) as a
  pure function over the already-loaded `LanguageView[]`: client-side, no new endpoint, and the
  IETF tag matches by construction. Each hit links to `/language/<tag>`.
- **Sources** — `GET /sources?q=` (optionally `&l=` when a language is selected); hits show
  `citation.short` + `citation.long` + language chips, linking to the source view (§4.4).

### 4.2 The create flow — ask what to create, at the top

Two changes to `SearchResults.tsx` / `CreateEntryPanel.tsx`:

1. **The "Add "X" to LANGUAGE" panel moves above the results list** (it currently mounts below,
   `SearchResults.tsx:143-149`). A searcher who didn't find the thing shouldn't scroll past what
   they did find to add it.
2. The CTA no longer opens `EntryEditorDialog` directly: it first asks **"Create what?" —
   entry | language | source** — then opens `EntryEditorDialog`, `LanguageRecordDialog`
   (creation mode), or the new `SourceEditorDialog`, seeded with the query (as the word, the
   tag/name guess, or the citation/OCLC search respectively). With the kind filter set to
   languages or sources, the matching choice is preselected; the chooser still shows, one click
   to confirm.

### 4.3 Authoring and rendering examples

**Editor.** In `EntryEditorDialog`, each definition **leaf card** gains an "examples" list under
the notes block (the `nodeNotes` precedent): per example a sentence textarea plus an optional
source picker — search-as-you-type over `GET /sources?q=&l=<entry language>` (sources listing the
entry's language, per the source's `languages` role), a locator input, and an "enter OCLC number
directly" escape hatch for a source with no record yet (§0). A "create this source" shortcut opens
`SourceEditorDialog` inline.

**Rendering (EntryPage).** Examples render under their leaf's definition text, styled as quoted
content. After the sentence:

- source record resolves (client-side per-OCLC cache, the `language-grammar.ts` pattern; DB
  citation cache as the immediate fallback) → render `citation.short` + locator, with `long`
  revealed on hover/tap (the label short/long idiom), linking to the source view;
- no source record exists for the number → render `OCLC <number>` + locator, styled unresolved
  (the unbound-tag posture: degrade visibly, never hide the reference) with a create affordance
  for logged-in readers.

Nothing about examples is indexed; like definitions they arrive with the record from the PDS.

### 4.4 The source view and editor

- **`SourceEditorDialog`** — category (prefilled, disabled while one value exists), OCLC number →
  live lookup pre-fill (§2.3), title/author/year/url, languages (first tag locked when editing an
  existing source; delete-and-recreate is the stated fix for a wrong main language), citation
  short/long. Publishes to the editor's own PDS, rkey = OCLC number; editing an existing source
  loads the current record via `GET /sources/:oclc/currentRecord` and republishes a full rewrite.
- **Source view** — a `/source/<oclc>` page fits the routing convention (`/entry/`, `/language/`,
  `/user/`); slice 3 may start with a dialog if a page is too much, but the URL should exist so
  search results and citations have a stable link target.

### 4.5 The language dashboard

A **Sources** section on `LanguagePage.tsx` (below the names/grammar section): the
`GET /languages/:tag/sources` list — citation short + long, main-language sources first, each
linking to its source view — plus the same "add a source" affordance the create flow uses,
preseeded with this language as the main language.

---

## 5. Build slices — one programming session each

Each leaves master deployable; the usual loop order (lexicon → ingest → AQL → types → web).

1. ~~**The source record.**~~ **Built 2026-08-12 (v0.19.0).** `lexicons/eu.leksis.source.json`;
   `packages/types/src/source.ts` (`normalizeOclc`, `validateSource`, the view/response types);
   the `sources` collection + 4 indexes in `db:init`; `ingest-source.ts` + jetstream registration;
   `apps/api/src/sources.ts` and all three read surfaces — `/languages/:tag/sources` came forward
   from slice 2, since it is the same query and costs nothing once the collection exists.
   Two things the build changed:
   - **`recordDeleted` was added to the collection**, not designed in §3.1. Re-promotion (§3.2)
     needs to know which versions belong to a *withdrawn* record, or the last deletion on a number
     resurrects a version whose record is gone and hands every citing entry a dead URI. Found by
     driving the delete path, not by reading it.
   - **The list surfaces wrap** (`SourcesResponse`, `LanguageSourcesResponse`), matching
     `EntriesResponse`/`LabelsResponse` rather than serving a bare array.

   Still owed: the lexicon is **not published** — it and the four widened ones (see the CHANGELOG's
   byte/grapheme note) go out with the lagging `grammar.layout`, and one end-to-end publish through
   a real PDS remains the only unexercised path.
2. ~~**The source interfaces.**~~ **Built 2026-08-13.** `packages/oclc` (OpenLibrary);
   `SourceEditorDialog`; the kind filter mirrored into `/?q=&l=&kind=`; the create chooser +
   panel moved above the results; `SourcePage` at `/source/<oclc>`; the dashboard section.
   `GET /languages/:tag/sources` came forward to slice 1, so the API cost here was **zero**.
   Five things the build settled or changed:
   - **An unknown OCLC number answers `200 {}`, not a 404.** Verified at source. So the provider
     reports "not catalogued" and "request failed" completely differently, and the package has to
     flatten both to null — the single fact the parser is shaped around.
   - **The design's "`LanguageRecordDialog` (creation mode)" does not exist** (§4.2). Its modes are
     *self* and *other*; language **creation** has always been `AddLanguageModal`, which is what the
     chooser opens. §4.2 should be read as naming the creation surface, not that dialog.
   - **`kind` and the pre-existing `t` (translation target) had to be reconciled**, which §4.1 does
     not mention. Only words can be translated, so `withKind` in `HomePage` drops the target
     whenever the kind is not words — enforced at the one place a submitted search is built, which
     is what keeps `translating`/`missingSource` free of any knowledge of kinds. The target selector
     is hidden rather than disabled on the other tabs.
   - **`kind` is omitted from the URL when it is `words`**, so every link written before the filter
     existed still round-trips to exactly the same URL.
   - **The stale-rewrite guard became real**, using the `cid` slice 1 put on
     `CurrentSourceRecordResponse`: the editor re-reads it immediately before publishing and refuses
     rather than dropping a stranger's edit. `fetchSourceRecord` also refuses to load a record whose
     `category` is unknown or whose `languages[0]` is unreadable — both are rewrites that would
     silently destroy something, which is the `isValidGrammar` precedent.
3. ~~**Examples on entries.**~~ **Built 2026-08-13.** `definitions[].examples` in the entry
   lexicon (`#example` + `#exampleSource` defs); `EntryExample`/`EntryExampleSource` and the
   `example-rule` in `validateDefinitions`; strict `parseExamples` at ingest and its lenient
   twin in the web record parser; the leaf-card examples editor with the source picker;
   `ExampleSentences`/`ExampleCitation` and the resolve-or-degrade citation on EntryPage.
   Coverage rows E-30/E-31 and a new **§3.4 source matrix (S-01…S-04)** were added to
   `leksis-testset`; publishing them is the fixture bot's, and is **owed**.
   **Zero API cost, as designed** — no collection, no endpoint, no `db:init` change: an
   example is content, and the only thing the AppView does with one is refuse a malformed
   record. Five things the build settled or changed:
   - **The citation has three states, not two.** §4.3 names "resolves" and "no record
     exists"; driving it produced a third — *described, but the record would not load* (or
     the AppView is unreachable). It must not offer to describe the work: doing so would
     invite a stranger's record to be overwritten on the strength of a network error. So
     `undescribed` and `unreadable` are separate, and only the first carries the invitation.
   - **The compact preview suppresses examples**, decided rather than inherited:
     `DefinitionList` gained `showExamples`, off by default. The preview already omits the
     etymology, the notes and the forms; examples are the bulkiest thing an entry carries and
     each cited work costs a resolution the caller did not ask for.
   - **`examples` is kept on group nodes through ingest's whitelist**, unlike `text`, which
     is stripped there. That is what lets `validateDefinitions` see the violation and refuse
     the record — strip it and the leaves-only rule would silently never fire.
   - **The editor row is flat** (`{text, oclc, locator}`), not the record's nested shape: a
     half-typed number should not have to conjure a `source` object to live in. Round-trip
     losslessness is asserted by harness.
   - **Describing a work from an entry page needs a poll**, the same one every other publish
     here has: the source editor clears the per-number cache at publish time, which is before
     the firehose has been round, so the page waits for `currentRecord` and then re-keys the
     definitions. Without it a citation stayed degraded until a reload.

   Still owed, and unchanged by this slice: the lexicon is **not published** (`eu.leksis.entry`
   now joins `grammar.layout` and the widened fields in that backlog), and no example has yet
   travelled through a real PDS — the reader's three states were exercised in a browser against
   stubbed responses plus direct harnesses, never end-to-end.
4. ~~**Record.**~~ **Done 2026-08-14.** **[ADR-0014](../adr/0014-sources-and-example-sentences.md)**
   — this note graduated, per the ADR-0013 precedent (a new lexicon and a new collection are
   ADR-grade). The CHANGELOG's top section now covers all three build slices under one milestone
   heading; the `leksis` skill's lexicon family, `entries`/`sources` schema blocks, read-surface
   list and deferred-decisions table were updated, and the README banner and status line with them.
   One thing the recording pass settled, worth keeping here: the **status divide between this note
   and its ADR**. The ADR is authoritative for what was decided and what remains owed; this note
   keeps the reasoning, the two rejected OCLC providers and the open questions of §7, which an ADR's
   "Consequences" section would flatten. Where they disagree, the ADR wins — the same rule the
   `leksis` skill applies to the grammatical-tagging note.

## 6. Deliberately out of scope

- **Non-bibliographic source categories** (web, audio, oral informant) — the enum is built to
  grow; grow it when a contributor needs it.
- **Example-sentence search** — examples are record content; indexing them is the same deferred
  decision as definition full-text search, and must be decided with it, not separately.
- **The sentence/corpora repository** — an example on a definition is dictionary content
  (priority 1); the standalone corpus stays priority 2. When the repository exists, its sentences
  should be able to cite the same `eu.leksis.source` records — which is a reason the source
  lexicon is its own record type, not an entry sub-object.
- **Translation of examples** — belongs to the relation/translation layer, not here.
- **Citation-style configuration** — `citation.long` is one free-form line the author writes;
  CSL-style structured citations are false precision at this stage.

## 7. Open questions

1. ~~**The OCLC provider**~~ — **closed 2026-08-12**: OpenLibrary, verified keyless and
   CORS-permissive at source (§2.3).
2. ~~**OCLC normalization edge cases**~~ — **closed 2026-08-12**: `normalizeOclc` in
   `packages/types/src/source.ts` is the single implementation, used by the record key, the
   record's own `oclc` field, ingest's key-equality check and the `/sources/:oclc/…` route alike.
   It strips the `(OCoLC)` wrapper, the `ocm`/`ocn`/`on` prefixes, interior whitespace and leading
   zeros, and caps at 16 digits. It is deliberately **fail-closed**: anything it cannot read
   returns null rather than guessing, since a false *merge* would fuse two works into one identity
   while a false *reject* only asks the contributor to retype. Non-ASCII digit forms (Arabic-Indic,
   fullwidth) reject for the same reason.
3. **A work with no OCLC number** (many low-resource-language sources: pamphlets, manuscripts,
   local editions never catalogued) — today's answer is the entry-level `references` field or an
   unsourced example; whether `eu.leksis.source` gains a second category with a different
   identity scheme is exactly what the `category` field is for. Trigger: a contributor holds a
   real source the OCLC scheme cannot name.
4. **Deleting a source that examples cite** — §3.2 archives rather than removes, so citations
   keep resolving; whether a *deliberately withdrawn* source (the entry `deleted: true` idiom)
   is needed is deferred until someone publishes a wrong source they cannot fix by republishing.
