import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  annotationConflicts,
  formatAbbreviationRef,
  type AbbreviationView,
  type EntryAnnotation,
  type EntryDefinition,
  type EntryView,
} from "@leksis/types";
import { fetchAbbreviations } from "../lib/api";
import { fetchEntryRecord } from "../lib/atproto-record";
import { definitionsDepth, placeLabel } from "../lib/definition-tree";

/** Indentation per definition depth (its place's length, 1–3). */
const DEPTH_INDENT = ["", "pl-5 sm:pl-6", "pl-10 sm:pl-12"];

/**
 * The flat definitions list, in the record's reading order. Each row shows
 * its full place label — arabic only (1), roman → arabic (2), letters →
 * roman → arabic (3) — and indents by its own depth. Notes matching a
 * conflicted abbreviation pair carry the ⚠ flag. Shared by the entry page
 * and the compact entry preview.
 */
export function DefinitionList({
  definitions,
  abbreviations,
}: {
  definitions: EntryDefinition[];
  abbreviations: AbbreviationView[];
}): ReactNode {
  const { t } = useTranslation();
  const depth = definitionsDepth(definitions);

  function noteTitle(note: EntryAnnotation): string {
    const conflicts = annotationConflicts(note, abbreviations);
    if (conflicts.length === 0) return note.long;
    return `${note.long} — ${t("entry.conflictWarning", {
      pairs: conflicts.map(formatAbbreviationRef).join(", "),
    })}`;
  }

  return (
    <ol className="space-y-4">
      {definitions.map((def, i) => (
        <li
          key={i}
          className={`flex gap-3 ${DEPTH_INDENT[Math.min(def.place.length, 3) - 1]}`}
        >
          <span className="mt-0.5 shrink-0 font-mono text-sm text-content-subtle">
            {placeLabel(depth, def.place)}
          </span>
          <div className="min-w-0">
            {def.notes.length > 0 && (
              <span className="mr-2">
                {def.notes.map((note, j) => {
                  const conflicted = annotationConflicts(note, abbreviations).length > 0;
                  const chipClass = `mr-1 rounded border bg-surface-muted/60 px-1.5 py-0.5 font-mono text-xs text-content-muted ${
                    conflicted ? "border-red-400" : ""
                  }`;
                  return note.short !== undefined ? (
                    <abbr key={j} title={noteTitle(note)} className={`${chipClass} no-underline`}>
                      {conflicted && <span aria-hidden="true">⚠ </span>}
                      {note.short}
                    </abbr>
                  ) : (
                    // No abbreviation: the full form is shown directly, so
                    // there is nothing to reveal on hover (and no conflict —
                    // a pair without a short form never conflicts).
                    <span key={j} className={chipClass}>
                      {note.long}
                    </span>
                  );
                })}
              </span>
            )}
            <span className="text-sm text-content">{def.text}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

interface EntryPreviewProps {
  /** The entry to preview — its recordURI is resolved from the author's PDS. */
  entry: EntryView;
  /** Opens the entry's full page; omit to render the preview with no link out. */
  onOpen?: (key: string) => void;
}

type PreviewState = "loading" | "ready" | "failed";

/**
 * A compact, read-only rendering of one entry's content — orthography,
 * categories, definitions — resolved directly from the author's PDS like the
 * full entry page, but sized for inline inspection (a duplicate-orthography
 * warning, a search result, a future "quick look" affordance) rather than
 * for a standalone route. Deliberately has no knowledge of where it is
 * mounted: callers own layout, framing, and dismissal.
 */
export function EntryPreview({ entry, onOpen }: EntryPreviewProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<PreviewState>("loading");
  const [record, setRecord] = useState<Awaited<ReturnType<typeof fetchEntryRecord>>>(null);
  const [abbreviations, setAbbreviations] = useState<AbbreviationView[]>([]);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setRecord(null);
    fetchAbbreviations(entry.languageID)
      .then((list) => {
        if (!cancelled) setAbbreviations(list);
      })
      .catch(() => {});
    fetchEntryRecord(entry.recordURI)
      .then((content) => {
        if (cancelled) return;
        if (content === null) return setState("failed");
        setRecord(content);
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [entry.recordURI, entry.languageID]);

  return (
    <div className="rounded-lg border bg-surface p-3">
      {state === "loading" && (
        <p className="text-sm text-content-muted">{t("entry.loading")}</p>
      )}
      {state === "failed" && (
        <p className="text-sm text-red-600">{t("entry.recordGone")}</p>
      )}
      {state === "ready" && record !== null && (
        <>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold text-content">{record.orthography[0]}</p>
              {record.orthography.length > 1 && (
                <p className="text-xs text-content-muted">
                  {record.orthography.slice(1).join(", ")}
                </p>
              )}
            </div>
            {onOpen && (
              <button
                type="button"
                onClick={() => onOpen(entry.key)}
                className="shrink-0 text-xs text-primary hover:text-primary-hover"
              >
                {t("entry.viewFull")}
              </button>
            )}
          </div>
          {record.categories.length > 0 && (
            <ul className="mt-2 flex flex-wrap items-center gap-1.5">
              {record.categories.map((category, i) => (
                <li
                  key={i}
                  className="rounded-full border bg-surface-muted/60 px-2 py-0.5 font-mono text-xs text-content"
                >
                  {category.short !== undefined ? (
                    <abbr title={category.long} className="no-underline">
                      {category.short}
                    </abbr>
                  ) : (
                    category.long
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2">
            <DefinitionList definitions={record.definitions} abbreviations={abbreviations} />
          </div>
        </>
      )}
    </div>
  );
}
