import { useEffect, useState, type ChangeEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  formAxes,
  categoryRefinements,
  categoryRoots,
  LEKSIS_ENTRY_COLLECTION,
  type FormAxis,
  type GrammarValue,
  type LabelView,
  type Grammar,
  isValidGrammar,
  labelLookup,
  MAX_DEFINITION_EXAMPLES,
  migrateGrammar,
  normalizeOclc,
  parseTagInput,
  tagKey,
  type Tag,
  type EntryExample,
  type EntryInflectedForm,
  type EntryReference,
  type EntryView,
  type LanguageView,
  type LeksisEntryRecord,
  type SourceView,
} from "@leksis/types";
import { useSession } from "../auth/SessionProvider";
import {
  fetchLabels,
  fetchCurrentLanguageRecord,
  searchEntries,
  searchSources,
} from "../lib/api";
import { fetchLanguageRecord } from "../lib/atproto-record";
import { DeleteEntryDialog } from "./DeleteEntryDialog";
import { EntryPreview, TagChips } from "./EntryPreview";
import { useSourceCitation } from "./ExampleSentences";
import { SourceEditorDialog } from "./SourceEditorDialog";
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

let nextAnnotationId = 0;

/** How long typing settles before an example's source search is sent. */
const SOURCE_SEARCH_DEBOUNCE_MS = 300;

/**
 * Which form this is: one value picked per feature the language has bound,
 * assembled into a single tag — the form's address in the paradigm ("gen. pl."
 * is one bundle carrying Case=Gen and Number=Plur).
 *
 * The axes are **orthogonal dimensions, not a narrowing tree**: unlike the
 * features that identify a category, where each choice conditions what is
 * offered next, a cell address takes one value from each feature
 * independently. So this offers a selector per feature rather than reusing the
 * category editor's walk.
 *
 * What it offers is **every bound grammatical feature of the language**, not a
 * subset chosen from the entry's own categories. Since ADR-0020 a language no
 * longer declares what a category's forms vary over — the paradigm's tables
 * say which cells exist — and the honest fallback beside them is a superset: a
 * manual path that withheld a coordinate would be worse than one that offers a
 * coordinate nobody uses. (The rule it replaces would have hidden `Number` from
 * an *anv-kadarn stroll*, whose headword is identified by it and whose other
 * form is the singulative.)
 *
 * With nothing bound at all it degrades to the flat picker of bound tags plus
 * manual entry — the same documented degradation the category editor has, and
 * what keeps a form labellable in a language whose grammar nobody has declared.
 */
