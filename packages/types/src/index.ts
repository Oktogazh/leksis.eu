// Shared TypeScript types imported by both apps/web and apps/api.
// Week 2: the API health contract and the PDS session shape.
// Week 3 adds the eu.leksis.language contract and the shared BCP-47 validator;
// week 4 adds the eu.leksis.entry contract; the grammar layer adds the tag
// contract, UD's part-of-speech inventory and the language record's `grammar`;
// the translations loop adds the eu.leksis.relation contract behind the
// semantic network, and the cognate loop its word-level sibling
// eu.leksis.cognate; the sources loop adds eu.leksis.source, the work an
// example sentence is cited from; and the morphology arc's layer 5 adds
// eu.leksis.paradigm, a language's rules for generating inflected forms.

export * from "./language.js";
export * from "./entry.js";
export * from "./relation.js";
export * from "./cognate.js";
export * from "./source.js";
export * from "./label.js";
export * from "./dashboard.js";
export * from "./profile.js";
export * from "./bcp47.js";
export * from "./tag.js";
export * from "./upos.js";
export * from "./grammar.js";
export * from "./paradigm.js";

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
