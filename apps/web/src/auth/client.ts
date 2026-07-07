import { BrowserOAuthClient, buildLoopbackClientId } from "@atproto/oauth-client-browser";

// AT Protocol OAuth, entirely in the browser.
//
// There is no backend involvement: the SPA *is* the OAuth client. Tokens are
// DPoP-bound and stored client-side (IndexedDB) by the library. See
// docs/adr/0002 for why this fits an AppView (the API only ever reads the
// firehose; writes go browser → the user's own PDS directly).

// `atproto` is the required base scope; `transition:generic` grants the broad
// XRPC access we'll need later to write `eu.leksis.entry` records to the user's
// PDS. (For production this is declared in /client-metadata.json; the dev
// loopback client grants it automatically.)
export const OAUTH_SCOPE = "atproto transition:generic";

// Public resolver used to turn a handle/DID into its PDS + auth server.
const HANDLE_RESOLVER = "https://bsky.social";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Dev only. AT Proto loopback OAuth always redirects back to the canonical
 * `127.0.0.1` host, and the PKCE/state is stored per-origin — so the *entire*
 * flow must run on `127.0.0.1`, never `localhost`/`::1` (otherwise the callback
 * lands on an origin with no stored state). If we're served from one of those,
 * bounce to the 127.0.0.1 equivalent once, before any OAuth state is created.
 * Returns true when a navigation is underway (the caller should not render).
 * No-op in a production build, which is served from a real HTTPS host.
 */
export function ensureLoopbackHost(): boolean {
  if (!import.meta.env.DEV) return false;
  const { hostname } = window.location;
  if (hostname === "localhost" || hostname === "::1" || hostname === "[::1]") {
    const url = new URL(window.location.href);
    url.hostname = "127.0.0.1";
    window.location.replace(url.toString());
    return true;
  }
  return false;
}

function resolveClientId(): string {
  // In local dev (loopback host) AT Proto allows a special development client
  // id derived from the current URL — no hosted metadata file required.
  if (LOOPBACK_HOSTS.has(window.location.hostname)) {
    return buildLoopbackClientId(window.location);
  }
  // In production the client id is the public URL of the static metadata file
  // served by nginx at the site root (apps/web/public/client-metadata.json).
  return `${window.location.origin}/client-metadata.json`;
}

// The client loads asynchronously (it fetches authorization-server metadata),
// so memoise the promise and reuse the single instance everywhere.
let clientPromise: Promise<BrowserOAuthClient> | null = null;

export function getOAuthClient(): Promise<BrowserOAuthClient> {
  if (!clientPromise) {
    clientPromise = BrowserOAuthClient.load({
      clientId: resolveClientId(),
      handleResolver: HANDLE_RESOLVER,
    });
  }
  return clientPromise;
}
