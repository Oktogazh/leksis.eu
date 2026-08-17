import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  labelLookup,
  resolveTag,
  type LabelView,
  type EntryDefinition,
  type EntryView,
  type Tag,
} from "@leksis/types";
import { fetchLabels } from "../lib/api";
import { fetchEntryRecord } from "../lib/atproto-record";
import { definitionsDepth, placeLabel } from "../lib/definition-tree";
import { ExampleSentences } from "./ExampleSentences";

/**
 * A tag's chips, resolved against what the language has bound:
 * exact bundle match → decomposition into bound parts → the raw identifier.
 *
 * An unresolved chip is shown as the tag itself, visibly styled as unbound,
 * and never as UD's English name: an untranslated identifier reads as "this
 * needs binding", which is the signal wanted, whereas an English gloss would
 * read as content and break the homolingual rule. Bots know the tag long
 * before any label exists, so this is the common path, not an edge case.
 */
export function TagChips({
  tags,
  lookup,
  className = "",
}: {
  tags: readonly Tag[];
  lookup: ReadonlyMap<string, { long: string; short?: string }>;
  className?: string;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <>
      {tags.flatMap((tag, i) =>
        resolveTag(tag, lookup).map((part, j) =>
          part.bound && part.label !== undefined ? (
            <li
              key={`${i}-${j}`}
              className={`rounded-full border bg-surface-muted/60 px-2.5 py-1 font-mono text-xs text-content ${className}`}
            >
              {part.label.short !== undefined ? (
                <abbr title={part.label.long} className="no-underline">
                  {part.label.short}
                </abbr>
              ) : (
                part.label.long
              )}
            </li>
          ) : (
            <li
              key={`${i}-${j}`}
              title={t("entry.unboundTag")}
              className={`rounded-full border border-dashed border-warning/70 px-2.5 py-1 font-mono text-xs text-warning ${className}`}
            >
              {part.verbatim}
            </li>
          ),
        ),
      )}
    </>
  );
}

/**
 * One tag rendered inline, where a chip list would be wrong — the label
 * standing before an inflected form's spelling. Same resolution chain and same
 * unbound styling as `TagChips`, as text rather than as list items, so it can
 * sit inside a line that is already a list item.
 */
export function TagLabel({
  tag,
  lookup,
}: {
  tag: Tag;
  lookup: ReadonlyMap<string, { long: string; short?: string }>;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <span className="inline-flex gap-1">
      {resolveTag(tag, lookup).map((part, i) =>
        part.bound && part.label !== undefined ? (
          <span key={i}>
            {part.label.short !== undefined ? (
              <abbr title={part.label.long} className="no-underline">
                {part.label.short}
              </abbr>
            ) : (
              part.label.long
            )}
          </span>
        ) : (
          <span
            key={i}
            title={t("entry.unboundTag")}
            className="text-warning"
          >
            {part.verbatim}
          </span>
        ),
      )}
    </span>
  );
}

/** Indentation per definition depth (its place's length, 1–3). */
const DEPTH_INDENT = ["", "pl-5 sm:pl-6", "pl-10 sm:pl-12"];

/**
 * The flat definitions list, in the record's reading order. Each row shows
 * its full place label — arabic only (1), roman → arabic (2), letters →
 * roman → arabic (3) — and indents by its own depth. Notes matching a
 * conflicting label carry the ⚠ flag. Shared by the entry page
 * and the compact entry preview.
 */
