import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { LanguageView } from "@leksis/types";
import { AddLanguageModal } from "./AddLanguageModal";
import { endonym } from "./LanguageSelector";

interface LanguageInterestPickerProps {
  /** All languages known to the AppView. */
  languages: LanguageView[];
  /** Currently-selected tags (the languages of interest), most relevant first. */
  selected: string[];
  onChange: (selected: string[]) => void;
  /** Called when a brand-new language record is created, so the parent can add it to its list. */
  onLanguageCreated: (created: LanguageView) => void;
  /** i18n key namespace so onboarding and the profile dialog can differ in copy. */
  copyPrefix: "onboarding" | "profile";
  /**
   * When set, each row also offers a link to that language's dashboard. The
   * profile dialog passes it (and closes itself) so the same list doubles as a
   * way in; onboarding omits it (no dashboard to leave to before the profile
   * even exists).
   */
  onOpenDashboard?: (tag: string) => void;
}

/**
 * Multi-select of languages of interest: a checkbox grid over the languages the
 * AppView knows, with an "add a language" affordance that registers a new
 * eu.leksis.language record. Selected languages sort first so ticking is
 * sticky. Shared by the onboarding step and the profile preferences dialog.
 */
export function LanguageInterestPicker({
  languages,
  selected,
  onChange,
  onLanguageCreated,
  copyPrefix,
  onOpenDashboard,
}: LanguageInterestPickerProps) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);

  // Selected first (in selection order), then the rest alphabetically by
  // display name — a stable, scannable order that doesn't jump as you tick.
  const ordered = useMemo(() => {
    const selectedSet = new Set(selected);
    const byTag = new Map(languages.map((l) => [l.tag, l]));
    const chosen = selected
      .map((tag) => byTag.get(tag))
      .filter((l): l is LanguageView => l !== undefined);
    const rest = languages
      .filter((l) => !selectedSet.has(l.tag))
      .sort((a, b) => endonym(a).localeCompare(endonym(b)));
    return [...chosen, ...rest];
  }, [languages, selected]);

  function toggle(tag: string) {
    onChange(
      selected.includes(tag) ? selected.filter((t) => t !== tag) : [...selected, tag],
    );
  }

  function handleCreated(created: LanguageView) {
    onLanguageCreated(created);
    if (!selected.includes(created.tag)) onChange([...selected, created.tag]);
    setAdding(false);
  }

  return (
    <div>
      {languages.length === 0 ? (
        <p className="text-sm text-content-subtle">{t(`${copyPrefix}.languagesEmpty`)}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {ordered.map((l) => {
            const checked = selected.includes(l.tag);
            return (
              <li key={l.tag}>
                <div
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                    checked
                      ? "border-primary bg-primary/5 text-content"
                      : "text-content hover:bg-surface-muted"
                  }`}
                >
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(l.tag)}
                      className="h-4 w-4 shrink-0 accent-primary"
                    />
                    <span className="min-w-0 flex-1 truncate">{endonym(l)}</span>
                    <span className="shrink-0 font-mono text-xs text-content-subtle">{l.tag}</span>
                  </label>
                  {onOpenDashboard && (
                    <button
                      type="button"
                      onClick={() => onOpenDashboard(l.tag)}
                      title={t("profile.openDashboard", { language: endonym(l) })}
                      aria-label={t("profile.openDashboard", { language: endonym(l) })}
                      className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-content-subtle hover:bg-surface-muted hover:text-content focus:outline-none focus:ring-2"
                    >
                      {t("profile.openDashboardShort")}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <button
        type="button"
        onClick={() => setAdding(true)}
        className="mt-2 text-sm text-content-subtle hover:text-content"
      >
        {t(`${copyPrefix}.addLanguage`)}
      </button>

      {adding && (
        <AddLanguageModal
          languages={languages}
          onClose={() => setAdding(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}
