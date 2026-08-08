import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  LEKSIS_ENTRY_COLLECTION,
  LEKSIS_LANGUAGE_COLLECTION,
  LEKSIS_PROFILE_COLLECTION,
  LEKSIS_RELATION_COLLECTION,
  type LanguageView,
} from "@leksis/types";
import { resolveEntryKeys } from "../lib/api";
import { relativeTime } from "../lib/relative-time";
import type { RepoRecord } from "../lib/pds-repo";

// A contributor's records as a readable stream, filtered by kind.
//
// Everything shown is read off the record itself — an entry states its
// orthography, a relation denormalizes both sides' spellings, a language record
// is keyed by its tag. So the feed renders with no lookups at all, and the
// AppView is consulted for exactly one thing: turning a record URI into the
// entry key its page lives at, which is the one fact a record cannot state
// about itself.

/** How many rows are shown before "show more". */
const PAGE = 25;

interface RepoFeedProps {
  records: RepoRecord[];
  /** For naming languages; a tag Leksis does not know still shows as itself. */
  languages: LanguageView[];
  onOpenEntry: (key: string) => void;
  onOpenLanguage: (tag: string) => void;
  /**
   * Withdraw one record. Passed only on one's **own** page — a record can only
   * be deleted from the repo that holds it, so its absence here is the whole
   * of the permission check.
   */
  onDelete?: (record: RepoRecord) => void;
}

