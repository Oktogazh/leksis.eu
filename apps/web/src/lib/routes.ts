// Path-based routing: one canonical URL per resource page — /entry/<key>,
// /language/<tag> — while the query string stays reserved for parameterized
// views (the search surface: /?q=&l=). Hand-rolled on the History API: the
// app has three surfaces and no nested layouts, so a router library isn't
// warranted.

export type Route =
  | { kind: "search" }
  | { kind: "entry"; entryKey: string }
  | { kind: "language"; tag: string };

/** Parse the current pathname; unknown paths land on the search surface. */
export function routeFromLocation(): Route {
  const segments = window.location.pathname.split("/").filter((s) => s !== "");
  if (segments.length === 2 && segments[0] === "entry") {
    return { kind: "entry", entryKey: decodeURIComponent(segments[1]!) };
  }
  if (segments.length === 2 && segments[0] === "language") {
    return { kind: "language", tag: decodeURIComponent(segments[1]!) };
  }
  return { kind: "search" };
}

export const entryPath = (entryKey: string): string => `/entry/${encodeURIComponent(entryKey)}`;

export const languagePath = (tag: string): string => `/language/${encodeURIComponent(tag)}`;

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
