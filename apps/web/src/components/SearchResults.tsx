import { useTranslation } from "react-i18next";
import type { LanguageView } from "@leksis/types";
import { CreateEntryPanel } from "./CreateEntryPanel";
import { endonym } from "./LanguageSelector";

interface SearchResultsProps {
  /** The submitted search term. */
  query: string;
  /** All known languages, offered as the create-entry panel's picker when unscoped. */
  languages: LanguageView[];
  /** Scope of the search; null means all languages. */
  language: LanguageView | null;
}

/**
 * The search-results surface. Entries don't exist yet (they arrive with the
 * week-4 loop), so the result list is honestly empty; the page's job today is
 * the other half of the flow — always offering to create the searched word,
 * preselected to the search's language scope when there was one.
 */
export function SearchResults({ query, languages, language }: SearchResultsProps) {
  const { t } = useTranslation();

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

      <div className="mt-4 rounded-lg border border-dashed bg-surface px-4 py-6 text-center sm:px-6">
        <p className="text-sm font-medium text-content">{t("search.empty")}</p>
        <p className="mt-1 text-sm text-content-muted">
          {language === null ? t("search.emptyHintAll") : t("search.emptyHintLanguage")}
        </p>
      </div>

      <CreateEntryPanel
        key={`${language?.tag ?? ""}:${query}`}
        word={query}
        languages={languages}
        language={language}
      />
    </section>
  );
}
