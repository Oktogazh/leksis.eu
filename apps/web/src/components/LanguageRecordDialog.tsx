import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  LEKSIS_LANGUAGE_COLLECTION,
  type LanguageTranslation,
  type LanguageView,
  type LeksisLanguageRecord,
} from "@leksis/types";
import { useSession } from "../auth/SessionProvider";
import { fetchCurrentLanguageRecord } from "../lib/api";
import { fetchLanguageRecord } from "../lib/atproto-record";
import { endonym } from "./LanguageSelector";
import { LanguageSearchBar } from "./LanguageSearchBar";

/**
 * Mode A — "self": edit the dashboard language's own record. Editable rows are
 * the endonym plus translations into the user's languages of interest and
 * interface language; the search bar reveals or adds any other locale. The
 * whole record is rewritten on save, so untouched translations pass through.
 *
 * Mode B — "other": edit exactly one translation (languageID = the dashboard
 * tag) on another language's record. The user picks a target language with the
 * search bar; the dialog loads that target's record, edits only the single
 * name-in-this-language, and rewrites the target record.
 */
export type LanguageRecordMode =
  | { kind: "self"; record: LeksisLanguageRecord; editableIDs: string[] }
  | { kind: "other"; targetTag: string; dashboardTag: string };

interface LanguageRecordDialogProps {
  mode: LanguageRecordMode;
  /** All known languages — the search bar and row labels resolve names from it. */
  languages: LanguageView[];
  onClose: () => void;
  /**
   * The record was written to the user's PDS; the URI is not yet indexed.
   * The caller polls the AppView until it appears (reusing its sync spinner).
   */
  onPublished: (uri: string) => void;
}

interface EditRow {
  languageID: string;
  translation: string;
}

/** A language's display name from the known list, falling back to the tag. */
function displayName(languages: LanguageView[], tag: string): string {
  const found = languages.find((l) => l.tag === tag);
  return found ? endonym(found) : tag;
}

/**
 * Edit a eu.leksis.language record's translations and republish it (a full
 * rewrite, rkey = tag) to the editor's own PDS — untouched translations are
 * preserved. Used both to edit this language's own names (mode "self") and to
 * name a language in this language, one at a time (mode "other").
 */
