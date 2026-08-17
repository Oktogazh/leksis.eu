import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { SEARCH_RATE_LIMIT_MS, type LanguageView, type SourceView } from "@leksis/types";
import { RateLimitedError, searchSources } from "../lib/api";
import { CreatePanel, type CreateActions } from "./CreatePanel";
import type { SearchKind } from "../lib/search-kind";

// Paced outside the AppView's search window, as in SearchResults — see the note
// there. Same ~60s of PDS → Jetstream → ArangoDB latency covered.
const SYNC_POLL_MS = SEARCH_RATE_LIMIT_MS + 1_000;
const SYNC_POLL_MAX_TRIES = 10;

interface SourceResultsProps {
  /** The submitted search term. */
  query: string;
  /** All known languages, for the create chooser's pickers. */
  languages: LanguageView[];
  /** Scope of the search; null means every language. */
  language: LanguageView | null;
  kind: SearchKind;
  create: CreateActions;
  /** Navigate to a source's page. */
  onOpenSource: (oclc: string) => void;
}

/**
 * Works matching the query, by citation form, title or author.
 *
 * The rows print `citation.short` and `citation.long` because those are the
 * two fields the index carries — title and author are searchable but never
 * served, so a fifty-hit list costs no PDS round trips at all.
 */
export function SourceResults({
  query,
  languages,
  language,
  kind,
  create,
  onOpenSource,
}: SourceResultsProps) {
  const { t } = useTranslation();
  const [sources, setSources] = useState<SourceView[] | null>(null);
  /** Why there are no results — see the note in SearchResults. */
  const [failure, setFailure] = useState<"unreachable" | "rateLimited" | null>(null);
  /** A number published to the PDS but not yet seen back from the AppView. */
  const [syncingOclc, setSyncingOclc] = useState<string | null>(null);

  const languageTag = language?.tag ?? "";

  useEffect(() => {
    let cancelled = false;
    setSources(null);
    setFailure(null);
    searchSources(query, languageTag)
      .then((found) => {
        if (!cancelled) setSources(found);
      })
      .catch((err: unknown) => {
        console.error("source search failed:", err);
        if (!cancelled) {
          setFailure(err instanceof RateLimitedError ? "rateLimited" : "unreachable");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [query, languageTag]);

  useEffect(() => {
    if (syncingOclc === null) return;
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      searchSources(query, languageTag)
        .then((found) => {
          if (found.some((s) => s.oclc === syncingOclc)) {
            setSources(found);
            setSyncingOclc(null);
          } else if (tries >= SYNC_POLL_MAX_TRIES) {
            console.warn(`source ${syncingOclc} not indexed after polling; giving up`);
            setSyncingOclc(null);
          }
        })
        .catch(() => {
          /* transient — keep polling */
        });
    }, SYNC_POLL_MS);
    return () => clearInterval(timer);
  }, [syncingOclc, query, languageTag]);

  return (
    <section className="mt-8" aria-live="polite">
      <h2 className="text-lg font-semibold text-content">
        {t("search.sourcesResultsTitle", { query })}
      </h2>

      <CreatePanel
        key={`sources:${languageTag}:${query}`}
        query={query}
        languages={languages}
        language={language}
        kind={kind}
        onEntryCreated={create.onEntryCreated}
        onLanguageCreated={create.onLanguageCreated}
        onSourcePublished={(oclc) => {
          setSyncingOclc(oclc);
          create.onSourcePublished(oclc);
        }}
      />

      {failure !== null ? (
        <p className="mt-4 text-sm text-danger">
          {t(failure === "rateLimited" ? "search.rateLimited" : "search.sourcesLoadFailed")}
        </p>
      ) : sources !== null && sources.length > 0 ? (
        <ul className="mt-4 divide-y rounded-lg border bg-surface shadow-sm">
          {sources.map((source) => (
            <li key={source.oclc}>
              <button
                type="button"
                onClick={() => onOpenSource(source.oclc)}
                className="w-full px-4 py-3 text-left hover:bg-surface-muted/60"
              >
                <span className="block text-sm font-medium text-content">
                  {source.citation.short}
                </span>
                <span className="mt-0.5 block text-sm text-content-muted">
                  {source.citation.long}
                </span>
                <span className="mt-1 flex flex-wrap items-center gap-1.5">
                  {source.languages.map((tag, i) => (
                    <span
                      key={tag}
                      className="rounded border bg-surface px-1.5 py-0.5 font-mono text-xs text-content-muted"
                    >
                      {tag}
                      {i === 0 && (
                        <span className="ml-1 font-sans text-content-subtle">
                          {t("search.sourceMain")}
                        </span>
                      )}
                    </span>
                  ))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : sources !== null ? (
        <div className="mt-4 rounded-lg border border-dashed bg-surface px-4 py-6 text-center sm:px-6">
          <p className="text-sm font-medium text-content">{t("search.sourcesEmpty")}</p>
          <p className="mt-1 text-sm text-content-muted">{t("search.sourcesEmptyHint")}</p>
        </div>
      ) : null}

      {syncingOclc !== null && (
        <p className="mt-3 text-sm text-content-subtle">{t("search.syncingSource")}</p>
      )}
    </section>
  );
}
