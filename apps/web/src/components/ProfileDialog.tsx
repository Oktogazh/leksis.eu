import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  LEKSIS_PROFILE_COLLECTION,
  type LanguageView,
  type LeksisProfileRecord,
} from "@leksis/types";
import { useSession } from "../auth/SessionProvider";
import { SUPPORTED_LANGUAGES, resolveLanguageCode, type LanguageCode } from "../i18n";
import { languagePath, navigateTo } from "../lib/routes";
import { LanguageInterestPicker } from "./LanguageInterestPicker";

interface ProfileDialogProps {
  languages: LanguageView[];
  onClose: () => void;
  /** Bubbled up so an open list gains a newly-registered language. */
  onLanguageCreated: (created: LanguageView) => void;
}

/**
 * Profile preferences, opened from the navbar handle. Edits the same two
 * settings as onboarding — interface language and languages of interest — and
 * writes a new version of the eu.leksis.profile record to the user's PDS.
 * `createdAt` is refreshed on each save (the record is always a full rewrite).
 */
export function ProfileDialog({ languages, onClose, onLanguageCreated }: ProfileDialogProps) {
  const { t } = useTranslation();
  const { profile, saveProfile } = useSession();

  const [interfaceLanguage, setInterfaceLanguage] = useState<LanguageCode>(() =>
    resolveLanguageCode(profile?.interfaceLanguage ?? ""),
  );
  const [selected, setSelected] = useState<string[]>(() => profile?.languages ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSave() {
    const record: LeksisProfileRecord = {
      $type: LEKSIS_PROFILE_COLLECTION,
      interfaceLanguage,
      languages: selected,
      createdAt: new Date().toISOString(),
    };
    setSaving(true);
    setError(null);
    try {
      await saveProfile(record);
      onClose();
    } catch (err) {
      console.error("could not save profile:", err);
      setError(t("profile.error"));
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-title"
    >
      <div className="max-h-[calc(100dvh-2rem)] w-full overflow-y-auto rounded-t-xl border bg-surface p-4 shadow-lg sm:max-w-lg sm:rounded-xl sm:p-6">
        <h2 id="profile-title" className="text-lg font-semibold text-content">
          {t("profile.title")}
        </h2>
        <p className="mt-1 text-sm text-content-subtle">{t("profile.intro")}</p>

        <fieldset className="mt-4">
          <legend className="text-sm font-medium text-content">{t("profile.interfaceLabel")}</legend>
          <ul className="mt-2 flex flex-col gap-1.5">
            {SUPPORTED_LANGUAGES.map((l) => {
              const checked = interfaceLanguage === l.code;
              return (
                <li key={l.code}>
                  <label
                    className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm ${
                      checked
                        ? "border-primary bg-primary/5 text-content"
                        : "text-content hover:bg-surface-muted"
                    }`}
                  >
                    <input
                      type="radio"
                      name="profile-interface-language"
                      checked={checked}
                      onChange={() => setInterfaceLanguage(l.code)}
                      className="h-4 w-4 shrink-0 accent-primary"
                    />
                    <span>{t(l.labelKey)}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>

        <div className="mt-5">
          <p className="text-sm font-medium text-content">{t("profile.languagesLabel")}</p>
          <p className="mt-1 text-sm text-content-subtle">{t("profile.languagesHint")}</p>
          <div className="mt-2">
            <LanguageInterestPicker
              languages={languages}
              selected={selected}
              onChange={setSelected}
              onLanguageCreated={onLanguageCreated}
              copyPrefix="profile"
              onOpenDashboard={(tag) => {
                // Leave the dialog for the dashboard; unsaved preference edits
                // are dropped, matching Cancel — the primary action here is
                // reaching the language, not saving.
                onClose();
                navigateTo(languagePath(tag));
              }}
            />
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border px-4 py-2 text-sm text-content hover:bg-surface-muted disabled:opacity-50"
          >
            {t("profile.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void onSave()}
            disabled={saving}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-fg hover:bg-primary-hover disabled:opacity-50"
          >
            {saving ? t("profile.saving") : t("profile.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
