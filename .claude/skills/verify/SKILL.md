---
name: verify
description: >
  How to prove a code change actually works in the Leksis repo before calling it done.
  Use whenever a change to apps/web, apps/api, or packages/types needs verification —
  after implementing a feature or fix, before committing, or when asked "does it work?".
  Covers change-level proof only (local, per-edit); milestone-level verification
  (deploy, live URL, CHANGELOG) belongs to the `leksis-evolution` skill.
---

# Leksis — Change Verification

A change is verified when the affected flow has been **exercised and observed**, not when
the compiler is happy. Climb this ladder as far as the change's runtime surface allows.

## The ladder of proof

| Level | What it proves | When it's enough |
|---|---|---|
| 1. Typecheck + lint | The code is coherent | Never on its own — it's the floor, and the PostToolUse hook already runs it for you after every edit |
| 2. App starts cleanly | Nothing broke wiring/imports | Refactors with no behavior change |
| 3. Affected flow exercised | The change does what it claims | Default target for any feature or fix |
| 4. Proof shared | The user can see it worked | Always end here: screenshot, curl output, or log excerpt |

Level 1 runs automatically (`.claude/hooks/verify-edit.sh` → `npx turbo run typecheck lint
--filter=<pkg>`). To run it manually: `npx turbo run typecheck lint --filter=@leksis/web`
(or `@leksis/api`, `@leksis/types`).

## Web changes (`apps/web`)

Vite dev server, port 5173, defined as `web` in `.claude/launch.json`.

1. Start it with the preview tools (`preview_start` with name `web`), never with raw Bash.
2. `preview_console_logs` (level `error`) — must be clean.
3. `preview_snapshot` — confirm the changed content/structure is actually rendered.
4. If the change is interactive: `preview_click` / `preview_fill` the real flow, then
   snapshot again to confirm the outcome.
5. If the change touches layout, theming, or i18n: `preview_resize` for mobile (375px)
   and dark mode — the app is a PWA-to-be, mobile is not optional.
6. Proof: `preview_screenshot` for visual changes, console/network output otherwise.

### The session wall — authenticated surfaces cannot be exercised locally (unsolved)

`App.tsx` renders `LandingPage` whenever the session is `disconnected`, and rewrites any
resource URL back to `/`. So **every surface except the landing page sits behind a login**:
the search results, the entry page, the language dashboard, and all the editors. Starting
the preview proves the app boots; it proves nothing at all about a change to any of them.

**An agent cannot clear this wall by logging in.** Typing a password into a form is
prohibited for the agent whoever supplies it, so the test account's published credentials
(`leksis-testset` §7) do **not** unblock an agentic session — do not plan a verification
pass as though they do.

**What to do until it is solved.** Verify to level 2, then prove the change's *data
contract* directly — curl the endpoints the surface consumes, seeding fixtures with
`apps/api/src/scripts/verify-network.ts --seed` or the equivalent for that surface — and
then **say plainly that the UI was never driven**. A change proven this far is not
verified, and calling it verified is the failure this skill exists to prevent. When a human
is present the one-line unblock is to ask them to log in in the preview tab and hand it
back; that is a round trip, not a solution.

**Leads for actually solving it — none tried, in rough order of promise:**

1. **A local PDS.** `docker-compose.yml` already defines a `pds` service
   (`ghcr.io/bluesky-social/pds:0.4`). It wants `PDS_JWT_SECRET` and friends in `.env`,
   whose absence is why `docker compose ps` currently fails outright. An account on a
   local PDS could have its session **minted by script** rather than typed into a form.
2. **A restorable session fixture.** `@atproto/oauth-client-browser` persists a DPoP-bound
   session in browser storage. If that can be exported once from a human-logged-in profile
   and re-seeded before load, an agent *restores* a session instead of authenticating.
   Whether the DPoP key material survives the round trip is the thing to establish first —
   if it does not, this lead is dead and should be struck from this list.
3. **A dev-only bypass.** A `VITE_DEV_SESSION` flag mounting `HomePage` with a stub
   session. Cheapest and least faithful: it touches app code, it verifies a surface no real
   user reaches, and it must be impossible to enable in a production build.

### The CORS wall — a local web dev server cannot call a local API (worked around)

A second, independent blocker, proven on 2026-08-05. The API **deliberately emits no CORS
headers** (`apps/api/src/index.ts`: Caddy is the single `Access-Control-Allow-Origin`
authority, granting dev access per source IP via `ALLOWED_IPS`), `vite.config.ts` defines
**no proxy**, and `apps/web` ships **no `.env`**. So `API_BASE` resolves to
`http://127.0.0.1:8080`, every call from `:5173` is cross-origin, and the browser blocks
all of them — the symptom is `TypeError: Failed to fetch` on `fetchLanguages` with the API
answering `200` to the same URL under `curl`. Empty language dropdowns are the tell.

The supported path is what `API_BASE`'s own comment says: point the dev server at the
**production** API with `VITE_API_URL`. That is wrong for verifying unreleased work against
local fixtures, so the workaround used was a scratchpad reverse proxy that adds the header
(`:8081 → :8080`) plus a gitignored `apps/web/.env.local` holding
`VITE_API_URL=http://127.0.0.1:8081`. It works, and it is a shim: **the durable fix is a
`server.proxy` entry in `vite.config.ts`** mapping `/api` to `127.0.0.1:8080`, which would
also make dev match production's same-origin shape. That is a tracked-file change and needs
the user's approval — propose it rather than assuming it.

**A caveat that will otherwise waste the session that solves this:** local OAuth builds its
client id from `window.location`, so a **deep link on a cold load throws** and the login
form never appears — load `/` first, authenticate, then navigate in-app. Fixing
`resolveClientId` in `apps/web/src/auth/client.ts` to pass the origin instead of the whole
location is the recorded remedy (`leksis-testset` §7; ADR-0007's carried-forward item).

## API changes (`apps/api`)

Hono server, port 8080, requires ArangoDB. Two ways to get a running stack:

- **Fast loop** (preferred while iterating): ArangoDB running (via Docker), then
  `ARANGO_URL=http://localhost:8529 ARANGO_DB=leksis ARANGO_USER=root ARANGO_PASSWORD=<pw> npm run dev -w @leksis/api`
- **Full stack**: `docker compose up -d --build` (requires `.env` with
  `ARANGO_ROOT_PASSWORD`; see the comment header in `docker-compose.yml`).

Then:

1. `curl -s http://localhost:8080/health` — must report the database reachable. This is
   the minimum bar for *any* API change, since it exercises the ArangoDB connection.
2. `curl` the endpoint(s) the change touches with realistic payloads; check both the
   success path and one failure path (bad input, missing record).
3. If the change touches ArangoDB queries/collections, verify the data side too: inspect
   the collection via the endpoint that reads it back, not just the write's 200 response.
4. Proof: the actual curl request + response, quoted.

## Shared types (`packages/types`)

A type change ripples across all three surfaces. The filtered hook check is not enough:

1. Run `npm run typecheck` (all workspaces, from the repo root).
2. If the type mirrors the AT Proto lexicon or the ArangoDB schema, confirm the other
   two representations were updated in the same change (types are the contract — see
   `leksis-evolution` step 3).
3. Then verify whichever app consumes the changed type, per the sections above.

## Escalation: milestone completion

If the verified change completes a weekly milestone, local proof is not the end state.
Hand over to **`leksis-evolution`** (steps 3.6–3.7 and 4): tag a release, verify on the
live URL, and record the change in `CHANGELOG.md`. A milestone verified only on
localhost is not done.
