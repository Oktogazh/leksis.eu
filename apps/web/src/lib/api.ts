import type { LanguagesResponse, LanguageView } from "@leksis/types";

// Same-origin "/api" in production (Caddy strips the prefix and proxies to the
// api container); direct localhost port in dev, where the api runs standalone.
const API_BASE = import.meta.env.DEV ? "http://127.0.0.1:8080" : "/api";

/**
 * Available languages known to the AppView, sorted by tag, with names
 * localized into `locale` where the language records provide them.
 */
export async function fetchLanguages(locale: string): Promise<LanguageView[]> {
  const res = await fetch(`${API_BASE}/languages?locale=${encodeURIComponent(locale)}`);
  if (!res.ok) throw new Error(`GET /languages failed: ${res.status}`);
  const body = (await res.json()) as LanguagesResponse;
  return body.languages;
}
