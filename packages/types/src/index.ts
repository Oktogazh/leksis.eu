// Shared TypeScript types imported by both apps/web and apps/api.
// Week 2: the API health contract and the PDS session shape.
// Week 3 adds the eu.leksis.language contract and the shared BCP-47 validator;
// week 4 adds the eu.leksis.entry contract.

export * from "./language.js";
export * from "./entry.js";
export * from "./abbreviation.js";
export * from "./dashboard.js";
export * from "./bcp47.js";

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
