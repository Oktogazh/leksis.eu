# Changelog

All notable changes to Leksis. This project follows the 8-week development
timeline; each entry maps to a weekly milestone.

## [Unreleased] — Week 4 prep: search flow + atproto.at restyle

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
