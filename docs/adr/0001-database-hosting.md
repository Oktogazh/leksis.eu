# ADR-0001: Database hosting & deployment for the prototype

**Status:** Accepted
**Date:** 2026-06-12
**Deciders:** Alan (solo dev)

## Context

The original plan assumed ArangoDB Cloud's free tier. In practice the managed
service costs ~€0.08/hr ≈ **€58/month**, always-on — and an AT Proto AppView
**cannot** be paused to save money, because from week 3 it must stay online to
consume the `subscribeRepos` firehose. The deployer has no prior ops experience
with managed cloud DBs, has **not** set up Fly.io, and is more comfortable
renting and running a normal VPS. The data model (AQL, graph traversal for
translations, AppView decomposition) is built around ArangoDB's multi-model
engine, so replacing the database is a high-cost pivot, not a config change.

## Decision

Run the whole prototype on a **single VPS** via docker-compose: self-hosted
**ArangoDB Community Edition** + the Hono API + the static web app, behind a
**Caddy** reverse proxy. ArangoDB is reachable only on the internal compose
network (`http://arangodb:8529`), never published to the host. Releases deploy
over SSH from GitHub Actions, triggered **only by a `v*` version tag**.


## Consequences

- **Easier:** cost €58→~€4/mo; one host, one `docker compose up`; DB never
  exposed publicly; same-origin API via Caddy (no CORS).
- **Harder:** deployer now owns backups (volume + periodic `arangodump`) and
  ArangoDB/OS upgrades; single-node means no HA.
- **Revisit when:** dataset outgrows the box (resize), or HA is needed
  (post-prototype: managed cloud or a cluster).
- **Doc debt cleared:** README/CHANGELOG and the leksis context now say
  "self-hosted CE on a VPS," not "ArangoDB Cloud free tier."

## Action Items
1. [x] Add `docker-compose.yml`, `Caddyfile`, root `.env.example`
2. [x] Remove Fly configs; switch CI deploy to tag-triggered SSH
3. [x] Provision the VPS; install Docker; clone repo to `/opt/leksis`
4. [x] Set GitHub secrets: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` (+ optional `VPS_SSH_PORT`)
5. [ ] Add a backup job (`arangodump` → off-box storage) before week 3 data matters
