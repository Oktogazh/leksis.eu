import { useState } from "react";
import { useTranslation } from "react-i18next";
import { parseTagInput, type LayoutCoord, type ResolvedAxis } from "@leksis/types";

/**
 * Building a cell address by picking one value per axis.
 *
 * One selector per axis rather than the narrowing tree the entry editor's form
 * tagger has: axes are orthogonal dimensions, and a cell address takes one
 * value from each independently. The manual field is the degrade-to-manual
 * path, so a language whose axes do not cover the form it wants to print is
 * never stuck — and it is also where a **multivalue** coordinate is written
 * (`Gender=Fem,Masc`), the settled spelling of a form spanning cells, which is
 * why no multivalue picker exists.
 *
 * Extracted from the layout designer at layer 5, where several of these are on
 * screen at once — one per rule target, per base, per required form. Hence the
 * required `id`: two pickers sharing a DOM id would hand every label to the
 * first one.
 */
export function AddressPicker({
  id,
  axes,
  title,
  actionLabel,
  onAdd,
}: {
  /** Unique on the page — several pickers coexist in the rule editor. */
  id: string;
  axes: readonly ResolvedAxis[];
  /** Defaults to the layout designer's own wording. */
  title?: string;
  actionLabel?: string;
  onAdd: (coords: LayoutCoord[]) => void;
}) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [manual, setManual] = useState("");
  const parsed = parseTagInput(manual);
  const manualCoords: LayoutCoord[] = (parsed?.feats ?? []).map((feat) => ({
    feature: feat.feature,
    value: feat.value,
  }));
  const coords: LayoutCoord[] =
    manualCoords.length > 0
      ? manualCoords
      : axes
          .filter((axis) => picked[axis.feature.feature] !== undefined)
          .map((axis) => ({
            feature: axis.feature.feature,
            value: picked[axis.feature.feature]!,
          }));

  return (
    <div className="mt-4 border-t pt-3">
      <p className="text-xs font-medium text-content">{title ?? t("grammar.l4AddItemTitle")}</p>
      {axes.map((axis) => (
        <div key={axis.feature.feature} className="mt-2">
          <p className="text-xs text-content-subtle">{axis.feature.label.long}</p>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {axis.values.map((value) => {
              const active = picked[axis.feature.feature] === value.value;
              return (
                <li key={value.value}>
                  <button
                    type="button"
                    onClick={() =>
                      setPicked((current) => {
                        const next = { ...current };
                        if (active) delete next[axis.feature.feature];
                        else next[axis.feature.feature] = value.value;
                        return next;
                      })
                    }
                    title={value.label.long}
                    className={
                      active
                        ? "rounded-full border border-primary bg-surface px-2.5 py-1 text-xs font-medium text-primary"
                        : "rounded-full border border-dashed px-2.5 py-1 text-xs text-content-muted hover:border-primary hover:text-primary"
                    }
                  >
                    {value.label.short ?? value.label.long}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <label className="mt-3 block text-xs text-content-subtle" htmlFor={id}>
        {t("grammar.l4ManualLabel")}
      </label>
      <div className="mt-1 flex gap-2">
        <input
          id={id}
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder={t("grammar.l4ManualPlaceholder")}
          className="w-full rounded-lg border bg-surface px-3 py-2 text-sm text-content outline-none placeholder:text-content-subtle focus:ring-2"
        />
        <button
          type="button"
          disabled={coords.length === 0}
          onClick={() => {
            onAdd(coords);
            setPicked({});
            setManual("");
          }}
          className="shrink-0 rounded-lg border px-3 py-2 text-sm text-content hover:border-primary disabled:opacity-50"
        >
          {actionLabel ?? t("grammar.l4AddItem")}
        </button>
      </div>
    </div>
  );
}
