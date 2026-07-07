# ADR-0002: AT Protocol OAuth client model (browser-only)

**Status:** Accepted
**Date:** 2026-06-25
**Deciders:** Alan (solo dev)

## Context

Week 2 turns the placeholder PDS connect/disconnect toggle into real
authentication. AT Protocol uses OAuth 2.0 (PKCE + DPoP + PAR); users log in
against **their own PDS** (Bluesky or any other), not against a Leksis account.

There are two ways to wire this up, and the choice decides whether the backend
is touched at all:

- **Browser-only** — the SPA is the OAuth client (`@atproto/oauth-client-browser`).
  Tokens are DPoP-bound and stored client-side (IndexedDB). The OAuth `client_id`
  is a public URL to a static `client-metadata.json`.
- **Backend-mediated (BFF)** — the API (`@atproto/oauth-client-node`) handles the
  callback, stores tokens server-side, and issues an httpOnly session cookie.
  This is what the Week-1 placeholder hinted at (`/auth/login`, cookie session).

The deciding question is whether the **AppView** ever needs to act on the user's
behalf. It does not: it ingests data from the firehose (`subscribeRepos`), and
when entry-writing arrives (Week 4+) the write goes **browser → the user's own
PDS** directly (`com.atproto.repo.putRecord`); the AppView then re-indexes the
new record from the relay. The backend never holds a user token at any point in
the product's lifecycle.

## Decision

Use **browser-only AT Protocol OAuth** via `@atproto/oauth-client-browser`.

- The SPA is the OAuth client. `getOAuthClient()` (`apps/web/src/auth/client.ts`)
  loads a `BrowserOAuthClient`; `SessionProvider` restores/processes the session
  and exposes `{ status, did, handle, agent, signIn, signOut }`.
- **`client_id` in production** = `https://leksis.eu/client-metadata.json`, a
  static file in `apps/web/public/` served by the existing nginx/web container.
- **Local dev** uses the AT Proto loopback client (`buildLoopbackClientId`),
  which requires the `127.0.0.1` host — see Consequences.
- Scope: `atproto transition:generic` (base + broad XRPC, needed later to write
  `eu.leksis.entry` records).
- **`apps/api` is not modified.** No `/auth/*` routes, no server session store.

## Options Considered

### Option A: Browser-only OAuth (chosen)
| Dimension | Assessment |
|-----------|------------|
| Complexity | Low — one static metadata file, no server session |
| Backend impact | **None** (`apps/api` untouched) |
| Fit with AppView model | High — backend never needs user tokens |
| Token exposure | Client-side IndexedDB, but DPoP-bound (not bearer) |

**Pros:** zero backend surface; matches the decentralised "your words, your
server" model; tokens are sender-constrained (DPoP).
**Cons:** tokens live in the browser; needs a stable HTTPS client-metadata URL
in prod and the `127.0.0.1` loopback host in dev.

### Option B: Backend-mediated session (BFF)
**Pros:** httpOnly cookie; tokens never in JS; central revocation.
**Cons:** new `/auth/*` API surface + a session store to build and secure, for a
session the AppView never uses. Solves a problem we don't have.

### Option C: App-password login (`createSession`)
**Pros:** simplest; pure browser; no metadata file.
**Cons:** deprecated UX direction; users must mint app passwords; weaker than
OAuth. Rejected — Week 2's milestone is real OAuth.

## Consequences

- **Easier:** the backend stays a pure indexer; login is a frontend-only
  concern; the auth path is fully decentralised.
- **Harder / to watch:**
  - Production needs `https://leksis.eu/client-metadata.json` reachable and its
    `client_id` to equal that exact URL. If the domain changes, regenerate it.
  - **Local dev runs on `http://127.0.0.1:5173`, not `localhost`.** The loopback
    OAuth callback always targets `127.0.0.1`, and the PKCE state is stored
    per-origin, so the whole flow must share that origin. Two dev-only measures
    enforce it: Vite binds `127.0.0.1` (`vite.config.ts`), and
    `ensureLoopbackHost()` redirects any `localhost`/`::1` load to `127.0.0.1`
    before rendering. Production (HTTPS) is unaffected.
  - Token refresh/expiry is handled by the library client-side; there is no
    server fallback.
- **Supersedes** the Week-1 placeholder's assumption of an httpOnly cookie
  session (`apps/web/src/lib/session.ts`, now removed) and the matching note in
  `packages/types`.
- **Revisit when:** a future feature genuinely needs server-side action on a
  user's behalf (none is foreseen), or granular AT Proto scopes replace
  `transition:generic`.

## Action Items
1. [x] Add `@atproto/oauth-client-browser` + `@atproto/api`; build `auth/client.ts` + `auth/SessionProvider.tsx`
2. [x] Add `apps/web/public/client-metadata.json` (production client id)
3. [x] Remove the placeholder session store; correct the `Session` type/comments
4. [x] Pin dev to `127.0.0.1` (Vite `host` + `ensureLoopbackHost()` redirect) + document it
5. [ ] Verify the live OAuth round-trip on the deployed HTTPS site (a real PDS login) — pending deploy
