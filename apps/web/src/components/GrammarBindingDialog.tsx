import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  grammarIssues,
  grammarLookup,
  featureDocUrl,
  ABBREVIATION_VALUE_PATTERN,
  formatTagVerbatim,
  posTag,
  resolveTag,
  tagKey,
  uposDocUrl,
  tagAtomKeys,
  uposGloss,
  valueTag,
  FEATURE_NAME_PATTERN,
  FEATURE_VALUE_PATTERN,
  HEADWORD_UPOS,
  LEKSIS_LANGUAGE_COLLECTION,
  POS_VALUE_PATTERN,
  type Grammar,
  type GrammarCategory,
  type GrammarLabel,
  type GrammarReference,
  type LabelSample,
  type LabelView,
  type LeksisLanguageRecord,
  type ParadigmView as ParadigmPointer,
  type Tag,
} from "@leksis/types";
import { ParadigmEditorDialog } from "./ParadigmEditorDialog";
import { fetchFeatureValues, fetchFeatures, type UdFeature, type UdValue } from "@leksis/ud";
import { useSession } from "../auth/SessionProvider";
import {
  fetchCurrentLanguageRecord,
  fetchLabelSample,
  fetchLabels,
  fetchLanguageParadigms,
} from "../lib/api";
import { fetchLanguageRecord } from "../lib/atproto-record";
import { labelCollator } from "../lib/label-shelf";
import { entryPath } from "../lib/routes";
import {
  abbreviationRows,
  addInherent,
  carriesLegacyGrammar,
  categoryRows,
  classRows,
  draftFromRecord,
  findAbbreviation,
  findCategory,
  findFeature,
  findPos,
  findValue,
  grammaticalFeatureRows,
  inherentRows,
  lexicalRows,
  nameCategory,
  posRows,
  removeAbbreviation,
  removeCategory,
  removeFeature,
  removeInherent,
  removePos,
  removeValue,
  upsertAbbreviation,
  upsertFeature,
  upsertPos,
  upsertValue,
  valueRows,
} from "../lib/grammar-draft";

/**
 * The binding editor: where a language declares the grammatical vocabulary it
 * uses, each atom bound to a label in that same language.
 *
 * The interface is a **path-scoped tree** — a sidebar holds the path, the main
 * panel shows exactly one level. The failure mode of a binding UI is a single
 * screen showing parts of speech, features and values at once; navigating one
 * level at a time is what keeps it comprehensible.
 *
 * The layer-1 gate (a feature name must be bound before any of its values can
 * be) is rendered **as navigation, not as an error**: the values entry point
 * simply is not offered until the name is bound, so no validation copy exists
 * to write or translate.
 *
 * Everything is edited against a draft and published as one full rewrite of
 * the language record — which is why both guards live here (see `onPublish`).
 */

/**
 * How long the paradigm list waits for a just-published record, and how often.
 *
 * The path is PDS → Jetstream → ArangoDB, so seconds; the cap is the source
 * page's, which is the longest that path has been observed to take.
 */
const PARADIGM_SYNC_POLL_MS = 3_000;
const PARADIGM_SYNC_MAX_TRIES = 20;

type Path =
  | { at: "root" }
  | { at: "pos" }
  | { at: "posForm"; value: string }
  | { at: "features" }
  // Inflection classes: the same three levels as a feature, reached through
  // their own door because UD has nothing to suggest for them. `minting` says a
  // form was opened through that door, which is the only thing the shared
  // levels cannot work out for themselves — a class not yet bound has no row to
  // read a scheme from.
  | { at: "classes" }
  // Lexicographic label sets — register, domain, usage. A third door onto the
  // same three levels, for the same reason the classes door exists: the
  // machinery is a feature's, and only what a contributor is *shown* differs.
  // `lexical` plays the part `minting` plays above, and for the same reason.
  | { at: "lexical" }
  | { at: "feature"; feature: string }
  | { at: "featureForm"; feature: string; minting?: boolean; lexical?: boolean }
  | { at: "values"; feature: string }
  | { at: "valueForm"; feature: string; value: string }
  // Plain abbreviations. Two levels, not three: an abbreviation has no values
  // to open, because it is not a set of options — it is one shallow row.
  // Addressed by its `value` since ADR-0020, not by the form it prints.
  | { at: "abbreviations" }
  | { at: "abbreviationForm"; value: string }
  // Layer 2 — one level per category, and that level is the category's own
  // editor: what this dictionary calls it, and which features define a headword
  // of it. `l2feature` is the enumeration prompt under such a feature, and each
  // of its rows leads to another category's editor — which is what lets the
  // walk go as deep as the language's declarations do without anything having
  // to be named on the way down.
  //
  // **No route is carried on the path.** A category's own bundle is its
  // ancestry, feat by feat in the order they were added, so the trail is
  // derived (`l2Crumbs`) rather than remembered — which is what lets it show
  // the *whole* line of descent instead of the one hop a `from` could hold.
  | { at: "l2root" }
  | { at: "l2category"; category: Tag }
  | { at: "l2feature"; category: Tag; feature: string }
  | { at: "l2categoryForm"; category: Tag }
  // Layer 5 — the language's paradigms. Editing one is not a level: it is a
  // *different record*, so it opens its own dialog with its own publish footer
  // rather than borrowing this one's.
  //
  // The layer-3 (axes) and layer-4 (layout) tabs that used to sit between these
  // two are gone: an axis is declared on its category and a table's shape lives
  // in the paradigm record (ADR-0019).
  | { at: "l5root" };

/** Which tab a path belongs to — the tab strip is derived, never stored. */
function pathTab(path: Path): "primitives" | "categories" | "paradigms" {
  if (path.at.startsWith("l5")) return "paradigms";
  return path.at.startsWith("l2") ? "categories" : "primitives";
}

interface GrammarBindingDialogProps {
  /** BCP 47 tag of the language whose grammar is being declared. */
  tag: string;
  onClose: () => void;
  /** The rewritten record was written to the PDS; the URI is not yet indexed. */
  onPublished: (uri: string) => void;
}

interface LabelDraft {
  long: string;
  short: string;
  minted: boolean;
  references: GrammarReference[];
  /**
   * Free prose about what the item covers — carried on every form because the
   * draft is one shape, and written back only by the two branches whose rows
   * have the field. A part of speech, a named combination and a plain
   * abbreviation take no note: `NOUN` explains itself, a combination's meaning
   * is its parts', and an abbreviation's expansion IS its explanation.
   */
  note: string;
}

const emptyLabel: LabelDraft = {
  long: "",
  short: "",
  minted: false,
  references: [],
  note: "",
};

/**
 * The levels whose rows carry a note — all five of them, since ADR-0020: what a
 * language *names*, it can explain.
 */
function notable(path: Path): boolean {
  return path.at !== "root" && path.at.endsWith("Form");
}

/**
 * The part of speech this bundle *is*, when it is nothing more than one — the
 * shallowest level of the category tree.
 *
 * That level has no category row of its own and must not grow one: its tag is
 * the tag the `pos` row binds, so a `categories` row for it would be two labels
 * for one tag and `grammarIssues` would report a `duplicate`. So the category
 * editor reads and writes the **`pos` row** there — the same label and the same
 * note a contributor sees under Primitives, reached through the other door.
 */
function barePos(category: Tag): string | undefined {
  if (category.upos === undefined || (category.feats ?? []).length > 0) return undefined;
  return category.upos.value;
}

/**
 * Whether this level is **editing a row** rather than listing one — which is
 * what decides whether the footer offers Bind or Publish (ADR-0020).
 *
 * The two used to sit on screen at once, the form's Bind button at the bottom
 * of a scrolling panel and Publish pinned in the footer below it, so the
 * ordinary way to lose an edit was to finish typing and press the button that
 * was in front of you. One primary action at a time, and it is the one that
 * commits what is on screen.
 */
function isFormLevel(path: Path): boolean {
  return path.at.endsWith("Form");
}

const inputClass =
  "w-full rounded-lg border bg-surface px-3 py-2 text-sm text-content outline-none placeholder:text-content-subtle focus:ring-2";

function toLabel(draft: LabelDraft): GrammarLabel {
  const short = draft.short.trim();
  return { long: draft.long.trim(), ...(short !== "" ? { short } : {}) };
}

function cleanReferences(references: GrammarReference[]): GrammarReference[] {
  return references
    .filter((r) => r.text.trim() !== "")
    .map((r) => {
      const url = (r.url ?? "").trim();
      return { text: r.text.trim(), ...(url !== "" ? { url } : {}) };
    });
}

