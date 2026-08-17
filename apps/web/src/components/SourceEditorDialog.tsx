import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  normalizeOclc,
  validateSource,
  LEKSIS_SOURCE_COLLECTION,
  type LanguageView,
  type LeksisSourceRecord,
  type SourceError,
} from "@leksis/types";
import { authorLine, fetchOclcMetadata, fullTitle } from "@leksis/oclc";
import { useSession } from "../auth/SessionProvider";
import { fetchCurrentSourceRecord } from "../lib/api";
import { fetchSourceRecord } from "../lib/atproto-record";
import { forgetSource } from "../lib/source-record";
import { endonym as displayName } from "./LanguageSelector";

/** How long typing settles before the number is looked up. */
const LOOKUP_DEBOUNCE_MS = 600;

interface SourceEditorDialogProps {
  /** Every known language, for the language pickers. */
  languages: LanguageView[];
  /**
   * The source being edited, by normalized number. Absent means describing one
   * that has no record yet — which includes a number entries already cite.
   */
  editing?: string;
  /** Prefill for a new description, from whatever the searcher typed. */
  seedOclc?: string;
  seedTitle?: string;
  /** Main language when opened from a language's page. New sources only. */
  mainLanguage?: string;
  onClose: () => void;
  /** The normalized number, after the record was written to the PDS. */
  onPublished: (oclc: string) => void;
}

type LookupState = "idle" | "searching" | "found" | "none";

/**
 * Describe a work an example sentence can be cited from, as a eu.leksis.source
 * record on the editor's own PDS (ADR-0002: the browser writes, the AppView
 * re-indexes from the firehose).
 *
 * Two rules of the design show up as interface behaviour rather than as
 * validation:
 *
 *  - **The record key is the number**, so publishing over an existing source is
 *    an ordinary update by anyone — records prove authorship, not ownership.
 *  - **`languages[0]` never changes.** The AppView only flags a version that
 *    moves it (an index is not the arbiter of what a contributor may assert),
 *    so it falls to this editor to make the change impossible in the first
 *    place: when editing, the main language is displayed and has no control.
 */
