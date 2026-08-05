import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { placePrefixMatches, type LanguageView, type RelationView } from "@leksis/types";
import { AddLanguageModal } from "../components/AddLanguageModal";
import { endonym, LanguageSelector } from "../components/LanguageSelector";
import { OnboardingFlow } from "../components/OnboardingFlow";
import { SearchResults } from "../components/SearchResults";
import {
  TranslationResults,
  type TranslationCorrection,
} from "../components/TranslationResults";
import {
  RelationEditorDialog,
  type RelationEditorLaunch,
} from "../components/RelationEditorDialog";
import { useSession } from "../auth/SessionProvider";
import { EntryPage } from "./EntryPage";
import { LanguagePage } from "./LanguagePage";
import { fetchEntry, fetchEntryRelations, fetchLanguages } from "../lib/api";
import { fetchEntryRecord } from "../lib/atproto-record";
import { entryPath, languagePath, routeFromLocation, type Route } from "../lib/routes";

const SYNC_POLL_MS = 3_000;
const SYNC_POLL_MAX_TRIES = 20; // ~60s of PDS → Jetstream → ArangoDB latency

interface SubmittedSearch {
  query: string;
  /** Language scope at submit time; "" = all languages. */
  languageTag: string;
  /**
   * Target language at submit time; "" = none. **The presence of a target is
   * the mode**: empty means today's monolingual search, set means a translation
   * search. Nothing else switches, so there is no mode to learn.
   */
  targetTag: string;
}

/** Reads ?q=&l=&t= from the current URL, e.g. shared as /?q=entry&l=en-US&t=br. */
function searchFromLocation(): SubmittedSearch | null {
  const params = new URLSearchParams(window.location.search);
  const query = params.get("q")?.trim() ?? "";
  if (query === "") return null;
  return {
    query,
    languageTag: params.get("l") ?? "",
    targetTag: params.get("t") ?? "",
  };
}

/** The search surface's URL for one submitted state — the shareable link. */
function searchPath(search: SubmittedSearch | null): string {
  const params = new URLSearchParams();
  if (search !== null) {
    params.set("q", search.query);
    if (search.languageTag !== "") params.set("l", search.languageTag);
    if (search.targetTag !== "") params.set("t", search.targetTag);
  }
  const query = params.toString();
  return query === "" ? "/" : `/?${query}`;
}

