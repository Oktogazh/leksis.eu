import type {
  AbbreviationsResponse,
  AbbreviationView,
  CurrentLanguageRecordResponse,
  EntriesResponse,
  EntryView,
  LanguageDashboardResponse,
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

/**
 * A language's abbreviation pairs — categories and definition notes of its
 * current entries — most used first, with conflicts. Powers the editor's
 * suggestions and the conflict flags; never lists the entries themselves.
 */
export async function fetchAbbreviations(languageTag: string): Promise<AbbreviationView[]> {
  const res = await fetch(
    `${API_BASE}/languages/${encodeURIComponent(languageTag)}/abbreviations`,
  );
  if (!res.ok) {
    throw new Error(`GET /languages/${languageTag}/abbreviations failed: ${res.status}`);
  }
  const body = (await res.json()) as AbbreviationsResponse;
  return body.abbreviations;
}

/**
 * A language's dashboard: counters, the to-be-completed queue, the activity
 * feed and the per-day activity series. Null when the language is unknown.
 */
export async function fetchLanguageDashboard(
  languageTag: string,
): Promise<LanguageDashboardResponse | null> {
  const res = await fetch(`${API_BASE}/languages/${encodeURIComponent(languageTag)}/dashboard`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET /languages/${languageTag}/dashboard failed: ${res.status}`);
  return (await res.json()) as LanguageDashboardResponse;
}

/**
 * The reference to a language's current eu.leksis.language record (tag,
 * recordURI, authorDID), or null when the language is unknown. Lets the
 * browser resolve and rewrite another language's record — e.g. to correct its
 * name in this language — without pulling the whole dashboard.
 */
export async function fetchCurrentLanguageRecord(
  languageTag: string,
): Promise<CurrentLanguageRecordResponse | null> {
  const res = await fetch(
    `${API_BASE}/languages/${encodeURIComponent(languageTag)}/currentRecord`,
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`GET /languages/${languageTag}/currentRecord failed: ${res.status}`);
  }
  return (await res.json()) as CurrentLanguageRecordResponse;
}

/** The current version of one entry by its stable key, or null when unknown. */
export async function fetchEntry(key: string): Promise<EntryView | null> {
  const res = await fetch(`${API_BASE}/entries/${encodeURIComponent(key)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET /entries/${key} failed: ${res.status}`);
  return (await res.json()) as EntryView;
}
