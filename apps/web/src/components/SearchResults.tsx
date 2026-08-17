import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  labelLookup,
  SEARCH_RATE_LIMIT_MS,
  type EntryView,
  type LabelView,
  type LanguageView,
} from "@leksis/types";
import { fetchLabels, RateLimitedError, searchEntries } from "../lib/api";
import { CreatePanel, type CreateActions } from "./CreatePanel";
import { TagLabel } from "./EntryPreview";
import { endonym } from "./LanguageSelector";
import type { SearchKind } from "../lib/search-kind";

// Paced just outside the AppView's search window (ADR-0017) rather than at the
// 3s this used to poll: a poll that lands inside the window is answered with a
// refusal, and one that is *refused* is one that did not look. Same ~60s of
// PDS → Jetstream → ArangoDB latency covered, in half the requests, all of
// which are answers.
const SYNC_POLL_MS = SEARCH_RATE_LIMIT_MS + 1_000;
const SYNC_POLL_MAX_TRIES = 10;

/**
 * Which half of the index the reader wants to see. A search over a language
 * with a dense paradigm answers with far more forms than headwords, and the two
 * are different questions: "is this word in the dictionary" and "what word is
 * this a form of".
 */
const MATCH_FILTERS = ["all", "headwords", "forms"] as const;
type MatchFilter = (typeof MATCH_FILTERS)[number];

/** Whether the query matched at least one of this entry's other forms. */
function hasFormHit(entry: EntryView): boolean {
  return (entry.match?.forms.length ?? 0) > 0;
}

/**
 * A language's labels, kept for the session: naming a matched form needs them,
 * and one search can hit several languages while the next hits the same ones
 * again. Stale by construction and harmlessly so — a renamed label shows up on
 * the next reload, and the alternative is a fetch per language per keystroke.
 */
const labelCache = new Map<string, LabelView[]>();

/** A language whose labels have not arrived (or do not exist) names nothing. */
const EMPTY_LOOKUP: ReadonlyMap<string, { long: string; short?: string }> = new Map();

interface SearchResultsProps {
  /** The submitted search term. */
  query: string;
  /** All known languages, offered as the create-entry panel's picker when unscoped. */
  languages: LanguageView[];
  /** Scope of the search; null means all languages. */
  language: LanguageView | null;
  /** The active search kind, so the create chooser opens on the right option. */
  kind: SearchKind;
  /** What the create chooser reports back; the entry half is wrapped below. */
  create: CreateActions;
  /** Navigate to an entry's page (?e=<key>). */
  onOpenEntry: (key: string) => void;
}

/**
 * The search-results surface: entries whose orthographies match the query
 * (prefix, case-insensitive), each linking to its entry page, followed by
 * the offer to create the searched word. After a creation the list polls
 * until the new record has round-tripped PDS → Jetstream → ArangoDB.
 */
