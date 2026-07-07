// Shared TypeScript types imported by both apps/web and apps/api.
// Week 2 keeps this tiny: the API health contract and the PDS session shape.
// Domain types (LanguageID, IETFTag, Entry, ...) arrive with the lexicon in the
// dictionary loops (week 3+).

/** Response shape for the API health-check endpoint. */
export interface HealthResponse {
  status: "ok";
  service: string;
  db: "connected" | "unreachable";
  time: string;
}

/**
 * Serializable view of the PDS session, used by the frontend's
 * connected / disconnected workflow.
 *
 * Authentication is **browser-only** AT Proto OAuth (see
 * docs/adr/0002-atproto-oauth-client-model.md): the SPA is the OAuth client,
 * DPoP-bound tokens live client-side, and the API is never in the auth path —
 * so there is no server session or cookie here, just the identity the frontend
 * resolved after login.
 */
export type Session =
  | { state: "disconnected" }
  | { state: "connected"; did: string; handle: string };
