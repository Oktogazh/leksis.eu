# Changelog

All notable changes to Leksis. This project follows the 8-week development
timeline; each entry maps to a weekly milestone.

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
