import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  normalizeRelationKind,
  type LanguageView,
  type RelationView,
} from "@leksis/types";
import { fetchRelationRecord } from "../lib/atproto-record";
import { endonym } from "./LanguageSelector";

// The entry page's half of the semantic network: what this word has been
// asserted equivalent (or opposite) to, and what needs repairing.
//
// Read from the relations themselves rather than from the graph's edges, which
// is what keeps the distinction the reader needs: a whole-entry assertion
// belongs on the header, a sense's under its definition.

interface RelationLineProps {
  relation: RelationView;
  languages: LanguageView[];
  onOpenEntry: (key: string) => void;
  /** Show which sense of the *other* entry is meant. */
  showPlace?: boolean;
  /**
   * Open the editor on this relation. Absent when nobody is signed in — the
   * line then reads exactly as before.
   *
   * The same callback serves editing and re-affirming: republishing a parked
   * relation against the entries' current versions *is* the repair, so the
   * repair strip below hands this the same way an ordinary line does.
   */
  onEdit?: (relation: RelationView) => void;
}

/** A place as a bare address ("II.1."), when there is no tree to size it by. */
function placeText(place: number[]): string {
  return place.filter((n) => n !== 0).join(".");
}

/**
 * One relation, from this entry's point of view. `sides[0]` is always this
 * entry's side — the API guarantees it — so `sides[1]` is the other word.
 *
 * The other side's own notes live on the record, not in the index, so they are
 * resolved from the author's PDS on expand: the assertion's caveats ("partial
 * equivalence", "only in the legal register") are content like any other.
 */
