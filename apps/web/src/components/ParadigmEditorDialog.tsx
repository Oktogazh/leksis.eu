import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  categoryRefinements,
  categoryRoots,
  coordTag,
  formatTagVerbatim,
  generateForms,
  paradigmIssues,
  paradigmRkey,
  parseTagInput,
  tagKey,
  LEKSIS_PARADIGM_COLLECTION,
  PARADIGM_LIMITS,
  type EntryInflectedForm,
  type Grammar,
  type GrammarLabel,
  type LayoutCoord,
  type ParadigmCell,
  type ParadigmRule,
  type ParadigmView as ParadigmPointer,
  type Tag,
} from "@leksis/types";
import { EntryParadigm } from "./ParadigmView";
import { TagLabel } from "./EntryPreview";
import { useSession } from "../auth/SessionProvider";
import { fetchLabelSample, fetchLanguageParadigms } from "../lib/api";
import { fetchParadigmRecord } from "../lib/atproto-record";
import { grammaticalFeatureRows, valueRows } from "../lib/grammar-draft";
import { forgetParadigms } from "../lib/paradigms";
import {
  addNote,
  addReference,
  addRequirement,
  addSelector,
  addTable,
  canAddRequirement,
  canAddRule,
  canAddSelector,
  canAddTable,
  canInsertRow,
  canMergeDown,
  canMergeRight,
  canRemoveColumn,
  canRemoveRow,
  canUnmerge,
  cellAt,
  emptyDraft,
  fromRecord,
  insertColumn,
  insertRow,
  mergeDown,
  mergeRight,
  movedRules,
  recordTables,
  removeColumn,
  removeNote,
  removeReference,
  removeRequirement,
  removeRow,
  removeSelector,
  removeTable,
  renameTable,
  rulesOf,
  setCellAt,
  toRecord,
  unmerge,
  updateNote,
  updateReference,
  updateRequirement,
  updateTable,
  withRules,
  type DraftTable,
  type ParadigmDraft,
} from "../lib/paradigm-draft";

// Writing a language's inflection tables.
//
// A **separate dialog** rather than a level of the grammar dialog it opens
// from, because it publishes a **different record**: its own key, its own issue
// gate, its own concurrency guard. The grammar dialog has one draft and one
// publish footer bound to the language record, and a second draft behind that
// same footer is how a contributor loses an edit.
//
// What ADR-0019 changed here is the whole shape of the work. The old editor
// wrote a **flat list of rules**, each naming the cell it filled, because cells
// were derived — the cartesian product of a category's axes, arranged by a
// `layout` block on the language record. Real tables are not products: they
// carry explanatory headings, cells no combination of features names, and
// merges. So the table is now authored here, cell by cell, and a rule lives
// *in* the cell it fills.
//
// Three things about this file are decisions rather than mechanics:
//
//   * **The grid is edited as the rectangle it draws**, not as the rows the
//     record stores. `lib/paradigm-draft.ts` holds that model and the invariants
//     that make `ragged-table` unreachable from the interface.
//   * **The selectors are the identity**, so they are picked while creating and
//     locked while rewriting — and a new paradigm whose categories already have
//     one is refused rather than published over a stranger's record with no
//     concurrency guard behind it.
//   * **The preview is the reader's own component**, over a specimen this
//     language actually has. Drawing a second table here is how the editor's
//     idea of a cell would come to differ from the page's.

const inputClass =
  "w-full rounded-lg border bg-surface px-3 py-2 text-sm text-content outline-none placeholder:text-content-subtle focus:ring-2";

const gridButton =
  "flex h-5 w-5 items-center justify-center rounded border text-[0.7rem] leading-none text-content-subtle hover:border-primary hover:text-primary disabled:opacity-30";

/** A cell address written the way UD writes a bundle — the editor's shorthand. */
function coordsText(coords: readonly LayoutCoord[]): string {
  return formatTagVerbatim({ feats: coords.map((c) => ({ feature: c.feature, value: c.value })) });
}

/** Which position of which table is open in the inspector. */
interface Selection {
  table: number;
  top: number;
  left: number;
}

export interface ParadigmEditorDialogProps {
  /** BCP 47 tag of the language these tables belong to. */
  tag: string;
  /**
   * The language's declarations, **as published** rather than as edited in the
   * dialog behind this one. A paradigm addresses what the language has actually
   * declared: offering a value that exists only in an unsaved grammar draft
   * would let a contributor publish tables pointing at nothing, and then
   * abandon the draft.
   */
  grammar: Grammar | undefined;
  lookup: ReadonlyMap<string, GrammarLabel>;
  /** Every current paradigm of the language — what an identity is checked against. */
  pointers: readonly ParadigmPointer[];
  /** Present when rewriting one that exists; absent when creating. */
  existing?: ParadigmPointer;
  /** Leave this draft and open the paradigm that already holds these categories. */
  onOpenExisting: (pointer: ParadigmPointer) => void;
  onClose: () => void;
  onPublished: (paradigmKey: string) => void;
}

