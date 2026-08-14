import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  formatTagVerbatim,
  type LabelView,
  type DashboardFeedItem,
  type LanguageDashboardResponse,
  type LanguageView,
  type LeksisLanguageRecord,
  type SourceView,
} from "@leksis/types";
import { useSession } from "../auth/SessionProvider";
import { ActivityGrid } from "../components/ActivityGrid";
import { endonym } from "../components/LanguageSelector";
import { GrammarBindingDialog } from "../components/GrammarBindingDialog";
import { LabelShelf } from "../components/LabelShelf";
import { LanguageRecordDialog, type LanguageRecordMode } from "../components/LanguageRecordDialog";
import { LanguageSearchBar } from "../components/LanguageSearchBar";
import { SourceEditorDialog } from "../components/SourceEditorDialog";
import {
  fetchLabels,
  fetchLanguageDashboard,
  fetchLanguages,
  fetchLanguageSources,
} from "../lib/api";
import { relativeTime } from "../lib/relative-time";
import { fetchLanguageRecord } from "../lib/atproto-record";
import { forgetLanguageGrammar } from "../lib/language-grammar";
import { navigateTo, sourcePath } from "../lib/routes";

const SYNC_POLL_MS = 3_000;
const SYNC_POLL_MAX_TRIES = 20; // ~60s of PDS → Jetstream → ArangoDB latency

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
 * labels with their conflicts, and the to-be-completed review queue.
 * Entries themselves stay reachable through search only.
 */
