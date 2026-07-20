import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import {
  annotationConflicts,
  formatAbbreviationRef,
  LEKSIS_ENTRY_COLLECTION,
  type AbbreviationRef,
  type AbbreviationView,
  type EntryAnnotation,
  type LanguageView,
  type LeksisEntryRecord,
} from "@leksis/types";
import { useSession } from "../auth/SessionProvider";
import { fetchAbbreviations } from "../lib/api";
import {
  editTreeLabels,
  fromRecordDefinitions,
  indent,
  moveDown,
  moveUp,
  outdent,
  removeLeaf,
  toRecordDefinitions,
  updateLeaf,
  collectLeaves,
  type EditNode,
} from "../lib/definition-tree";
import { endonym } from "./LanguageSelector";

interface AnnotationTag extends EntryAnnotation {
  /** Stable identity across reorders — chips keep their DOM node while dragged. */
  id: number;
}

let nextAnnotationId = 0;

function toAnnotationTags(annotations: EntryAnnotation[]): AnnotationTag[] {
  return annotations.map((a) => ({ ...a, id: nextAnnotationId++ }));
}

/** Back to the record shape: drop the editor identity and an empty short form. */
function toRecordAnnotation({ short, long }: EntryAnnotation): EntryAnnotation {
  return short !== undefined && short.trim() !== "" ? { short, long } : { long };
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
  conflictsFor,
}: {
  tags: AnnotationTag[];
  onReorder: (from: number, to: number) => void;
  onRemove: (id: number) => void;
  /** Conflict partners of a chip's pair, for the ⚠ flag; absent = no data. */
  conflictsFor?: (tag: AnnotationTag) => AbbreviationRef[];
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
      {tags.map((tag) => {
        const conflicts = conflictsFor?.(tag) ?? [];
        return (
        <li
          key={tag.id}
          className={`group relative flex items-center rounded-full border bg-surface-muted/60 ${
            draggingId === tag.id ? "opacity-70 ring-2" : ""
          } ${conflicts.length > 0 ? "border-red-400" : ""}`}
        >
          {/* No tooltip without a short form — the chip already shows the
              full form, so there is nothing to reveal. */}
          {tag.short !== undefined && (
            <span
              role="tooltip"
              className={`pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded border bg-surface px-2 py-1 text-xs text-content shadow-sm ${
                revealedId === tag.id ? "" : "hidden group-hover:block group-focus-within:block"
              }`}
            >
              {tag.long}
              {conflicts.length > 0 && (
                <span className="block text-red-600">
                  {t("createEntry.conflictWarning", {
                    pairs: conflicts.map(formatAbbreviationRef).join(", "),
                  })}
                </span>
              )}
            </span>
          )}
          <button
            type="button"
            ref={(el) => {
              if (el) chipRefs.current.set(tag.id, el);
              else chipRefs.current.delete(tag.id);
            }}
            onPointerDown={(e) => startDrag(e, tag.id)}
            onClick={() => onChipClick(tag.id)}
            onKeyDown={(e) => onChipKeyDown(e, tag.id)}
            aria-label={tag.short !== undefined ? `${tag.short} — ${tag.long}` : tag.long}
            title={t("createEntry.annotationChipHint")}
            className="cursor-grab touch-none select-none rounded-l-full py-1 pl-2.5 pr-1 font-mono text-xs text-content active:cursor-grabbing"
          >
            {conflicts.length > 0 && <span aria-hidden="true">⚠ </span>}
            {tag.short ?? tag.long}
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
        );
      })}
    </ul>
  );
}

/**
 * Chips + long/short input pair for one annotation list. Used for the
 * entry's grammatical categories and for each definition's notes; owns its
 * draft inputs, the parent only sees the committed, ordered list. When the
 * language's abbreviation list is provided, it powers the input
 * suggestions, the cross-prefill (an exactly matching form fills in its
 * counterpart) and the ⚠ conflict flag on chips.
 */
