import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  LEKSIS_PROFILE_COLLECTION,
  type LanguageView,
  type LeksisProfileRecord,
} from "@leksis/types";
import { useSession } from "../auth/SessionProvider";
import { SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE, type LanguageCode } from "../i18n";
import { LanguageInterestPicker } from "./LanguageInterestPicker";

interface OnboardingFlowProps {
  languages: LanguageView[];
  /** Bubbled up so HomePage's language list gains a newly-registered language. */
  onLanguageCreated: (created: LanguageView) => void;
}

/** The interface language the browser prefers, if Leksis supports it. */
function preferredInterfaceLanguage(): LanguageCode {
  const supported = new Set<string>(SUPPORTED_LANGUAGES.map((l) => l.code));
  for (const tag of navigator.languages ?? []) {
    const primary = tag.toLowerCase().split("-")[0] ?? "";
    if (supported.has(primary)) return primary as LanguageCode;
  }
  return DEFAULT_LANGUAGE;
}

/**
 * First-run onboarding, shown inside HomePage when a connected user has no
 * eu.leksis.profile record yet. Two steps — interface language, then languages
 * of interest — then writes the profile to the user's PDS via saveProfile.
 */
export function OnboardingFlow({ languages, onLanguageCreated }: OnboardingFlowProps) {
  const { t } = useTranslation();
  const { saveProfile } = useSession();

  const [step, setStep] = useState<1 | 2>(1);
  const [interfaceLanguage, setInterfaceLanguage] = useState<LanguageCode>(
    preferredInterfaceLanguage,
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finish = useMemo(
    () => async () => {
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
        // On success the profile is set in context; HomePage swaps onboarding
        // out for the search surface. No local navigation needed.
      } catch (err) {
        console.error("could not save profile:", err);
        setError(t("onboarding.error"));
        setSaving(false);
      }
    },
    [interfaceLanguage, selected, saveProfile, t],
  );

  return (
    <section className="mt-6 rounded-2xl border bg-surface p-5 shadow-sm sm:p-6">
      <p className="text-xs font-medium uppercase tracking-wide text-content-subtle">
        {t("onboarding.step", { current: step, total: 2 })}
      </p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-content">
        {t("onboarding.title")}
      </h1>
      <p className="mt-1 text-sm text-content-muted">{t("onboarding.intro")}</p>

      {step === 1 ? (
        <div className="mt-5">
          <h2 className="text-base font-medium text-content">{t("onboarding.interfaceTitle")}</h2>
          <p className="mt-1 text-sm text-content-subtle">{t("onboarding.interfaceHint")}</p>
          <ul className="mt-3 flex flex-col gap-1.5">
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
                      name="onboarding-interface-language"
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
        </div>
      ) : (
        <div className="mt-5">
          <h2 className="text-base font-medium text-content">{t("onboarding.languagesTitle")}</h2>
          <p className="mt-1 text-sm text-content-subtle">{t("onboarding.languagesHint")}</p>
          <p className="mt-2 mb-2 text-xs text-content-subtle">
            {t("onboarding.selectedCount", { count: selected.length })}
          </p>
          <LanguageInterestPicker
            languages={languages}
            selected={selected}
            onChange={setSelected}
            onLanguageCreated={onLanguageCreated}
            copyPrefix="onboarding"
          />
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-6 flex justify-end gap-3">
        {step === 2 && (
          <button
            type="button"
            onClick={() => setStep(1)}
            disabled={saving}
            className="rounded-lg border px-4 py-2 text-sm text-content hover:bg-surface-muted disabled:opacity-50"
          >
            {t("onboarding.back")}
          </button>
        )}
        {step === 1 ? (
          <button
            type="button"
            onClick={() => setStep(2)}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-fg hover:bg-primary-hover"
          >
            {t("onboarding.next")}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void finish()}
            disabled={saving}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-fg hover:bg-primary-hover disabled:opacity-50"
          >
            {saving ? t("onboarding.saving") : t("onboarding.finish")}
          </button>
        )}
      </div>
    </section>
  );
}