export function LanguagePage({ tag, languages, onOpenEntry }: LanguagePageProps) {
  const { t, i18n } = useTranslation();
  const { profile } = useSession();
  const [dashboard, setDashboard] = useState<LanguageDashboardResponse | null>(null);
  const [labels, setLabels] = useState<LabelView[]>([]);
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
  // the naming worklist, kept out of the shelf proper.
  const unboundTags = labels.filter((a) => a.long === undefined && a.tag !== undefined);
  /** True while the full flagged-for-review list dialog is open. */
  const [todoOpen, setTodoOpen] = useState(false);
  /** The parked-relations queue dialog — the semantic network's repair worklist. */
  const [parkedOpen, setParkedOpen] = useState(false);
  /** Record URI written to the PDS but not yet seen back from the AppView. */
  const [syncingURI, setSyncingURI] = useState<string | null>(null);
  /** The works entries in this language can cite. Side data, never blocking. */
  const [sources, setSources] = useState<SourceView[]>([]);
  const [sourceEditorOpen, setSourceEditorOpen] = useState(false);
  /** A source published from here but not yet seen back from the AppView. */
  const [syncingOclc, setSyncingOclc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setDashboard(null);
    setLabels([]);
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
        fetchLabels(tag)
          .then((list) => {
            if (!cancelled) setLabels(list);
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
        // Deliberately its own call rather than a field on the dashboard: a
        // bibliography grows on its own schedule and will want paging of its
        // own long before the counters do.
        fetchLanguageSources(tag)
          .then((list) => {
            if (!cancelled) setSources(list);
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

  // A source published from this page, waiting to come back around through the
  // firehose. Its own poll rather than a branch of the one above: a source is a
  // different collection with its own round trip, and folding them together
  // would make either one's timeout read as the other's failure.
  useEffect(() => {
    if (syncingOclc === null) return;
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      fetchLanguageSources(tag)
        .then((list) => {
          if (list.some((s) => s.oclc === syncingOclc)) {
            setSources(list);
            setSyncingOclc(null);
          } else if (tries >= SYNC_POLL_MAX_TRIES) {
            console.warn(`source ${syncingOclc} not indexed after polling; giving up`);
            setSyncingOclc(null);
          }
        })
        .catch(() => {
          /* transient — keep polling */
        });
    }, SYNC_POLL_MS);
    return () => clearInterval(timer);
  }, [syncingOclc, tag]);

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
  /**
   * Everything withheld from results and awaiting repair. The counts are the
   * true total; `parkedRelations` is the capped queue, so the two differ
   * exactly when there is more work than the dialog can list.
   */
  const parkedTotal =
    dashboard === null
      ? 0
      : dashboard.relationCounts.stale +
        dashboard.relationCounts.unresolved +
        dashboard.relationCounts.oversize;

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
            {/* Senses nothing has translated yet — the outward work. Free to
                compute because every sense is a vertex, related or not. */}
            <div className="rounded-lg border bg-surface p-4">
              <p className="text-2xl font-semibold text-content">
                {dashboard.untranslatedSenses}
              </p>
              <p className="mt-1 text-xs text-content-muted">
                {t("languagePage.statsUntranslated")}
              </p>
            </div>
            {/* Relations withheld from results until someone re-affirms them —
                recurring lexicographic work, given the same first-class
                worklist treatment as unbound tags and flagged entries. */}
            <button
              type="button"
              onClick={() => setParkedOpen(true)}
              disabled={dashboard.parkedRelations.length === 0}
              className="rounded-lg border bg-surface p-4 text-left hover:border-primary disabled:cursor-not-allowed disabled:hover:border-[color:inherit]"
            >
              <p className="text-2xl font-semibold text-content">{parkedTotal}</p>
              <p className="mt-1 text-xs text-content-muted">{t("languagePage.statsParked")}</p>
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
              {/* A dictionary's front matter is one shelf to a contributor —
                  grammatical tags, lexicographic labels and plain
                  abbreviations alike — so the editor that declares all of them
                  opens from here. */}
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
            {/* One shelf per kind of thing a language names — the badge that
                used to sit on every row is the tab it is on now. */}
            <LabelShelf
              grammar={record?.grammar}
              labels={labels}
              languageTag={tag}
              onEdit={() => setGrammarOpen(true)}
            />

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

            {/* No grammar repair worklist: the AppView refuses to index an
                incoherent grammar (ADR-0015), so the current record's rows are
                coherent by construction and there is nothing here to list. The
                worklist that remains is the labels one above — a tag some entry
                uses that no declaration has named, which is a gap between two
                records rather than a defect inside one. */}
          </section>

          {/* The works this language's entries can cite. Below the front
              matter it belongs with — a bibliography is the other half of a
              dictionary's apparatus — and above the activity feed. */}
          <section className="mt-8">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-content">
                {t("languagePage.sourcesTitle")}
              </h2>
              <button
                type="button"
                onClick={() => setSourceEditorOpen(true)}
                className="text-xs text-primary hover:text-primary-hover"
              >
                {t("languagePage.sourcesAdd")}
              </button>
            </div>
            <p className="mt-1 text-xs text-content-muted">{t("languagePage.sourcesHint")}</p>

            {sources.length === 0 ? (
              <p className="mt-3 text-sm text-content-muted">{t("languagePage.sourcesEmpty")}</p>
            ) : (
              <ul className="mt-3 divide-y rounded-lg border bg-surface">
                {sources.map((source) => (
                  <li key={source.oclc}>
                    <button
                      type="button"
                      onClick={() => navigateTo(sourcePath(source.oclc))}
                      className="w-full px-4 py-3 text-left hover:bg-surface-muted/60"
                    >
                      <span className="flex flex-wrap items-baseline gap-2">
                        <span className="text-sm font-medium text-content">
                          {source.citation.short}
                        </span>
                        {source.languages[0] === tag && (
                          <span className="text-xs text-content-subtle">
                            {t("languagePage.sourcesMain")}
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block text-sm text-content-muted">
                        {source.citation.long}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {syncingOclc !== null && (
              <p className="mt-3 text-sm text-content-subtle">
                {t("languagePage.sourcesSyncing")}
              </p>
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

      {/* The parked-relations queue. A parked relation lists on BOTH sides'
          languages — either side's editor may be the one who can repair it —
          and `sides[0]` is always this language's side, so that is the entry
          the row opens: the re-affirm control lives there, where the entry's
          own senses are loaded. */}
      {parkedOpen && dashboard !== null && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="parked-dialog-title"
        >
          <div className="max-h-[calc(100dvh-2rem)] w-full overflow-y-auto rounded-t-xl border bg-surface p-4 shadow-lg sm:max-w-lg sm:rounded-xl sm:p-6">
            <h2 id="parked-dialog-title" className="text-lg font-semibold text-content">
              {t("languagePage.parkedTitle")}
            </h2>
            <p className="mt-1 text-sm text-content-subtle">{t("languagePage.parkedHint")}</p>

            {dashboard.parkedRelations.length === 0 ? (
              <p className="mt-4 text-sm text-content-muted">{t("languagePage.parkedEmpty")}</p>
            ) : (
              <>
                <ul className="mt-4 space-y-2">
                  {dashboard.parkedRelations.map((relation) => {
                    const own = relation.sides[0];
                    const other = relation.sides[1];
                    const stateLabel =
                      relation.state === "stale"
                        ? t("relations.stateStale")
                        : relation.state === "unresolved"
                          ? t("relations.stateUnresolved")
                          : t("relations.stateOversize");
                    return (
                      <li
                        key={relation.relationKey}
                        className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm"
                      >
                        <span className="rounded-full border px-2 py-0.5 text-xs text-content-muted">
                          {stateLabel}
                        </span>
                        {own.entryKey !== null ? (
                          <button
                            type="button"
                            onClick={() => {
                              setParkedOpen(false);
                              onOpenEntry(own.entryKey!);
                            }}
                            className="font-medium text-primary hover:text-primary-hover"
                          >
                            {own.orthography ?? own.recordedOrthography ?? own.entryKey}
                          </button>
                        ) : (
                          /* Nothing to link to — the record's own spelling is
                             all there is, which is exactly why a side carries
                             it. */
                          <span
                            className="font-medium text-content-muted"
                            title={t("relations.unresolvedSide")}
                          >
                            {own.recordedOrthography ?? "—"}
                          </span>
                        )}
                        <span aria-hidden="true" className="text-content-subtle">
                          ↔
                        </span>
                        <span className="text-content">
                          {other.orthography ?? other.recordedOrthography ?? "—"}
                        </span>
                        <span className="rounded border bg-surface px-1.5 py-0.5 font-mono text-xs text-content-muted">
                          {other.languageID}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                {parkedTotal > dashboard.parkedRelations.length && (
                  <p className="mt-3 text-xs text-content-subtle">
                    {t("languagePage.parkedMore", {
                      count: parkedTotal - dashboard.parkedRelations.length,
                      shown: dashboard.parkedRelations.length,
                    })}
                  </p>
                )}
              </>
            )}

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setParkedOpen(false)}
                className="rounded-lg border px-4 py-2 text-sm text-content hover:bg-black/5"
              >
                {t("languageRecord.cancel")}
              </button>
            </div>
          </div>
        </div>
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

      {/* Opened from this page, so this language is the main one — the choice
          that can never be edited afterwards is made where the context makes
          it obvious. */}
      {sourceEditorOpen && (
        <SourceEditorDialog
          languages={languages}
          mainLanguage={tag}
          onClose={() => setSourceEditorOpen(false)}
          onPublished={(oclc) => {
            setSourceEditorOpen(false);
            setSyncingOclc(oclc);
          }}
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
