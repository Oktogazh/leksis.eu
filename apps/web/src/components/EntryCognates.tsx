import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  CognateLink,
  CognateNetworkResponse,
  CognateNode,
  CognateView,
  LanguageView,
} from "@leksis/types";
import { fetchCognateRecord } from "../lib/atproto-record";
import { endonym } from "./LanguageSelector";

// The entry page's half of the cognate network.
//
// This section shows the **whole connected component**, not this word's direct
// cognates — the one place a Leksis read surface deliberately shows more than
// what was asserted about the thing you are looking at. A translation is
// answered per word; a cognate network means something only as a shape, because
// how densely two languages' words link is itself the evidence about how those
// languages relate. So a Welsh word nobody linked to this Breton one appears
// here, reached through Latin, and the page says how far away it is.
//
// Grouped by language rather than drawn as a graph: a list is readable at any
// size, degrades to nothing when the network is empty, and answers the question
// a reader actually arrives with — "what is this word in the languages I know?"

/** Nodes of one language, in the order they should be read. */
interface LanguageGroup {
  languageID: string;
  name: string;
  nodes: CognateNode[];
}

function CognateAssertions({
  links,
  nodes,
  onOpenEntry,
}: {
  links: CognateLink[];
  nodes: Map<string, CognateNode>;
  onOpenEntry: (key: string) => void;
}) {
  return (
    <ul className="mt-1 space-y-1.5">
      {links.map((link) => (
        <CognateAssertion
          key={link.cognateKey}
          link={link}
          nodes={nodes}
          onOpenEntry={onOpenEntry}
        />
      ))}
    </ul>
  );
}

/**
 * One assertion linking this word to another, with its own record's remarks
 * resolved from the author's PDS on expand — the source, or the caveat that the
 * cognacy is disputed, which is content and so never in the index.
 */