export function SearchResults({
  query,
  languages,
  language,
  kind,
  create,
  onOpenEntry,
}: SearchResultsProps) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<EntryView[] | null>(null);
  /**
   * Why there are no results, when there are none for a reason other than the
   * dictionary being empty. `rateLimited` is separated from `unreachable`
   * because they ask opposite things of the reader: one is "try again shortly",
   * the other is "this address is already searching" — and a pacing refusal
   * shown as a failure reads as a broken dictionary.
   */
  const [failure, setFailure] = useState<"unreachable" | "rateLimited" | null>(null);
  /** Record URI written to the PDS but not yet seen back from the AppView. */
  const [syncingURI, setSyncingURI] = useState<string | null>(null);
  const [filter, setFilter] = useState<MatchFilter>("all");
  /** Labels of the languages whose forms this result set names, by tag. */
  const [labels, setLabels] = useState<ReadonlyMap<string, LabelView[]>>(new Map());

  const languageTag = language?.tag ?? "";

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setFailure(null);
    // A filter narrowed to one half of the previous results would silently hide
    // the new ones: the counts it was chosen against are gone.
    setFilter("all");
    searchEntries(query, languageTag)
      .then((found) => {
        if (!cancelled) setEntries(found);
      })
      .catch((err) => {
        console.error("entry search failed:", err);
        if (!cancelled) {
          setFailure(err instanceof RateLimitedError ? "rateLimited" : "unreachable");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [query, languageTag]);

  useEffect(() => {
    if (syncingURI === null) return;
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      searchEntries(query, languageTag)
        .then((found) => {
          if (found.some((e) => e.recordURI === syncingURI)) {
            setEntries(found);
            setSyncingURI(null);
          } else if (tries >= SYNC_POLL_MAX_TRIES) {
            console.warn(`entry ${syncingURI} not indexed after polling; giving up`);
            setSyncingURI(null);
          }
        })
        .catch(() => {
          /* transient — keep polling */
        });
    }, SYNC_POLL_MS);
    return () => clearInterval(timer);
  }, [syncingURI, query, languageTag]);

  // Only the languages whose forms are actually named, and only once each: a
  // headword hit needs no labels at all, and a result set is usually one
  // language or a handful.
  useEffect(() => {
    if (entries === null) return;
    const needed = [...new Set(entries.filter(hasFormHit).map((e) => e.languageID))];
    if (needed.length === 0) return;
    let cancelled = false;
    Promise.all(
      needed.map(async (tag) => {
        const cached = labelCache.get(tag);
        if (cached !== undefined) return [tag, cached] as const;
        // A language whose labels cannot be fetched is cached as none, not
        // retried per row: the form then renders verbatim and styled unbound,
        // which is what an unnamed tag looks like everywhere else.
        const list = await fetchLabels(tag).catch(() => [] as LabelView[]);
        labelCache.set(tag, list);
        return [tag, list] as const;
      }),
    ).then((pairs) => {
      if (!cancelled) setLabels(new Map(pairs));
    });
    return () => {
      cancelled = true;
    };
  }, [entries]);

  const lookups = useMemo(
    () => new Map([...labels].map(([tag, list]) => [tag, labelLookup(list)] as const)),
    [labels],
  );

  const languageName = (tag: string) => {
    const known = languages.find((l) => l.tag === tag);
    return known ? endonym(known) : tag;
  };

  const headwordHits = entries?.filter((e) => e.match?.headword !== false).length ?? 0;
  const formHits = entries?.filter(hasFormHit).length ?? 0;
  // Offered only when the two halves both answered: with one kind of hit, a
  // filter can only take results away.
  const filterable = headwordHits > 0 && formHits > 0;
  const shown = (entries ?? []).filter((entry) =>
    !filterable || filter === "all"
      ? true
      : filter === "headwords"
        ? entry.match?.headword !== false
        : hasFormHit(entry),
  );

  return (
    <section className="mt-8" aria-live="polite">
      <h2 className="text-lg font-semibold text-content">
        {t("search.resultsTitle", { query })}
      </h2>
      <p className="mt-0.5 text-sm text-content-muted">
        {language === null ? (
          t("search.scopeAll")
        ) : (
          <>
            {t("search.scopeLanguage", { language: endonym(language) })}{" "}
            <span className="rounded border bg-surface px-1.5 py-0.5 font-mono text-xs text-content-muted">
              {language.tag}
            </span>
          </>
        )}
      </p>

      {/* Above the results, not below them: somebody who did not find what
          they searched for should not have to scroll past what they did find
          in order to add it. */}
      <CreatePanel
        key={`${language?.tag ?? ""}:${query}`}
        query={query}
        languages={languages}
        language={language}
        kind={kind}
        onEntryCreated={(uri) => {
          setSyncingURI(uri);
          create.onEntryCreated(uri);
        }}
        onLanguageCreated={create.onLanguageCreated}
        onSourcePublished={create.onSourcePublished}
      />

      {failure !== null ? (
        <p className="mt-4 text-sm text-danger">
          {t(failure === "rateLimited" ? "search.rateLimited" : "search.loadFailed")}
        </p>
      ) : entries !== null && entries.length > 0 ? (
        <>
          {filterable && (
            <div
              className="mt-4 flex flex-wrap gap-2"
              role="tablist"
              aria-label={t("search.matchLabel")}
            >
              {MATCH_FILTERS.map((value) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={filter === value}
                  onClick={() => setFilter(value)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${
                    filter === value
                      ? "border-primary bg-surface text-primary"
                      : "text-content-subtle hover:border-primary"
                  }`}
                >
                  {value === "all"
                    ? t("search.matchAll", { n: entries.length })
                    : value === "headwords"
                      ? t("search.matchHeadwords", { n: headwordHits })
                      : t("search.matchForms", { n: formHits })}
                </button>
              ))}
            </div>
          )}
          <ul className="mt-4 divide-y rounded-lg border bg-surface shadow-sm">
            {shown.map((entry) => (
              <li key={entry.key}>
                <button
                  type="button"
                  onClick={() => onOpenEntry(entry.key)}
                  className="flex w-full items-baseline justify-between gap-3 px-4 py-3 text-left hover:bg-surface-muted/60"
                >
                  <span className="min-w-0">
                    <span className="text-sm font-medium text-content">
                      {entry.orthography[0]}
                    </span>
                    {entry.orthography.length > 1 && (
                      <span className="ml-2 text-sm text-content-muted">
                        {entry.orthography.slice(1).join(", ")}
                      </span>
                    )}
                    {/* What was matched, when it was not the headword above it:
                        the form's own spelling and the cell it fills, named by
                        the language's labels — never the canonical key, which
                        is an identifier and not something to read. */}
                    {hasFormHit(entry) && (
                      <span className="mt-1 block text-xs text-content-muted">
                        <span className="mr-1">
                          {t("search.formMatch", { count: entry.match!.forms.length })}
                        </span>
                        {entry.match!.forms.map((form, i) => (
                          <span key={i} className="mr-2 whitespace-nowrap">
                            <span
                              className={`text-content ${form.generated ? "italic" : "font-medium"}`}
                              {...(form.generated
                                ? { title: t("search.formGenerated") }
                                : {})}
                            >
                              {form.form}
                            </span>{" "}
                            <TagLabel
                              tag={form.tag}
                              lookup={lookups.get(entry.languageID) ?? EMPTY_LOOKUP}
                            />
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-sm text-content-muted">
                    {languageName(entry.languageID)}{" "}
                    <span className="rounded border bg-surface px-1.5 py-0.5 font-mono text-xs">
                      {entry.languageID}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : entries !== null ? (
        <div className="mt-4 rounded-lg border border-dashed bg-surface px-4 py-6 text-center sm:px-6">
          <p className="text-sm font-medium text-content">{t("search.empty")}</p>
          <p className="mt-1 text-sm text-content-muted">
            {language === null ? t("search.emptyHintAll") : t("search.emptyHintLanguage")}
          </p>
        </div>
      ) : null}

      {syncingURI !== null && (
        <p className="mt-3 text-sm text-content-subtle">{t("search.syncingEntry")}</p>
      )}
    </section>
  );
}
