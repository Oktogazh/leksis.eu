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

## Options Considered

### Option A — Self-host ArangoDB CE on Fly.io (separate app + volume)
| Dimension | Assessment |
|-----------|------------|
| Complexity | Med | Cost | ~€6–8/mo | Familiarity | Fly not yet set up |

**Pros:** managed-ish platform, built-in volume snapshots, private networking.
**Cons:** requires learning Fly; two-machine model; deployer prefers a plain server.

### Option B — Single VPS, docker-compose (ArangoDB + API + web + Caddy) ✅ chosen
| Dimension | Assessment |
|-----------|------------|
| Complexity | Med | Cost | ~€4/mo (Hetzner CX22, 4GB) | Familiarity | Matches deployer's comfort |

**Pros:** cheapest, most RAM/€, one host the deployer already knows how to run,
realizes the "share a server" instinct cleanly (separate containers, shared host).
**Cons:** owns OS patching, backups, TLS — mitigated by Caddy (auto-HTTPS) and
ArangoDB being internal-only.

### Option C — ArangoDB inside the API container/machine
Rejected: every API deploy would restart the DB; the firehose consumer and a
RAM-hungry graph engine would fight over one tiny VM; data volume coupled to the
app lifecycle.

### Option D — Pivot to free Postgres (Neon/Supabase)
Rejected: throws away the graph model that is the project's core thesis; rewrites
AQL, the AppView, and the data model. Wrong trade this early.

## Consequences

- **Easier:** cost €58→~€4/mo; one host, one `docker compose up`; DB never
  exposed publicly; same-origin API via Caddy (no CORS).
- **Harder:** deployer now owns backups (volume + periodic `arangodump`) and
  ArangoDB/OS upgrades; single-node means no HA.
- **Revisit when:** dataset outgrows the box (resize), or HA is needed
  (post-prototype: managed cloud or a cluster).
- **Doc debt cleared:** README/CHANGELOG and the glosis context now say
  "self-hosted CE on a VPS," not "ArangoDB Cloud free tier."

## Action Items
1. [x] Add `docker-compose.yml`, `Caddyfile`, root `.env.example`
2. [x] Remove Fly configs; switch CI deploy to tag-triggered SSH
3. [ ] Provision the VPS; install Docker; clone repo to `/opt/glosis`
4. [ ] Set GitHub secrets: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` (+ optional `VPS_SSH_PORT`)
5. [ ] Add a backup job (`arangodump` → off-box storage) before week 3 data matters