export function SourceEditorDialog({
  languages,
  editing,
  seedOclc,
  seedTitle,
  mainLanguage,
  onClose,
  onPublished,
}: SourceEditorDialogProps) {
  const { t } = useTranslation();
  const { agent, did } = useSession();

  const [oclcInput, setOclcInput] = useState(editing ?? seedOclc ?? "");
  const [title, setTitle] = useState(seedTitle ?? "");
  const [author, setAuthor] = useState("");
  const [year, setYear] = useState("");
  const [url, setUrl] = useState("");
  const [langs, setLangs] = useState<string[]>(mainLanguage ? [mainLanguage] : [""]);
  const [short, setShort] = useState("");
  const [long, setLong] = useState("");

  const [loading, setLoading] = useState(editing !== undefined);
  const [lookup, setLookup] = useState<LookupState>("idle");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * CID of the version this edit started from. Re-read immediately before
   * publishing: a rewrite made against a stale copy would silently drop
   * whatever the other author added, and unlike an entry a source is described
   * by strangers, so that other author is usually someone else.
   */
  const [baseCid, setBaseCid] = useState<string | null>(null);
  /** Bumped to re-run the lookup on demand, overwriting what it finds. */
  const [lookupNonce, setLookupNonce] = useState(0);
  const overwriteOnLookup = useRef(false);

  const normalized = useMemo(() => normalizeOclc(oclcInput), [oclcInput]);
  const isEditing = editing !== undefined;

  // Load the source being edited. A number nobody has described yet is not an
  // error here: somebody cited it, and this dialog is how it gets described.
  useEffect(() => {
    if (editing === undefined) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const reference = await fetchCurrentSourceRecord(editing);
      if (reference === null) return null;
      const record = await fetchSourceRecord(reference.recordURI);
      return { reference, record };
    })()
      .then((found) => {
        if (cancelled) return;
        if (found?.record) {
          const { record, reference } = found;
          setBaseCid(reference.cid);
          setTitle(record.title);
          setAuthor(record.author ?? "");
          setYear(record.year ?? "");
          setUrl(record.url ?? "");
          setLangs(record.languages);
          setShort(record.citation.short);
          setLong(record.citation.long);
        } else if (found) {
          // Described, but the record would not load. Editing from a blank form
          // would republish it as empty, so say so instead.
          setError(t("sourceEditor.errors.loadFailed"));
        }
        setLoading(false);
      })
      .catch((err: unknown) => {
        console.error("loading the source for editing failed:", err);
        if (cancelled) return;
        setError(t("sourceEditor.errors.loadFailed"));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [editing, t]);

  // Look the number up and fill in the prose. An enhancement, never a
  // dependency: a failure leaves every field exactly as the contributor left
  // it, and the form stays entirely usable.
  useEffect(() => {
    if (normalized === null || loading) {
      setLookup("idle");
      return;
    }
    const controller = new AbortController();
    const overwrite = overwriteOnLookup.current;
    overwriteOnLookup.current = false;
    const timer = setTimeout(() => {
      setLookup("searching");
      fetchOclcMetadata(normalized, controller.signal).then((meta) => {
        if (controller.signal.aborted) return;
        if (meta === null) {
          setLookup("none");
          return;
        }
        setLookup("found");
        // An explicit re-lookup replaces what it finds; an automatic one only
        // fills blanks, so it can never overwrite something typed by hand.
        //
        // Updated functionally rather than against captured values: the effect
        // is keyed on the number alone, so by the time the debounce fires the
        // contributor may have typed a title, and a captured "" would clobber
        // it.
        const fill = (set: (update: (current: string) => string) => void, found: string) => {
          if (found === "") return;
          set((current) => (overwrite || current.trim() === "" ? found : current));
        };
        fill(setTitle, fullTitle(meta));
        fill(setAuthor, authorLine(meta));
        fill(setYear, meta.year ?? "");
        fill(setUrl, meta.url ?? "");
      });
    }, LOOKUP_DEBOUNCE_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
    // Keyed on the number alone, deliberately: re-running whenever a field the
    // lookup fills happens to change would make it fight the contributor.
  }, [normalized, loading, lookupNonce]);

  const draft: Pick<LeksisSourceRecord, "category" | "oclc" | "title" | "languages" | "citation"> = {
    category: "bibliographic",
    oclc: normalized ?? "",
    title,
    languages: langs.filter((l) => l !== ""),
    citation: { short, long },
  };
  const invalid: SourceError | "ok" = validateSource(draft);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!agent || !did || normalized === null) return;
    if (invalid !== "ok") return setError(t(`sourceEditor.errors.${invalid}`));

    setSubmitting(true);
    setError(null);
    try {
      // The concurrency guard, and the reason CurrentSourceRecordResponse
      // carries a cid at all. Skipped when nothing was current at load time —
      // there is then no other author's work to lose.
      if (baseCid !== null) {
        const fresh = await fetchCurrentSourceRecord(normalized);
        if (fresh !== null && fresh.cid !== baseCid) {
          setError(t("sourceEditor.errors.stale"));
          setSubmitting(false);
          return;
        }
      }

      const trimmed = (value: string) => value.trim();
      const record: LeksisSourceRecord = {
        $type: LEKSIS_SOURCE_COLLECTION,
        category: "bibliographic",
        oclc: normalized,
        title: trimmed(title),
        ...(trimmed(author) !== "" ? { author: trimmed(author) } : {}),
        ...(trimmed(year) !== "" ? { year: trimmed(year) } : {}),
        ...(trimmed(url) !== "" ? { url: trimmed(url) } : {}),
        languages: draft.languages,
        citation: { short: trimmed(short), long: trimmed(long) },
        createdAt: new Date().toISOString(),
      };

      // rkey = the normalized number, exactly as a language record keys on its
      // tag: one record per work per repo, and every author's record for one
      // work shares a key.
      await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: LEKSIS_SOURCE_COLLECTION,
        rkey: normalized,
        // putRecord wants an index signature our interface doesn't declare.
        record: { ...record },
      });
      forgetSource(normalized);
      onPublished(normalized);
    } catch (err) {
      console.error("putRecord failed:", err);
      setError(t("sourceEditor.errors.writeFailed"));
      setSubmitting(false);
    }
  }

  const input =
    "mt-1 w-full rounded-lg border bg-surface px-3 py-2 text-sm text-content outline-none placeholder:text-content-subtle focus:ring-2";
  const label = "mt-4 block text-sm font-medium text-content";
  const hint = "mt-1 text-xs text-content-subtle";

  const languageName = (tag: string) => {
    const known = languages.find((l) => l.tag === tag);
    return known ? displayName(known) : tag;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="source-editor-title"
    >
      <form
        onSubmit={onSubmit}
        className="max-h-[calc(100dvh-2rem)] w-full overflow-y-auto rounded-t-xl border bg-surface p-4 shadow-lg sm:max-w-lg sm:rounded-xl sm:p-6"
      >
        <h2 id="source-editor-title" className="text-lg font-semibold text-content">
          {isEditing ? t("sourceEditor.titleEdit") : t("sourceEditor.title")}
        </h2>
        <p className="mt-1 text-sm text-content-subtle">
          {isEditing ? t("sourceEditor.introEdit") : t("sourceEditor.intro")}
        </p>

        {loading ? (
          <p className="mt-6 text-sm text-content-muted">{t("sourceEditor.loading")}</p>
        ) : (
          <>
            <label htmlFor="source-editor-category" className={label}>
              {t("sourceEditor.categoryLabel")}
            </label>
            {/* Prefilled and disabled rather than hidden: the field is what
                tells a contributor the record is meant to grow other kinds. */}
            <select
              id="source-editor-category"
              value="bibliographic"
              disabled
              className="mt-1 w-full rounded-lg border bg-surface px-3 py-2 text-sm text-content outline-none disabled:opacity-70"
            >
              <option value="bibliographic">{t("sourceEditor.categoryBibliographic")}</option>
            </select>
            <p className={hint}>{t("sourceEditor.categoryHint")}</p>

            <label htmlFor="source-editor-oclc" className={label}>
              {t("sourceEditor.oclcLabel")}
            </label>
            <input
              id="source-editor-oclc"
              value={oclcInput}
              onChange={(e) => setOclcInput(e.target.value)}
              readOnly={isEditing}
              placeholder={t("sourceEditor.oclcPlaceholder")}
              autoCapitalize="none"
              autoCorrect="off"
              className={`${input} font-mono ${isEditing ? "opacity-70" : ""}`}
            />
            <p className={hint}>
              {isEditing ? t("sourceEditor.oclcLocked") : t("sourceEditor.oclcHint")}
            </p>
            {oclcInput.trim() !== "" && normalized === null && (
              <p className="mt-1 text-xs text-danger">{t("sourceEditor.errors.oclc")}</p>
            )}
            {normalized !== null && (
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                {lookup === "searching" && (
                  <span className="text-xs text-content-subtle">
                    {t("sourceEditor.lookupSearching")}
                  </span>
                )}
                {lookup === "found" && (
                  <span className="text-xs text-content-subtle">
                    {t("sourceEditor.lookupFound")}
                  </span>
                )}
                {lookup === "none" && (
                  <span className="text-xs text-content-subtle">
                    {t("sourceEditor.lookupNone")}
                  </span>
                )}
                {lookup !== "searching" && (
                  <button
                    type="button"
                    onClick={() => {
                      overwriteOnLookup.current = true;
                      setLookupNonce((n) => n + 1);
                    }}
                    className="text-xs text-content-subtle underline hover:text-content"
                  >
                    {t("sourceEditor.lookupRetry")}
                  </button>
                )}
              </div>
            )}

            <label htmlFor="source-editor-title-field" className={label}>
              {t("sourceEditor.titleLabel")}
            </label>
            <input
              id="source-editor-title-field"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("sourceEditor.titlePlaceholder")}
              className={input}
            />

            <label htmlFor="source-editor-author" className={label}>
              {t("sourceEditor.authorLabel")}
            </label>
            <input
              id="source-editor-author"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder={t("sourceEditor.authorPlaceholder")}
              className={input}
            />

            <label htmlFor="source-editor-year" className={label}>
              {t("sourceEditor.yearLabel")}
            </label>
            <input
              id="source-editor-year"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              placeholder={t("sourceEditor.yearPlaceholder")}
              className={input}
            />

            <label htmlFor="source-editor-url" className={label}>
              {t("sourceEditor.urlLabel")}
            </label>
            <input
              id="source-editor-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t("sourceEditor.urlPlaceholder")}
              autoCapitalize="none"
              autoCorrect="off"
              className={input}
            />

            <fieldset className="mt-4">
              <legend className="text-sm font-medium text-content">
                {t("sourceEditor.languagesLegend")}
              </legend>
              <p className={hint}>{t("sourceEditor.languagesHint")}</p>

              <label htmlFor="source-editor-main-language" className="mt-3 block text-xs font-medium text-content-muted">
                {t("sourceEditor.mainLanguageLabel")}
              </label>
              {isEditing ? (
                <p className="mt-1 flex items-center gap-2 text-sm text-content">
                  {languageName(langs[0] ?? "")}
                  <span className="rounded border bg-surface px-1.5 py-0.5 font-mono text-xs text-content-muted">
                    {langs[0]}
                  </span>
                </p>
              ) : (
                <select
                  id="source-editor-main-language"
                  value={langs[0] ?? ""}
                  onChange={(e) =>
                    setLangs((prev) => [e.target.value, ...prev.slice(1)])
                  }
                  className="mt-1 w-full rounded-lg border bg-surface px-3 py-2 text-sm text-content outline-none focus:ring-2"
                >
                  <option value="" />
                  {languages.map((l) => (
                    <option key={l.tag} value={l.tag}>
                      {displayName(l)}
                    </option>
                  ))}
                </select>
              )}
              <p className={hint}>
                {isEditing
                  ? t("sourceEditor.mainLanguageLocked")
                  : t("sourceEditor.mainLanguageHint")}
              </p>

              {langs.slice(1).map((tag, i) => (
                <div key={i} className="mt-2 flex items-center gap-2">
                  <label className="sr-only" htmlFor={`source-editor-language-${i}`}>
                    {t("sourceEditor.languagesLegend")}
                  </label>
                  <select
                    id={`source-editor-language-${i}`}
                    value={tag}
                    onChange={(e) =>
                      setLangs((prev) =>
                        prev.map((item, j) => (j === i + 1 ? e.target.value : item)),
                      )
                    }
                    className="min-w-0 flex-1 rounded-lg border bg-surface px-3 py-2 text-sm text-content outline-none focus:ring-2"
                  >
                    <option value="" />
                    {languages.map((l) => (
                      <option key={l.tag} value={l.tag}>
                        {displayName(l)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setLangs((prev) => prev.filter((_, j) => j !== i + 1))}
                    aria-label={t("sourceEditor.removeLanguage")}
                    title={t("sourceEditor.removeLanguage")}
                    className="shrink-0 rounded-lg px-2 py-1 text-lg leading-none text-content-subtle hover:bg-surface-muted hover:text-content"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setLangs((prev) => [...prev, ""])}
                className="mt-2 text-sm text-content-subtle hover:text-content"
              >
                {t("sourceEditor.addLanguage")}
              </button>
            </fieldset>

            <fieldset className="mt-4">
              <legend className="text-sm font-medium text-content">
                {t("sourceEditor.citationLegend")}
              </legend>
              <p className={hint}>{t("sourceEditor.citationHint")}</p>

              <label htmlFor="source-editor-short" className={label}>
                {t("sourceEditor.shortLabel")}
              </label>
              <input
                id="source-editor-short"
                value={short}
                onChange={(e) => setShort(e.target.value)}
                placeholder={t("sourceEditor.shortPlaceholder")}
                className={input}
              />

              <label htmlFor="source-editor-long" className={label}>
                {t("sourceEditor.longLabel")}
              </label>
              <textarea
                id="source-editor-long"
                value={long}
                onChange={(e) => setLong(e.target.value)}
                placeholder={t("sourceEditor.longPlaceholder")}
                rows={2}
                className={input}
              />
            </fieldset>
          </>
        )}

        {error && <p className="mt-3 text-sm text-danger">{error}</p>}

        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg border px-4 py-2 text-sm text-content hover:bg-black/5"
          >
            {t("sourceEditor.cancel")}
          </button>
          <button
            type="submit"
            disabled={submitting || loading || invalid !== "ok"}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-fg hover:bg-primary-hover disabled:opacity-50"
          >
            {submitting
              ? t("sourceEditor.submitting")
              : isEditing
                ? t("sourceEditor.submitEdit")
                : t("sourceEditor.submit")}
          </button>
        </div>
      </form>
    </div>
  );
}
