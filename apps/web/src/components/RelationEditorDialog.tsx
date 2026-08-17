import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  LEKSIS_RELATION_COLLECTION,
  canonicalizePlacePrefix,
  collectLeafPlaces,
  compareDefinitionPlaces,
  expandPlacePrefix,
  normalizeRelationKind,
  placePathKey,
  validateRelation,
  type EntryDefinition,
  type EntryView,
  type LanguageView,
  type LeksisEntryRecord,
  type LeksisRelationRecord,
  type RelationKind,
  type RelationView,
} from "@leksis/types";
import { useSession } from "../auth/SessionProvider";
import { fetchEntry, searchEntries } from "../lib/api";
import { fetchEntryRecord, fetchRelationRecord, parseAtUri } from "../lib/atproto-record";
import { definitionsDepth, placeLabel } from "../lib/definition-tree";
import { LanguageSearchBar } from "./LanguageSearchBar";
import { endonym } from "./LanguageSelector";

// The writer's half of the semantic network: publishing an eu.leksis.relation
// record from the editor's own PDS.
//
// Two things about this dialog are load-bearing rather than incidental.
//
// **It always pins the entries' CURRENT versions.** A side names a record
// version, and the AppView parks a relation whose pinned version has since been
// restructured. Re-affirming after drift is therefore not a special repair
// mode — it is this ordinary edit flow, opened on a parked relation and
// published again against what the entries look like now.
//
// **The place prefix is picked on the rendered definition tree**, never typed:
// selecting a leaf, a group (its subtree) or the whole entry is what produces
// the canonical prefix, so a writer addresses senses the way they read them.

const WORD_SEARCH_DEBOUNCE_MS = 300;

/** How the dialog was opened — what is already known, and what is being modified. */
export interface RelationEditorLaunch {
  /**
   * The side the editor was launched from: the entry whose page (or whose
   * translation result) the writer is looking at, and the sense they meant.
   * Always pinned to the version being displayed, which is the current one.
   */
  source: { view: EntryView; record: LeksisEntryRecord; place: number[] };
  /** A target already known — the other side of a relation being modified. */
  targetEntryKey?: string | null;
  /** The target's place prefix, when a relation is being modified. */
  targetPlace?: number[];
  /** Pre-selected target language when no target entry is known yet. */
  targetLanguage?: string;
  /** Spelling to seed the word search with (a side that could not be resolved). */
  targetQuery?: string;
  kind?: RelationKind;
  /**
   * The relation version being modified. Its record URI becomes `subject`, so
   * the publication is a new version of that relation rather than a second,
   * competing assertion of the same thing.
   */
  existing?: RelationView | null;
}

export interface RelationEditorDialogProps extends RelationEditorLaunch {
  languages: LanguageView[];
  onClose: () => void;
  /** Called with the new relation record's AT URI once written to the PDS. */
  onPublished: (recordURI: string) => void;
  /** Called after the writer's own relation record was removed from their PDS. */
  onDeleted?: () => void;
}

interface SenseOption {
  key: string;
  place: number[];
  label: string;
  text: string;
  /** How many definition leaves this address covers; >1 makes the claim coarse. */
  leaves: number;
}

/**
 * The addresses a side may name, in reading order: every leaf of the entry's
 * definition tree, and every group above them.
 *
 * Derived from the **leaves**, not from the definitions array, because bare
 * grouping is implicit in the record — `toRecordDefinitions` writes a group node
 * only when it carries notes. Walking the array would therefore offer "all of
 * sense II." only for entries whose author happened to annotate that heading,
 * and leave everyone else to over-claim the whole entry. The tree the reader
 * sees is the tree they can address.
 */
function senseOptions(definitions: EntryDefinition[]): SenseOption[] {
  const depth = definitionsDepth(definitions);
  const leaves = collectLeafPlaces(definitions);
  // Group nodes that exist in the record supply their notes as the row's text;
  // an implicit group has none, and is described by what it covers instead.
  const annotated = new Map<string, EntryDefinition>();
  for (const def of definitions) {
    annotated.set(placePathKey(def.place), def);
  }

  const options = new Map<string, SenseOption>();
  for (const leaf of leaves) {
    for (let n = 1; n <= leaf.length; n += 1) {
      const place = leaf.slice(0, n);
      const key = placePathKey(place);
      const existing = options.get(key);
      if (existing !== undefined) {
        existing.leaves += 1;
        continue;
      }
      const node = annotated.get(key);
      options.set(key, {
        key,
        place,
        label: placeLabel(depth, place),
        text: node?.text ?? (node?.notes ?? []).join(" · "),
        leaves: 1,
      });
    }
  }
  return [...options.values()].sort((a, b) => compareDefinitionPlaces(a.place, b.place));
}

