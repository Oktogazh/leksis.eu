import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  isValidLanguageTag,
  normalizeLanguageTag,
  LEKSIS_LANGUAGE_COLLECTION,
  type LanguageTranslation,
  type LanguageView,
  type LeksisLanguageRecord,
} from "@leksis/types";
import { useSession } from "../auth/SessionProvider";
import { endonym as displayName } from "./LanguageSelector";

interface AddLanguageModalProps {
  /** Languages already known to the AppView — duplicate guard + translation options. */
  languages: LanguageView[];
  onClose: () => void;
  /** Called after the record was written to the user's PDS. */
  onCreated: (language: LanguageView) => void;
}

interface TranslationRow {
  languageID: string;
  translation: string;
}

/**
 * Create a eu.leksis.language record on the user's own PDS (ADR-0002: the
 * browser writes, the AppView only re-indexes from the firehose). The tag
 * check against the fetched list is advisory — the AppView's last-write-wins
 * policy is the real arbiter.
 */
export function AddLanguageModal({ languages, onClose, onCreated }: AddLanguageModalProps) {
  const { t } = useTranslation();
  const { agent, did } = useSession();

  const [tag, setTag] = useState("");
  const [endonym, setEndonym] = useState("");
  const [rows, setRows] = useState<TranslationRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalized = normalizeLanguageTag(tag);
  const isDuplicate = normalized !== "" && languages.some((l) => l.tag === normalized);
  const isMalformed = normalized !== "" && !isValidLanguageTag(normalized);

  function setRow(index: number, patch: Partial<TranslationRow>) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!agent || !did) return;

    if (!isValidLanguageTag(normalized)) return setError(t("addLanguage.errors.invalidTag"));
    if (isDuplicate) return setError(t("addLanguage.errors.duplicateTag"));
    if (endonym.trim() === "") return setError(t("addLanguage.errors.endonymRequired"));

    const translations: LanguageTranslation[] = [
      { languageID: normalized, translation: endonym.trim() },
      ...rows
        .filter((r) => r.languageID !== "" && r.translation.trim() !== "")
        .map((r) => ({ languageID: r.languageID, translation: r.translation.trim() })),
    ];
    const record: LeksisLanguageRecord = {
      $type: LEKSIS_LANGUAGE_COLLECTION,
      tag: normalized,
      translations,
      createdAt: new Date().toISOString(),
    };

    setSubmitting(true);
    setError(null);
    try {
      // rkey = tag: rewriting the same language later is a natural update.
      await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: LEKSIS_LANGUAGE_COLLECTION,
        rkey: normalized,
        // putRecord wants an index signature our interface doesn't declare.
        record: { ...record },
      });
      onCreated({ tag: normalized, translations, createdAt: record.createdAt });
    } catch (err) {
      console.error("putRecord failed:", err);
      setError(t("addLanguage.errors.writeFailed"));
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-language-title"
    >
      {/* Bottom sheet on phones (full width, capped by dvh so the browser
          chrome never hides the buttons), centered card from sm: up. */}
      <form
        onSubmit={onSubmit}
        className="max-h-[calc(100dvh-2rem)] w-full overflow-y-auto rounded-t-xl border bg-surface p-4 shadow-lg sm:max-w-lg sm:rounded-xl sm:p-6"
      >
        <h2 id="add-language-title" className="text-lg font-semibold text-content">
          {t("addLanguage.title")}
        </h2>
        <p className="mt-1 text-sm text-content-subtle">{t("addLanguage.intro")}</p>

        <label htmlFor="add-language-tag" className="mt-4 block text-sm font-medium text-content">
          {t("addLanguage.tagLabel")}
        </label>
        <input
          id="add-language-tag"
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          placeholder={t("addLanguage.tagPlaceholder")}
          autoCapitalize="none"
          autoCorrect="off"
          className="mt-1 w-full rounded-lg border bg-surface px-3 py-2 font-mono text-sm text-content outline-none placeholder:text-content-subtle focus:ring-2"
        />
        <p className="mt-1 text-xs text-content-subtle">{t("addLanguage.tagHelp")}</p>
        {isMalformed && (
          <p className="mt-1 text-xs text-red-600">{t("addLanguage.errors.invalidTag")}</p>
        )}
        {isDuplicate && (
          <p className="mt-1 text-xs text-red-600">{t("addLanguage.errors.duplicateTag")}</p>
        )}

        <label
          htmlFor="add-language-endonym"
          className="mt-4 block text-sm font-medium text-content"
        >
          {t("addLanguage.endonymLabel")}
        </label>
        <input
          id="add-language-endonym"
          value={endonym}
          onChange={(e) => setEndonym(e.target.value)}
          placeholder={t("addLanguage.endonymPlaceholder")}
          className="mt-1 w-full rounded-lg border bg-surface px-3 py-2 text-sm text-content outline-none placeholder:text-content-subtle focus:ring-2"
        />

        {languages.length > 0 && (
          <fieldset className="mt-4">
            <legend className="text-sm font-medium text-content">
              {t("addLanguage.translationsLegend")}
            </legend>
            {rows.map((row, i) => (
              <div key={i} className="mt-2 flex items-center gap-2">
                <label className="sr-only" htmlFor={`add-language-row-lang-${i}`}>
                  {t("addLanguage.translationLanguageLabel")}
                </label>
                <select
                  id={`add-language-row-lang-${i}`}
                  value={row.languageID}
                  onChange={(e) => setRow(i, { languageID: e.target.value })}
                  className="w-28 min-w-0 shrink-0 rounded-lg border bg-surface px-2 py-2 text-sm text-content outline-none focus:ring-2 sm:w-36"
                >
                  <option value="" />
                  {languages.map((l) => (
                    <option key={l.tag} value={l.tag}>
                      {displayName(l)}
                    </option>
                  ))}
                </select>
                <label className="sr-only" htmlFor={`add-language-row-name-${i}`}>
                  {t("addLanguage.translationNameLabel")}
                </label>
                <input
                  id={`add-language-row-name-${i}`}
                  value={row.translation}
                  onChange={(e) => setRow(i, { translation: e.target.value })}
                  className="min-w-0 flex-1 rounded-lg border bg-surface px-3 py-2 text-sm text-content outline-none focus:ring-2"
                />
                <button
                  type="button"
                  onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                  aria-label={t("addLanguage.removeTranslation")}
                  title={t("addLanguage.removeTranslation")}
                  className="shrink-0 rounded-lg px-2 py-1 text-lg leading-none text-content-subtle hover:bg-surface-muted hover:text-content"
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setRows((prev) => [...prev, { languageID: "", translation: "" }])}
              className="mt-2 text-sm text-content-subtle hover:text-content"
            >
              {t("addLanguage.addTranslation")}
            </button>
          </fieldset>
        )}

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg border px-4 py-2 text-sm text-content hover:bg-black/5"
          >
            {t("addLanguage.cancel")}
          </button>
          <button
            type="submit"
            disabled={submitting || isMalformed || isDuplicate}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-fg hover:bg-primary-hover disabled:opacity-50"
          >
            {submitting ? t("addLanguage.submitting") : t("addLanguage.submit")}
          </button>
        </div>
      </form>
    </div>
  );
}
