import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { LanguageView } from "@leksis/types";
import { endonym } from "../components/LanguageSelector";
import { SourceEditorDialog } from "../components/SourceEditorDialog";
import { fetchCurrentSourceRecord } from "../lib/api";
import { fetchSource, forgetSource, type ResolvedSource } from "../lib/source-record";
import { navigateTo, userPath } from "../lib/routes";

const SYNC_POLL_MS = 3_000;
const SYNC_POLL_MAX_TRIES = 20; // ~60s of PDS → Jetstream → ArangoDB latency

interface SourcePageProps {
  /** The normalized OCLC number, from the /source/<oclc> path. */
  oclc: string;
  /** All known languages, for display names and the editor's pickers. */
  languages: LanguageView[];
  /** Navigate to a language's page. */
  onOpenLanguage: (tag: string) => void;
}

type LoadState = "loading" | "ready" | "failed";

/**
 * One work's page (/source/<oclc>) — what a citation after an example sentence
 * links to.
 *
 * It has a state no other resource page has: **cited but undescribed**. An
 * example references the number rather than a record, so a perfectly valid
 * citation can point here before anybody has written the description. That is
 * not a 404 and must not read like one — it is an invitation, and it is the
 * reason the whole reference scheme cannot break, only degrade.
 */
export function SourcePage({ oclc, languages, onOpenLanguage }: SourcePageProps) {
  const { t } = useTranslation();
  const [resolved, setResolved] = useState<ResolvedSource | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [editorOpen, setEditorOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  /** The version this page was showing when the reader published over it. */
  const baselineCid = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setResolved(null);
    setEditorOpen(false);
    forgetSource(oclc);
    fetchSource(oclc)
      .then((found) => {
        if (cancelled) return;
        setResolved(found);
        setState("ready");
      })
      .catch((err: unknown) => {
        console.error("source load failed:", err);
        if (!cancelled) setState("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [oclc, reloadNonce]);

  // After publishing, wait for the record to come back around through the
  // firehose. The number never changes and neither does the record URI when the
  // same author republishes, so the *cid* is what says a new version landed.
  useEffect(() => {
    if (!syncing) return;
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      fetchCurrentSourceRecord(oclc)
        .then((fresh) => {
          if (fresh !== null && fresh.cid !== baselineCid.current) {
            setSyncing(false);
            forgetSource(oclc);
            setReloadNonce((n) => n + 1);
          } else if (tries >= SYNC_POLL_MAX_TRIES) {
            console.warn(`source ${oclc} not indexed after polling; giving up`);
            setSyncing(false);
          }
        })
        .catch(() => {
          /* transient — keep polling */
        });
    }, SYNC_POLL_MS);
    return () => clearInterval(timer);
  }, [syncing, oclc]);

  const record = resolved?.record ?? null;
  const languageName = (tag: string) => {
    const known = languages.find((l) => l.tag === tag);
    return known ? endonym(known) : tag;
  };

  const oclcChip = (
    <span className="rounded border bg-surface px-1.5 py-0.5 font-mono text-xs text-content-muted">
      {t("sourcePage.oclcLabel")} {oclc}
    </span>
  );

  const detail = (label: string, value: string) => (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5">
      <dt className="w-32 shrink-0 text-xs text-content-muted">{label}</dt>
      <dd className="min-w-0 flex-1 text-sm text-content">{value}</dd>
    </div>
  );

  return (
    <div className="mt-6 flex flex-col">
      {state === "loading" && (
        <p className="text-sm text-content-muted">{t("sourcePage.loading")}</p>
      )}
      {state === "failed" && (
        <p className="text-sm text-danger">{t("sourcePage.loadFailed")}</p>
      )}

      {state === "ready" && (
        <article>
          <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-content sm:text-3xl">
              {record !== null && record.citation.short !== ""
                ? record.citation.short
                : (record?.title ?? t("sourcePage.undescribedTitle"))}
            </h1>
            {oclcChip}
          </header>

          {record === null ? (
            <div className="mt-5 rounded-lg border border-dashed bg-surface px-4 py-6 sm:px-6">
              <p className="text-sm text-content">
                {resolved === null ? t("sourcePage.undescribedHint") : t("sourcePage.unreadable")}
              </p>
              {resolved === null && (
                <button
                  type="button"
                  onClick={() => setEditorOpen(true)}
                  className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-fg hover:bg-primary-hover"
                >
                  {t("sourcePage.describe")}
                </button>
              )}
            </div>
          ) : (
            <>
              {record.title !== "" && (
                <p className="mt-3 text-lg text-content">{record.title}</p>
              )}

              <dl className="mt-5 space-y-2 rounded-lg border bg-surface p-4">
                {record.author !== undefined && detail(t("sourcePage.authorLabel"), record.author)}
                {record.year !== undefined && detail(t("sourcePage.yearLabel"), record.year)}
                {record.url !== undefined && (
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                    <dt className="w-32 shrink-0 text-xs text-content-muted">
                      {t("sourcePage.linkLabel")}
                    </dt>
                    <dd className="min-w-0 flex-1 text-sm">
                      <a
                        href={record.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="break-all text-primary underline hover:text-primary-hover"
                      >
                        {record.url}
                      </a>
                    </dd>
                  </div>
                )}
                {detail(t("sourcePage.citationShortLabel"), record.citation.short)}
                {detail(t("sourcePage.citationLongLabel"), record.citation.long)}
              </dl>

              <section className="mt-6">
                <h2 className="text-sm font-semibold text-content">
                  {t("sourcePage.languagesLabel")}
                </h2>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {record.languages.map((tag, i) => (
                    <li key={tag}>
                      <button
                        type="button"
                        onClick={() => onOpenLanguage(tag)}
                        className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm text-content hover:border-primary hover:bg-surface-muted"
                      >
                        {languageName(tag)}
                        <span className="rounded border bg-surface px-1.5 py-0.5 font-mono text-xs text-content-muted">
                          {tag}
                        </span>
                        {i === 0 && (
                          <span className="text-xs text-content-subtle">
                            {t("sourcePage.mainLanguage")}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>

              <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
                <button
                  type="button"
                  onClick={() => setEditorOpen(true)}
                  className="rounded-lg border px-4 py-2 text-sm text-content hover:border-primary hover:bg-surface-muted"
                >
                  {t("sourcePage.edit")}
                </button>
                {resolved !== null && (
                  <p className="text-xs text-content-subtle">
                    {t("sourcePage.describedBy")}{" "}
                    <button
                      type="button"
                      onClick={() => navigateTo(userPath(resolved.reference.authorDID))}
                      className="underline hover:text-content"
                    >
                      {resolved.reference.authorDID}
                    </button>
                  </p>
                )}
              </div>
            </>
          )}

          {syncing && (
            <p className="mt-4 text-sm text-content-subtle">{t("sourcePage.syncing")}</p>
          )}
        </article>
      )}

      {editorOpen && (
        <SourceEditorDialog
          languages={languages}
          {...(resolved !== null ? { editing: oclc } : { seedOclc: oclc })}
          onClose={() => setEditorOpen(false)}
          onPublished={() => {
            baselineCid.current = resolved?.reference.cid ?? null;
            setEditorOpen(false);
            setSyncing(true);
          }}
        />
      )}
    </div>
  );
}
