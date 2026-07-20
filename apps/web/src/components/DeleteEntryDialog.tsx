import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { LEKSIS_ENTRY_COLLECTION, type EntryView, type LeksisEntryRecord } from "@leksis/types";
import { useSession } from "../auth/SessionProvider";
import { searchEntries } from "../lib/api";
import { EntryPreview } from "./EntryPreview";

const DUPLICATE_SEARCH_DEBOUNCE_MS = 300;

export interface DeleteEntryDialogProps {
  /** The entry version being withdrawn. */
  view: EntryView;
  /** Its current record content — carried forward onto the deletion version, since the lexicon still requires orthography/categories/definitions. */
  record: LeksisEntryRecord;
  onClose: () => void;
  /** Called with the new (deletion) record's AT URI after it was written to the PDS. */
  onDeleted: (recordURI: string) => void;
}

/**
 * Publishes a full-rewrite `eu.leksis.entry` version that withdraws the
 * entry: `deleted: true` plus a required `deletionReason`, and — when the
 * editor points at the correct entry — `redirectTo`. Like a modification
 * proposal, this is not a PDS-level delete: it is just another version
 * carrying `subject`, so any logged-in user may publish it (consistent with
 * the existing last-write-wins model). The AppView drops the version's
 * orthography from search but keeps the entry resolvable at its entryKey.
 */
