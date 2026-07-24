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
  type EntryInflectedForm,
  type EntryReference,
  type EntryView,
  type LanguageView,
  type LeksisEntryRecord,
} from "@leksis/types";
import { useSession } from "../auth/SessionProvider";
import { fetchAbbreviations, searchEntries } from "../lib/api";
import { DeleteEntryDialog } from "./DeleteEntryDialog";
import { EntryPreview } from "./EntryPreview";
import {
  checkRecordDefinitions,
  editTreeLabels,
  fromRecordDefinitions,
  indent,
  moveDown,
  moveUp,
  outdent,
  removeLeaf,
  toRecordDefinitions,
  updateGroup,
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

/**
 * Editor for the entry's other grammatical forms: each row is an
 * abbreviation (drawn from the same per-language pool as categories and
 * notes) plus the form's spelling. The abbreviation reuses the single-pair
 * AnnotationEditor; a row is only published when both its label and form are
 * filled in.
 */
function OtherFormsEditor({
  forms,
  onChange,
  suggestions,
}: {
  forms: OtherFormDraft[];
  onChange: (forms: OtherFormDraft[]) => void;
  suggestions: AbbreviationView[];
}) {
  const { t } = useTranslation();
  return (
    <>
      {forms.map((row) => (
        <div key={row.id} className="mt-2 rounded-lg border bg-surface-muted/30 p-2">
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor={`entry-otherform-${row.id}`}>
              {t("createEntry.otherFormLabel")}
            </label>
            <input
              id={`entry-otherform-${row.id}`}
              value={row.form}
              onChange={(e) =>
                onChange(forms.map((f) => (f.id === row.id ? { ...f, form: e.target.value } : f)))
              }
              placeholder={t("createEntry.otherFormPlaceholder")}
              className="min-w-0 flex-1 rounded-lg border bg-surface px-3 py-2 text-sm text-content outline-none placeholder:text-content-subtle focus:ring-2"
            />
            <button
              type="button"
              onClick={() => onChange(forms.filter((f) => f.id !== row.id))}
              aria-label={t("createEntry.removeOtherForm")}
              title={t("createEntry.removeOtherForm")}
              className="shrink-0 rounded-lg px-2 py-1 text-lg leading-none text-content-subtle hover:bg-surface-muted hover:text-content"
            >
              ×
            </button>
          </div>
          <AnnotationEditor
            idPrefix={`entry-otherform-annotation-${row.id}`}
            tags={row.annotation !== null ? [row.annotation] : []}
            // A form carries exactly one label: adding a new one replaces it.
            onChange={(tags) =>
              onChange(
                forms.map((f) =>
                  f.id === row.id ? { ...f, annotation: tags[tags.length - 1] ?? null } : f,
                ),
              )
            }
            addLabel={t("createEntry.addOtherFormLabel")}
            suggestions={suggestions}
          />
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...forms, { id: nextAnnotationId++, annotation: null, form: "" }])}
        className="mt-2 text-sm text-primary hover:text-primary-hover"
      >
        {t("createEntry.addOtherForm")}
      </button>
    </>
  );
}

/** Editor for the entry's bibliographic references: display text + optional URL. */
function ReferencesEditor({
  references,
  onChange,
}: {
  references: EntryReference[];
  onChange: (references: EntryReference[]) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {references.map((ref, i) => (
        <div key={i} className="mt-2 rounded-lg border bg-surface-muted/30 p-2">
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor={`entry-reference-text-${i}`}>
              {t("createEntry.referenceTextLabel")}
            </label>
            <input
              id={`entry-reference-text-${i}`}
              value={ref.text}
              onChange={(e) =>
                onChange(references.map((r, j) => (j === i ? { ...r, text: e.target.value } : r)))
              }
              placeholder={t("createEntry.referenceTextPlaceholder")}
              className="min-w-0 flex-1 rounded-lg border bg-surface px-3 py-2 text-sm text-content outline-none placeholder:text-content-subtle focus:ring-2"
            />
            <button
              type="button"
              onClick={() => onChange(references.filter((_, j) => j !== i))}
              aria-label={t("createEntry.removeReference")}
              title={t("createEntry.removeReference")}
              className="shrink-0 rounded-lg px-2 py-1 text-lg leading-none text-content-subtle hover:bg-surface-muted hover:text-content"
            >
              ×
            </button>
          </div>
          <label className="sr-only" htmlFor={`entry-reference-url-${i}`}>
            {t("createEntry.referenceUrlLabel")}
          </label>
          <input
            id={`entry-reference-url-${i}`}
            value={ref.url ?? ""}
            onChange={(e) =>
              onChange(references.map((r, j) => (j === i ? { ...r, url: e.target.value } : r)))
            }
            placeholder={t("createEntry.referenceUrlPlaceholder")}
            className="mt-2 w-full min-w-0 rounded-lg border bg-surface px-3 py-2 text-sm text-content outline-none placeholder:text-content-subtle focus:ring-2"
          />
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...references, { text: "" }])}
        className="mt-2 text-sm text-primary hover:text-primary-hover"
      >
        {t("createEntry.addReference")}
      </button>
    </>
  );
}

/**
 * Non-blocking heads-up shown while creating a brand-new entry: existing
 * current entries in the target language that already use one of the
 * spellings being typed. Each can be expanded into a full inline preview
 * (via the shared EntryPreview) so an editor can tell a homonym from an
 * accidental duplicate without leaving the dialog.
 */
function DuplicateWarning({ duplicates }: { duplicates: EntryView[] }) {
  const { t } = useTranslation();
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  return (
    <div className="mt-3 rounded-lg border border-amber-400 bg-amber-400/10 p-3">
      <p className="text-sm text-content">
        {t("createEntry.duplicateWarning", { count: duplicates.length })}
      </p>
      <ul className="mt-2 space-y-2">
        {duplicates.map((duplicate) => (
          <li key={duplicate.key}>
            <button
              type="button"
              onClick={() =>
                setExpandedKey((prev) => (prev === duplicate.key ? null : duplicate.key))
              }
              className="rounded-full border bg-surface px-2.5 py-1 text-xs text-content hover:border-primary hover:text-primary"
            >
              {duplicate.orthography[0]}{" "}
              <span className="font-mono text-content-subtle">{duplicate.key}</span>{" "}
              {expandedKey === duplicate.key
                ? t("createEntry.hidePreview")
                : t("createEntry.showPreview")}
            </button>
            {expandedKey === duplicate.key && (
              <div className="mt-2">
                <EntryPreview entry={duplicate} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A minimal editable list of free-text strings (one input per item, add and
 * remove). Used for a node's plain notes and for the entry-level notes.
 */
function StringList({
  items,
  onChange,
  idPrefix,
  itemLabel,
  placeholder,
  addLabel,
  removeLabel,
  rows,
}: {
  items: string[];
  onChange: (items: string[]) => void;
  idPrefix: string;
  itemLabel: string;
  placeholder: string;
  addLabel: string;
  removeLabel: string;
  rows?: number;
}) {
  return (
    <>
      {items.map((item, i) => (
        <div key={i} className="mt-2 flex items-start gap-2">
          <label className="sr-only" htmlFor={`${idPrefix}-${i}`}>
            {itemLabel}
          </label>
          {rows !== undefined ? (
            <textarea
              id={`${idPrefix}-${i}`}
              value={item}
              onChange={(e) => onChange(items.map((s, j) => (j === i ? e.target.value : s)))}
              placeholder={placeholder}
              rows={rows}
              className="min-w-0 flex-1 rounded-lg border bg-surface px-3 py-2 text-sm text-content outline-none placeholder:text-content-subtle focus:ring-2"
            />
          ) : (
            <input
              id={`${idPrefix}-${i}`}
              value={item}
              onChange={(e) => onChange(items.map((s, j) => (j === i ? e.target.value : s)))}
              placeholder={placeholder}
              className="min-w-0 flex-1 rounded-lg border bg-surface px-3 py-2 text-sm text-content outline-none placeholder:text-content-subtle focus:ring-2"
            />
          )}
          <button
            type="button"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            aria-label={removeLabel}
            title={removeLabel}
            className="shrink-0 rounded-lg px-2 py-1 text-lg leading-none text-content-subtle hover:bg-surface-muted hover:text-content"
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...items, ""])}
        className="mt-2 text-sm text-primary hover:text-primary-hover"
      >
        {addLabel}
      </button>
    </>
  );
}

/** Editor leaf payload: one definition's note chips, plain notes and text. */
interface DefinitionDraft {
  notes: AnnotationTag[];
  plainNotes: string[];
  text: string;
}

/** Editor group-node payload: a heading's note chips and plain notes (no text). */
interface GroupDraft {
  notes: AnnotationTag[];
  plainNotes: string[];
}

/** Editor row for one other grammatical form: an abbreviation + the spelling. */
interface OtherFormDraft {
  id: number;
  annotation: AnnotationTag | null;
  form: string;
}

let nextNodeId = 0;
const mintNodeId = () => nextNodeId++;
const emptyGroupDraft = (): GroupDraft => ({ notes: [], plainNotes: [] });

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
  /**
   * The version being modified, as indexed — required to offer the "delete
   * this entry" action (it needs the entry's key and language, not just its
   * record URI). Absent when creating a brand-new entry, where deletion
   * makes no sense yet.
   */
  entryView?: EntryView;
  onClose: () => void;
  /** Called with the new record's AT URI after it was written to the PDS. */
  onCreated: (recordURI: string) => void;
  /** Called with the deletion record's AT URI after it was written to the PDS. */
  onDeleted?: (recordURI: string) => void;
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
  entryView,
  onClose,
  onCreated,
  onDeleted,
}: EntryEditorDialogProps) {
  const { t } = useTranslation();
  const { agent, did } = useSession();
  const [deleting, setDeleting] = useState(false);

  const [pickedTag, setPickedTag] = useState(language?.tag ?? initial?.languageID ?? "");
  const [spellings, setSpellings] = useState<string[]>(initial?.orthography ?? [word]);
  const [transcription, setTranscription] = useState(initial?.transcription ?? "");
  const [categories, setCategories] = useState<AnnotationTag[]>(() =>
    toAnnotationTags(initial?.categories ?? []),
  );
  const [otherForms, setOtherForms] = useState<OtherFormDraft[]>(() =>
    (initial?.otherForms ?? []).map((f) => ({
      id: nextAnnotationId++,
      annotation: { ...f.annotation, id: nextAnnotationId++ },
      form: f.form,
    })),
  );
  const [definitions, setDefinitions] = useState<EditNode<DefinitionDraft, GroupDraft>[]>(() =>
    initial
      ? fromRecordDefinitions(
          initial.definitions,
          (d) => ({ notes: toAnnotationTags(d.notes), plainNotes: d.plainNotes ?? [], text: d.text ?? "" }),
          (d) => ({ notes: toAnnotationTags(d.notes), plainNotes: d.plainNotes ?? [] }),
          emptyGroupDraft,
          mintNodeId,
        )
      : [{ kind: "leaf", id: mintNodeId(), payload: { notes: [], plainNotes: [], text: "" } }],
  );
  const [entryNotes, setEntryNotes] = useState<string[]>(initial?.notes ?? []);
  const [references, setReferences] = useState<EntryReference[]>(initial?.references ?? []);
  const [todoItems, setTodoItems] = useState<string[]>(initial?.todo ?? []);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The target language's abbreviation pairs — suggestions + conflict flags. */
  const [abbreviations, setAbbreviations] = useState<AbbreviationView[]>([]);
  /** Current entries in the target language sharing a spelling with a fresh entry, for the duplicate warning. */
  const [duplicates, setDuplicates] = useState<EntryView[]>([]);

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
  // Only meaningful when creating a brand-new entry: a modification's
  // spellings naturally match its own current version.
  const spellingsKey = cleanSpellings.map((s) => s.toLowerCase()).join("\n");

  // Warn about existing entries sharing a spelling in the target language —
  // never blocking, just a heads-up so editors can spot accidental
  // duplicates before publishing a new homonym.
  useEffect(() => {
    setDuplicates([]);
    if (subject !== undefined || targetTag === null || spellingsKey === "") return;
    let cancelled = false;
    const forms = [...new Set(spellingsKey.split("\n"))];
    Promise.all(forms.map((form) => searchEntries(form, targetTag)))
      .then((results) => {
        if (cancelled) return;
        const found = new Map<string, EntryView>();
        for (const candidate of results.flat()) {
          if (candidate.orthography.some((o) => forms.includes(o.toLowerCase()))) {
            found.set(candidate.key, candidate);
          }
        }
        setDuplicates([...found.values()]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [subject, targetTag, spellingsKey]);

  const cleanTodo = todoItems.map((s) => s.trim()).filter((s) => s !== "");
  const cleanNotes = entryNotes.map((s) => s.trim()).filter((s) => s !== "");
  const cleanReferences: EntryReference[] = references
    .map((r) => ({ text: r.text.trim(), ...(r.url && r.url.trim() !== "" ? { url: r.url.trim() } : {}) }))
    .filter((r) => r.text !== "");
  const cleanOtherForms: EntryInflectedForm[] = otherForms
    .filter((f) => f.annotation !== null && f.form.trim() !== "")
    .map((f) => ({ annotation: toRecordAnnotation(f.annotation!), form: f.form.trim() }));
  const cleanPlainNotes = (notes: string[]) => notes.map((s) => s.trim()).filter((s) => s !== "");
  // Serialize the editor tree to record definitions under the tree place
  // convention: leaves become definitions with text, annotated group nodes
  // become group items (notes only), bare groups stay implicit.
  const cleanDefinitions = toRecordDefinitions(
    definitions,
    (payload) =>
      payload.text.trim() === ""
        ? null
        : {
            notes: payload.notes.map(toRecordAnnotation),
            ...(cleanPlainNotes(payload.plainNotes).length > 0
              ? { plainNotes: cleanPlainNotes(payload.plainNotes) }
              : {}),
            text: payload.text.trim(),
          },
    (group) => {
      const notes = group.notes.map(toRecordAnnotation);
      const plainNotes = cleanPlainNotes(group.plainNotes);
      // A group is only worth an explicit record item when it carries content.
      return notes.length === 0 && plainNotes.length === 0
        ? null
        : { notes, ...(plainNotes.length > 0 ? { plainNotes } : {}) };
    },
  );
  // Last guard before writing: the tree must serialize to a strictly valid
  // definitions list. A failure blocks submit rather than publishing a
  // malformed record.
  const definitionsError =
    cleanDefinitions.length === 0 ? "empty" : checkRecordDefinitions(cleanDefinitions);
  const canSubmit =
    !submitting && target !== null && cleanSpellings.length > 0 && definitionsError === "ok";

  async function onSubmit() {
    if (!canSubmit || !agent || !did || target === null) return;

    const record: LeksisEntryRecord = {
      $type: LEKSIS_ENTRY_COLLECTION,
      languageID: target.tag,
      orthography: cleanSpellings,
      ...(transcription.trim() !== "" ? { transcription: transcription.trim() } : {}),
      categories: categories.map(toRecordAnnotation),
      ...(cleanOtherForms.length > 0 ? { otherForms: cleanOtherForms } : {}),
      definitions: cleanDefinitions,
      ...(cleanNotes.length > 0 ? { notes: cleanNotes } : {}),
      ...(cleanReferences.length > 0 ? { references: cleanReferences } : {}),
      ...(subject !== undefined ? { subject } : {}),
      // An empty list clears the entry's needs-attention flag.
      ...(cleanTodo.length > 0 ? { todo: cleanTodo } : {}),
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

  // Which nodes have their (optional) abbreviation field revealed. It is
  // hidden by default — most definitions carry none — and opened by the
  // "+ add an abbreviation" action or automatically when the node already has
  // abbreviations (e.g. when proposing changes to an existing entry).
  const [abbrevOpen, setAbbrevOpen] = useState<Set<number>>(new Set());
  const revealAbbrev = (id: number) =>
    setAbbrevOpen((prev) => new Set(prev).add(id));

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

  // Movement controls for a definition proper (a leaf). Groups have none —
  // they emerge and vanish implicitly as their definitions are nested, so a
  // heading is never moved on its own; ↑ ↓ walk a definition through the
  // sequence (crossing group edges), ← → change its nesting depth.
  function leafControls(id: number) {
    return (
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {moveButton(t("createEntry.moveUp"), "↑", () =>
          setDefinitions((prev) => moveUp(prev, id)),
        )}
        {moveButton(t("createEntry.moveDown"), "↓", () =>
          setDefinitions((prev) => moveDown(prev, id)),
        )}
        {moveButton(t("createEntry.moveShallower"), "←", () =>
          setDefinitions((prev) => outdent(prev, id)),
        )}
        {moveButton(t("createEntry.moveDeeper"), "→", () =>
          setDefinitions((prev) => indent(prev, id, mintNodeId, emptyGroupDraft)),
        )}
        {leafCount > 1 && (
          <button
            type="button"
            onClick={() => setDefinitions((prev) => removeLeaf(prev, id))}
            aria-label={t("createEntry.removeDefinition")}
            title={t("createEntry.removeDefinition")}
            className="rounded-lg px-1.5 py-0.5 text-base leading-none text-content-subtle hover:bg-surface-muted hover:text-content"
          >
            ×
          </button>
        )}
      </div>
    );
  }

  // Shared notes area for a node: the free-text notes list, plus an OPTIONAL
  // abbreviation editor that stays hidden behind a "+ add an abbreviation"
  // action until it is opened (or the node already carries abbreviations).
  function nodeNotes(
    idPrefix: string,
    notes: AnnotationTag[],
    plainNotes: string[],
    setNotes: (notes: AnnotationTag[]) => void,
    setPlainNotes: (plainNotes: string[]) => void,
    revealKey: number,
  ) {
    const showAbbrev = notes.length > 0 || abbrevOpen.has(revealKey);
    return (
      <div className="mt-2">
        <StringList
          items={plainNotes}
          onChange={setPlainNotes}
          idPrefix={`${idPrefix}-plainnote`}
          itemLabel={t("createEntry.plainNoteLabel")}
          placeholder={t("createEntry.plainNotePlaceholder")}
          addLabel={t("createEntry.addPlainNote")}
          removeLabel={t("createEntry.removePlainNote")}
        />
        {showAbbrev ? (
          <div className="mt-2">
            <p className="text-xs text-content-subtle">{t("createEntry.notesHelp")}</p>
            <AnnotationEditor
              idPrefix={`${idPrefix}-note`}
              tags={notes}
              onChange={setNotes}
              addLabel={t("createEntry.addNote")}
              suggestions={abbreviations}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => revealAbbrev(revealKey)}
            className="mt-1 text-sm text-primary hover:text-primary-hover"
          >
            {t("createEntry.addAbbreviation")}
          </button>
        )}
      </div>
    );
  }

  function renderDefinitionNodes(nodes: EditNode<DefinitionDraft, GroupDraft>[]): ReactNode {
    return nodes.map((node) => {
      if (node.kind === "group") {
        // A group node is a HEADING over the definitions nested under it: it
        // carries notes but no text, and has no move arrows of its own — it
        // appears and disappears as its definitions are nested. Styled as a
        // heading band, visually distinct from a definition card.
        return (
          <div
            key={node.id}
            className="mt-3 rounded-lg border border-dashed border-l-4 border-l-primary/60 bg-surface-muted/10 p-2 pl-3 sm:pl-4"
          >
            <div className="flex items-baseline gap-2">
              <span className="shrink-0 font-mono text-sm font-semibold text-content">
                {definitionLabels.get(node.id)}
              </span>
              <span className="text-xs uppercase tracking-wide text-content-subtle">
                {t("createEntry.groupBadge")}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-content-subtle">{t("createEntry.groupNotesHelp")}</p>
            {nodeNotes(
              `entry-group-${node.id}`,
              node.group.notes,
              node.group.plainNotes,
              (notes) => setDefinitions((prev) => updateGroup(prev, node.id, (g) => ({ ...g, notes }))),
              (plainNotes) =>
                setDefinitions((prev) => updateGroup(prev, node.id, (g) => ({ ...g, plainNotes }))),
              node.id,
            )}
            {renderDefinitionNodes(node.children)}
          </div>
        );
      }
      return (
        <div key={node.id} className="mt-3 rounded-lg border bg-surface-muted/40 p-3 shadow-sm">
          <div className="flex items-center gap-2">
            <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 font-mono text-xs font-semibold text-primary">
              {definitionLabels.get(node.id)}
            </span>
            {leafControls(node.id)}
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
          {nodeNotes(
            `entry-definition-${node.id}`,
            node.payload.notes,
            node.payload.plainNotes,
            (notes) => setDefinitions((prev) => updateLeaf(prev, node.id, (p) => ({ ...p, notes }))),
            (plainNotes) =>
              setDefinitions((prev) => updateLeaf(prev, node.id, (p) => ({ ...p, plainNotes }))),
            node.id,
          )}
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

          {duplicates.length > 0 && <DuplicateWarning duplicates={duplicates} />}

          <fieldset className="mt-5">
            <legend className="text-sm font-medium text-content">
              {t("createEntry.transcriptionLegend")}
            </legend>
            <p className="mt-1 text-xs text-content-subtle">
              {t("createEntry.transcriptionHelp")}
            </p>
            <label className="sr-only" htmlFor="entry-transcription">
              {t("createEntry.transcriptionLegend")}
            </label>
            <input
              id="entry-transcription"
              value={transcription}
              onChange={(e) => setTranscription(e.target.value)}
              placeholder={t("createEntry.transcriptionPlaceholder")}
              className={`mt-2 ${inputClass}`}
            />
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
              {t("createEntry.otherFormsLegend")}
            </legend>
            <p className="mt-1 text-xs text-content-subtle">{t("createEntry.otherFormsHelp")}</p>
            <OtherFormsEditor
              forms={otherForms}
              onChange={setOtherForms}
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
                  { kind: "leaf", id: mintNodeId(), payload: { notes: [], plainNotes: [], text: "" } },
                ])
              }
              className="mt-2 text-sm text-primary hover:text-primary-hover"
            >
              {t("createEntry.addDefinition")}
            </button>
            {definitionsError !== "ok" && definitionsError !== "empty" && (
              <p className="mt-2 text-xs text-red-600">{t("createEntry.definitionsInvalid")}</p>
            )}
          </fieldset>

          <fieldset className="mt-5">
            <legend className="text-sm font-medium text-content">
              {t("createEntry.notesLegend")}
            </legend>
            <p className="mt-1 text-xs text-content-subtle">{t("createEntry.notesLegendHelp")}</p>
            <StringList
              items={entryNotes}
              onChange={setEntryNotes}
              idPrefix="entry-note"
              itemLabel={t("createEntry.entryNoteLabel")}
              placeholder={t("createEntry.entryNotePlaceholder")}
              addLabel={t("createEntry.addEntryNote")}
              removeLabel={t("createEntry.removeEntryNote")}
              rows={2}
            />
          </fieldset>

          <fieldset className="mt-5">
            <legend className="text-sm font-medium text-content">
              {t("createEntry.referencesLegend")}
            </legend>
            <p className="mt-1 text-xs text-content-subtle">{t("createEntry.referencesHelp")}</p>
            <ReferencesEditor references={references} onChange={setReferences} />
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
            <div className="flex items-center gap-3 sm:mr-auto">
              {entryView && onDeleted && (
                <button
                  type="button"
                  onClick={() => setDeleting(true)}
                  className="text-sm text-red-600 hover:text-red-700"
                >
                  {t("entry.deleteAction")}
                </button>
              )}
            </div>
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

      {deleting && entryView && onDeleted && initial && (
        <DeleteEntryDialog
          view={entryView}
          record={initial}
          onClose={() => setDeleting(false)}
          onDeleted={onDeleted}
        />
      )}
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
