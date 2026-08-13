import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  canonicalizePlacePrefix,
  labelLookup,
  placePathKey,
  placePrefixMatches,
  type LabelView,
  type CognateNetworkResponse,
  type EntryRelationsResponse,
  type EntryView,
  type Grammar,
  type LanguageView,
  type LeksisEntryRecord,
  type RelationView,
} from "@leksis/types";
import { EntryEditorDialog } from "../components/CreateEntryPanel";
import { DefinitionList, TagChips } from "../components/EntryPreview";
import { EntryCognates, ParkedCognates } from "../components/EntryCognates";
import {
  CognateEditorDialog,
  type CognateEditorLaunch,
} from "../components/CognateEditorDialog";
import { ParkedRelations, SenseRelations } from "../components/EntryRelations";
import {
  RelationEditorDialog,
  type RelationEditorLaunch,
} from "../components/RelationEditorDialog";
import { useSession } from "../auth/SessionProvider";
import { EntryParadigm } from "../components/ParadigmView";
import { endonym } from "../components/LanguageSelector";
import {
  fetchEntryCognates,
  fetchEntryRelations,
  fetchLabels,
  fetchEntry,
  searchEntries,
} from "../lib/api";
import { fetchEntryRecord } from "../lib/atproto-record";
import { fetchLanguageGrammar } from "../lib/language-grammar";

const SYNC_POLL_MS = 3_000;
const SYNC_POLL_MAX_TRIES = 20; // ~60s of PDS → Jetstream → ArangoDB latency

/**
 * Same-language entries sharing a written form with this one — separate
 * entries by design (a record without `subject` is a new entry), surfaced so
 * readers can hop between homonyms and spot accidental duplicates. Reuses the
 * prefix-search endpoint, narrowed to exact orthography matches.
 */
async function fetchHomonyms(view: EntryView): Promise<EntryView[]> {
  const forms = [...new Set(view.orthography.map((o) => o.toLowerCase()))];
  const results = await Promise.all(forms.map((form) => searchEntries(form, view.languageID)));
  const homonyms = new Map<string, EntryView>();
  for (const candidate of results.flat()) {
    if (candidate.key === view.key || homonyms.has(candidate.key)) continue;
    if (candidate.orthography.some((o) => forms.includes(o.toLowerCase()))) {
      homonyms.set(candidate.key, candidate);
    }
  }
  return [...homonyms.values()];
}

interface EntryPageProps {
  /** The entry's stable key, from the /entry/<key> path. */
  entryKey: string;
  /** All known languages, for name display and the editor dialog. */
  languages: LanguageView[];
  /** Navigate back to the search surface. */
  onBack: () => void;
  /** Navigate to another entry's page (used by the homonyms list). */
  onOpenEntry: (key: string) => void;
  /** Navigate to the entry's language dashboard (the header chip). */
  onOpenLanguage: (tag: string) => void;
}

type LoadState = "loading" | "ready" | "deleted" | "not-found" | "record-gone" | "failed";

/**
 * One entry's page (/entry/<key>), rendered under the persistent search bar.
 * The AppView only serves the search view — orthographies, language and the
 * record reference; the content (categories, definitions with their notes)
 * is resolved straight from the author's PDS, which stays the source of
 * truth. From here the reader can propose changes: a full-rewrite record on
 * their own PDS carrying `subject`, which the AppView indexes as the entry's
 * new current version.
 */
