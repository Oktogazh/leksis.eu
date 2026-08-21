import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  mergeParadigms,
  type EntryInflectedForm,
  type GrammarLabel,
} from "@leksis/types";
import type { ResolvedParadigm } from "../lib/paradigms";
import { TagLabel } from "./EntryPreview";

// An entry's other forms, generated and drawn.
//
// **A holding state while the category–axis merge lands** (ADR-0019). This file
// used to draw a resolved *layout* — nested headers, their spans, merged cells
// for syncretism, the two absent states — because the shape of a paradigm's
// tables was declared on the language record and derived from its axes. It is
// not any more: a paradigm record now defines its cells one by one, because real
// conjugation tables are not cartesian products of their axes.
//
// So the tables are gone until slice 4 rebuilds the reader over the stored ones,
// and what is left is the flat list every entry has always fallen back to. That
// fallback was designed to be total precisely so this could happen without a
// reader ever seeing a broken table: forms are printed with their labels, in the
// entry's own order, and a generated one is marked as derived.
//
// Generation itself is untouched — the merger and the generator in
// packages/types are what search ran over the same forms, and the one thing that
// must not drift is which of the two produces what a reader sees.
//
// The table components, the merged-cell geometry and the reader copy for the two
// absent states ("no such form" is not "nobody has filled this in") are worth
// recovering rather than re-deriving: they are in this file, and in
// `entry.*` of the locale, at commit 343516e.

/**
 * One form as this component handles it: the entry's own, or one a paradigm
 * produced.
 *
 * `generated` is the only thing a reader is told about provenance, and it is
 * told visually rather than in words — an italic and a tooltip. A derived form
 * is not a claim the entry's author made, and a dictionary that presented the
 * two identically would be putting words in their mouth.
 */
interface DisplayForm extends EntryInflectedForm {
  generated: boolean;
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

/**
 * What the two conventions on screen mean, printed under the list.
 *
 * The distinction this layer exists to preserve — derived from a rule vs written
 * by the author — was carried entirely by an italic, explained only in a `title`
 * tooltip. A tooltip is invisible on a phone, absent to most assistive
 * technology, and undiscoverable to the reader most likely to need it.
 *
 * **It names only what is on screen**, and one convention on its own explains
 * nothing: "italic means derived" is only information when something non-italic
 * is beside it.
 */
function ParadigmLegend({ forms }: { forms: readonly DisplayForm[] }) {
  const { t } = useTranslation();
  const derived = forms.some((form) => form.generated);
  const asserted = forms.some((form) => !form.generated);
  if (!derived || !asserted) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-content-subtle">
      <li className="flex items-baseline gap-1.5">
        <span aria-hidden="true" className="text-content-muted italic">
          abc
        </span>
        <span>{t("entry.legendDerived")}</span>
      </li>
      <li className="flex items-baseline gap-1.5">
        <span aria-hidden="true" className="text-content-muted">
          abc
        </span>
        <span>{t("entry.legendAsserted")}</span>
      </li>
    </ul>
  );
}

/**
 * An entry's other forms: the ones its author wrote out, plus the ones its
 * language's rules generate.
 *
 * Generation happens here, in the browser, from the records — the AppView's own
 * copy of the rules exists only so search can find an inflected form. The two
 * agree because they call one merger over one generator (morphology invariant
 * 6), and that is the property this holding state keeps: what is *shown* is a
 * flat list rather than a table, but it is the same set of forms search knows.
 *
 * Order is the entry's own, generated forms after asserted ones — which is what
 * `mergeParadigms` returns. It was the axes' declared order before ADR-0019 and
 * will be the paradigm's cell reading order after slice 4; the record's order is
 * the fallback in between, and the one the layer must never break.
 */
export function EntryParadigm({
  lemma,
  forms,
  paradigms,
  lookup,
}: {
  /** The entry's canonical orthography — every rule's implicit starting point. */
  lemma: string;
  /** The forms the entry asserts itself. */
  forms: readonly EntryInflectedForm[];
  /** The language's rules. Empty until layer 5 reaches a language. */
  paradigms: readonly ResolvedParadigm[];
  lookup: ReadonlyMap<string, GrammarLabel>;
}) {
  const { t } = useTranslation();

  // Memoised because it is real work: a dense paradigm is hundreds of cells of
  // regex matching, and the entry page re-renders for every piece of side data
  // it loads. The identity of `forms` and `paradigms` is stable across those
  // renders — both come from state that only a reload replaces.
  const all: DisplayForm[] = useMemo(
    () =>
      mergeParadigms(
        paradigms.map((paradigm) => ({
          id: paradigm.paradigmKey,
          rules: paradigm.record.rules,
          requires: paradigm.record.requires,
        })),
        { lemma, forms },
      ).forms.map((form) => ({
        tag: form.tag,
        form: form.form,
        generated: form.from !== undefined,
      })),
    [paradigms, lemma, forms],
  );
  // `missing` is deliberately dropped. A reader has no use for the news that a
  // principal part is absent — that note is written for contributors, in the
  // rule author's own language, and the language dashboard's queue is where it
  // belongs.

  if (all.length === 0) return null;

  return (
    <div aria-label={t("entry.paradigmLabel")}>
      <ul
        className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
        aria-label={t("entry.otherFormsLabel")}
      >
        {all.map((form, i) => (
          <li key={i} className="text-content">
            <span className="mr-1 font-mono text-xs text-content-muted">
              <TagLabel tag={form.tag} lookup={lookup} />
            </span>
            <FormText form={form} />
          </li>
        ))}
      </ul>
      <ParadigmLegend forms={all} />
    </div>
  );
}
