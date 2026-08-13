import { normalizeOclc } from "@leksis/types";

// Path-based routing: one canonical URL per resource page — /entry/<key>,
// /language/<tag> — while the query string stays reserved for parameterized
// views (the search surface: /?q=&l=). Hand-rolled on the History API: the
// app has three surfaces and no nested layouts, so a router library isn't
// warranted.

export type Route =
  | { kind: "search" }
  | { kind: "entry"; entryKey: string }
  | { kind: "language"; tag: string }
  /** `id` is an AT identifier: a DID (what the app links to) or a handle. */
  | { kind: "user"; id: string }
  /** `oclc` is always the normalized number — the source's identity. */
  | { kind: "source"; oclc: string };

/** Parse the current pathname; unknown paths land on the search surface. */
export function routeFromLocation(): Route {
  const segments = window.location.pathname.split("/").filter((s) => s !== "");
  if (segments.length === 2 && segments[0] === "entry") {
    return { kind: "entry", entryKey: decodeURIComponent(segments[1]!) };
  }
  if (segments.length === 2 && segments[0] === "language") {
    return { kind: "language", tag: decodeURIComponent(segments[1]!) };
  }
  if (segments.length === 2 && segments[0] === "user") {
    return { kind: "user", id: decodeURIComponent(segments[1]!) };
  }
  if (segments.length === 2 && segments[0] === "source") {
    // Normalized here rather than on the page, so `/source/(OCoLC)ocm00012345`
    // and `/source/12345` are one route to one work rather than two pages that
    // happen to load the same thing. A segment that is not a number at all
    // falls through to search, as any unknown path does.
    const oclc = normalizeOclc(decodeURIComponent(segments[1]!));
    if (oclc !== null) return { kind: "source", oclc };
  }
  return { kind: "search" };
}

export const entryPath = (entryKey: string): string => `/entry/${encodeURIComponent(entryKey)}`;

export const languagePath = (tag: string): string => `/language/${encodeURIComponent(tag)}`;

/**
 * A contributor's page. AT identifiers — handles and DIDs — are made of
 * characters a path segment already allows (`:` included), so the identifier
 * goes in verbatim and `/user/did:plc:…` stays readable in the address bar
 * instead of becoming `did%3Aplc%3A…`.
 */
export const userPath = (id: string): string => `/user/${id}`;

/** A described work. `oclc` should already be normalized — it is the identity. */
export const sourcePath = (oclc: string): string => `/source/${encodeURIComponent(oclc)}`;

/**
 * Navigate to a resource path from outside the routed surface (e.g. a dialog in
 * the header). pushState alone doesn't fire popstate, so HomePage — which
 * re-reads the route on popstate — wouldn't notice; dispatching a synthetic
 * popstate makes it re-route without a router library or shared route state.
 */
export function navigateTo(path: string): void {
  if (window.location.pathname + window.location.search === path) return;
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/**
 * Rewrite the legacy query-param entry route (?e=<entryKey>) to its path
 * URL, in place, so links shared before pages moved to paths keep working.
 * Runs once before the app renders.
 */
export function normalizeLegacyRoutes(): void {
  const legacyEntry = new URLSearchParams(window.location.search).get("e");
  if (legacyEntry) {
    window.history.replaceState(null, "", entryPath(legacyEntry));
  }
}
