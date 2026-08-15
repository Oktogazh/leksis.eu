import {
  RESOLVE_URI_LIMIT,
  type LabelsResponse,
  type LabelView,
  type CognateNetworkResponse,
  type CurrentLanguageRecordResponse,
  type CurrentSourceRecordResponse,
  type EntriesResponse,
  type EntryRelationsResponse,
  type EntryResolveResponse,
  type EntryView,
  type LanguageDashboardResponse,
  type LanguageParadigmsResponse,
  type LanguageSourcesResponse,
  type LanguagesResponse,
  type LanguageView,
  type ParadigmView,
  type SourcesResponse,
  type SourceView,
  type TranslateResponse,
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
 * Map entry-record URIs to the entry keys their pages live at, for whichever
 * ones this AppView has indexed. Unresolved URIs are simply absent.
 *
 * **Never throws.** A caller reading records from a PDS has something to show
 * either way — the resolution only decides whether a row is a link — so a
 * failure degrades to "nothing resolved" rather than taking the surface down
 * with it. That also covers the window where the frontend is newer than the
 * deployed API and this route does not exist yet.
 */
export async function resolveEntryKeys(uris: string[]): Promise<Record<string, string>> {
  if (uris.length === 0) return {};
  const params = new URLSearchParams();
  for (const uri of uris.slice(0, RESOLVE_URI_LIMIT)) params.append("uri", uri);
  try {
    const res = await fetch(`${API_BASE}/entries/resolve?${params.toString()}`);
    if (!res.ok) return {};
    return ((await res.json()) as EntryResolveResponse).entries;
  } catch {
    return {};
  }
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
 * The pointers to a language's current paradigms, most specific selector first.
 *
 * Pointers only — the rules live on their authors' PDSs, and `lib/paradigms.ts`
 * is what resolves them. The order is the AppView's own precedence, so a caller
 * applying the first paradigm that fills a cell reproduces exactly what the
 * search index holds.
 */
export async function fetchLanguageParadigms(languageTag: string): Promise<ParadigmView[]> {
  const res = await fetch(`${API_BASE}/languages/${encodeURIComponent(languageTag)}/paradigms`);
  if (!res.ok) throw new Error(`GET /languages/${languageTag}/paradigms failed: ${res.status}`);
  return ((await res.json()) as LanguageParadigmsResponse).paradigms;
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

/**
 * One entry's cognate network: the whole connected component it sits in, plus
 * its own parked assertions. Null when the entry is unknown.
 *
 * The whole component rather than the direct cognates, deliberately — a cognate
 * network has no target and nothing to rank, and its *shape* is what says
 * something (how densely two languages' words link is evidence about how the
 * languages relate). The server bounds it and sets `truncated` when it cut.
 */
export async function fetchEntryCognates(key: string): Promise<CognateNetworkResponse | null> {
  const res = await fetch(`${API_BASE}/entries/${encodeURIComponent(key)}/cognates`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET /entries/${key}/cognates failed: ${res.status}`);
  return (await res.json()) as CognateNetworkResponse;
}

/** The current version of one entry by its stable key, or null when unknown. */
export async function fetchEntry(key: string): Promise<EntryView | null> {
  const res = await fetch(`${API_BASE}/entries/${encodeURIComponent(key)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET /entries/${key} failed: ${res.status}`);
  return (await res.json()) as EntryView;
}

/**
 * Case-insensitive prefix search over the works contributors have described,
 * matching their citation forms, title and author, optionally scoped to one
 * language ("" = all).
 *
 * The scope asks "does this source declare that language", not "is it that
 * language's source": a bilingual dictionary is offered to the entry editors of
 * both its languages, which is what the record's `languages` list is for.
 */
export async function searchSources(query: string, languageTag: string): Promise<SourceView[]> {
  const params = new URLSearchParams({ q: query });
  if (languageTag !== "") params.set("l", languageTag);
  const res = await fetch(`${API_BASE}/sources?${params.toString()}`);
  if (!res.ok) throw new Error(`GET /sources failed: ${res.status}`);
  const body = (await res.json()) as SourcesResponse;
  return body.sources;
}

/** Every source declaring this language, the ones whose main language it is first. */
export async function fetchLanguageSources(languageTag: string): Promise<SourceView[]> {
  const res = await fetch(`${API_BASE}/languages/${encodeURIComponent(languageTag)}/sources`);
  if (!res.ok) {
    throw new Error(`GET /languages/${languageTag}/sources failed: ${res.status}`);
  }
  const body = (await res.json()) as LanguageSourcesResponse;
  return body.sources;
}

/**
 * The reference to a source's current eu.leksis.source record, or null when
 * nobody has described this OCLC number yet.
 *
 * **Null is ordinary here, not an error.** An entry may cite a work before
 * anyone has described it — that is the point of citing the number rather than
 * a record URI — so every caller has a degraded rendering to fall back on.
 */
export async function fetchCurrentSourceRecord(
  oclc: string,
): Promise<CurrentSourceRecordResponse | null> {
  const res = await fetch(`${API_BASE}/sources/${encodeURIComponent(oclc)}/currentRecord`);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`GET /sources/${oclc}/currentRecord failed: ${res.status}`);
  }
  return (await res.json()) as CurrentSourceRecordResponse;
}
