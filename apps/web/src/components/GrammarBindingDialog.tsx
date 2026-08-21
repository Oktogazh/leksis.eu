import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  grammarIssues,
  grammarLookup,
  featureDocUrl,
  formatTagVerbatim,
  posTag,
  resolveTag,
  tagKey,
  uposDocUrl,
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
import { entryPath } from "../lib/routes";
import {
  abbreviationRows,
  addInherent,
  carriesRetiredGrammar,
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
  posRows,
  removeAbbreviation,
  removeAnnotation,
  removeFeature,
  removeInherent,
  removePos,
  removeValue,
  setCategoryAxis,
  upsertAbbreviation,
  upsertAnnotation,
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
 * Where a category was reached from, kept for the breadcrumb trail alone.
 *
 * The category itself is the whole of a level's identity — a bundle names one
 * thing however it was arrived at — so this is display state, never a key: two
 * routes to `{NOUN, Gender=Masc}` open the same editor on the same row.
 */
interface L2Origin {
  category: Tag;
  feature: string;
}

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
  // to open, because it is not a set of options — it is one shallow row whose
  // short form is its identity.
  | { at: "abbreviations" }
  | { at: "abbreviationForm"; short: string }
  // Layer 2 — one level per category, and since ADR-0019 that level is the
  // category's own editor: which feature its forms vary over, and the
  // abbreviation(s) naming its headword flavours. `l2feature` is the
  // enumeration prompt under an inherent feature, and each of its rows leads to
  // another category's editor — which is what lets the walk go as deep as the
  // language's declarations do without anything having to be named on the way
  // down. (Before the merge it led to a naming form instead, so a combination
  // had to be named before it could be refined.)
  | { at: "l2root" }
  | { at: "l2category"; category: Tag; from?: L2Origin }
  | { at: "l2feature"; category: Tag; feature: string }
  | { at: "l2annotationForm"; category: Tag; index: number; from?: L2Origin }
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
  /**
   * The axis value a category's headwords sit at, on the annotation form alone
   * — bare, as the record stores it, and empty where nothing is picked.
   *
   * Carried on the one draft shape for the reason `note` is: the form state is
   * one object and each level writes back only the fields its rows have. What
   * makes this one different is that "empty" is a *reportable* state rather
   * than an absent optional — a category naming an axis owes every annotation a
   * default, and `grammarIssues` says so.
   */
  defaultValue: string;
}

const emptyLabel: LabelDraft = {
  long: "",
  short: "",
  minted: false,
  references: [],
  note: "",
  defaultValue: "",
};

