# Changelog

All notable changes to Leksis. This project follows the 8-week development
timeline; each entry maps to a weekly milestone.

## [Unreleased] — Week 2: AT Proto OAuth + frontend foundations

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
