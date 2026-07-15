import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  type EntryDefinition,
  type EntryView,
  type LanguageView,
  type LeksisEntryRecord,
} from "@leksis/types";
import { EntryEditorDialog } from "../components/CreateEntryPanel";
import { endonym } from "../components/LanguageSelector";
import { fetchEntry } from "../lib/api";
import { fetchEntryRecord } from "../lib/atproto-record";
import { definitionsDepth, placeLabel } from "../lib/definition-tree";

/** Indentation per definition depth (its place's length, 1–3). */
const DEPTH_INDENT = ["", "pl-5 sm:pl-6", "pl-10 sm:pl-12"];

/**
 * The flat definitions list, in the record's reading order. Each row shows
 * its full place label — arabic only (1), roman → arabic (2), letters →
 * roman → arabic (3) — and indents by its own depth.
 */
function DefinitionList({ definitions }: { definitions: EntryDefinition[] }): ReactNode {
  const depth = definitionsDepth(definitions);
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
                {def.notes.map((note, j) => (
                  <abbr
                    key={j}
                    title={note.long}
                    className="mr-1 rounded border bg-surface-muted/60 px-1.5 py-0.5 font-mono text-xs text-content-muted no-underline"
                  >
                    {note.short}
                  </abbr>
                ))}
              </span>
            )}
            <span className="text-sm text-content">{def.text}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

const SYNC_POLL_MS = 3_000;
const SYNC_POLL_MAX_TRIES = 20; // ~60s of PDS → Jetstream → ArangoDB latency

interface EntryPageProps {
  /** The entry's stable key, from the ?e= query param. */
  entryKey: string;
  /** All known languages, for name display and the editor dialog. */
  languages: LanguageView[];
  /** Navigate back to the search surface. */
  onBack: () => void;
}

type LoadState = "loading" | "ready" | "not-found" | "record-gone" | "failed";

/**
 * One entry's page (?e=<entry-key>). The AppView only serves the search
 * view — orthographies, language and the record reference; the content
 * (categories, definitions with their notes) is resolved straight from the
 * author's PDS, which stays the source of truth. From here the reader can
 * propose changes: a full-rewrite record on their own PDS carrying
 * `subject`, which the AppView indexes as the entry's new current version.
 */
export function EntryPage({ entryKey, languages, onBack }: EntryPageProps) {
  const { t } = useTranslation();
  const [view, setView] = useState<EntryView | null>(null);
  const [record, setRecord] = useState<LeksisEntryRecord | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [proposing, setProposing] = useState(false);
  /** Record URI written to the PDS but not yet seen back from the AppView. */
  const [syncingURI, setSyncingURI] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setView(null);
    setRecord(null);

    (async () => {
      try {
        const found = await fetchEntry(entryKey);
        if (cancelled) return;
        if (found === null) return setState("not-found");
        setView(found);
        const content = await fetchEntryRecord(found.recordURI);
        if (cancelled) return;
        if (content === null) return setState("record-gone");
        setRecord(content);
        setState("ready");
      } catch (err) {
        console.error("entry load failed:", err);
        if (!cancelled) setState("failed");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [entryKey]);

  // After a proposal: poll until the AppView serves the new version, then
  // re-resolve the content from the proposer's PDS.
  useEffect(() => {
    if (syncingURI === null) return;
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      fetchEntry(entryKey)
        .then(async (found) => {
          if (found !== null && found.recordURI === syncingURI) {
            setSyncingURI(null);
            setView(found);
            const content = await fetchEntryRecord(found.recordURI);
            if (content !== null) setRecord(content);
          } else if (tries >= SYNC_POLL_MAX_TRIES) {
            console.warn(`proposal ${syncingURI} not indexed after polling; giving up`);
            setSyncingURI(null);
          }
        })
        .catch(() => {
          /* transient — keep polling */
        });
    }, SYNC_POLL_MS);
    return () => clearInterval(timer);
  }, [syncingURI, entryKey]);

  const language =
    view !== null ? (languages.find((l) => l.tag === view.languageID) ?? null) : null;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-10 sm:px-6 sm:py-16">
      <button
        type="button"
        onClick={onBack}
        className="self-start text-sm text-primary hover:text-primary-hover"
      >
        {t("entry.backToSearch")}
      </button>

      {state === "loading" && (
        <p className="mt-6 text-sm text-content-muted">{t("entry.loading")}</p>
      )}
      {state === "not-found" && (
        <p className="mt-6 text-sm text-content-muted">{t("entry.notFound")}</p>
      )}
      {state === "record-gone" && (
        <p className="mt-6 text-sm text-red-600">{t("entry.recordGone")}</p>
      )}
      {state === "failed" && (
        <p className="mt-6 text-sm text-red-600">{t("entry.loadFailed")}</p>
      )}

      {state === "ready" && view !== null && record !== null && (
        <article className="mt-6">
          <header>
            <h1 className="text-2xl font-semibold tracking-tight text-content sm:text-3xl">
              {record.orthography[0]}
            </h1>
            {record.orthography.length > 1 && (
              <p className="mt-1 text-sm text-content-muted">
                {record.orthography.slice(1).join(", ")}
              </p>
            )}
            <p className="mt-2 text-sm text-content-muted">
              {language !== null ? endonym(language) : view.languageID}{" "}
              <span className="rounded border bg-surface px-1.5 py-0.5 font-mono text-xs">
                {view.languageID}
              </span>
            </p>
            {record.categories.length > 0 && (
              <ul className="mt-3 flex flex-wrap items-center gap-1.5" aria-label={t("entry.categoriesLabel")}>
                {record.categories.map((category, i) => (
                  <li
                    key={i}
                    title={category.long}
                    className="rounded-full border bg-surface-muted/60 px-2.5 py-1 font-mono text-xs text-content"
                  >
                    <abbr title={category.long} className="no-underline">
                      {category.short}
                    </abbr>
                  </li>
                ))}
              </ul>
            )}
          </header>

          <section className="mt-6">
            <h2 className="sr-only">{t("entry.definitionsLabel")}</h2>
            <DefinitionList definitions={record.definitions} />
          </section>

          <footer className="mt-8 border-t pt-4">
            <p className="text-xs text-content-subtle">
              {t("entry.authorLabel")}{" "}
              <span className="break-all font-mono">{view.authorDID}</span>
            </p>
            {syncingURI !== null ? (
              <p className="mt-3 text-sm text-content-subtle">{t("entry.syncing")}</p>
            ) : (
              <button
                type="button"
                onClick={() => setProposing(true)}
                className="mt-3 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-fg hover:bg-primary-hover focus:outline-none focus:ring-2"
              >
                {t("entry.propose")}
              </button>
            )}
          </footer>
        </article>
      )}

      {proposing && view !== null && record !== null && (
        <EntryEditorDialog
          languages={languages}
          language={language}
          initial={record}
          subject={view.recordURI}
          onClose={() => setProposing(false)}
          onCreated={(uri) => {
            setProposing(false);
            setSyncingURI(uri);
          }}
        />
      )}
    </main>
  );
}
