# Leksis

A distributed, crowdsourced multilingual dictionary for low-resource languages,
built on the AT Protocol and ArangoDB. See [leksis.eu](https://leksis.eu).

> **Status:** In development, continuously released — `CHANGELOG.md`, the git
> tags and [docs/adr](docs/adr) are the source of truth for what exists.
> Content loops 1–4 are live (languages, entries, definitions, tree-shaped
> definitions with a grammatical-tag worklist); translations are the next
> unbuilt content loop. In parallel the **morphology arc** is through layer 4:
> a language declares its grammatical primitives, which features are inherent
> to a category, which vary across its forms, and the shape of the tables those
> forms are laid out in — see
> [ADR-0006](docs/adr/0006-grammar-layer-primitives.md),
> [ADR-0007](docs/adr/0007-grammar-layer-inherent-combinations.md),
> [ADR-0008](docs/adr/0008-grammar-layer-axes-and-single-sourced-labels.md) and
> [ADR-0009](docs/adr/0009-grammar-layer-layout.md). Generation from rules is
> layer 5 and not built: a paradigm shows only the forms an entry carries.
> Beside the grammar, a language also declares the rest of a dictionary's front
> matter — lexicographic labels (register, domain, usage) and plain
> abbreviations — and every label is keyed on the tag it names
> ([ADR-0010](docs/adr/0010-labelled-tags-and-lexicographic-labels.md)).
>
> Work advances in **loops — units of work, not units of time.** An earlier
> plan framed these as calendar weeks; that framing is retired.

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

> **Testing login locally:** the dev server binds **http://127.0.0.1:5173**
> (not `localhost`) because AT Protocol's loopback OAuth callback always targets
> `127.0.0.1`. If you open `localhost`, the app redirects you to the `127.0.0.1`
> origin automatically so the whole login flow shares one origin. Production over
> HTTPS has no such constraint.

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