export function LanguageRecordDialog({
  mode,
  languages,
  onClose,
  onPublished,
}: LanguageRecordDialogProps) {
  const { t } = useTranslation();
  const { agent, did } = useSession();

  // The record being rewritten and the tag it belongs to. For "self" it's
  // handed in; for "other" it's the target's record, loaded on mount.
  const recordTag = mode.kind === "self" ? mode.record.tag : mode.targetTag;
  const [record, setRecord] = useState<LeksisLanguageRecord | null>(
    mode.kind === "self" ? mode.record : null,
  );
  const [loading, setLoading] = useState(mode.kind === "other");
  const [rows, setRows] = useState<EditRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mode "other": resolve the target's current record URI, then its content.
  useEffect(() => {
    if (mode.kind !== "other") return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const ref = await fetchCurrentLanguageRecord(mode.targetTag);
        const loaded = ref === null ? null : await fetchLanguageRecord(ref.recordURI);
        if (!cancelled) {
          setRecord(loaded);
          setLoading(false);
        }
      } catch (err) {
        console.error("could not load target language record:", err);
        if (!cancelled) {
          setRecord(null);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode.kind, mode.kind === "other" ? mode.targetTag : null]);

  // Seed the editable rows once the record is available.
  useEffect(() => {
    if (record === null) return;
    if (mode.kind === "self") {
      const editable = new Set(mode.editableIDs);
      setRows(
        record.translations
          .filter((tr) => editable.has(tr.languageID))
          .map((tr) => ({ languageID: tr.languageID, translation: tr.translation })),
      );
    } else {
      // One row: this language's name on the target record (prefilled if any).
      const existing = record.translations.find((tr) => tr.languageID === mode.dashboardTag);
      setRows([{ languageID: mode.dashboardTag, translation: existing?.translation ?? "" }]);
    }
    // Re-seed whenever the loaded record changes; `mode` is stable per open.
  }, [record]);

  // Tags already shown as rows — hidden from the reveal search bar.
  const shownIDs = useMemo(() => new Set(rows.map((r) => r.languageID)), [rows]);

  function setRow(index: number, patch: Partial<EditRow>) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function revealLanguage(tag: string) {
    if (shownIDs.has(tag)) return;
    const existing = record?.translations.find((tr) => tr.languageID === tag);
    setRows((prev) => [...prev, { languageID: tag, translation: existing?.translation ?? "" }]);
  }

  const title =
    mode.kind === "self"
      ? t("languageRecord.editTitle")
      : t("languageRecord.codesTitle", { language: displayName(languages, mode.dashboardTag) });
  const intro =
    mode.kind === "self"
      ? t("languageRecord.editIntro")
      : t("languageRecord.codesIntro", { language: displayName(languages, mode.dashboardTag) });

  const canSubmit = !submitting && !loading && record !== null && !!agent && !!did;

  // Full rewrite: start from the record's translations, apply the edited rows
  // by languageID (upsert non-blank, keep everything untouched), republish
  // under rkey = the record's tag on the editor's own PDS.
  async function onSave() {
    if (!canSubmit || record === null || !agent || !did) return;

    const edits = new Map(
      rows
        .filter((r) => r.translation.trim() !== "")
        .map((r) => [r.languageID, r.translation.trim()] as const),
    );
    // Rows a user blanked out are dropped from their language's translation.
    const blanked = new Set(
      rows.filter((r) => r.translation.trim() === "").map((r) => r.languageID),
    );

    const merged: LanguageTranslation[] = record.translations
      .filter((tr) => !edits.has(tr.languageID) && !blanked.has(tr.languageID))
      .concat(
        [...edits].map(([languageID, translation]) => ({ languageID, translation })),
      );

    setSubmitting(true);
    setError(null);
    try {
      const updated: LeksisLanguageRecord = {
        $type: LEKSIS_LANGUAGE_COLLECTION,
        tag: recordTag,
        translations: merged,
        createdAt: new Date().toISOString(),
      };
      const res = await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: LEKSIS_LANGUAGE_COLLECTION,
        rkey: recordTag,
        // putRecord wants an index signature our interface doesn't declare.
        record: { ...updated },
      });
      onPublished(res.data.uri);
    } catch (err) {
      console.error("putRecord failed:", err);
      setError(t("languageRecord.error"));
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="language-record-title"
    >
      <div className="max-h-[calc(100dvh-2rem)] w-full overflow-y-auto rounded-t-xl border bg-surface p-4 shadow-lg sm:max-w-lg sm:rounded-xl sm:p-6">
        <h2 id="language-record-title" className="text-lg font-semibold text-content">
          {title}
        </h2>
        <p className="mt-1 text-sm text-content-subtle">{intro}</p>

        {loading ? (
          <p className="mt-4 text-sm text-content-muted">{t("languageRecord.loading")}</p>
        ) : record === null ? (
          <p className="mt-4 text-sm text-content-muted">
            {t("languageRecord.recordUnavailable")}
          </p>
        ) : (
          <>
            <div className="mt-4 space-y-2">
              {rows.map((row, i) => {
                const isEndonym = row.languageID === recordTag;
                const label = isEndonym
                  ? t("languageRecord.endonymRow")
                  : displayName(languages, row.languageID);
                return (
                  <div key={row.languageID} className="flex items-center gap-2">
                    <span className="flex w-28 shrink-0 items-baseline gap-1 sm:w-40">
                      <span className="min-w-0 truncate text-sm text-content">{label}</span>
                      <span className="shrink-0 font-mono text-xs text-content-subtle">
                        {row.languageID}
                      </span>
                    </span>
                    <label className="sr-only" htmlFor={`language-record-name-${i}`}>
                      {t("languageRecord.nameLabel")}
                    </label>
                    <input
                      id={`language-record-name-${i}`}
                      value={row.translation}
                      onChange={(e) => setRow(i, { translation: e.target.value })}
                      placeholder={t("languageRecord.namePlaceholder")}
                      className="min-w-0 flex-1 rounded-lg border bg-surface px-3 py-2 text-sm text-content outline-none placeholder:text-content-subtle focus:ring-2"
                    />
                  </div>
                );
              })}
            </div>

            {/* Mode "self" reveals more of the record's locales or adds new ones.
                Mode "other" edits a single translation, so no reveal bar. */}
            {mode.kind === "self" && (
              <div className="mt-4">
                <p className="text-sm font-medium text-content">
                  {t("languageRecord.revealLabel")}
                </p>
                <div className="mt-2">
                  <LanguageSearchBar
                    languages={languages}
                    onSelect={revealLanguage}
                    exclude={[...shownIDs]}
                  />
                </div>
              </div>
            )}

            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="rounded-lg border px-4 py-2 text-sm text-content hover:bg-black/5"
              >
                {t("languageRecord.cancel")}
              </button>
              <button
                type="button"
                onClick={() => void onSave()}
                disabled={!canSubmit}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-fg hover:bg-primary-hover disabled:opacity-50"
              >
                {submitting ? t("languageRecord.saving") : t("languageRecord.save")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