export function DefinitionList({
  definitions,
  labels,
  senseExtras,
  showExamples = false,
  onDescribeSource,
}: {
  definitions: EntryDefinition[];
  labels: LabelView[];
  /**
   * Extra content rendered under a definition, keyed by its canonical place
   * ("2.1"). A render slot rather than a relations prop: the entry page hangs
   * a sense's translations here, while the compact preview passes nothing and
   * is unchanged.
   */
  senseExtras?: ReadonlyMap<string, ReactNode>;
  /**
   * Whether a leaf's example sentences are printed. **Off by default, and the
   * compact preview leaves it off deliberately**: the preview is a summary that
   * already omits the etymology, the notes and the forms, examples are the
   * bulkiest thing an entry carries, and each cited work costs a resolution the
   * caller did not ask for. The entry page — where an example is the point —
   * turns it on.
   */
  showExamples?: boolean;
  /**
   * Offered beside a citation whose work nobody has described yet. Omit for a
   * reader who cannot publish; passing it is what turns the degraded citation
   * into an invitation.
   */
  onDescribeSource?: (oclc: string) => void;
}): ReactNode {
  const depth = definitionsDepth(definitions);
  const lookup = labelLookup(labels);

  // Indentation by displayed depth (0s in the place are skipped, so a place
  // like [0, 1, 1] renders at depth 2, not 3).
  const displayedDepth = (place: number[]) =>
    place.filter((n, i) => n !== 0 || i === place.length - 1).filter((n) => n !== 0).length;

  return (
    // Set as a dictionary column, not as a list of cards.
    //
    // Two changes from the original, both in the service of the same task.
    // Senses used to sit 16px apart, which reads as a feed of separate items;
    // the reading a dictionary is actually for is *comparing* senses, and that
    // wants them close enough to take in together. And the sense number used to
    // be monospaced, which made the structure look like code — it is now set in
    // the body face with tabular figures and right-aligned into a fixed column,
    // so the numbers align down the page and the definitions hang off a common
    // edge. That is the printed convention, and it is a convention because it
    // works.
    <ol className="space-y-2.5">
      {definitions.map((def, i) => {
        const notes = def.notes ?? [];
        return (
          <li
            key={i}
            // The named group the per-sense actions reveal themselves against —
            // named, because the entry page nests groups and an unnamed
            // `group-hover` would fire on whichever ancestor happened to be
            // closest.
            className={`group/sense flex gap-2.5 ${DEPTH_INDENT[Math.max(displayedDepth(def.place), 1) - 1]}`}
          >
            <span className="shrink-0 basis-12 text-right text-sm font-medium tabular-nums text-content-subtle">
              {placeLabel(depth, def.place)}
            </span>
            <div className="min-w-0">
              {def.categories !== undefined && def.categories.length > 0 && (
                <ul className="mr-2 inline-flex flex-wrap items-center gap-1 align-middle">
                  <TagChips tags={def.categories} lookup={lookup} />
                </ul>
              )}
              {notes.length > 0 && (
                <span className="mr-2 text-sm italic text-content-muted">
                  {notes.join(" · ")}
                </span>
              )}
              {/* A group node is a heading: it carries notes but no text.
                  Which kind a node is follows from the parsed record, not
                  from its place — see parseDefinitions on the pre-v0.8
                  coordinates still in the index. */}
              {def.text !== undefined && (
                <span className="text-sm text-content">{def.text}</span>
              )}
              {/* Leaves only — a heading has no sense of its own to
                  exemplify — which is why this hangs off `text` being present
                  rather than off the place. */}
              {showExamples && def.text !== undefined && def.examples !== undefined && (
                <ExampleSentences
                  examples={def.examples}
                  {...(onDescribeSource !== undefined ? { onDescribeSource } : {})}
                />
              )}
              {senseExtras?.get(def.place.filter((n) => n !== 0).join("."))}
            </div>
          </li>
        );
      })}
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
  const [labels, setLabels] = useState<LabelView[]>([]);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setRecord(null);
    fetchLabels(entry.languageID)
      .then((list) => {
        if (!cancelled) setLabels(list);
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
        <p className="text-sm text-danger">{t("entry.recordGone")}</p>
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
              {record.transcription !== undefined && record.transcription !== "" && (
                <p
                  className="font-mono text-xs text-content-muted"
                  aria-label={t("entry.transcriptionLabel")}
                >
                  {record.transcription}
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
              <TagChips tags={record.categories} lookup={labelLookup(labels)} />
            </ul>
          )}
          <div className="mt-2">
            <DefinitionList definitions={record.definitions} labels={labels} />
          </div>
        </>
      )}
    </div>
  );
}