export function EntryPage({
  entryKey,
  languages,
  onBack,
  onOpenEntry,
  onOpenLanguage,
}: EntryPageProps) {
  const { t } = useTranslation();
  const { did } = useSession();
  const [view, setView] = useState<EntryView | null>(null);
  const [record, setRecord] = useState<LeksisEntryRecord | null>(null);
  const [homonyms, setHomonyms] = useState<EntryView[]>([]);
  /** The language's labelled tags, for the ⚠ conflict flags. */
  const [labels, setLabels] = useState<LabelView[]>([]);
  /**
   * The language's declared grammar, which is what lays this entry's forms out.
   * Best-effort like the rest of the side data: absent means the flat list, and
   * the paradigm's fallback chain treats that as an ordinary state.
   */
  const [grammar, setGrammar] = useState<Grammar | undefined>(undefined);
  /**
   * The semantic network's view of this entry: what it can be shown with, and
   * what is parked for repair. Best-effort side data like the rest — an entry
   * reads exactly as before when the network knows nothing about it.
   */
  const [relations, setRelations] = useState<EntryRelationsResponse | null>(null);
  /**
   * The cognate network around this entry — the whole component, not just what
   * was asserted about this word. Best-effort side data like the relations: an
   * entry reads exactly as before when nothing links to it.
   */
  const [cognates, setCognates] = useState<CognateNetworkResponse | null>(null);
  /** The cognate editor's launch context. Null = closed. */
  const [cognateLaunch, setCognateLaunch] = useState<CognateEditorLaunch | null>(null);
  /** Polling the network back after publishing or withdrawing a cognate. */
  const [cognateSyncing, setCognateSyncing] = useState(false);
  const [state, setState] = useState<LoadState>("loading");
  const [proposing, setProposing] = useState(false);
  /**
   * The relation editor's launch context — which sense it was opened from, and
   * which relation (if any) it is proposing a new version of. Null = closed.
   */
  const [relationLaunch, setRelationLaunch] = useState<RelationEditorLaunch | null>(null);
  /**
   * Polling the relations back after publishing one. Unlike an entry proposal
   * there is no single URI to wait for — a withdrawal has none at all — so the
   * page simply re-reads the network's view of this entry until it settles.
   */
  const [relationSyncing, setRelationSyncing] = useState(false);
  /** The redirect target's own view, resolved for display when this entry was deleted as a duplicate. */
  const [redirectTarget, setRedirectTarget] = useState<EntryView | null>(null);
  /** Record URI written to the PDS but not yet seen back from the AppView. */
  const [syncingURI, setSyncingURI] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setView(null);
    setRecord(null);
    setHomonyms([]);
    setLabels([]);
    setGrammar(undefined);
    setRelations(null);
    setCognates(null);
    setRedirectTarget(null);

    (async () => {
      try {
        const found = await fetchEntry(entryKey);
        if (cancelled) return;
        if (found === null) return setState("not-found");
        setView(found);
        if (found.deleted === true) {
          if (found.redirectTo !== undefined && found.redirectTo !== "") {
            fetchEntry(found.redirectTo)
              .then((target) => {
                if (!cancelled) setRedirectTarget(target);
              })
              .catch(() => {});
          }
          return setState("deleted");
        }
        // Best-effort side data — a failure never blocks the entry itself.
        fetchHomonyms(found)
          .then((others) => {
            if (!cancelled) setHomonyms(others);
          })
          .catch(() => {});
        fetchLabels(found.languageID)
          .then((list) => {
            if (!cancelled) setLabels(list);
          })
          .catch(() => {});
        fetchEntryRelations(found.key)
          .then((found2) => {
            if (!cancelled) setRelations(found2);
          })
          .catch(() => {});
        fetchEntryCognates(found.key)
          .then((network) => {
            if (!cancelled) setCognates(network);
          })
          .catch(() => {});
        // Hydration: the language's own declaration is what turns this entry's
        // list of forms into its paradigm. It never rejects, so there is nothing
        // to catch — an absent grammar is the flat list.
        fetchLanguageGrammar(found.languageID).then((declared) => {
          if (!cancelled) setGrammar(declared);
        });
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
            if (found.deleted === true) {
              setState("deleted");
              if (found.redirectTo !== undefined && found.redirectTo !== "") {
                fetchEntry(found.redirectTo)
                  .then(setRedirectTarget)
                  .catch(() => {});
              }
              return;
            }
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

  // After publishing or withdrawing a relation: re-read this entry's relations
  // until the AppView has caught up with the PDS write.
  useEffect(() => {
    if (!relationSyncing) return;
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      // The give-up check sits outside the promise: a persistently failing API
      // must still end the poll, or the "publishing…" line never clears.
      if (tries >= SYNC_POLL_MAX_TRIES) setRelationSyncing(false);
      fetchEntryRelations(entryKey)
        .then((found) => {
          if (found !== null) setRelations(found);
        })
        .catch(() => {
          /* transient — the tries counter above ends it either way */
        });
    }, SYNC_POLL_MS);
    return () => clearInterval(timer);
  }, [relationSyncing, entryKey]);

  // After publishing or withdrawing a cognate: re-read the network until the
  // AppView has caught up with the PDS write. Same shape as the relation poll —
  // a withdrawal has no URI to wait for either.
  useEffect(() => {
    if (!cognateSyncing) return;
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      // Outside the promise, so a persistently failing API still ends the poll.
      if (tries >= SYNC_POLL_MAX_TRIES) setCognateSyncing(false);
      fetchEntryCognates(entryKey)
        .then((network) => {
          if (network !== null) setCognates(network);
        })
        .catch(() => {
          /* transient — the tries counter above ends it either way */
        });
    }, SYNC_POLL_MS);
    return () => clearInterval(timer);
  }, [cognateSyncing, entryKey]);

  const language =
    view !== null ? (languages.find((l) => l.tag === view.languageID) ?? null) : null;

  /**
   * Live relations split the way the page reads them: those claiming the whole
   * word (`place: []`) belong on the header, the rest under the definition they
   * name.
   *
   * A relation whose prefix names a *group* rather than a single sense attaches
   * to the first definition that prefix matches, keeping its own address
   * visible — it is shown where a reader will find it rather than dropped for
   * not landing on a leaf.
   */
  const { wholeEntry, senseExtras } = useMemo(() => {
    const whole: RelationView[] = [];
    const bySense = new Map<string, RelationView[]>();
    if (relations !== null && record !== null) {
      const places = record.definitions.map((def) => canonicalizePlacePrefix(def.place));
      for (const relation of relations.relations) {
        const prefix = canonicalizePlacePrefix(relation.sides[0].place);
        if (prefix.length === 0) {
          whole.push(relation);
          continue;
        }
        const anchor = places.find((place) => placePrefixMatches(prefix, place));
        if (anchor === undefined) {
          // The prefix addresses nothing in the version being displayed — show
          // it on the header rather than losing it.
          whole.push(relation);
          continue;
        }
        const key = placePathKey(anchor);
        bySense.set(key, [...(bySense.get(key) ?? []), relation]);
      }
    }
    // One slot per definition node, not only per related one: the invitation to
    // relate a sense has to be where the sense is, including — especially — on
    // the senses nothing has been said about yet.
    const extras = new Map<string, ReactNode>();
    if (record !== null && view !== null) {
      for (const def of record.definitions) {
        const place = canonicalizePlacePrefix(def.place);
        if (place.length === 0) continue;
        const key = placePathKey(place);
        if (extras.has(key)) continue;
        const list = bySense.get(key) ?? [];
        extras.set(
          key,
          <>
            {list.length > 0 && (
              <SenseRelations
                relations={list}
                languageID={view.languageID}
                languages={languages}
                onOpenEntry={onOpenEntry}
                onEdit={
                  did !== null
                    ? (relation) =>
                        setRelationLaunch({
                          source: { view, record, place: relation.sides[0].place },
                          targetEntryKey: relation.sides[1].entryKey,
                          targetPlace: relation.sides[1].place,
                          targetLanguage: relation.sides[1].languageID,
                          targetQuery: relation.sides[1].recordedOrthography ?? "",
                          existing: relation,
                        })
                    : undefined
                }
              />
            )}
            {did !== null && (
              <button
                type="button"
                title={t("relations.addHint")}
                onClick={() => setRelationLaunch({ source: { view, record, place } })}
                className="ml-2 text-xs text-primary hover:text-primary-hover"
              >
                {t("relations.addLabel")}
              </button>
            )}
          </>,
        );
      }
    }
    return { wholeEntry: whole, senseExtras: extras };
  }, [relations, record, view, languages, onOpenEntry, did, t]);

  return (
    <div className="mt-6 flex flex-col">
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

      {state === "deleted" && view !== null && (
        <section className="mt-6 rounded-lg border border-amber-400 bg-amber-400/10 p-4">
          <h1 className="text-lg font-semibold text-content">{t("entry.deletedTitle")}</h1>
          {view.deletionReason !== undefined && view.deletionReason !== "" && (
            <p className="mt-2 text-sm text-content">
              <span className="font-medium">{t("entry.deletedReasonLabel")}</span>{" "}
              {view.deletionReason}
            </p>
          )}
          {redirectTarget !== null && (
            <p className="mt-3 text-sm">
              {t("entry.deletedRedirectLabel")}{" "}
              <button
                type="button"
                onClick={() => onOpenEntry(redirectTarget.key)}
                className="text-primary hover:text-primary-hover"
              >
                {redirectTarget.orthography[0]}{" "}
                <span className="font-mono text-content-subtle">{redirectTarget.key}</span>
              </button>
            </p>
          )}
        </section>
      )}

      {state === "ready" && view !== null && record !== null && (
        <article className="mt-6">
          <header>
            {/* The language sits top right and opens its dashboard. */}
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h1 className="text-2xl font-semibold tracking-tight text-content sm:text-3xl">
                  {record.orthography[0]}
                </h1>
                {record.orthography.length > 1 && (
                  <p className="mt-1 text-sm text-content-muted">
                    {record.orthography.slice(1).join(", ")}
                  </p>
                )}
                {record.transcription !== undefined && record.transcription !== "" && (
                  <p
                    className="mt-1 font-mono text-sm text-content-muted"
                    aria-label={t("entry.transcriptionLabel")}
                  >
                    {record.transcription}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => onOpenLanguage(view.languageID)}
                title={t("entry.openLanguage")}
                className="mt-1 shrink-0 rounded-full border bg-surface px-3 py-1 text-sm text-content-muted hover:border-primary hover:text-primary"
              >
                {language !== null ? endonym(language) : view.languageID}{" "}
                <span className="font-mono text-xs">{view.languageID}</span>
              </button>
            </div>
            {record.categories.length > 0 && (
              <ul
                className="mt-3 flex flex-wrap items-center gap-1.5"
                aria-label={t("entry.categoriesLabel")}
              >
                <TagChips tags={record.categories} lookup={labelLookup(labels)} />
              </ul>
            )}
            {record.otherForms !== undefined && record.otherForms.length > 0 && (
              <div className="mt-3">
                {/* Laid out the way the language says, and a flat list when it
                    has said nothing — the fallback this layer must never
                    break. */}
                <EntryParadigm
                  grammar={grammar}
                  categories={record.categories}
                  forms={record.otherForms}
                  lookup={labelLookup(labels)}
                />
              </div>
            )}
            {/* Assertions about the word as a whole, rather than about one of
                its senses — the record-level "every meaning" claim. */}
            {wholeEntry.length > 0 && (
              <div className="mt-3">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-content-subtle">
                  {t("relations.wholeEntryLabel")}
                </h2>
                <SenseRelations
                  relations={wholeEntry}
                  languageID={view.languageID}
                  languages={languages}
                  onOpenEntry={onOpenEntry}
                  showPlace
                  onEdit={
                    did !== null
                      ? (relation) =>
                          setRelationLaunch({
                            source: { view, record, place: relation.sides[0].place },
                            targetEntryKey: relation.sides[1].entryKey,
                            targetPlace: relation.sides[1].place,
                            targetLanguage: relation.sides[1].languageID,
                            targetQuery: relation.sides[1].recordedOrthography ?? "",
                            existing: relation,
                          })
                      : undefined
                  }
                />
              </div>
            )}
            {relationSyncing && (
              <p className="mt-2 text-xs text-content-subtle">{t("relations.syncing")}</p>
            )}
          </header>

          {record.todo !== undefined && record.todo.length > 0 && (
            <section className="mt-6 rounded-lg border bg-surface-muted/40 p-3">
              <h2 className="text-sm font-semibold text-content">
                <span aria-hidden="true">⚠ </span>
                {t("entry.todoLabel")}
              </h2>
              <p className="mt-1 text-xs text-content-subtle">{t("entry.todoHint")}</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {record.todo.map((item, i) => (
                  <li key={i} className="text-sm text-content">
                    {item}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="mt-6">
            <h2 className="sr-only">{t("entry.definitionsLabel")}</h2>
            <DefinitionList
              definitions={record.definitions}
              labels={labels}
              senseExtras={senseExtras}
            />
          </section>

          {relations !== null && (
            <ParkedRelations
              parked={relations.parked}
              languages={languages}
              onOpenEntry={onOpenEntry}
              onEdit={
                did !== null
                  ? (relation) =>
                      setRelationLaunch({
                        source: { view, record, place: relation.sides[0].place },
                        targetEntryKey: relation.sides[1].entryKey,
                        targetPlace: relation.sides[1].place,
                        targetLanguage: relation.sides[1].languageID,
                        targetQuery: relation.sides[1].recordedOrthography ?? "",
                        existing: relation,
                      })
                  : undefined
              }
            />
          )}

          {/* Etymology, then the cognate network it hands off to: the word's
              history as prose, and the machine-followable half of the same
              knowledge as a graph. They read as one topic, so they sit
              together. */}
          {record.etymology !== undefined && record.etymology.length > 0 && (
            <section className="mt-6">
              <h2 className="text-sm font-semibold text-content">{t("entry.etymologyLabel")}</h2>
              <div className="mt-2 space-y-2">
                {record.etymology.map((paragraph, i) => (
                  <p key={i} className="text-sm text-content-muted">
                    {paragraph}
                  </p>
                ))}
              </div>
            </section>
          )}

          {cognates !== null && (
            <>
              <EntryCognates
                network={cognates}
                languageID={view.languageID}
                languages={languages}
                onOpenEntry={onOpenEntry}
                onAdd={did !== null ? () => setCognateLaunch({ source: view }) : undefined}
              />
              <ParkedCognates
                parked={cognates.parked}
                languages={languages}
                onOpenEntry={onOpenEntry}
                onEdit={
                  did !== null
                    ? (cognate) =>
                        setCognateLaunch({
                          source: view,
                          targetEntryKey: cognate.sides[1].entryKey,
                          targetLanguage: cognate.sides[1].languageID,
                          targetQuery: cognate.sides[1].recordedOrthography ?? "",
                          existing: cognate,
                        })
                    : undefined
                }
              />
            </>
          )}
          {cognateSyncing && (
            <p className="mt-2 text-xs text-content-subtle">{t("cognates.syncing")}</p>
          )}

          {record.notes !== undefined && record.notes.length > 0 && (
            <section className="mt-6">
              <h2 className="text-sm font-semibold text-content">{t("entry.notesLabel")}</h2>
              <ul className="mt-2 space-y-1.5">
                {record.notes.map((note, i) => (
                  <li key={i} className="text-sm text-content-muted">
                    {note}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {homonyms.length > 0 && (
            <section className="mt-8">
              <h2 className="text-sm font-semibold text-content">
                {t("entry.homonymsLabel")}
              </h2>
              <p className="mt-1 text-xs text-content-subtle">{t("entry.homonymsHint")}</p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {homonyms.map((homonym) => (
                  <li key={homonym.key}>
                    <button
                      type="button"
                      onClick={() => onOpenEntry(homonym.key)}
                      className="rounded-full border bg-surface-muted/60 px-2.5 py-1 text-xs text-content hover:border-primary hover:text-primary"
                    >
                      {homonym.orthography[0]}{" "}
                      <span className="font-mono text-content-subtle">{homonym.key}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <footer className="mt-8 border-t pt-4">
            {record.references !== undefined && record.references.length > 0 && (
              <section className="mb-4">
                <h2 className="text-sm font-semibold text-content">{t("entry.referencesLabel")}</h2>
                <ul className="mt-2 space-y-1">
                  {record.references.map((ref, i) => (
                    <li key={i} className="text-sm">
                      {ref.url !== undefined && ref.url !== "" ? (
                        <a
                          href={ref.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="break-words text-primary hover:text-primary-hover"
                        >
                          {ref.text}
                        </a>
                      ) : (
                        <span className="text-content-muted">{ref.text}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <p className="text-xs">
              {/* The record URI goes into the path verbatim — atproto.at
                  expects the raw at:// form, so no percent-encoding. */}
              <a
                href={`https://atproto.at/uri/${view.recordURI}`}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all text-primary hover:text-primary-hover"
              >
                {t("entry.viewRecord")}
              </a>
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
          entryView={view}
          onClose={() => setProposing(false)}
          onCreated={(uri) => {
            setProposing(false);
            setSyncingURI(uri);
          }}
          onDeleted={(uri) => {
            setProposing(false);
            setSyncingURI(uri);
          }}
        />
      )}

      {cognateLaunch !== null && (
        <CognateEditorDialog
          {...cognateLaunch}
          languages={languages}
          onClose={() => setCognateLaunch(null)}
          onPublished={() => {
            setCognateLaunch(null);
            setCognateSyncing(true);
          }}
          onDeleted={() => {
            setCognateLaunch(null);
            setCognateSyncing(true);
          }}
        />
      )}

      {relationLaunch !== null && (
        <RelationEditorDialog
          {...relationLaunch}
          languages={languages}
          onClose={() => setRelationLaunch(null)}
          onPublished={() => {
            setRelationLaunch(null);
            setRelationSyncing(true);
          }}
          onDeleted={() => {
            setRelationLaunch(null);
            setRelationSyncing(true);
          }}
        />
      )}
    </div>
  );
}
