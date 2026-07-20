import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  formatAbbreviationRef,
  LEKSIS_LANGUAGE_COLLECTION,
  type AbbreviationView,
  type DashboardActivityDay,
  type DashboardFeedItem,
  type LanguageDashboardResponse,
  type LanguageTranslation,
  type LanguageView,
  type LeksisLanguageRecord,
} from "@leksis/types";
import { useSession } from "../auth/SessionProvider";
import { endonym } from "../components/LanguageSelector";
import { fetchAbbreviations, fetchLanguageDashboard, fetchLanguages } from "../lib/api";
import { fetchLanguageRecord } from "../lib/atproto-record";

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

interface NameRow {
  languageID: string;
  translation: string;
}

interface LanguagePageProps {
  /** The language's tag, from the /language/<tag> path. */
  tag: string;
  /** All known languages, for display names and the name-translation picker. */
  languages: LanguageView[];
  /** Navigate to an entry's page (todo queue, activity feed). */
  onOpenEntry: (key: string) => void;
  /** Navigate to another language's page (named-in review list). */
  onOpenLanguage: (tag: string) => void;
}

type LoadState = "loading" | "ready" | "not-found" | "failed";

/**
 * One language's dashboard (/language/<tag>), rendered under the persistent
 * search bar: entry counters, the to-be-completed review queue, the
 * harvested abbreviations with their conflicts, the activity feed and grid,
 * and the language's names — resolvable and extensible by publishing a new
 * version of the eu.leksis.language record from the editor's own PDS.
 * Entries themselves stay reachable through search only.
 */
