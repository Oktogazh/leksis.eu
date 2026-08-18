import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  formatLabelRef,
  formatTagVerbatim,
  type Grammar,
  type LabelView,
} from "@leksis/types";
import {
  labelCollator,
  labelShelf,
  sortShelfRows,
  type ShelfRow,
  type ShelfSort,
  type ShelfTab,
  type ShelfTabID,
} from "../lib/label-shelf";

/**
 * A language's front matter, read rather than edited: what it calls its parts
 * of speech, its features and their values, its inflection classes, its
 * lexicographic labels, its named categories and its plain abbreviations.
 *
 * **The kind of a row is the tab it is on**, which is what the coloured badge
 * beside every row used to say one row at a time. The tabs are the binding
 * editor's own doors, in its order, so a contributor looking for something
 * finds it where they declared it.
 *
 * The three tabs whose rows are *sets of options* have a second layer: a
 * feature declares nothing on its own — `Gender` is a question, `Gender=Fem` an
 * answer — so one is picked before any values are shown. That is also what
 * keeps the shelf small: a language with a dozen features and sixty values
 * shows a dozen chips and one table, never sixty rows at once.
 *
 * Without the language record — its PDS unreachable, or the language declaring
 * no grammar at all — the read model alone cannot say which feature a row
 * belongs to nor which features this language minted, so the section degrades
 * to the flat list it has always been. The same degradation the page already
 * applies to the editor button, for the same reason.
 */
interface LabelShelfProps {
  /** The language's own declaration, when its record could be resolved. */
  grammar?: Grammar;
  labels: LabelView[];
  /** BCP 47 tag of the language, for collating its homolingual labels. */
  languageTag: string;
  /** Open the binding editor — where an empty shelf gets filled. */
  onEdit: () => void;
}

/**
 * The editor's own door names, so the shelf a row is read on is the one it was
 * declared through. Named combinations are the exception: they are declared one
 * layer up, under a tab that also holds inherence, so this list names the half
 * of it that carries a label.
 */
const TAB_LABEL = {
  pos: "grammar.posLevel",
  features: "grammar.featuresLevel",
  classes: "grammar.classesLevel",
  lexical: "grammar.lexicalLevel",
  combinations: "languagePage.labels.tabCombinations",
  abbreviations: "grammar.abbreviationsLevel",
} as const satisfies Record<ShelfTabID, string>;

