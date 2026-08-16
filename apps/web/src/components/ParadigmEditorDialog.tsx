import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  applicableAxes,
  coordTag,
  formatTagVerbatim,
  generateForms,
  paradigmIssues,
  paradigmRkey,
  LEKSIS_PARADIGM_COLLECTION,
  PARADIGM_LIMITS,
  type EntryInflectedForm,
  type Grammar,
  type GrammarLabel,
  type LayoutCoord,
  type Tag,
} from "@leksis/types";
import { AddressPicker } from "./AddressPicker";
import { EntryParadigm } from "./ParadigmView";
import { useSession } from "../auth/SessionProvider";
import { fetchLanguageParadigms } from "../lib/api";
import { fetchParadigmRecord } from "../lib/atproto-record";
import { forgetParadigms } from "../lib/paradigms";
import {
  addNote,
  addReference,
  addRequirement,
  addRule,
  canAddRequirement,
  canAddRule,
  emptyDraft,
  fromRecord,
  moveRule,
  removeNote,
  removeReference,
  removeRequirement,
  removeRule,
  toRecord,
  updateNote,
  updateReference,
  updateRequirement,
  updateRule,
  type ParadigmDraft,
} from "../lib/paradigm-draft";

// Writing a language's inflection rules.
//
// A **separate dialog** rather than a level of the grammar dialog it usually
// opens from, because it publishes a **different record**: its own key, its own
// issue gate, its own concurrency guard. The grammar dialog has one draft and
// one publish footer bound to the language record, and a second draft behind
// that same footer is how a contributor loses an edit. Two records, two
// dialogs. It is also what lets the entry page's cell popover open the very
// same editor.

const inputClass =
  "w-full rounded-lg border bg-surface px-3 py-2 text-sm text-content outline-none placeholder:text-content-subtle focus:ring-2";

/** A cell address written the way UD writes a bundle — the editor's own shorthand. */
function coordsText(coords: readonly LayoutCoord[]): string {
  return formatTagVerbatim({ feats: coords.map((c) => ({ feature: c.feature, value: c.value })) });
}

export interface ParadigmEditorDialogProps {
  /** BCP 47 tag of the language these rules belong to. */
  tag: string;
  /** The language's grammar, for the address pickers and the preview. */
  grammar: Grammar | undefined;
  lookup: ReadonlyMap<string, GrammarLabel>;
  /** The category the rules fill cells for. Immutable — see `ParadigmDraft`. */
  selector: Tag;
  /** Present when rewriting: the pointer the AppView served, and its cid. */
  existing?: { paradigmKey: string; recordURI: string; cid: string };
  /** Pre-address a first rule at this cell — the entry page's empty-cell door. */
  seedCoords?: LayoutCoord[];
  onClose: () => void;
  onPublished: (paradigmKey: string) => void;
}

