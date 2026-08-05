import type {
  LabelsResponse,
  LabelView,
  CurrentLanguageRecordResponse,
  EntriesResponse,
  EntryRelationsResponse,
  EntryView,
  LanguageDashboardResponse,
  LanguagesResponse,
  LanguageView,
  TranslateResponse,
} from "@leksis/types";

/*
 * Base URL for the API: same-origin "/api" everywhere.
 *
 * In production Caddy proxies /api/* to the Hono app; in dev Vite's server
 * proxy does the same (see vite.config.ts), so the two environments have one
 * shape rather than two. This is deliberate — pointing dev straight at
 * :8080 makes every call cross-origin, and the API emits no CORS headers by
 * design, so the browser blocks the lot.
 *
 * VITE_API_URL still overrides it, for the one case that needs a different
 * origin: pointing a local frontend at the production API (which Caddy grants
 * CORS per source IP via ALLOWED_IPS).
 */
const API_BASE = import.meta.env.VITE_API_URL ?? "/api";


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
 * A language's labelled tags — every label its grammar declares, plus every tag
 * its entries use that nothing has named yet — most used first, with conflicts.
 * Powers the editor's suggestions, the viewer's label lookup and the conflict
 * flags; never lists the entries themselves.
 */
export async function fetchLabels(languageTag: string): Promise<LabelView[]> {
  const res = await fetch(`${API_BASE}/languages/${encodeURIComponent(languageTag)}/labels`);
  if (!res.ok) {
    throw new Error(`GET /languages/${languageTag}/labels failed: ${res.status}`);
  }
  const body = (await res.json()) as LabelsResponse;
  return body.labels;
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

/**
 * Translation search: the nearest equivalents of `query` in `to`, from every
 * sense of the matching entries in `from`.
 *
 * Both language tags are required by the endpoint — a translation search
 * silently answering about the wrong language is worse than an error, so it
 * refuses rather than degrading. `depth` is left to the server's default: a
 * reader has no way to judge how many other people's assertions a chain should
 * be allowed to cross.
 *
 * `from === to` is a legitimate search, not a degenerate one: a synonym is a
 * translation whose languages are equal.
 */
export async function fetchTranslations(
  query: string,
  from: string,
  to: string,
): Promise<TranslateResponse> {
  const params = new URLSearchParams({ q: query, from, to });
  const res = await fetch(`${API_BASE}/translate?${params.toString()}`);
  if (!res.ok) throw new Error(`GET /translate failed: ${res.status}`);
  return (await res.json()) as TranslateResponse;
}

/**
 * One entry's relations: what it can currently be shown with, plus the parked
 * ones needing repair. Null when the entry is unknown.
 *
 * `sides[0]` is always this entry's side, so the caller groups by its own
 * senses without inspecting both ends.
 */
export async function fetchEntryRelations(key: string): Promise<EntryRelationsResponse | null> {
  const res = await fetch(`${API_BASE}/entries/${encodeURIComponent(key)}/relations`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET /entries/${key}/relations failed: ${res.status}`);
  return (await res.json()) as EntryRelationsResponse;
}

/** The current version of one entry by its stable key, or null when unknown. */
export async function fetchEntry(key: string): Promise<EntryView | null> {
  const res = await fetch(`${API_BASE}/entries/${encodeURIComponent(key)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET /entries/${key} failed: ${res.status}`);
  return (await res.json()) as EntryView;
}
