import {
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useTranslation } from "react-i18next";
import type { LanguageView } from "@leksis/types";
import { endonym } from "./LanguageSelector";

interface CreateEntryPanelProps {
  /** The word that was searched — prefills the first spelling. */
  word: string;
  /** All known languages, for the in-dialog picker when none was preselected. */
  languages: LanguageView[];
  /** The language scope the search was submitted with, if any. */
  language: LanguageView | null;
}

interface DefinitionRow {
  tag: string;
  text: string;
}

interface CategoryTag {
  /** Stable identity across reorders — chips keep their DOM node while dragged. */
  id: number;
  short: string; // abbreviation, e.g. "n."
  long: string; // full form, e.g. "noun"
}

/**
 * Reorderable chip row for the entered grammatical categories. Each chip shows
 * the short form; the long form appears in a tooltip on hover/focus, or on
 * tap/click where there is no hover. Chips are reordered by dragging (pointer
 * events, so mouse and touch alike — a click is only a reveal if the pointer
 * never crossed the drag threshold) or with the arrow keys, and removed with
 * their × button. Order is meaningful: it becomes the order of the record's
 * grammaticality.categories array.
 */
function CategoryTagList({
  tags,
  onReorder,
  onRemove,
}: {
  tags: CategoryTag[];
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
            title={t("createEntry.categoryChipHint")}
            className="cursor-grab touch-none select-none rounded-l-full py-1 pl-2.5 pr-1 font-mono text-xs text-content active:cursor-grabbing"
          >
            {tag.short}
          </button>
          <button
            type="button"
            onClick={() => onRemove(tag.id)}
            aria-label={t("createEntry.removeCategory", { category: tag.long })}
            title={t("createEntry.removeCategory", { category: tag.long })}
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
 * The "add this word" offer on the search-results page: a call-to-action
 * button that opens a dialog previewing the eu.leksis.entry record for the
 * searched word — orthography[], grammaticality {categories, notes} and
 * definitions[{tag, text}], the slice of the lexicon the entries loop (week 4)
 * ships. Grammatical categories are entered as short/long pairs ("n." /
 * "noun") and shown as reorderable chips. The submit stays disabled until the
 * loop lands the record write + AppView ingestion; the fields are already the
 * real contract. Always offered, even for an all-languages search — a language
 * picker inside the dialog stands in for the preselection in that case. Mount
 * with a key of word+tag so state resets per search.
 */
export function CreateEntryPanel({ word, languages, language }: CreateEntryPanelProps) {
  const { t } = useTranslation();

  const [open, setOpen] = useState(false);
  const [pickedTag, setPickedTag] = useState(language?.tag ?? "");
  const [spellings, setSpellings] = useState<string[]>([word]);
  const [categories, setCategories] = useState<CategoryTag[]>([]);
  const [draftShort, setDraftShort] = useState("");
  const [draftLong, setDraftLong] = useState("");
  const nextCategoryId = useRef(0);
  const [notes, setNotes] = useState("");
  const [definitions, setDefinitions] = useState<DefinitionRow[]>([{ tag: "", text: "" }]);

  const target = language ?? languages.find((l) => l.tag === pickedTag) ?? null;

  function onPickLanguage(event: ChangeEvent<HTMLSelectElement>) {
    setPickedTag(event.target.value);
  }

  function setSpelling(index: number, value: string) {
    setSpellings((prev) => prev.map((s, i) => (i === index ? value : s)));
  }

  function setDefinition(index: number, patch: Partial<DefinitionRow>) {
    setDefinitions((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  const canAddCategory = draftShort.trim() !== "" && draftLong.trim() !== "";

  function addCategory() {
    if (!canAddCategory) return;
    setCategories((prev) => [
      ...prev,
      { id: nextCategoryId.current++, short: draftShort.trim(), long: draftLong.trim() },
    ]);
    setDraftShort("");
    setDraftLong("");
  }

  function onCategoryInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    addCategory();
  }

  function reorderCategory(from: number, to: number) {
    setCategories((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      if (moved === undefined) return prev;
      next.splice(to, 0, moved);
      return next;
    });
  }

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

  const inputClass =
    "w-full rounded-lg border bg-surface px-3 py-2 text-sm text-content outline-none placeholder:text-content-subtle focus:ring-2";

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
              <p className="mt-1 text-sm text-content-muted">{t("createEntry.intro")}</p>

              {language === null && (
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
                {categories.length > 0 && (
                  <CategoryTagList
                    tags={categories}
                    onReorder={reorderCategory}
                    onRemove={(id) =>
                      setCategories((prev) => prev.filter((tag) => tag.id !== id))
                    }
                  />
                )}
                <div className="mt-2 flex items-center gap-2">
                  <label className="sr-only" htmlFor="entry-category-short">
                    {t("createEntry.categoryShortLabel")}
                  </label>
                  <input
                    id="entry-category-short"
                    value={draftShort}
                    onChange={(e) => setDraftShort(e.target.value)}
                    onKeyDown={onCategoryInputKeyDown}
                    placeholder={t("createEntry.categoryShortPlaceholder")}
                    className="w-20 min-w-0 shrink-0 rounded-lg border bg-surface px-2 py-2 font-mono text-sm text-content outline-none placeholder:text-content-subtle focus:ring-2 sm:w-24"
                  />
                  <label className="sr-only" htmlFor="entry-category-long">
                    {t("createEntry.categoryLongLabel")}
                  </label>
                  <input
                    id="entry-category-long"
                    value={draftLong}
                    onChange={(e) => setDraftLong(e.target.value)}
                    onKeyDown={onCategoryInputKeyDown}
                    placeholder={t("createEntry.categoryLongPlaceholder")}
                    className="min-w-0 flex-1 rounded-lg border bg-surface px-3 py-2 text-sm text-content outline-none placeholder:text-content-subtle focus:ring-2"
                  />
                  <button
                    type="button"
                    onClick={addCategory}
                    disabled={!canAddCategory}
                    aria-label={t("createEntry.addCategory")}
                    title={t("createEntry.addCategory")}
                    className="shrink-0 rounded-lg border px-3 py-2 text-sm text-content hover:bg-surface-muted disabled:opacity-50"
                  >
                    ＋
                  </button>
                </div>
              </fieldset>

              <label
                htmlFor="entry-notes"
                className="mt-4 block text-sm font-medium text-content"
              >
                {t("createEntry.notesLabel")}
              </label>
              <textarea
                id="entry-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t("createEntry.notesPlaceholder")}
                rows={2}
                className={`mt-1 ${inputClass}`}
              />

              <fieldset className="mt-5">
                <legend className="text-sm font-medium text-content">
                  {t("createEntry.definitionsLegend")}
                </legend>
                {definitions.map((row, i) => (
                  <div key={i} className="mt-2 flex items-start gap-2">
                    <label className="sr-only" htmlFor={`entry-definition-tag-${i}`}>
                      {t("createEntry.definitionTagLabel")}
                    </label>
                    <input
                      id={`entry-definition-tag-${i}`}
                      value={row.tag}
                      onChange={(e) => setDefinition(i, { tag: e.target.value })}
                      placeholder={t("createEntry.definitionTagPlaceholder")}
                      className="w-28 min-w-0 shrink-0 rounded-lg border bg-surface px-2 py-2 text-sm text-content outline-none placeholder:text-content-subtle focus:ring-2 sm:w-36"
                    />
                    <label className="sr-only" htmlFor={`entry-definition-text-${i}`}>
                      {t("createEntry.definitionTextLabel")}
                    </label>
                    <textarea
                      id={`entry-definition-text-${i}`}
                      value={row.text}
                      onChange={(e) => setDefinition(i, { text: e.target.value })}
                      placeholder={t("createEntry.definitionTextPlaceholder")}
                      rows={2}
                      className="min-w-0 flex-1 rounded-lg border bg-surface px-3 py-2 text-sm text-content outline-none placeholder:text-content-subtle focus:ring-2"
                    />
                    {definitions.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setDefinitions((prev) => prev.filter((_, j) => j !== i))}
                        aria-label={t("createEntry.removeDefinition")}
                        title={t("createEntry.removeDefinition")}
                        className="shrink-0 rounded-lg px-2 py-1 text-lg leading-none text-content-subtle hover:bg-surface-muted hover:text-content"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setDefinitions((prev) => [...prev, { tag: "", text: "" }])}
                  className="mt-2 text-sm text-primary hover:text-primary-hover"
                >
                  {t("createEntry.addDefinition")}
                </button>
              </fieldset>

              <p className="mt-4 text-xs text-content-subtle">{t("createEntry.laterFields")}</p>

              <div className="mt-4 flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-content-muted">{t("createEntry.comingSoon")}</p>
                <div className="flex shrink-0 items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-lg border px-4 py-2 text-sm text-content hover:bg-black/5"
                  >
                    {t("createEntry.cancel")}
                  </button>
                  <button
                    type="button"
                    disabled
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-fg disabled:opacity-50"
                  >
                    {t("createEntry.submit")}
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