export function LabelShelf({ grammar, labels, languageTag, onEdit }: LabelShelfProps) {
  const { t } = useTranslation();
  const collator = useMemo(() => labelCollator(languageTag), [languageTag]);
  // Empty tabs are dropped rather than shown disabled: this is a reading
  // surface, and a language that declares no inflection classes has no such
  // shelf — an empty one would only ask the reader to check it.
  const tabs = useMemo(
    () => (grammar === undefined ? [] : labelShelf(grammar, labels).filter((tab) => tab.count > 0)),
    [grammar, labels],
  );

  const [tabID, setTabID] = useState<ShelfTabID | null>(null);
  /** Which feature's values are shown; nothing is shown until one is picked. */
  const [feature, setFeature] = useState<string | null>(null);
  const [sort, setSort] = useState<ShelfSort>({ by: "label", dir: "asc" });

  // A row with no `long` is a tag entries use that nothing has named here yet:
  // the naming worklist, which the dashboard shows on its own below.
  const labelled = labels.filter((row) => row.long !== undefined);

  if (tabs.length === 0) {
    return labelled.length === 0 ? (
      <p className="mt-2 text-sm text-content-muted">{t("languagePage.abbreviationsEmpty")}</p>
    ) : (
      <FlatLabels labels={labelled} />
    );
  }

  const tab = tabs.find((one) => one.id === tabID) ?? tabs[0]!;
  const group = tab.groups.find((one) => one.feature === feature) ?? null;

  function openTab(next: ShelfTab): void {
    setTabID(next.id);
    // The pick belongs to the tab it was made on: two tabs list the same
    // inflection class, but nothing else carries across.
    setFeature(null);
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2" role="tablist">
        {tabs.map((one) => (
          <button
            key={one.id}
            type="button"
            role="tab"
            aria-selected={one.id === tab.id}
            onClick={() => openTab(one)}
            className={
              one.id === tab.id
                ? "rounded-full border border-primary bg-surface px-3 py-1 text-xs font-medium text-primary"
                : "rounded-full border px-3 py-1 text-xs text-content-subtle hover:border-primary hover:text-primary"
            }
          >
            {t(TAB_LABEL[one.id])}
            <span className="ml-1.5 text-content-subtle">{one.count}</span>
          </button>
        ))}
      </div>

      {tab.groups.length > 0 ? (
        <>
          {/* The second layer. A feature is a question, so its answers are not
              shown until it is asked. */}
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {tab.groups.map((one) => (
              <li key={one.feature}>
                <button
                  type="button"
                  aria-pressed={one.feature === group?.feature}
                  onClick={() => setFeature(one.feature === group?.feature ? null : one.feature)}
                  className={`flex items-baseline gap-1.5 rounded-lg border px-2.5 py-1 text-xs ${
                    one.feature === group?.feature
                      ? "border-primary bg-surface text-content"
                      : "bg-surface-muted/60 text-content hover:border-primary hover:text-primary"
                  }`}
                >
                  <span className="font-mono">{one.feature}</span>
                  <span className="text-content-subtle">{one.row.short ?? one.row.long}</span>
                  {one.minted && (
                    <span className="text-warning">{t("grammar.mintedBadge")}</span>
                  )}
                  <span className="text-content-subtle">
                    {t("grammar.l3ValueCount", { count: one.values.length })}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {group === null ? (
            <p className="mt-3 text-sm text-content-muted">{t("languagePage.labels.pickFeature")}</p>
          ) : (
            <>
              {/* The feature name's own row: what this language calls the axis
                  itself, which is not one of its values and never sits in the
                  table below. */}
              <div className="mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="font-mono text-sm text-content">{group.feature}</span>
                <span className="text-sm text-content">{group.row.long}</span>
                {group.row.short !== undefined && (
                  <span className="font-mono text-xs text-content-subtle">{group.row.short}</span>
                )}
                <Conflicts row={group.row} />
              </div>
              <Note row={group.row} />
              {group.values.length === 0 ? (
                <p className="mt-2 text-sm text-content-muted">
                  {t("languagePage.labels.noValues")}
                </p>
              ) : (
                <LabelTable
                  rows={sortShelfRows(group.values, sort, collator)}
                  sort={sort}
                  onSort={setSort}
                  withTag
                />
              )}
            </>
          )}
        </>
      ) : (
        <LabelTable
          rows={sortShelfRows(tab.rows, sort, collator)}
          sort={sort}
          onSort={setSort}
          withTag={tab.id !== "abbreviations"}
        />
      )}

      <button
        type="button"
        onClick={onEdit}
        className="mt-3 text-xs text-primary hover:text-primary-hover"
      >
        {t("languagePage.labels.edit")}
      </button>
    </div>
  );
}

/**
 * A row's free-prose note, where its declaration carries one.
 *
 * Printed in full rather than truncated or hidden behind a hover: this is the
 * front matter, the one place in the dictionary whose job is to explain what
 * the labels mean, and a sentence a reader has to reach for explains nothing.
 * `whitespace-pre-line` keeps the contributor's own paragraph breaks, since the
 * field is a single string and newlines are how it holds more than one.
 */
function Note({ row }: { row: ShelfRow }): ReactNode {
  if (row.note === undefined) return null;
  return (
    <p className="mt-0.5 max-w-prose whitespace-pre-line text-xs text-content-subtle">{row.note}</p>
  );
}

/** The conflict partners of a row, where it has any. */
function Conflicts({ row }: { row: ShelfRow }): ReactNode {
  const { t } = useTranslation();
  if (row.conflictsWith.length === 0) return null;
  return (
    <span className="text-xs text-danger">
      <span aria-hidden="true">⚠ </span>
      {t("languagePage.abbreviationsConflict", {
        pairs: row.conflictsWith.map(formatLabelRef).join(", "),
      })}
    </span>
  );
}

interface LabelTableProps {
  rows: ShelfRow[];
  sort: ShelfSort;
  onSort: (sort: ShelfSort) => void;
  /** Abbreviations stand for no tag, so their table has no such column. */
  withTag: boolean;
}

/**
 * One shelf's rows. Both orders a front matter is read in are offered: by full
 * form, which is how a dictionary prints it, and by how many entries use it,
 * which is how a maintainer reads it.
 */
function LabelTable({ rows, sort, onSort, withTag }: LabelTableProps) {
  const { t } = useTranslation();

  function toggle(by: ShelfSort["by"]): void {
    onSort(
      sort.by === by
        ? { by, dir: sort.dir === "asc" ? "desc" : "asc" }
        : // Counts read downwards and words upwards: the first click on either
          // column should show what it is asked for, not its far end.
          { by, dir: by === "count" ? "desc" : "asc" },
    );
  }

  const heading = (by: ShelfSort["by"], label: string, align: string): ReactNode => (
    <th
      scope="col"
      aria-sort={sort.by !== by ? "none" : sort.dir === "asc" ? "ascending" : "descending"}
      className={`py-1.5 font-medium ${align}`}
    >
      <button
        type="button"
        onClick={() => toggle(by)}
        className="hover:text-primary"
      >
        {label}
        {sort.by === by && <span aria-hidden="true">{sort.dir === "asc" ? " ↑" : " ↓"}</span>}
      </button>
    </th>
  );

  return (
    // A tag bundle can be long; the table scrolls inside its own box rather
    // than pushing the dashboard sideways.
    <div className="mt-2 overflow-x-auto">
      <table className="w-full min-w-[22rem] border-collapse text-left text-sm">
        <thead className="border-b text-xs text-content-subtle">
          <tr>
            <th scope="col" className="py-1.5 pr-3 font-medium">
              {t("languagePage.labels.colShort")}
            </th>
            {heading("label", t("languagePage.labels.colLabel"), "pr-3")}
            {withTag && (
              <th scope="col" className="py-1.5 pr-3 font-medium">
                {t("languagePage.labels.colTag")}
              </th>
            )}
            {heading("count", t("languagePage.labels.colUses"), "text-right")}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-content/5 last:border-0">
              <td className="py-1.5 pr-3 align-baseline font-mono text-xs text-content">
                {row.short ?? <span className="text-content-subtle">—</span>}
              </td>
              <td className="py-1.5 pr-3 align-baseline text-content">
                {row.long}
                <Conflicts row={row} />
                <Note row={row} />
              </td>
              {withTag && (
                <td className="py-1.5 pr-3 align-baseline font-mono text-xs text-content-subtle">
                  {row.tag === undefined ? "" : formatTagVerbatim(row.tag)}
                </td>
              )}
              {/* Zero is ordinary — a language may name a label before anyone
                  uses it — so it is printed, not hidden. */}
              <td className="py-1.5 text-right align-baseline text-xs text-content-subtle">
                {row.count}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The fallback: every labelled row in one list, with the badge naming what each
 * one is. Reached only when the language record could not be resolved, which is
 * the one case where nothing better can be said about a row than its kind.
 */
function FlatLabels({ labels }: { labels: LabelView[] }) {
  const { t } = useTranslation();
  return (
    <ul className="mt-2 space-y-1.5">
      {labels.map((row, i) => {
        const conflicted = row.conflictsWith.length > 0;
        return (
          <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span
              className={`rounded-full border bg-surface-muted/60 px-2.5 py-0.5 font-mono text-xs text-content ${
                conflicted ? "border-red-400" : ""
              }`}
            >
              {conflicted && <span aria-hidden="true">⚠ </span>}
              {row.short ?? row.long}
            </span>
            {row.short !== undefined && <span className="text-sm text-content">{row.long}</span>}
            {row.bound && (
              <span
                className="rounded border border-primary/50 px-1.5 py-0.5 text-[0.65rem] uppercase tracking-wide text-primary"
                title={
                  row.tag === undefined
                    ? undefined
                    : t("languagePage.abbreviationBound", { tag: formatTagVerbatim(row.tag) })
                }
              >
                {row.kind === undefined
                  ? t("languagePage.abbreviationBoundBadge")
                  : t(`languagePage.labelKind.${row.kind}`)}
              </span>
            )}
            <span className="text-xs text-content-subtle">×{row.count}</span>
            {conflicted && (
              <span className="text-xs text-danger">
                {t("languagePage.abbreviationsConflict", {
                  pairs: row.conflictsWith.map(formatLabelRef).join(", "),
                })}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
