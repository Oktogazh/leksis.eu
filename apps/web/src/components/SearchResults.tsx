import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { EntryView, LanguageView } from "@leksis/types";
import { searchEntries } from "../lib/api";
import { CreateEntryPanel } from "./CreateEntryPanel";
import { endonym } from "./LanguageSelector";

const SYNC_POLL_MS = 3_000;
const SYNC_POLL_MAX_TRIES = 20; // ~60s of PDS → Jetstream → ArangoDB latency

interface SearchResultsProps {
  /** The submitted search term. */
  query: string;
  /** All known languages, offered as the create-entry panel's picker when unscoped. */
  languages: LanguageView[];
  /** Scope of the search; null means all languages. */
  language: LanguageView | null;
  /** Navigate to an entry's page (?e=<key>). */
  onOpenEntry: (key: string) => void;
}

/**
 * The search-results surface: entries whose orthographies match the query
 * (prefix, case-insensitive), each linking to its entry page, followed by
 * the offer to create the searched word. After a creation the list polls
 * until the new record has round-tripped PDS → Jetstream → ArangoDB.
 */
export function SearchResults({ query, languages, language, onOpenEntry }: SearchResultsProps) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<EntryView[] | null>(null);
  const [failed, setFailed] = useState(false);
  /** Record URI written to the PDS but not yet seen back from the AppView. */
  const [syncingURI, setSyncingURI] = useState<string | null>(null);

  const languageTag = language?.tag ?? "";

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setFailed(false);
    searchEntries(query, languageTag)
      .then((found) => {
        if (!cancelled) setEntries(found);
      })
      .catch((err) => {
        console.error("entry search failed:", err);
        if (!cancelled) setFailed(true);
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

  const languageName = (tag: string) => {
    const known = languages.find((l) => l.tag === tag);
    return known ? endonym(known) : tag;
  };

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

      {failed ? (
        <p className="mt-4 text-sm text-red-600">{t("search.loadFailed")}</p>
      ) : entries !== null && entries.length > 0 ? (
        <ul className="mt-4 divide-y rounded-lg border bg-surface shadow-sm">
          {entries.map((entry) => (
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

      <CreateEntryPanel
        key={`${language?.tag ?? ""}:${query}`}
        word={query}
        languages={languages}
        language={language}
        onCreated={setSyncingURI}
      />
    </section>
  );
}
