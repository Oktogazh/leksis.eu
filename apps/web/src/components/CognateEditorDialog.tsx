import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  LEKSIS_COGNATE_COLLECTION,
  validateCognate,
  type CognateView,
  type EntryView,
  type LanguageView,
  type LeksisCognateRecord,
} from "@leksis/types";
import { useSession } from "../auth/SessionProvider";
import { fetchEntry, searchEntries } from "../lib/api";
import { fetchCognateRecord, parseAtUri } from "../lib/atproto-record";
import { LanguageSearchBar } from "./LanguageSearchBar";
import { endonym } from "./LanguageSelector";

// The writer's half of the cognate network: publishing an eu.leksis.cognate
// record from the editor's own PDS.
//
// Deliberately the relation editor with two thirds removed. No kind — cognacy
// asserts one thing — and no sense pickers, because a cognate addresses the
// word and every sense of it shares the word's history. What is left is: pick a
// language, pick a word, say why if you want to. That shortness is the point of
// the whole design: the simple, unambiguous half of etymological knowledge is
// the half worth asking people to formalize.
//
// It still pins the entries' CURRENT versions, as the relation editor does, so
// re-affirming a parked cognate is this same flow rather than a repair mode.
// Unlike a relation, though, a cognate does not park merely because an entry was
// restructured — only because one was withdrawn or is unknown here.

const WORD_SEARCH_DEBOUNCE_MS = 300;

/** How the dialog was opened — what is already known, and what is being modified. */
export interface CognateEditorLaunch {
  /**
   * The entry the editor was launched from. Only its indexed view is needed:
   * with no sense to address, the record's content never comes into it — which
   * is why this is an EntryView where the relation editor needs the record too.
   */
  source: EntryView;
  /** A target already known — the other side of a cognate being modified. */
  targetEntryKey?: string | null;
  /** Pre-selected target language when no target entry is known yet. */
  targetLanguage?: string;
  /** Spelling to seed the word search with (a side that could not be resolved). */
  targetQuery?: string;
  /**
   * The cognate version being modified. Its record URI becomes `subject`, so the
   * publication is a new version of that cognate rather than a second,
   * competing assertion of the same pair.
   */
  existing?: CognateView | null;
}

export interface CognateEditorDialogProps extends CognateEditorLaunch {
  languages: LanguageView[];
  onClose: () => void;
  /** Called with the new cognate record's AT URI once written to the PDS. */
  onPublished: (recordURI: string) => void;
  /** Called after the writer's own cognate record was removed from their PDS. */
  onDeleted?: () => void;
}

