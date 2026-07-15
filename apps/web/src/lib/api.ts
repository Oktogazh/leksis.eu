import type {
  EntriesResponse,
  EntryView,
  LanguagesResponse,
  LanguageView,
} from "@leksis/types";

/*
 * Base URL for the API.
 * Precedence: explicit VITE_API_URL (e.g. point frontend dev at api production) → localhost port in dev → same-origin "/api" in production (Caddy proxies it)..
 */
const API_BASE =
  import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? "http://127.0.0.1:8080" : "/api");


/**
 * Available languages known to the AppView, sorted by tag, with names localized into `locale` where the language records provide them.
 */
export async function fetchLanguages(locale: string): Promise<LanguageView[]> {
  const res = await fetch(`${API_BASE}/languages?locale=${encodeURIComponent(locale)}`);
  if (!res.ok) throw new Error(`GET /languages failed: ${res.status}`);
  const body = (await res.json()) as LanguagesResponse;
  return body.languages;
}

/**
 * Case-insensitive orthography prefix search over current entries,
 * optionally scoped to one language tag ("" = all languages). Returns the
 * minimal search view — entry content is resolved from the author's PDS.
 */
export async function searchEntries(query: string, languageTag: string): Promise<EntryView[]> {
  const params = new URLSearchParams({ q: query });
  if (languageTag !== "") params.set("l", languageTag);
  const res = await fetch(`${API_BASE}/entries?${params.toString()}`);
  if (!res.ok) throw new Error(`GET /entries failed: ${res.status}`);
  const body = (await res.json()) as EntriesResponse;
  return body.entries;
}

/** The current version of one entry by its stable key, or null when unknown. */
export async function fetchEntry(key: string): Promise<EntryView | null> {
  const res = await fetch(`${API_BASE}/entries/${encodeURIComponent(key)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET /entries/${key} failed: ${res.status}`);
  return (await res.json()) as EntryView;
}
