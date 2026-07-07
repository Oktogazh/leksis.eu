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
