import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  mergeParadigms,
  paradigmCellAddresses,
  placeForms,
  resolveParadigmTables,
  type EntryInflectedForm,
  type Grammar,
  type GrammarLabel,
  type ResolvedParadigmCell,
  type ResolvedParadigmTable,
} from "@leksis/types";
import type { ResolvedParadigm } from "../lib/paradigms";
import { TagLabel } from "./EntryPreview";

// An entry's other forms, laid out the way its language's rules say to.
//
// This is where the arc's promise lands: opening an entry **hydrates it with
// language-level knowledge** and its forms arrive in a grid instead of a queue.
// What changed with ADR-0019 is where the grid comes from. It used to be
// derived — the cartesian product of a category's axes, arranged by a `layout`
// block on the language record — and it is now **written out in the paradigm
// record**, cell by cell, because real conjugation tables are not products:
// they carry explanatory headings, cells no combination of features names, and
// merges the language never declared as syncretism.
//
// So no arithmetic happens in this file. Which cells exist, how they span, and
// which form lands in which of them is `resolveParadigmTables` and `placeForms`
// in packages/types; here it is only drawn.
//
// Two honest distinctions survive the rewrite, both from ADR-0009 and both
// re-hosted onto the new shape:
//
//   * a **derived** form is not a claim the entry's author made, so it is
//     marked, and the marks are explained in a legend rather than in a tooltip
//     a phone never shows;
//   * a cell **no rule can ever fill** must not look like a cell whose rules
//     simply produced nothing for this word. The first is waiting for somebody
//     to write the form into an entry; the second is the language's own rules
//     declining, and inviting a contributor to "fill it in" would be asking
//     them to fix the wrong record.
//
// Generation itself is untouched — the merger and the generator in
// packages/types are what search ran over the same forms, and the one thing
// that must not drift is which of the two produces what a reader sees.

/**
 * One form as this component handles it: the entry's own, or one a paradigm
 * produced.
 *
 * `generated` is the only thing a reader is told about provenance. `id`
 * identifies the *instance*, which is what lets a form spanning several
 * addresses be recognised as one answer rather than as several that coincide.
 */
interface DisplayForm extends EntryInflectedForm {
  generated: boolean;
  id: number;
}

/** A form's spelling, marked as derived when a rule produced it. */
function FormText({ form }: { form: DisplayForm }) {
  const { t } = useTranslation();
  if (!form.generated) return <>{form.form}</>;
  return (
    <span className="italic" title={t("entry.formGenerated")}>
      {form.form}
    </span>
  );
}

/** The forms of an entry as a flat list — the fallback, and the safe failure. */
function FlatForms({
  forms,
  lookup,
}: {
  forms: readonly DisplayForm[];
  lookup: ReadonlyMap<string, GrammarLabel>;
}) {
  const { t } = useTranslation();
  return (
    <ul
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
      aria-label={t("entry.otherFormsLabel")}
    >
      {forms.map((form) => (
        <li key={form.id} className="text-content">
          <span className="mr-1 font-mono text-xs text-content-muted">
            <TagLabel tag={form.tag} lookup={lookup} />
          </span>
          <FormText form={form} />
        </li>
      ))}
    </ul>
  );
}

/**
 * One drawn table.
 *
 * Every span is the record's own — merging is authored here, not inferred from
 * two cells agreeing — so this component reads them off the resolved cell and
 * passes them to the browser's own table layout. A row of the record is a row
 * of the grid, with the positions covered from above simply absent, which is
 * exactly how an HTML table is written.
 */
