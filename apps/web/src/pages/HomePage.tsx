import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { LanguageView } from "@leksis/types";
import { AddLanguageModal } from "../components/AddLanguageModal";
import { LanguageSelector } from "../components/LanguageSelector";
import { fetchLanguages } from "../lib/api";
import { getShortlist, promoteInShortlist } from "../lib/shortlist";

const SYNC_POLL_MS = 3_000;
const SYNC_POLL_MAX_TRIES = 20; // ~60s of PDS → Jetstream → ArangoDB latency

// Connected landing surface. The search experience itself is a later milestone;
// this is the shell where it will live — a language scope + a term box.
export function HomePage() {
  const { t } = useTranslation();
  const [languages, setLanguages] = useState<LanguageView[]>([]);
  const [shortlist, setShortlist] = useState<string[]>(() => getShortlist());
  const [language, setLanguage] = useState("");
  const [adding, setAdding] = useState(false);
  /** Tag written to the PDS but not yet seen back from the AppView. */
  const [syncingTag, setSyncingTag] = useState<string | null>(null);

  useEffect(() => {
    fetchLanguages()
      .then(setLanguages)
      .catch((err) => console.error("could not load languages:", err));
  }, []);

  // After a create: poll until the record has round-tripped
  // PDS → Jetstream → ArangoDB, then swap the optimistic entry for the
  // indexed list. If it never shows up, the optimistic entry just stays.
  useEffect(() => {
    if (syncingTag === null) return;
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      fetchLanguages()
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
    event.preventDefault(); // wired up in a later milestone
  }

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
      <p className="mt-3 text-sm text-content-subtle">{t("search.comingSoon")}</p>

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