export function ParadigmEditorDialog({
  tag,
  grammar,
  lookup,
  selector,
  existing,
  seedCoords,
  onClose,
  onPublished,
}: ParadigmEditorDialogProps) {
  const { t } = useTranslation();
  const { agent, did } = useSession();

  const [loading, setLoading] = useState(existing !== undefined);
  /** null while loading, and after a load that failed — the two are told apart by `loading`. */
  const [draft, setDraft] = useState<ParadigmDraft | null>(
    existing === undefined ? seededDraft(selector, seedCoords) : null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lemma, setLemma] = useState("");
  /** One specimen per required address, keyed by the address's own text. */
  const [samples, setSamples] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    if (existing === undefined) return;
    let live = true;
    fetchParadigmRecord(existing.recordURI)
      .then((record) => {
        if (!live) return;
        // A record that could not be read leaves the draft null on purpose. An
        // empty draft here would publish a rewrite that silently discarded
        // every rule this author never saw.
        setDraft(record === null ? null : seedInto(fromRecord(record), seedCoords));
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
  }, [existing, seedCoords]);

  /**
   * Escape closes **this** dialog only.
   *
   * It usually sits on top of the grammar dialog, which has its own handler; a
   * bubbling keystroke would close both and lose the grammar draft behind it.
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

  const axes = useMemo(() => applicableAxes(grammar ?? {}, [selector]), [grammar, selector]);

  /**
   * Every defect in the draft — **the same function ingest runs**, so a record
   * this dialog refuses to write is exactly the record the AppView would refuse
   * to index (ADR-0015). Any defect blocks, not only one this edit introduced.
   */
  const defects = useMemo(() => (draft === null ? [] : paradigmIssues(draft)), [draft]);

  /** The entry facts the preview generates against: a specimen lemma and its principal parts. */
  const facts = useMemo(() => {
    const forms: EntryInflectedForm[] = (draft?.requires ?? [])
      .map((row) => ({ tag: coordTag(grammar ?? {}, row.coords), form: samples[coordsText(row.coords)] ?? "" }))
      .filter((row) => row.form !== "");
    return { lemma: lemma.trim(), forms };
  }, [draft, grammar, samples, lemma]);

  const preview = useMemo(
    () => (draft === null || facts.lemma === "" ? null : generateForms(toPreviewRecord(draft), facts)),
    [draft, facts],
  );

  async function publish() {
    if (draft === null || agent === null || did === null) return;
    setSubmitting(true);
    setError(null);
    try {
      // The concurrency guard. A paradigm's blast radius is every entry of a
      // category, and strangers rewrite it — so a copy loaded ten minutes ago
      // must not overwrite one published since. Skipped when creating: there is
      // then no other author's work to lose.
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
      // rkey = the language plus a hash of the selector, recomputed from the
      // record's own fields — every author's paradigm for one category shares
      // one identity, and ingest refuses a key that disagrees with it.
      const rkey = paradigmRkey(record);
      await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: LEKSIS_PARADIGM_COLLECTION,
        rkey,
        // putRecord wants an index signature our interface doesn't declare.
        record: { ...record },
      });
      forgetParadigms(tag);
      onPublished(rkey);
    } catch (err) {
      console.error("putRecord failed:", err);
      setError(t("paradigmEditor.errors.writeFailed"));
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="paradigm-editor-title"
    >
      <div className="flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden rounded-t-xl border bg-surface shadow-lg sm:max-w-2xl sm:rounded-xl">
        <header className="border-b bg-surface-muted/60 px-4 py-3 sm:px-5">
          <h2 id="paradigm-editor-title" className="text-base font-semibold text-content">
            {t("paradigmEditor.title")}
          </h2>
          <p className="mt-1 text-sm text-content-muted">{t("paradigmEditor.intro")}</p>
          {/* The selector is shown and not offered: the record key hashes it,
              so editing it would be publishing a different paradigm. */}
          <p className="mt-2 text-xs text-content-subtle">
            {t("paradigmEditor.selectorLocked")}{" "}
            <span className="font-mono text-content">{formatTagVerbatim(selector)}</span>
          </p>
        </header>

        {loading ? (
          <p className="p-5 text-sm text-content-muted">{t("paradigmEditor.loading")}</p>
        ) : draft === null ? (
          <p className="p-5 text-sm text-content-muted">{t("paradigmEditor.recordUnavailable")}</p>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
            {/* What this language calls the paradigm. */}
            <section>
              <p className="text-xs font-medium text-content">{t("paradigmEditor.labelTitle")}</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <input
                  value={draft.label.long}
                  onChange={(e) => setDraft({ ...draft, label: { ...draft.label, long: e.target.value } })}
                  placeholder={t("paradigmEditor.labelLong")}
                  className={inputClass}
                />
                <input
                  value={draft.label.short}
                  onChange={(e) => setDraft({ ...draft, label: { ...draft.label, short: e.target.value } })}
                  placeholder={t("paradigmEditor.labelShort")}
                  className={inputClass}
                />
              </div>
            </section>

            {/* Principal parts: the forms the rules cannot derive and the entry
                must supply. The message is the contributor's, verbatim. */}
            <section className="mt-5 border-t pt-4">
              <p className="text-xs font-medium text-content">{t("paradigmEditor.requiresTitle")}</p>
              <p className="mt-1 text-xs text-content-subtle">{t("paradigmEditor.requiresHint")}</p>
              {draft.requires.length > 0 && (
                <ul className="mt-2 space-y-2">
                  {draft.requires.map((row, i) => (
                    <li key={i} className="rounded-lg border bg-surface px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate font-mono text-xs text-content">
                          {coordsText(row.coords)}
                        </span>
                        <button
                          type="button"
                          onClick={() => setDraft(removeRequirement(draft, i))}
                          aria-label={t("paradigmEditor.removeRequirement")}
                          className="px-1 text-content-subtle hover:text-red-600"
                        >
                          ×
                        </button>
                      </div>
                      <textarea
                        value={row.message}
                        onChange={(e) => setDraft(updateRequirement(draft, i, { message: e.target.value }))}
                        placeholder={t("paradigmEditor.requiresMessage")}
                        rows={2}
                        className={`mt-2 ${inputClass}`}
                      />
                    </li>
                  ))}
                </ul>
              )}
              {canAddRequirement(draft) && (
                <AddressPicker
                  id="paradigm-requires-manual"
                  axes={axes}
                  title={t("paradigmEditor.requiresAdd")}
                  onAdd={(coords) => setDraft(addRequirement(draft, coords))}
                />
              )}
            </section>

            {/* The rules themselves. Order is meaning: the first matching row
                fills the cell, which is why every row can be moved. */}
            <section className="mt-5 border-t pt-4">
              <p className="text-xs font-medium text-content">{t("paradigmEditor.rulesTitle")}</p>
              <p className="mt-1 text-xs text-content-subtle">{t("paradigmEditor.rulesOrderHint")}</p>
              {draft.rules.length === 0 ? (
                <p className="mt-2 text-sm text-content-muted">{t("paradigmEditor.rulesEmpty")}</p>
              ) : (
                <ol className="mt-2 space-y-1.5">
                  {draft.rules.map((row, i) => (
                    <li key={i} className="rounded-lg border bg-surface">
                      <div className="flex items-center gap-2 px-3 py-2">
                        <span className="w-5 text-xs text-content-subtle">{i + 1}.</span>
                        <button
                          type="button"
                          onClick={() => setOpen(open === i ? null : i)}
                          className="min-w-0 flex-1 truncate text-left font-mono text-xs text-content hover:text-primary"
                        >
                          {coordsText(row.coords)}
                          <span className="ml-2 text-content-subtle">{ruleSummary(row)}</span>
                        </button>
                        <button
                          type="button"
                          disabled={i === 0}
                          onClick={() => setDraft(moveRule(draft, i, -1))}
                          aria-label={t("paradigmEditor.moveEarlier")}
                          className="px-1 text-content-subtle hover:text-primary disabled:opacity-30"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          disabled={i === draft.rules.length - 1}
                          onClick={() => setDraft(moveRule(draft, i, 1))}
                          aria-label={t("paradigmEditor.moveLater")}
                          className="px-1 text-content-subtle hover:text-primary disabled:opacity-30"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDraft(removeRule(draft, i));
                            setOpen(null);
                          }}
                          aria-label={t("paradigmEditor.removeRule")}
                          className="px-1 text-content-subtle hover:text-red-600"
                        >
                          ×
                        </button>
                      </div>
                      {open === i && (
                        <div className="border-t px-3 py-3">
                          {/* The base is a choice, never free text: the options
                              are exactly what `unknown-base` accepts, so the
                              defect is unreachable from this control. */}
                          <label className="block text-xs text-content-subtle" htmlFor={`rule-base-${i}`}>
                            {t("paradigmEditor.ruleBase")}
                          </label>
                          <select
                            id={`rule-base-${i}`}
                            value={row.base === undefined ? "" : coordsText(row.base)}
                            onChange={(e) => {
                              const found = baseOptions(draft, i).find((o) => o.text === e.target.value);
                              setDraft(updateRule(draft, i, { base: found?.coords }));
                            }}
                            className={`mt-1 ${inputClass}`}
                          >
                            <option value="">{t("paradigmEditor.ruleBaseLemma")}</option>
                            {baseOptions(draft, i).map((option) => (
                              <option key={option.text} value={option.text}>
                                {option.text}
                              </option>
                            ))}
                          </select>
                          <div className="mt-3 grid gap-2 sm:grid-cols-2">
                            <Field
                              label={t("paradigmEditor.ruleMatch")}
                              value={row.match ?? ""}
                              maxLength={PARADIGM_LIMITS.match}
                              onChange={(value) => setDraft(updateRule(draft, i, { match: value }))}
                            />
                            <Field
                              label={t("paradigmEditor.ruleStrip")}
                              value={row.strip ?? ""}
                              onChange={(value) => setDraft(updateRule(draft, i, { strip: value }))}
                            />
                            <Field
                              label={t("paradigmEditor.ruleAdd")}
                              value={row.add ?? ""}
                              onChange={(value) => setDraft(updateRule(draft, i, { add: value }))}
                            />
                            <div />
                            <Field
                              label={t("paradigmEditor.rulePrefixStrip")}
                              value={row.prefix?.strip ?? ""}
                              onChange={(value) =>
                                setDraft(updateRule(draft, i, { prefix: { ...row.prefix, strip: value } }))
                              }
                            />
                            <Field
                              label={t("paradigmEditor.rulePrefixAdd")}
                              value={row.prefix?.add ?? ""}
                              onChange={(value) =>
                                setDraft(updateRule(draft, i, { prefix: { ...row.prefix, add: value } }))
                              }
                            />
                          </div>
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              )}
              {canAddRule(draft) && (
                <AddressPicker
                  id="paradigm-rule-manual"
                  axes={axes}
                  title={t("paradigmEditor.rulesAdd")}
                  onAdd={(coords) => {
                    setDraft(addRule(draft, coords));
                    setOpen(draft.rules.length);
                  }}
                />
              )}
            </section>

            {/* The live preview: this draft, over one specimen, drawn by the
                reader's own component. Building a second table here is how the
                editor's idea of a cell would come to differ from the page's. */}
            <section className="mt-5 border-t pt-4">
              <p className="text-xs font-medium text-content">{t("paradigmEditor.previewTitle")}</p>
              <input
                value={lemma}
                onChange={(e) => setLemma(e.target.value)}
                placeholder={t("paradigmEditor.previewLemma")}
                className={`mt-2 ${inputClass}`}
              />
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
              {preview !== null && (
                <div className="mt-3">
                  {preview.forms.length === 0 && preview.missing.length === 0 && (
                    <p className="text-sm text-content-muted">{t("paradigmEditor.previewNothing")}</p>
                  )}
                  {preview.forms.length > 0 && (
                    <EntryParadigm
                      grammar={grammar}
                      categories={[selector]}
                      lemma={facts.lemma}
                      forms={facts.forms}
                      paradigms={[{ paradigmKey: "draft", record: toPreviewRecord(draft) }]}
                      lookup={lookup}
                    />
                  )}
                  {/* The author's own words, printed as written: the whole
                      point of putting the message in the rule is that a
                      speaker wrote it. */}
                  {preview.missing.length > 0 && (
                    <div className="mt-2 rounded-lg border bg-surface-muted/60 px-3 py-2">
                      <p className="text-xs font-medium text-content">
                        {t("paradigmEditor.previewMissingTitle")}
                      </p>
                      <ul className="mt-1 space-y-1">
                        {preview.missing.map((row) => (
                          <li key={row.key} className="text-sm text-content-muted">
                            {row.message}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* Remarks and sources for the rules themselves. */}
            <section className="mt-5 border-t pt-4">
              <p className="text-xs font-medium text-content">{t("paradigmEditor.notesTitle")}</p>
              {draft.notes.map((note, i) => (
                <div key={i} className="mt-2 flex gap-2">
                  <input
                    value={note}
                    onChange={(e) => setDraft(updateNote(draft, i, e.target.value))}
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={() => setDraft(removeNote(draft, i))}
                    aria-label={t("paradigmEditor.removeNote")}
                    className="px-1 text-content-subtle hover:text-red-600"
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
                    className={inputClass}
                  />
                  <input
                    value={row.url ?? ""}
                    onChange={(e) => setDraft(updateReference(draft, i, { url: e.target.value }))}
                    placeholder={t("paradigmEditor.referenceUrl")}
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={() => setDraft(removeReference(draft, i))}
                    aria-label={t("paradigmEditor.removeReference")}
                    className="px-1 text-content-subtle hover:text-red-600"
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
                <li key={i} className="text-xs text-red-600">
                  {t(`paradigmEditor.issue.${defect.kind}`)}
                  {defect.address !== undefined && (
                    <span className="ml-1 font-mono text-content-muted">{defect.address}</span>
                  )}
                  {defect.base !== undefined && (
                    <span className="ml-1 font-mono text-content-muted">{defect.base}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {error !== null && <p className="mb-2 text-xs text-red-600">{error}</p>}
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
              disabled={draft === null || defects.length > 0 || submitting || agent === null}
              onClick={() => void publish()}
              className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
            >
              {submitting ? t("paradigmEditor.publishing") : t("paradigmEditor.publish")}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

/** A new draft, with the clicked cell already addressed when one came in. */
function seededDraft(selector: Tag, seedCoords: LayoutCoord[] | undefined): ParadigmDraft {
  return seedInto(emptyDraft(selector), seedCoords);
}

/**
 * Add a rule for the cell the entry page's popover was opened on — unless the
 * paradigm already fills it, in which case the author came to *edit* that rule
 * and a duplicate target would quietly shadow it.
 */
function seedInto(draft: ParadigmDraft, seedCoords: LayoutCoord[] | undefined): ParadigmDraft {
  if (seedCoords === undefined || seedCoords.length === 0) return draft;
  const already = draft.rules.some(
    (row) => coordsText(row.coords) === coordsText(seedCoords),
  );
  return already ? draft : addRule(draft, [...seedCoords]);
}

/** The draft as the generator and the reader see it — record fields only. */
function toPreviewRecord(draft: ParadigmDraft) {
  return toRecord(draft, { languageID: "und", createdAt: "1970-01-01T00:00:00.000Z" });
}

/** A rule's exchange in one line, so the order of the list is legible unopened. */
function ruleSummary(row: { match?: string; strip?: string; add?: string }): string {
  const parts: string[] = [];
  if (row.match !== undefined && row.match !== "") parts.push(`/${row.match}/`);
  const strip = row.strip ?? "";
  const add = row.add ?? "";
  if (strip !== "" || add !== "") parts.push(`−${strip || "∅"} +${add || "∅"}`);
  return parts.join("  ");
}

/**
 * What a rule may start from: a required form, or a cell an earlier or later
 * rule generates. Its own target is excluded — a rule based on itself is the
 * shortest possible `base-cycle`.
 */
function baseOptions(draft: ParadigmDraft, index: number): { text: string; coords: LayoutCoord[] }[] {
  const seen = new Set<string>();
  const options: { text: string; coords: LayoutCoord[] }[] = [];
  const offer = (coords: LayoutCoord[]) => {
    const text = coordsText(coords);
    if (text === "" || seen.has(text)) return;
    seen.add(text);
    options.push({ text, coords });
  };
  for (const row of draft.requires) offer(row.coords);
  draft.rules.forEach((row, i) => {
    if (i !== index) offer(row.coords);
  });
  return options;
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