function ParadigmTable({
  table,
  cell,
  lookup,
}: {
  table: ResolvedParadigmTable;
  cell: (resolved: Extract<ResolvedParadigmCell, { kind: "form" }>) => ReactNode;
  lookup: ReadonlyMap<string, GrammarLabel>;
}) {
  return (
    <div>
      {table.name !== undefined && table.name !== "" && (
        <p className="mb-1 text-xs font-medium text-content">{table.name}</p>
      )}
      {/* A fifteen-case declension is not a narrow table: it scrolls in its own
          box rather than pushing the page sideways. */}
      <div className="overflow-x-auto">
        <table className="border-collapse text-left">
          <tbody>
            {table.rows.map((row, r) => (
              <tr key={r}>
                {row.map((resolved, c) => {
                  const span = {
                    ...(resolved.colSpan > 1 ? { colSpan: resolved.colSpan } : {}),
                    ...(resolved.rowSpan > 1 ? { rowSpan: resolved.rowSpan } : {}),
                  };
                  if (resolved.kind === "title") {
                    return (
                      <th
                        key={c}
                        {...span}
                        scope="col"
                        className="border bg-surface-muted/60 px-2 py-1 align-top text-xs font-medium text-content"
                      >
                        {resolved.text}
                      </th>
                    );
                  }
                  if (resolved.kind === "empty") {
                    return <td key={c} {...span} className="border bg-surface-muted/30" />;
                  }
                  return (
                    <td
                      key={c}
                      {...span}
                      className="border px-2 py-1 align-top text-sm text-content"
                    >
                      <span className="mr-1 block font-mono text-[0.65rem] text-content-muted">
                        <TagLabel tag={resolved.address.tag} lookup={lookup} />
                      </span>
                      {cell(resolved)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * An entry's other forms: the ones its author wrote out, plus the ones its
 * language's rules generate, in the tables the paradigm draws.
 *
 * The degradation chain is total and ends where the arc started: no paradigm
 * reaches this entry, or none of their cells holds anything → the flat list,
 * which is what every entry showed before this layer existed. Nothing is ever
 * dropped: a form addressing no cell is printed below the tables, which is the
 * failure the whole layer leans on when a hand-written form and a generated one
 * disagree about where they belong.
 */
export function EntryParadigm({
  grammar,
  lemma,
  forms,
  paradigms,
  lookup,
}: {
  /** The language's declarations — what re-qualifies a bare cell address. */
  grammar: Grammar | undefined;
  /** The entry's canonical orthography — every rule's implicit starting point. */
  lemma: string;
  /** The forms the entry asserts itself. */
  forms: readonly EntryInflectedForm[];
  /** The paradigms that reach this entry. Empty until layer 5 reaches a language. */
  paradigms: readonly ResolvedParadigm[];
  lookup: ReadonlyMap<string, GrammarLabel>;
}) {
  const { t } = useTranslation();

  // Generation happens here, in the browser, from the records — the AppView's
  // own copy of the rules exists only so search can find an inflected form. The
  // two agree because they call one merger over one generator (invariant 6).
  //
  // Memoised because it is real work: a dense paradigm is hundreds of cells of
  // regex matching, and the entry page re-renders for every piece of side data
  // it loads. The identity of `forms` and `paradigms` is stable across those
  // renders — both come from state that only a reload replaces.
  const all: DisplayForm[] = useMemo(
    () =>
      mergeParadigms(
        paradigms.map((paradigm) => ({
          id: paradigm.paradigmKey,
          tables: paradigm.record.tables,
          requires: paradigm.record.requires,
        })),
        { lemma, forms },
      ).forms.map((form, id) => ({
        tag: form.tag,
        form: form.form,
        generated: form.from !== undefined,
        id,
      })),
    [paradigms, lemma, forms],
  );
  // `missing` is deliberately dropped. A reader has no use for the news that a
  // principal part is absent — that note is written for contributors, in the
  // rule author's own language, and the language dashboard's queue is where it
  // belongs.

  // The tables of every paradigm reaching this entry, one after another. Under
  // exact match that is at most one in practice; the loop is what keeps the
  // component honest if a language ever declares two selectors onto one bundle.
  const tables = useMemo(
    () => paradigms.flatMap((paradigm) => resolveParadigmTables(grammar, paradigm.record.tables)),
    [grammar, paradigms],
  );

  const placement = useMemo(
    () => placeForms(paradigmCellAddresses(tables), all),
    [tables, all],
  );

  if (all.length === 0 && tables.length === 0) return null;
  if (tables.length === 0) return <FlatForms forms={all} lookup={lookup} />;

  /**
   * The forms in one cell, with the entry's own winning it.
   *
   * `mergeParadigms` already settles the case where an asserted form and a
   * generated one carry the *same* address. This settles the other one, which
   * only a table can see: a form the entry asserts at a more specific address
   * lands in the same cell as a generated one by containment, and the author's
   * word wins. Dropping the generated form rather than printing both is what
   * keeps a cell one answer.
   */
  const held = (key: string): readonly DisplayForm[] | undefined => {
    const there = placement.placed.get(key);
    if (there === undefined || there.length === 0) return undefined;
    const asserted = there.filter((form) => !form.generated);
    return asserted.length > 0 ? asserted : there;
  };

  const cellText = (
    resolved: Extract<ResolvedParadigmCell, { kind: "form" }>,
  ): ReactNode => {
    const there = held(resolved.address.key);
    if (there === undefined) {
      // The two absent states, and the whole reason this is not simply blank.
      // A cell with no rule can only ever be filled by an entry writing the
      // form out; a cell with rules that declined is the language's own answer
      // for this word, and inviting somebody to "fill it in" would point them
      // at the wrong record.
      const manual = resolved.rules.length === 0;
      return (
        <>
          <span aria-hidden="true" className="text-content-subtle">
            {manual ? "·" : "—"}
          </span>
          <span className="sr-only">
            {manual ? t("entry.formUnknown") : t("entry.formNotGenerated")}
          </span>
        </>
      );
    }
    // Several forms genuinely sharing one cell are printed as they were
    // written. What is *not* printed twice is one form spanning several cells:
    // that is one object landing in each of them, and the record draws those
    // cells merged.
    return there.map((form, i) => (
      <span key={form.id}>
        {i > 0 ? ", " : ""}
        <FormText form={form} />
      </span>
    ));
  };

  return (
    <div aria-label={t("entry.paradigmLabel")}>
      <div className="space-y-3">
        {tables.map((table, i) => (
          <ParadigmTable key={i} table={table} cell={cellText} lookup={lookup} />
        ))}
      </div>
      <ParadigmLegend tables={tables} held={held} forms={all} />
      {/* Addressing no declared cell is not a reason to disappear. */}
      {placement.leftover.length > 0 && (
        <div className="mt-2">
          <FlatForms forms={placement.leftover} lookup={lookup} />
        </div>
      )}
    </div>
  );
}

/**
 * What the table's conventions mean, printed under it.
 *
 * The distinctions this layer exists to preserve — derived from a rule vs
 * written by the author, a cell no rule can fill vs one whose rules declined —
 * are carried by an italic and two punctuation marks. A tooltip is invisible on
 * a phone, absent to most assistive technology, and undiscoverable to the
 * reader most likely to need it.
 *
 * **It names only what is on screen.** A paradigm with no derived form should
 * not explain italics, and one with no unfilled cell should not teach a dot the
 * reader will never meet — a legend for absent things is how a legend becomes
 * noise people learn to skip.
 */
function ParadigmLegend({
  tables,
  held,
  forms,
}: {
  tables: readonly ResolvedParadigmTable[];
  held: (key: string) => readonly DisplayForm[] | undefined;
  forms: readonly DisplayForm[];
}): ReactNode {
  const { t } = useTranslation();

  let manual = false;
  let ungenerated = false;
  for (const table of tables) {
    for (const row of table.rows) {
      for (const cell of row) {
        if (cell.kind !== "form" || held(cell.address.key) !== undefined) continue;
        if (cell.rules.length === 0) manual = true;
        else ungenerated = true;
      }
    }
  }
  const derived = forms.some((form) => form.generated);
  const asserted = forms.some((form) => !form.generated);

  // One convention on its own explains nothing — "italic means derived" is only
  // information when something non-italic is beside it.
  const rows: { mark: ReactNode; text: string }[] = [];
  if (derived && asserted) {
    rows.push({ mark: <span className="italic">abc</span>, text: t("entry.legendDerived") });
    rows.push({ mark: <span>abc</span>, text: t("entry.legendAsserted") });
  }
  if (manual) rows.push({ mark: <span>·</span>, text: t("entry.legendEmpty") });
  if (ungenerated) rows.push({ mark: <span>—</span>, text: t("entry.legendNotGenerated") });
  if (rows.length === 0) return null;

  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-content-subtle">
      {rows.map((row, i) => (
        <li key={i} className="flex items-baseline gap-1.5">
          <span aria-hidden="true" className="text-content-muted">
            {row.mark}
          </span>
          <span>{row.text}</span>
        </li>
      ))}
    </ul>
  );
}