export function ParadigmEditorDialog({
  tag,
  grammar,
  lookup,
  pointers,
  existing,
  onOpenExisting,
  onClose,
  onPublished,
}: ParadigmEditorDialogProps) {
  const { t } = useTranslation();
  const { agent, did } = useSession();

  const [loading, setLoading] = useState(existing !== undefined);
  /** null while loading, and after a load that failed — told apart by `loading`. */
  const [draft, setDraft] = useState<ParadigmDraft | null>(
    existing === undefined ? emptyDraft([]) : null,
  );
  const [selected, setSelected] = useState<Selection | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lemma, setLemma] = useState("");
  /** One specimen per required address, keyed by the address's own text. */
  const [samples, setSamples] = useState<Record<string, string>>({});
  const [rollingSpecimen, setRollingSpecimen] = useState(false);

  useEffect(() => {
    if (existing === undefined) return;
    let live = true;
    fetchParadigmRecord(existing.recordURI)
      .then((record) => {
        if (!live) return;
        // A record that could not be read leaves the draft null on purpose. An
        // empty draft here would publish a rewrite that silently discarded
        // every table this author never saw.
        setDraft(record === null ? null : fromRecord(record));
      })
      .catch((err: unknown) => {
        console.warn("could not read the paradigm record:", err);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [existing]);

  /**
   * Escape closes **this** dialog only.
   *
   * It sits on top of the grammar dialog, which has its own handler; a bubbling
   * keystroke would close both and lose the grammar draft behind it.
   */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const tables = useMemo(() => (draft === null ? [] : recordTables(draft)), [draft]);

  /**
   * Every defect in the draft — **the same function ingest runs**, so a record
   * this dialog refuses to write is exactly the record the AppView would refuse
   * to index (ADR-0015). Any defect blocks, not only one this edit introduced.
   */
  const defects = useMemo(
    () => (draft === null ? [] : paradigmIssues({ tables, requires: draft.requires })),
    [draft, tables],
  );

  /**
   * The identity these categories give the record: `{lang}-{hash16}` over the
   * sorted selector keys, computed exactly as ingest recomputes it.
   */
  const rkey = useMemo(
    () =>
      draft === null || draft.selectors.length === 0
        ? null
        : paradigmRkey({ languageID: tag, selectors: draft.selectors }),
    [draft, tag],
  );

  /**
   * The paradigm already filed under this identity, when creating.
   *
   * Publishing over it would be a rewrite with **no concurrency guard** — the
   * guard is skipped while creating precisely because there is then nobody
   * else's work to lose — so the identity is checked instead and the author is
   * sent to the record itself. It is not an error about their categories: those
   * categories simply already have a paradigm, and rewriting it is a different
   * act from starting one.
   */
  const collision = useMemo(
    () =>
      existing !== undefined || rkey === null
        ? undefined
        : pointers.find((pointer) => pointer.paradigmKey === rkey),
    [existing, rkey, pointers],
  );

  /** The entry facts the preview generates against: a lemma and its principal parts. */
  const facts = useMemo(() => {
    const forms: EntryInflectedForm[] = (draft?.requires ?? [])
      .map((row) => ({
        tag: coordTag(grammar ?? {}, row.coords),
        form: samples[coordsText(row.coords)] ?? "",
      }))
      .filter((row) => row.form !== "");
    return { lemma: lemma.trim(), forms };
  }, [draft, grammar, samples, lemma]);

  /** The draft as a record, for the reader's component and the generator. */
  const previewRecord = useMemo(
    () =>
      draft === null
        ? null
        : toRecord(draft, { languageID: tag, createdAt: "1970-01-01T00:00:00.000Z" }),
    [draft, tag],
  );

  const missing = useMemo(
    () =>
      previewRecord === null || facts.lemma === ""
        ? []
        : generateForms(previewRecord, facts).missing,
    [previewRecord, facts],
  );

  /**
   * A real headword of the first selector, drawn by the AppView.
   *
   * The rules are written for actual words, and a contributor testing them on a
   * word they invented is testing their own spelling. Slice 1's random-entry
   * endpoint already answers "one entry using this tag", and a category's
   * annotation is a labelled tag like any other — so the specimen is one call
   * and re-rollable. Nothing found is the ordinary answer for a category no
   * entry carries yet, and it is silent: the lemma field stays typeable.
   */
  async function rollSpecimen() {
    const selector = draft?.selectors[0];
    if (selector === undefined) return;
    setRollingSpecimen(true);
    try {
      const drawn = await fetchLabelSample(tag, tagKey(selector));
      if (drawn !== null) setLemma(drawn.orthography);
    } catch (err) {
      console.warn("could not draw a specimen entry:", err);
    } finally {
      setRollingSpecimen(false);
    }
  }

  async function publish() {
    if (draft === null || agent === null || did === null) return;
    setSubmitting(true);
    setError(null);
    try {
      // The concurrency guard. A paradigm's blast radius is every entry of a
      // category, and strangers rewrite it — so a copy loaded ten minutes ago
      // must not overwrite one published since.
      if (existing !== undefined) {
        const fresh = (await fetchLanguageParadigms(tag)).find(
          (row) => row.paradigmKey === existing.paradigmKey,
        );
        if (fresh !== undefined && fresh.cid !== existing.cid) {
          setError(t("paradigmEditor.errors.stale"));
          setSubmitting(false);
          return;
        }
      }

      const record = toRecord(draft, {
        languageID: tag,
        createdAt: new Date().toISOString(),
        ...(existing !== undefined ? { subject: existing.recordURI } : {}),
      });
      // rkey = the language plus a hash of the sorted selector keys, recomputed
      // from the record's own fields — every author's paradigm for one set of
      // categories shares one identity, and ingest refuses a key that
      // disagrees with it.
      const key = paradigmRkey(record);
      await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: LEKSIS_PARADIGM_COLLECTION,
        rkey: key,
        // putRecord wants an index signature our interface doesn't declare.
        record: { ...record },
      });
      forgetParadigms(tag);
      onPublished(key);
    } catch (err) {
      console.error("putRecord failed:", err);
      setError(t("paradigmEditor.errors.writeFailed"));
      setSubmitting(false);
    }
  }

  const grid = draft === null || selected === null ? undefined : draft.tables[selected.table];
  const openCell =
    grid === undefined || selected === null ? undefined : cellAt(grid, selected.top, selected.left);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="paradigm-editor-title"
    >
      <div className="flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden rounded-t-xl border bg-surface shadow-lg sm:max-w-3xl sm:rounded-xl">
        <header className="border-b bg-surface-muted/60 px-4 py-3 sm:px-5">
          <h2 id="paradigm-editor-title" className="text-base font-semibold text-content">
            {t("paradigmEditor.title")}
          </h2>
          <p className="mt-1 text-sm text-content-muted">{t("paradigmEditor.intro")}</p>
        </header>

        {loading ? (
          <p className="p-5 text-sm text-content-muted">{t("paradigmEditor.loading")}</p>
        ) : draft === null ? (
          <p className="p-5 text-sm text-content-muted">{t("paradigmEditor.recordUnavailable")}</p>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
            {/* Which headword categories these tables serve. First, because it
                is what the record is filed under. */}
            <section>
              <p className="text-xs font-medium text-content">
                {t("paradigmEditor.selectorsTitle")}
              </p>
              <p className="mt-1 text-xs text-content-subtle">
                {existing === undefined
                  ? t("paradigmEditor.selectorsHint")
                  : t("paradigmEditor.selectorsLocked")}
              </p>
              {draft.selectors.length > 0 && (
                <ul className="mt-2 flex flex-wrap items-center gap-2">
                  {draft.selectors.map((selector, i) => (
                    <li
                      key={tagKey(selector)}
                      className="flex items-center gap-1 rounded-full border bg-surface px-2.5 py-1"
                    >
                      <span className="font-mono text-xs text-content">
                        <TagLabel tag={selector} lookup={lookup} />
                      </span>
                      {existing === undefined && (
                        <button
                          type="button"
                          onClick={() => {
                            setDraft(removeSelector(draft, i));
                            setSelected(null);
                          }}
                          aria-label={t("paradigmEditor.removeSelector")}
                          className="text-content-subtle hover:text-danger"
                        >
                          ×
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {existing === undefined && canAddSelector(draft) && (
                <SelectorPicker
                  grammar={grammar}
                  lookup={lookup}
                  chosen={new Set(draft.selectors.map(tagKey))}
                  onAdd={(selector) => setDraft(addSelector(draft, selector))}
                />
              )}
              {collision !== undefined && (
                <div className="mt-2 rounded-lg border border-danger/40 bg-surface-muted/60 px-3 py-2">
                  <p className="text-xs text-content">{t("paradigmEditor.collision")}</p>
                  <button
                    type="button"
                    onClick={() => onOpenExisting(collision)}
                    className="mt-1.5 rounded-lg border px-3 py-1.5 text-xs text-content hover:border-primary"
                  >
                    {t("paradigmEditor.collisionOpen")}
                  </button>
                </div>
              )}
            </section>

            {/* What this language calls the paradigm. */}
            <section className="mt-5 border-t pt-4">
              <p className="text-xs font-medium text-content">{t("paradigmEditor.labelTitle")}</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <input
                  value={draft.label.long}
                  onChange={(e) =>
                    setDraft({ ...draft, label: { ...draft.label, long: e.target.value } })
                  }
                  placeholder={t("paradigmEditor.labelLong")}
                  aria-label={t("paradigmEditor.labelLong")}
                  className={inputClass}
                />
                <input
                  value={draft.label.short}
                  onChange={(e) =>
                    setDraft({ ...draft, label: { ...draft.label, short: e.target.value } })
                  }
                  placeholder={t("paradigmEditor.labelShort")}
                  aria-label={t("paradigmEditor.labelShort")}
                  className={inputClass}
                />
              </div>
            </section>

            {/* The tables themselves — the record's substance since ADR-0019. */}
            <section className="mt-5 border-t pt-4">
              <p className="text-xs font-medium text-content">{t("paradigmEditor.tablesTitle")}</p>
              <p className="mt-1 text-xs text-content-subtle">{t("paradigmEditor.tablesHint")}</p>
              {draft.tables.map((table, index) => (
                <div key={index} className="mt-3 rounded-lg border bg-surface-muted/30 p-3">
                  <div className="flex items-center gap-2">
                    <input
                      value={table.name}
                      onChange={(e) =>
                        setDraft(updateTable(draft, index, renameTable(table, e.target.value)))
                      }
                      placeholder={t("paradigmEditor.tableName")}
                      aria-label={t("paradigmEditor.tableName")}
                      className={inputClass}
                    />
                    <button
                      type="button"
                      disabled={draft.tables.length <= 1}
                      onClick={() => {
                        setDraft(removeTable(draft, index));
                        setSelected(null);
                      }}
                      aria-label={t("paradigmEditor.removeTable")}
                      title={t("paradigmEditor.removeTable")}
                      className="shrink-0 px-1 text-content-subtle hover:text-danger disabled:opacity-30"
                    >
                      ×
                    </button>
                  </div>
                  <GridEditor
                    grid={table}
                    grammar={grammar}
                    lookup={lookup}
                    selected={
                      selected !== null && selected.table === index
                        ? { top: selected.top, left: selected.left }
                        : null
                    }
                    onSelect={(position) =>
                      setSelected(
                        position === null ? null : { table: index, ...position },
                      )
                    }
                    onChange={(next) => setDraft(updateTable(draft, index, next))}
                  />
                </div>
              ))}
              {canAddTable(draft) && (
                <button
                  type="button"
                  onClick={() => setDraft(addTable(draft))}
                  className="mt-2 rounded-lg border px-3 py-1.5 text-xs text-content hover:border-primary"
                >
                  {t("paradigmEditor.addTable")}
                </button>
              )}
            </section>

            {/* The open cell: what it is, what fills it. */}
            {grid !== undefined && selected !== null && openCell !== undefined && (
              <section className="mt-5 border-t pt-4">
                <CellInspector
                  cell={openCell.cell}
                  grammar={grammar}
                  lookup={lookup}
                  spans={{ rowSpan: openCell.rowSpan, colSpan: openCell.colSpan }}
                  bases={baseOptions(draft, selected)}
                  merge={{
                    right: canMergeRight(grid, selected.top, selected.left),
                    down: canMergeDown(grid, selected.top, selected.left),
                    split: canUnmerge(grid, selected.top, selected.left),
                  }}
                  onMerge={(how) => {
                    const next =
                      how === "right"
                        ? mergeRight(grid, selected.top, selected.left)
                        : how === "down"
                          ? mergeDown(grid, selected.top, selected.left)
                          : unmerge(grid, selected.top, selected.left);
                    setDraft(updateTable(draft, selected.table, next));
                  }}
                  onChange={(cell) =>
                    setDraft(
                      updateTable(
                        draft,
                        selected.table,
                        setCellAt(grid, selected.top, selected.left, cell),
                      ),
                    )
                  }
                />
              </section>
            )}

            {/* Principal parts: the forms the rules cannot derive and the entry
                must supply. The message is the contributor's, verbatim. */}
            <section className="mt-5 border-t pt-4">
              <p className="text-xs font-medium text-content">
                {t("paradigmEditor.requiresTitle")}
              </p>
              <p className="mt-1 text-xs text-content-subtle">
                {t("paradigmEditor.requiresHint")}
              </p>
              {draft.requires.length > 0 && (
                <ul className="mt-2 space-y-2">
                  {draft.requires.map((row, i) => (
                    <li key={i} className="rounded-lg border bg-surface px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate font-mono text-xs text-content">
                          <TagLabel tag={coordTag(grammar ?? {}, row.coords)} lookup={lookup} />
                        </span>
                        <button
                          type="button"
                          onClick={() => setDraft(removeRequirement(draft, i))}
                          aria-label={t("paradigmEditor.removeRequirement")}
                          className="px-1 text-content-subtle hover:text-danger"
                        >
                          ×
                        </button>
                      </div>
                      <textarea
                        value={row.message}
                        onChange={(e) =>
                          setDraft(updateRequirement(draft, i, { message: e.target.value }))
                        }
                        placeholder={t("paradigmEditor.requiresMessage")}
                        aria-label={t("paradigmEditor.requiresMessage")}
                        rows={2}
                        className={`mt-2 ${inputClass}`}
                      />
                    </li>
                  ))}
                </ul>
              )}
              {canAddRequirement(draft) && (
                <div className="mt-2 rounded-lg border border-dashed p-2">
                  <p className="text-xs text-content-subtle">{t("paradigmEditor.requiresAdd")}</p>
                  <CoordsPicker
                    grammar={grammar}
                    lookup={lookup}
                    coords={[]}
                    onChange={(coords) => {
                      if (coords.length > 0) setDraft(addRequirement(draft, coords));
                    }}
                  />
                </div>
              )}
            </section>

            {/* The live preview: this draft, over one specimen, drawn by the
                reader's own component. */}
            <section className="mt-5 border-t pt-4">
              <p className="text-xs font-medium text-content">{t("paradigmEditor.previewTitle")}</p>
              <div className="mt-2 flex gap-2">
                <input
                  value={lemma}
                  onChange={(e) => setLemma(e.target.value)}
                  placeholder={t("paradigmEditor.previewLemma")}
                  aria-label={t("paradigmEditor.previewLemma")}
                  className={inputClass}
                />
                <button
                  type="button"
                  disabled={draft.selectors.length === 0 || rollingSpecimen}
                  onClick={() => void rollSpecimen()}
                  title={t("paradigmEditor.previewRoll")}
                  className="shrink-0 rounded-lg border px-3 py-2 text-sm text-content hover:border-primary disabled:opacity-50"
                >
                  {t("paradigmEditor.previewRoll")}
                </button>
              </div>
              {draft.requires.map((row, i) => {
                const key = coordsText(row.coords);
                return (
                  <div key={i} className="mt-2">
                    <label className="block text-xs text-content-subtle" htmlFor={`sample-${i}`}>
                      {t("paradigmEditor.previewSample", { address: key })}
                    </label>
                    <input
                      id={`sample-${i}`}
                      value={samples[key] ?? ""}
                      onChange={(e) => setSamples({ ...samples, [key]: e.target.value })}
                      className={`mt-1 ${inputClass}`}
                    />
                  </div>
                );
              })}
              {previewRecord !== null && (
                <div className="mt-3">
                  <EntryParadigm
                    grammar={grammar}
                    lemma={facts.lemma}
                    forms={facts.forms}
                    paradigms={[{ paradigmKey: "draft", record: previewRecord }]}
                    lookup={lookup}
                  />
                </div>
              )}
              {/* The author's own words, printed as written: the whole point of
                  putting the message in the rule is that a speaker wrote it. */}
              {missing.length > 0 && (
                <div className="mt-2 rounded-lg border bg-surface-muted/60 px-3 py-2">
                  <p className="text-xs font-medium text-content">
                    {t("paradigmEditor.previewMissingTitle")}
                  </p>
                  <ul className="mt-1 space-y-1">
                    {missing.map((row) => (
                      <li key={row.key} className="text-sm text-content-muted">
                        {row.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            {/* Remarks and sources for the tables themselves. */}
            <section className="mt-5 border-t pt-4">
              <p className="text-xs font-medium text-content">{t("paradigmEditor.notesTitle")}</p>
              {draft.notes.map((note, i) => (
                <div key={i} className="mt-2 flex gap-2">
                  <input
                    value={note}
                    onChange={(e) => setDraft(updateNote(draft, i, e.target.value))}
                    aria-label={t("paradigmEditor.notesTitle")}
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={() => setDraft(removeNote(draft, i))}
                    aria-label={t("paradigmEditor.removeNote")}
                    className="px-1 text-content-subtle hover:text-danger"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setDraft(addNote(draft))}
                className="mt-2 rounded-lg border px-3 py-1.5 text-xs text-content hover:border-primary"
              >
                {t("paradigmEditor.addNote")}
              </button>

              <p className="mt-4 text-xs font-medium text-content">
                {t("paradigmEditor.referencesTitle")}
              </p>
              {draft.references.map((row, i) => (
                <div key={i} className="mt-2 flex gap-2">
                  <input
                    value={row.text}
                    onChange={(e) => setDraft(updateReference(draft, i, { text: e.target.value }))}
                    placeholder={t("paradigmEditor.referenceText")}
                    aria-label={t("paradigmEditor.referenceText")}
                    className={inputClass}
                  />
                  <input
                    value={row.url ?? ""}
                    onChange={(e) => setDraft(updateReference(draft, i, { url: e.target.value }))}
                    placeholder={t("paradigmEditor.referenceUrl")}
                    aria-label={t("paradigmEditor.referenceUrl")}
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={() => setDraft(removeReference(draft, i))}
                    aria-label={t("paradigmEditor.removeReference")}
                    className="px-1 text-content-subtle hover:text-danger"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setDraft(addReference(draft))}
                className="mt-2 rounded-lg border px-3 py-1.5 text-xs text-content hover:border-primary"
              >
                {t("paradigmEditor.addReference")}
              </button>
            </section>
          </div>
        )}

        <footer className="border-t bg-surface-muted/60 px-4 py-3 sm:px-5">
          {/* Every defect, named by row. The same list ingest would log. */}
          {defects.length > 0 && (
            <ul className="mb-2 space-y-0.5">
              {defects.map((defect, i) => (
                <li key={i} className="text-xs text-danger">
                  {t(`paradigmEditor.issue.${defect.kind}`)}
                  {defect.address !== undefined && defect.address !== "" && (
                    <span className="ml-1 font-mono text-content-muted">{defect.address}</span>
                  )}
                  {defect.base !== undefined && (
                    <span className="ml-1 font-mono text-content-muted">{defect.base}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {draft !== null && draft.selectors.length === 0 && (
            <p className="mb-2 text-xs text-danger">{t("paradigmEditor.needSelector")}</p>
          )}
          {error !== null && <p className="mb-2 text-xs text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border px-3 py-2 text-sm text-content hover:border-primary"
            >
              {t("paradigmEditor.cancel")}
            </button>
            <button
              type="button"
              disabled={
                draft === null ||
                draft.selectors.length === 0 ||
                collision !== undefined ||
                defects.length > 0 ||
                submitting ||
                agent === null
              }
              onClick={() => void publish()}
              className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-fg hover:bg-primary-hover disabled:opacity-50"
            >
              {submitting ? t("paradigmEditor.publishing") : t("paradigmEditor.publish")}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

/**
 * What a rule may start from: a required form, or another form cell of the
 * record. The cell being edited is excluded — a rule based on its own cell is
 * the shortest possible `base-cycle`.
 */
function baseOptions(
  draft: ParadigmDraft,
  selected: Selection,
): { text: string; coords: LayoutCoord[] }[] {
  const seen = new Set<string>();
  const options: { text: string; coords: LayoutCoord[] }[] = [];
  const offer = (coords: LayoutCoord[]) => {
    const text = coordsText(coords);
    if (text === "" || seen.has(text)) return;
    seen.add(text);
    options.push({ text, coords });
  };
  for (const row of draft.requires) offer(row.coords);
  draft.tables.forEach((table, index) => {
    for (const placed of table.cells) {
      if (placed.cell.kind !== "form") continue;
      const own =
        index === selected.table &&
        placed.top === selected.top &&
        placed.left === selected.left;
      if (!own) offer(placed.cell.coords);
    }
  });
  return options;
}

/**
 * The grid, edited as the rectangle it draws.
 *
 * Rows and columns are inserted and removed **at a position**, not only
 * appended: a table is built by widening what is there, and an editor that can
 * only grow at the end makes an author rebuild a row to add a case in the
 * middle. What every operation preserves is the tiling — see
 * `lib/paradigm-draft.ts` — so nothing here can produce a grid the reader
 * cannot draw.
 */
function GridEditor({
  grid,
  grammar,
  lookup,
  selected,
  onSelect,
  onChange,
}: {
  grid: DraftTable;
  grammar: Grammar | undefined;
  lookup: ReadonlyMap<string, GrammarLabel>;
  selected: { top: number; left: number } | null;
  onSelect: (position: { top: number; left: number } | null) => void;
  onChange: (grid: DraftTable) => void;
}) {
  const { t } = useTranslation();
  const columns = Array.from({ length: grid.width }, (_, c) => c);
  const rows = Array.from({ length: grid.height }, (_, r) => r);

  return (
    <div className="mt-2 overflow-x-auto">
      <table className="border-collapse">
        <tbody>
          {/* Column controls. One cell per column, so no span in the body
              below can shift them. */}
          <tr>
            <td className="w-6" />
            {columns.map((c) => (
              <td key={c} className="px-1 pb-1 align-bottom">
                <div className="flex justify-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => onChange(insertColumn(grid, c))}
                    aria-label={t("paradigmEditor.insertColumn")}
                    title={t("paradigmEditor.insertColumn")}
                    className={gridButton}
                  >
                    +
                  </button>
                  <button
                    type="button"
                    disabled={!canRemoveColumn(grid, c)}
                    onClick={() => {
                      onChange(removeColumn(grid, c));
                      onSelect(null);
                    }}
                    aria-label={t("paradigmEditor.removeColumn")}
                    title={t("paradigmEditor.removeColumn")}
                    className={gridButton}
                  >
                    ×
                  </button>
                </div>
              </td>
            ))}
            <td className="px-1 pb-1 align-bottom">
              <button
                type="button"
                onClick={() => onChange(insertColumn(grid, grid.width))}
                aria-label={t("paradigmEditor.addColumn")}
                title={t("paradigmEditor.addColumn")}
                className={gridButton}
              >
                +
              </button>
            </td>
          </tr>
          {rows.map((r) => (
            <tr key={r}>
              <td className="pr-1 align-middle">
                <div className="flex flex-col gap-0.5">
                  <button
                    type="button"
                    disabled={!canInsertRow(grid, r)}
                    onClick={() => onChange(insertRow(grid, r))}
                    aria-label={t("paradigmEditor.insertRow")}
                    title={t("paradigmEditor.insertRow")}
                    className={gridButton}
                  >
                    +
                  </button>
                  <button
                    type="button"
                    disabled={!canRemoveRow(grid)}
                    onClick={() => {
                      onChange(removeRow(grid, r));
                      onSelect(null);
                    }}
                    aria-label={t("paradigmEditor.removeRow")}
                    title={t("paradigmEditor.removeRow")}
                    className={gridButton}
                  >
                    ×
                  </button>
                </div>
              </td>
              {grid.cells
                .filter((placed) => placed.top === r)
                .sort((a, b) => a.left - b.left)
                .map((placed) => {
                  const open =
                    selected !== null &&
                    selected.top === placed.top &&
                    selected.left === placed.left;
                  return (
                    <td
                      key={placed.left}
                      {...(placed.rowSpan > 1 ? { rowSpan: placed.rowSpan } : {})}
                      {...(placed.colSpan > 1 ? { colSpan: placed.colSpan } : {})}
                      className="border p-0"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          onSelect(open ? null : { top: placed.top, left: placed.left })
                        }
                        aria-pressed={open}
                        className={`flex h-full min-h-[2.25rem] w-full min-w-[5rem] flex-col justify-center gap-0.5 px-2 py-1 text-left ${
                          open ? "bg-primary/10 ring-2 ring-inset ring-primary" : "hover:bg-black/5"
                        }`}
                      >
                        <CellSummary cell={placed.cell} grammar={grammar} lookup={lookup} />
                      </button>
                    </td>
                  );
                })}
              <td />
            </tr>
          ))}
          <tr>
            <td className="pr-1 pt-1 align-top">
              <button
                type="button"
                onClick={() => onChange(insertRow(grid, grid.height))}
                aria-label={t("paradigmEditor.addRow")}
                title={t("paradigmEditor.addRow")}
                className={gridButton}
              >
                +
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** What a cell says without being opened. */
function CellSummary({
  cell,
  grammar,
  lookup,
}: {
  cell: ParadigmCell;
  grammar: Grammar | undefined;
  lookup: ReadonlyMap<string, GrammarLabel>;
}) {
  const { t } = useTranslation();
  if (cell.kind === "title") {
    return (
      <span className="text-xs font-medium text-content">
        {cell.text.trim() === "" ? (
          <span className="text-content-subtle">{t("paradigmEditor.cellTitleEmpty")}</span>
        ) : (
          cell.text
        )}
      </span>
    );
  }
  if (cell.kind === "form") {
    const rules = cell.rules?.length ?? 0;
    return (
      <>
        <span className="font-mono text-[0.7rem] text-content">
          <TagLabel tag={coordTag(grammar ?? {}, cell.coords)} lookup={lookup} />
        </span>
        <span className="text-[0.65rem] text-content-subtle">
          {rules === 0
            ? t("paradigmEditor.cellManual")
            : t("paradigmEditor.cellRules", { count: rules })}
        </span>
      </>
    );
  }
  return <span className="text-[0.65rem] text-content-subtle">·</span>;
}

/**
 * The open cell: what kind of thing it is, and what fills it.
 *
 * An inspector rather than editing in place, for one reason that decides it: a
 * form cell carries an address *and* an ordered list of rules, and neither fits
 * in a table cell that also has to be readable as a table. The grid stays a
 * grid; the detail sits under it.
 */
function CellInspector({
  cell,
  grammar,
  lookup,
  spans,
  bases,
  merge,
  onMerge,
  onChange,
}: {
  cell: ParadigmCell;
  grammar: Grammar | undefined;
  lookup: ReadonlyMap<string, GrammarLabel>;
  spans: { rowSpan: number; colSpan: number };
  bases: { text: string; coords: LayoutCoord[] }[];
  merge: { right: boolean; down: boolean; split: boolean };
  onMerge: (how: "right" | "down" | "split") => void;
  onChange: (cell: ParadigmCell) => void;
}) {
  const { t } = useTranslation();
  const rules = rulesOf(cell);

  /** Keep what the other kinds cannot carry out of the way, not silently. */
  function setKind(kind: ParadigmCell["kind"]) {
    if (kind === cell.kind) return;
    if (kind === "title") onChange({ kind: "title", text: "" });
    else if (kind === "empty") onChange({ kind: "empty" });
    else onChange({ kind: "form", coords: [] });
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-content">{t("paradigmEditor.cellTitle")}</p>
        <div className="flex gap-1.5">
          {(["title", "form", "empty"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => setKind(kind)}
              // The three are one choice, so the state has to be announced:
              // without it the only difference between them is a border colour.
              aria-pressed={cell.kind === kind}
              className={
                cell.kind === kind
                  ? "rounded-full border border-primary bg-surface px-2.5 py-1 text-xs font-medium text-primary"
                  : "rounded-full border px-2.5 py-1 text-xs text-content-subtle hover:border-primary hover:text-primary"
              }
            >
              {t(`paradigmEditor.cellKind.${kind}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Merging is authored, and it is authored here: one column or one row at
          a time, and only over filler — so no merge can quietly discard a
          heading somebody wrote or the rules of a cell. */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-content-subtle">
          {t("paradigmEditor.cellSpan", { rows: spans.rowSpan, columns: spans.colSpan })}
        </span>
        <button
          type="button"
          disabled={!merge.right}
          onClick={() => onMerge("right")}
          className="rounded-lg border px-2.5 py-1 text-xs text-content hover:border-primary disabled:opacity-40"
        >
          {t("paradigmEditor.mergeRight")}
        </button>
        <button
          type="button"
          disabled={!merge.down}
          onClick={() => onMerge("down")}
          className="rounded-lg border px-2.5 py-1 text-xs text-content hover:border-primary disabled:opacity-40"
        >
          {t("paradigmEditor.mergeDown")}
        </button>
        <button
          type="button"
          disabled={!merge.split}
          onClick={() => onMerge("split")}
          className="rounded-lg border px-2.5 py-1 text-xs text-content hover:border-primary disabled:opacity-40"
        >
          {t("paradigmEditor.unmerge")}
        </button>
      </div>
      <p className="mt-1 text-[0.7rem] text-content-subtle">{t("paradigmEditor.mergeHint")}</p>

      {cell.kind === "title" && (
        <div className="mt-3">
          <label className="block text-xs text-content-subtle" htmlFor="cell-title-text">
            {t("paradigmEditor.cellTitleText")}
          </label>
          <input
            id="cell-title-text"
            value={cell.text}
            onChange={(e) => onChange({ ...cell, text: e.target.value })}
            className={`mt-1 ${inputClass}`}
          />
        </div>
      )}

      {cell.kind === "form" && (
        <>
          <div className="mt-3">
            <p className="text-xs text-content-subtle">{t("paradigmEditor.cellAddress")}</p>
            <CoordsPicker
              grammar={grammar}
              lookup={lookup}
              coords={cell.coords}
              onChange={(coords) => onChange({ ...cell, coords })}
            />
          </div>

          <div className="mt-3 border-t pt-3">
            <p className="text-xs font-medium text-content">{t("paradigmEditor.rulesTitle")}</p>
            <p className="mt-1 text-xs text-content-subtle">
              {t("paradigmEditor.rulesOrderHint")}
            </p>
            {rules.length === 0 ? (
              <p className="mt-2 text-sm text-content-muted">{t("paradigmEditor.rulesEmpty")}</p>
            ) : (
              <ol className="mt-2 space-y-2">
                {rules.map((rule, i) => (
                  <RuleRow
                    key={i}
                    rule={rule}
                    index={i}
                    count={rules.length}
                    bases={bases}
                    onChange={(patch) =>
                      onChange(
                        withRules(
                          cell,
                          rules.map((row, j) => (j === i ? { ...row, ...patch } : row)),
                        ),
                      )
                    }
                    onMove={(by) => onChange(withRules(cell, movedRules(rules, i, by)))}
                    onRemove={() =>
                      onChange(withRules(cell, rules.filter((_, j) => j !== i)))
                    }
                  />
                ))}
              </ol>
            )}
            {canAddRule(cell) && (
              <button
                type="button"
                onClick={() => onChange(withRules(cell, [...rules, {}]))}
                className="mt-2 rounded-lg border px-3 py-1.5 text-xs text-content hover:border-primary"
              >
                {t("paradigmEditor.rulesAdd")}
              </button>
            )}
          </div>
        </>
      )}
    </>
  );
}

/** One way of building this cell's form. */
function RuleRow({
  rule,
  index,
  count,
  bases,
  onChange,
  onMove,
  onRemove,
}: {
  rule: ParadigmRule;
  index: number;
  count: number;
  bases: { text: string; coords: LayoutCoord[] }[];
  onChange: (patch: Partial<ParadigmRule>) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  return (
    <li className="rounded-lg border bg-surface px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="w-5 text-xs text-content-subtle">{index + 1}.</span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-content-subtle">
          {ruleSummary(rule)}
        </span>
        <button
          type="button"
          disabled={index === 0}
          onClick={() => onMove(-1)}
          aria-label={t("paradigmEditor.moveEarlier")}
          className="px-1 text-content-subtle hover:text-primary disabled:opacity-30"
        >
          ↑
        </button>
        <button
          type="button"
          disabled={index === count - 1}
          onClick={() => onMove(1)}
          aria-label={t("paradigmEditor.moveLater")}
          className="px-1 text-content-subtle hover:text-primary disabled:opacity-30"
        >
          ↓
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label={t("paradigmEditor.removeRule")}
          className="px-1 text-content-subtle hover:text-danger"
        >
          ×
        </button>
      </div>
      {/* The base is a choice, never free text: the options are exactly what
          `unknown-base` accepts, so the defect is unreachable from here. */}
      <label className="mt-2 block text-xs text-content-subtle" htmlFor={`rule-base-${index}`}>
        {t("paradigmEditor.ruleBase")}
      </label>
      <select
        id={`rule-base-${index}`}
        value={rule.base === undefined ? "" : coordsText(rule.base)}
        onChange={(e) => {
          const found = bases.find((option) => option.text === e.target.value);
          onChange({ base: found?.coords });
        }}
        className={`mt-1 ${inputClass}`}
      >
        <option value="">{t("paradigmEditor.ruleBaseLemma")}</option>
        {bases.map((option) => (
          <option key={option.text} value={option.text}>
            {option.text}
          </option>
        ))}
      </select>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <Field
          label={t("paradigmEditor.ruleMatch")}
          value={rule.match ?? ""}
          maxLength={PARADIGM_LIMITS.match}
          onChange={(value) => onChange({ match: value })}
        />
        <div className="hidden sm:block" />
        <Field
          label={t("paradigmEditor.ruleStrip")}
          value={rule.strip ?? ""}
          onChange={(value) => onChange({ strip: value })}
        />
        <Field
          label={t("paradigmEditor.ruleAdd")}
          value={rule.add ?? ""}
          onChange={(value) => onChange({ add: value })}
        />
        <Field
          label={t("paradigmEditor.rulePrefixStrip")}
          value={rule.prefix?.strip ?? ""}
          onChange={(value) => onChange({ prefix: { ...rule.prefix, strip: value } })}
        />
        <Field
          label={t("paradigmEditor.rulePrefixAdd")}
          value={rule.prefix?.add ?? ""}
          onChange={(value) => onChange({ prefix: { ...rule.prefix, add: value } })}
        />
      </div>
    </li>
  );
}

/** A rule's exchange in one line, so an unopened list is still legible. */
function ruleSummary(rule: ParadigmRule): string {
  const parts: string[] = [];
  if (rule.base !== undefined && rule.base.length > 0) parts.push(`← ${coordsText(rule.base)}`);
  if (rule.match !== undefined && rule.match !== "") parts.push(`/${rule.match}/`);
  const strip = rule.strip ?? "";
  const add = rule.add ?? "";
  if (strip !== "" || add !== "") parts.push(`−${strip || "∅"} +${add || "∅"}`);
  const prefixStrip = rule.prefix?.strip ?? "";
  const prefixAdd = rule.prefix?.add ?? "";
  if (prefixStrip !== "" || prefixAdd !== "") {
    parts.push(`${prefixStrip || "∅"}− ${prefixAdd || "∅"}+`);
  }
  return parts.join("  ");
}

/**
 * A cell address, or a required form's: one value picked per feature, from what
 * this language has bound.
 *
 * Two properties matter. It offers **every bound grammatical feature**, not
 * only the category's axis: a conjugation cell is addressed by person, number,
 * tense and mood at once, where a category's axis is the single feature whose
 * default identifies the *headword*. And a feature accepts **several values**,
 * which is the settled spelling of syncretism — one cell covering both genders
 * is `Gender=Fem,Masc`, never two cells that happen to agree.
 *
 * The manual field is the documented degradation, not a fallback for
 * convenience: a language whose values nobody has bound has to stay authorable,
 * and so does an address a bot wrote.
 */
function CoordsPicker({
  grammar,
  lookup,
  coords,
  onChange,
}: {
  grammar: Grammar | undefined;
  lookup: ReadonlyMap<string, GrammarLabel>;
  coords: readonly LayoutCoord[];
  onChange: (coords: LayoutCoord[]) => void;
}) {
  const { t } = useTranslation();
  const [manual, setManual] = useState("");
  const parsed = parseTagInput(manual);
  const features = grammaticalFeatureRows(grammar ?? {}).filter(
    (row) => valueRows(grammar ?? {}, row.feature).length > 0,
  );

  /** Toggle one value of one feature, leaving the other coordinates alone. */
  function toggle(feature: string, value: string) {
    const current = coords.find((coord) => coord.feature === feature);
    const held = new Set(current === undefined ? [] : current.value.split(","));
    if (held.has(value)) held.delete(value);
    else held.add(value);
    // Kept in the language's own declared order, which is stable and is the one
    // order a contributor recognises. Display and matching both normalise it
    // into UD's, so what is stored here is never what is compared.
    const ordered = valueRows(grammar ?? {}, feature)
      .map((row) => row.value)
      .filter((row) => held.has(row));
    for (const extra of held) if (!ordered.includes(extra)) ordered.push(extra);
    const rest = coords.filter((coord) => coord.feature !== feature);
    onChange(
      ordered.length === 0
        ? [...rest]
        : [...rest, { feature, value: ordered.join(",") }],
    );
  }

  return (
    <div className="mt-1">
      {coords.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-xs text-content">
            <TagLabel tag={coordTag(grammar ?? {}, coords)} lookup={lookup} />
          </span>
          <button
            type="button"
            onClick={() => onChange([])}
            aria-label={t("paradigmEditor.clearAddress")}
            title={t("paradigmEditor.clearAddress")}
            className="text-content-subtle hover:text-danger"
          >
            ×
          </button>
        </div>
      )}
      {features.map((feature) => {
        const current = coords.find((coord) => coord.feature === feature.feature);
        const held = new Set(current === undefined ? [] : current.value.split(","));
        return (
          <div key={feature.feature} className="mt-1.5">
            <p className="text-[0.7rem] text-content-subtle">{feature.label.long}</p>
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {valueRows(grammar ?? {}, feature.feature).map((value) => {
                const active = held.has(value.value);
                return (
                  <li key={value.value}>
                    <button
                      type="button"
                      onClick={() => toggle(feature.feature, value.value)}
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
      })}
      <div className="mt-2 flex gap-2">
        <input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          aria-label={t("paradigmEditor.addressManualLabel")}
          placeholder={t("paradigmEditor.addressManualPlaceholder")}
          className={inputClass}
        />
        <button
          type="button"
          disabled={parsed === null || (parsed.feats ?? []).length === 0}
          onClick={() => {
            const feats = parsed?.feats ?? [];
            if (feats.length === 0) return;
            // The part of speech is dropped: an address is a selection of
            // features, and a cell carrying a UPOS would match nothing the
            // scheme-blind join key produces for a form.
            onChange(feats.map((feat) => ({ feature: feat.feature, value: feat.value })));
            setManual("");
          }}
          className="shrink-0 rounded-lg border px-3 py-2 text-sm text-content hover:border-primary disabled:opacity-50"
        >
          {t("paradigmEditor.addressSet")}
        </button>
      </div>
    </div>
  );
}

/**
 * A selector, picked the way an entry's category is picked.
 *
 * Deliberately the **entry editor's own walk** (`categoryRoots` /
 * `categoryRefinements`) rather than a flat list of the language's declared
 * annotations. The two would nearly agree, and where they differ the walk is
 * right: it produces exactly the bundles an entry can be created with — a bare
 * part of speech included, which a language that has declared no category still
 * has — and a paradigm whose selector no entry can carry reaches nothing.
 */
function SelectorPicker({
  grammar,
  lookup,
  chosen,
  onAdd,
}: {
  grammar: Grammar | undefined;
  lookup: ReadonlyMap<string, GrammarLabel>;
  chosen: ReadonlySet<string>;
  onAdd: (selector: Tag) => void;
}) {
  const { t } = useTranslation();
  const [path, setPath] = useState<Tag | null>(null);
  const [manual, setManual] = useState("");
  const parsed = parseTagInput(manual);
  const roots = grammar === undefined ? [] : categoryRoots(grammar);
  const refinements =
    grammar === undefined || path === null ? [] : categoryRefinements(grammar, path);

  function keep(tag: Tag) {
    if (!chosen.has(tagKey(tag))) onAdd(tag);
    setPath(null);
  }

  return (
    <div className="mt-2">
      {path === null ? (
        roots.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {roots.map((root) => (
              <li key={tagKey(root.tag)}>
                <button
                  type="button"
                  onClick={() =>
                    grammar !== undefined && categoryRefinements(grammar, root.tag).length > 0
                      ? setPath(root.tag)
                      : keep(root.tag)
                  }
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
        <div className="rounded-lg border bg-surface-muted/40 p-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-xs text-content">
              <TagLabel tag={path} lookup={lookup} />
            </span>
            <button
              type="button"
              onClick={() => keep(path)}
              className="rounded-full border border-primary px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary hover:text-primary-fg"
            >
              {t("paradigmEditor.selectorKeep")}
            </button>
            <button
              type="button"
              onClick={() => setPath(null)}
              aria-label={t("paradigmEditor.selectorAbandon")}
              title={t("paradigmEditor.selectorAbandon")}
              className="text-content-subtle hover:text-danger"
            >
              ×
            </button>
          </div>
          {refinements.map((refinement) => (
            <div key={refinement.feature.feature} className="mt-2">
              <p className="text-[0.7rem] text-content-subtle">
                {refinement.kind === "axis"
                  ? t("paradigmEditor.selectorAxisStep", {
                      feature: refinement.feature.label.long,
                    })
                  : refinement.feature.label.long}
              </p>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {refinement.options.map((option) => (
                  <li key={tagKey(option.tag)}>
                    <button
                      type="button"
                      onClick={() =>
                        grammar !== undefined &&
                        categoryRefinements(grammar, option.tag).length > 0
                          ? setPath(option.tag)
                          : keep(option.tag)
                      }
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
      <div className="mt-2 flex gap-2">
        <input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          aria-label={t("paradigmEditor.selectorManualLabel")}
          placeholder={t("paradigmEditor.selectorManualPlaceholder")}
          className={inputClass}
        />
        <button
          type="button"
          disabled={parsed === null}
          onClick={() => {
            if (parsed === null) return;
            keep(parsed);
            setManual("");
          }}
          className="shrink-0 rounded-lg border px-3 py-2 text-sm text-content hover:border-primary disabled:opacity-50"
        >
          {t("paradigmEditor.selectorSet")}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  maxLength,
  onChange,
}: {
  label: string;
  value: string;
  maxLength?: number;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="block text-xs text-content-subtle">{label}</span>
      <input
        value={value}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        className={`mt-1 ${inputClass}`}
      />
    </label>
  );
}
