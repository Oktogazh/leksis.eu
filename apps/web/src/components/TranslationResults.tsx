import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  LanguageView,
  LeksisEntryRecord,
  TranslateResponse,
  TranslationEntry,
  TranslationHop,
  TranslationSense,
  TranslationTarget,
} from "@leksis/types";
import { fetchTranslations } from "../lib/api";
import { fetchEntryRecord } from "../lib/atproto-record";
import { definitionsDepth, placeLabel } from "../lib/definition-tree";
import { endonym } from "./LanguageSelector";

/**
 * The translation surface: what the dictionary can say about a word in another
 * language, and — just as importantly — what it cannot.
 *
 * Two design rules shape everything here. **A result is reported relative to
 * the sense you searched from**: the outer grouping is the source entry's own
 * senses, so a sense with no equivalent shows as an empty group rather than
 * vanishing, and partial coverage is legible without a "partial" flag. And
 * **provenance is earned by a sense, not by a word**: each target sense carries
 * its own chain, because two senses of one target can be reached by very
 * different routes and a single badge for the entry would describe the best of
 * them while silently vouching for the rest.
 */

interface TranslationResultsProps {
  query: string;
  /** The source language; the endpoint requires it (no "any language" search). */
  from: LanguageView;
  /** The target language. Equal to `from` is a synonym search, not an error. */
  to: LanguageView;
  /** All known languages, for naming the hops' languages. */
  languages: LanguageView[];
  onOpenEntry: (key: string) => void;
}

/**
 * The source entries' records, resolved from their authors' PDSs so a sense
 * group can show its definition and not just its number. Best-effort: the
 * AppView serves no definition texts, and a failure here degrades the heading
 * to its place label rather than blocking the answer.
 */
type SourceRecords = Map<string, LeksisEntryRecord>;

/** The definition text at one place of a resolved record, if it has one. */
function definitionAt(record: LeksisEntryRecord | undefined, place: number[]): string | null {
  if (!record) return null;
  const key = place.join(".");
  const found = record.definitions.find(
    (def) => def.place.filter((n) => n !== 0).join(".") === key,
  );
  return found?.text ?? null;
}

/** A place's display label, under the depth of the tree it belongs to. */
function labelFor(record: LeksisEntryRecord | undefined, place: number[]): string {
  const depth = record ? definitionsDepth(record.definitions) : Math.max(place.length, 1);
  return placeLabel(depth as 1 | 2 | 3, place);
}

/**
 * One sense of one target: its own place, its own provenance badge, and the
 * chain behind it.
 *
 * The chain is the trust surface — until voting exists, *how* a translation was
 * reached is the only quality signal a reader has — so it is disclosed on the
 * row itself and expands in place, never more than one tap away.
 */