/** What one row shows, derived from the record alone. */
interface Row {
  record: RepoRecord;
  /** The record's subject in the reader's terms — a word, a pair, a tag. */
  label: string;
  /** Short qualifier after the label: "edited", "opposite", a language tag. */
  detail: string | null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * The first spelling of an entry record — `orthography[0]` is the canonical
 * form by the lexicon's own convention.
 */
function orthography(value: Record<string, unknown>): string | null {
  return Array.isArray(value.orthography) ? text(value.orthography[0]) : null;
}

export function RepoFeed({
  records,
  languages,
  onOpenEntry,
  onOpenLanguage,
  onDelete,
}: RepoFeedProps) {
  const { t, i18n } = useTranslation();
  const [kind, setKind] = useState<string | null>(null); // null = every kind
  const [shown, setShown] = useState(PAGE);
  /** recordURI → entryKey, for the rows that can become links. */
  const [entryKeys, setEntryKeys] = useState<Record<string, string>>({});

  // One filter's worth of counting, done once over the whole set so the chips
  // show totals rather than "how many of what is currently displayed".
  const counts = useMemo(() => {
    const byCollection = new Map<string, number>();
    for (const record of records) {
      byCollection.set(record.collection, (byCollection.get(record.collection) ?? 0) + 1);
    }
    return byCollection;
  }, [records]);

  const filtered = useMemo(
    () => (kind === null ? records : records.filter((r) => r.collection === kind)),
    [records, kind],
  );
  // Memoized, not sliced inline: this array is an effect dependency below, and
  // a fresh identity on every render would re-fire the resolve request on every
  // render.
  const visible = useMemo(() => filtered.slice(0, shown), [filtered, shown]);

  // Resolve only what is on screen, and only once per URI. Two guards, because
  // they stop different things: `entryKeys` skips what already resolved, and
  // `asked` skips what came back *unresolved* — a record this AppView never
  // indexed answers the same way every time, and without this every re-render
  // and every filter click would ask again for the same nothing.
  const asked = useRef(new Set<string>());
  useEffect(() => {
    const wanted = [
      ...new Set(
        visible
          .flatMap((record) =>
            record.collection === LEKSIS_ENTRY_COLLECTION
              ? [record.uri]
              : record.collection === LEKSIS_RELATION_COLLECTION
                ? relationSideURIs(record)
                : [],
          )
          .filter((uri) => !(uri in entryKeys) && !asked.current.has(uri)),
      ),
    ];
    if (wanted.length === 0) return;
    for (const uri of wanted) asked.current.add(uri);

    let cancelled = false;
    // Never rejects — an unresolved row is a row without a link, not an error.
    void resolveEntryKeys(wanted).then((resolved) => {
      if (cancelled || Object.keys(resolved).length === 0) return;
      setEntryKeys((prev) => ({ ...prev, ...resolved }));
    });
    return () => {
      cancelled = true;
    };
  }, [visible, entryKeys]);

  // Changing the filter starts the list again: keeping a deep "show more" from
  // one kind while looking at another shows a scroll position nobody asked for.
  function selectKind(next: string | null) {
    setKind(next);
    setShown(PAGE);
  }

  function languageName(tag: string): string {
    return languages.find((l) => l.tag === tag)?.endonym || tag;
  }

  function row(record: RepoRecord): Row {
    const value = record.value;
    switch (record.collection) {
      case LEKSIS_ENTRY_COLLECTION: {
        const language = text(value.languageID);
        return {
          record,
          label: orthography(value) ?? t("repoFeed.untitledEntry"),
          // A record carrying `subject` proposes a new version of an existing
          // entry; without it, it created one. The record says which, so the
          // feed can too.
          detail: [
            language === null ? null : languageName(language),
            value.subject === undefined ? t("repoFeed.created") : t("repoFeed.edited"),
          ]
            .filter(Boolean)
            .join(" · "),
        };
      }
      case LEKSIS_RELATION_COLLECTION: {
        const sides = Array.isArray(value.sides) ? value.sides : [];
        const spellings = sides
          .map((side) => text((side as Record<string, unknown>)?.orthography))
          .filter((s): s is string => s !== null);
        return {
          record,
          label:
            spellings.length === 2
              ? `${spellings[0]} ↔ ${spellings[1]}`
              : t("repoFeed.untitledRelation"),
          // `kind` absent means equivalence — a translation or a synonym,
          // depending only on whether the two languages differ.
          detail:
            text(value.kind) === null
              ? t("repoFeed.equivalence")
              : text(value.kind) === "antonym"
                ? t("relations.antonym")
                : text(value.kind),
        };
      }
      case LEKSIS_LANGUAGE_COLLECTION: {
        const tag = text(value.tag) ?? record.rkey;
        return { record, label: languageName(tag), detail: tag };
      }
      case LEKSIS_PROFILE_COLLECTION:
        return { record, label: t("repoFeed.profileRecord"), detail: null };
      default:
        // A lexicon this build has never heard of still lists — the family is
        // designed to grow, and a reader is better served by "something was
        // published here" than by a silent omission.
        return { record, label: record.collection, detail: record.rkey };
    }
  }

  /** The entry versions a relation points at, in side order. */
  function relationSideURIs(record: RepoRecord): string[] {
    const sides = Array.isArray(record.value.sides) ? record.value.sides : [];
    return sides
      .map((side) => text((side as Record<string, unknown>)?.recordURI))
      .filter((uri): uri is string => uri !== null);
  }

  /** Where a row leads, or null when nothing can be opened from it. */
  function open(record: RepoRecord): (() => void) | null {
    if (record.collection === LEKSIS_ENTRY_COLLECTION) {
      const key = entryKeys[record.uri];
      return key === undefined ? null : () => onOpenEntry(key);
    }
    if (record.collection === LEKSIS_RELATION_COLLECTION) {
      // A relation has no page of its own; it is shown on its entries', so the
      // first side that resolves is where the reader wants to land.
      const key = relationSideURIs(record)
        .map((uri) => entryKeys[uri])
        .find((found) => found !== undefined);
      return key === undefined ? null : () => onOpenEntry(key);
    }
    if (record.collection === LEKSIS_LANGUAGE_COLLECTION) {
      const tag = text(record.value.tag) ?? record.rkey;
      return () => onOpenLanguage(tag);
    }
    return null;
  }

  /** A collection's reader-facing name; an unknown lexicon keeps its NSID. */
  function collectionLabel(collection: string): string {
    switch (collection) {
      case LEKSIS_ENTRY_COLLECTION:
        return t("repoFeed.filterEntries");
      case LEKSIS_RELATION_COLLECTION:
        return t("repoFeed.filterRelations");
      case LEKSIS_LANGUAGE_COLLECTION:
        return t("repoFeed.filterLanguages");
      case LEKSIS_PROFILE_COLLECTION:
        return t("repoFeed.filterProfile");
      default:
        return collection;
    }
  }

  const kinds = [...counts.keys()].sort();
  const chipClass = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs ${
      active ? "border-primary bg-primary/10 text-primary" : "bg-surface text-content-muted"
    } hover:border-primary`;

  return (
    <div>
      {/* Only worth showing when there is a choice to make. */}
      {kinds.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => selectKind(null)} className={chipClass(kind === null)}>
            {t("repoFeed.filterAll")} {records.length}
          </button>
          {kinds.map((collection) => (
            <button
              key={collection}
              type="button"
              onClick={() => selectKind(collection)}
              className={chipClass(kind === collection)}
            >
              {collectionLabel(collection)} {counts.get(collection)}
            </button>
          ))}
        </div>
      )}

      <ul className="mt-3 divide-y rounded-lg border bg-surface">
        {visible.map(row).map(({ record, label, detail }) => {
          const onOpen = open(record);
          return (
            <li key={record.uri} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-4 py-3">
              {onOpen === null ? (
                <span className="text-sm text-content">{label}</span>
              ) : (
                <button
                  type="button"
                  onClick={onOpen}
                  className="text-sm text-primary hover:text-primary-hover"
                >
                  {label}
                </button>
              )}
              {detail !== null && detail !== "" && (
                <span className="text-xs text-content-muted">{detail}</span>
              )}
              {record.createdAt !== null && (
                <time
                  dateTime={record.createdAt}
                  title={record.createdAt}
                  className="ml-auto shrink-0 text-xs text-content-subtle"
                >
                  {relativeTime(record.createdAt, i18n.language)}
                </time>
              )}
              {onDelete !== undefined && (
                <button
                  type="button"
                  onClick={() => onDelete(record)}
                  title={t("deleteRecords.deleteRecord")}
                  aria-label={t("deleteRecords.deleteRecord")}
                  // `ml-auto` only when there is no timestamp to push against,
                  // so the control keeps the right edge either way.
                  className={`${record.createdAt === null ? "ml-auto " : ""}shrink-0 rounded p-1 text-xs text-content-subtle hover:bg-surface-muted hover:text-danger focus:outline-none focus:ring-2`}
                >
                  ✕
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {filtered.length > visible.length && (
        <button
          type="button"
          onClick={() => setShown((n) => n + PAGE)}
          className="mt-3 text-sm text-primary hover:text-primary-hover"
        >
          {t("repoFeed.showMore", { count: filtered.length - visible.length })}
        </button>
      )}
    </div>
  );
}