export function LanguagePage({ tag, languages, onOpenEntry, onOpenLanguage }: LanguagePageProps) {
  const { t, i18n } = useTranslation();
  const { agent, did } = useSession();
  const [dashboard, setDashboard] = useState<LanguageDashboardResponse | null>(null);
  const [abbreviations, setAbbreviations] = useState<AbbreviationView[]>([]);
  const [namedIn, setNamedIn] = useState<LanguageView[]>([]);
  const [record, setRecord] = useState<LeksisLanguageRecord | null>(null);
  const [state, setState] = useState<LoadState>("loading");

  const [nameRows, setNameRows] = useState<NameRow[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  /** Record URI written to the PDS but not yet seen back from the AppView. */
  const [syncingURI, setSyncingURI] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setDashboard(null);
    setAbbreviations([]);
    setNamedIn([]);
    setRecord(null);
    setNameRows([]);

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

  // After publishing names: poll until the AppView serves the new record
  // version, then reload the names and the review list from it.
  useEffect(() => {
    if (syncingURI === null) return;
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      fetchLanguageDashboard(tag)
        .then(async (found) => {
          if (found !== null && found.language.recordURI === syncingURI) {
            setSyncingURI(null);
            setDashboard(found);
            setNameRows([]);
            const value = await fetchLanguageRecord(found.language.recordURI);
            if (value !== null) setRecord(value);
            fetchLanguages(tag)
              .then((list) =>
                setNamedIn(list.filter((l) => l.tag !== tag && l.name !== undefined)),
              )
              .catch(() => {});
          } else if (tries >= SYNC_POLL_MAX_TRIES) {
            console.warn(`language update ${syncingURI} not indexed after polling; giving up`);
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
  const translatedTags = new Set((record?.translations ?? []).map((tr) => tr.languageID));
  const targetOptions = languages.filter((l) => !translatedTags.has(l.tag));

  function setNameRow(index: number, patch: Partial<NameRow>) {
    setNameRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  const additions: LanguageTranslation[] = nameRows
    .filter((row) => row.languageID !== "" && row.translation.trim() !== "")
    .map((row) => ({ languageID: row.languageID, translation: row.translation.trim() }));
  const canPublish =
    !publishing && syncingURI === null && record !== null && additions.length > 0 && !!agent && !!did;

  // Publishing = a full rewrite of the eu.leksis.language record (rkey =
  // tag) on the editor's own PDS: existing names (endonym included) plus the
  // additions. Last write wins across authors; the AppView re-indexes it
  // from the firehose (ADR-0002).
  async function publishNames() {
    if (!canPublish || !agent || !did || record === null) return;
    const updated: LeksisLanguageRecord = {
      $type: LEKSIS_LANGUAGE_COLLECTION,
      tag,
      translations: [...record.translations, ...additions],
      createdAt: new Date().toISOString(),
    };
    setPublishing(true);
    setPublishError(null);
    try {
      const res = await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: LEKSIS_LANGUAGE_COLLECTION,
        rkey: tag,
        // putRecord wants an index signature our interface doesn't declare.
        record: { ...updated },
      });
      setSyncingURI(res.data.uri);
    } catch (err) {
      console.error("putRecord failed:", err);
      setPublishError(t("languagePage.namesError"));
    } finally {
      setPublishing(false);
    }
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
              {language !== null ? endonym(language) : tag}
            </h1>
            <span className="rounded border bg-surface px-1.5 py-0.5 font-mono text-xs text-content-muted">
              {tag}
            </span>
          </header>

          <div className="mt-5 grid grid-cols-2 gap-3 sm:max-w-sm">
            <div className="rounded-lg border bg-surface p-4">
              <p className="text-2xl font-semibold text-content">{dashboard.entriesCount}</p>
              <p className="mt-1 text-xs text-content-muted">{t("languagePage.statsEntries")}</p>
            </div>
            <div className="rounded-lg border bg-surface p-4">
              <p className="text-2xl font-semibold text-content">{dashboard.todoCount}</p>
              <p className="mt-1 text-xs text-content-muted">{t("languagePage.statsTodo")}</p>
            </div>
          </div>

          <section className="mt-8">
            <h2 className="text-sm font-semibold text-content">{t("languagePage.todoTitle")}</h2>
            <p className="mt-1 text-xs text-content-subtle">{t("languagePage.todoHint")}</p>
            {dashboard.todoEntries.length === 0 ? (
              <p className="mt-2 text-sm text-content-muted">{t("languagePage.todoEmpty")}</p>
            ) : (
              <>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {dashboard.todoEntries.map((entry) => (
                    <li key={entry.key}>
                      <button
                        type="button"
                        onClick={() => onOpenEntry(entry.key)}
                        className="rounded-full border bg-surface-muted/60 px-2.5 py-1 text-xs text-content hover:border-primary hover:text-primary"
                      >
                        <span aria-hidden="true">⚠ </span>
                        {entry.orthography[0]}
                      </button>
                    </li>
                  ))}
                </ul>
                {dashboard.todoCount > dashboard.todoEntries.length && (
                  <p className="mt-2 text-xs text-content-subtle">
                    {t("languagePage.todoMore", {
                      count: dashboard.todoCount - dashboard.todoEntries.length,
                      shown: dashboard.todoEntries.length,
                    })}
                  </p>
                )}
              </>
            )}
          </section>

          <section className="mt-8">
            <h2 className="text-sm font-semibold text-content">
              {t("languagePage.abbreviationsTitle")}
            </h2>
            <p className="mt-1 text-xs text-content-subtle">
              {t("languagePage.abbreviationsHint")}
            </p>
            {abbreviations.length === 0 ? (
              <p className="mt-2 text-sm text-content-muted">
                {t("languagePage.abbreviationsEmpty")}
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {abbreviations.map((abbreviation, i) => {
                  const conflicted = abbreviation.conflictsWith.length > 0;
                  return (
                    <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span
                        className={`rounded-full border bg-surface-muted/60 px-2.5 py-0.5 font-mono text-xs text-content ${
                          conflicted ? "border-red-400" : ""
                        }`}
                      >
                        {conflicted && <span aria-hidden="true">⚠ </span>}
                        {abbreviation.short ?? abbreviation.long}
                      </span>
                      {abbreviation.short !== undefined && (
                        <span className="text-sm text-content">{abbreviation.long}</span>
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
          </section>

          <section className="mt-8">
            <h2 className="text-sm font-semibold text-content">
              {t("languagePage.activityTitle")}
            </h2>
            <ActivityGrid activity={dashboard.activity} />
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

          <section className="mt-8">
            <h2 className="text-sm font-semibold text-content">{t("languagePage.namesTitle")}</h2>
            <p className="mt-1 text-xs text-content-subtle">{t("languagePage.namesHint")}</p>

            {record === null ? (
              <p className="mt-2 text-sm text-content-muted">
                {t("languagePage.namesRecordUnavailable")}
              </p>
            ) : (
              <>
                <ul className="mt-2 space-y-1">
                  {record.translations.map((translation, i) => (
                    <li key={i} className="flex items-baseline gap-2 text-sm">
                      <span className="rounded border bg-surface px-1.5 py-0.5 font-mono text-xs text-content-muted">
                        {translation.languageID}
                      </span>
                      <span className="text-content">{translation.translation}</span>
                    </li>
                  ))}
                </ul>

                {nameRows.map((row, i) => (
                  <div key={i} className="mt-2 flex items-center gap-2">
                    <label className="sr-only" htmlFor={`language-name-lang-${i}`}>
                      {t("languagePage.namesInLabel")}
                    </label>
                    <select
                      id={`language-name-lang-${i}`}
                      value={row.languageID}
                      onChange={(e) => setNameRow(i, { languageID: e.target.value })}
                      className="w-28 min-w-0 shrink-0 rounded-lg border bg-surface px-2 py-2 text-sm text-content outline-none focus:ring-2 sm:w-36"
                    >
                      <option value="" />
                      {targetOptions.map((l) => (
                        <option key={l.tag} value={l.tag}>
                          {endonym(l)}
                        </option>
                      ))}
                    </select>
                    <label className="sr-only" htmlFor={`language-name-value-${i}`}>
                      {t("languagePage.namesNameLabel")}
                    </label>
                    <input
                      id={`language-name-value-${i}`}
                      value={row.translation}
                      onChange={(e) => setNameRow(i, { translation: e.target.value })}
                      className="min-w-0 flex-1 rounded-lg border bg-surface px-3 py-2 text-sm text-content outline-none focus:ring-2"
                    />
                    <button
                      type="button"
                      onClick={() => setNameRows((prev) => prev.filter((_, j) => j !== i))}
                      aria-label={t("languagePage.namesRemoveRow")}
                      title={t("languagePage.namesRemoveRow")}
                      className="shrink-0 rounded-lg px-2 py-1 text-lg leading-none text-content-subtle hover:bg-surface-muted hover:text-content"
                    >
                      ×
                    </button>
                  </div>
                ))}

                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setNameRows((prev) => [...prev, { languageID: "", translation: "" }])}
                    className="text-sm text-primary hover:text-primary-hover"
                  >
                    {t("languagePage.namesAddRow")}
                  </button>
                  {additions.length > 0 && (
                    <button
                      type="button"
                      onClick={() => void publishNames()}
                      disabled={!canPublish}
                      className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-fg hover:bg-primary-hover disabled:opacity-50"
                    >
                      {publishing
                        ? t("languagePage.namesPublishing")
                        : t("languagePage.namesPublish")}
                    </button>
                  )}
                </div>
                {syncingURI !== null && (
                  <p className="mt-2 text-sm text-content-subtle">
                    {t("languagePage.namesSyncing")}
                  </p>
                )}
                {publishError !== null && (
                  <p className="mt-2 text-sm text-red-600">{publishError}</p>
                )}
              </>
            )}

            {namedIn.length > 0 && (
              <>
                <h3 className="mt-5 text-sm font-semibold text-content">
                  {t("languagePage.namedInTitle")}
                </h3>
                <p className="mt-1 text-xs text-content-subtle">{t("languagePage.namedInHint")}</p>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {namedIn.map((l) => (
                    <li key={l.tag}>
                      <button
                        type="button"
                        onClick={() => onOpenLanguage(l.tag)}
                        className="rounded-full border bg-surface-muted/60 px-2.5 py-1 text-xs text-content hover:border-primary hover:text-primary"
                      >
                        {l.name}{" "}
                        <span className="font-mono text-content-subtle">{l.tag}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </article>
      )}
    </div>
  );
}
