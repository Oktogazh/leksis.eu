# Leksis

A distributed, crowdsourced multilingual dictionary for low-resource languages,
built on the AT Protocol and ArangoDB. See [leksis.eu](https://leksis.eu).

> **Status:** Week 1 — Foundation & CI/CD. A deployed empty shell with a working
> pipeline. The only visible feature is a placeholder PDS connect/disconnect
> toggle; real AT Proto OAuth arrives in week 2.

## Monorepo layout

```
apps/web        React + Vite + Tailwind frontend (served by nginx in prod)
apps/api        Hono + Node AppView API, ArangoDB connection, /health
packages/types  Shared TypeScript types
```

Tooling: **Turborepo** + **npm workspaces**. Deployed to a **single VPS** via
**docker-compose** (ArangoDB + API + web behind **Caddy**), released by
**GitHub Actions** on version tags. See
[docs/adr/0001-database-hosting.md](docs/adr/0001-database-hosting.md) for why.

## Prerequisites

- Node 20+ (22 recommended) for local dev
- Docker + Docker Compose for running the full stack
- A VPS (e.g. Hetzner CX22, ~€4/mo) for production

## Local development

Two ways to run it:

**A. Node directly** (fast iteration on the apps):

```bash
npm install
cp apps/api/.env.example apps/api/.env   # point ARANGO_URL at a local/remote ArangoDB
npm run db:init                          # create the database + empty collections
npm run dev                              # web on :5173, api on :8080
```

**B. Full stack via compose** (mirrors production, includes ArangoDB):

```bash
cp .env.example .env                     # set ARANGO_ROOT_PASSWORD
docker compose up -d --build
docker compose exec api npm run db:init  # once, to create collections
# web + API now served by Caddy on http://localhost  (API under /api)
```

Check the API: `curl localhost/api/health` (compose) or `curl localhost:8080/health` (Node).

## Deployment

One VPS, four containers (Caddy, web, api, arangodb). ArangoDB is never exposed
publicly — only the other containers reach it. See the
[CHANGELOG](./CHANGELOG.md) for the full server setup and CI/CD wiring.

See [CHANGELOG.md](./CHANGELOG.md) for what exists so far, and the development
timeline for what comes next.
