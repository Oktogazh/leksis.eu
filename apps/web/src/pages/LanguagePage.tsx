import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  formatAbbreviationRef,
  formatTagVerbatim,
  type AbbreviationView,
  type DashboardActivityDay,
  type DashboardFeedItem,
  type LanguageDashboardResponse,
  type LanguageView,
  type LeksisLanguageRecord,
} from "@leksis/types";
import { useSession } from "../auth/SessionProvider";
import { endonym } from "../components/LanguageSelector";
import { GrammarBindingDialog } from "../components/GrammarBindingDialog";
import { LanguageRecordDialog, type LanguageRecordMode } from "../components/LanguageRecordDialog";
import { LanguageSearchBar } from "../components/LanguageSearchBar";
import { fetchAbbreviations, fetchLanguageDashboard, fetchLanguages } from "../lib/api";
import { fetchLanguageRecord } from "../lib/atproto-record";
import { forgetLanguageGrammar } from "../lib/language-grammar";

const SYNC_POLL_MS = 3_000;
const SYNC_POLL_MAX_TRIES = 20; // ~60s of PDS → Jetstream → ArangoDB latency
const DAY_MS = 24 * 60 * 60 * 1000;

/** "2 hours ago" in the UI locale, from an ISO timestamp. */
function relativeTime(iso: string, locale: string): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 60) return rtf.format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return rtf.format(-hours, "hour");
  return rtf.format(-Math.round(hours / 24), "day");
}

/**
 * The last year of activity as Monday-first weeks (GitHub-style grid),
 * oldest week first, clipped at today. Sparse input — absent days count 0.
 */
