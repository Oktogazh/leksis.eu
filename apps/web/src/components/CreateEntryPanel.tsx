import { useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import type { LanguageView } from "@leksis/types";
import { endonym } from "./LanguageSelector";

interface CreateEntryPanelProps {
  /** The word that was searched — prefills the first spelling. */
  word: string;
  /** All known languages, for the in-panel picker when none was preselected. */
  languages: LanguageView[];
  /** The language scope the search was submitted with, if any. */
  language: LanguageView | null;
}

interface DefinitionRow {
  tag: string;
  text: string;
}

/**
 * The "add this word" offer on the search-results page: a preview of the
 * eu.leksis.entry record for the searched word — orthography[], grammaticality
 * {categories, notes} and definitions[{tag, text}], the slice of the lexicon
 * the entries loop (week 4) ships. The submit stays disabled until that loop
 * lands the record write + AppView ingestion; the fields are already the real
 * contract. Always offered, even for an all-languages search — a language
 * picker inside the panel stands in for the preselection in that case. Mount
 * with a key of word+tag so state resets per search.
 */
export function CreateEntryPanel({ word, languages, language }: CreateEntryPanelProps) {
  const { t } = useTranslation();

  const [pickedTag, setPickedTag] = useState(language?.tag ?? "");
  const [spellings, setSpellings] = useState<string[]>([word]);
  const [categories, setCategories] = useState("");
  const [notes, setNotes] = useState("");
  const [definitions, setDefinitions] = useState<DefinitionRow[]>([{ tag: "", text: "" }]);

  const target = language ?? languages.find((l) => l.tag === pickedTag) ?? null;

  function onPickLanguage(event: ChangeEvent<HTMLSelectElement>) {
    setPickedTag(event.target.value);
  }

  function setSpelling(index: number, value: string) {
    setSpellings((prev) => prev.map((s, i) => (i === index ? value : s)));
  }

  function setDefinition(index: number, patch: Partial<DefinitionRow>) {
    setDefinitions((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  const inputClass =
    "w-full rounded-lg border bg-surface px-3 py-2 text-sm text-content outline-none placeholder:text-content-subtle focus:ring-2";

  return (
    <section className="mt-4 rounded-lg border bg-surface shadow-sm">
      <header className="border-b bg-surface-muted/60 px-4 py-3 sm:px-5">
        <h3 className="text-base font-semibold text-content">
          {target !== null ? (
            <>
              {t("createEntry.title", { word, language: endonym(target) })}{" "}
              <span className="rounded border bg-surface px-1.5 py-0.5 align-middle font-mono text-xs font-normal text-content-muted">
                {target.tag}
              </span>
            </>
          ) : (
            t("createEntry.titleNoLanguage", { word })
          )}
        </h3>
        <p className="mt-1 text-sm text-content-muted">{t("createEntry.intro")}</p>

        {language === null && (
          <div className="mt-3">
            <label
              htmlFor="entry-language-pick"
              className="block text-sm font-medium text-content"
            >
              {t("createEntry.languagePickLabel")}
            </label>
            <select
              id="entry-language-pick"
              value={pickedTag}
              onChange={onPickLanguage}
              className="mt-1 w-full rounded-lg border bg-surface px-3 py-2 text-sm text-content outline-none focus:ring-2 sm:w-64"
            >
              <option value="">{t("createEntry.languagePickPlaceholder")}</option>
              {languages.map((l) => (
                <option key={l.tag} value={l.tag}>
                  {endonym(l)}
                </option>
              ))}
            </select>
          </div>
        )}
      </header>

      <div className="p-4 sm:p-5">
        <fieldset>
          <legend className="text-sm font-medium text-content">
            {t("createEntry.orthographyLegend")}
          </legend>
          <p className="mt-1 text-xs text-content-subtle">{t("createEntry.orthographyHelp")}</p>
          {spellings.map((spelling, i) => (
            <div key={i} className="mt-2 flex items-center gap-2">
              <label className="sr-only" htmlFor={`entry-spelling-${i}`}>
                {t("createEntry.spellingLabel")}
              </label>
              <input
                id={`entry-spelling-${i}`}
                value={spelling}
                onChange={(e) => setSpelling(i, e.target.value)}
                className={inputClass}
              />
              {i > 0 && (
                <button
                  type="button"
                  onClick={() => setSpellings((prev) => prev.filter((_, j) => j !== i))}
                  aria-label={t("createEntry.removeSpelling")}
                  title={t("createEntry.removeSpelling")}
                  className="shrink-0 rounded-lg px-2 py-1 text-lg leading-none text-content-subtle hover:bg-surface-muted hover:text-content"
                >
                  ×
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => setSpellings((prev) => [...prev, ""])}
            className="mt-2 text-sm text-primary hover:text-primary-hover"
          >
            {t("createEntry.addSpelling")}
          </button>
        </fieldset>

        <label htmlFor="entry-categories" className="mt-5 block text-sm font-medium text-content">
          {t("createEntry.categoriesLabel")}
        </label>
        <input
          id="entry-categories"
          value={categories}
          onChange={(e) => setCategories(e.target.value)}
          placeholder={t("createEntry.categoriesPlaceholder")}
          className={`mt-1 ${inputClass}`}
        />
        <p className="mt-1 text-xs text-content-subtle">{t("createEntry.categoriesHelp")}</p>

        <label htmlFor="entry-notes" className="mt-4 block text-sm font-medium text-content">
          {t("createEntry.notesLabel")}
        </label>
        <textarea
          id="entry-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t("createEntry.notesPlaceholder")}
          rows={2}
          className={`mt-1 ${inputClass}`}
        />

        <fieldset className="mt-5">
          <legend className="text-sm font-medium text-content">
            {t("createEntry.definitionsLegend")}
          </legend>
          {definitions.map((row, i) => (
            <div key={i} className="mt-2 flex items-start gap-2">
              <label className="sr-only" htmlFor={`entry-definition-tag-${i}`}>
                {t("createEntry.definitionTagLabel")}
              </label>
              <input
                id={`entry-definition-tag-${i}`}
                value={row.tag}
                onChange={(e) => setDefinition(i, { tag: e.target.value })}
                placeholder={t("createEntry.definitionTagPlaceholder")}
                className="w-28 min-w-0 shrink-0 rounded-lg border bg-surface px-2 py-2 text-sm text-content outline-none placeholder:text-content-subtle focus:ring-2 sm:w-36"
              />
              <label className="sr-only" htmlFor={`entry-definition-text-${i}`}>
                {t("createEntry.definitionTextLabel")}
              </label>
              <textarea
                id={`entry-definition-text-${i}`}
                value={row.text}
                onChange={(e) => setDefinition(i, { text: e.target.value })}
                placeholder={t("createEntry.definitionTextPlaceholder")}
                rows={2}
                className="min-w-0 flex-1 rounded-lg border bg-surface px-3 py-2 text-sm text-content outline-none placeholder:text-content-subtle focus:ring-2"
              />
              {definitions.length > 1 && (
                <button
                  type="button"
                  onClick={() => setDefinitions((prev) => prev.filter((_, j) => j !== i))}
                  aria-label={t("createEntry.removeDefinition")}
                  title={t("createEntry.removeDefinition")}
                  className="shrink-0 rounded-lg px-2 py-1 text-lg leading-none text-content-subtle hover:bg-surface-muted hover:text-content"
                >
                  ×
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => setDefinitions((prev) => [...prev, { tag: "", text: "" }])}
            className="mt-2 text-sm text-primary hover:text-primary-hover"
          >
            {t("createEntry.addDefinition")}
          </button>
        </fieldset>

        <p className="mt-4 text-xs text-content-subtle">{t("createEntry.laterFields")}</p>

        <div className="mt-4 flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-content-muted">{t("createEntry.comingSoon")}</p>
          <button
            type="button"
            disabled
            className="shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-fg disabled:opacity-50"
          >
            {t("createEntry.submit")}
          </button>
        </div>
      </div>
    </section>
  );
}