function TargetSense({
  sense,
  languageName,
  onOpenEntry,
}: {
  sense: TranslationSense;
  languageName: (tag: string) => string;
  onOpenEntry: (key: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const direct = sense.via.length === 0;

  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      {sense.place.length > 0 && (
        <span className="font-mono text-xs text-content-subtle">
          {placeLabel(Math.max(sense.place.length, 1) as 1 | 2 | 3, sense.place)}
        </span>
      )}
      {/* The target's own coarseness: the assertion that reached this sense
          covered every sense of the word, which is exactly the assumption a
          reader would want to check. */}
      {sense.coarse && (
        <span className="text-xs text-amber-700 dark:text-amber-400">
          {t("translate.allSenses")}
        </span>
      )}
      {direct ? (
        <span className="rounded-full border border-primary/40 px-2 py-0.5 text-xs text-primary">
          {t("translate.direct")}
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="rounded-full border px-2 py-0.5 text-xs text-content-muted hover:border-primary hover:text-primary"
        >
          {/* Two explicit keys rather than a plural: the badge names the first
              hop and says how many more there are, which is not the same
              sentence in either number. */}
          {sense.via.length === 1
            ? t("translate.via", { word: sense.via[0]!.orthography })
            : t("translate.viaMore", {
                word: sense.via[0]!.orthography,
                count: sense.via.length - 1,
              })}{" "}
          <span aria-hidden="true">{open ? "▾" : "▸"}</span>
        </button>
      )}
      {open && !direct && (
        <ol className="mt-1 w-full space-y-1 border-l pl-3">
          {sense.via.map((hop: TranslationHop, i) => (
            <li key={`${hop.entryKey}-${i}`} className="text-xs text-content-muted">
              <button
                type="button"
                onClick={() => onOpenEntry(hop.entryKey)}
                className="text-primary hover:text-primary-hover"
              >
                {hop.orthography}
              </button>{" "}
              <span className="font-mono">{languageName(hop.languageID)}</span>
              {hop.place.length > 0 && (
                <span className="ml-1 font-mono text-content-subtle">
                  {placeLabel(Math.max(hop.place.length, 1) as 1 | 2 | 3, hop.place)}
                </span>
              )}
              {/* Coarse on either side: a chain that *departs* an intermediate
                  word on an all-senses claim is exactly as unchecked as one
                  that arrives on it. */}
              {hop.coarse && (
                <span className="ml-1 text-amber-700 dark:text-amber-400">
                  {t("translate.allSenses")}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

/** One target entry reached from one source sense, with its senses beneath it. */
function TargetRow({
  target,
  languageName,
  onOpenEntry,
}: {
  target: TranslationTarget;
  languageName: (tag: string) => string;
  onOpenEntry: (key: string) => void;
}) {
  return (
    <li className="rounded-lg border bg-surface px-3 py-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <button
          type="button"
          onClick={() => onOpenEntry(target.entryKey)}
          className="text-sm font-medium text-primary hover:text-primary-hover"
        >
          {target.orthography[0]}
        </button>
        {target.orthography.length > 1 && (
          <span className="text-xs text-content-muted">
            {target.orthography.slice(1).join(", ")}
          </span>
        )}
      </div>
      <ul className="mt-1.5 space-y-1.5">
        {target.senses.map((sense) => (
          <TargetSense
            key={sense.place.join(".")}
            sense={sense}
            languageName={languageName}
            onOpenEntry={onOpenEntry}
          />
        ))}
      </ul>
    </li>
  );
}

/** One source entry: its headword, then one block per sense. */
function SourceEntry({
  entry,
  record,
  languageName,
  onOpenEntry,
}: {
  entry: TranslationEntry;
  record: LeksisEntryRecord | undefined;
  languageName: (tag: string) => string;
  onOpenEntry: (key: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <article className="rounded-lg border bg-surface-muted/30 p-3 sm:p-4">
      <header className="flex flex-wrap items-baseline gap-2">
        <button
          type="button"
          onClick={() => onOpenEntry(entry.entryKey)}
          className="text-lg font-semibold text-content hover:text-primary"
        >
          {entry.orthography[0]}
        </button>
        {entry.orthography.length > 1 && (
          <span className="text-sm text-content-muted">
            {entry.orthography.slice(1).join(", ")}
          </span>
        )}
      </header>

      <ol className="mt-3 space-y-3">
        {entry.senses.map((group) => {
          const text = definitionAt(record, group.place);
          return (
            <li key={group.place.join(".")}>
              <div className="flex gap-2">
                <span className="mt-0.5 shrink-0 font-mono text-sm text-content-subtle">
                  {labelFor(record, group.place)}
                </span>
                <p className="min-w-0 text-sm text-content">
                  {text ?? <span className="text-content-subtle">{t("translate.senseUnnamed")}</span>}
                </p>
              </div>
              {group.targets.length === 0 ? (
                /* Kept, never filtered out: an empty group is how the reader
                   sees which parts of their word the dictionary cannot
                   translate yet. */
                <p className="ml-6 mt-1.5 text-sm text-content-subtle">
                  {t("translate.senseEmpty")}
                </p>
              ) : (
                <ul className="ml-6 mt-1.5 space-y-1.5">
                  {group.targets.map((target) => (
                    <TargetRow
                      key={target.entryKey}
                      target={target}
                      languageName={languageName}
                      onOpenEntry={onOpenEntry}
                    />
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </article>
  );
}

export function TranslationResults({
  query,
  from,
  to,
  languages,
  onOpenEntry,
}: TranslationResultsProps) {
  const { t } = useTranslation();
  const [response, setResponse] = useState<TranslateResponse | null>(null);
  const [records, setRecords] = useState<SourceRecords>(new Map());
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setResponse(null);
    setRecords(new Map());
    setFailed(false);
    fetchTranslations(query, from.tag, to.tag)
      .then((body) => {
        if (cancelled) return;
        setResponse(body);
        // Side data, resolved per source entry: the definitions the AppView
        // deliberately does not serve. One failure loses one heading's text.
        for (const entry of body.entries) {
          fetchEntryRecord(entry.recordURI)
            .then((record) => {
              if (cancelled || record === null) return;
              setRecords((prev) => new Map(prev).set(entry.entryKey, record));
            })
            .catch(() => {});
        }
      })
      .catch((err) => {
        console.error("translation search failed:", err);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [query, from.tag, to.tag]);

  const languageName = (tag: string) => {
    const known = languages.find((l) => l.tag === tag);
    return known ? endonym(known) : tag;
  };

  // A same-language search is the synonym case — the same edges, asked a
  // different question — so it is titled as one rather than being refused.
  const synonyms = from.tag === to.tag;

  return (
    <section className="mt-8" aria-live="polite">
      <h2 className="text-lg font-semibold text-content">
        {synonyms
          ? t("translate.synonymsTitle", { query })
          : t("translate.resultsTitle", { query, language: endonym(to) })}
      </h2>
      <p className="mt-0.5 text-sm text-content-muted">
        {t("translate.scope", { from: endonym(from), to: endonym(to) })}
      </p>

      {failed ? (
        <p className="mt-4 text-sm text-red-600">{t("translate.loadFailed")}</p>
      ) : response === null ? (
        <p className="mt-4 text-sm text-content-muted">{t("translate.loading")}</p>
      ) : response.entries.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed bg-surface px-4 py-6 text-center sm:px-6">
          <p className="text-sm font-medium text-content">{t("translate.empty")}</p>
          <p className="mt-1 text-sm text-content-muted">{t("translate.emptyHint")}</p>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {response.entries.map((entry) => (
            <SourceEntry
              key={entry.entryKey}
              entry={entry}
              record={records.get(entry.entryKey)}
              languageName={languageName}
              onOpenEntry={onOpenEntry}
            />
          ))}
        </div>
      )}
    </section>
  );
}
