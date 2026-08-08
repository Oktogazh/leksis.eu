import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  LEKSIS_ENTRY_COLLECTION,
  LEKSIS_LANGUAGE_COLLECTION,
  LEKSIS_RELATION_COLLECTION,
} from "@leksis/types";
import { useSession } from "../auth/SessionProvider";
import { deleteRecords, type DeleteProgress, type RepoRecord } from "../lib/pds-repo";

/**
 * Confirms and performs a **real** deletion from the user's own PDS — the one
 * place in the app where a record stops existing rather than being superseded.
 *
 * Two shapes, one dialog, because the danger is the same and only its scale
 * differs: one record, or every record. The whole-repo case additionally asks
 * the user to type their handle, since there is nothing to undo it with.
 *
 * The consequences are spelled out per collection rather than in general. A
 * reader deleting an entry version and a reader deleting their language record
 * are doing very different things — the second withdraws a whole language's
 * names and grammar declaration from every reader — and a dialog that said
 * "this cannot be undone" to both would be technically true and useless.
 */
export interface DeleteRecordsDialogProps {
  /** The records to delete: one, or the whole withdrawable set. */
  records: RepoRecord[];
  /** Whole-repo mode: adds the typed confirmation and different copy. */
  all: boolean;
  /** The signed-in user's handle — what they must type to confirm `all`. */
  handle: string;
  onClose: () => void;
  /** Called with the URIs actually deleted (fewer than asked on partial failure). */
  onDeleted: (uris: string[]) => void;
}

export function DeleteRecordsDialog({
  records,
  all,
  handle,
  onClose,
  onDeleted,
}: DeleteRecordsDialogProps) {
  const { t } = useTranslation();
  const { agent, did } = useSession();
  const [typed, setTyped] = useState("");
  const [progress, setProgress] = useState<DeleteProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const running = progress !== null;
  // The handle is the phrase because it is on screen in the navbar: it proves
  // the reader knows which account they are emptying, not that they can copy.
  const confirmed = !all || typed.trim().toLowerCase() === handle.toLowerCase();

  /** Which lexicons are in play — each carries its own consequence. */
  const collections = new Set(records.map((r) => r.collection));

  async function onConfirm() {
    if (!agent || !did || !confirmed || running) return;
    setError(null);
    setProgress({ done: 0, total: records.length });
    try {
      const deleted = await deleteRecords(agent, did, records, setProgress);
      onDeleted(deleted);
    } catch (err) {
      console.error("deleting records failed:", err);
      setError(t("deleteRecords.errors.writeFailed"));
      setProgress(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-records-title"
    >
      <section className="max-h-[calc(100dvh-2rem)] w-full overflow-y-auto rounded-t-xl border bg-surface shadow-lg sm:max-w-lg sm:rounded-xl">
        <header className="border-b bg-surface-muted/60 px-4 py-3 sm:px-5">
          <h2 id="delete-records-title" className="text-base font-semibold text-content">
            {all
              ? t("deleteRecords.allTitle")
              : t("deleteRecords.oneTitle", { count: records.length })}
          </h2>
          <p className="mt-1 text-sm text-content-muted">
            {all ? t("deleteRecords.allIntro", { count: records.length }) : t("deleteRecords.oneIntro")}
          </p>
        </header>

        <div className="p-4 sm:p-5">
          {/* The distinction this dialog exists to make. */}
          <p className="text-sm text-content">{t("deleteRecords.notWithdrawal")}</p>

          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-content-muted">
            {collections.has(LEKSIS_ENTRY_COLLECTION) && (
              <li>{t("deleteRecords.consequenceEntry")}</li>
            )}
            {collections.has(LEKSIS_RELATION_COLLECTION) && (
              <li>{t("deleteRecords.consequenceRelation")}</li>
            )}
            {/* Deliberately last and worded hardest: a language record carries
                the names and the whole grammar declaration every reader sees. */}
            {collections.has(LEKSIS_LANGUAGE_COLLECTION) && (
              <li className="text-danger">{t("deleteRecords.consequenceLanguage")}</li>
            )}
          </ul>

          {all && (
            <p className="mt-3 text-sm text-content-muted">{t("deleteRecords.profileKept")}</p>
          )}

          {all && (
            <div className="mt-4">
              <label htmlFor="delete-records-confirm" className="block text-sm font-medium text-content">
                {t("deleteRecords.confirmLabel", { handle })}
              </label>
              <input
                id="delete-records-confirm"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                disabled={running}
                className="mt-1 w-full rounded-lg border bg-surface px-3 py-2 text-sm text-content outline-none placeholder:text-content-subtle focus:ring-2"
              />
            </div>
          )}

          {running && (
            <p className="mt-4 text-sm text-content-muted" role="status">
              {t("deleteRecords.progress", { done: progress.done, total: progress.total })}
            </p>
          )}

          <div className="mt-4 flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            {error !== null && <p className="text-sm text-danger">{error}</p>}
            <div className="ml-auto flex shrink-0 items-center justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={running}
                className="rounded-lg border px-4 py-2 text-sm text-content hover:bg-black/5 disabled:opacity-50"
              >
                {t("deleteRecords.cancel")}
              </button>
              <button
                type="button"
                onClick={() => void onConfirm()}
                disabled={!confirmed || running}
                className="rounded-lg bg-danger px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {running ? t("deleteRecords.deleting") : t("deleteRecords.submit")}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
