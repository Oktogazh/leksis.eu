import { type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import type { LanguageView } from "@leksis/types";

// Sentinel value for the "Add a language…" option — never a valid BCP 47 tag.
export const ADD_LANGUAGE_VALUE = "__add__";

/** A language's display name: its endonym, falling back to the raw tag. */
export function endonym(language: LanguageView): string {
  return (
    language.translations.find((t) => t.languageID === language.tag)?.translation ??
    language.tag
  );
}

interface LanguageSelectorProps {
  languages: LanguageView[];
  /** Tags to surface first, most recent first (already filtered to known tags or not — unknown ones are ignored). */
  shortlist: string[];
  value: string;
  onChange: (tag: string) => void;
  onAddLanguage: () => void;
}

/**
 * The language-scope half of the search bar. Native <select> for the smallest
 * slice: a shortlist group of previously-used languages first, then the full
 * list, then the record-creation action.
 */
export function LanguageSelector({
  languages,
  shortlist,
  value,
  onChange,
  onAddLanguage,
}: LanguageSelectorProps) {
  const { t } = useTranslation();

  const byTag = new Map(languages.map((l) => [l.tag, l]));
  const shortlisted = shortlist
    .map((tag) => byTag.get(tag))
    .filter((l): l is LanguageView => l !== undefined);
  const rest = languages.filter((l) => !shortlist.includes(l.tag));

  function handleChange(event: ChangeEvent<HTMLSelectElement>) {
    const selected = event.target.value;
    if (selected === ADD_LANGUAGE_VALUE) {
      // Not a real selection: reset to the previous value and open the form.
      event.target.value = value;
      onAddLanguage();
      return;
    }
    onChange(selected);
  }

  return (
    <select
      id="search-language"
      value={value}
      onChange={handleChange}
      className="rounded-lg border bg-surface px-3 py-2.5 text-sm text-content outline-none focus:ring-2 sm:w-44"
    >
      <option value="">{t("search.languageAny")}</option>
      {shortlisted.length > 0 && (
        <optgroup label={t("languageSelector.shortlist")}>
          {shortlisted.map((l) => (
            <option key={l.tag} value={l.tag}>
              {endonym(l)}
            </option>
          ))}
        </optgroup>
      )}
      {rest.length > 0 && (
        <optgroup label={t("languageSelector.all")}>
          {rest.map((l) => (
            <option key={l.tag} value={l.tag}>
              {endonym(l)}
            </option>
          ))}
        </optgroup>
      )}
      <option value={ADD_LANGUAGE_VALUE}>{t("languageSelector.add")}</option>
    </select>
  );
}
