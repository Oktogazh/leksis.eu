import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { LanguageView } from "@leksis/types";
import { endonym } from "./LanguageSelector";

interface LanguageSearchBarProps {
  /** The languages to search over (as served by GET /languages for the UI locale). */
  languages: LanguageView[];
  /** Called with the tag of the language the user picks from the results. */
  onSelect: (tag: string) => void;
  /** Tags to omit from the results — e.g. languages already listed above. */
  exclude?: string[];
  /** Placeholder for the input; defaults to the shared search copy. */
  placeholder?: string;
  /** Max results shown while typing (the list scrolls beyond it). */
  limit?: number;
}

/**
 * A reusable search over the known languages: finds a language by its name in
 * the UI locale, its endonym, or its BCP 47 code (the chip shown beside the
 * name). Purely presentational — it filters the list it's given and reports
 * the picked tag; callers decide what a pick means (reveal a name row, add a
 * translation, …). No network. Future call sites (entry editor language pick,
 * etc.) reuse it.
 */
export function LanguageSearchBar({
  languages,
  onSelect,
  exclude = [],
  placeholder,
  limit = 30,
}: LanguageSearchBarProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");

  const excluded = useMemo(() => new Set(exclude), [exclude]);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const candidates = languages.filter((l) => !excluded.has(l.tag));
    if (q === "") return candidates.slice(0, limit);
    return candidates
      .filter((l) => {
        const name = l.name?.toLowerCase() ?? "";
        return (
          l.tag.toLowerCase().includes(q) ||
          l.endonym.toLowerCase().includes(q) ||
          name.includes(q)
        );
      })
      .slice(0, limit);
  }, [languages, excluded, query, limit]);

  return (
    <div>
      <label className="sr-only" htmlFor="language-search">
        {t("languageSearch.label")}
      </label>
      <input
        id="language-search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder ?? t("languageSearch.placeholder")}
        autoCapitalize="none"
        autoCorrect="off"
        className="w-full rounded-lg border bg-surface px-3 py-2 text-sm text-content outline-none placeholder:text-content-subtle focus:ring-2"
      />
      {results.length === 0 ? (
        <p className="mt-2 text-sm text-content-muted">{t("languageSearch.empty")}</p>
      ) : (
        <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
          {results.map((l) => (
            <li key={l.tag}>
              <button
                type="button"
                onClick={() => onSelect(l.tag)}
                className="flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm text-content hover:border-primary hover:bg-surface-muted"
              >
                <span className="min-w-0 flex-1 truncate">
                  {endonym(l)}
                  {l.name !== undefined && l.name !== l.endonym && (
                    <span className="text-content-subtle"> · {l.name}</span>
                  )}
                </span>
                <span className="shrink-0 rounded border bg-surface px-1.5 py-0.5 font-mono text-xs text-content-muted">
                  {l.tag}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
