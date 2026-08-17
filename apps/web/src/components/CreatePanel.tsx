import { useState } from "react";
import { useTranslation } from "react-i18next";
import { normalizeOclc, type LanguageView } from "@leksis/types";
import { useSession } from "../auth/SessionProvider";
import { useLoginPrompt } from "../auth/LoginPrompt";
import { AddLanguageModal } from "./AddLanguageModal";
import { EntryEditorDialog } from "./CreateEntryPanel";
import { SourceEditorDialog } from "./SourceEditorDialog";
import { endonym } from "./LanguageSelector";
import type { SearchKind } from "../lib/search-kind";

/**
 * What each of the three editors reports back. Grouped because every result
 * list offers all three — the chooser is not scoped to the active tab — so
 * each of them would otherwise carry the same three callbacks separately.
 */
export interface CreateActions {
  /** Called with the new entry's AT URI after it was written to the PDS. */
  onEntryCreated: (recordURI: string) => void;
  /** Called after a language record was written to the PDS. */
  onLanguageCreated: (created: LanguageView) => void;
  /** Called with the normalized number after a source was written to the PDS. */
  onSourcePublished: (oclc: string) => void;
}

interface CreatePanelProps extends CreateActions {
  /** What was searched — seeds whichever editor is chosen. */
  query: string;
  /** All known languages, for the editors' pickers. */
  languages: LanguageView[];
  /** The language scope the search was submitted with, if any. */
  language: LanguageView | null;
  /** The active search kind; its matching option opens preselected. */
  kind: SearchKind;
}

type Opened = "entry" | "language" | "source" | null;

/**
 * The "add it yourself" offer on the search surface — a call to action that
 * asks *what* before opening an editor.
 *
 * It sits **above** the results rather than below them: somebody who did not
 * find what they searched for should not have to scroll past what they did
 * find in order to add it.
 *
 * The chooser exists because one search bar now covers three kinds of record,
 * and a searcher who typed a book title into the words tab should be able to
 * describe the book without going back and re-searching. The active tab only
 * preselects — it never decides.
 */
export function CreatePanel({
  query,
  languages,
  language,
  kind,
  onEntryCreated,
  onLanguageCreated,
  onSourcePublished,
}: CreatePanelProps) {
  const { t } = useTranslation();
  const { did } = useSession();
  const { requestLogin } = useLoginPrompt();
  const [choosing, setChoosing] = useState(false);
  const [opened, setOpened] = useState<Opened>(null);

  const cta =
    kind === "languages" ? (
      t("create.ctaLanguage")
    ) : kind === "sources" ? (
      t("create.ctaSource")
    ) : language !== null ? (
      <>
        {t("createEntry.title", { word: query, language: endonym(language) })}{" "}
        <span className="rounded border bg-surface px-1.5 py-0.5 align-middle font-mono text-xs font-normal text-content-muted">
          {language.tag}
        </span>
      </>
    ) : (
      t("createEntry.titleNoLanguage", { word: query })
    );

  const preselected: Exclude<Opened, null> =
    kind === "languages" ? "language" : kind === "sources" ? "source" : "entry";

  /**
   * The offer stays visible to a reader with no account and asks them to
   * connect (ADR-0017). Hiding it would have been less code and a worse
   * dictionary: the moment somebody searches for a word that is not here is
   * exactly the moment "you could add it" means something, and a reader who
   * never sees that offer has no reason to think this is a project rather than
   * a website.
   *
   * The reason given matches the active tab, so one click reaches a prompt that
   * names what they were about to do — rather than a chooser that turns out to
   * be a dead end.
   */
  const reasonForKind = {
    entry: t("auth.reasonEntry"),
    language: t("auth.reasonLanguage"),
    source: t("auth.reasonSource"),
  }[preselected];

  function onOffer() {
    if (did === null) {
      requestLogin(reasonForKind);
      return;
    }
    setChoosing(true);
  }

  const option = (value: Exclude<Opened, null>, label: string, hint: string) => (
    <button
      type="button"
      onClick={() => {
        setChoosing(false);
        setOpened(value);
      }}
      className={`rounded-lg border bg-surface p-3 text-left hover:border-primary hover:bg-surface-muted/60 ${
        value === preselected ? "border-primary" : ""
      }`}
    >
      <span className="block text-sm font-medium text-content">{label}</span>
      <span className="mt-1 block text-xs text-content-muted">{hint}</span>
    </button>
  );

  // A query that reads as an OCLC number seeds the source editor's number;
  // anything else seeds its title, since that is what somebody searching for a
  // work by name has typed.
  const seededOclc = normalizeOclc(query);

  return (
    <>
      {choosing ? (
        <div className="mt-4 rounded-lg border bg-surface p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-content">{t("create.chooserTitle")}</h3>
          <p className="mt-1 text-xs text-content-muted">{t("create.chooserHint")}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {option("entry", t("create.optionEntry"), t("create.optionEntryHint"))}
            {option("language", t("create.optionLanguage"), t("create.optionLanguageHint"))}
            {option("source", t("create.optionSource"), t("create.optionSourceHint"))}
          </div>
          <button
            type="button"
            onClick={() => setChoosing(false)}
            className="mt-3 text-sm text-content-subtle hover:text-content"
          >
            {t("create.cancel")}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onOffer}
          className="mt-4 flex w-full items-center gap-3 rounded-lg border bg-surface px-4 py-3 text-left shadow-sm hover:border-primary/50 hover:bg-surface-muted/60"
        >
          <span
            aria-hidden="true"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-lg leading-none text-primary"
          >
            ＋
          </span>
          <span className="text-sm font-medium text-content">{cta}</span>
        </button>
      )}

      {opened === "entry" && (
        <EntryEditorDialog
          languages={languages}
          language={language}
          word={query}
          onClose={() => setOpened(null)}
          onCreated={(uri) => {
            setOpened(null);
            onEntryCreated(uri);
          }}
        />
      )}

      {opened === "language" && (
        <AddLanguageModal
          languages={languages}
          onClose={() => setOpened(null)}
          onCreated={(created) => {
            setOpened(null);
            onLanguageCreated(created);
          }}
        />
      )}

      {opened === "source" && (
        <SourceEditorDialog
          languages={languages}
          {...(seededOclc !== null ? { seedOclc: seededOclc } : { seedTitle: query })}
          {...(language !== null ? { mainLanguage: language.tag } : {})}
          onClose={() => setOpened(null)}
          onPublished={(oclc) => {
            setOpened(null);
            onSourcePublished(oclc);
          }}
        />
      )}
    </>
  );
}