function AnnotationEditor({
  idPrefix,
  tags,
  onChange,
  addLabel,
  suggestions = [],
}: {
  idPrefix: string;
  tags: AnnotationTag[];
  onChange: (tags: AnnotationTag[]) => void;
  addLabel: string;
  /** The language's abbreviation pairs, most used first. */
  suggestions?: AbbreviationView[];
}) {
  const { t } = useTranslation();
  const [draftShort, setDraftShort] = useState("");
  const [draftLong, setDraftLong] = useState("");
  // Only the full form is required: a lone form is always the long one, so
  // nothing dangles on hover. The abbreviation is optional.
  const canAdd = draftLong.trim() !== "";

  function add() {
    if (!canAdd) return;
    const long = draftLong.trim();
    const short = draftShort.trim();
    onChange([...tags, { id: nextAnnotationId++, ...(short !== "" ? { short } : {}), long }]);
    setDraftShort("");
    setDraftLong("");
  }

  // Cross-prefill: a value exactly matching a known form fills the other
  // field, when it is still empty and the counterpart is unambiguous.
  function onLongInput(value: string) {
    setDraftLong(value);
    if (draftShort.trim() !== "") return;
    const shorts = [
      ...new Set(
        suggestions.flatMap((s) =>
          s.long === value.trim() && s.short !== undefined ? [s.short] : [],
        ),
      ),
    ];
    if (shorts.length === 1) setDraftShort(shorts[0]!);
  }

  function onShortInput(value: string) {
    setDraftShort(value);
    if (draftLong.trim() !== "") return;
    const longs = [
      ...new Set(suggestions.flatMap((s) => (s.short === value.trim() ? [s.long] : []))),
    ];
    if (longs.length === 1) setDraftLong(longs[0]!);
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
          conflictsFor={(tag) => annotationConflicts(tag, suggestions)}
        />
      )}
      {/* Full form first — it is the required half; the abbreviation besides
          it is optional. */}
      <div className="mt-2 flex items-center gap-2">
        <label className="sr-only" htmlFor={`${idPrefix}-long`}>
          {t("createEntry.annotationLongLabel")}
        </label>
        <input
          id={`${idPrefix}-long`}
          value={draftLong}
          onChange={(e) => onLongInput(e.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder={t("createEntry.annotationLongPlaceholder")}
          list={`${idPrefix}-long-options`}
          className="min-w-0 flex-1 rounded-lg border bg-surface px-3 py-2 text-sm text-content outline-none placeholder:text-content-subtle focus:ring-2"
        />
        <datalist id={`${idPrefix}-long-options`}>
          {[...new Set(suggestions.map((s) => s.long))].map((long) => (
            <option key={long} value={long} />
          ))}
        </datalist>
        <label className="sr-only" htmlFor={`${idPrefix}-short`}>
          {t("createEntry.annotationShortLabel")}
        </label>
        <input
          id={`${idPrefix}-short`}
          value={draftShort}
          onChange={(e) => onShortInput(e.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder={t("createEntry.annotationShortPlaceholder")}
          list={`${idPrefix}-short-options`}
          className="w-20 min-w-0 shrink-0 rounded-lg border bg-surface px-2 py-2 font-mono text-sm text-content outline-none placeholder:text-content-subtle focus:ring-2 sm:w-24"
        />
        <datalist id={`${idPrefix}-short-options`}>
          {[
            ...new Set(suggestions.flatMap((s) => (s.short !== undefined ? [s.short] : []))),
          ].map((short) => (
            <option key={short} value={short} />
          ))}
        </datalist>
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

/** Editor leaf payload: one definition's note chips and text. */
interface DefinitionDraft {
  notes: AnnotationTag[];
  text: string;
}

let nextNodeId = 0;
const mintNodeId = () => nextNodeId++;

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
  const [definitions, setDefinitions] = useState<EditNode<DefinitionDraft>[]>(() =>
    initial
      ? fromRecordDefinitions(
          initial.definitions,
          (d) => ({ notes: toAnnotationTags(d.notes), text: d.text }),
          mintNodeId,
        )
      : [{ kind: "leaf", id: mintNodeId(), payload: { notes: [], text: "" } }],
  );
  const [todoItems, setTodoItems] = useState<string[]>(initial?.todo ?? []);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The target language's abbreviation pairs — suggestions + conflict flags. */
  const [abbreviations, setAbbreviations] = useState<AbbreviationView[]>([]);

  const target = language ?? languages.find((l) => l.tag === pickedTag) ?? null;
  const targetTag = target?.tag ?? null;

  // The suggestions are an assist: failures stay silent and the editor
  // simply offers none.
  useEffect(() => {
    setAbbreviations([]);
    if (targetTag === null) return;
    let cancelled = false;
    fetchAbbreviations(targetTag)
      .then((list) => {
        if (!cancelled) setAbbreviations(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [targetTag]);

  function onPickLanguage(event: ChangeEvent<HTMLSelectElement>) {
    setPickedTag(event.target.value);
  }

  function setSpelling(index: number, value: string) {
    setSpellings((prev) => prev.map((s, i) => (i === index ? value : s)));
  }

  const cleanSpellings = spellings.map((s) => s.trim()).filter((s) => s !== "");
  const cleanTodo = todoItems.map((s) => s.trim()).filter((s) => s !== "");
  const cleanDefinitions = toRecordDefinitions(definitions, (payload) =>
    payload.text.trim() === ""
      ? null
      : {
          notes: payload.notes.map(toRecordAnnotation),
          text: payload.text.trim(),
        },
  );
  const canSubmit =
    !submitting && target !== null && cleanSpellings.length > 0 && cleanDefinitions.length > 0;

  async function onSubmit() {
    if (!canSubmit || !agent || !did || target === null) return;

    const record: LeksisEntryRecord = {
      $type: LEKSIS_ENTRY_COLLECTION,
      languageID: target.tag,
      orthography: cleanSpellings,
      categories: categories.map(toRecordAnnotation),
      definitions: cleanDefinitions,
      ...(subject !== undefined ? { subject } : {}),
      // An empty list clears the entry's needs-attention flag; `botSource`
      // is preserved so the content keeps its source traceability.
      ...(cleanTodo.length > 0 ? { todo: cleanTodo } : {}),
      ...(initial?.botSource !== undefined ? { botSource: initial.botSource } : {}),
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

  // Live numbering (1. / I. 2. / II. 1. a.) recomputed from the tree's depth,
  // so authors see the published numbering while they arrange definitions.
  const definitionLabels = editTreeLabels(definitions);
  const leafCount = collectLeaves(definitions).length;

  function moveButton(label: string, glyph: string, onClick: () => void) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        title={label}
        className="rounded border px-1.5 py-0.5 text-xs leading-none text-content-muted hover:bg-surface-muted hover:text-content"
      >
        {glyph}
      </button>
    );
  }

  function renderDefinitionNodes(nodes: EditNode<DefinitionDraft>[]): ReactNode {
    return nodes.map((node) => {
      if (node.kind === "group") {
        return (
          <div
            key={node.id}
            className="mt-3 rounded-lg border border-l-4 bg-surface-muted/20 p-2 pl-3 sm:pl-4"
          >
            <p className="font-mono text-xs text-content-subtle">{definitionLabels.get(node.id)}</p>
            {renderDefinitionNodes(node.children)}
          </div>
        );
      }
      return (
        <div key={node.id} className="mt-3 rounded-lg border bg-surface-muted/30 p-3">
          <div className="flex items-center gap-2">
            <span className="shrink-0 font-mono text-xs text-content-subtle">
              {definitionLabels.get(node.id)}
            </span>
            <div className="ml-auto flex shrink-0 items-center gap-1">
              {moveButton(t("createEntry.moveUp"), "↑", () =>
                setDefinitions((prev) => moveUp(prev, node.id)),
              )}
              {moveButton(t("createEntry.moveDown"), "↓", () =>
                setDefinitions((prev) => moveDown(prev, node.id)),
              )}
              {moveButton(t("createEntry.moveShallower"), "←", () =>
                setDefinitions((prev) => outdent(prev, node.id)),
              )}
              {moveButton(t("createEntry.moveDeeper"), "→", () =>
                setDefinitions((prev) => indent(prev, node.id, mintNodeId)),
              )}
              {leafCount > 1 && (
                <button
                  type="button"
                  onClick={() => setDefinitions((prev) => removeLeaf(prev, node.id))}
                  aria-label={t("createEntry.removeDefinition")}
                  title={t("createEntry.removeDefinition")}
                  className="rounded-lg px-1.5 py-0.5 text-base leading-none text-content-subtle hover:bg-surface-muted hover:text-content"
                >
                  ×
                </button>
              )}
            </div>
          </div>
          <label className="sr-only" htmlFor={`entry-definition-text-${node.id}`}>
            {t("createEntry.definitionTextLabel")}
          </label>
          <textarea
            id={`entry-definition-text-${node.id}`}
            value={node.payload.text}
            onChange={(e) =>
              setDefinitions((prev) =>
                updateLeaf(prev, node.id, (p) => ({ ...p, text: e.target.value })),
              )
            }
            placeholder={t("createEntry.definitionTextPlaceholder")}
            rows={2}
            className="mt-2 w-full min-w-0 rounded-lg border bg-surface px-3 py-2 text-sm text-content outline-none placeholder:text-content-subtle focus:ring-2"
          />
          <div className="mt-2">
            <p className="text-xs text-content-subtle">{t("createEntry.notesHelp")}</p>
            <AnnotationEditor
              idPrefix={`entry-definition-note-${node.id}`}
              tags={node.payload.notes}
              onChange={(notes) =>
                setDefinitions((prev) => updateLeaf(prev, node.id, (p) => ({ ...p, notes })))
              }
              addLabel={t("createEntry.addNote")}
              suggestions={abbreviations}
            />
          </div>
        </div>
      );
    });
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
              suggestions={abbreviations}
            />
          </fieldset>

          <fieldset className="mt-5">
            <legend className="text-sm font-medium text-content">
              {t("createEntry.definitionsLegend")}
            </legend>
            <p className="mt-1 text-xs text-content-subtle">
              {t("createEntry.definitionsHelp")}
            </p>
            {renderDefinitionNodes(definitions)}
            <button
              type="button"
              onClick={() =>
                setDefinitions((prev) => [
                  ...prev,
                  { kind: "leaf", id: mintNodeId(), payload: { notes: [], text: "" } },
                ])
              }
              className="mt-2 text-sm text-primary hover:text-primary-hover"
            >
              {t("createEntry.addDefinition")}
            </button>
          </fieldset>

          <fieldset className="mt-5">
            <legend className="text-sm font-medium text-content">
              {t("createEntry.todoLegend")}
            </legend>
            <p className="mt-1 text-xs text-content-subtle">{t("createEntry.todoHelp")}</p>
            {todoItems.map((item, i) => (
              <div key={i} className="mt-2 flex items-center gap-2">
                <label className="sr-only" htmlFor={`entry-todo-${i}`}>
                  {t("createEntry.todoItemLabel")}
                </label>
                <input
                  id={`entry-todo-${i}`}
                  value={item}
                  onChange={(e) =>
                    setTodoItems((prev) => prev.map((s, j) => (j === i ? e.target.value : s)))
                  }
                  placeholder={t("createEntry.todoItemPlaceholder")}
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={() => setTodoItems((prev) => prev.filter((_, j) => j !== i))}
                  aria-label={t("createEntry.removeTodoItem")}
                  title={t("createEntry.removeTodoItem")}
                  className="shrink-0 rounded-lg px-2 py-1 text-lg leading-none text-content-subtle hover:bg-surface-muted hover:text-content"
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setTodoItems((prev) => [...prev, ""])}
              className="mt-2 text-sm text-primary hover:text-primary-hover"
            >
              {t("createEntry.addTodoItem")}
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