function FormTagEditor({
  tag,
  onChange,
  axes,
  labels,
}: {
  tag: Tag | null;
  onChange: (tag: Tag | null) => void;
  axes: FormAxis[];
  labels: LabelView[];
}) {
  const { t } = useTranslation();
  const [manual, setManual] = useState("");
  const lookup = labelLookup(labels);
  const parsed = parseTagInput(manual);
  const feats = tag?.feats ?? [];

  /** Set or clear one axis's value, leaving the other axes alone. */
  function pick(feature: string, value: GrammarValue | null) {
    const rest = feats.filter((f) => f.feature !== feature);
    const next =
      value === null
        ? rest
        : [
            ...rest,
            {
              feature: value.feature,
              value: value.value,
              ...(value.scheme !== undefined ? { scheme: value.scheme } : {}),
            },
          ];
    onChange(
      next.length === 0 && tag?.upos === undefined
        ? null
        : {
            ...(tag?.upos !== undefined ? { upos: tag.upos } : {}),
            ...(next.length > 0 ? { feats: next } : {}),
          },
    );
  }

  const bound = labels.filter((a) => a.tag !== undefined && a.long !== undefined);

  return (
    <div className="mt-2">
      {tag !== null && (
        <div className="flex flex-wrap items-center gap-1.5">
          <ul className="flex flex-wrap items-center gap-1">
            <TagChips tags={[tag]} lookup={lookup} />
          </ul>
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label={t("createEntry.formTagClear")}
            title={t("createEntry.formTagClear")}
            className="text-content-subtle hover:text-danger"
          >
            ×
          </button>
        </div>
      )}

      {axes.length > 0
        ? axes.map((axis) => {
            const current = feats.find((f) => f.feature === axis.feature.feature);
            return (
              <div key={axis.feature.feature} className="mt-2">
                <p className="text-xs text-content-subtle">{axis.feature.label.long}</p>
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {axis.values.map((value) => {
                    const active = current?.value === value.value;
                    return (
                      <li key={value.value}>
                        <button
                          type="button"
                          onClick={() => pick(axis.feature.feature, active ? null : value)}
                          title={value.label.long}
                          className={
                            active
                              ? "rounded-full border border-primary bg-surface px-2.5 py-1 font-mono text-xs font-medium text-primary"
                              : "rounded-full border border-dashed px-2.5 py-1 font-mono text-xs text-content-muted hover:border-primary hover:text-primary"
                          }
                        >
                          {value.label.short ?? value.label.long}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })
        : bound.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {bound.map((option, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => onChange(option.tag!)}
                    title={option.long}
                    className="rounded-full border border-dashed px-2.5 py-1 font-mono text-xs text-content-muted hover:border-primary hover:text-primary"
                  >
                    + {option.short ?? option.long}
                  </button>
                </li>
              ))}
            </ul>
          )}

      <div className="mt-2 flex gap-2">
        <input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          aria-label={t("createEntry.formTagManualLabel")}
          placeholder={t("createEntry.categoryManualPlaceholder")}
          className="w-full min-w-0 rounded-lg border bg-surface px-3 py-2 text-sm text-content outline-none placeholder:text-content-subtle focus:ring-2"
        />
        <button
          type="button"
          disabled={parsed === null}
          onClick={() => {
            if (parsed === null) return;
            onChange(parsed);
            setManual("");
          }}
          className="shrink-0 rounded-lg border px-3 py-2 text-sm text-content hover:border-primary disabled:opacity-50"
        >
          {t("createEntry.formTagSet")}
        </button>
      </div>
    </div>
  );
}

/**
 * Editor for the entry's other grammatical forms: each row is the tag saying
 * which form it is, plus the form's spelling. A row is only published when
 * both are filled in.
 */
function OtherFormsEditor({
  forms,
  onChange,
  axes,
  labels,
}: {
  forms: OtherFormDraft[];
  onChange: (forms: OtherFormDraft[]) => void;
  axes: FormAxis[];
  labels: LabelView[];
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
          <FormTagEditor
            tag={row.tag}
            onChange={(tag) => onChange(forms.map((f) => (f.id === row.id ? { ...f, tag } : f)))}
            axes={axes}
            labels={labels}
          />
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...forms, { id: nextAnnotationId++, tag: null, form: "" }])}
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
    <div className="mt-3 rounded-lg border border-warning bg-warning/10 p-3">
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

/**
 * Editor row for one example sentence. The record's nested `{text, source:
 * {oclc, locator}}` is flattened for editing — a row is either sourced or not,
 * and a half-typed number should not have to conjure an object to live in.
 * `toRecordDefinitions` puts it back.
 */
interface ExampleDraft {
  id: number;
  text: string;
  /** Normalized OCLC number; "" = an unsourced example. */
  oclc: string;
  locator: string;
}

/** Editor leaf payload: one definition's notes, text and example sentences. */
interface DefinitionDraft {
  notes: string[];
  text: string;
  examples: ExampleDraft[];
}

/** Editor group-node payload: a heading's notes (no text). */
interface GroupDraft {
  notes: string[];
}

/** Editor row for one other grammatical form: which form it is + the spelling. */
interface OtherFormDraft {
  id: number;
  tag: Tag | null;
  form: string;
}

let nextNodeId = 0;
const mintNodeId = () => nextNodeId++;
const emptyGroupDraft = (): GroupDraft => ({ notes: [] });
const emptyLeafDraft = (): DefinitionDraft => ({ notes: [], text: "", examples: [] });

/**
 * The work a picked example cites, named the way the reader will see it: the
 * source's own short citation form, resolved from its record. A number nobody
 * has described yet keeps showing as the number — the citation is valid either
 * way, and pretending otherwise in the editor would hide from the author
 * exactly what a reader is going to see.
 */
function PickedSource({
  oclc,
  justPublished,
}: {
  oclc: string;
  /**
   * This contributor described the work a moment ago. Until the firehose has
   * been round, the AppView still answers "nobody has described it" — which is
   * true of the index and false of the world, so it is not what this editor
   * says back to the person who just wrote the record.
   */
  justPublished: boolean;
}) {
  const { t } = useTranslation();
  const state = useSourceCitation(oclc);
  return (
    <span className="min-w-0 flex-1 text-sm text-content">
      {state.status === "resolved" ? (
        <abbr title={state.citation.long} className="no-underline">
          {state.citation.short}
        </abbr>
      ) : (
        <span className="font-mono text-xs">
          {t("examples.oclcLabel")} {oclc}
        </span>
      )}
      {state.status === "undescribed" && (
        <span className="ml-2 text-xs text-warning">
          {justPublished
            ? t("createEntry.exampleSourceIndexing")
            : t("createEntry.exampleSourceUndescribed")}
        </span>
      )}
    </span>
  );
}

/**
 * One example sentence: the sentence itself, and — optionally — which work it
 * came from and where in it.
 *
 * Three ways in to the same field, because a contributor arrives at a source
 * from three different places: **search** the works already described (scoped
 * to the entry's language, since that is what a source's `languages` list is
 * for), **type the OCLC number** of a work nobody has described yet, or
 * **describe the work** then and there. The middle one is the one the design
 * insists on: a citation to an undescribed number is valid, and refusing it
 * would force a contributor to write a bibliography before they may quote a
 * sentence.
 */
function ExampleRow({
  row,
  onChange,
  onRemove,
  languageTag,
  languages,
  idPrefix,
}: {
  row: ExampleDraft;
  onChange: (row: ExampleDraft) => void;
  onRemove: () => void;
  /** The entry's language: sources are searched among those declaring it. */
  languageTag: string | null;
  languages: LanguageView[];
  idPrefix: string;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SourceView[]>([]);
  const [searching, setSearching] = useState(false);
  const [numberInput, setNumberInput] = useState("");
  const [describing, setDescribing] = useState(false);
  /** A number this contributor described from here, not yet indexed. */
  const [justPublished, setJustPublished] = useState<string | null>(null);

  // Search-as-you-type. An assist like every other lookup here: a failure
  // leaves the list empty and both other paths in.
  useEffect(() => {
    const q = query.trim();
    if (q === "") {
      setResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      searchSources(q, languageTag ?? "")
        .then((found) => {
          if (cancelled) return;
          setResults(found);
          setSearching(false);
        })
        .catch(() => {
          if (cancelled) return;
          setResults([]);
          setSearching(false);
        });
    }, SOURCE_SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, languageTag]);

  function pick(oclc: string) {
    onChange({ ...row, oclc });
    setQuery("");
    setResults([]);
    setNumberInput("");
  }

  // Fail-closed, like every other reading of a number here: what will not
  // normalize is refused rather than guessed at, because a wrong number would
  // silently attach the sentence to somebody else's book.
  const typedNumber = normalizeOclc(numberInput);

  return (
    <div className="mt-2 rounded-lg border bg-surface-muted/30 p-2">
      <div className="flex items-start gap-2">
        <label className="sr-only" htmlFor={`${idPrefix}-text`}>
          {t("createEntry.exampleTextLabel")}
        </label>
        <textarea
          id={`${idPrefix}-text`}
          value={row.text}
          onChange={(e) => onChange({ ...row, text: e.target.value })}
          placeholder={t("createEntry.exampleTextPlaceholder")}
          rows={2}
          className="min-w-0 flex-1 rounded-lg border bg-surface px-3 py-2 text-sm text-content outline-none placeholder:text-content-subtle focus:ring-2"
        />
        <button
          type="button"
          onClick={onRemove}
          aria-label={t("createEntry.removeExample")}
          title={t("createEntry.removeExample")}
          className="shrink-0 rounded-lg px-2 py-1 text-lg leading-none text-content-subtle hover:bg-surface-muted hover:text-content"
        >
          ×
        </button>
      </div>

      {row.oclc !== "" ? (
        <>
          <div className="mt-2 flex items-center gap-2">
            <PickedSource oclc={row.oclc} justPublished={justPublished === row.oclc} />
            <button
              type="button"
              onClick={() => onChange({ ...row, oclc: "", locator: "" })}
              aria-label={t("createEntry.exampleSourceClear")}
              title={t("createEntry.exampleSourceClear")}
              className="shrink-0 text-content-subtle hover:text-danger"
            >
              ×
            </button>
          </div>
          <label className="sr-only" htmlFor={`${idPrefix}-locator`}>
            {t("createEntry.exampleLocatorLabel")}
          </label>
          <input
            id={`${idPrefix}-locator`}
            value={row.locator}
            onChange={(e) => onChange({ ...row, locator: e.target.value })}
            placeholder={t("createEntry.exampleLocatorPlaceholder")}
            className="mt-2 w-full min-w-0 rounded-lg border bg-surface px-3 py-2 text-sm text-content outline-none placeholder:text-content-subtle focus:ring-2"
          />
        </>
      ) : (
        <div className="mt-2">
          <label className="sr-only" htmlFor={`${idPrefix}-source-search`}>
            {t("createEntry.exampleSourceSearchLabel")}
          </label>
          <input
            id={`${idPrefix}-source-search`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("createEntry.exampleSourceSearchPlaceholder")}
            className="w-full min-w-0 rounded-lg border bg-surface px-3 py-2 text-sm text-content outline-none placeholder:text-content-subtle focus:ring-2"
          />
          {searching && (
            <p className="mt-1 text-xs text-content-subtle">
              {t("createEntry.exampleSourceSearching")}
            </p>
          )}
          {!searching && query.trim() !== "" && results.length === 0 && (
            <p className="mt-1 text-xs text-content-subtle">
              {t("createEntry.exampleSourceNoResults")}
            </p>
          )}
          {results.length > 0 && (
            <ul className="mt-1 space-y-1">
              {results.map((source) => (
                <li key={source.oclc}>
                  <button
                    type="button"
                    onClick={() => pick(source.oclc)}
                    className="w-full rounded-lg border bg-surface px-3 py-2 text-left hover:border-primary hover:bg-surface-muted/60"
                  >
                    <span className="block text-sm text-content">{source.citation.short}</span>
                    <span className="block text-xs text-content-muted">
                      {source.citation.long}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-2 flex gap-2">
            <label className="sr-only" htmlFor={`${idPrefix}-source-oclc`}>
              {t("createEntry.exampleOclcLabel")}
            </label>
            <input
              id={`${idPrefix}-source-oclc`}
              value={numberInput}
              onChange={(e) => setNumberInput(e.target.value)}
              placeholder={t("createEntry.exampleOclcPlaceholder")}
              autoCapitalize="none"
              autoCorrect="off"
              className="w-full min-w-0 rounded-lg border bg-surface px-3 py-2 font-mono text-sm text-content outline-none placeholder:text-content-subtle focus:ring-2"
            />
            <button
              type="button"
              disabled={typedNumber === null}
              onClick={() => {
                if (typedNumber !== null) pick(typedNumber);
              }}
              className="shrink-0 rounded-lg border px-3 py-2 text-sm text-content hover:border-primary disabled:opacity-50"
            >
              {t("createEntry.exampleOclcUse")}
            </button>
          </div>
          {numberInput.trim() !== "" && typedNumber === null && (
            <p className="mt-1 text-xs text-danger">{t("createEntry.exampleOclcInvalid")}</p>
          )}
          <p className="mt-1 text-xs text-content-subtle">{t("createEntry.exampleOclcHelp")}</p>

          <button
            type="button"
            onClick={() => setDescribing(true)}
            className="mt-1 text-sm text-primary hover:text-primary-hover"
          >
            {t("createEntry.exampleDescribeSource")}
          </button>
        </div>
      )}

      {describing && (
        <SourceEditorDialog
          languages={languages}
          // Whatever the contributor was already reaching for seeds it: a
          // number they typed, otherwise the title they searched.
          {...(typedNumber !== null
            ? { seedOclc: typedNumber }
            : { seedTitle: query.trim() })}
          {...(languageTag !== null ? { mainLanguage: languageTag } : {})}
          onClose={() => setDescribing(false)}
          onPublished={(oclc) => {
            setDescribing(false);
            setJustPublished(oclc);
            pick(oclc);
          }}
        />
      )}
    </div>
  );
}

/**
 * A definition leaf's example sentences. Leaf-only by construction — it is
 * never rendered on a group card, because a heading has no sense of its own to
 * exemplify (the same asymmetry as the definition text, and the rule
 * `validateDefinitions` enforces).
 */
function ExamplesEditor({
  examples,
  onChange,
  languageTag,
  languages,
  idPrefix,
}: {
  examples: ExampleDraft[];
  onChange: (examples: ExampleDraft[]) => void;
  languageTag: string | null;
  languages: LanguageView[];
  idPrefix: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="mt-2">
      <p className="text-xs text-content-subtle">{t("createEntry.examplesHelp")}</p>
      {examples.map((row) => (
        <ExampleRow
          key={row.id}
          row={row}
          onChange={(next) => onChange(examples.map((e) => (e.id === row.id ? next : e)))}
          onRemove={() => onChange(examples.filter((e) => e.id !== row.id))}
          languageTag={languageTag}
          languages={languages}
          idPrefix={`${idPrefix}-${row.id}`}
        />
      ))}
      {examples.length < MAX_DEFINITION_EXAMPLES && (
        <button
          type="button"
          onClick={() =>
            onChange([
              ...examples,
              { id: nextAnnotationId++, text: "", oclc: "", locator: "" },
            ])
          }
          className="mt-2 text-sm text-primary hover:text-primary-hover"
        >
          {t("createEntry.addExample")}
        </button>
      )}
    </div>
  );
}

/**
 * The entry's grammatical categories: tags, picked from what the language has
 * bound rather than typed.
 *
 * Every option shows a **bound homolingual label**, never a raw identifier —
 * which is only possible because `categories` is tag-only, so the grammar had
 * to be declared before entries could use it. That is the payoff of the
 * friction, and the reason the friction is deliberate.
 *
 * The narrowing goes one click at a time ("n." → gender → declension), derived
 * from the language's inherence declarations, and since ADR-0019 its last step
 * is the category's **axis**: the abbreviations that category declared, each
 * standing for the form its own headwords are cited in. Choosing one emits the
 * bundle *including* that value, so an anv-kadarn stroll's record says on its
 * own face that its headword is the plural — which is what a set of rules
 * matches, and what the AppView indexes it under.
 *
 * With no declaration at all the options are a flat list and a contributor
 * picks atoms independently; the manual field stays as the escape hatch for a
 * tag no one has bound — which is how a bot's tag, or a language with no
 * declaration yet, remains authorable.
 */
function CategoryEditor({
  tags,
  onChange,
  labels,
  grammar,
}: {
  tags: Tag[];
  onChange: (tags: Tag[]) => void;
  labels: LabelView[];
  grammar: Grammar | null;
}) {
  const { t } = useTranslation();
  const [manual, setManual] = useState("");
  /**
   * The narrowing path being walked: the bundle built so far, refined one
   * click at a time. A refinement REPLACES this — the path produces one
   * bundle, never an accumulation — and committing pushes it into `tags`.
   */
  const [path, setPath] = useState<Tag | null>(null);
  const lookup = labelLookup(labels);
  const chosen = new Set(tags.map(tagKey));
  const options = labels.filter(
    (a) => a.tag !== undefined && a.long !== undefined && !chosen.has(tagKey(a.tag)),
  );
  const parsed = parseTagInput(manual);

  // The narrowing is a derived view of layers 1–2: roots are the bound parts
  // of speech, each step offers the values of the features declared inherent
  // to the bundle built so far. A language that declared no inherence offers
  // no next step, so the walk collapses to picking one bound atom — and with
  // no grammar at all, the flat picker below is all there is: the documented
  // degradation, not a special case.
  const roots = grammar === null ? [] : categoryRoots(grammar);
  const refinements = grammar === null || path === null ? [] : categoryRefinements(grammar, path);

  function commitPath(tag: Tag) {
    if (!chosen.has(tagKey(tag))) onChange([...tags, tag]);
    setPath(null);
  }

  /** Take one narrowing step; commit directly when nothing deeper is offered. */
  function refineTo(tag: Tag) {
    if (grammar === null || categoryRefinements(grammar, tag).length === 0) {
      commitPath(tag);
      return;
    }
    setPath(tag);
  }

  return (
    <div className="mt-2">
      {tags.length > 0 && (
        <ul className="flex flex-wrap items-center gap-1.5">
          {tags.map((tag, i) => (
            <li key={i} className="flex items-center gap-1">
              <ul className="flex flex-wrap items-center gap-1">
                <TagChips tags={[tag]} lookup={lookup} />
              </ul>
              <button
                type="button"
                onClick={() => onChange(tags.filter((_, j) => j !== i))}
                aria-label={t("createEntry.removeCategory")}
                title={t("createEntry.removeCategory")}
                className="text-content-subtle hover:text-danger"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {path === null ? (
        roots.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {roots.map((root) => (
              <li key={tagKey(root.tag)}>
                <button
                  type="button"
                  onClick={() => refineTo(root.tag)}
                  title={root.label.long}
                  className="rounded-full border border-dashed px-2.5 py-1 font-mono text-xs text-content-muted hover:border-primary hover:text-primary"
                >
                  + {root.label.short ?? root.label.long}
                </button>
              </li>
            ))}
          </ul>
        )
      ) : (
        <div className="mt-2 rounded-lg border bg-surface-muted/40 p-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <ul className="flex flex-wrap items-center gap-1">
              <TagChips tags={[path]} lookup={lookup} />
            </ul>
            <button
              type="button"
              onClick={() => commitPath(path)}
              className="rounded-full border border-primary px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary hover:text-primary-fg"
            >
              {t("createEntry.categoryKeep")}
            </button>
            <button
              type="button"
              onClick={() => setPath(null)}
              aria-label={t("createEntry.categoryAbandon")}
              title={t("createEntry.categoryAbandon")}
              className="text-content-subtle hover:text-danger"
            >
              ×
            </button>
          </div>
          {refinements.map((refinement) => (
            <div key={refinement.feature.feature} className="mt-2">
              {/* One kind of step since ADR-0020: every one of them asks what
                  the word IS, the citation number of a Breton anv-kadarn
                  stroll included. */}
              <p className="text-xs text-content-subtle">{refinement.feature.label.long}</p>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {refinement.options.map((option) => (
                  <li key={tagKey(option.tag)}>
                    <button
                      type="button"
                      onClick={() => refineTo(option.tag)}
                      title={option.label.long}
                      className="rounded-full border border-dashed px-2.5 py-1 font-mono text-xs text-content-muted hover:border-primary hover:text-primary"
                    >
                      {option.label.short ?? option.label.long}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {path === null && roots.length === 0 && options.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {options.map((option, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => onChange([...tags, option.tag!])}
                title={option.long}
                className="rounded-full border border-dashed px-2.5 py-1 font-mono text-xs text-content-muted hover:border-primary hover:text-primary"
              >
                + {option.short ?? option.long}
              </button>
            </li>
          ))}
        </ul>
      )}

      {options.length === 0 && tags.length === 0 && (
        <p className="text-xs text-content-subtle">{t("createEntry.categoriesNoneBound")}</p>
      )}

      <div className="mt-2 flex gap-2">
        <label className="sr-only" htmlFor="entry-category-manual">
          {t("createEntry.categoryManualLabel")}
        </label>
        <input
          id="entry-category-manual"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder={t("createEntry.categoryManualPlaceholder")}
          className="w-full min-w-0 rounded-lg border bg-surface px-3 py-2 text-sm text-content outline-none placeholder:text-content-subtle focus:ring-2"
        />
        <button
          type="button"
          disabled={parsed === null}
          onClick={() => {
            if (parsed === null) return;
            if (!chosen.has(tagKey(parsed))) onChange([...tags, parsed]);
            setManual("");
          }}
          className="shrink-0 rounded-lg border px-3 py-2 text-sm text-content hover:border-primary disabled:opacity-50"
        >
          {t("createEntry.addCategory")}
        </button>
      </div>
      <p className="mt-1 text-xs text-content-subtle">{t("createEntry.categoryManualHelp")}</p>
    </div>
  );
}

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
  // Every annotation site is tag-only now: an entry carries no labels of its
  // own, and a reader sees whatever the language bound each tag to.
  const [categories, setCategories] = useState<Tag[]>(() => initial?.categories ?? []);
  const [otherForms, setOtherForms] = useState<OtherFormDraft[]>(() =>
    (initial?.otherForms ?? []).map((f) => ({
      id: nextAnnotationId++,
      tag: f.tag,
      form: f.form,
    })),
  );
  const [definitions, setDefinitions] = useState<EditNode<DefinitionDraft, GroupDraft>[]>(() =>
    initial
      ? fromRecordDefinitions(
          initial.definitions,
          (d) => ({
            notes: d.notes ?? [],
            text: d.text ?? "",
            // Carried into the draft, flattened for editing. Examples the
            // record put on a *group* node reach `recordToGroup` instead, which
            // has nowhere to keep them — the lenient half of the leaves-only
            // rule, exactly as the text rule is healed rather than refused
            // here.
            examples: (d.examples ?? []).map((example) => ({
              id: nextAnnotationId++,
              text: example.text,
              oclc: example.source?.oclc ?? "",
              locator: example.source?.locator ?? "",
            })),
          }),
          (d) => ({ notes: d.notes ?? [] }),
          emptyGroupDraft,
          mintNodeId,
        )
      : [{ kind: "leaf", id: mintNodeId(), payload: emptyLeafDraft() }],
  );
  const [etymology, setEtymology] = useState<string[]>(initial?.etymology ?? []);
  const [entryNotes, setEntryNotes] = useState<string[]>(initial?.notes ?? []);
  const [references, setReferences] = useState<EntryReference[]>(initial?.references ?? []);
  const [todoItems, setTodoItems] = useState<string[]>(initial?.todo ?? []);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The target language's labelled tags — suggestions + conflict flags. */
  const [labels, setLabels] = useState<LabelView[]>([]);
  /**
   * The target language's grammar, resolved from its current record — what
   * drives the category editor's progressive narrowing (a derived view of
   * layers 1–2, never a separate declaration). Null while loading or when
   * the record cannot be resolved, in which case the editor degrades to the
   * flat picker over bound labels, exactly as at layer 1.
   */
  const [grammar, setGrammar] = useState<Grammar | null>(null);
  /** Current entries in the target language sharing a spelling with a fresh entry, for the duplicate warning. */
  const [duplicates, setDuplicates] = useState<EntryView[]>([]);

  const target = language ?? languages.find((l) => l.tag === pickedTag) ?? null;
  const targetTag = target?.tag ?? null;

  // The suggestions are an assist: failures stay silent and the editor
  // simply offers none.
  useEffect(() => {
    setLabels([]);
    if (targetTag === null) return;
    let cancelled = false;
    fetchLabels(targetTag)
      .then((list) => {
        if (!cancelled) setLabels(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [targetTag]);

  // The grammar rides the language's own record, so one PDS round trip at
  // editor-open resolves it — an authoring surface may pay that, where the
  // viewers deliberately never do. Failure is silent: no grammar means the
  // category editor degrades to the flat picker.
  useEffect(() => {
    setGrammar(null);
    if (targetTag === null) return;
    let cancelled = false;
    fetchCurrentLanguageRecord(targetTag)
      .then((ref) => (ref === null ? null : fetchLanguageRecord(ref.recordURI)))
      .then((record) => {
        if (cancelled) return;
        // Read through the same forward map the viewers and the binding editor
        // use: a language declared before ADR-0019 or ADR-0020 still describes a
        // real grammar, and an authoring surface that skipped the map would
        // offer a narrowing tree missing every category the older shape
        // declared — while the entry page beside it printed those very labels.
        const migrated = migrateGrammar(record?.grammar);
        setGrammar(isValidGrammar(migrated) ? migrated : null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [targetTag]);

  /**
   * The features the form editor offers a selector per — every grammatical
   * feature this language has bound values under (ADR-0020, which stopped
   * filtering them by the entry's own categories). Empty is the ordinary state
   * of a language that has declared nothing, and the editor degrades to its
   * flat picker.
   */
  const formSelectors = grammar === null ? [] : formAxes(grammar);

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
  const cleanEtymology = etymology.map((s) => s.trim()).filter((s) => s !== "");
  const cleanNotes = entryNotes.map((s) => s.trim()).filter((s) => s !== "");
  const cleanReferences: EntryReference[] = references
    .map((r) => ({ text: r.text.trim(), ...(r.url && r.url.trim() !== "" ? { url: r.url.trim() } : {}) }))
    .filter((r) => r.text !== "");
  const cleanOtherForms: EntryInflectedForm[] = otherForms
    .filter((f) => f.tag !== null && f.form.trim() !== "")
    .map((f) => ({ tag: f.tag!, form: f.form.trim() }));
  const cleanNodeNotes = (notes: string[]) => notes.map((s) => s.trim()).filter((s) => s !== "");
  // The flattened editor row folded back into the record's shape: a row with no
  // sentence is dropped (it is the example), a blank number means an unsourced
  // example rather than an empty citation, and a blank locator is omitted
  // rather than published as "". Round-trips losslessly for a valid record.
  const cleanExamples = (examples: ExampleDraft[]): EntryExample[] =>
    examples
      .map((example) => {
        const oclc = example.oclc.trim();
        const locator = example.locator.trim();
        return {
          text: example.text.trim(),
          ...(oclc !== ""
            ? { source: { oclc, ...(locator !== "" ? { locator } : {}) } }
            : {}),
        };
      })
      .filter((example) => example.text !== "")
      .slice(0, MAX_DEFINITION_EXAMPLES);
  // Serialize the editor tree to record definitions under the tree place
  // convention: leaves become definitions with text, group nodes carrying
  // notes become group items, bare groups stay implicit.
  const cleanDefinitions = toRecordDefinitions(
    definitions,
    (payload) => {
      if (payload.text.trim() === "") return null;
      const examples = cleanExamples(payload.examples);
      return {
        ...(cleanNodeNotes(payload.notes).length > 0
          ? { notes: cleanNodeNotes(payload.notes) }
          : {}),
        text: payload.text.trim(),
        ...(examples.length > 0 ? { examples } : {}),
      };
    },
    (group) => {
      const notes = cleanNodeNotes(group.notes);
      // A group is only worth an explicit record item when it carries content.
      return notes.length === 0 ? null : { notes };
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
      categories,
      ...(cleanOtherForms.length > 0 ? { otherForms: cleanOtherForms } : {}),
      definitions: cleanDefinitions,
      ...(cleanEtymology.length > 0 ? { etymology: cleanEtymology } : {}),
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

  // A node's free-text notes. Sense-level *tags* have a place on the record
  // (a definition node's own `categories`) but no editor yet: that is deferred
  // to the first contributor who asks for one, and the shape is already there
  // when they do.
  function nodeNotes(idPrefix: string, notes: string[], setNotes: (notes: string[]) => void) {
    return (
      <div className="mt-2">
        <StringList
          items={notes}
          onChange={setNotes}
          idPrefix={`${idPrefix}-plainnote`}
          itemLabel={t("createEntry.plainNoteLabel")}
          placeholder={t("createEntry.plainNotePlaceholder")}
          addLabel={t("createEntry.addPlainNote")}
          removeLabel={t("createEntry.removePlainNote")}
        />
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
            {nodeNotes(`entry-group-${node.id}`, node.group.notes, (notes) =>
              setDefinitions((prev) => updateGroup(prev, node.id, (g) => ({ ...g, notes }))),
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
          {nodeNotes(`entry-definition-${node.id}`, node.payload.notes, (notes) =>
            setDefinitions((prev) => updateLeaf(prev, node.id, (p) => ({ ...p, notes }))),
          )}
          {/* Leaf cards only: the group card above has no examples block,
              because a heading has no sense of its own to exemplify. */}
          <ExamplesEditor
            examples={node.payload.examples}
            onChange={(examples) =>
              setDefinitions((prev) => updateLeaf(prev, node.id, (p) => ({ ...p, examples })))
            }
            languageTag={targetTag}
            languages={languages}
            idPrefix={`entry-definition-${node.id}-example`}
          />
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
            <CategoryEditor
              tags={categories}
              onChange={setCategories}
              labels={labels}
              grammar={grammar}
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
              axes={formSelectors}
              labels={labels}
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
                  { kind: "leaf", id: mintNodeId(), payload: emptyLeafDraft() },
                ])
              }
              className="mt-2 text-sm text-primary hover:text-primary-hover"
            >
              {t("createEntry.addDefinition")}
            </button>
            {definitionsError !== "ok" && definitionsError !== "empty" && (
              <p className="mt-2 text-xs text-danger">{t("createEntry.definitionsInvalid")}</p>
            )}
          </fieldset>

          {/* Etymology is prose, and sits beside notes rather than among the
              structured fields, because that is what it is: the formalizable
              half of the same knowledge — that two words share an origin — is a
              cognate record, published from the entry's own page. */}
          <fieldset className="mt-5">
            <legend className="text-sm font-medium text-content">
              {t("createEntry.etymologyLegend")}
            </legend>
            <p className="mt-1 text-xs text-content-subtle">{t("createEntry.etymologyHelp")}</p>
            <StringList
              items={etymology}
              onChange={setEtymology}
              idPrefix="entry-etymology"
              itemLabel={t("createEntry.etymologyItemLabel")}
              placeholder={t("createEntry.etymologyPlaceholder")}
              addLabel={t("createEntry.addEtymology")}
              removeLabel={t("createEntry.removeEtymology")}
              rows={3}
            />
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
            {error !== null && <p className="text-sm text-danger">{error}</p>}
            <div className="flex items-center gap-3 sm:mr-auto">
              {entryView && onDeleted && (
                <button
                  type="button"
                  onClick={() => setDeleting(true)}
                  className="text-sm text-danger hover:text-danger"
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

// The "add this word" call to action that used to live here moved to
// `CreatePanel`, which asks *what* to add before opening an editor — one
// search bar now covers entries, languages and sources alike.