// Connected surface: the language scope + term box stay on every page, with
// the routed content below — search results on /, an entry on /entry/<key>.
// Search state mirrors into the query string (/?q=&l=) so a search is a
// shareable, reloadable link; resource pages live at path URLs and carry no
// query string.
export function HomePage() {
  const { t, i18n } = useTranslation();
  const { profile, did } = useSession();
  // Locale for language-name localization; the API falls back to endonyms
  // when no names exist for it.
  const locale = i18n.language;
  const [languages, setLanguages] = useState<LanguageView[]>([]);
  // The search-bar shortlist is the profile's languages of interest (most
  // relevant first); the profile record is the single source of truth now that
  // onboarding gathers it. Empty until the profile loads / for a fresh profile.
  const shortlist = profile?.languages ?? [];
  const initialSearch = () => searchFromLocation();
  const [language, setLanguage] = useState(() => initialSearch()?.languageTag ?? "");
  const [target, setTarget] = useState(() => initialSearch()?.targetTag ?? "");
  const [term, setTerm] = useState(() => initialSearch()?.query ?? "");
  const [submitted, setSubmitted] = useState<SubmittedSearch | null>(initialSearch);
  const [route, setRoute] = useState<Route>(routeFromLocation);
  const [adding, setAdding] = useState(false);
  /** Tag written to the PDS but not yet seen back from the AppView. */
  const [syncingTag, setSyncingTag] = useState<string | null>(null);
  /** The relation editor, opened by disputing a translation result. */
  const [correction, setCorrection] = useState<RelationEditorLaunch | null>(null);
  /**
   * What to tell the reader about their last correction attempt: that it is
   * published (and these results predate it), or that the editor could not be
   * opened at all. The second case is why this is not a boolean — a dispute
   * that silently does nothing reads as a broken button.
   */
  const [correctionNotice, setCorrectionNotice] = useState<"published" | "unavailable" | null>(
    null,
  );

  useEffect(() => {
    fetchLanguages(locale)
      .then(setLanguages)
      .catch((err) => console.error("could not load languages:", err));
  }, [locale]);

  // Back/forward restores the route and, on the search surface, the term,
  // scope and results.
  useEffect(() => {
    function onPopState() {
      const search = searchFromLocation();
      setSubmitted(search);
      setTerm(search?.query ?? "");
      setLanguage(search?.languageTag ?? "");
      setTarget(search?.targetTag ?? "");
      setRoute(routeFromLocation());
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // After a create: poll until the record has round-tripped
  // PDS → Jetstream → ArangoDB, then swap the optimistic entry for the
  // indexed list. If it never shows up, the optimistic entry just stays.
  useEffect(() => {
    if (syncingTag === null) return;
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      fetchLanguages(locale)
        .then((indexed) => {
          if (indexed.some((l) => l.tag === syncingTag)) {
            setLanguages(indexed);
            setSyncingTag(null);
          } else if (tries >= SYNC_POLL_MAX_TRIES) {
            console.warn(`language "${syncingTag}" not indexed after polling; giving up`);
            setSyncingTag(null);
          }
        })
        .catch(() => {
          /* transient — keep polling */
        });
    }, SYNC_POLL_MS);
    return () => clearInterval(timer);
  }, [syncingTag]);

  function onLanguageChange(tag: string) {
    setLanguage(tag);
  }

  function onLanguageCreated(created: LanguageView) {
    setLanguages((prev) =>
      [...prev.filter((l) => l.tag !== created.tag), created].sort((a, b) =>
        a.tag.localeCompare(b.tag),
      ),
    );
    setLanguage(created.tag);
    setAdding(false);
    setSyncingTag(created.tag);
  }

  // Submitting always lands on the search surface: the query string belongs
  // to /, so a search started from an entry page navigates back to /?q=&l=.
  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const query = term.trim();
    if (query === "") return;
    const search = { query, languageTag: language, targetTag: target };
    setSubmitted(search);
    setCorrectionNotice(null);
    window.history.pushState(null, "", searchPath(search));
    setRoute({ kind: "search" });
  }

  /**
   * Disputing a result opens the relation editor on the assertion that is
   * actually at fault — when the result names one.
   *
   * A direct answer rests on a single relation, so it is looked up and opened
   * for editing: the reader can narrow its senses, flip it, or withdraw it. An
   * indirect one rests on a chain, and the result does not say which link is
   * wrong, so the editor opens empty on the target language instead — asserting
   * the right equivalent. The wrong link is repaired from the hop's own entry
   * page, which the chain disclosure already links to.
   */
  async function openCorrection(dispute: TranslationCorrection) {
    setCorrectionNotice(null);
    // The editor works on the source entry's own senses, so it cannot open
    // without them. Said out loud: the alternative is a button that does
    // nothing, which reads as broken rather than as blocked.
    const view = await fetchEntry(dispute.sourceEntryKey).catch(() => null);
    const record = view === null ? null : await fetchEntryRecord(view.recordURI).catch(() => null);
    if (view === null || record === null) {
      setCorrectionNotice("unavailable");
      return;
    }

    let existing: RelationView | null = null;
    if (dispute.direct) {
      const found = await fetchEntryRelations(dispute.sourceEntryKey).catch(() => null);
      // A direct assertion may be broader than the sense it answered for — a
      // whole-entry claim answers every sense — so it is matched by prefix, and
      // the most specific match wins.
      const candidates = (found?.relations ?? [])
        .filter(
          (relation) =>
            relation.sides[1].entryKey === dispute.targetEntryKey &&
            placePrefixMatches(relation.sides[0].place, dispute.sourcePlace) &&
            placePrefixMatches(relation.sides[1].place, dispute.targetPlace),
        )
        // Most specific over BOTH sides. Ranking on the source alone would let
        // a whole-entry claim outrank a sense-precise one whenever their source
        // prefixes tie, so disputing a precise answer could open the broad
        // assertion and narrow it — destroying translations nobody meant to
        // touch.
        .sort(
          (a, b) =>
            b.sides[0].place.length +
            b.sides[1].place.length -
            (a.sides[0].place.length + a.sides[1].place.length),
        );
      existing = candidates[0] ?? null;
    }

    setCorrection(
      existing !== null
        ? {
            source: { view, record, place: existing.sides[0].place },
            targetEntryKey: existing.sides[1].entryKey,
            targetPlace: existing.sides[1].place,
            targetLanguage: existing.sides[1].languageID,
            targetQuery: existing.sides[1].recordedOrthography ?? "",
            existing,
          }
        : {
            // No single assertion to fix — but the reader was looking at a
            // specific word, so it is carried in rather than making them retype
            // it (and risk asserting something subtly different).
            source: { view, record, place: dispute.sourcePlace },
            targetEntryKey: dispute.targetEntryKey,
            targetPlace: dispute.targetPlace,
            targetLanguage: dispute.targetLanguageID,
          },
    );
  }

  function openEntry(key: string) {
    window.history.pushState(null, "", entryPath(key));
    setRoute({ kind: "entry", entryKey: key });
  }

  function openLanguage(tag: string) {
    window.history.pushState(null, "", languagePath(tag));
    setRoute({ kind: "language", tag });
  }

  // "Back to search" rebuilds /?q=&l= from the submitted state, so the
  // results the entry came from reappear.
  function backToSearch() {
    window.history.pushState(null, "", searchPath(submitted));
    setRoute({ kind: "search" });
  }

  const scopeLanguage =
    submitted !== null && submitted.languageTag !== ""
      ? (languages.find((l) => l.tag === submitted.languageTag) ?? null)
      : null;
  const targetLanguage =
    submitted !== null && submitted.targetTag !== ""
      ? (languages.find((l) => l.tag === submitted.targetTag) ?? null)
      : null;
  // A translation search needs both ends. The endpoint requires a source
  // language where monolingual search happily spans all of them, so an
  // unscoped search with a target is answered with a hint rather than with a
  // request that can only 400.
  const translating = submitted !== null && submitted.targetTag !== "";
  const missingSource = translating && scopeLanguage === null;

  // A connected user with no profile record yet is onboarded here, inside the
  // homepage: the search surface is replaced by the onboarding flow until the
  // profile is written. `undefined` = still loading, so nothing flashes.
  if (profile === null) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-10 sm:px-6 sm:py-16">
        <OnboardingFlow languages={languages} onLanguageCreated={onLanguageCreated} />
        {adding && (
          <AddLanguageModal
            languages={languages}
            onClose={() => setAdding(false)}
            onCreated={onLanguageCreated}
          />
        )}
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-10 sm:px-6 sm:py-16">
      {route.kind === "search" && (
        <h1 className="text-2xl font-semibold tracking-tight text-content sm:text-3xl">
          {t("search.title")}
        </h1>
      )}

      <form
        className={`flex flex-col gap-3 sm:flex-row ${route.kind === "search" ? "mt-6" : ""}`}
        onSubmit={onSubmit}
      >
        <label htmlFor="search-language" className="sr-only">
          {t("search.languageLabel")}
        </label>
        <LanguageSelector
          languages={languages}
          shortlist={shortlist}
          value={language}
          onChange={onLanguageChange}
          onAddLanguage={() => setAdding(true)}
        />

        <label htmlFor="search-term" className="sr-only">
          {t("search.placeholder")}
        </label>
        <input
          id="search-term"
          type="search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder={t("search.placeholder")}
          autoCapitalize="none"
          className="w-full flex-1 rounded-lg border bg-surface px-3 py-2.5 text-sm text-content outline-none placeholder:text-content-subtle focus:ring-2"
        />

        {/* The target half of the bar. Empty is the default and means the
            monolingual search this app has always done; picking a language is
            the only thing that switches modes. */}
        <label htmlFor="search-target" className="sr-only">
          {t("search.targetLabel")}
        </label>
        <select
          id="search-target"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="rounded-lg border bg-surface px-3 py-2.5 text-sm text-content outline-none focus:ring-2 sm:w-44"
        >
          <option value="">{t("search.targetNone")}</option>
          {languages.map((l) => (
            <option key={l.tag} value={l.tag}>
              {endonym(l)}
            </option>
          ))}
        </select>

        <button
          type="submit"
          className="rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-fg hover:bg-primary-hover focus:outline-none focus:ring-2"
        >
          {t("search.submit")}
        </button>
      </form>

      {syncingTag !== null && (
        <p className="mt-3 text-sm text-content-subtle">{t("addLanguage.syncing")}</p>
      )}

      {/* Results already on screen were computed before this correction, so
          they are stale rather than wrong — said plainly instead of being
          silently re-fetched before the AppView could have indexed it. */}
      {correctionNotice !== null && (
        <p className="mt-3 text-sm text-content-subtle">
          {correctionNotice === "published"
            ? t("translate.correctionPublished")
            : t("translate.correctionUnavailable")}
        </p>
      )}

      {route.kind === "entry" ? (
        <EntryPage
          entryKey={route.entryKey}
          languages={languages}
          onBack={backToSearch}
          onOpenEntry={openEntry}
          onOpenLanguage={openLanguage}
        />
      ) : route.kind === "language" ? (
        <LanguagePage tag={route.tag} languages={languages} onOpenEntry={openEntry} />
      ) : (
        submitted !== null &&
        (missingSource ? (
          <p className="mt-8 rounded-lg border border-dashed bg-surface px-4 py-6 text-center text-sm text-content-muted">
            {t("translate.needSource")}
          </p>
        ) : translating && targetLanguage !== null && scopeLanguage !== null ? (
          <TranslationResults
            query={submitted.query}
            from={scopeLanguage}
            to={targetLanguage}
            languages={languages}
            onOpenEntry={openEntry}
            onCorrect={
              did !== null
                ? (dispute) => {
                    void openCorrection(dispute);
                  }
                : undefined
            }
          />
        ) : (
          <SearchResults
            query={submitted.query}
            languages={languages}
            language={scopeLanguage}
            onOpenEntry={openEntry}
          />
        ))
      )}

      {adding && (
        <AddLanguageModal
          languages={languages}
          onClose={() => setAdding(false)}
          onCreated={onLanguageCreated}
        />
      )}

      {correction !== null && (
        <RelationEditorDialog
          {...correction}
          languages={languages}
          onClose={() => setCorrection(null)}
          onPublished={() => {
            setCorrection(null);
            setCorrectionNotice("published");
          }}
          onDeleted={() => {
            setCorrection(null);
            setCorrectionNotice("published");
          }}
        />
      )}
    </main>
  );
}
