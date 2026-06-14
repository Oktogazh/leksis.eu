// Shared TypeScript types imported by both apps/web and apps/api.
// Week 1 keeps this intentionally tiny: the API health contract and the
// minimal PDS session shape used by the login workflow. Domain types
// (LanguageID, IETFTag, Entry, ...) arrive with the lexicon in week 2+.

/** Response shape for the API health-check endpoint. */
export interface HealthResponse {
  status: "ok";
  service: string;
  db: "connected" | "unreachable";
  time: string;
}

/**
 * Minimal session model for the PDS connect / disconnect workflow.
 *
 * Week 1 is a local-only placeholder: `handle` is whatever the user typed.
 * Week 2 replaces this with a real AT Proto OAuth session (DID, tokens,
 * httpOnly cookie) without changing the frontend's connected/disconnected
 * mental model.
 */
export type Session =
  | { state: "disconnected" }
  | { state: "connected"; handle: string };