function RelationLine({
  relation,
  languages,
  onOpenEntry,
  showPlace,
  onEdit,
}: RelationLineProps) {
  const { t } = useTranslation();
  const other = relation.sides[1];
  const [notes, setNotes] = useState<string[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || notes !== null) return;
    let cancelled = false;
    fetchRelationRecord(relation.recordURI)
      .then((record) => {
        if (!cancelled) setNotes(record?.notes ?? []);
      })
      .catch(() => {
        if (!cancelled) setNotes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, notes, relation.recordURI]);

  const known = languages.find((l) => l.tag === other.languageID);
  const languageName = known ? endonym(known) : other.languageID;
  const kind = normalizeRelationKind(relation.kind);
  // An unknown kind is shown verbatim rather than hidden — the same treatment
  // an unbound tag gets, and for the same reason: this AppView is not the
  // arbiter of what other people may assert.
  const kindLabel =
    kind === "antonym"
      ? t("relations.antonym")
      : kind === null
        ? relation.kind
        : null;

  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
      {other.entryKey !== null ? (
        <button
          type="button"
          onClick={() => onOpenEntry(other.entryKey!)}
          className="font-medium text-primary hover:text-primary-hover"
        >
          {other.orthography ?? other.recordedOrthography ?? other.entryKey}
        </button>
      ) : (
        /* No current entry document: the record's own denormalized spelling is
           all there is to print, and it must not be a link — following it
           would 404. This is exactly why a side carries it. */
        <span className="font-medium text-content-muted" title={t("relations.unresolvedSide")}>
          {other.recordedOrthography ?? "—"}
        </span>
      )}
      <span className="rounded border bg-surface px-1.5 py-0.5 font-mono text-xs text-content-muted">
        {other.languageID}
      </span>
      <span className="text-xs text-content-subtle">{languageName}</span>
      {showPlace === true && other.place.length > 0 && (
        <span className="font-mono text-xs text-content-subtle">{placeText(other.place)}</span>
      )}
      {kindLabel !== null && (
        <span className="rounded-full border border-warning/60 px-2 py-0.5 text-xs text-warning">
          {kindLabel}
        </span>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="text-xs text-content-subtle hover:text-primary"
      >
        {t("relations.details")} <span aria-hidden="true">{open ? "▾" : "▸"}</span>
      </button>
      {onEdit !== undefined && (
        <button
          type="button"
          onClick={() => onEdit(relation)}
          className="text-xs text-primary hover:text-primary-hover"
        >
          {relation.state === "live" ? t("relations.edit") : t("relations.reaffirm")}
        </button>
      )}
      {open && (
        <div className="w-full border-l pl-3 text-xs text-content-muted">
          {notes === null ? (
            <p>{t("relations.notesLoading")}</p>
          ) : notes.length > 0 ? (
            <ul className="space-y-0.5">
              {notes.map((note, i) => (
                <li key={i}>{note}</li>
              ))}
            </ul>
          ) : (
            <p className="text-content-subtle">{t("relations.noNotes")}</p>
          )}
          <p className="mt-1 break-all font-mono">{relation.authorDID}</p>
          <a
            href={`https://atproto.at/uri/${relation.recordURI}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:text-primary-hover"
          >
            {t("relations.viewRecord")}
          </a>
        </div>
      )}
    </li>
  );
}

/**
 * The relations attached to one sense (or to the whole entry), split the way a
 * reader reads them: equivalents in other languages, same-language equivalents
 * — **a synonym is a translation whose languages are equal**, so they are the
 * same assertion under a different heading — and antonyms, which are shown but
 * never traversed.
 */
export function SenseRelations({
  relations,
  languageID,
  languages,
  onOpenEntry,
  showPlace,
  onEdit,
}: {
  relations: RelationView[];
  /** This entry's language, which is what makes a relation a synonym. */
  languageID: string;
  languages: LanguageView[];
  onOpenEntry: (key: string) => void;
  showPlace?: boolean;
  onEdit?: (relation: RelationView) => void;
}) {
  const { t } = useTranslation();
  if (relations.length === 0) return null;

  const equivalences = relations.filter(
    (r) => normalizeRelationKind(r.kind) !== "antonym" && r.sides[1].languageID !== languageID,
  );
  const synonyms = relations.filter(
    (r) => normalizeRelationKind(r.kind) !== "antonym" && r.sides[1].languageID === languageID,
  );
  const antonyms = relations.filter((r) => normalizeRelationKind(r.kind) === "antonym");

  const block = (title: string, list: RelationView[]) =>
    list.length === 0 ? null : (
      <div className="mt-1.5">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-content-subtle">
          {title}
        </h4>
        <ul className="mt-1 space-y-1">
          {list.map((relation) => (
            <RelationLine
              key={relation.relationKey}
              relation={relation}
              languages={languages}
              onOpenEntry={onOpenEntry}
              showPlace={showPlace}
              onEdit={onEdit}
            />
          ))}
        </ul>
      </div>
    );

  return (
    <div className="mt-2 rounded-lg border-l-2 border-primary/30 pl-3">
      {block(t("relations.translations"), equivalences)}
      {block(t("relations.synonyms"), synonyms)}
      {block(t("relations.antonyms"), antonyms)}
    </div>
  );
}

/**
 * The repair strip: relations touching this entry that the AppView cannot
 * currently vouch for, because **a wrong translation is worse than a missing
 * one** — they are withheld from results and shown as work to do instead.
 *
 * Each row offers re-affirmation, which is not a special repair mode but the
 * ordinary edit flow: republishing the assertion against the entries as they
 * are now is exactly what un-parks it.
 */
export function ParkedRelations({
  parked,
  languages,
  onOpenEntry,
  onEdit,
}: {
  parked: RelationView[];
  languages: LanguageView[];
  onOpenEntry: (key: string) => void;
  onEdit?: (relation: RelationView) => void;
}) {
  const { t } = useTranslation();
  if (parked.length === 0) return null;

  const stateLabel = (relation: RelationView) => {
    switch (relation.state) {
      case "stale":
        return t("relations.stateStale");
      case "unresolved":
        return t("relations.stateUnresolved");
      default:
        return t("relations.stateOversize");
    }
  };

  return (
    <section className="mt-8 rounded-lg border bg-surface-muted/40 p-3">
      <h2 className="text-sm font-semibold text-content">
        <span aria-hidden="true">⚠ </span>
        {t("relations.parkedLabel")}
      </h2>
      <p className="mt-1 text-xs text-content-subtle">{t("relations.parkedHint")}</p>
      <ul className="mt-2 space-y-2">
        {parked.map((relation) => (
          <li key={relation.relationKey}>
            <span className="mr-2 rounded-full border px-2 py-0.5 text-xs text-content-muted">
              {stateLabel(relation)}
            </span>
            <ul className="mt-1 inline-flex">
              <RelationLine
                relation={relation}
                languages={languages}
                onOpenEntry={onOpenEntry}
                showPlace
                onEdit={onEdit}
              />
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