function activityWeeks(activity: DashboardActivityDay[]): { date: string; count: number }[][] {
  const byDate = new Map(activity.map((day) => [day.date, day.count]));
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const start = new Date(today.getTime() - 364 * DAY_MS);
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7)); // back to Monday

  const weeks: { date: string; count: number }[][] = [];
  const cursor = new Date(start);
  while (cursor <= today) {
    const week: { date: string; count: number }[] = [];
    for (let i = 0; i < 7 && cursor <= today; i++) {
      const date = cursor.toISOString().slice(0, 10);
      week.push({ date, count: byDate.get(date) ?? 0 });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

/** Sequential fill for one activity cell: one hue, light → dark. */
function activityLevelClass(count: number): string {
  if (count === 0) return "border border-content/10 bg-surface-muted/50";
  if (count === 1) return "bg-primary/30";
  if (count <= 4) return "bg-primary/60";
  return "bg-primary";
}

/** GitHub-style per-day activity grid with a Less→More legend. */
function ActivityGrid({ activity }: { activity: DashboardActivityDay[] }): ReactNode {
  const { t } = useTranslation();
  const weeks = activityWeeks(activity);
  return (
    <div>
      {/* The grid scrolls inside its own container on narrow screens. */}
      <div className="mt-3 overflow-x-auto pb-1">
        <div className="flex w-max gap-[3px]">
          {weeks.map((week, i) => (
            <div key={i} className="flex flex-col gap-[3px]">
              {week.map((day) => {
                const label = t("languagePage.gridCellLabel", {
                  count: day.count,
                  date: day.date,
                });
                return (
                  <span
                    key={day.date}
                    title={label}
                    aria-label={label}
                    role="img"
                    className={`h-2.5 w-2.5 rounded-[2px] ${activityLevelClass(day.count)}`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <p className="mt-2 flex items-center justify-end gap-1 text-xs text-content-subtle">
        {t("languagePage.gridLegendLess")}
        {[0, 1, 2, 5].map((level) => (
          <span
            key={level}
            aria-hidden="true"
            className={`h-2.5 w-2.5 rounded-[2px] ${activityLevelClass(level)}`}
          />
        ))}
        {t("languagePage.gridLegendMore")}
      </p>
    </div>
  );
}

interface LanguagePageProps {
  /** The language's tag, from the /language/<tag> path. */
  tag: string;
  /** All known languages, for display names and the record-editing search bars. */
  languages: LanguageView[];
  /** Navigate to an entry's page (todo queue, activity feed). */
  onOpenEntry: (key: string) => void;
}

type LoadState = "loading" | "ready" | "not-found" | "failed";

/**
 * One language's dashboard (/language/<tag>), rendered under the persistent
 * search bar. Top to bottom: entry counters with actions to edit the language
 * record and to name languages in this language (both via
 * LanguageRecordDialog, which rewrites eu.leksis.language records on the
 * editor's own PDS), the activity grid + recent-changes feed, the harvested
 * abbreviations with their conflicts, and the to-be-completed review queue.
 * Entries themselves stay reachable through search only.
 */
export function LanguagePage({ tag, languages, onOpenEntry }: LanguagePageProps) {
  const { t, i18n } = useTranslation();
  const { profile } = useSession();
  const [dashboard, setDashboard] = useState<LanguageDashboardResponse | null>(null);
  const [abbreviations, setAbbreviations] = useState<AbbreviationView[]>([]);
  const [namedIn, setNamedIn] = useState<LanguageView[]>([]);
  const [record, setRecord] = useState<LeksisLanguageRecord | null>(null);
  const [state, setState] = useState<LoadState>("loading");

  /** Which record-editing dialog is open, if any. */
  const [dialog, setDialog] = useState<LanguageRecordMode | null>(null);
  /** True while the mode-B target picker (name a language in this one) is open. */
  const [codesOpen, setCodesOpen] = useState(false);
  /** The binding editor — this language's own grammar declaration. */
  const [grammarOpen, setGrammarOpen] = useState(false);
  // A row with no `long` is a tag entries use that nothing has named here yet:
  // the translation worklist, kept out of the abbreviation list proper.
  const labelled = abbreviations.filter((a) => a.long !== undefined);
  const unboundTags = abbreviations.filter((a) => a.long === undefined && a.tag !== undefined);
  /** True while the full flagged-for-review list dialog is open. */
  const [todoOpen, setTodoOpen] = useState(false);
  /** Record URI written to the PDS but not yet seen back from the AppView. */
  const [syncingURI, setSyncingURI] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setDashboard(null);
    setAbbreviations([]);
    setNamedIn([]);
    setRecord(null);
    setDialog(null);
    setCodesOpen(false);
    setTodoOpen(false);

    (async () => {
      try {
        const found = await fetchLanguageDashboard(tag);
        if (cancelled) return;
        if (found === null) return setState("not-found");
        setDashboard(found);
        setState("ready");
        // Best-effort side data — failures never block the dashboard.
        fetchAbbreviations(tag)
          .then((list) => {
            if (!cancelled) setAbbreviations(list);
          })
          .catch(() => {});
        fetchLanguages(tag)
          .then((list) => {
            if (!cancelled) {
              setNamedIn(list.filter((l) => l.tag !== tag && l.name !== undefined));
            }
          })
          .catch(() => {});
        fetchLanguageRecord(found.language.recordURI)
          .then((value) => {
            if (!cancelled) setRecord(value);
          })
          .catch(() => {});
      } catch (err) {
        console.error("language dashboard load failed:", err);
        if (!cancelled) setState("failed");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tag]);

  // After publishing (either dialog): poll until the AppView serves the new
  // version of *this* language's record, then reload the names and the
  // named-in review list. A mode-B edit rewrites another language's record, so
  // it may not change this dashboard's recordURI — the poll then times out
  // harmlessly and the named-in list is refreshed below regardless.
  useEffect(() => {
    if (syncingURI === null) return;
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      Promise.all([fetchLanguageDashboard(tag), fetchLanguages(tag)])
        .then(async ([found, list]) => {
          setNamedIn(list.filter((l) => l.tag !== tag && l.name !== undefined));
          if (found !== null && found.language.recordURI === syncingURI) {
            setSyncingURI(null);
            setDashboard(found);
            const value = await fetchLanguageRecord(found.language.recordURI);
            if (value !== null) setRecord(value);
          } else if (tries >= SYNC_POLL_MAX_TRIES) {
            setSyncingURI(null);
          }
        })
        .catch(() => {
          /* transient — keep polling */
        });
    }, SYNC_POLL_MS);
    return () => clearInterval(timer);
  }, [syncingURI, tag]);

  const language = languages.find((l) => l.tag === tag) ?? null;

  // Editable names in the record editor: the user's languages of interest,
  // their interface language, plus this language's own name (the endonym is
  // always shown). Any other locale is revealed on demand via the search bar.
  function openEditRecord() {
    if (record === null) return;
    const editableIDs = Array.from(
      new Set([tag, i18n.language, ...(profile?.languages ?? [])]),
    );
    setDialog({ kind: "self", record, editableIDs });
  }

  function openNameTarget(targetTag: string) {
    setCodesOpen(false);
    setDialog({ kind: "other", targetTag, dashboardTag: tag });
  }

  function onPublished(uri: string) {
    setDialog(null);
    setCodesOpen(false);
    setSyncingURI(uri);
  }

  function feedItemText(item: DashboardFeedItem): string {
    if (item.type === "language") {
      return t(
        item.action === "created"
          ? "languagePage.feedLanguageCreated"
          : "languagePage.feedLanguageEdited",
      );
    }
    return t(
      item.action === "created" ? "languagePage.feedEntryCreated" : "languagePage.feedEntryEdited",
      { label: item.label },
    );
  }

  const languageName = language !== null ? endonym(language) : tag;

  return (
    <div className="mt-6 flex flex-col">
      {state === "loading" && (
        <p className="text-sm text-content-muted">{t("languagePage.loading")}</p>
      )}
      {state === "not-found" && (
        <p className="text-sm text-content-muted">{t("languagePage.notFound")}</p>
      )}
      {state === "failed" && (
        <p className="text-sm text-red-600">{t("languagePage.loadFailed")}</p>
      )}

      {state === "ready" && dashboard !== null && (
        <article>
          <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-content sm:text-3xl">
              {languageName}
            </h1>
            <span className="rounded border bg-surface px-1.5 py-0.5 font-mono text-xs text-content-muted">
              {tag}
            </span>
          </header>

          {/* Counters + record-editing actions. */}
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border bg-surface p-4">
              <p className="text-2xl font-semibold text-content">{dashboard.entriesCount}</p>
              <p className="mt-1 text-xs text-content-muted">{t("languagePage.statsEntries")}</p>
            </div>
            <button
              type="button"
              onClick={() => setTodoOpen(true)}
              disabled={dashboard.todoCount === 0}
              className="rounded-lg border bg-surface p-4 text-left hover:border-primary disabled:cursor-not-allowed disabled:hover:border-[color:inherit]"
            >
              <p className="text-2xl font-semibold text-content">{dashboard.todoCount}</p>
              <p className="mt-1 text-xs text-content-muted">{t("languagePage.statsTodo")}</p>
            </button>
            <button
              type="button"
              onClick={openEditRecord}
              disabled={record === null}
              className="rounded-lg border bg-surface p-4 text-left hover:border-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              <p className="text-sm font-medium text-content">{t("languagePage.editRecord")}</p>
              <p className="mt-1 text-xs text-content-muted">{t("languagePage.editRecordHint")}</p>
            </button>
            <button
              type="button"
              onClick={() => setCodesOpen(true)}
              className="rounded-lg border bg-surface p-4 text-left hover:border-primary"
            >
              <p className="text-sm font-medium text-content">
                {t("languagePage.codesCardTitle", { language: languageName })}
              </p>
              <p className="mt-1 text-xs text-content-muted">
                {t("languagePage.codesCardHint", { language: languageName })}
              </p>
            </button>
          </div>

          {/* Activity grid + recent-changes feed, directly under the cards. */}
          <section className="mt-8">
            <h2 className="text-sm font-semibold text-content">
              {t("languagePage.activityTitle")}
            </h2>
            <ActivityGrid activity={dashboard.activity} />
          </section>

          <section className="mt-8">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-content">
                {t("languagePage.abbreviationsTitle")}
              </h2>
              {/* Layer 0 (free abbreviations harvested from entries) and layer 1
                  (the grammar a language declares) are the same shelf to a
                  contributor, so the binding editor opens from here. */}
              <button
                type="button"
                onClick={() => setGrammarOpen(true)}
                disabled={record === null}
                className="rounded-lg border px-3 py-1.5 text-xs text-content hover:border-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t("grammar.title")}
              </button>
            </div>
            <p className="mt-1 text-xs text-content-subtle">
              {t("languagePage.abbreviationsHint")}
            </p>
            {labelled.length === 0 ? (
              <p className="mt-2 text-sm text-content-muted">
                {t("languagePage.abbreviationsEmpty")}
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {labelled.map((abbreviation, i) => {
                  const conflicted = abbreviation.conflictsWith.length > 0;
                  return (
                    <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span
                        className={`rounded-full border bg-surface-muted/60 px-2.5 py-0.5 font-mono text-xs text-content ${conflicted ? "border-red-400" : ""
                          }`}
                      >
                        {conflicted && <span aria-hidden="true">⚠ </span>}
                        {abbreviation.short ?? abbreviation.long}
                      </span>
                      {abbreviation.short !== undefined && (
                        <span className="text-sm text-content">{abbreviation.long}</span>
                      )}
                      {/* A bound pair is the language's own declaration, so it
                          is listed even at ×0 — the count is usage, not
                          existence. */}
                      {abbreviation.bound && (
                        <span
                          className="rounded border border-primary/50 px-1.5 py-0.5 text-[0.65rem] uppercase tracking-wide text-primary"
                          title={
                            abbreviation.tag === undefined
                              ? undefined
                              : t("languagePage.abbreviationBound", {
                                  tag: formatTagVerbatim(abbreviation.tag),
                                })
                          }
                        >
                          {t("languagePage.abbreviationBoundBadge")}
                        </span>
                      )}
                      <span className="text-xs text-content-subtle">×{abbreviation.count}</span>
                      {conflicted && (
                        <span className="text-xs text-red-600">
                          {t("languagePage.abbreviationsConflict", {
                            pairs: abbreviation.conflictsWith
                              .map(formatAbbreviationRef)
                              .join(", "),
                          })}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {unboundTags.length > 0 && (
              <div className="mt-4 rounded-lg border border-dashed border-amber-500/60 p-3">
                <h3 className="text-sm font-semibold text-content">
                  {t("languagePage.unboundTagsTitle")}
                </h3>
                <p className="mt-1 text-xs text-content-subtle">
                  {t("languagePage.unboundTagsHint")}
                </p>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {unboundTags.map((row, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        onClick={() => setGrammarOpen(true)}
                        disabled={record === null}
                        className="rounded-full border border-dashed border-amber-500/70 px-2.5 py-1 font-mono text-xs text-amber-700 hover:border-primary hover:text-primary disabled:opacity-50 dark:text-amber-400"
                      >
                        {formatTagVerbatim(row.tag!)}
                        <span className="ml-1 text-content-subtle">×{row.count}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* The AppView indexes an incoherent grammar rather than rejecting
                it — so this is where those rows get found and fixed. */}
            {dashboard.grammarIssues.length > 0 && (
              <div className="mt-4 rounded-lg border border-amber-400/60 bg-amber-50/40 p-3 dark:bg-amber-500/5">
                <h3 className="text-sm font-semibold text-content">
                  <span aria-hidden="true">⚠ </span>
                  {t("languagePage.grammarIssuesTitle")}
                </h3>
                <p className="mt-1 text-xs text-content-subtle">
                  {t("languagePage.grammarIssuesHint")}
                </p>
                <ul className="mt-2 space-y-1">
                  {dashboard.grammarIssues.map((issue, i) => (
                    <li key={i} className="font-mono text-xs text-content">
                      {/* One case per kind, rather than a two-branch test: a
                          later layer adding a kind must produce copy of its
                          own, not silently inherit another kind's. */}
                      {t(`languagePage.grammarIssue.${issue.kind}`, {
                        key: issue.key,
                        feature: issue.feature ?? "",
                        atom: issue.atom ?? "",
                      })}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => setGrammarOpen(true)}
                  disabled={record === null}
                  className="mt-2 text-xs text-primary hover:text-primary-hover disabled:opacity-50"
                >
                  {t("languagePage.grammarIssuesOpen")}
                </button>
              </div>
            )}
          </section>

          <section className="mt-8">
            <h3 className="mt-4 text-sm font-semibold text-content">
              {t("languagePage.feedTitle")}
            </h3>
            {dashboard.feed.length === 0 ? (
              <p className="mt-2 text-sm text-content-muted">{t("languagePage.feedEmpty")}</p>
            ) : (
              <ol className="mt-2 space-y-1.5">
                {dashboard.feed.map((item, i) => (
                  <li key={i} className="flex items-baseline gap-2 text-sm">
                    <span className="w-24 shrink-0 text-xs text-content-subtle">
                      {relativeTime(item.at, i18n.language)}
                    </span>
                    {item.type === "entry" && item.entryKey !== undefined ? (
                      <button
                        type="button"
                        onClick={() => onOpenEntry(item.entryKey!)}
                        className="text-left text-content hover:text-primary"
                      >
                        {feedItemText(item)}
                      </button>
                    ) : (
                      <span className="text-content">{feedItemText(item)}</span>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>

          {syncingURI !== null && (
            <p className="mt-6 text-sm text-content-subtle">{t("languagePage.namesSyncing")}</p>
          )}
        </article>
      )}

      {/* Full flagged-for-review list — the whole todo queue the endpoint
          returns (capped server-side at 100), opened from the counter card. */}
      {todoOpen && dashboard !== null && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="todo-dialog-title"
        >
          <div className="max-h-[calc(100dvh-2rem)] w-full overflow-y-auto rounded-t-xl border bg-surface p-4 shadow-lg sm:max-w-lg sm:rounded-xl sm:p-6">
            <h2 id="todo-dialog-title" className="text-lg font-semibold text-content">
              {t("languagePage.todoTitle")}
            </h2>
            <p className="mt-1 text-sm text-content-subtle">{t("languagePage.todoHint")}</p>

            {dashboard.todoEntries.length === 0 ? (
              <p className="mt-4 text-sm text-content-muted">{t("languagePage.todoEmpty")}</p>
            ) : (
              <>
                <ul className="mt-4 flex flex-wrap gap-1.5">
                  {dashboard.todoEntries.map((entry) => (
                    <li key={entry.key}>
                      <button
                        type="button"
                        onClick={() => {
                          setTodoOpen(false);
                          onOpenEntry(entry.key);
                        }}
                        className="rounded-full border bg-surface-muted/60 px-2.5 py-1 text-xs text-content hover:border-primary hover:text-primary"
                      >
                        <span aria-hidden="true">⚠ </span>
                        {entry.orthography[0]}
                      </button>
                    </li>
                  ))}
                </ul>
                {dashboard.todoCount > dashboard.todoEntries.length && (
                  <p className="mt-3 text-xs text-content-subtle">
                    {t("languagePage.todoMore", {
                      count: dashboard.todoCount - dashboard.todoEntries.length,
                      shown: dashboard.todoEntries.length,
                    })}
                  </p>
                )}
              </>
            )}

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setTodoOpen(false)}
                className="rounded-lg border px-4 py-2 text-sm text-content hover:bg-black/5"
              >
                {t("languageRecord.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mode-B target picker: choose (or correct) a language named in this one. */}
      {codesOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="codes-dialog-title"
        >
          <div className="max-h-[calc(100dvh-2rem)] w-full overflow-y-auto rounded-t-xl border bg-surface p-4 shadow-lg sm:max-w-lg sm:rounded-xl sm:p-6">
            <h2 id="codes-dialog-title" className="text-lg font-semibold text-content">
              {t("languagePage.codesCardTitle", { language: languageName })}
            </h2>
            <p className="mt-1 text-sm text-content-subtle">
              {t("languageRecord.codesIntro", { language: languageName })}
            </p>

            {namedIn.length === 0 ? (
              <p className="mt-4 text-sm text-content-muted">{t("languagePage.namedInEmpty")}</p>
            ) : (
              <ul className="mt-4 flex flex-wrap gap-1.5">
                {namedIn.map((l) => (
                  <li key={l.tag}>
                    <button
                      type="button"
                      onClick={() => openNameTarget(l.tag)}
                      className="rounded-full border bg-surface-muted/60 px-2.5 py-1 text-xs text-content hover:border-primary hover:text-primary"
                    >
                      {l.name} <span className="font-mono text-content-subtle">{l.tag}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-4">
              <p className="text-sm font-medium text-content">
                {t("languageRecord.targetLabel")}
              </p>
              <div className="mt-2">
                <LanguageSearchBar
                  languages={languages}
                  onSelect={openNameTarget}
                  exclude={[tag, ...namedIn.map((l) => l.tag)]}
                  placeholder={t("languageRecord.targetPick", { language: languageName })}
                />
              </div>
            </div>

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setCodesOpen(false)}
                className="rounded-lg border px-4 py-2 text-sm text-content hover:bg-black/5"
              >
                {t("languageRecord.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}

      {dialog !== null && (
        <LanguageRecordDialog
          mode={dialog}
          languages={languages}
          onClose={() => setDialog(null)}
          onPublished={onPublished}
        />
      )}

      {grammarOpen && (
        <GrammarBindingDialog
          tag={tag}
          onClose={() => setGrammarOpen(false)}
          onPublished={(uri) => {
            setGrammarOpen(false);
            setSyncingURI(uri);
            // The entry pages cache this language's grammar for the session, so
            // a layout edited here would otherwise keep laying entries out the
            // old way until a reload.
            forgetLanguageGrammar(tag);
          }}
        />
      )}
    </div>
  );
}
