import {
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useTranslation } from "react-i18next";
import {
  LEKSIS_ENTRY_COLLECTION,
  type EntryAnnotation,
  type LanguageView,
  type LeksisEntryRecord,
} from "@leksis/types";
import { useSession } from "../auth/SessionProvider";
import { endonym } from "./LanguageSelector";

interface AnnotationTag extends EntryAnnotation {
  /** Stable identity across reorders — chips keep their DOM node while dragged. */
  id: number;
}

let nextAnnotationId = 0;

function toAnnotationTags(annotations: EntryAnnotation[]): AnnotationTag[] {
  return annotations.map((a) => ({ ...a, id: nextAnnotationId++ }));
}

/**
 * Reorderable chip row for short/long annotation pairs (grammatical
 * categories, definition notes). Each chip shows the short form; the long
 * form appears in a tooltip on hover/focus, or on tap/click where there is
 * no hover. Chips are reordered by dragging (pointer events, so mouse and
 * touch alike — a click is only a reveal if the pointer never crossed the
 * drag threshold) or with the arrow keys, and removed with their × button.
 * Order is meaningful: it becomes the order of the record's array.
 */
function AnnotationTagList({
  tags,
  onReorder,
  onRemove,
}: {
  tags: AnnotationTag[];
  onReorder: (from: number, to: number) => void;
  onRemove: (id: number) => void;
}) {
  const { t } = useTranslation();
  const [revealedId, setRevealedId] = useState<number | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const chipRefs = useRef(new Map<number, HTMLButtonElement>());
  // Window-level listeners see the latest order through this ref, not through
  // the closure they were created in.
  const tagsRef = useRef(tags);
  tagsRef.current = tags;
  const suppressClick = useRef(false);

  function startDrag(event: ReactPointerEvent<HTMLButtonElement>, id: number) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    suppressClick.current = false;
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;

    // Listeners live on window rather than pointer capture: reordering moves
    // the chip in the DOM, which would release the capture mid-drag.
    const onMove = (ev: PointerEvent) => {
      if (!moved) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
        moved = true;
        setDraggingId(id);
        setRevealedId(null);
      }
      const current = tagsRef.current;
      const from = current.findIndex((tag) => tag.id === id);
      const to = current.findIndex((tag) => {
        const el = chipRefs.current.get(tag.id);
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return (
          ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom
        );
      });
      if (to !== -1 && from !== -1 && to !== from) onReorder(from, to);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      suppressClick.current = moved;
      setDraggingId(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  function onChipClick(id: number) {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    setRevealedId((prev) => (prev === id ? null : id));
  }

  function onChipKeyDown(event: KeyboardEvent<HTMLButtonElement>, id: number) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const from = tags.findIndex((tag) => tag.id === id);
    const to = event.key === "ArrowLeft" ? from - 1 : from + 1;
    if (from !== -1 && to >= 0 && to < tags.length) onReorder(from, to);
  }

  return (
    <ul className="mt-2 flex flex-wrap items-center gap-1.5">
      {tags.map((tag) => (
        <li
          key={tag.id}
          className={`group relative flex items-center rounded-full border bg-surface-muted/60 ${
            draggingId === tag.id ? "opacity-70 ring-2" : ""
          }`}
        >
          <span
            role="tooltip"
            className={`pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded border bg-surface px-2 py-1 text-xs text-content shadow-sm ${
              revealedId === tag.id ? "" : "hidden group-hover:block group-focus-within:block"
            }`}
          >
            {tag.long}
          </span>
          <button
            type="button"
            ref={(el) => {
              if (el) chipRefs.current.set(tag.id, el);
              else chipRefs.current.delete(tag.id);
            }}
            onPointerDown={(e) => startDrag(e, tag.id)}
            onClick={() => onChipClick(tag.id)}
            onKeyDown={(e) => onChipKeyDown(e, tag.id)}
            aria-label={`${tag.short} — ${tag.long}`}
            title={t("createEntry.annotationChipHint")}
            className="cursor-grab touch-none select-none rounded-l-full py-1 pl-2.5 pr-1 font-mono text-xs text-content active:cursor-grabbing"
          >
            {tag.short}
          </button>
          <button
            type="button"
            onClick={() => onRemove(tag.id)}
            aria-label={t("createEntry.removeAnnotation", { annotation: tag.long })}
            title={t("createEntry.removeAnnotation", { annotation: tag.long })}
            className="rounded-r-full py-1 pl-1 pr-2 text-sm leading-none text-content-subtle hover:text-content"
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Chips + short/long input pair for one annotation list. Used for the
 * entry's grammatical categories and for each definition's notes; owns its
 * draft inputs, the parent only sees the committed, ordered list.
 */
function AnnotationEditor({
  idPrefix,
  tags,
  onChange,
  addLabel,
}: {
  idPrefix: string;
  tags: AnnotationTag[];
  onChange: (tags: AnnotationTag[]) => void;
  addLabel: string;
}) {
  const { t } = useTranslation();
  const [draftShort, setDraftShort] = useState("");
  const [draftLong, setDraftLong] = useState("");
  const canAdd = draftShort.trim() !== "" && draftLong.trim() !== "";

  function add() {
    if (!canAdd) return;
    onChange([
      ...tags,
      { id: nextAnnotationId++, short: draftShort.trim(), long: draftLong.trim() },
    ]);
    setDraftShort("");
    setDraftLong("");
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    add();
  }

  function reorder(from: number, to: number) {
    const next = [...tags];
    const [moved] = next.splice(from, 1);
    if (moved === undefined) return;
    next.splice(to, 0, moved);
    onChange(next);
  }

  return (
    <>
      {tags.length > 0 && (
        <AnnotationTagList
          tags={tags}
          onReorder={reorder}
          onRemove={(id) => onChange(tags.filter((tag) => tag.id !== id))}
        />
      )}
      <div className="mt-2 flex items-center gap-2">
        <label className="sr-only" htmlFor={`${idPrefix}-short`}>
          {t("createEntry.annotationShortLabel")}
        </label>
        <input
          id={`${idPrefix}-short`}
          value={draftShort}
          onChange={(e) => setDraftShort(e.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder={t("createEntry.annotationShortPlaceholder")}
          className="w-20 min-w-0 shrink-0 rounded-lg border bg-surface px-2 py-2 font-mono text-sm text-content outline-none placeholder:text-content-subtle focus:ring-2 sm:w-24"
        />
        <label className="sr-only" htmlFor={`${idPrefix}-long`}>
          {t("createEntry.annotationLongLabel")}
        </label>
        <input
          id={`${idPrefix}-long`}
          value={draftLong}
          onChange={(e) => setDraftLong(e.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder={t("createEntry.annotationLongPlaceholder")}
          className="min-w-0 flex-1 rounded-lg border bg-surface px-3 py-2 text-sm text-content outline-none placeholder:text-content-subtle focus:ring-2"
        />
        <button
          type="button"
          onClick={add}
          disabled={!canAdd}
          aria-label={addLabel}
          title={addLabel}
          className="shrink-0 rounded-lg border px-3 py-2 text-sm text-content hover:bg-surface-muted disabled:opacity-50"
        >
          ＋
        </button>
      </div>
    </>
  );
}

interface DefinitionRow {
  /** Stable identity so definition blocks survive removals above them. */
  id: number;
  notes: AnnotationTag[];
  text: string;
}

let nextDefinitionId = 0;

export interface EntryEditorDialogProps {
  /** All known languages, for the in-dialog picker when none was preselected. */
  languages: LanguageView[];
  /** Preselected language, if any; when null the dialog offers its own picker. */
  language: LanguageView | null;
  /** Prefills the first spelling when creating from a search. */
  word?: string;
  /** Record content to start from (proposing a modification). */
  initial?: LeksisEntryRecord;
  /** AT URI of the record version being modified; absent = brand-new entry. */
  subject?: string;
  onClose: () => void;
  /** Called with the new record's AT URI after it was written to the PDS. */
  onCreated: (recordURI: string) => void;
}

/**
 * The entry record editor: creates or modifies a eu.leksis.entry record on
 * the user's own PDS (ADR-0002: the browser writes, the AppView only
 * re-indexes from the firehose). A modification is a full rewrite published
 * under the proposer's own repo, carrying `subject` — the AT URI of the
 * version it modifies — so the AppView attaches it to the same entry
 * (records prove authorship, not ownership; last write wins, previous
 * versions are archived).
 */
export function EntryEditorDialog({
  languages,
  language,
  word = "",
  initial,
  subject,
  onClose,
  onCreated,
}: EntryEditorDialogProps) {
  const { t } = useTranslation();
  const { agent, did } = useSession();

  const [pickedTag, setPickedTag] = useState(language?.tag ?? initial?.languageID ?? "");
  const [spellings, setSpellings] = useState<string[]>(initial?.orthography ?? [word]);
  const [categories, setCategories] = useState<AnnotationTag[]>(() =>
    toAnnotationTags(initial?.categories ?? []),
  );
  const [definitions, setDefinitions] = useState<DefinitionRow[]>(() =>
    (initial?.definitions ?? [{ notes: [], text: "" }]).map((d) => ({
      id: nextDefinitionId++,
      notes: toAnnotationTags(d.notes),
      text: d.text,
    })),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const target = language ?? languages.find((l) => l.tag === pickedTag) ?? null;

  function onPickLanguage(event: ChangeEvent<HTMLSelectElement>) {
    setPickedTag(event.target.value);
  }

  function setSpelling(index: number, value: string) {
    setSpellings((prev) => prev.map((s, i) => (i === index ? value : s)));
  }

  function setDefinition(id: number, patch: Partial<Omit<DefinitionRow, "id">>) {
    setDefinitions((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  const cleanSpellings = spellings.map((s) => s.trim()).filter((s) => s !== "");
  const cleanDefinitions = definitions
    .filter((d) => d.text.trim() !== "")
    .map((d) => ({
      notes: d.notes.map(({ short, long }) => ({ short, long })),
      text: d.text.trim(),
    }));
  const canSubmit =
    !submitting && target !== null && cleanSpellings.length > 0 && cleanDefinitions.length > 0;

  async function onSubmit() {
    if (!canSubmit || !agent || !did || target === null) return;

    const record: LeksisEntryRecord = {
      $type: LEKSIS_ENTRY_COLLECTION,
      languageID: target.tag,
      orthography: cleanSpellings,
      categories: categories.map(({ short, long }) => ({ short, long })),
      definitions: cleanDefinitions,
      ...(subject !== undefined ? { subject } : {}),
      createdAt: new Date().toISOString(),
    };

    setSubmitting(true);
    setError(null);
    try {
      // rkey is a fresh TID: every version — creation or proposed
      // modification — is its own record in the author's repo.
      const res = await agent.com.atproto.repo.createRecord({
        repo: did,
        collection: LEKSIS_ENTRY_COLLECTION,
        // createRecord wants an index signature our interface doesn't declare.
        record: { ...record },
      });
      onCreated(res.data.uri);
    } catch (err) {
      console.error("createRecord failed:", err);
      setError(t("createEntry.errors.writeFailed"));
      setSubmitting(false);
    }
  }

  const title = initial ? (
    t("createEntry.titleModify", { word: initial.orthography[0] })
  ) : target !== null ? (
    <>
      {t("createEntry.title", { word, language: endonym(target) })}{" "}
      <span className="rounded border bg-surface px-1.5 py-0.5 align-middle font-mono text-xs font-normal text-content-muted">
        {target.tag}
      </span>
    </>
  ) : (
    t("createEntry.titleNoLanguage", { word })
  );

  const inputClass =
    "w-full rounded-lg border bg-surface px-3 py-2 text-sm text-content outline-none placeholder:text-content-subtle focus:ring-2";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-entry-title"
    >
      {/* Bottom sheet on phones (full width, capped by dvh so the browser
          chrome never hides the buttons), centered card from sm: up. */}
      <section className="max-h-[calc(100dvh-2rem)] w-full overflow-y-auto rounded-t-xl border bg-surface shadow-lg sm:max-w-xl sm:rounded-xl">
        <header className="border-b bg-surface-muted/60 px-4 py-3 sm:px-5">
          <h2 id="create-entry-title" className="text-base font-semibold text-content">
            {title}
          </h2>
          <p className="mt-1 text-sm text-content-muted">
            {initial ? t("createEntry.introModify") : t("createEntry.intro")}
          </p>

          {language === null && initial === undefined && (
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
            <p className="mt-1 text-xs text-content-subtle">
              {t("createEntry.orthographyHelp")}
            </p>
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

          <fieldset className="mt-5">
            <legend className="text-sm font-medium text-content">
              {t("createEntry.categoriesLabel")}
            </legend>
            <p className="mt-1 text-xs text-content-subtle">
              {t("createEntry.categoriesHelp")}
            </p>
            <AnnotationEditor
              idPrefix="entry-category"
              tags={categories}
              onChange={setCategories}
              addLabel={t("createEntry.addCategory")}
            />
          </fieldset>

          <fieldset className="mt-5">
            <legend className="text-sm font-medium text-content">
              {t("createEntry.definitionsLegend")}
            </legend>
            <p className="mt-1 text-xs text-content-subtle">
              {t("createEntry.definitionsHelp")}
            </p>
            {definitions.map((row, i) => (
              <div key={row.id} className="mt-3 rounded-lg border bg-surface-muted/30 p-3">
                <div className="flex items-start gap-2">
                  <span className="mt-2 shrink-0 font-mono text-xs text-content-subtle">
                    {i + 1}.
                  </span>
                  <label className="sr-only" htmlFor={`entry-definition-text-${row.id}`}>
                    {t("createEntry.definitionTextLabel")}
                  </label>
                  <textarea
                    id={`entry-definition-text-${row.id}`}
                    value={row.text}
                    onChange={(e) => setDefinition(row.id, { text: e.target.value })}
                    placeholder={t("createEntry.definitionTextPlaceholder")}
                    rows={2}
                    className="min-w-0 flex-1 rounded-lg border bg-surface px-3 py-2 text-sm text-content outline-none placeholder:text-content-subtle focus:ring-2"
                  />
                  {definitions.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        setDefinitions((prev) => prev.filter((d) => d.id !== row.id))
                      }
                      aria-label={t("createEntry.removeDefinition")}
                      title={t("createEntry.removeDefinition")}
                      className="shrink-0 rounded-lg px-2 py-1 text-lg leading-none text-content-subtle hover:bg-surface-muted hover:text-content"
                    >
                      ×
                    </button>
                  )}
                </div>
                <div className="mt-2 pl-5">
                  <p className="text-xs text-content-subtle">{t("createEntry.notesHelp")}</p>
                  <AnnotationEditor
                    idPrefix={`entry-definition-note-${row.id}`}
                    tags={row.notes}
                    onChange={(notes) => setDefinition(row.id, { notes })}
                    addLabel={t("createEntry.addNote")}
                  />
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                setDefinitions((prev) => [
                  ...prev,
                  { id: nextDefinitionId++, notes: [], text: "" },
                ])
              }
              className="mt-2 text-sm text-primary hover:text-primary-hover"
            >
              {t("createEntry.addDefinition")}
            </button>
          </fieldset>

          <p className="mt-4 text-xs text-content-subtle">{t("createEntry.laterFields")}</p>

          <div className="mt-4 flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            {error !== null && <p className="text-sm text-red-600">{error}</p>}
            <div className="ml-auto flex shrink-0 items-center justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border px-4 py-2 text-sm text-content hover:bg-black/5"
              >
                {t("createEntry.cancel")}
              </button>
              <button
                type="button"
                onClick={onSubmit}
                disabled={!canSubmit}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-fg hover:bg-primary-hover disabled:opacity-50"
              >
                {submitting
                  ? t("createEntry.submitting")
                  : initial
                    ? t("createEntry.submitModify")
                    : t("createEntry.submit")}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

interface CreateEntryPanelProps {
  /** The word that was searched — prefills the first spelling. */
  word: string;
  /** All known languages, for the in-dialog picker when none was preselected. */
  languages: LanguageView[];
  /** The language scope the search was submitted with, if any. */
  language: LanguageView | null;
  /** Called with the new record's AT URI after it was written to the PDS. */
  onCreated: (recordURI: string) => void;
}

/**
 * The "add this word" offer on the search-results page: a call-to-action
 * button that opens the entry editor dialog for the searched word. Always
 * offered, even for an all-languages search — a language picker inside the
 * dialog stands in for the preselection in that case. Mount with a key of
 * word+tag so state resets per search.
 */
export function CreateEntryPanel({ word, languages, language, onCreated }: CreateEntryPanelProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const target = language;
  const title =
    target !== null ? (
      <>
        {t("createEntry.title", { word, language: endonym(target) })}{" "}
        <span className="rounded border bg-surface px-1.5 py-0.5 align-middle font-mono text-xs font-normal text-content-muted">
          {target.tag}
        </span>
      </>
    ) : (
      t("createEntry.titleNoLanguage", { word })
    );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 flex w-full items-center gap-3 rounded-lg border bg-surface px-4 py-3 text-left shadow-sm hover:border-primary/50 hover:bg-surface-muted/60"
      >
        <span
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-lg leading-none text-primary"
        >
          ＋
        </span>
        <span className="text-sm font-medium text-content">{title}</span>
      </button>

      {open && (
        <EntryEditorDialog
          languages={languages}
          language={language}
          word={word}
          onClose={() => setOpen(false)}
          onCreated={(uri) => {
            setOpen(false);
            onCreated(uri);
          }}
        />
      )}
    </>
  );
}
