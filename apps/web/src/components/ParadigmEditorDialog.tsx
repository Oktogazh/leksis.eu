import { useTranslation } from "react-i18next";
import { formatTagVerbatim, type Tag } from "@leksis/types";

// The rule editor — **disabled while the category–axis merge lands**
// (ADR-0019).
//
// It is not merely out of date: it wrote a shape the lexicon no longer has. A
// paradigm's rules addressed cells that a `layout` on the language record
// derived from its axes, and its `selector` reached entries by containment. Both
// are gone — a paradigm now carries its own tables, cell by cell, and its
// selector is one of the language's declared headword categories, matched
// exactly. Every control in the old editor (the axis-driven address pickers, the
// flat rule list, the live preview against a resolved layout) is a control for
// the shape it is being replaced by.
//
// So this says so and offers nothing, rather than opening on a form whose
// publish button would write a record the AppView refuses (paradigm ingest is
// gated off for the duration — see `ingest-paradigm.ts`). Slice 5 rebuilds it as
// a grid editor; the rule-row UI worth recovering is in this file at commit
// 343516e.
//
// The props are the ones the two call sites already pass, minus everything the
// old body used, so the surfaces around it keep compiling and slice 5 decides
// its own signature.

export interface ParadigmEditorDialogProps {
  /** The category the rules fill cells for — shown, so the notice is about something. */
  selector: Tag;
  onClose: () => void;
}

export function ParadigmEditorDialog({ selector, onClose }: ParadigmEditorDialogProps) {
  const { t } = useTranslation();
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="paradigm-editor-title"
    >
      <div className="flex w-full flex-col overflow-hidden rounded-t-xl border bg-surface shadow-lg sm:max-w-lg sm:rounded-xl">
        <header className="border-b bg-surface-muted/60 px-4 py-3 sm:px-5">
          <h2 id="paradigm-editor-title" className="text-base font-semibold text-content">
            {t("paradigmEditor.title")}
          </h2>
          <p className="mt-1 font-mono text-xs text-content-subtle">
            {formatTagVerbatim(selector)}
          </p>
        </header>
        <div className="p-4 sm:p-5">
          <p className="text-sm text-content-muted">{t("paradigmEditor.rebuilding")}</p>
        </div>
        <footer className="flex justify-end border-t px-4 py-3 sm:px-5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border px-4 py-2 text-sm text-content hover:bg-black/5"
          >
            {t("paradigmEditor.close")}
          </button>
        </footer>
      </div>
    </div>
  );
}