/** The two levels whose rows carry a note — features and their values. */
function notable(path: Path): boolean {
  return path.at === "featureForm" || path.at === "valueForm";
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
  /** The stacked editor: which selector it was opened on. */
  const [editing, setEditing] = useState<{ selector: Tag } | null>(null);
  /**
   * An axis picked for a category **nobody has named yet**, held here until the
   * first annotation carries it into the draft.
   *
   * A declaration is carried by its annotations — the lexicon requires at least
   * one — so there is no row for an axis to live on before the category has a
   * name, and writing an annotation-less row would put a shape the AppView
   * refuses into the draft with nothing in the footer to say so. The authoring
   * order is still the one on screen (the bundle, then what its forms vary
   * over, then the name); only the *storage* waits. Keyed by the category so it
   * cannot leak onto another one, and dropped the moment it is written.
   */
  const [pendingAxis, setPendingAxis] = useState<{ key: string; axis: string } | null>(null);
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

  /** Seed the binding form whenever a form level is opened. */
  function openForm(next: Path) {
    let existing;
    if (next.at === "posForm") existing = findPos(draft, next.value);
    else if (next.at === "featureForm") existing = findFeature(draft, next.feature);
    else if (next.at === "valueForm") existing = findValue(draft, next.feature, next.value);
    else if (next.at === "l2annotationForm") {
      // One annotation of a category — the labelled tag itself, since ADR-0019
      // put the label on the annotation rather than on the row. An index past
      // the end is a new one, which is how "add another abbreviation" and
      // "edit this one" reach the same form.
      const annotation = findCategory(draft, next.category)?.annotations[next.index];
      setForm({
        ...emptyLabel,
        long: annotation?.long ?? "",
        short: annotation?.short ?? "",
        defaultValue: annotation?.default ?? "",
      });
      setPath(next);
      return;
    }
    else if (next.at === "abbreviationForm") {
      // An abbreviation has no tag and so no label pair to seed from: its short
      // form came in through the path and only the expansion is being written.
      const row = findAbbreviation(draft, next.short);
      setForm({
        ...emptyLabel,
        long: row?.long ?? "",
        short: next.short,
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
      // The short form is the identity and came in with the path, so it is not
      // read back off the form: editing it would be creating another row.
      setDraft(
        upsertAbbreviation(draft, {
          short: path.short,
          long: label.long,
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
    } else if (path.at === "l2annotationForm") {
      // A category is never minted: provenance rides on its atoms, which are
      // already bound with their own schemes. And it carries no references —
      // there is nothing to document about a combination of documented items.
      //
      // The default is written only where the category names an axis — the iff
      // rule of the merge, enforced at the one place a default can be authored.
      // With no axis there is no feature for the value to belong to, so saving
      // here is also the repair for `category-default-forbidden`.
      const axis = axisOf(path.category);
      const value = form.defaultValue.trim();
      setDraft(
        upsertAnnotation(
          draft,
          path.category,
          path.index,
          {
            long: label.long,
            ...(label.short !== undefined ? { short: label.short } : {}),
            ...(axis !== undefined && value !== "" ? { default: value } : {}),
          },
          axis,
        ),
      );
      setPendingAxis(null);
      setPath({ at: "l2category", category: path.category, from: path.from });
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
   * The feature this category's forms vary over — the declared one, or the one
   * picked for a category not yet named (see `pendingAxis`). Both answers are
   * the same answer to the contributor, which is the point of reading them
   * through one function rather than at each call site.
   */
  function axisOf(category: Tag): string | undefined {
    const row = findCategory(draft, category);
    if (row !== undefined) return row.axis;
    return pendingAxis?.key === tagKey(category) ? pendingAxis.axis : undefined;
  }

  /** Declare, change or clear the axis, whether or not the category has a row. */
  function chooseAxis(category: Tag, axis: string | undefined) {
    if (findCategory(draft, category) === undefined) {
      setPendingAxis(axis === undefined ? null : { key: tagKey(category), axis });
      return;
    }
    setDraft(setCategoryAxis(draft, category, axis));
    setPendingAxis(null);
  }

  /**
   * The features this category's forms could vary over: bound, grammatical, and
   * **not inherent to this same category** — the mirror of the gate
   * `renderL2Category` applies from the other side, since a paradigm cannot be
   * built from a coordinate that is also a constant.
   *
   * The axis in force is appended when the filters do not already offer it,
   * which is the whole of the repair path for `category-axis-unbound` and
   * `category-axis-inherent`: a defect a contributor cannot see on the row it
   * belongs to is a defect they cannot fix, so the offending choice is shown
   * selected, beside the choices that would replace it.
   */
  function axisCandidates(category: Tag): { feature: string; label?: string; orphan: boolean }[] {
    const inherent = new Set(inherentRows(draft, category).map((row) => row.feature));
    const rows = grammaticalFeatureRows(draft).filter((row) => !inherent.has(row.feature));
    const options: { feature: string; label?: string; orphan: boolean }[] = rows.map((row) => ({
      feature: row.feature,
      label: row.label.long,
      orphan: false,
    }));
    const axis = axisOf(category);
    if (axis !== undefined && !options.some((option) => option.feature === axis)) {
      options.push({ feature: axis, label: findFeature(draft, axis)?.label.long, orphan: true });
    }
    return options;
  }

  /** How a bare axis value reads: its bound label, or the value itself. */
  function defaultLabel(axis: string, value: string): string {
    const row = findValue(draft, axis, value);
    return row?.label.short ?? row?.label.long ?? value;
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
  const crumbs: { label: string; go: Path }[] =
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
    path.at === "l2annotationForm"
  ) {
    // The trail is read off the level itself, except for the one hop a category
    // bundle cannot state: which feature it was refined through. `from` carries
    // exactly that, and only for display — see `L2Origin`.
    const origin = path.at === "l2feature" ? { category: path.category, feature: path.feature } : path.from;
    if (origin !== undefined) {
      crumbs.push({
        label: categoryText(origin.category),
        go: { at: "l2category", category: origin.category },
      });
      crumbs.push({
        label: origin.feature,
        go: { at: "l2feature", category: origin.category, feature: origin.feature },
      });
    }
    if (path.at !== "l2feature") {
      crumbs.push({
        label: categoryText(path.category),
        go: { at: "l2category", category: path.category, from: path.from },
      });
      if (path.at === "l2annotationForm") {
        const annotation = findCategory(draft, path.category)?.annotations[path.index];
        crumbs.push({
          label: annotation?.short ?? annotation?.long ?? t("grammar.l2AnnotationNew"),
          go: path,
        });
      }
    }
  } else if (path.at === "classes") {
    crumbs.push({ label: t("grammar.classesLevel"), go: { at: "classes" } });
  } else if (path.at === "lexical") {
    crumbs.push({ label: t("grammar.lexicalLevel"), go: { at: "lexical" } });
  } else if (path.at === "abbreviations" || path.at === "abbreviationForm") {
    crumbs.push({ label: t("grammar.abbreviationsLevel"), go: { at: "abbreviations" } });
    if (path.at === "abbreviationForm") crumbs.push({ label: path.short, go: path });
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
    const rows = lexicalRows(draft);
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
   * open and no tag to bind. The short form is asked for first and never again,
   * since it is what identifies the row — editing it would be writing a
   * different abbreviation, which is what the delete and re-add it forces
   * actually means.
   */
  function renderAbbreviations() {
    const rows = abbreviationRows(draft);
    return (
      <>
        <p className="mb-3 text-xs text-content-subtle">{t("grammar.abbreviationsHint")}</p>
        {rows.length === 0 ? (
          <p className="text-sm text-content-muted">{t("grammar.abbreviationsEmpty")}</p>
        ) : (
          <ul className="space-y-1.5">
            {rows.map((row) => (
              <li key={row.short} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => openForm({ at: "abbreviationForm", short: row.short })}
                  className={`${levelButton} flex-1`}
                >
                  <span className="font-mono text-sm text-content">{row.short}</span>
                  <span className="truncate text-sm text-content">{row.long}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDraft(removeAbbreviation(draft, row.short))}
                  aria-label={t("grammar.removeAbbreviation")}
                  title={t("grammar.removeAbbreviation")}
                  className="text-content-subtle hover:text-danger"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <AddRow
          placeholder={t("grammar.addAbbreviationPlaceholder")}
          hint={t("grammar.addAbbreviationHint")}
          onAdd={(short) => openForm({ at: "abbreviationForm", short })}
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
    const rows = classRows(draft);
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
    const minted = posRows(draft).filter(
      (row) => !HEADWORD_UPOS.some((u) => u.value === row.value),
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
    return (
      <>
        <p className="mb-3 text-xs text-content-subtle">{t("grammar.featuresHint")}</p>
        {grammaticalFeatureRows(draft).length === 0 ? (
          <p className="text-sm text-content-muted">{t("grammar.featuresEmpty")}</p>
        ) : (
          <ul className="space-y-1.5">
            {grammaticalFeatureRows(draft).map((row) => (
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
    const values = valueRows(draft, feature);
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
   * The categories inherence can be declared on: every bound part of speech,
   * and every combination already named — so a language can walk deeper one
   * step at a time ({NOUN} → {NOUN, Gender=Fem} → its declension), each step
   * standing on the one before. The gate as navigation: an unbound category
   * simply is not offered.
   */
  /**
   * How a category is named, in one line: every annotation, each with the
   * headword value it stands for where the category has an axis.
   *
   * The value is worth printing beside the abbreviation because it is what
   * tells two of them apart — "anv-kadarn gourel" and *anv-kadarn stroll* are
   * one category and differ only in where their headwords sit.
   */
  function categorySummary(row: GrammarCategory): string {
    return row.annotations
      .map((annotation) => {
        const name = annotation.short ?? annotation.long;
        if (row.axis === undefined || annotation.default === undefined) return name;
        return `${name} (${defaultLabel(row.axis, annotation.default)})`;
      })
      .join(" · ");
  }

  function renderL2Root() {
    const pos = posRows(draft);
    // Every declared category *beyond* the bare parts of speech above. A
    // POS-only category is now legitimate (ADR-0019), so it would otherwise be
    // listed twice — once as its part of speech and once as its own row.
    const posKeys = new Set(pos.map((row) => tagKey(posTag(row))));
    const declared = categoryRows(draft).filter((row) => !posKeys.has(tagKey(row.category)));
    const rows = [
      ...pos.map((row) => ({
        category: posTag(row),
        heading: row.label.short ?? row.label.long,
      })),
      ...declared.map((row) => ({ category: row.category, heading: categoryText(row.category) })),
    ];
    return (
      <>
        <p className="mb-3 text-xs text-content-subtle">{t("grammar.l2RootHint")}</p>
        {pos.length === 0 ? (
          <p className="text-sm text-content-muted">{t("grammar.l2NoPos")}</p>
        ) : (
          <ul className="space-y-1.5">
            {rows.map(({ category, heading }) => {
              const row = findCategory(draft, category);
              const summary = row === undefined ? "" : categorySummary(row);
              return (
                <li key={tagKey(category)} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPath({ at: "l2category", category })}
                    className={`${stackedLevelButton} min-w-0 flex-1`}
                  >
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-sm text-content">{heading}</span>
                      <span className="shrink-0 text-xs text-content-subtle">
                        {t("grammar.l2InherentCount", {
                          count: inherentRows(draft, category).length,
                        })}
                      </span>
                    </span>
                    {summary !== "" && (
                      <span className="truncate text-xs text-content-subtle">{summary}</span>
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
   * One category, whole: what its forms vary over, what this dictionary calls
   * its headwords, and which features are inherent to it.
   *
   * The three sit on one level because they are three halves of one
   * declaration since ADR-0019 — a category that names an axis and the value
   * each of its abbreviations stands at is what replaced the standalone axis
   * list. The order on screen is the order of the decisions: the bundle came in
   * with the path, then what varies, then the names, then how much deeper the
   * language wants to go.
   */
  function renderL2Category(category: Tag, from?: L2Origin) {
    const row = findCategory(draft, category);
    const axis = axisOf(category);
    const declared = inherentRows(draft, category);
    const declaredNames = new Set(declared.map((r) => r.feature));
    // The mirror of the axis gate: the feature this category's forms vary over
    // is not offered as inherent to it either. One rule, enforced from whichever
    // side the contributor arrives at it — and since ADR-0019 the axis is a
    // field on the category's own row rather than a declaration of its own.
    //
    // Lexicographic label sets are absent rather than disabled — the gate as
    // navigation again. "Archaic" is not something a word *is*, so it is never
    // an inherent feature of anything.
    const available = grammaticalFeatureRows(draft).filter(
      (r) => !declaredNames.has(r.feature) && r.feature !== axis,
    );
    const candidates = axisCandidates(category);
    /** The labelled tag one annotation stands for — the category plus its value. */
    function annotationTag(annotation: { default?: string }): Tag {
      if (axis === undefined || annotation.default === undefined) return category;
      const scheme = findValue(draft, axis, annotation.default)?.scheme;
      return combinationTag(category, {
        feature: axis,
        value: annotation.default,
        ...(scheme !== undefined ? { scheme } : {}),
      });
    }
    // A bare part of speech is already named by its `pos` row, so naming it
    // again here would be two labels for one tag — reported as `duplicate`, and
    // worth saying before rather than after. With an axis it is a different tag
    // each time, which is exactly what dropping the two-atom floor was for.
    const posOnly = category.upos !== undefined && (category.feats ?? []).length === 0;

    return (
      <>
        <div className="mb-3">
          <p className="text-sm font-medium text-content">{categoryText(category)}</p>
          <p className="mt-0.5 font-mono text-xs text-content-subtle">
            {formatTagVerbatim(category)}
          </p>
        </div>

        <p className="text-xs font-medium text-content">{t("grammar.l2AxisTitle")}</p>
        <p className="mt-0.5 text-xs text-content-subtle">{t("grammar.l2AxisHint")}</p>
        {candidates.length === 0 ? (
          <p className="mt-2 text-sm text-content-muted">{t("grammar.l2AxisNoFeatures")}</p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            <li>
              <button
                type="button"
                onClick={() => chooseAxis(category, undefined)}
                className={axis === undefined ? chipButtonActive : chipButton}
              >
                {t("grammar.l2AxisNone")}
              </button>
            </li>
            {candidates.map((option) => (
              <li key={option.feature}>
                <button
                  type="button"
                  onClick={() => chooseAxis(category, option.feature)}
                  title={option.label ?? t("grammar.l2AxisOrphan")}
                  className={option.feature === axis ? chipButtonActive : chipButton}
                >
                  {option.feature}
                  {option.orphan && <span className="ml-1 text-danger">!</span>}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 border-t pt-3">
          <p className="text-xs font-medium text-content">{t("grammar.l2NamesTitle")}</p>
          <p className="mt-0.5 text-xs text-content-subtle">
            {axis === undefined
              ? t("grammar.l2NamesHint")
              : t("grammar.l2NamesAxisHint", { feature: axis })}
          </p>
          {posOnly && axis === undefined && findPos(draft, category.upos!.value) !== undefined && (
            <p className="mt-1 text-xs text-content-subtle">{t("grammar.l2NamesPosHint")}</p>
          )}
          {row === undefined ? (
            <p className="mt-2 text-sm text-content-muted">{t("grammar.l2NoName")}</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {row.annotations.map((annotation, index) => (
                <li key={index} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openForm({ at: "l2annotationForm", category, index, from })}
                    className={`${levelButton} min-w-0 flex-1`}
                  >
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="truncate text-sm text-content">
                        {annotation.short ?? annotation.long}
                      </span>
                      {annotation.short !== undefined && (
                        <span className="truncate text-xs text-content-subtle">
                          {annotation.long}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-xs text-content-subtle">
                      {axis === undefined
                        ? ""
                        : annotation.default === undefined
                          ? t("grammar.l2DefaultMissing")
                          : defaultLabel(axis, annotation.default)}
                    </span>
                  </button>
                  {usageFor(annotationTag(annotation))}
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={() =>
              openForm({
                at: "l2annotationForm",
                category,
                index: row?.annotations.length ?? 0,
                from,
              })
            }
            className="mt-2 text-sm text-primary hover:text-primary-hover"
          >
            {row === undefined ? t("grammar.l2AddName") : t("grammar.l2AddAnotherName")}
          </button>
        </div>

        <div className="mt-4 border-t pt-3">
          <p className="text-xs font-medium text-content">{t("grammar.l2InherentTitle")}</p>
          <p className="mt-0.5 text-xs text-content-subtle">{t("grammar.l2CategoryHint")}</p>
          {declared.length === 0 ? (
            <p className="mt-2 text-sm text-content-muted">{t("grammar.l2NoInherent")}</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {declared.map((inherent) => {
                // Withdrawing is blocked while a named combination stands on
                // this declaration — the same disabled-with-a-reason pattern as
                // unbinding a feature name whose values are bound. `grammarIssues`
                // would catch it at publish anyway; saying so here is kinder.
                const supported = valueRows(draft, inherent.feature).filter(
                  (value) => findCategory(draft, combinationTag(category, value)) !== undefined,
                ).length;
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
                        {t("grammar.l2CombinedCount", {
                          bound: supported,
                          total: valueRows(draft, inherent.feature).length,
                        })}
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={supported > 0}
                      title={supported > 0 ? t("grammar.l2WithdrawBlocked") : undefined}
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
   * The enumeration prompt: one combination per bound value of the feature,
   * each its own category. A counter, never a constraint — an incomplete set is
   * legitimate (a language may bind a value for another category's sake) and
   * nothing here blocks a save.
   *
   * Every row opens that category's editor rather than a naming form, which is
   * what makes the walk go as deep as the declarations do: before ADR-0019 a
   * combination had to be named before anything could be declared about it,
   * because the root list showed only named ones.
   */
  function renderL2Feature(category: Tag, feature: string) {
    const values = valueRows(draft, feature);
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
              return (
                <li key={tagKey(combination)} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setPath({
                        at: "l2category",
                        category: combination,
                        from: { category, feature },
                      })
                    }
                    className={`${levelButton} min-w-0 flex-1`}
                  >
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="text-sm text-content">{categoryText(combination)}</span>
                      <span className="truncate font-mono text-xs text-content-subtle">
                        {formatTagVerbatim(combination)}
                      </span>
                    </span>
                    {bound === undefined ? (
                      <span className="shrink-0 text-xs text-content-subtle">
                        {t("grammar.l2Decomposed")}
                      </span>
                    ) : (
                      <span className="shrink-0 truncate text-sm text-content">
                        {categorySummary(bound)}
                      </span>
                    )}
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
   * The language's paradigms as a flat list — **a holding state while the
   * category–axis merge lands** (ADR-0019).
   *
   * This level used to be reached through the layouts, one door per table a
   * language drew, and a new paradigm's selector was picked from the
   * combinations falling under that layout. Both of those are gone: the table
   * shape moved into the paradigm record and the selector is now one of the
   * language's own declared category flavours. Rebuilding the door is slice 5's
   * work, so what is left here lists what the index currently holds, and the
   * editor behind it says so rather than opening on a shape it can no longer
   * write.
   */
  function renderL5Root() {
    return (
      <>
        <p className="mb-3 text-xs text-content-subtle">{t("grammar.l5RootHint")}</p>
        <p className="rounded-lg border border-dashed p-3 text-sm text-content-muted">
          {t("grammar.l5Rebuilding")}
        </p>
        {paradigms.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {paradigms.map((row) => (
              <li key={row.paradigmKey}>
                <button
                  type="button"
                  onClick={() => setEditing({ selector: row.selector })}
                  className={levelButton}
                >
                  <span className="text-sm text-content">{categoryText(row.selector)}</span>
                  <span className="font-mono text-xs text-content-subtle">
                    {formatTagVerbatim(row.selector)}
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
   * One annotation of a category: what this dictionary calls it, and — where
   * the category names an axis — which value of that axis its headwords carry.
   *
   * Separate from `renderForm` for the reason the abbreviation form is: nothing
   * it asks is the same. A category is never minted (provenance rides on its
   * atoms, each already bound with its own scheme) and documents no source, so
   * the whole mint section is absent; what it has instead is the default
   * picker, and that is the one control on which the merge turns.
   */
  function renderAnnotationForm(category: Tag, index: number, from?: L2Origin) {
    const existing = findCategory(draft, category)?.annotations[index];
    const axis = axisOf(category);
    const values = axis === undefined ? [] : valueRows(draft, axis);
    const current = form.defaultValue.trim();
    // A default naming a value nobody bound: shown rather than silently
    // dropped, because `category-default-unbound` is reported against this row
    // and a defect a contributor cannot see here is one they cannot repair.
    const picked = axis === undefined || current === "" ? undefined : findValue(draft, axis, current);
    const orphaned = current !== "" && axis !== undefined && picked === undefined;

    return (
      <>
        <div className="mb-3">
          <p className="text-sm font-medium text-content">{categoryText(category)}</p>
          <p className="mt-0.5 font-mono text-xs text-content-subtle">
            {formatTagVerbatim(category)}
          </p>
        </div>

        <label className="block text-sm font-medium text-content" htmlFor="grammar-annotation-long">
          {t("grammar.longLabel")}
        </label>
        <p className="mt-0.5 text-xs text-content-subtle">{t("grammar.homolingualHint")}</p>
        <input
          id="grammar-annotation-long"
          value={form.long}
          onChange={(e) => setForm({ ...form, long: e.target.value })}
          placeholder={t("grammar.longPlaceholder")}
          className={`${inputClass} mt-1`}
        />

        <label
          className="mt-3 block text-sm font-medium text-content"
          htmlFor="grammar-annotation-short"
        >
          {t("grammar.shortLabel")}
        </label>
        <input
          id="grammar-annotation-short"
          value={form.short}
          onChange={(e) => setForm({ ...form, short: e.target.value })}
          placeholder={t("grammar.shortPlaceholder")}
          className={`${inputClass} mt-1`}
        />

        {axis !== undefined && (
          <div className="mt-4 rounded-lg border bg-surface-muted/40 p-3">
            <p className="text-sm text-content">{t("grammar.l2DefaultLabel", { feature: axis })}</p>
            <p className="mt-0.5 text-xs text-content-subtle">{t("grammar.l2DefaultHint")}</p>
            {values.length === 0 && !orphaned ? (
              <p className="mt-2 text-sm text-content-muted">
                {t("grammar.l2NoValues", { feature: axis })}
              </p>
            ) : (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {values.map((value) => {
                  const active = picked === value;
                  return (
                    <li key={value.value}>
                      <button
                        type="button"
                        onClick={() =>
                          setForm({ ...form, defaultValue: active ? "" : value.value })
                        }
                        title={value.label.long}
                        className={active ? chipButtonActive : chipButton}
                      >
                        {value.label.short ?? value.label.long}
                      </button>
                    </li>
                  );
                })}
                {orphaned && (
                  <li>
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, defaultValue: "" })}
                      title={t("grammar.l2DefaultUnbound", { value: current })}
                      className="rounded-full border border-danger bg-surface px-2.5 py-1 font-mono text-xs font-medium text-danger"
                    >
                      {current} !
                    </button>
                  </li>
                )}
              </ul>
            )}
          </div>
        )}

        {/* The mirror, and the repair for `category-default-forbidden`: a value
            picked before the axis was cleared belongs to no feature at all, so
            saying so is the only honest thing to do before saving drops it. */}
        {axis === undefined && current !== "" && (
          <p className="mt-3 text-xs text-danger">
            {t("grammar.l2DefaultForbidden", { value: current })}
          </p>
        )}

        <div className="mt-4 flex items-center justify-between gap-3 border-t pt-3">
          {existing !== undefined ? (
            <button
              type="button"
              onClick={() => {
                setDraft(removeAnnotation(draft, category, index));
                setPath({ at: "l2category", category, from });
              }}
              className="text-sm text-danger hover:text-danger"
            >
              {t("grammar.l2RemoveName")}
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={saveForm}
            disabled={form.long.trim() === ""}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-fg hover:bg-primary-hover disabled:opacity-50"
          >
            {t("grammar.bind")}
          </button>
        </div>
      </>
    );
  }

  /**
   * The abbreviation form: what a short form stands for, and nothing else.
   *
   * Separate from `renderForm` rather than a mode of it, because nothing it
   * asks is the same. There is no abbreviated form to fill in (the short form
   * *is* the row, and it was given on the way in), no minting question (the
   * only possible provenance is this language), and the delete offered is a
   * removal from a list rather than an unbinding of a tag.
   */
  function renderAbbreviationForm(short: string) {
    const existing = findAbbreviation(draft, short);
    return (
      <>
        <p className="mb-3 font-mono text-sm text-content">{short}</p>

        <label className="block text-sm font-medium text-content" htmlFor="grammar-abbr-long">
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

        <div className="mt-4 flex items-center justify-between gap-3 border-t pt-3">
          {existing !== undefined ? (
            <button
              type="button"
              onClick={() => {
                setDraft(removeAbbreviation(draft, short));
                setPath({ at: "abbreviations" });
              }}
              className="text-sm text-danger hover:text-danger"
            >
              {t("grammar.removeAbbreviation")}
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={saveForm}
            disabled={form.long.trim() === ""}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-fg hover:bg-primary-hover disabled:opacity-50"
          >
            {t("grammar.bind")}
          </button>
        </div>
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
        {notable(path) && (
          <>
            <label className="mt-3 block text-sm font-medium text-content" htmlFor="grammar-note">
              {t("grammar.noteLabel")}
            </label>
            <p className="mt-0.5 text-xs text-content-subtle">{t("grammar.noteHint")}</p>
            <textarea
              id="grammar-note"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              placeholder={t("grammar.notePlaceholder")}
              rows={3}
              className={`${inputClass} mt-1 resize-y`}
            />
          </>
        )}

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

        <div className="mt-4 flex items-center justify-between gap-3 border-t pt-3">
          {existing !== undefined ? (
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
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={saveForm}
            disabled={form.long.trim() === ""}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-fg hover:bg-primary-hover disabled:opacity-50"
          >
            {t("grammar.bind")}
          </button>
        </div>
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
        return renderAbbreviationForm(path.short);
      case "feature":
        return renderFeature(path.feature);
      case "values":
        return renderValues(path.feature);
      case "l2root":
        return renderL2Root();
      case "l2category":
        return renderL2Category(path.category, path.from);
      case "l2feature":
        return renderL2Feature(path.category, path.feature);
      case "l2annotationForm":
        return renderAnnotationForm(path.category, path.index, path.from);
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
      <div className="flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden rounded-t-xl border bg-surface shadow-lg sm:max-w-2xl sm:rounded-xl">
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
                        className={`text-left text-sm ${
                          i === crumbs.length - 1
                            ? "font-medium text-content"
                            : "text-content-subtle hover:text-primary"
                        }`}
                        style={{ paddingLeft: `${i * 0.5}rem` }}
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
                  language was declared before the category–axis merge, so the
                  draft above is a forward-mapping of its record and publishing
                  is what commits it. */}
              {carriesRetiredGrammar(record.grammar) && (
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
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={submitting}
                  className="rounded-lg border px-4 py-2 text-sm text-content hover:bg-black/5"
                >
                  {t("grammar.cancel")}
                </button>
                <button
                  type="button"
                  onClick={() => void onPublish()}
                  disabled={submitting || !dirty || defects.length > 0 || !agent}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-fg hover:bg-primary-hover disabled:opacity-50"
                >
                  {submitting ? t("grammar.publishing") : t("grammar.publish")}
                </button>
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
          selector={editing.selector}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

const levelButton =
  "flex w-full items-center justify-between gap-3 rounded-lg border bg-surface px-3 py-2 text-left hover:border-primary";

/**
 * A pickable option: one of a small set where the choice itself is the control,
 * rather than a level to walk into. The active variant is a *pair* with the
 * plain one and not an override of it, for the reason `stackedLevelButton` is
 * not one either — two utilities of equal specificity would resolve by
 * Tailwind's emission order rather than by the order they are written.
 */
const chipButton =
  "rounded-full border bg-surface-muted/60 px-2.5 py-1 font-mono text-xs text-content hover:border-primary hover:text-primary";

const chipButtonActive =
  "rounded-full border border-primary bg-surface px-2.5 py-1 font-mono text-xs font-medium text-primary";

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
   * require: an abbreviation is a printed string, so "udb." and "s.o." are as
   * legitimate as anything else and only emptiness can be rejected.
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