export function DeleteEntryDialog({ view, record, onClose, onDeleted }: DeleteEntryDialogProps) {
  const { t } = useTranslation();
  const { agent, did } = useSession();

  const [reason, setReason] = useState("");
  const [isDuplicate, setIsDuplicate] = useState(false);
  const [duplicateQuery, setDuplicateQuery] = useState("");
  const [duplicateResults, setDuplicateResults] = useState<EntryView[]>([]);
  const [redirectTo, setRedirectTo] = useState<EntryView | null>(null);
  /** Which result (or the confirmed pick) has its inline preview expanded. */
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isDuplicate || duplicateQuery.trim() === "") {
      setDuplicateResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      searchEntries(duplicateQuery, view.languageID)
        .then((results) => {
          if (!cancelled) setDuplicateResults(results.filter((r) => r.key !== view.key));
        })
        .catch(() => {});
    }, DUPLICATE_SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isDuplicate, duplicateQuery, view.languageID, view.key]);

  const canSubmit =
    !submitting && reason.trim() !== "" && (!isDuplicate || redirectTo !== null);

  async function onSubmit() {
    if (!canSubmit || !agent || !did) return;

    const deletion: LeksisEntryRecord = {
      $type: LEKSIS_ENTRY_COLLECTION,
      languageID: record.languageID,
      orthography: record.orthography,
      categories: record.categories,
      definitions: record.definitions,
      subject: view.recordURI,
      deleted: true,
      deletionReason: reason.trim(),
      ...(redirectTo !== null ? { redirectTo: redirectTo.key } : {}),
      createdAt: new Date().toISOString(),
    };

    setSubmitting(true);
    setError(null);
    try {
      const res = await agent.com.atproto.repo.createRecord({
        repo: did,
        collection: LEKSIS_ENTRY_COLLECTION,
        record: { ...deletion },
      });
      onDeleted(res.data.uri);
    } catch (err) {
      console.error("createRecord (deletion) failed:", err);
      setError(t("deleteEntry.errors.writeFailed"));
      setSubmitting(false);
    }
  }

  const inputClass =
    "w-full rounded-lg border bg-surface px-3 py-2 text-sm text-content outline-none placeholder:text-content-subtle focus:ring-2";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-entry-title"
    >
      <section className="max-h-[calc(100dvh-2rem)] w-full overflow-y-auto rounded-t-xl border bg-surface shadow-lg sm:max-w-lg sm:rounded-xl">
        <header className="border-b bg-surface-muted/60 px-4 py-3 sm:px-5">
          <h2 id="delete-entry-title" className="text-base font-semibold text-content">
            {t("deleteEntry.title", { word: record.orthography[0] })}
          </h2>
          <p className="mt-1 text-sm text-content-muted">{t("deleteEntry.intro")}</p>
        </header>

        <div className="p-4 sm:p-5">
          <label htmlFor="delete-entry-duplicate" className="flex items-center gap-2">
            <input
              id="delete-entry-duplicate"
              type="checkbox"
              checked={isDuplicate}
              onChange={(e) => {
                setIsDuplicate(e.target.checked);
                if (!e.target.checked) setRedirectTo(null);
              }}
            />
            <span className="text-sm text-content">{t("deleteEntry.duplicateLabel")}</span>
          </label>

          {isDuplicate && (
            <div className="mt-3">
              <label htmlFor="delete-entry-duplicate-search" className="block text-sm font-medium text-content">
                {t("deleteEntry.correctEntryLabel")}
              </label>
              {redirectTo === null ? (
                <>
                  <input
                    id="delete-entry-duplicate-search"
                    value={duplicateQuery}
                    onChange={(e) => setDuplicateQuery(e.target.value)}
                    placeholder={t("deleteEntry.correctEntryPlaceholder")}
                    className={`${inputClass} mt-1`}
                  />
                  {duplicateResults.length > 0 && (
                    <ul className="mt-2 space-y-2">
                      {duplicateResults.map((r) => (
                        <li key={r.key}>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setRedirectTo(r)}
                              className="rounded-full border bg-surface-muted/60 px-2.5 py-1 text-xs text-content hover:border-primary hover:text-primary"
                            >
                              {r.orthography[0]}{" "}
                              <span className="font-mono text-content-subtle">{r.key}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedKey((prev) => (prev === r.key ? null : r.key))
                              }
                              className="text-xs text-primary hover:text-primary-hover"
                            >
                              {expandedKey === r.key
                                ? t("createEntry.hidePreview")
                                : t("createEntry.showPreview")}
                            </button>
                          </div>
                          {expandedKey === r.key && (
                            <div className="mt-2">
                              <EntryPreview entry={r} />
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <div className="mt-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border bg-surface-muted/60 px-2.5 py-1 text-xs text-content">
                      {redirectTo.orthography[0]}{" "}
                      <span className="font-mono text-content-subtle">{redirectTo.key}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedKey((prev) => (prev === redirectTo.key ? null : redirectTo.key))
                      }
                      className="text-xs text-primary hover:text-primary-hover"
                    >
                      {expandedKey === redirectTo.key
                        ? t("createEntry.hidePreview")
                        : t("createEntry.showPreview")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRedirectTo(null);
                        setExpandedKey(null);
                      }}
                      className="text-xs text-primary hover:text-primary-hover"
                    >
                      {t("deleteEntry.changeCorrectEntry")}
                    </button>
                  </div>
                  {expandedKey === redirectTo.key && (
                    <div className="mt-2">
                      <EntryPreview entry={redirectTo} />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="mt-4">
            <label htmlFor="delete-entry-reason" className="block text-sm font-medium text-content">
              {t("deleteEntry.reasonLabel")}
            </label>
            <p className="mt-1 text-xs text-content-subtle">{t("deleteEntry.reasonHelp")}</p>
            <textarea
              id="delete-entry-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder={t("deleteEntry.reasonPlaceholder")}
              className={`${inputClass} mt-1`}
            />
          </div>

          <p className="mt-4 text-xs text-content-subtle">{t("deleteEntry.legacyNote")}</p>

          <div className="mt-4 flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            {error !== null && <p className="text-sm text-red-600">{error}</p>}
            <div className="ml-auto flex shrink-0 items-center justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border px-4 py-2 text-sm text-content hover:bg-black/5"
              >
                {t("deleteEntry.cancel")}
              </button>
              <button
                type="button"
                onClick={onSubmit}
                disabled={!canSubmit}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {submitting ? t("deleteEntry.submitting") : t("deleteEntry.submit")}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