export function CognateEditorDialog({
  source,
  targetEntryKey = null,
  targetLanguage,
  targetQuery,
  existing = null,
  languages,
  onClose,
  onPublished,
  onDeleted,
}: CognateEditorDialogProps) {
  const { t } = useTranslation();
  const { agent, did } = useSession();

  /** The target language, empty until picked. Set by the launch or by the picker. */
  const [language, setLanguage] = useState<string>(targetLanguage ?? "");
  const [query, setQuery] = useState<string>(targetQuery ?? "");
  const [results, setResults] = useState<EntryView[]>([]);
  const [target, setTarget] = useState<EntryView | null>(null);

  const sourceWord = source.orthography[0] ?? source.key;

  const [notes, setNotes] = useState("");
  /**
   * Whether the cognate being modified has had its record's notes resolved.
   * Submitting before this settles would publish a version with the sources and
   * caveats silently dropped, so it gates the button rather than filling a field.
   */
  const [notesReady, setNotesReady] = useState(existing === null);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (existing === null) return;
    let cancelled = false;
    fetchCognateRecord(existing.recordURI)
      .then((record) => {
        if (cancelled) return;
        if (record === null) {
          // Refusing to edit is the safe failure: publishing now would replace
          // notes nobody could read.
          setError(t("cognateEditor.errors.notesUnreadable"));
          return;
        }
        setNotes((record.notes ?? []).join("\n"));
        setNotesReady(true);
      })
      .catch(() => {
        if (!cancelled) setError(t("cognateEditor.errors.notesUnreadable"));
      });
    return () => {
      cancelled = true;
    };
  }, [existing]);

  // A known target (the other side of a cognate being modified) is resolved to
  // its CURRENT version: that is what re-affirmation re-pins to.
  useEffect(() => {
    if (targetEntryKey === null) return;
    let cancelled = false;
    fetchEntry(targetEntryKey)
      .then((view) => {
        if (!cancelled && view !== null) setTarget(view);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [targetEntryKey]);

  useEffect(() => {
    if (target !== null || language === "" || query.trim() === "") {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      searchEntries(query, language)
        .then((found) => {
          // The source entry is excluded here, unlike in the relation editor: a
          // relation between two senses of one word is meaningful (a synonym),
          // but a word shares an origin with itself trivially, so the pair would
          // be indexed and immediately parked.
          if (!cancelled) setResults(found.filter((r) => r.key !== source.key));
        })
        .catch(() => {});
    }, WORD_SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [target, language, query, source.key]);

  const targetLanguageName = useMemo(() => {
    const known = languages.find((l) => l.tag === language);
    return known !== undefined ? endonym(known) : language;
  }, [languages, language]);

  /** Only the author of a cognate may withdraw it from their own PDS. */
  const canDelete =
    existing !== null && did !== null && existing.authorDID === did && !submitting && !deleting;
  const canSubmit =
    !submitting && !deleting && target !== null && agent !== null && did !== null && notesReady;

  async function onSubmit() {
    if (!canSubmit || !agent || !did || target === null) return;

    const noteList = notes
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");

    const record: LeksisCognateRecord = {
      $type: LEKSIS_COGNATE_COLLECTION,
      sides: [
        {
          entry: source.recordURI,
          languageID: source.languageID,
          orthography: sourceWord,
        },
        {
          entry: target.recordURI,
          languageID: target.languageID,
          orthography: target.orthography[0] ?? target.key,
        },
      ],
      ...(noteList.length > 0 ? { notes: noteList } : {}),
      ...(existing !== null ? { subject: existing.recordURI } : {}),
      createdAt: new Date().toISOString(),
    };

    // The same whole-record check the AppView runs at ingest, so a record that
    // would be skipped as invalid is refused here instead of being published.
    const problem = validateCognate(record);
    if (problem !== "ok") {
      setError(t(`cognateEditor.errors.${problem}`));
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await agent.com.atproto.repo.createRecord({
        repo: did,
        collection: LEKSIS_COGNATE_COLLECTION,
        record: { ...record },
      });
      onPublished(res.data.uri);
    } catch (err) {
      console.error("createRecord (cognate) failed:", err);
      setError(t("cognateEditor.errors.writeFailed"));
      setSubmitting(false);
    }
  }

  /**
   * Withdrawing a cognate is a real PDS delete, as for a relation: the
   * assertion has no content to preserve and no readers to redirect, and the
   * index mirrors the network — the version disappears with its record.
   */
  async function onDelete() {
    if (!canDelete || !agent || !did || existing === null) return;
    const parsed = parseAtUri(existing.recordURI);
    if (parsed === null) return;

    setDeleting(true);
    setError(null);
    try {
      await agent.com.atproto.repo.deleteRecord({
        repo: did,
        collection: parsed.collection,
        rkey: parsed.rkey,
      });
      onDeleted?.();
    } catch (err) {
      console.error("deleteRecord (cognate) failed:", err);
      setError(t("cognateEditor.errors.deleteFailed"));
      setDeleting(false);
    }
  }

  const inputClass =
    "w-full rounded-lg border bg-surface px-3 py-2 text-sm text-content outline-none placeholder:text-content-subtle focus:ring-2";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cognate-editor-title"
    >
      <section className="max-h-[calc(100dvh-2rem)] w-full overflow-y-auto rounded-t-xl border bg-surface shadow-lg sm:max-w-lg sm:rounded-xl">
        <header className="border-b bg-surface-muted/60 px-4 py-3 sm:px-5">
          <h2 id="cognate-editor-title" className="text-base font-semibold text-content">
            {existing !== null
              ? t("cognateEditor.editTitle", { word: sourceWord })
              : t("cognateEditor.title", { word: sourceWord })}
          </h2>
          <p className="mt-1 text-sm text-content-muted">
            {existing !== null && existing.state !== "live"
              ? t("cognateEditor.reaffirmIntro")
              : t("cognateEditor.intro")}
          </p>
        </header>

        <div className="space-y-5 p-4 sm:p-5">
          {/* The other side: language, then the word. No sense picker and no
              kind — the two things a relation needs and a cognate does not. */}
          <section>
            <h3 className="text-sm font-medium text-content">{t("cognateEditor.targetLabel")}</h3>

            {language === "" ? (
              <div className="mt-2">
                <p className="mb-1 text-xs text-content-subtle">
                  {t("cognateEditor.targetLanguageHelp")}
                </p>
                <LanguageSearchBar languages={languages} onSelect={setLanguage} />
              </div>
            ) : (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="rounded-full border bg-surface-muted/60 px-2.5 py-1 text-xs text-content">
                  {targetLanguageName}{" "}
                  <span className="font-mono text-content-subtle">{language}</span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setLanguage("");
                    setTarget(null);
                    setQuery("");
                  }}
                  className="text-xs text-primary hover:text-primary-hover"
                >
                  {t("cognateEditor.changeLanguage")}
                </button>
              </div>
            )}

            {language !== "" && target === null && (
              <div className="mt-3">
                <label
                  htmlFor="cognate-target-search"
                  className="block text-sm font-medium text-content"
                >
                  {t("cognateEditor.wordLabel")}
                </label>
                <input
                  id="cognate-target-search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("cognateEditor.wordPlaceholder")}
                  autoCapitalize="none"
                  autoCorrect="off"
                  className={`${inputClass} mt-1`}
                />
                {results.length > 0 && (
                  <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                    {results.map((r) => (
                      <li key={r.key}>
                        <button
                          type="button"
                          onClick={() => setTarget(r)}
                          className="w-full rounded-lg border px-3 py-2 text-left text-sm text-content hover:border-primary hover:bg-surface-muted"
                        >
                          {r.orthography[0]}{" "}
                          <span className="font-mono text-xs text-content-subtle">{r.key}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {query.trim() !== "" && results.length === 0 && (
                  <p className="mt-2 text-xs text-content-subtle">
                    {t("cognateEditor.noWordFound")}
                  </p>
                )}
              </div>
            )}

            {target !== null && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="rounded-full border bg-surface-muted/60 px-2.5 py-1 text-xs text-content">
                  {target.orthography[0]}{" "}
                  <span className="font-mono text-content-subtle">{target.key}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setTarget(null)}
                  className="text-xs text-primary hover:text-primary-hover"
                >
                  {t("cognateEditor.changeWord")}
                </button>
              </div>
            )}
          </section>

          <div>
            <label htmlFor="cognate-notes" className="block text-sm font-medium text-content">
              {t("cognateEditor.notesLabel")}
            </label>
            <p className="mt-1 text-xs text-content-subtle">{t("cognateEditor.notesHelp")}</p>
            <textarea
              id="cognate-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder={t("cognateEditor.notesPlaceholder")}
              className={`${inputClass} mt-1`}
            />
          </div>

          {error !== null && <p className="text-sm text-danger">{error}</p>}

          <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            {canDelete ? (
              <button
                type="button"
                onClick={onDelete}
                title={t("cognateEditor.deleteHint")}
                className="self-start text-sm text-danger hover:text-danger"
              >
                {deleting ? t("cognateEditor.deleting") : t("cognateEditor.delete")}
              </button>
            ) : (
              <span />
            )}
            <div className="flex shrink-0 items-center justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border px-4 py-2 text-sm text-content hover:bg-black/5"
              >
                {t("cognateEditor.cancel")}
              </button>
              <button
                type="button"
                onClick={onSubmit}
                disabled={!canSubmit}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-fg hover:bg-primary-hover disabled:opacity-50"
              >
                {submitting ? t("cognateEditor.submitting") : t("cognateEditor.submit")}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