export function GrammarBindingDialog({ tag, onClose, onPublished }: GrammarBindingDialogProps) {
  const { t } = useTranslation();
  const { agent, did } = useSession();

  const [loading, setLoading] = useState(true);
  const [record, setRecord] = useState<LeksisLanguageRecord | null>(null);
  /** The record reference as loaded — the baseline of the concurrency guard. */
  const [baseline, setBaseline] = useState<{ recordURI: string; cid: string } | null>(null);
  const [draft, setDraft] = useState<Grammar>({});
  const [path, setPath] = useState<Path>({ at: "root" });
  /**
   * The language's current paradigms, as pointers.
   *
   * Pointers and not records: this level lists and routes, and the rules
   * themselves are resolved by the editor from their author's PDS. The `cid`
   * riding along is what the editor's concurrency guard compares against.
   */
  const [paradigms, setParadigms] = useState<ParadigmPointer[]>([]);
  /**
   * The stacked paradigm editor: null while closed, `{}` while a new paradigm
   * is being declared, and carrying a pointer while one is being rewritten.
   *
   * The pointer and not merely its categories, because the editor needs the
   * `cid` for its concurrency guard and the record URI to resolve the tables
   * from their author's PDS — a paradigm's blast radius is every entry of a
   * category, so a copy loaded ten minutes ago must not overwrite one published
   * since.
   */
  const [editing, setEditing] = useState<{ pointer?: ParadigmPointer } | null>(null);
  /**
   * A paradigm published from this dialog, until the index has it.
   *
   * The list here is the AppView's, and a record reaches it through the author's
   * PDS and Jetstream — seconds, not milliseconds. Without this the author
   * publishes, the dialog closes, and their own paradigm is missing from the
   * list they are looking at.
   */
  const [syncing, setSyncing] = useState<string | null>(null);
  const [form, setForm] = useState<LabelDraft>(emptyLabel);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Live candidates from UD's documentation. Empty means "no suggestions" —
   * a failed fetch, an offline contributor, or a feature UD does not document
   * — never an error to report, because the manual field below stays the real
   * path. UD's uptime is not allowed to gate authoring.
   */
  const [udFeatures, setUdFeatures] = useState<UdFeature[]>([]);
  const [udValues, setUdValues] = useState<UdValue[]>([]);
  const [udLoading, setUdLoading] = useState(false);
  /**
   * The indexed label rows, for their usage counts alone — what the entries of
   * this language have actually done with the vocabulary being declared here.
   *
   * Side data in the strictest sense: an empty list is indistinguishable from a
   * dictionary where nothing is used yet, and both render the same nothing, so
   * a failure needs no handling beyond not having the counts.
   */
  const [labels, setLabels] = useState<LabelView[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ref = await fetchCurrentLanguageRecord(tag);
        const loaded = ref === null ? null : await fetchLanguageRecord(ref.recordURI);
        if (cancelled) return;
        setRecord(loaded);
        setBaseline(ref === null ? null : { recordURI: ref.recordURI, cid: ref.cid });
        // Mapped forward, never taken verbatim: a record written before the
        // category–axis merge carries declarations this lexicon no longer
        // defines, and loading them into the draft would make every publish
        // fail a gate the dialog cannot even report (see `draftFromRecord`).
        setDraft(draftFromRecord(loaded?.grammar));
      } catch (err) {
        console.error("could not load the language record:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    fetchLabels(tag)
      .then((rows) => {
        if (!cancelled) setLabels(rows);
      })
      // Logged rather than swallowed: with no counts every row renders as
      // unused, which is exactly what a young dictionary looks like — so a
      // failure here is invisible in the interface and needs to be visible
      // somewhere.
      .catch((err: unknown) => console.error("could not load usage counts:", err));
    return () => {
      cancelled = true;
    };
  }, [tag]);

  /**
   * Usage by canonical tag key. Only rows standing for a tag are indexed here,
   * which costs nothing: usage reaches this model from entries, an entry
   * carries tags and nothing else, so a row with no tag — a feature *name*, a
   * plain abbreviation — is at zero by construction.
   */
  const usage = useMemo(() => {
    const index = new Map<string, number>();
    for (const row of labels) {
      if (row.tag !== undefined) index.set(tagKey(row.tag), row.count);
    }
    return index;
  }, [labels]);

  /**
   * The usage control for one row, or nothing where nothing uses it.
   *
   * Keyed on the tag, not left to position: the drawn word is state inside the
   * control, and every level here renders its rows from a list whose items are
   * keyed only within that level. Two levels whose rows land at the same index
   * (`Mood=Ind` where `Definite=Ind` was) would otherwise reconcile onto one
   * another and carry a word across from a tag it belongs to into one it does
   * not.
   */
  function usageFor(rowTag: Tag) {
    const key = tagKey(rowTag);
    return <Usage key={key} languageTag={tag} tag={rowTag} count={usage.get(key) ?? 0} />;
  }

  /**
   * How this language's own rows are ordered on screen: alphabetically, by what
   * a contributor reads on the row.
   *
   * **Display only** — the record keeps the order its author wrote, because an
   * array's order is theirs and re-sorting one on save would rewrite a
   * stranger's record to no purpose. What it fixes is the reading: a list in
   * insertion order is a list nobody can look anything up in, and a language's
   * values, abbreviations and categories are exactly the lists a contributor
   * scans for one row. Collated in the language being described, since these
   * strings are homolingual (`labelCollator`).
   */
  const collator = useMemo(() => labelCollator(tag), [tag]);
  function sorted<T>(rows: readonly T[], text: (row: T) => string): T[] {
    return [...rows].sort((a, b) => collator.compare(text(a), text(b)));
  }

  // Candidates are fetched when a level that shows them is opened, not on
  // mount: a contributor who only edits a label never touches the network.
  useEffect(() => {
    if (path.at !== "features" || udFeatures.length > 0) return;
    const controller = new AbortController();
    setUdLoading(true);
    fetchFeatures(controller.signal)
      .then(setUdFeatures)
      .finally(() => setUdLoading(false));
    return () => controller.abort();
  }, [path.at, udFeatures.length]);

  const valuesFeature = path.at === "values" ? path.feature : null;
  const valuesFeatureMinted =
    valuesFeature !== null && findFeature(draft, valuesFeature)?.scheme !== undefined;
  useEffect(() => {
    if (valuesFeature === null) return;
    setUdValues([]);
    // A minted feature is this language's own — an inflection class, or a name
    // UD has no term for — so UD documents no values for it and the request is
    // not made rather than made and thrown away.
    if (valuesFeatureMinted) return;
    const controller = new AbortController();
    setUdLoading(true);
    fetchFeatureValues(valuesFeature, controller.signal)
      .then((result) => setUdValues(result.values))
      .finally(() => setUdLoading(false));
    return () => controller.abort();
  }, [valuesFeature, valuesFeatureMinted]);

  /**
   * The no-orphan guard, and every other coherence check: **any** defect in the
   * draft blocks the write, not merely one this edit introduced (ADR-0015).
   *
   * The AppView now refuses to index an incoherent grammar, so publishing one
   * would drop the whole version silently — the contributor's edit would appear
   * to succeed and never arrive. The distinction the old diff drew has no
   * subject left either: nothing incoherent gets indexed, so the record this
   * dialog loads is always coherent to begin with.
   */
  const defects = useMemo(() => grammarIssues(draft), [draft]);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(record?.grammar ?? {}),
    [draft, record],
  );

  /**
   * Whether the form on screen has what its row requires — what the footer's
   * Bind button is gated on.
   *
   * Every row needs a full form. An abbreviation needs its printed form too:
   * the lexicon requires it, and a row that prints nothing is not an
   * abbreviation of anything.
   */
  const formComplete =
    form.long.trim() !== "" &&
    (path.at !== "abbreviationForm" || form.short.trim() !== "");

  /** Seed the binding form whenever a form level is opened. */
  function openForm(next: Path) {
    let existing;
    if (next.at === "posForm") existing = findPos(draft, next.value);
    else if (next.at === "featureForm") existing = findFeature(draft, next.feature);
    else if (next.at === "valueForm") existing = findValue(draft, next.feature, next.value);
    else if (next.at === "l2categoryForm") {
      // The category's own row: one label and one note, addressed by the bundle
      // the path carries. Never minted and never referenced — provenance rides
      // on the atoms, each already bound with its own scheme. On the shallowest
      // level the row *is* the part of speech's (see `barePos`).
      const bare = barePos(next.category);
      const row =
        bare !== undefined ? findPos(draft, bare) : findCategory(draft, next.category);
      setForm({
        ...emptyLabel,
        long: row?.label.long ?? "",
        short: row?.label.short ?? "",
        note: row?.note ?? "",
      });
      setPath(next);
      return;
    }
    else if (next.at === "abbreviationForm") {
      // An abbreviation has no tag to bind: its identity came in through the
      // path, and what is written here is the form it prints, what it stands
      // for, and when to reach for it.
      const row = findAbbreviation(draft, next.value);
      setForm({
        ...emptyLabel,
        long: row?.long ?? "",
        short: row?.short ?? "",
        note: row?.note ?? "",
        references: row?.references ?? [],
      });
      setPath(next);
      return;
    }
    // A new row starts with the mint box ticked wherever minting is the only
    // coherent answer: an inflection class or a lexicographic label set, which
    // UD has no terms for, and any value of a feature that is itself minted —
    // UD cannot document a value of a feature it does not define. Everywhere
    // else it starts unticked, so minting stays a deliberate act.
    const mintedByDefault =
      (next.at === "featureForm" && (next.minting === true || next.lexical === true)) ||
      (next.at === "valueForm" && findFeature(draft, next.feature)?.scheme !== undefined);
    setForm(
      existing === undefined
        ? { ...emptyLabel, minted: mintedByDefault }
        : {
            ...emptyLabel,
            long: existing.label.long,
            short: existing.label.short ?? "",
            minted: "scheme" in existing && existing.scheme !== undefined,
            references: existing.references ?? [],
            note: ("note" in existing ? existing.note : undefined) ?? "",
          },
    );
    setPath(next);
  }

  function saveForm() {
    const label = toLabel(form);
    if (label.long === "") return;
    // A row already minted keeps the scheme it was minted under. That is this
    // language's own tag in the ordinary case but need not be — a value
    // borrowed from a neighbour carries the neighbour's — and recomputing it as
    // `tag` would rewrite the atom's identity behind the contributor's back,
    // orphaning every layer-2-to-4 row standing on it.
    const bound =
      path.at === "posForm"
        ? findPos(draft, path.value)
        : path.at === "featureForm"
          ? findFeature(draft, path.feature)
          : path.at === "valueForm"
            ? findValue(draft, path.feature, path.value)
            : undefined;
    const scheme = form.minted ? (bound?.scheme ?? tag) : undefined;
    const references = cleanReferences(form.references);
    const extra = {
      ...(scheme !== undefined ? { scheme } : {}),
      ...(references.length > 0 ? { references } : {}),
    };
    // A blank note is an absent one, never a stored empty string: the lexicon
    // says absent-or-something, and `isValidNote` refuses the empty case at
    // ingest, so writing one here would publish a record the AppView drops.
    const note = form.note.trim();
    const noted = note === "" ? {} : { note };

    if (path.at === "abbreviationForm") {
      // The identity came in with the path and is not read back off the form —
      // editing it would be writing a different row — while the printed form
      // is, which is exactly what ADR-0020 split the two for: a contributor can
      // correct "udb." to "u.d.b." without losing the row.
      const short = form.short.trim();
      if (short === "") return;
      setDraft(
        upsertAbbreviation(draft, {
          value: path.value,
          short,
          long: label.long,
          ...noted,
          ...(references.length > 0 ? { references } : {}),
        }),
      );
      setPath({ at: "abbreviations" });
    } else if (path.at === "posForm") {
      setDraft(upsertPos(draft, { value: path.value, label, ...extra }));
      setPath({ at: "pos" });
    } else if (path.at === "featureForm") {
      // Whether a row is a lexicographic set is decided once, when it is
      // created, and thereafter read off the row rather than off the path — so
      // reopening it through any door keeps it what it is.
      const lexicographic =
        findFeature(draft, path.feature)?.lexicographic === true || path.lexical === true;
      setDraft(
        upsertFeature(draft, {
          feature: path.feature,
          label,
          ...extra,
          ...noted,
          ...(lexicographic ? { lexicographic: true } : {}),
        }),
      );
      setPath({ at: "feature", feature: path.feature });
    } else if (path.at === "valueForm") {
      setDraft(
        upsertValue(draft, { feature: path.feature, value: path.value, label, ...extra, ...noted }),
      );
      setPath({ at: "values", feature: path.feature });
    } else if (path.at === "l2categoryForm") {
      // A category is never minted: provenance rides on its atoms, which are
      // already bound with their own schemes. And it carries no references —
      // there is nothing to document about a combination of documented items.
      //
      // The shallowest level writes the `pos` row instead, keeping the two
      // fields this form does not ask for: unminting a part of speech, or
      // dropping the source that documents a minted one, is not something
      // renaming it should do behind the contributor's back.
      const bare = barePos(path.category);
      const bound = bare === undefined ? undefined : findPos(draft, bare);
      if (bare !== undefined) {
        setDraft(
          upsertPos(draft, {
            value: bare,
            label,
            ...(bound?.scheme !== undefined ? { scheme: bound.scheme } : {}),
            ...(bound?.references !== undefined ? { references: bound.references } : {}),
            ...noted,
          }),
        );
      } else {
        setDraft(nameCategory(draft, path.category, label, note));
      }
      setPath({ at: "l2category", category: path.category });
    }
  }

  // ---- layer 2 helpers --------------------------------------------------

  /**
   * The draft's own lookup, so every layer-2 level shows bound homolingual
   * labels — including edits not yet published. The gate as navigation again:
   * a category can only ever be assembled from labelled things, so there is
   * always something to show.
   */
  const draftLookup = useMemo(() => grammarLookup(draft), [draft]);

  /**
   * The language's declarations **as published**, which is what the paradigm
   * editor addresses — not the draft this dialog is editing.
   *
   * A paradigm is a different record with its own publish button, so a cell
   * address built from a value that exists only in an unsaved grammar draft
   * would be publishable *and* pointing at nothing the moment the draft was
   * abandoned. Same mapping as the draft's own initial state, so a record
   * written before the merge reads coherently here too.
   */
  const savedGrammar = useMemo(() => draftFromRecord(record?.grammar), [record]);
  const savedLookup = useMemo(() => grammarLookup(savedGrammar), [savedGrammar]);

  /**
   * Wait for a just-published paradigm to reach the index, then show it.
   *
   * The same shape as the source page's sync poll and for the same reason: the
   * record went to a PDS, and this list is the AppView's. Giving up after the
   * cap leaves the notice off and the list as the index has it — a paradigm that
   * never arrives is a firehose problem, not something to keep asking about.
   */
  useEffect(() => {
    if (syncing === null) return;
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      fetchLanguageParadigms(tag)
        .then((rows) => {
          setParadigms(rows);
          if (rows.some((row) => row.paradigmKey === syncing)) {
            setSyncing(null);
            clearInterval(timer);
          } else if (tries >= PARADIGM_SYNC_MAX_TRIES) {
            console.warn(`paradigm ${syncing} not indexed after polling; giving up`);
            setSyncing(null);
            clearInterval(timer);
          }
        })
        .catch(() => {
          /* transient — keep polling */
        });
    }, PARADIGM_SYNC_POLL_MS);
    return () => clearInterval(timer);
  }, [syncing, tag]);

  /** A feature's homolingual label, for the trail's hover text. */
  function featureTitle(feature: string): string | undefined {
    return findFeature(draft, feature)?.label.long;
  }

  /** Display text of a category: bound labels where they exist, else verbatim. */
  function categoryText(category: Tag): string {
    return resolveTag(category, draftLookup)
      .map((part) => part.label?.short ?? part.label?.long ?? part.verbatim ?? "")
      .join(" ");
  }

  /** The tag of one enumerated combination: the category plus one value. */
  function combinationTag(category: Tag, value: { feature: string; value: string; scheme?: string }): Tag {
    return {
      ...(category.upos !== undefined ? { upos: category.upos } : {}),
      feats: [...(category.feats ?? []), valueTag(value).feats![0]!],
    };
  }

  /**
   * Every category declared **below** this one — at any depth, not only its
   * direct children, and optionally only those reached through one feature.
   *
   * Depth is the point (ADR-0020). A real tree goes `{NOUN}` → `Number=Sing`
   * → `Gender=Masc` → `Subgender=Unstable`, and the intermediate levels are
   * often named by nobody, because no word in the dictionary is ever *just* a
   * singular noun. Counting direct children therefore printed "0 named" over a
   * feature holding eight categories, which read as "nothing here" on the one
   * button that leads to all of them.
   *
   * Containment is scheme-blind (`tagAtomKeys`), the same alphabet
   * `headwordKeys` compares in, so a bot's bare `Conjugation=2` and the
   * editor's minted one count as the same atom.
   */
  function descendantCategories(category: Tag, feature?: string): GrammarCategory[] {
    const atoms = tagAtomKeys(category);
    const key = tagKey(category);
    return categoryRows(draft).filter((row) => {
      if (tagKey(row.category) === key) return false;
      const theirs = new Set(tagAtomKeys(row.category));
      if (!atoms.every((atom) => theirs.has(atom))) return false;
      if (feature === undefined) return true;
      return (row.category.feats ?? []).some((feat) => feat.feature === feature);
    });
  }

  async function onPublish() {
    if (!agent || !did || record === null || baseline === null) return;
    setSubmitting(true);
    setError(null);
    try {
      // Optimistic concurrency: last-write-wins can now drop a *reference*,
      // not merely a label, so a write made against a stale copy is refused
      // rather than merged.
      const current = await fetchCurrentLanguageRecord(tag);
      if (
        current === null ||
        current.recordURI !== baseline.recordURI ||
        current.cid !== baseline.cid
      ) {
        setError(t("grammar.errors.stale"));
        setSubmitting(false);
        return;
      }

      // Every array, not just layer 1's: a grammar holding only abbreviations
      // is a perfectly good declaration, and checking three arrays would have
      // silently dropped it on the way to the PDS.
      const hasRows = Object.values(draft).some((rows) => (rows ?? []).length > 0);
      const updated: LeksisLanguageRecord = {
        ...record,
        $type: LEKSIS_LANGUAGE_COLLECTION,
        tag: record.tag,
        ...(hasRows ? { grammar: draft } : {}),
        createdAt: new Date().toISOString(),
      };
      if (!hasRows) delete (updated as { grammar?: Grammar }).grammar;

      const res = await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: LEKSIS_LANGUAGE_COLLECTION,
        rkey: record.tag,
        record: { ...updated },
      });
      onPublished(res.data.uri);
    } catch (err) {
      console.error("putRecord (grammar) failed:", err);
      setError(t("grammar.errors.writeFailed"));
      setSubmitting(false);
    }
  }

  // ---- navigation -------------------------------------------------------

  const tab = pathTab(path);

  /**
   * Load the paradigm pointers when the tab is first opened.
   *
   * A failure degrades to an empty list and no message. A paradigm has a total
   * fallback — no rules means an entry shows the forms its author wrote, which
   * is what entries did before this layer — so an unreachable list is an absence
   * to work from, never an error to put in front of a contributor.
   */
  useEffect(() => {
    if (tab !== "paradigms") return;
    let live = true;
    fetchLanguageParadigms(tag)
      .then((rows) => {
        if (live) setParadigms(rows);
      })
      .catch((err: unknown) => {
        console.warn(`could not list the paradigms of "${tag}":`, err);
      });
    return () => {
      live = false;
    };
  }, [tab, tag]);
  const crumbs: { label: string; title?: string; go: Path }[] =
    tab === "categories"
      ? [{ label: t("grammar.crumbL2Root"), go: { at: "l2root" } }]
      : tab === "paradigms"
        ? [{ label: t("grammar.crumbL5Root"), go: { at: "l5root" } }]
        : [{ label: t("grammar.crumbRoot"), go: { at: "root" } }];
  if (path.at === "pos" || path.at === "posForm") {
    crumbs.push({ label: t("grammar.posLevel"), go: { at: "pos" } });
    if (path.at === "posForm") crumbs.push({ label: path.value, go: path });
  } else if (
    path.at === "l2category" ||
    path.at === "l2feature" ||
    path.at === "l2categoryForm"
  ) {
    // **The whole line of descent, derived from the bundle** (ADR-0020). A
    // category's feats are the refinements that built it, in the order they
    // were added, so the trail down to `{NOUN, Number=Sing, Gender=Masc,
    // Subgender=Unstable}` is read straight off it — no route has to be carried
    // on the path, and arriving from the root list shows the same trail as
    // walking down to it. Before this, only the last hop was kept, so clicking a
    // parent lost the grandparent that led to it.
    //
    // The rungs **alternate feature and value** rather than printing the
    // category's abbreviation at each step, because an abbreviation says what a
    // word *is* and a trail has to say where you *are*: "Number= / Sing /
    // Gender= / Masc" is the path taken, where "ak.g." is the destination three
    // times over. They are written the way UD writes them, with the
    // homolingual label on hover — a rung is an address, and the sidebar is
    // narrow.
    const upos = path.category.upos;
    const base: Tag = upos !== undefined ? { upos } : {};
    if (upos !== undefined) {
      const bound = findPos(draft, upos.value);
      crumbs.push({
        label: bound?.label.short ?? bound?.label.long ?? upos.value,
        go: { at: "l2category", category: base },
      });
    }
    const feats = path.category.feats ?? [];
    for (let i = 0; i < feats.length; i++) {
      const feat = feats[i]!;
      const parent: Tag = { ...base, ...(i > 0 ? { feats: feats.slice(0, i) } : {}) };
      crumbs.push({
        label: `${feat.feature}=`,
        ...(featureTitle(feat.feature) !== undefined
          ? { title: featureTitle(feat.feature)! }
          : {}),
        go: { at: "l2feature", category: parent, feature: feat.feature },
      });
      const named = findValue(draft, feat.feature, feat.value)?.label.long;
      crumbs.push({
        label: feat.value,
        ...(named !== undefined ? { title: named } : {}),
        go: { at: "l2category", category: { ...base, feats: feats.slice(0, i + 1) } },
      });
    }
    if (path.at === "l2feature") {
      crumbs.push({
        label: `${path.feature}=`,
        ...(featureTitle(path.feature) !== undefined
          ? { title: featureTitle(path.feature)! }
          : {}),
        go: path,
      });
    } else if (path.at === "l2categoryForm") {
      crumbs.push({ label: t("grammar.l2NameCrumb"), go: path });
    }
  } else if (path.at === "classes") {
    crumbs.push({ label: t("grammar.classesLevel"), go: { at: "classes" } });
  } else if (path.at === "lexical") {
    crumbs.push({ label: t("grammar.lexicalLevel"), go: { at: "lexical" } });
  } else if (path.at === "abbreviations" || path.at === "abbreviationForm") {
    crumbs.push({ label: t("grammar.abbreviationsLevel"), go: { at: "abbreviations" } });
    if (path.at === "abbreviationForm") {
      crumbs.push({ label: findAbbreviation(draft, path.value)?.short ?? path.value, go: path });
    }
  } else if (path.at !== "root" && path.at !== "l2root" && path.at !== "l5root") {
    // Which section a feature sits under is **derived from the row**, not
    // remembered: a lexicographic set says so on the row, a class is any other
    // minted feature, and a UD one leads back to the features level. The trail
    // is then still right when the dialog is reopened, and there is no section
    // state to keep in step with the draft.
    const row = path.at === "features" ? undefined : findFeature(draft, path.feature);
    const asLexical =
      path.at !== "features" &&
      (row?.lexicographic === true || (path.at === "featureForm" && path.lexical === true));
    const asClass =
      !asLexical &&
      path.at !== "features" &&
      (row?.scheme !== undefined || (path.at === "featureForm" && path.minting === true));
    crumbs.push(
      asLexical
        ? { label: t("grammar.lexicalLevel"), go: { at: "lexical" } }
        : asClass
          ? { label: t("grammar.classesLevel"), go: { at: "classes" } }
          : { label: t("grammar.featuresLevel"), go: { at: "features" } },
    );
    if (path.at !== "features") {
      crumbs.push({ label: path.feature, go: { at: "feature", feature: path.feature } });
      if (path.at === "values" || path.at === "valueForm") {
        crumbs.push({ label: t("grammar.valuesLevel"), go: { at: "values", feature: path.feature } });
      }
      if (path.at === "valueForm") crumbs.push({ label: path.value, go: path });
    }
  }

  // ---- level renderers --------------------------------------------------

  function renderRoot() {
    return (
      <ul className="space-y-2">
        <li>
          <button type="button" onClick={() => setPath({ at: "pos" })} className={levelButton}>
            <span className="font-medium text-content">{t("grammar.posLevel")}</span>
            <span className="text-xs text-content-subtle">
              {t("grammar.posCount", { bound: posRows(draft).length, total: HEADWORD_UPOS.length })}
            </span>
          </button>
        </li>
        <li>
          <button type="button" onClick={() => setPath({ at: "features" })} className={levelButton}>
            <span className="font-medium text-content">{t("grammar.featuresLevel")}</span>
            <span className="text-xs text-content-subtle">
              {t("grammar.featuresCount", { count: grammaticalFeatureRows(draft).length })}
            </span>
          </button>
        </li>
        <li>
          <button type="button" onClick={() => setPath({ at: "classes" })} className={levelButton}>
            <span className="font-medium text-content">{t("grammar.classesLevel")}</span>
            <span className="text-xs text-content-subtle">
              {t("grammar.classesCount", { count: classRows(draft).length })}
            </span>
          </button>
        </li>
        <li>
          <button type="button" onClick={() => setPath({ at: "lexical" })} className={levelButton}>
            <span className="font-medium text-content">{t("grammar.lexicalLevel")}</span>
            <span className="text-xs text-content-subtle">
              {t("grammar.lexicalCount", { count: lexicalRows(draft).length })}
            </span>
          </button>
        </li>
        <li>
          <button
            type="button"
            onClick={() => setPath({ at: "abbreviations" })}
            className={levelButton}
          >
            <span className="font-medium text-content">{t("grammar.abbreviationsLevel")}</span>
            <span className="text-xs text-content-subtle">
              {t("grammar.abbreviationsCount", { count: abbreviationRows(draft).length })}
            </span>
          </button>
        </li>
      </ul>
    );
  }

  /**
   * Lexicographic label sets: register, domain, editorial usage.
   *
   * The machinery is an inflection class's exactly — a minted feature, one name
   * and several values — because the shape of "a set of named options this
   * language declares" is the same whatever the options mean. What differs is
   * what may be *built* on them: a class says which paradigm a word follows, so
   * layers 2 to 4 stand on it, while a lexicographic label says how a word is
   * used, so they must not. That exclusion is rendered the way every gate here
   * is — these rows are simply absent from the pickers upstairs — and reported
   * as an issue only for a record authored somewhere else.
   */
  function renderLexical() {
    const rows = sorted(lexicalRows(draft), (row) => row.feature);
    return (
      <>
        <p className="mb-3 text-xs text-content-subtle">{t("grammar.lexicalHint")}</p>
        {rows.length === 0 ? (
          <p className="text-sm text-content-muted">{t("grammar.lexicalEmpty")}</p>
        ) : (
          <ul className="space-y-1.5">
            {rows.map((row) => (
              <li key={row.feature}>
                <button
                  type="button"
                  onClick={() => setPath({ at: "feature", feature: row.feature })}
                  className={levelButton}
                >
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="font-mono text-sm text-content">{row.feature}</span>
                    <span className="truncate text-xs text-content-subtle">{row.label.long}</span>
                  </span>
                  <span className="text-xs text-content-subtle">
                    {t("grammar.valuesCount", { count: valueRows(draft, row.feature).length })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <AddRow
          placeholder={t("grammar.addLexicalPlaceholder")}
          pattern={FEATURE_NAME_PATTERN}
          hint={t("grammar.addLexicalHint")}
          onAdd={(feature) => openForm({ at: "featureForm", feature, lexical: true })}
        />
      </>
    );
  }

  /**
   * Plain abbreviations — the front matter proper: "udb." for "un dra bennak".
   *
   * One level, not three, because there is nothing underneath: an abbreviation
   * is not a set of options and stands for no tag, so there is no value list to
   * open and no tag to bind. What is asked for on the way in is the row's
   * **identity** — an identifier, not the printed form — and everything a
   * reader sees is written inside, which is what lets a contributor correct
   * "udb." to "u.d.b." without losing the row (ADR-0020).
   */
  function renderAbbreviations() {
    const rows = sorted(abbreviationRows(draft), (row) => row.short);
    return (
      <>
        <p className="mb-3 text-xs text-content-subtle">{t("grammar.abbreviationsHint")}</p>
        {rows.length === 0 ? (
          <p className="text-sm text-content-muted">{t("grammar.abbreviationsEmpty")}</p>
        ) : (
          <ul className="space-y-1.5">
            {rows.map((row) => {
              const note = row.note?.trim() ?? "";
              return (
                <li key={row.value} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openForm({ at: "abbreviationForm", value: row.value })}
                    className={`${stackedLevelButton} min-w-0 flex-1`}
                  >
                    <span className="flex w-full items-baseline justify-between gap-3">
                      <span className="font-mono text-sm text-content">{row.short}</span>
                      <span className="truncate text-sm text-content">{row.long}</span>
                    </span>
                    {note !== "" && (
                      <span className="line-clamp-2 whitespace-pre-line text-xs text-content-subtle">
                        {note}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraft(removeAbbreviation(draft, row.value))}
                    aria-label={t("grammar.removeAbbreviation")}
                    title={t("grammar.removeAbbreviation")}
                    className="text-content-subtle hover:text-danger"
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <AddRow
          placeholder={t("grammar.addAbbreviationPlaceholder")}
          pattern={ABBREVIATION_VALUE_PATTERN}
          hint={t("grammar.addAbbreviationHint")}
          onAdd={(value) => openForm({ at: "abbreviationForm", value })}
        />
      </>
    );
  }

  /**
   * Inflection classes: a declension, a conjugation group, a mutation class.
   *
   * The machinery is a feature's exactly — one name, one label, several values —
   * and that is the point: a class is a **minted feature and nothing more**, so
   * it needs no storage of its own and the entry editor already offers it
   * through layer 2 without knowing this section exists. What differs is only
   * what a contributor is shown: **nothing is fetched from UD**, because UD
   * defines no paradigm object, so a class and every one of its members is
   * necessarily this language's own declaration. No minted badge either — here
   * it would be on every row, saying nothing.
   */
  function renderClasses() {
    const rows = sorted(classRows(draft), (row) => row.feature);
    return (
      <>
        <p className="mb-3 text-xs text-content-subtle">{t("grammar.classesHint")}</p>
        {rows.length === 0 ? (
          <p className="text-sm text-content-muted">{t("grammar.classesEmpty")}</p>
        ) : (
          <ul className="space-y-1.5">
            {rows.map((row) => (
              <li key={row.feature}>
                <button
                  type="button"
                  onClick={() => setPath({ at: "feature", feature: row.feature })}
                  className={levelButton}
                >
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="font-mono text-sm text-content">{row.feature}</span>
                    <span className="truncate text-xs text-content-subtle">{row.label.long}</span>
                  </span>
                  <span className="text-xs text-content-subtle">
                    {t("grammar.valuesCount", { count: valueRows(draft, row.feature).length })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <AddRow
          placeholder={t("grammar.addClassPlaceholder")}
          pattern={FEATURE_NAME_PATTERN}
          hint={t("grammar.addClassHint")}
          onAdd={(feature) => openForm({ at: "featureForm", feature, minting: true })}
        />
      </>
    );
  }

  function renderPos() {
    // UD's own list keeps UD's order — it is fixed, grouped open-then-closed,
    // and a contributor learns where a tag sits. What a language minted has no
    // order of its own, so it is alphabetical like every other list here.
    const minted = sorted(
      posRows(draft).filter((row) => !HEADWORD_UPOS.some((u) => u.value === row.value)),
      (row) => row.value,
    );
    return (
      <>
        <p className="mb-3 text-xs text-content-subtle">{t("grammar.posHint")}</p>
        <ul className="space-y-1.5">
          {HEADWORD_UPOS.map((upos) => {
            const bound = findPos(draft, upos.value);
            // An unbound part of speech still has usage to report — entries may
            // carry NOUN in a language that never said what to call it, and
            // that gap is exactly what the naming worklist is about. So the tag
            // is built from the row where there is one and from the identifier
            // where there is not; with no scheme either way, they key alike.
            const rowTag = posTag(bound ?? { value: upos.value });
            return (
              <li key={upos.value} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => openForm({ at: "posForm", value: upos.value })}
                  className={`${levelButton} flex-1`}
                >
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="font-mono text-sm text-content">{upos.value}</span>
                    {/* UD's English gloss: UI chrome for the contributor
                        choosing what to bind, never entry content. */}
                    <span className="truncate text-xs text-content-subtle">{upos.gloss}</span>
                  </span>
                  {bound === undefined ? (
                    <span className="text-xs text-content-subtle">{t("grammar.unbound")}</span>
                  ) : (
                    <span className="text-sm text-content">
                      {bound.label.short ?? bound.label.long}
                    </span>
                  )}
                </button>
                {usageFor(rowTag)}
              </li>
            );
          })}
          {minted.map((row) => (
            <li key={row.value} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => openForm({ at: "posForm", value: row.value })}
                className={`${levelButton} flex-1`}
              >
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="font-mono text-sm text-content">{row.value}</span>
                  <span className="text-xs text-warning">{t("grammar.mintedBadge")}</span>
                </span>
                <span className="text-sm text-content">{row.label.short ?? row.label.long}</span>
              </button>
              {usageFor(posTag(row))}
            </li>
          ))}
        </ul>
        <AddRow
          placeholder={t("grammar.mintPosPlaceholder")}
          pattern={POS_VALUE_PATTERN}
          hint={t("grammar.mintPosHint")}
          onAdd={(value) => openForm({ at: "posForm", value })}
        />
      </>
    );
  }

  function renderFeatures() {
    const rows = sorted(grammaticalFeatureRows(draft), (row) => row.feature);
    return (
      <>
        <p className="mb-3 text-xs text-content-subtle">{t("grammar.featuresHint")}</p>
        {rows.length === 0 ? (
          <p className="text-sm text-content-muted">{t("grammar.featuresEmpty")}</p>
        ) : (
          <ul className="space-y-1.5">
            {rows.map((row) => (
              <li key={row.feature}>
                <button
                  type="button"
                  onClick={() => setPath({ at: "feature", feature: row.feature })}
                  className={levelButton}
                >
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="font-mono text-sm text-content">{row.feature}</span>
                    {row.scheme !== undefined && (
                      <span className="text-xs text-warning">{t("grammar.mintedBadge")}</span>
                    )}
                  </span>
                  <span className="text-xs text-content-subtle">
                    {t("grammar.valuesCount", { count: valueRows(draft, row.feature).length })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <Candidates
          title={t("grammar.udFeatures")}
          loading={udLoading}
          items={udFeatures
            .filter((row) => findFeature(draft, row.feature) === undefined)
            .map((row) => ({ key: row.feature, label: row.feature, hint: row.gloss }))}
          onPick={(feature) => openForm({ at: "featureForm", feature })}
        />
        <AddRow
          placeholder={t("grammar.addFeaturePlaceholder")}
          pattern={FEATURE_NAME_PATTERN}
          hint={t("grammar.addFeatureHint")}
          onAdd={(feature) => openForm({ at: "featureForm", feature })}
        />
      </>
    );
  }

  function renderFeature(feature: string) {
    const bound = findFeature(draft, feature);
    const values = valueRows(draft, feature);
    const url = featureDocUrl({ feature, scheme: bound?.scheme });
    const note = bound?.note?.trim() ?? "";
    return (
      <>
        <div className="mb-3">
          <p className="font-mono text-sm text-content">{feature}</p>
          {url !== null && (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-primary hover:text-primary-hover"
            >
              {t("grammar.udDocs")}
            </a>
          )}
          {/* The note is read here and edited one level down, with the label it
              belongs beside: it is what this feature covers *in this language*,
              which is the first thing a contributor arriving at the level needs
              and the last thing the record shows anywhere else — it is content,
              indexed nowhere, so this dialog is its only reader. */}
          {note !== "" && (
            <p className="mt-2 whitespace-pre-line text-xs text-content-muted">{note}</p>
          )}
        </div>
        <ul className="space-y-2">
          <li>
            <button
              type="button"
              onClick={() => openForm({ at: "featureForm", feature })}
              className={levelButton}
            >
              <span className="font-medium text-content">{t("grammar.bindName")}</span>
              <span className="text-sm text-content">
                {bound === undefined ? t("grammar.unbound") : (bound.label.short ?? bound.label.long)}
              </span>
            </button>
          </li>
          {/* The gate, as navigation: a feature's values cannot be reached
              until the feature name itself is bound. Nothing is disabled and
              no error is shown — the door is simply not there yet. */}
          {bound !== undefined && (
            <li>
              <button
                type="button"
                onClick={() => setPath({ at: "values", feature })}
                className={levelButton}
              >
                <span className="font-medium text-content">{t("grammar.valuesLevel")}</span>
                <span className="text-xs text-content-subtle">
                  {t("grammar.valuesCount", { count: values.length })}
                </span>
              </button>
            </li>
          )}
        </ul>
        {bound !== undefined && (
          <div className="mt-4 border-t pt-3">
            <button
              type="button"
              disabled={values.length > 0}
              title={values.length > 0 ? t("grammar.unbindBlocked") : undefined}
              onClick={() => {
                setDraft(removeFeature(draft, feature));
                // Back to the section that lists it, worked out from the row
                // rather than remembered: a lexicographic set says so, any
                // other minted feature is an inflection class, and a UD one
                // belongs with the features.
                setPath(
                  bound.lexicographic === true
                    ? { at: "lexical" }
                    : bound.scheme === undefined
                      ? { at: "features" }
                      : { at: "classes" },
                );
              }}
              className="text-sm text-danger hover:text-danger disabled:cursor-not-allowed disabled:opacity-50"
            >
              {bound.lexicographic === true
                ? t("grammar.unbindLexical")
                : t("grammar.unbindFeature")}
            </button>
            {values.length > 0 && (
              <p className="mt-1 text-xs text-content-subtle">{t("grammar.unbindBlocked")}</p>
            )}
          </div>
        )}
      </>
    );
  }

  function renderValues(feature: string) {
    const values = sorted(valueRows(draft, feature), (row) => row.value);
    // A minted feature's values are the members of an inflection class (or of
    // whatever else this language named): necessarily minted themselves, and
    // with nothing in UD to offer.
    const parent = findFeature(draft, feature);
    const minted = parent?.scheme !== undefined;
    const lexical = parent?.lexicographic === true;
    return (
      <>
        <p className="mb-3 text-xs text-content-subtle">
          {lexical
            ? t("grammar.lexicalValuesHint", { feature })
            : minted
              ? t("grammar.classValuesHint", { feature })
              : t("grammar.valuesHint", { feature })}
        </p>
        {values.length === 0 ? (
          <p className="text-sm text-content-muted">{t("grammar.valuesEmpty")}</p>
        ) : (
          <ul className="space-y-1.5">
            {values.map((row) => {
              const note = row.note?.trim() ?? "";
              return (
                <li key={row.value} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openForm({ at: "valueForm", feature, value: row.value })}
                    className={`${stackedLevelButton} flex-1`}
                  >
                    <span className="flex w-full items-center justify-between gap-3">
                      <span className="flex min-w-0 items-baseline gap-2">
                        <span className="font-mono text-sm text-content">
                          {feature}={row.value}
                        </span>
                        {/* Under a minted feature every value is minted, so the
                            badge would be on every row and say nothing. */}
                        {row.scheme !== undefined && !minted && (
                          <span className="text-xs text-warning">{t("grammar.mintedBadge")}</span>
                        )}
                      </span>
                      <span className="text-sm text-content">
                        {row.label.short ?? row.label.long}
                      </span>
                    </span>
                    {/* Clamped, not omitted: a set may run to hundreds of values
                        — an imported abbreviation list awaiting decisions does —
                        and the first two lines are what tells them apart while
                        triaging. The whole note is one click away, in the form. */}
                    {note !== "" && (
                      <span className="line-clamp-2 whitespace-pre-line text-xs text-content-subtle">
                        {note}
                      </span>
                    )}
                  </button>
                  {usageFor(valueTag(row))}
                </li>
              );
            })}
          </ul>
        )}
        {!minted && (
          <Candidates
            title={t("grammar.udValues")}
            loading={udLoading}
            items={udValues
              .filter((v) => findValue(draft, feature, v.value) === undefined)
              .map((v) => ({ key: v.value, label: v.value, hint: v.gloss }))}
            onPick={(value) => openForm({ at: "valueForm", feature, value })}
          />
        )}
        <AddRow
          placeholder={t("grammar.addValuePlaceholder")}
          pattern={FEATURE_VALUE_PATTERN}
          hint={t("grammar.addValueHint")}
          onAdd={(value) => openForm({ at: "valueForm", feature, value })}
        />
      </>
    );
  }

  // ---- layer 2 levels ---------------------------------------------------

  /**
   * The categories a language can walk into: every bound part of speech, and
   * every category already declared — so it can go deeper one step at a time
   * ({NOUN} → {NOUN, Gender=Fem} → its declension), each step standing on the
   * one before. The gate as navigation: an unbound category is not offered.
   */
  function renderL2Root() {
    const pos = posRows(draft);
    // Every declared category *beyond* the bare parts of speech above. A
    // POS-only category is legitimate, so it would otherwise be listed twice —
    // once as its part of speech and once as its own row.
    const posKeys = new Set(pos.map((row) => tagKey(posTag(row))));
    const declared = categoryRows(draft).filter((row) => !posKeys.has(tagKey(row.category)));
    const rows = sorted(
      [
        ...pos.map((row) => ({
          category: posTag(row),
          heading: row.label.short ?? row.label.long,
        })),
        ...declared.map((row) => ({ category: row.category, heading: categoryText(row.category) })),
      ],
      (row) => row.heading,
    );
    return (
      <>
        <p className="mb-3 text-xs text-content-subtle">{t("grammar.l2RootHint")}</p>
        {pos.length === 0 ? (
          <p className="text-sm text-content-muted">{t("grammar.l2NoPos")}</p>
        ) : (
          <ul className="space-y-1.5">
            {rows.map(({ category, heading }) => {
              const row = findCategory(draft, category);
              const below = descendantCategories(category).length;
              return (
                <li key={tagKey(category)} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPath({ at: "l2category", category })}
                    className={`${stackedLevelButton} min-w-0 flex-1`}
                  >
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-sm text-content">{heading}</span>
                      {/* The whole subtree, not the direct children: an
                          intermediate level nobody named still leads somewhere,
                          and a count of its children alone would read as an
                          empty branch (ADR-0020). */}
                      <span className="shrink-0 text-xs text-content-subtle">
                        {t("grammar.l2SubcategoryCount", { count: below })}
                      </span>
                    </span>
                    {row !== undefined && (
                      <span className="truncate text-xs text-content-subtle">
                        {row.label.short ?? row.label.long}
                      </span>
                    )}
                  </button>
                  {usageFor(category)}
                </li>
              );
            })}
          </ul>
        )}
      </>
    );
  }

  /**
   * One category, whole: what this dictionary calls it, and which features
   * define a headword of it.
   *
   * Two sections since ADR-0020, where there were three. The one that went was
   * "what its forms vary over": a language cannot draw that line — Breton's
   * *anv-kadarn stroll* is identified by the plural it is cited in and inflects
   * for number all the same — so the paradigm's tables say which cells exist,
   * and this level asks only what a headword of this category is and what to
   * call it.
   */
  function renderL2Category(category: Tag) {
    const row = findCategory(draft, category);
    const declared = sorted(inherentRows(draft, category), (r) => r.feature);
    const declaredNames = new Set(declared.map((r) => r.feature));
    // Lexicographic label sets are absent rather than disabled — the gate as
    // navigation. "Archaic" is not something a word *is*, so it never defines a
    // headword of anything.
    const available = sorted(
      grammaticalFeatureRows(draft).filter((r) => !declaredNames.has(r.feature)),
      (r) => r.feature,
    );
    // On the shallowest level the row shown here IS the `pos` row: a bare part
    // of speech has no category row and must not grow one, so the name and the
    // note a contributor writes are the same ones Primitives shows (`barePos`).
    const bare = barePos(category);
    const named = bare !== undefined ? findPos(draft, bare) : row;
    const note = named?.note?.trim() ?? "";

    return (
      <>
        <div className="mb-3">
          <p className="text-sm font-medium text-content">{categoryText(category)}</p>
          <p className="mt-0.5 font-mono text-xs text-content-subtle">
            {formatTagVerbatim(category)}
          </p>
        </div>

        <p className="text-xs font-medium text-content">{t("grammar.l2NamesTitle")}</p>
        <p className="mt-0.5 text-xs text-content-subtle">{t("grammar.l2NamesHint")}</p>
        {bare !== undefined && (
          <p className="mt-1 text-xs text-content-subtle">{t("grammar.l2NamesPosHint")}</p>
        )}
        {named === undefined ? (
          <>
            <p className="mt-2 text-sm text-content-muted">{t("grammar.l2NoName")}</p>
            <button
              type="button"
              onClick={() => openForm({ at: "l2categoryForm", category })}
              className="mt-2 text-sm text-primary hover:text-primary-hover"
            >
              {t("grammar.l2AddName")}
            </button>
          </>
        ) : (
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => openForm({ at: "l2categoryForm", category })}
              className={`${stackedLevelButton} min-w-0 flex-1`}
            >
              <span className="flex w-full items-baseline justify-between gap-3">
                <span className="truncate text-sm text-content">
                  {named.label.short ?? named.label.long}
                </span>
                {named.label.short !== undefined && (
                  <span className="truncate text-xs text-content-subtle">{named.label.long}</span>
                )}
              </span>
              {note !== "" && (
                <span className="line-clamp-2 whitespace-pre-line text-xs text-content-subtle">
                  {note}
                </span>
              )}
            </button>
            {usageFor(category)}
          </div>
        )}

        <div className="mt-4 border-t pt-3">
          <p className="text-xs font-medium text-content">{t("grammar.l2InherentTitle")}</p>
          <p className="mt-0.5 text-xs text-content-subtle">{t("grammar.l2CategoryHint")}</p>
          {declared.length === 0 ? (
            <p className="mt-2 text-sm text-content-muted">{t("grammar.l2NoInherent")}</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {declared.map((inherent) => {
                // Withdrawing is blocked while any category below stands on this
                // declaration — the same disabled-with-a-reason pattern as
                // unbinding a feature name whose values are bound. Counted over
                // the whole subtree, since a grandchild is grounded through this
                // row exactly as a child is.
                const below = descendantCategories(category, inherent.feature).length;
                return (
                  <li key={inherent.feature} className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setPath({ at: "l2feature", category, feature: inherent.feature })
                      }
                      className={`${levelButton} min-w-0 flex-1`}
                    >
                      <span className="flex min-w-0 items-baseline gap-2">
                        <span className="font-mono text-sm text-content">{inherent.feature}</span>
                        <span className="truncate text-xs text-content-subtle">
                          {findFeature(draft, inherent.feature)?.label.long}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-content-subtle">
                        {t("grammar.l2SubcategoryCount", { count: below })}
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={below > 0}
                      title={below > 0 ? t("grammar.l2WithdrawBlocked") : undefined}
                      onClick={() => setDraft(removeInherent(draft, inherent))}
                      aria-label={t("grammar.l2Withdraw", { feature: inherent.feature })}
                      className="text-content-subtle hover:text-danger disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {available.length > 0 && (
            <>
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {available.map((feature) => (
                  <li key={feature.feature}>
                    <button
                      type="button"
                      onClick={() =>
                        setDraft(addInherent(draft, { category, feature: feature.feature }))
                      }
                      title={feature.label.long}
                      className={chipButton}
                    >
                      + {feature.feature}
                    </button>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-content-subtle">{t("grammar.l2DeclareHint")}</p>
            </>
          )}
        </div>
      </>
    );
  }

  /**
   * The enumeration prompt: one category per bound value of the feature. A
   * counter, never a constraint — an incomplete set is legitimate (a language
   * may bind a value for another category's sake) and nothing here blocks a
   * save.
   *
   * Every row opens that category's editor rather than a naming form, which is
   * what makes the walk go as deep as the declarations do: a level nobody has
   * named is still a level, and in a real tree it usually is unnamed — no
   * Breton word is ever *just* a singular noun.
   */
  function renderL2Feature(category: Tag, feature: string) {
    const values = sorted(valueRows(draft, feature), (row) => row.value);
    const named = values.filter(
      (value) => findCategory(draft, combinationTag(category, value)) !== undefined,
    ).length;
    return (
      <>
        <p className="mb-3 text-xs text-content-subtle">
          {t("grammar.l2FeatureHint", {
            feature,
            category: categoryText(category),
            bound: named,
            total: values.length,
          })}
        </p>
        {values.length === 0 ? (
          <p className="text-sm text-content-muted">{t("grammar.l2NoValues", { feature })}</p>
        ) : (
          <ul className="space-y-1.5">
            {values.map((value) => {
              const combination = combinationTag(category, value);
              const bound = findCategory(draft, combination);
              const below = descendantCategories(combination).length;
              return (
                <li key={tagKey(combination)} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPath({ at: "l2category", category: combination })}
                    className={`${levelButton} min-w-0 flex-1`}
                  >
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="text-sm text-content">{categoryText(combination)}</span>
                      <span className="truncate font-mono text-xs text-content-subtle">
                        {formatTagVerbatim(combination)}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-content-subtle">
                      {below > 0
                        ? t("grammar.l2SubcategoryCount", { count: below })
                        : bound === undefined
                          ? t("grammar.l2Decomposed")
                          : (bound.label.short ?? bound.label.long)}
                    </span>
                  </button>
                  {usageFor(combination)}
                </li>
              );
            })}
          </ul>
        )}
      </>
    );
  }

  // ---- layer 5 -----------------------------------------------------------

  /**
   * The language's paradigms: one row per record, naming every headword
   * category it serves, plus the door to a new one.
   *
   * A flat list and not a tree, which is the shape ADR-0019 left it. This level
   * used to be reached through the layouts — one door per table the *language*
   * drew — and a paradigm's selector was picked from the combinations falling
   * under that layout. Both are gone: the table moved into the paradigm record,
   * and a selector is now a headword category matched exactly, so a paradigm no
   * longer hangs under anything. Editing one opens its own dialog, because it is
   * its own record with its own publish footer (see `ParadigmEditorDialog`).
   */
  function renderL5Root() {
    return (
      <>
        <p className="mb-3 text-xs text-content-subtle">{t("grammar.l5RootHint")}</p>
        <button
          type="button"
          onClick={() => setEditing({})}
          className="rounded-lg border px-3 py-2 text-sm text-content hover:border-primary"
        >
          {t("grammar.l5New")}
        </button>
        {syncing !== null && (
          <p className="mt-3 text-xs text-content-subtle">{t("grammar.l5Syncing")}</p>
        )}
        {paradigms.length === 0 ? (
          <p className="mt-3 text-sm text-content-muted">{t("grammar.l5Empty")}</p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {paradigms.map((row) => (
              <li key={row.paradigmKey}>
                <button
                  type="button"
                  onClick={() => setEditing({ pointer: row })}
                  className={levelButton}
                >
                  <span className="text-sm text-content">
                    {row.selectors.map((selector) => categoryText(selector)).join(" · ")}
                  </span>
                  <span className="font-mono text-xs text-content-subtle">
                    {row.selectors.map((selector) => formatTagVerbatim(selector)).join(" · ")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }
  /**
   * The category form: what this dictionary calls a headword of this category,
   * and what a contributor should know before choosing it.
   *
   * Separate from `renderForm` for the reason the abbreviation form is: nothing
   * it asks is the same. A category is never minted — provenance rides on its
   * atoms, each already bound with its own scheme — and documents no source, so
   * the whole mint section is absent.
   */
  function renderCategoryForm(category: Tag) {
    // Removable only where there is a category row to remove. On the shallowest
    // level this form edits the `pos` row (`barePos`), and unbinding a part of
    // speech is a different act with a different blast radius — it belongs
    // under Primitives, beside the values that would be orphaned by it.
    const existing = barePos(category) === undefined ? findCategory(draft, category) : undefined;
    return (
      <>
        <div className="mb-3">
          <p className="text-sm font-medium text-content">{categoryText(category)}</p>
          <p className="mt-0.5 font-mono text-xs text-content-subtle">
            {formatTagVerbatim(category)}
          </p>
        </div>

        <label className="block text-sm font-medium text-content" htmlFor="grammar-category-long">
          {t("grammar.longLabel")}
        </label>
        <p className="mt-0.5 text-xs text-content-subtle">{t("grammar.homolingualHint")}</p>
        <input
          id="grammar-category-long"
          value={form.long}
          onChange={(e) => setForm({ ...form, long: e.target.value })}
          placeholder={t("grammar.longPlaceholder")}
          className={`${inputClass} mt-1`}
        />

        <label
          className="mt-3 block text-sm font-medium text-content"
          htmlFor="grammar-category-short"
        >
          {t("grammar.shortLabel")}
        </label>
        <input
          id="grammar-category-short"
          value={form.short}
          onChange={(e) => setForm({ ...form, short: e.target.value })}
          placeholder={t("grammar.shortPlaceholder")}
          className={`${inputClass} mt-1`}
        />

        <NoteField form={form} setForm={setForm} hint={t("grammar.categoryNoteHint")} />

        {existing !== undefined && (
          <div className="mt-4 border-t pt-3">
            <button
              type="button"
              onClick={() => {
                setDraft(removeCategory(draft, category));
                setPath({ at: "l2category", category });
              }}
              className="text-sm text-danger hover:text-danger"
            >
              {t("grammar.l2RemoveName")}
            </button>
          </div>
        )}
      </>
    );
  }

  /**
   * The abbreviation form: what a row prints, what it stands for, and when to
   * reach for it.
   *
   * Separate from `renderForm` rather than a mode of it, because nothing it
   * asks is the same. There is no minting question (the only possible
   * provenance is this language) and the delete offered is a removal from a
   * list rather than an unbinding of a tag. Its identity came in with the path
   * and is shown, not edited: editing it would be writing a different row —
   * which is exactly why the printed form beside it is editable (ADR-0020).
   */
  function renderAbbreviationForm(value: string) {
    const existing = findAbbreviation(draft, value);
    return (
      <>
        <p className="mb-3 font-mono text-xs text-content-subtle">{value}</p>

        <label className="block text-sm font-medium text-content" htmlFor="grammar-abbr-short">
          {t("grammar.abbreviationShortLabel")}
        </label>
        <p className="mt-0.5 text-xs text-content-subtle">{t("grammar.abbreviationShortHint")}</p>
        <input
          id="grammar-abbr-short"
          value={form.short}
          onChange={(e) => setForm({ ...form, short: e.target.value })}
          placeholder={t("grammar.addAbbreviationPlaceholder")}
          className={`${inputClass} mt-1`}
        />

        <label
          className="mt-3 block text-sm font-medium text-content"
          htmlFor="grammar-abbr-long"
        >
          {t("grammar.abbreviationLongLabel")}
        </label>
        <p className="mt-0.5 text-xs text-content-subtle">{t("grammar.homolingualHint")}</p>
        <input
          id="grammar-abbr-long"
          value={form.long}
          onChange={(e) => setForm({ ...form, long: e.target.value })}
          placeholder={t("grammar.longPlaceholder")}
          className={`${inputClass} mt-1`}
        />

        <NoteField form={form} setForm={setForm} hint={t("grammar.abbreviationNoteHint")} />

        {existing !== undefined && (
          <div className="mt-4 border-t pt-3">
            <button
              type="button"
              onClick={() => {
                setDraft(removeAbbreviation(draft, value));
                setPath({ at: "abbreviations" });
              }}
              className="text-sm text-danger hover:text-danger"
            >
              {t("grammar.removeAbbreviation")}
            </button>
          </div>
        )}
      </>
    );
  }

  function renderForm() {
    const subject =
      path.at === "posForm"
        ? path.value
        : path.at === "featureForm"
          ? path.feature
          : path.at === "valueForm"
            ? `${path.feature}=${path.value}`
            : "";
    const gloss = path.at === "posForm" ? uposGloss(path.value) : undefined;
    const docs =
      path.at === "posForm" && !form.minted
        ? uposDocUrl({ value: path.value })
        : path.at === "featureForm" && !form.minted
          ? featureDocUrl({ feature: path.feature })
          : null;
    const existing =
      path.at === "posForm"
        ? findPos(draft, path.value)
        : path.at === "featureForm"
          ? findFeature(draft, path.feature)
          : path.at === "valueForm"
            ? findValue(draft, path.feature, path.value)
            : undefined;
    const isUdPos = path.at === "posForm" && HEADWORD_UPOS.some((u) => u.value === path.value);
    const mintable = !isUdPos;

    return (
      <>
        <div className="mb-3">
          <p className="font-mono text-sm text-content">{subject}</p>
          {gloss !== undefined && <p className="text-xs text-content-subtle">{gloss}</p>}
          {docs !== null && (
            <a
              href={docs}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-primary hover:text-primary-hover"
            >
              {t("grammar.udDocs")}
            </a>
          )}
        </div>

        <label className="block text-sm font-medium text-content" htmlFor="grammar-long">
          {t("grammar.longLabel")}
        </label>
        <p className="mt-0.5 text-xs text-content-subtle">{t("grammar.homolingualHint")}</p>
        <input
          id="grammar-long"
          value={form.long}
          onChange={(e) => setForm({ ...form, long: e.target.value })}
          placeholder={t("grammar.longPlaceholder")}
          className={`${inputClass} mt-1`}
        />

        <label className="mt-3 block text-sm font-medium text-content" htmlFor="grammar-short">
          {t("grammar.shortLabel")}
        </label>
        <input
          id="grammar-short"
          value={form.short}
          onChange={(e) => setForm({ ...form, short: e.target.value })}
          placeholder={t("grammar.shortPlaceholder")}
          className={`${inputClass} mt-1`}
        />

        {/* The note sits with the two label fields and OUTSIDE the mint box,
            because it answers a different question from both. A reference is
            gated on minting since UD's extension licence is what makes a source
            obligatory there; explaining what a feature covers in this language
            is wanted whether or not the name was minted — and the borrowed name
            is often exactly the case that needs it, since a language's Case is
            never quite UD's. */}
        {notable(path) && <NoteField form={form} setForm={setForm} hint={t("grammar.noteHint")} />}

        {/* Minting is a deliberate act, not a fallback: it is offered only
            where a contributor can see that nothing in UD fits, and it asks
            for a source, since UD's extension licence is conditional on the
            addition being documented. */}
        {mintable && (
          <div className="mt-4 rounded-lg border bg-surface-muted/40 p-3">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1"
                checked={form.minted}
                onChange={(e) => setForm({ ...form, minted: e.target.checked })}
              />
              <span>
                <span className="text-sm text-content">{t("grammar.mintLabel", { tag })}</span>
                <span className="mt-0.5 block text-xs text-content-subtle">
                  {t("grammar.mintHint")}
                </span>
              </span>
            </label>
            {form.minted && (
              <div className="mt-3 space-y-2">
                <p className="text-xs font-medium text-content">{t("grammar.referencesLabel")}</p>
                {form.references.map((ref, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      value={ref.text}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          references: form.references.map((r, j) =>
                            j === i ? { ...r, text: e.target.value } : r,
                          ),
                        })
                      }
                      placeholder={t("grammar.referenceTextPlaceholder")}
                      className={inputClass}
                    />
                    <input
                      value={ref.url ?? ""}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          references: form.references.map((r, j) =>
                            j === i ? { ...r, url: e.target.value } : r,
                          ),
                        })
                      }
                      placeholder={t("grammar.referenceUrlPlaceholder")}
                      className={inputClass}
                    />
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setForm({ ...form, references: [...form.references, { text: "" }] })}
                  className="text-xs text-primary hover:text-primary-hover"
                >
                  {t("grammar.addReference")}
                </button>
              </div>
            )}
          </div>
        )}

        {/* The Bind button is the footer's, not this panel's (ADR-0020): one
            primary action at a time, where the form's own button used to scroll
            out of sight above a Publish that discarded it. What stays here is
            the destructive one, which belongs beside what it destroys. */}
        {existing !== undefined && (
          <div className="mt-4 border-t pt-3">
            <button
              type="button"
              onClick={() => {
                if (path.at === "posForm") {
                  setDraft(removePos(draft, path.value));
                  setPath({ at: "pos" });
                } else if (path.at === "valueForm") {
                  setDraft(removeValue(draft, path.feature, path.value));
                  setPath({ at: "values", feature: path.feature });
                }
              }}
              className="text-sm text-danger hover:text-danger"
            >
              {t("grammar.unbind")}
            </button>
          </div>
        )}
      </>
    );
  }

  function renderLevel() {
    switch (path.at) {
      case "root":
        return renderRoot();
      case "pos":
        return renderPos();
      case "features":
        return renderFeatures();
      case "classes":
        return renderClasses();
      case "lexical":
        return renderLexical();
      case "abbreviations":
        return renderAbbreviations();
      case "abbreviationForm":
        return renderAbbreviationForm(path.value);
      case "feature":
        return renderFeature(path.feature);
      case "values":
        return renderValues(path.feature);
      case "l2root":
        return renderL2Root();
      case "l2category":
        return renderL2Category(path.category);
      case "l2feature":
        return renderL2Feature(path.category, path.feature);
      case "l2categoryForm":
        return renderCategoryForm(path.category);
      case "l5root":
        return renderL5Root();
      default:
        return renderForm();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="grammar-binding-title"
    >
      {/* Full height on a phone, where the sheet IS the screen and a gap under
          it wastes the only rows a contributor has; a fixed tall panel above
          that, so a laptop shows a working list rather than a card sized to
          whatever the shortest level happens to hold. The cap keeps a very tall
          monitor from stretching one column of rows over 1200px. */}
      <div className="flex h-[100dvh] w-full flex-col overflow-hidden rounded-t-xl border bg-surface shadow-lg sm:h-[calc(100dvh-2rem)] sm:max-h-[54rem] sm:max-w-2xl sm:rounded-xl">
        <header className="border-b bg-surface-muted/60 px-4 py-3 sm:px-5">
          <h2 id="grammar-binding-title" className="text-base font-semibold text-content">
            {t("grammar.title")}
          </h2>
          <p className="mt-1 text-sm text-content-muted">{t("grammar.intro")}</p>
          {/* One tab per layer; switching tabs re-enters that layer at its
              root. The draft is shared — both tabs edit the same record. */}
          <div className="mt-3 flex gap-2" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "primitives"}
              onClick={() => setPath({ at: "root" })}
              className={
                tab === "primitives"
                  ? "rounded-full border border-primary bg-surface px-3 py-1 text-xs font-medium text-primary"
                  : "rounded-full border px-3 py-1 text-xs text-content-subtle hover:border-primary hover:text-primary"
              }
            >
              {t("grammar.tabPrimitives")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "categories"}
              onClick={() => setPath({ at: "l2root" })}
              className={
                tab === "categories"
                  ? "rounded-full border border-primary bg-surface px-3 py-1 text-xs font-medium text-primary"
                  : "rounded-full border px-3 py-1 text-xs text-content-subtle hover:border-primary hover:text-primary"
              }
            >
              {t("grammar.tabCategories")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "paradigms"}
              onClick={() => setPath({ at: "l5root" })}
              className={
                tab === "paradigms"
                  ? "rounded-full border border-primary bg-surface px-3 py-1 text-xs font-medium text-primary"
                  : "rounded-full border px-3 py-1 text-xs text-content-subtle hover:border-primary hover:text-primary"
              }
            >
              {t("grammar.tabParadigms")}
            </button>
          </div>
        </header>

        {loading ? (
          <p className="p-5 text-sm text-content-muted">{t("grammar.loading")}</p>
        ) : record === null ? (
          <p className="p-5 text-sm text-content-muted">{t("grammar.recordUnavailable")}</p>
        ) : (
          <>
            <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
              <nav className="shrink-0 border-b px-4 py-3 sm:w-48 sm:border-b-0 sm:border-r sm:px-4">
                <ol className="flex flex-wrap gap-x-2 gap-y-1 sm:block sm:space-y-1">
                  {crumbs.map((crumb, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        onClick={() => setPath(crumb.go)}
                        title={crumb.title}
                        className={`text-left text-sm ${
                          i === crumbs.length - 1
                            ? "font-medium text-content"
                            : "text-content-subtle hover:text-primary"
                        }`}
                        // Capped, because the trail is now the whole line of
                        // descent: four rungs of indent already read as depth,
                        // and eight would leave a deep category's own rung a
                        // sliver wide in a 12rem sidebar.
                        style={{ paddingLeft: `${Math.min(i, 4) * 0.4}rem` }}
                      >
                        {crumb.label}
                      </button>
                    </li>
                  ))}
                </ol>
              </nav>
              <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">{renderLevel()}</div>
            </div>

            <footer className="border-t px-4 py-3 sm:px-5">
              {/* Said once, in the one place the consequence lands: this
                  language was declared under an older shape of the lexicon, so
                  the draft above is a forward-mapping of its record and
                  publishing is what commits it. */}
              {carriesLegacyGrammar(record.grammar) && (
                <p className="mb-2 text-sm text-content-muted">{t("grammar.migrated")}</p>
              )}
              {defects.length > 0 && (
                <div className="mb-2 text-sm text-danger">
                  <p>{t("grammar.errors.defects")}</p>
                  <ul className="mt-1 space-y-0.5">
                    {defects.map((issue, i) => (
                      <li key={i} className="font-mono text-xs">
                        {/* One case per kind, rather than a two-branch test: a
                            later layer adding a kind must produce copy of its
                            own, not silently inherit another kind's. */}
                        {t(`grammar.issue.${issue.kind}`, {
                          key: issue.key,
                          feature: issue.feature ?? "",
                          atom: issue.atom ?? "",
                        })}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {error !== null && <p className="mb-2 text-sm text-danger">{error}</p>}
              {/* **Bind replaces Publish while a row is being edited**
                  (ADR-0020). The two used to sit here together, and a form's own
                  Bind button scrolled out of sight in the panel above, so the
                  ordinary way to lose an edit was to type it and then press the
                  button that was still in front of you. One primary action, and
                  on a form level it is the one that keeps what is on screen. */}
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={submitting}
                  className="rounded-lg border px-4 py-2 text-sm text-content hover:bg-black/5"
                >
                  {t("grammar.cancel")}
                </button>
                {isFormLevel(path) ? (
                  <button
                    type="button"
                    onClick={saveForm}
                    disabled={!formComplete}
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-fg hover:bg-primary-hover disabled:opacity-50"
                  >
                    {t("grammar.bind")}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void onPublish()}
                    disabled={submitting || !dirty || defects.length > 0 || !agent}
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-fg hover:bg-primary-hover disabled:opacity-50"
                  >
                    {submitting ? t("grammar.publishing") : t("grammar.publish")}
                  </button>
                )}
              </div>
            </footer>
          </>
        )}
      </div>

      {/* A paradigm is a different record, so it gets a different dialog —
          stacked above this one, publishing on its own. The grammar draft
          behind it is untouched by anything that happens in there. */}
      {editing !== null && (
        <ParadigmEditorDialog
          // Keyed on the paradigm, so opening another one — including the
          // published record a colliding identity sends the author to —
          // remounts rather than reusing a draft loaded for a different record.
          key={editing.pointer?.paradigmKey ?? "new"}
          tag={tag}
          grammar={savedGrammar}
          lookup={savedLookup}
          pointers={paradigms}
          {...(editing.pointer !== undefined ? { existing: editing.pointer } : {})}
          onOpenExisting={(pointer) => setEditing({ pointer })}
          onClose={() => setEditing(null)}
          onPublished={(paradigmKey) => {
            setEditing(null);
            // Only a *new* paradigm is worth waiting for. A rewrite keeps its
            // identity, so its row is already in this list and nothing visible
            // changes when the new version lands — a notice about it would be a
            // notice about nothing.
            setSyncing(
              paradigms.some((row) => row.paradigmKey === paradigmKey) ? null : paradigmKey,
            );
          }}
        />
      )}
    </div>
  );
}

const levelButton =
  "flex w-full items-center justify-between gap-3 rounded-lg border bg-surface px-3 py-2 text-left hover:border-primary";

/**
 * A pickable option: one of a small set where the choice itself is the control,
 * rather than a level to walk into.
 */
const chipButton =
  "rounded-full border bg-surface-muted/60 px-2.5 py-1 font-mono text-xs text-content hover:border-primary hover:text-primary";

/**
 * The same row with its content stacked, for a level whose rows carry a note
 * under their label. A separate constant rather than `levelButton` plus an
 * override, because `items-center` and `items-stretch` are utilities of equal
 * specificity: which one won would depend on Tailwind's emission order, not on
 * the order they are written in the class attribute.
 */
const stackedLevelButton =
  "flex w-full flex-col items-stretch gap-1 rounded-lg border bg-surface px-3 py-2 text-left hover:border-primary";

/**
 * What the entries did with a row, shown beside the row that declares it: how
 * many of them carry the tag, and one of those, drawn at random.
 *
 * The count rides along with the labels response the dialog already loaded. The
 * **example is fetched on demand**, one request per click — a values level can
 * run to hundreds of rows (an imported abbreviation list awaiting a decision
 * each does exactly that), and pre-fetching an example for every one of them
 * would be hundreds of requests nobody asked for.
 *
 * Two things it deliberately does not do. It says nothing at zero, because in a
 * young dictionary most rows are at zero and printing it on each would bury the
 * counts that mean something — the dashboard's shelf prints them because there
 * every row is a declaration. And it opens the entry in a **new tab**: this
 * dialog holds an unpublished draft, so following a link in place would throw
 * away the contributor's work to answer a question they asked *about* that work.
 *
 * It describes the **indexed** grammar, never the draft: a row added in this
 * session has no usage until it is published and comes back round the firehose.
 */
function Usage({ languageTag, tag, count }: { languageTag: string; tag: Tag; count: number }) {
  const { t } = useTranslation();
  const [sample, setSample] = useState<LabelSample | null>(null);
  const [loading, setLoading] = useState(false);
  /**
   * How the last draw went, when it did not produce a word.
   *
   * `empty` and `failed` are worth telling apart even though both end in no
   * link: the count comes from a response fetched when the dialog opened, so a
   * row can say ×3 and have nothing left to show — every one of them withdrawn
   * since, or reindexed under another tag. Collapsing that into "could not
   * reach the index" would blame the network for the truth, and collapsing it
   * the other way would tell a contributor their tag is unused when the
   * request simply failed. A click that produced neither a word nor a reason
   * would be worse than both.
   */
  const [outcome, setOutcome] = useState<"idle" | "empty" | "failed">("idle");

  function roll() {
    setLoading(true);
    setOutcome("idle");
    fetchLabelSample(languageTag, tagKey(tag))
      .then((drawn) => {
        setSample(drawn);
        if (drawn === null) setOutcome("empty");
      })
      .catch((err: unknown) => {
        console.error("could not sample an entry for a label row:", err);
        setOutcome("failed");
      })
      .finally(() => setLoading(false));
  }

  if (count === 0) return null;
  const action = sample === null ? t("grammar.usageSample") : t("grammar.usageReroll");
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-xs">
      <span className="text-content-subtle" title={t("grammar.usageCount", { count })}>
        ×{count}
      </span>
      {sample !== null && (
        <a
          href={entryPath(sample.key)}
          target="_blank"
          rel="noopener noreferrer"
          title={sample.orthography}
          className="max-w-[7rem] truncate text-primary hover:text-primary-hover"
        >
          {sample.orthography}
        </a>
      )}
      {/* Announced, because the failure of a draw is otherwise invisible to a
          reader who cannot see that the word beside the button did not change
          — and after a successful draw, that word is still there. */}
      {/* Present even when it says nothing — a live region has to exist before
          its content changes to be announced — but taken out of the flow while
          idle, or the flex gap would leave a hole beside every row. */}
      <span
        role="status"
        aria-live="polite"
        className={outcome === "idle" ? "sr-only" : "text-content-subtle"}
      >
        {outcome === "idle"
          ? ""
          : outcome === "empty"
            ? t("grammar.usageSampleEmpty")
            : t("grammar.usageSampleFailed")}
      </span>
      <button
        type="button"
        onClick={roll}
        disabled={loading}
        title={action}
        aria-label={action}
        className="text-content-subtle hover:text-primary disabled:opacity-50"
      >
        ↻
      </button>
    </span>
  );
}

/**
 * The free-prose field four of the five forms carry: what this row covers in
 * this language, and where its border with a neighbour falls.
 *
 * One component rather than a block repeated per form, because the field is
 * literally the same one — same label, same textarea, same "blank means
 * absent" contract on save — and only the sentence under the label differs,
 * since what is worth explaining about a feature is not what is worth
 * explaining about an abbreviation.
 */
function NoteField({
  form,
  setForm,
  hint,
}: {
  form: LabelDraft;
  setForm: (draft: LabelDraft) => void;
  hint: string;
}) {
  const { t } = useTranslation();
  return (
    <>
      <label className="mt-3 block text-sm font-medium text-content" htmlFor="grammar-note">
        {t("grammar.noteLabel")}
      </label>
      <p className="mt-0.5 text-xs text-content-subtle">{hint}</p>
      <textarea
        id="grammar-note"
        value={form.note}
        onChange={(e) => setForm({ ...form, note: e.target.value })}
        placeholder={t("grammar.notePlaceholder")}
        rows={3}
        className={`${inputClass} mt-1 resize-y`}
      />
    </>
  );
}

/**
 * What UD currently documents, offered so a contributor picks instead of
 * typing. Already-bound items are filtered out by the caller, so the list is
 * a worklist of what is still available.
 *
 * When the fetch fails the list is empty and **nothing is rendered** — no
 * error, no retry prompt. The manual field below is the real path and is
 * always present; suggestions are a convenience layered on top of it.
 */
function Candidates({
  title,
  loading,
  items,
  onPick,
}: {
  title: string;
  loading: boolean;
  items: { key: string; label: string; hint?: string }[];
  onPick: (value: string) => void;
}) {
  const { t } = useTranslation();
  if (loading) {
    return <p className="mt-4 text-xs text-content-subtle">{t("grammar.udLoading")}</p>;
  }
  if (items.length === 0) return null;
  return (
    <div className="mt-4 border-t pt-3">
      <p className="text-xs font-medium text-content">{title}</p>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {items.map((item) => (
          <li key={item.key}>
            <button
              type="button"
              onClick={() => onPick(item.key)}
              title={item.hint}
              className="rounded-full border bg-surface-muted/60 px-2.5 py-1 font-mono text-xs text-content hover:border-primary hover:text-primary"
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The "add an item nobody has bound yet" row. Validates against the shape UD
 * requires before letting a name through, so a typo becomes visible here
 * rather than as an unrenderable tag later.
 */
function AddRow({
  placeholder,
  pattern,
  hint,
  onAdd,
}: {
  placeholder: string;
  /**
   * The shape the identifier must take. Omitted where there is no shape to
   * require — no caller does so today: since ADR-0020 even an abbreviation is
   * added under an identifier, and the printed form it stands for ("udb.",
   * "s.o.") is written on the form the row opens.
   */
  pattern?: RegExp;
  hint: string;
  onAdd: (value: string) => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const trimmed = value.trim();
  const valid = trimmed !== "" && (pattern === undefined || pattern.test(trimmed));
  return (
    <div className="mt-4 border-t pt-3">
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          className={inputClass}
        />
        <button
          type="button"
          disabled={!valid}
          onClick={() => {
            onAdd(value.trim());
            setValue("");
          }}
          className="shrink-0 rounded-lg border px-3 py-2 text-sm text-content hover:border-primary disabled:opacity-50"
        >
          {t("grammar.add")}
        </button>
      </div>
      <p className="mt-1 text-xs text-content-subtle">{hint}</p>
    </div>
  );
}
