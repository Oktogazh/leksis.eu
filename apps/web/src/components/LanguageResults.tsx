import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { LanguageView } from "@leksis/types";
import { CreatePanel, type CreateActions } from "./CreatePanel";
import { matchLanguages } from "./LanguageSearchBar";
import { endonym } from "./LanguageSelector";
import type { SearchKind } from "../lib/search-kind";

interface LanguageResultsProps {
  /** The submitted search term. */
  query: string;
  /** All known languages — the whole corpus this kind searches. */
  languages: LanguageView[];
  /** Scope of the search, carried so the create chooser stays seeded. */
  language: LanguageView | null;
  kind: SearchKind;
  create: CreateActions;
  /** Navigate to a language's page. */
  onOpenLanguage: (tag: string) => void;
}

/**
 * Languages matching the query.
 *
 * **No endpoint and no request**: the full language list is already loaded for
 * the scope picker, so searching it is a filter. That is not a shortcut — it is
 * what the data shape allows, and adding a server round trip for it would buy
 * nothing but latency.
 */
export function LanguageResults({
  query,
  languages,
  language,
  kind,
  create,
  onOpenLanguage,
}: LanguageResultsProps) {
  const { t } = useTranslation();
  const results = useMemo(() => matchLanguages(languages, query), [languages, query]);

  return (
    <section className="mt-8" aria-live="polite">
      <h2 className="text-lg font-semibold text-content">
        {t("search.languagesResultsTitle", { query })}
      </h2>

      <CreatePanel
        key={`languages:${query}`}
        query={query}
        languages={languages}
        language={language}
        kind={kind}
        onEntryCreated={create.onEntryCreated}
        onLanguageCreated={create.onLanguageCreated}
        onSourcePublished={create.onSourcePublished}
      />

      {results.length > 0 ? (
        <ul className="mt-4 divide-y rounded-lg border bg-surface shadow-sm">
          {results.map((l) => (
            <li key={l.tag}>
              <button
                type="button"
                onClick={() => onOpenLanguage(l.tag)}
                className="flex w-full items-baseline justify-between gap-3 px-4 py-3 text-left hover:bg-surface-muted/60"
              >
                <span className="min-w-0">
                  <span className="text-sm font-medium text-content">{endonym(l)}</span>
                  {l.name !== undefined && l.name !== l.endonym && (
                    <span className="ml-2 text-sm text-content-muted">{l.name}</span>
                  )}
                </span>
                <span className="shrink-0 rounded border bg-surface px-1.5 py-0.5 font-mono text-xs text-content-muted">
                  {l.tag}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-4 rounded-lg border border-dashed bg-surface px-4 py-6 text-center sm:px-6">
          <p className="text-sm font-medium text-content">{t("search.languagesEmpty")}</p>
          <p className="mt-1 text-sm text-content-muted">{t("search.languagesEmptyHint")}</p>
        </div>
      )}
    </section>
  );
}