function CognateAssertion({
  link,
  nodes,
  onOpenEntry,
}: {
  link: CognateLink;
  nodes: Map<string, CognateNode>;
  onOpenEntry: (key: string) => void;
}) {
  const { t } = useTranslation();
  const [notes, setNotes] = useState<string[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || notes !== null) return;
    let cancelled = false;
    fetchCognateRecord(link.recordURI)
      .then((record) => {
        if (!cancelled) setNotes(record?.notes ?? []);
      })
      .catch(() => {
        if (!cancelled) setNotes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, notes, link.recordURI]);

  const ends = link.sides.map((key) => nodes.get(key));

  return (
    <li className="text-xs text-content-muted">
      <span className="flex flex-wrap items-baseline gap-x-1.5">
        {ends.map((end, i) => (
          <span key={i} className="flex items-baseline gap-1">
            {i > 0 && <span className="text-content-subtle">↔</span>}
            {end !== undefined ? (
              <button
                type="button"
                onClick={() => onOpenEntry(end.entryKey)}
                className="text-primary hover:text-primary-hover"
              >
                {end.orthography[0]}
              </button>
            ) : (
              <span>{link.sides[i]}</span>
            )}
            <span className="font-mono text-content-subtle">{end?.languageID}</span>
          </span>
        ))}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="text-content-subtle hover:text-primary"
        >
          {t("cognates.details")} <span aria-hidden="true">{open ? "▾" : "▸"}</span>
        </button>
      </span>
      {open && (
        <div className="mt-1 border-l pl-3">
          {notes === null ? (
            <p>{t("cognates.notesLoading")}</p>
          ) : notes.length > 0 ? (
            <ul className="space-y-0.5">
              {notes.map((note, i) => (
                <li key={i}>{note}</li>
              ))}
            </ul>
          ) : (
            <p className="text-content-subtle">{t("cognates.noNotes")}</p>
          )}
          <p className="mt-1 break-all font-mono">{link.authorDID}</p>
          <a
            href={`https://atproto.at/uri/${link.recordURI}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:text-primary-hover"
          >
            {t("cognates.viewRecord")}
          </a>
        </div>
      )}
    </li>
  );
}

/** One word in the network, with how the dictionary reached it. */
function CognateNodeLine({
  node,
  links,
  nodes,
  onOpenEntry,
}: {
  node: CognateNode;
  /** The assertions touching this word, within the served component. */
  links: CognateLink[];
  nodes: Map<string, CognateNode>;
  onOpenEntry: (key: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <li className="text-sm">
      <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <button
          type="button"
          onClick={() => onOpenEntry(node.entryKey)}
          className="font-medium text-primary hover:text-primary-hover"
        >
          {node.orthography[0]}
        </button>
        {/* A direct assertion and a word reached through other people's
            assertions are not the same claim, and the difference is the only
            provenance a reader has before voting exists. */}
        {node.distance === 1 ? (
          <span className="rounded-full border border-primary/40 px-2 py-0.5 text-xs text-primary">
            {t("cognates.directLabel")}
          </span>
        ) : (
          <span className="rounded-full border px-2 py-0.5 text-xs text-content-subtle">
            {t("cognates.steps", { count: node.distance })}
          </span>
        )}
        {links.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="text-xs text-content-subtle hover:text-primary"
          >
            {t("cognates.assertionsLabel")} <span aria-hidden="true">{open ? "▾" : "▸"}</span>
          </button>
        )}
      </span>
      {open && <CognateAssertions links={links} nodes={nodes} onOpenEntry={onOpenEntry} />}
    </li>
  );
}

/**
 * The cognate network around one entry, grouped by language.
 *
 * Renders nothing at all when the component is empty and nothing is parked —
 * the section is not a promise that a word has cognates.
 */
export function EntryCognates({
  network,
  languageID,
  languages,
  onOpenEntry,
  onAdd,
}: {
  network: CognateNetworkResponse;
  /** This entry's own language — its group is shown first (doublets). */
  languageID: string;
  languages: LanguageView[];
  onOpenEntry: (key: string) => void;
  /** Opens the editor on a new cognate. Absent when nobody is signed in. */
  onAdd?: () => void;
}) {
  const { t } = useTranslation();

  const nodesByKey = useMemo(
    () => new Map(network.nodes.map((n) => [n.entryKey, n])),
    [network.nodes],
  );

  const linksByEntry = useMemo(() => {
    const map = new Map<string, CognateLink[]>();
    for (const link of network.links) {
      for (const key of link.sides) {
        const list = map.get(key);
        if (list === undefined) map.set(key, [link]);
        else list.push(link);
      }
    }
    return map;
  }, [network.links]);

  const groups = useMemo((): LanguageGroup[] => {
    const byLanguage = new Map<string, CognateNode[]>();
    for (const node of network.nodes) {
      // The word being read is the origin of the distances, not a cognate of
      // itself, so it is not listed.
      if (node.entryKey === network.entryKey) continue;
      const list = byLanguage.get(node.languageID);
      if (list === undefined) byLanguage.set(node.languageID, [node]);
      else list.push(node);
    }
    const name = (tag: string) => {
      const known = languages.find((l) => l.tag === tag);
      return known !== undefined ? endonym(known) : tag;
    };
    return [...byLanguage.entries()]
      .map(([tag, nodes]) => ({
        languageID: tag,
        name: name(tag),
        nodes: nodes.sort((a, b) => a.distance - b.distance || compare(a, b)),
      }))
      // This entry's own language first — a doublet is the closest thing to the
      // word being read — then the rest by name.
      .sort((a, b) =>
        a.languageID === languageID
          ? -1
          : b.languageID === languageID
            ? 1
            : a.name < b.name
              ? -1
              : a.name > b.name
                ? 1
                : 0,
      );
  }, [network.nodes, network.entryKey, languages, languageID]);

  // An empty network still renders **for someone who could fill it**: the add
  // button is the only way a word gets its first cognate, so hiding the section
  // when there is nothing in it would make the feature unreachable exactly where
  // it is needed. A signed-out reader gets nothing, since there is neither
  // content to show nor an action to offer. (Parked assertions are not a reason
  // to render either — ParkedCognates is its own section.)
  if (groups.length === 0 && onAdd === undefined) return null;

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-content">{t("cognates.title")}</h2>
        {onAdd !== undefined && (
          <button
            type="button"
            onClick={onAdd}
            title={t("cognates.addHint")}
            className="text-xs text-primary hover:text-primary-hover"
          >
            {t("cognates.addLabel")}
          </button>
        )}
      </div>

      {groups.length === 0 ? (
        <p className="mt-1 text-xs text-content-subtle">{t("cognates.empty")}</p>
      ) : (
        <>
          <p className="mt-1 text-xs text-content-subtle">{t("cognates.hint")}</p>
          {network.truncated && (
            <p className="mt-2 rounded border border-amber-500/60 px-2 py-1 text-xs text-amber-700 dark:text-amber-400">
              {t("cognates.truncated")}
            </p>
          )}
          <div className="mt-3 space-y-3">
            {groups.map((group) => (
              <div key={group.languageID}>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-content-subtle">
                  {group.name}{" "}
                  <span className="font-mono normal-case">{group.languageID}</span>
                </h3>
                <ul className="mt-1 space-y-1.5">
                  {group.nodes.map((node) => (
                    <CognateNodeLine
                      key={node.entryKey}
                      node={node}
                      links={linksByEntry.get(node.entryKey) ?? []}
                      nodes={nodesByKey}
                      onOpenEntry={onOpenEntry}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-content-subtle">{t("cognates.distanceHint")}</p>
        </>
      )}
    </section>
  );
}

/** Byte order on the canonical spelling, matching the API's own ordering. */
function compare(a: CognateNode, b: CognateNode): number {
  const x = a.orthography[0] ?? "";
  const y = b.orthography[0] ?? "";
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * The repair strip: cognates touching this entry that the AppView cannot
 * currently vouch for — an entry withdrawn, or one it has never seen.
 *
 * Re-affirmation is not a special mode but the ordinary edit flow: republishing
 * the assertion against the entries as they are now is exactly what un-parks it.
 */
export function ParkedCognates({
  parked,
  languages,
  onOpenEntry,
  onEdit,
}: {
  parked: CognateView[];
  languages: LanguageView[];
  onOpenEntry: (key: string) => void;
  onEdit?: (cognate: CognateView) => void;
}) {
  const { t } = useTranslation();
  if (parked.length === 0) return null;

  return (
    <section className="mt-6 rounded-lg border bg-surface-muted/40 p-3">
      <h2 className="text-sm font-semibold text-content">
        <span aria-hidden="true">⚠ </span>
        {t("cognates.parkedLabel")}
      </h2>
      <p className="mt-1 text-xs text-content-subtle">{t("cognates.parkedHint")}</p>
      <ul className="mt-2 space-y-2">
        {parked.map((cognate) => {
          const other = cognate.sides[1];
          const known = languages.find((l) => l.tag === other.languageID);
          return (
            <li key={cognate.cognateKey} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="rounded-full border px-2 py-0.5 text-xs text-content-muted">
                {cognate.state === "stale"
                  ? t("cognates.stateStale")
                  : t("cognates.stateUnresolved")}
              </span>
              {/* A withdrawn entry still resolves — contesting the withdrawal is
                  the repair — so it stays a link. An entry this AppView has
                  never seen has only the spelling the record carried, and must
                  not be one: following it would 404. */}
              {other.entryKey !== null ? (
                <button
                  type="button"
                  onClick={() => onOpenEntry(other.entryKey!)}
                  className="text-sm font-medium text-primary hover:text-primary-hover"
                >
                  {other.orthography ?? other.recordedOrthography ?? other.entryKey}
                </button>
              ) : (
                <span
                  className="text-sm font-medium text-content-muted"
                  title={t("cognates.unresolvedSide")}
                >
                  {other.recordedOrthography ?? "—"}
                </span>
              )}
              <span className="rounded border bg-surface px-1.5 py-0.5 font-mono text-xs text-content-muted">
                {other.languageID}
              </span>
              <span className="text-xs text-content-subtle">
                {known !== undefined ? endonym(known) : other.languageID}
              </span>
              {onEdit !== undefined && (
                <button
                  type="button"
                  onClick={() => onEdit(cognate)}
                  className="text-xs text-primary hover:text-primary-hover"
                >
                  {t("cognates.reaffirm")}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
