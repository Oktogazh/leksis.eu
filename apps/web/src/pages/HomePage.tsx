import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { LanguageView } from "@leksis/types";
import { AddLanguageModal } from "../components/AddLanguageModal";
import { LanguageSelector } from "../components/LanguageSelector";
import { SearchResults } from "../components/SearchResults";
import { fetchLanguages } from "../lib/api";
import { getShortlist, promoteInShortlist } from "../lib/shortlist";

const SYNC_POLL_MS = 3_000;
const SYNC_POLL_MAX_TRIES = 20; // ~60s of PDS → Jetstream → ArangoDB latency

interface SubmittedSearch {
  query: string;
  /** Language scope at submit time; "" = all languages. */
  languageTag: string;
}

/** Reads ?q=&l= from the current URL, e.g. shared as /?q=entry&l=en-US. */
function searchFromLocation(): SubmittedSearch | null {
  const params = new URLSearchParams(window.location.search);
  const query = params.get("q")?.trim() ?? "";
  if (query === "") return null;
  return { query, languageTag: params.get("l") ?? "" };
}

// Connected landing surface: language scope + term box, with the results
// (and the create-this-word offer) rendering below on submit. Search state
// mirrors into the URL (?q=&l=) so a search is a shareable, reloadable link.
export function HomePage() {
  const { t, i18n } = useTranslation();
  // Locale for language-name localization; the API falls back to endonyms
  // when no names exist for it.
  const locale = i18n.language;
  const [languages, setLanguages] = useState<LanguageView[]>([]);
  const [shortlist, setShortlist] = useState<string[]>(() => getShortlist());
  const initialSearch = () => searchFromLocation();
  const [language, setLanguage] = useState(() => initialSearch()?.languageTag ?? "");
  const [term, setTerm] = useState(() => initialSearch()?.query ?? "");
  const [submitted, setSubmitted] = useState<SubmittedSearch | null>(initialSearch);
  const [adding, setAdding] = useState(false);
  /** Tag written to the PDS but not yet seen back from the AppView. */
  const [syncingTag, setSyncingTag] = useState<string | null>(null);

  useEffect(() => {
    fetchLanguages(locale)
      .then(setLanguages)
      .catch((err) => console.error("could not load languages:", err));
  }, [locale]);

  // Back/forward through search history restores the term, scope and results.
  useEffect(() => {
    function onPopState() {
      const search = searchFromLocation();
      setSubmitted(search);
      setTerm(search?.query ?? "");
      setLanguage(search?.languageTag ?? "");
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
    if (tag !== "") setShortlist(promoteInShortlist(tag));
  }

  function onLanguageCreated(created: LanguageView) {
    setLanguages((prev) =>
      [...prev.filter((l) => l.tag !== created.tag), created].sort((a, b) =>
        a.tag.localeCompare(b.tag),
      ),
    );
    setShortlist(promoteInShortlist(created.tag));
    setLanguage(created.tag);
    setAdding(false);
    setSyncingTag(created.tag);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const query = term.trim();
    if (query === "") return;
    setSubmitted({ query, languageTag: language });

    const params = new URLSearchParams();
    params.set("q", query);
    if (language !== "") params.set("l", language);
    const url = `${window.location.pathname}?${params.toString()}`;
    window.history.pushState(null, "", url);
  }

  const scopeLanguage =
    submitted !== null && submitted.languageTag !== ""
      ? (languages.find((l) => l.tag === submitted.languageTag) ?? null)
      : null;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-10 sm:px-6 sm:py-16">
      <h1 className="text-2xl font-semibold tracking-tight text-content sm:text-3xl">
        {t("search.title")}
      </h1>

      <form className="mt-6 flex flex-col gap-3 sm:flex-row" onSubmit={onSubmit}>
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

      {submitted !== null && (
        <SearchResults query={submitted.query} languages={languages} language={scopeLanguage} />
      )}

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