/** One side's sense selector: the whole entry, or one address in its tree. */
function SensePicker({
  definitions,
  value,
  onChange,
  idPrefix,
  leafCount,
}: {
  definitions: EntryDefinition[];
  value: number[];
  onChange: (place: number[]) => void;
  idPrefix: string;
  /** Senses this side's current choice addresses; 0 blocks publishing. */
  leafCount: number;
}) {
  const { t } = useTranslation();
  const options = useMemo(() => senseOptions(definitions), [definitions]);
  const selected = placePathKey(value);

  return (
    <fieldset className="mt-2">
      <legend className="text-xs font-medium text-content-muted">
        {t("relationEditor.sensesLegend")}
      </legend>
      {/* The address a parked relation was pinned to may have been deleted. It
          is named rather than merely left unselected, because otherwise a
          re-affirm looks like it is ready to publish when it would assert
          nothing at all. */}
      {leafCount === 0 && (
        <p className="mt-1 rounded border border-warning/60 px-2 py-1 text-xs text-warning">
          {t("relationEditor.staleSideWarning")}
        </p>
      )}
      <ul className="mt-1 max-h-48 space-y-1 overflow-y-auto rounded-lg border p-2">
        <li>
          <label className="flex items-start gap-2 text-sm text-content">
            <input
              type="radio"
              name={`${idPrefix}-place`}
              className="mt-1"
              checked={selected === ""}
              onChange={() => onChange([])}
            />
            <span>
              {t("relationEditor.wholeEntryOption")}
              <span className="block text-xs text-content-subtle">
                {t("relationEditor.wholeEntryHelp")}
              </span>
            </span>
          </label>
        </li>
        {options.map((option) => (
          <li key={option.key}>
            <label className="flex items-start gap-2 text-sm text-content">
              <input
                type="radio"
                name={`${idPrefix}-place`}
                className="mt-1"
                checked={selected === option.key}
                onChange={() => onChange(option.place)}
              />
              <span className="min-w-0">
                <span className="mr-2 font-mono text-xs text-content-subtle">{option.label}</span>
                {option.text}
                {/* A group covers several senses; saying how many is what makes
                    the coarseness of the claim visible before it is made,
                    rather than only in the reader's via-chain afterwards. */}
                {option.leaves > 1 && (
                  <span className="ml-2 text-xs text-content-subtle">
                    {t("relationEditor.coarseHint", { count: option.leaves })}
                  </span>
                )}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

export function RelationEditorDialog({
  source,
  targetEntryKey = null,
  targetPlace,
  targetLanguage,
  targetQuery,
  kind: initialKind,
  existing = null,
  languages,
  onClose,
  onPublished,
  onDeleted,
}: RelationEditorDialogProps) {
  const { t } = useTranslation();
  const { agent, did } = useSession();

  const [kind, setKind] = useState<RelationKind>(
    initialKind ?? normalizeRelationKind(existing?.kind) ?? "equivalence",
  );
  const [sourcePlace, setSourcePlace] = useState<number[]>(
    canonicalizePlacePrefix(source.place),
  );

  /** The target language, empty until picked. Set by the launch or by the picker. */
  const [language, setLanguage] = useState<string>(targetLanguage ?? "");
  const [query, setQuery] = useState<string>(targetQuery ?? "");
  const [results, setResults] = useState<EntryView[]>([]);
  /** The chosen target's current version, and its content for the sense picker. */
  const [target, setTarget] = useState<EntryView | null>(null);
  const [targetRecord, setTargetRecord] = useState<LeksisEntryRecord | null>(null);
  const [targetPlaceState, setTargetPlaceState] = useState<number[]>(
    canonicalizePlacePrefix(targetPlace ?? []),
  );

  /** This entry's canonical spelling — the dialog's subject, in headings and on the record. */
  const sourceWord = source.view.orthography[0] ?? source.view.key;

  const [notes, setNotes] = useState("");
  /**
   * Whether the relation being modified has had its record's notes resolved.
   * Submitting before this settles would publish a version with the caveats
   * silently dropped, so it gates the button rather than merely filling a field.
   */
  const [notesReady, setNotesReady] = useState(existing === null);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A relation being modified carries its own notes on its record, not in the
  // index — so an edit that did not resolve them would silently delete them.
  useEffect(() => {
    if (existing === null) return;
    let cancelled = false;
    fetchRelationRecord(existing.recordURI)
      .then((record) => {
        if (cancelled) return;
        if (record === null) {
          // The record is gone or unreadable. Refusing to edit is the safe
          // failure: publishing now would replace notes nobody could read.
          setError(t("relationEditor.errors.notesUnreadable"));
          return;
        }
        setNotes((record.notes ?? []).join("\n"));
        setNotesReady(true);
      })
      .catch(() => {
        if (!cancelled) setError(t("relationEditor.errors.notesUnreadable"));
      });
    return () => {
      cancelled = true;
    };
  }, [existing]);

  // A known target (the other side of a relation being modified) is resolved to
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

  // The target's content, for its sense picker. Resolved from the author's PDS
  // like every other piece of entry content.
  useEffect(() => {
    if (target === null) return setTargetRecord(null);
    let cancelled = false;
    setTargetRecord(null);
    fetchEntryRecord(target.recordURI)
      .then((record) => {
        if (!cancelled) setTargetRecord(record);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [target]);

  useEffect(() => {
    if (target !== null || language === "" || query.trim() === "") {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      // The source entry is NOT excluded: two senses of one polysemous word can
      // legitimately be asserted equivalent. Only naming the *same* senses of it
      // is meaningless, and validateRelation already refuses that ("self").
      searchEntries(query, language)
        .then((found) => {
          if (!cancelled) setResults(found);
        })
        .catch(() => {});
    }, WORD_SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [target, language, query]);

  const targetLanguageName = useMemo(() => {
    const known = languages.find((l) => l.tag === language);
    return known !== undefined ? endonym(known) : language;
  }, [languages, language]);

  /**
   * How many senses each side's chosen prefix actually addresses **in the
   * version about to be pinned**. Zero is the dangerous case and the reason
   * this is computed rather than assumed: a relation re-affirmed on a prefix
   * the restructured entry no longer has would expand to nothing on both the
   * pinned and the current tree, compare equal, and be indexed **live with no
   * edges** — silently dropping off the repair worklist without repairing
   * anything, which is precisely what parking exists to prevent.
   */
  const sourceLeafCount = useMemo(
    () => expandPlacePrefix(sourcePlace, collectLeafPlaces(source.record.definitions)).length,
    [sourcePlace, source.record.definitions],
  );
  const targetLeafCount = useMemo(
    () =>
      targetRecord === null
        ? 0
        : expandPlacePrefix(targetPlaceState, collectLeafPlaces(targetRecord.definitions)).length,
    [targetPlaceState, targetRecord],
  );

  /** Only the author of a relation may withdraw it from their own PDS. */
  const canDelete =
    existing !== null && did !== null && existing.authorDID === did && !submitting && !deleting;
  const canSubmit =
    !submitting &&
    !deleting &&
    target !== null &&
    targetRecord !== null &&
    agent !== null &&
    did !== null &&
    notesReady &&
    sourceLeafCount > 0 &&
    targetLeafCount > 0;

  async function onSubmit() {
    if (!canSubmit || !agent || !did || target === null) return;

    const noteList = notes
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");

    const record: LeksisRelationRecord = {
      $type: LEKSIS_RELATION_COLLECTION,
      ...(kind === "antonym" ? { kind: "antonym" } : {}),
      sides: [
        {
          entry: source.view.recordURI,
          languageID: source.view.languageID,
          place: sourcePlace,
          orthography: sourceWord,
        },
        {
          entry: target.recordURI,
          languageID: target.languageID,
          place: targetPlaceState,
          orthography: target.orthography[0] ?? target.key,
        },
      ],
      ...(noteList.length > 0 ? { notes: noteList } : {}),
      ...(existing !== null ? { subject: existing.recordURI } : {}),
      createdAt: new Date().toISOString(),
    };

    // The same whole-record check the AppView runs at ingest, so a record that
    // would park as invalid is refused here instead of being published.
    const problem = validateRelation(record);
    if (problem !== "ok") {
      setError(t(`relationEditor.errors.${problem}`));
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await agent.com.atproto.repo.createRecord({
        repo: did,
        collection: LEKSIS_RELATION_COLLECTION,
        record: { ...record },
      });
      onPublished(res.data.uri);
    } catch (err) {
      console.error("createRecord (relation) failed:", err);
      setError(t("relationEditor.errors.writeFailed"));
      setSubmitting(false);
    }
  }

  /**
   * Withdrawing a relation is a real PDS delete, unlike withdrawing an entry:
   * a relation has no content to preserve and no readers to redirect, and the
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
      console.error("deleteRecord (relation) failed:", err);
      setError(t("relationEditor.errors.deleteFailed"));
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
      aria-labelledby="relation-editor-title"
    >
      <section className="max-h-[calc(100dvh-2rem)] w-full overflow-y-auto rounded-t-xl border bg-surface shadow-lg sm:max-w-lg sm:rounded-xl">
        <header className="border-b bg-surface-muted/60 px-4 py-3 sm:px-5">
          <h2 id="relation-editor-title" className="text-base font-semibold text-content">
            {existing !== null
              ? t("relationEditor.editTitle", { word: sourceWord })
              : t("relationEditor.title", { word: sourceWord })}
          </h2>
          <p className="mt-1 text-sm text-content-muted">
            {existing !== null && existing.state !== "live"
              ? t("relationEditor.reaffirmIntro")
              : t("relationEditor.intro")}
          </p>
        </header>

        <div className="space-y-5 p-4 sm:p-5">
          {/* Kind. Equivalence is the default and covers synonymy — a synonym is
              a translation whose two languages are equal — so the only choice
              here is whether the assertion inverts meaning. */}
          <fieldset>
            <legend className="text-sm font-medium text-content">
              {t("relationEditor.kindLabel")}
            </legend>
            <div className="mt-1 flex gap-4">
              {(["equivalence", "antonym"] as const).map((option) => (
                <label key={option} className="flex items-center gap-2 text-sm text-content">
                  <input
                    type="radio"
                    name="relation-kind"
                    checked={kind === option}
                    onChange={() => setKind(option)}
                  />
                  {t(`relationEditor.kind.${option}`)}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-content-subtle">
              {kind === "antonym"
                ? t("relationEditor.antonymHelp")
                : t("relationEditor.equivalenceHelp")}
            </p>
          </fieldset>

          {/* This entry's side. Pre-filled from the launch context, and still
              editable: the sense the writer clicked from is a default, not a
              constraint. */}
          <section>
            <h3 className="text-sm font-medium text-content">
              {t("relationEditor.sourceLabel", { word: sourceWord })}
            </h3>
            <SensePicker
              definitions={source.record.definitions}
              value={sourcePlace}
              onChange={setSourcePlace}
              idPrefix="relation-source"
              leafCount={sourceLeafCount}
            />
          </section>

          {/* The other side: language, then the word, then its senses. */}
          <section>
            <h3 className="text-sm font-medium text-content">
              {t("relationEditor.targetLabel")}
            </h3>

            {language === "" ? (
              <div className="mt-2">
                <p className="mb-1 text-xs text-content-subtle">
                  {t("relationEditor.targetLanguageHelp")}
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
                    setTargetPlaceState([]);
                    setQuery("");
                  }}
                  className="text-xs text-primary hover:text-primary-hover"
                >
                  {t("relationEditor.changeLanguage")}
                </button>
              </div>
            )}

            {language !== "" && target === null && (
              <div className="mt-3">
                <label
                  htmlFor="relation-target-search"
                  className="block text-sm font-medium text-content"
                >
                  {t("relationEditor.wordLabel")}
                </label>
                <input
                  id="relation-target-search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("relationEditor.wordPlaceholder")}
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
                          onClick={() => {
                            setTarget(r);
                            setTargetPlaceState([]);
                          }}
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
                    {t("relationEditor.noWordFound")}
                  </p>
                )}
              </div>
            )}

            {target !== null && (
              <div className="mt-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border bg-surface-muted/60 px-2.5 py-1 text-xs text-content">
                    {target.orthography[0]}{" "}
                    <span className="font-mono text-content-subtle">{target.key}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setTarget(null);
                      setTargetPlaceState([]);
                    }}
                    className="text-xs text-primary hover:text-primary-hover"
                  >
                    {t("relationEditor.changeWord")}
                  </button>
                </div>
                {targetRecord === null ? (
                  <p className="mt-2 text-xs text-content-subtle">
                    {t("relationEditor.loadingTarget")}
                  </p>
                ) : (
                  <SensePicker
                    definitions={targetRecord.definitions}
                    value={targetPlaceState}
                    onChange={setTargetPlaceState}
                    idPrefix="relation-target"
                    leafCount={targetLeafCount}
                  />
                )}
              </div>
            )}
          </section>

          <div>
            <label htmlFor="relation-notes" className="block text-sm font-medium text-content">
              {t("relationEditor.notesLabel")}
            </label>
            <p className="mt-1 text-xs text-content-subtle">{t("relationEditor.notesHelp")}</p>
            <textarea
              id="relation-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder={t("relationEditor.notesPlaceholder")}
              className={`${inputClass} mt-1`}
            />
          </div>

          {error !== null && <p className="text-sm text-danger">{error}</p>}

          <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            {canDelete ? (
              <button
                type="button"
                onClick={onDelete}
                title={t("relationEditor.deleteHint")}
                className="self-start text-sm text-danger hover:text-danger"
              >
                {deleting ? t("relationEditor.deleting") : t("relationEditor.delete")}
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
                {t("relationEditor.cancel")}
              </button>
              <button
                type="button"
                onClick={onSubmit}
                disabled={!canSubmit}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-fg hover:bg-primary-hover disabled:opacity-50"
              >
                {submitting ? t("relationEditor.submitting") : t("relationEditor.submit")}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
