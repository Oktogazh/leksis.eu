import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  applicableAxes,
  excludesCell,
  grammarIssues,
  grammarLookup,
  featureDocUrl,
  formatTagVerbatim,
  parseTagInput,
  posTag,
  resolveLayout,
  resolveTag,
  tagAtomKeys,
  tagKey,
  tagSize,
  uposDocUrl,
  uposGloss,
  valueTag,
  FEATURE_NAME_PATTERN,
  FEATURE_VALUE_PATTERN,
  HEADWORD_UPOS,
  LEKSIS_LANGUAGE_COLLECTION,
  POS_VALUE_PATTERN,
  type Grammar,
  type GrammarLabel,
  type GrammarReference,
  type LayoutAddress,
  type LayoutCoord,
  type LeksisLanguageRecord,
  type ParadigmView as ParadigmPointer,
  type ResolvedLayoutBlock,
  type ResolvedLayoutTable,
  type Tag,
} from "@leksis/types";
import { AddressPicker } from "./AddressPicker";
import { ParadigmEditorDialog } from "./ParadigmEditorDialog";
import { BlockCaption, ParadigmList, ParadigmTable } from "./ParadigmView";
import { fetchFeatureNames, fetchFeatureValues, type UdValue } from "@leksis/ud";
import { useSession } from "../auth/SessionProvider";
import { fetchCurrentLanguageRecord, fetchLanguageParadigms } from "../lib/api";
import { fetchLanguageRecord } from "../lib/atproto-record";
import {
  abbreviationRows,
  addAxis,
  addBlock,
  addInherent,
  addLayout,
  addListItem,
  axisRows,
  blockWithoutExclusions,
  classRows,
  combinationRows,
  findAbbreviation,
  grammaticalFeatureRows,
  lexicalRows,
  removeAbbreviation,
  upsertAbbreviation,
  findAxis,
  layoutRow,
  moveAxisValue,
  moveBlock,
  moveBlockAxis,
  moveListItem,
  removeAxis,
  removeBlock,
  removeLayout,
  removeListItem,
  setBlockFixed,
  toggleAxisValue,
  toggleBlockAxis,
  toggleBlockSummary,
  toggleExcludedCell,
  findCombination,
  findFeature,
  findPos,
  findValue,
  inherentRows,
  posRows,
  removeCombination,
  removeFeature,
  removeInherent,
  removePos,
  removeValue,
  upsertCombination,
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
  // Layer 2 — the same shape one level up: pick a category, declare which
  // features are inherent to it, then the combinations for a declared feature
  // become available to name.
  | { at: "l2root" }
  | { at: "l2category"; category: Tag }
  | { at: "l2feature"; category: Tag; feature: string }
  | { at: "l2combinationForm"; category: Tag; feature: string; tag: Tag }
  // Layer 3 — the same three levels again, one altitude across: pick a
  // category, declare which features vary across its forms, then pick and
  // order the values each varies over.
  | { at: "l3root" }
  | { at: "l3category"; category: Tag }
  | { at: "l3feature"; category: Tag; feature: string }
  // Layer 4 — a category, then one of its blocks. Two levels rather than three:
  // a block is not reached through a feature, it *arranges* several of them.
  | { at: "l4root" }
  | { at: "l4category"; category: Tag }
  | { at: "l4block"; category: Tag; index: number }
  // Layer 5 — the layouts as a list, then one category's paradigms. Editing a
  // paradigm is not a level: it is a *different record*, so it opens its own
  // dialog with its own publish footer rather than borrowing this one's.
  | { at: "l5root" }
  | { at: "l5category"; category: Tag };

/** Which tab a path belongs to — the tab strip is derived, never stored. */
function pathTab(path: Path): "primitives" | "combinations" | "axes" | "layout" | "paradigms" {
  if (path.at.startsWith("l5")) return "paradigms";
  if (path.at.startsWith("l4")) return "layout";
  if (path.at.startsWith("l3")) return "axes";
  return path.at.startsWith("l2") ? "combinations" : "primitives";
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
}

const emptyLabel: LabelDraft = { long: "", short: "", minted: false, references: [] };

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
  /** The stacked editor: which selector, and the pointer when one is being rewritten. */
  const [editing, setEditing] = useState<{
    selector: Tag;
    existing?: { paradigmKey: string; recordURI: string; cid: string };
  } | null>(null);
  const [form, setForm] = useState<LabelDraft>(emptyLabel);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Live candidates from UD's documentation. Empty means "no suggestions" —
   * a failed fetch, an offline contributor, or a feature UD does not document
   * — never an error to report, because the manual field below stays the real
   * path. UD's uptime is not allowed to gate authoring.
   */
  const [udFeatures, setUdFeatures] = useState<string[]>([]);
  const [udValues, setUdValues] = useState<UdValue[]>([]);
  const [udLoading, setUdLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ref = await fetchCurrentLanguageRecord(tag);
        const loaded = ref === null ? null : await fetchLanguageRecord(ref.recordURI);
        if (cancelled) return;
        setRecord(loaded);
        setBaseline(ref === null ? null : { recordURI: ref.recordURI, cid: ref.cid });
        setDraft(loaded?.grammar ?? {});
      } catch (err) {
        console.error("could not load the language record:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tag]);

  // Candidates are fetched when a level that shows them is opened, not on
  // mount: a contributor who only edits a label never touches the network.
  useEffect(() => {
    if (path.at !== "features" || udFeatures.length > 0) return;
    const controller = new AbortController();
    setUdLoading(true);
    fetchFeatureNames(controller.signal)
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
    else if (next.at === "l2combinationForm") existing = findCombination(draft, next.tag);
    else if (next.at === "abbreviationForm") {
      // An abbreviation has no tag and so no label pair to seed from: its short
      // form came in through the path and only the expansion is being written.
      const row = findAbbreviation(draft, next.short);
      setForm({
        long: row?.long ?? "",
        short: next.short,
        minted: false,
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
            long: existing.label.long,
            short: existing.label.short ?? "",
            minted: "scheme" in existing && existing.scheme !== undefined,
            references: existing.references ?? [],
          },
    );
    setPath(next);
  }

  function saveForm() {
    const label = toLabel(form);
    if (label.long === "") return;
    const scheme = form.minted ? tag : undefined;
    const references = cleanReferences(form.references);
    const extra = {
      ...(scheme !== undefined ? { scheme } : {}),
      ...(references.length > 0 ? { references } : {}),
    };

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
          ...(lexicographic ? { lexicographic: true } : {}),
        }),
      );
      setPath({ at: "feature", feature: path.feature });
    } else if (path.at === "valueForm") {
      setDraft(upsertValue(draft, { feature: path.feature, value: path.value, label, ...extra }));
      setPath({ at: "values", feature: path.feature });
    } else if (path.at === "l2combinationForm") {
      // A combination is never minted: provenance rides on its items, which
      // are already bound with their own schemes. Only the references travel.
      setDraft(
        upsertCombination(draft, {
          tag: path.tag,
          label,
          ...(references.length > 0 ? { references } : {}),
        }),
      );
      setPath({ at: "l2feature", category: path.category, feature: path.feature });
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
    tab === "combinations"
      ? [{ label: t("grammar.crumbL2Root"), go: { at: "l2root" } }]
      : tab === "axes"
        ? [{ label: t("grammar.crumbL3Root"), go: { at: "l3root" } }]
        : tab === "layout"
          ? [{ label: t("grammar.crumbL4Root"), go: { at: "l4root" } }]
          : tab === "paradigms"
            ? [{ label: t("grammar.crumbL5Root"), go: { at: "l5root" } }]
            : [{ label: t("grammar.crumbRoot"), go: { at: "root" } }];
  if (path.at === "pos" || path.at === "posForm") {
    crumbs.push({ label: t("grammar.posLevel"), go: { at: "pos" } });
    if (path.at === "posForm") crumbs.push({ label: path.value, go: path });
  } else if (path.at === "l2category" || path.at === "l2feature" || path.at === "l2combinationForm") {
    crumbs.push({
      label: categoryText(path.category),
      go: { at: "l2category", category: path.category },
    });
    if (path.at !== "l2category") {
      crumbs.push({
        label: path.feature,
        go: { at: "l2feature", category: path.category, feature: path.feature },
      });
      if (path.at === "l2combinationForm") {
        crumbs.push({ label: categoryText(path.tag), go: path });
      }
    }
  } else if (path.at === "l3category" || path.at === "l3feature") {
    crumbs.push({
      label: categoryText(path.category),
      go: { at: "l3category", category: path.category },
    });
    if (path.at === "l3feature") {
      crumbs.push({
        label: path.feature,
        go: { at: "l3feature", category: path.category, feature: path.feature },
      });
    }
  } else if (path.at === "l4category" || path.at === "l4block") {
    crumbs.push({
      label: categoryText(path.category),
      go: { at: "l4category", category: path.category },
    });
    if (path.at === "l4block") {
      const block = layoutRow(draft, path.category)?.blocks[path.index];
      crumbs.push({
        label:
          block?.kind === "list" ? t("grammar.l4BlockList") : t("grammar.l4BlockTable"),
        go: path,
      });
    }
  } else if (path.at === "l5category") {
    crumbs.push({ label: categoryText(path.category), go: path });
  } else if (path.at === "classes") {
    crumbs.push({ label: t("grammar.classesLevel"), go: { at: "classes" } });
  } else if (path.at === "lexical") {
    crumbs.push({ label: t("grammar.lexicalLevel"), go: { at: "lexical" } });
  } else if (path.at === "abbreviations" || path.at === "abbreviationForm") {
    crumbs.push({ label: t("grammar.abbreviationsLevel"), go: { at: "abbreviations" } });
    if (path.at === "abbreviationForm") crumbs.push({ label: path.short, go: path });
  } else if (
    path.at !== "root" &&
    path.at !== "l2root" &&
    path.at !== "l3root" &&
    path.at !== "l4root" &&
    path.at !== "l5root"
  ) {
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
                  className="text-content-subtle hover:text-red-600"
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
            return (
              <li key={upos.value}>
                <button
                  type="button"
                  onClick={() => openForm({ at: "posForm", value: upos.value })}
                  className={levelButton}
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
              </li>
            );
          })}
          {minted.map((row) => (
            <li key={row.value}>
              <button
                type="button"
                onClick={() => openForm({ at: "posForm", value: row.value })}
                className={levelButton}
              >
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="font-mono text-sm text-content">{row.value}</span>
                  <span className="text-xs text-amber-600">{t("grammar.mintedBadge")}</span>
                </span>
                <span className="text-sm text-content">{row.label.short ?? row.label.long}</span>
              </button>
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
                      <span className="text-xs text-amber-600">{t("grammar.mintedBadge")}</span>
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
            .filter((name) => findFeature(draft, name) === undefined)
            .map((name) => ({ key: name, label: name }))}
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
                setDraft(removeFeature(draft, feature, bound.scheme));
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
              className="text-sm text-red-600 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
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
            {values.map((row) => (
              <li key={row.value}>
                <button
                  type="button"
                  onClick={() => openForm({ at: "valueForm", feature, value: row.value })}
                  className={levelButton}
                >
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="font-mono text-sm text-content">
                      {feature}={row.value}
                    </span>
                    {/* Under a minted feature every value is minted, so the
                        badge would be on every row and say nothing. */}
                    {row.scheme !== undefined && !minted && (
                      <span className="text-xs text-amber-600">{t("grammar.mintedBadge")}</span>
                    )}
                  </span>
                  <span className="text-sm text-content">{row.label.short ?? row.label.long}</span>
                </button>
              </li>
            ))}
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
  function renderL2Root() {
    const pos = posRows(draft);
    const combinations = draft.bindings ?? [];
    return (
      <>
        <p className="mb-3 text-xs text-content-subtle">{t("grammar.l2RootHint")}</p>
        {pos.length === 0 ? (
          <p className="text-sm text-content-muted">{t("grammar.l2NoPos")}</p>
        ) : (
          <ul className="space-y-1.5">
            {pos.map((row) => {
              const category = posTag(row);
              return (
                <li key={tagKey(category)}>
                  <button
                    type="button"
                    onClick={() => setPath({ at: "l2category", category })}
                    className={levelButton}
                  >
                    <span className="text-sm text-content">{row.label.short ?? row.label.long}</span>
                    <span className="text-xs text-content-subtle">
                      {t("grammar.l2InherentCount", { count: inherentRows(draft, category).length })}
                    </span>
                  </button>
                </li>
              );
            })}
            {combinations.map((row) => (
              <li key={tagKey(row.tag)} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPath({ at: "l2category", category: row.tag })}
                  className={`${levelButton} flex-1`}
                >
                  <span className="text-sm text-content">{row.label.short ?? row.label.long}</span>
                  <span className="text-xs text-content-subtle">
                    {t("grammar.l2InherentCount", { count: inherentRows(draft, row.tag).length })}
                  </span>
                </button>
                {/* A one-atom row is not a combination at all — it belongs in
                    `pos` or `values` — and this is the ONLY control anywhere
                    that can remove one: every other level reaches a
                    combination through a (category, feature) pair, which a
                    single atom has none of. Without it a record carrying one
                    could never be made publishable, since ingest now refuses an
                    incoherent grammar (ADR-0015). Hence the narrow condition:
                    a well-formed combination is still removed where it was
                    declared, not here. */}
                {tagSize(row.tag) < 2 && (
                  <button
                    type="button"
                    onClick={() => setDraft(removeCombination(draft, row.tag))}
                    title={t("grammar.issue.single-item-binding", { key: tagKey(row.tag) })}
                    aria-label={t("grammar.unbind")}
                    className="text-content-subtle hover:text-red-600"
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }

  /** One category: its inherent features, and the bound features left to declare. */
  function renderL2Category(category: Tag) {
    const declared = inherentRows(draft, category);
    const declaredNames = new Set(declared.map((row) => row.feature));
    // The mirror of layer 3's gate: a feature already declared an *axis* of
    // this category is not offered as inherent either. One rule, enforced from
    // whichever side the contributor arrives at it.
    const axisNames = new Set(axisRows(draft, category).map((row) => row.feature));
    // Lexicographic label sets are absent rather than disabled — the gate as
    // navigation again. "Archaic" is not something a word *is*, so it is never
    // an inherent feature of anything.
    const available = grammaticalFeatureRows(draft).filter(
      (row) => !declaredNames.has(row.feature) && !axisNames.has(row.feature),
    );
    return (
      <>
        <div className="mb-3">
          <p className="text-sm font-medium text-content">{categoryText(category)}</p>
          <p className="mt-1 text-xs text-content-subtle">{t("grammar.l2CategoryHint")}</p>
        </div>
        {declared.length === 0 ? (
          <p className="text-sm text-content-muted">{t("grammar.l2NoInherent")}</p>
        ) : (
          <ul className="space-y-1.5">
            {declared.map((row) => {
              // Withdrawing is blocked while a named combination stands on
              // this declaration — the same disabled-with-a-reason pattern as
              // unbinding a feature name whose values are bound. `grammarDiff`
              // would catch it at publish anyway; saying so here is kinder.
              const supported = valueRows(draft, row.feature).filter(
                (value) =>
                  findCombination(draft, combinationTag(category, value)) !== undefined,
              ).length;
              return (
                <li key={row.feature} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setPath({ at: "l2feature", category, feature: row.feature })
                    }
                    className={`${levelButton} flex-1`}
                  >
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="font-mono text-sm text-content">{row.feature}</span>
                      <span className="truncate text-xs text-content-subtle">
                        {findFeature(draft, row.feature)?.label.long}
                      </span>
                    </span>
                    <span className="text-xs text-content-subtle">
                      {t("grammar.l2CombinedCount", {
                        bound: supported,
                        total: valueRows(draft, row.feature).length,
                      })}
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={supported > 0}
                    title={supported > 0 ? t("grammar.l2WithdrawBlocked") : undefined}
                    onClick={() => setDraft(removeInherent(draft, row))}
                    aria-label={t("grammar.l2Withdraw", { feature: row.feature })}
                    className="text-content-subtle hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {available.length > 0 && (
          <div className="mt-4 border-t pt-3">
            <p className="text-xs font-medium text-content">{t("grammar.l2DeclareTitle")}</p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {available.map((row) => (
                <li key={row.feature}>
                  <button
                    type="button"
                    onClick={() => setDraft(addInherent(draft, { category, feature: row.feature }))}
                    title={row.label.long}
                    className="rounded-full border bg-surface-muted/60 px-2.5 py-1 font-mono text-xs text-content hover:border-primary hover:text-primary"
                  >
                    + {row.feature}
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-content-subtle">{t("grammar.l2DeclareHint")}</p>
          </div>
        )}
      </>
    );
  }

  /**
   * The enumeration prompt: one combination per bound value of the feature,
   * each nameable. A counter, never a constraint — an incomplete set is
   * legitimate (a language may bind a value for another category's sake) and
   * nothing here blocks a save.
   */
  function renderL2Feature(category: Tag, feature: string) {
    const values = valueRows(draft, feature);
    const named = values.filter(
      (value) => findCombination(draft, combinationTag(category, value)) !== undefined,
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
              const bound = findCombination(draft, combination);
              return (
                <li key={tagKey(combination)}>
                  <button
                    type="button"
                    onClick={() =>
                      openForm({ at: "l2combinationForm", category, feature, tag: combination })
                    }
                    className={levelButton}
                  >
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="text-sm text-content">{categoryText(combination)}</span>
                      <span className="truncate font-mono text-xs text-content-subtle">
                        {formatTagVerbatim(combination)}
                      </span>
                    </span>
                    {bound === undefined ? (
                      <span className="text-xs text-content-subtle">{t("grammar.l2Decomposed")}</span>
                    ) : (
                      <span className="text-sm text-content">
                        {bound.label.short ?? bound.label.long}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </>
    );
  }

  // ---- layer 3 ----------------------------------------------------------

  /** Pick a category, exactly as layer 2 does — the same things are offered. */
  function renderL3Root() {
    const pos = posRows(draft);
    const combinations = draft.bindings ?? [];
    const categories: { tag: Tag; label: GrammarLabel }[] = [
      ...pos.map((row) => ({ tag: posTag(row), label: row.label })),
      ...combinations.map((row) => ({ tag: row.tag, label: row.label })),
    ];
    return (
      <>
        <p className="mb-3 text-xs text-content-subtle">{t("grammar.l3RootHint")}</p>
        {categories.length === 0 ? (
          <p className="text-sm text-content-muted">{t("grammar.l2NoPos")}</p>
        ) : (
          <ul className="space-y-1.5">
            {categories.map((category) => (
              <li key={tagKey(category.tag)}>
                <button
                  type="button"
                  onClick={() => setPath({ at: "l3category", category: category.tag })}
                  className={levelButton}
                >
                  <span className="text-sm text-content">
                    {category.label.short ?? category.label.long}
                  </span>
                  <span className="text-xs text-content-subtle">
                    {t("grammar.l3AxisCount", { count: axisRows(draft, category.tag).length })}
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
   * One category: the features that vary across its forms, and the bound ones
   * left to declare.
   *
   * A feature already declared *inherent* to this category is not offered —
   * the layer-3 gate rendered as navigation, like every other gate here. A
   * feature cannot both identify the word and vary across its forms, and the
   * apparent counterexample resolves one level down: `Number` is an axis of
   * `{NOUN}` and inherent to `{NOUN, Number=Ptan}`, which are different
   * categories and never meet on this screen.
   */
  function renderL3Category(category: Tag) {
    const declared = axisRows(draft, category);
    const declaredNames = new Set(declared.map((row) => row.feature));
    const inherentNames = new Set(inherentRows(draft, category).map((row) => row.feature));
    // Absent for the reason they are absent from layer 2: a word's forms do not
    // vary over "by extension", so it can address no cell of a paradigm.
    const available = grammaticalFeatureRows(draft).filter(
      (row) => !declaredNames.has(row.feature) && !inherentNames.has(row.feature),
    );
    return (
      <>
        <div className="mb-3">
          <p className="text-sm font-medium text-content">{categoryText(category)}</p>
          <p className="mt-1 text-xs text-content-subtle">{t("grammar.l3CategoryHint")}</p>
        </div>
        {declared.length === 0 ? (
          <p className="text-sm text-content-muted">{t("grammar.l3NoAxes")}</p>
        ) : (
          <ul className="space-y-1.5">
            {declared.map((row) => (
              <li key={row.feature} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPath({ at: "l3feature", category, feature: row.feature })}
                  className={`${levelButton} flex-1`}
                >
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="font-mono text-sm text-content">{row.feature}</span>
                    <span className="truncate text-xs text-content-subtle">
                      {findFeature(draft, row.feature)?.label.long}
                    </span>
                  </span>
                  <span
                    className={
                      row.values.length === 0
                        ? "text-xs text-red-600"
                        : "text-xs text-content-subtle"
                    }
                  >
                    {row.values.length === 0
                      ? t("grammar.l3NoValuesPicked")
                      : t("grammar.l3ValueCount", { count: row.values.length })}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setDraft(removeAxis(draft, category, row.feature))}
                  aria-label={t("grammar.l3Withdraw", { feature: row.feature })}
                  className="text-content-subtle hover:text-red-600"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        {available.length > 0 && (
          <div className="mt-4 border-t pt-3">
            <p className="text-xs font-medium text-content">{t("grammar.l3DeclareTitle")}</p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {available.map((row) => (
                <li key={row.feature}>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(addAxis(draft, category, row.feature));
                      setPath({ at: "l3feature", category, feature: row.feature });
                    }}
                    title={row.label.long}
                    className="rounded-full border bg-surface-muted/60 px-2.5 py-1 font-mono text-xs text-content hover:border-primary hover:text-primary"
                  >
                    + {row.feature}
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-content-subtle">{t("grammar.l3DeclareHint")}</p>
          </div>
        )}
      </>
    );
  }

  /**
   * Pick and order the values an axis ranges over. The order is the point:
   * it is what a table's headers will print and what the flat list of other
   * forms is sorted by, and the alphabetical order of an identifier is not a
   * grammatical order — nobody prints the accusative first.
   */
  function renderL3Feature(category: Tag, feature: string) {
    const axis = findAxis(draft, category, feature);
    if (axis === undefined) return null;
    const bound = valueRows(draft, feature);
    const chosen = axis.values;
    const rest = bound.filter((row) => !chosen.includes(row.value));
    return (
      <>
        <p className="mb-3 text-xs text-content-subtle">
          {t("grammar.l3FeatureHint", { feature, category: categoryText(category) })}
        </p>
        {bound.length === 0 ? (
          <p className="text-sm text-content-muted">{t("grammar.l2NoValues", { feature })}</p>
        ) : (
          <>
            <ol className="space-y-1.5">
              {chosen.map((value, i) => {
                const row = bound.find((r) => r.value === value);
                return (
                  <li
                    key={value}
                    className="flex items-center gap-2 rounded-lg border bg-surface px-3 py-2"
                  >
                    <span className="w-5 text-xs text-content-subtle">{i + 1}.</span>
                    <span className="flex min-w-0 flex-1 items-baseline gap-2">
                      <span className="text-sm text-content">
                        {row?.label.short ?? row?.label.long ?? value}
                      </span>
                      <span className="truncate font-mono text-xs text-content-subtle">
                        {feature}={value}
                      </span>
                    </span>
                    <button
                      type="button"
                      disabled={i === 0}
                      onClick={() => setDraft(moveAxisValue(draft, category, feature, value, -1))}
                      aria-label={t("grammar.l3MoveUp", { value })}
                      className="px-1 text-content-subtle hover:text-primary disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={i === chosen.length - 1}
                      onClick={() => setDraft(moveAxisValue(draft, category, feature, value, 1))}
                      aria-label={t("grammar.l3MoveDown", { value })}
                      className="px-1 text-content-subtle hover:text-primary disabled:opacity-30"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => setDraft(toggleAxisValue(draft, category, feature, value))}
                      aria-label={t("grammar.l3Remove", { value })}
                      className="px-1 text-content-subtle hover:text-red-600"
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ol>
            {chosen.length === 0 && (
              <p className="text-sm text-content-muted">{t("grammar.l3PickSomething")}</p>
            )}
            {rest.length > 0 && (
              <div className="mt-4 border-t pt-3">
                <p className="text-xs font-medium text-content">{t("grammar.l3AddValueTitle")}</p>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {rest.map((row) => (
                    <li key={row.value}>
                      <button
                        type="button"
                        onClick={() =>
                          setDraft(toggleAxisValue(draft, category, feature, row.value))
                        }
                        title={row.label.long}
                        className="rounded-full border bg-surface-muted/60 px-2.5 py-1 text-xs text-content hover:border-primary hover:text-primary"
                      >
                        + {row.label.short ?? row.label.long}
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-xs text-content-subtle">{t("grammar.l3AddValueHint")}</p>
              </div>
            )}
          </>
        )}
      </>
    );
  }

  // ---- layer 4 levels ---------------------------------------------------

  /**
   * The categories a layout can be declared for: exactly those with a declared
   * axis. A layout arranges axes, so a category with none has nothing to
   * arrange — the cascade as navigation once more, and the reason this level
   * points at the Axes tab instead of showing an empty designer.
   */
  function renderL4Root() {
    const declared = draft.layout ?? [];
    const seen = new Set<string>();
    const candidates: Tag[] = [];
    for (const axis of draft.axes ?? []) {
      const key = tagKey(axis.category);
      if (seen.has(key) || layoutRow(draft, axis.category) !== undefined) continue;
      seen.add(key);
      candidates.push(axis.category);
    }
    return (
      <>
        <p className="mb-3 text-xs text-content-subtle">{t("grammar.l4RootHint")}</p>
        {(draft.axes ?? []).length === 0 ? (
          <p className="text-sm text-content-muted">{t("grammar.l4NoAxes")}</p>
        ) : (
          <>
            {declared.length > 0 && (
              <ul className="space-y-1.5">
                {declared.map((row) => (
                  <li key={tagKey(row.category)}>
                    <button
                      type="button"
                      onClick={() => setPath({ at: "l4category", category: row.category })}
                      className={levelButton}
                    >
                      <span className="text-sm text-content">{categoryText(row.category)}</span>
                      <span className="text-xs text-content-subtle">
                        {t("grammar.l4BlockCount", { count: row.blocks.length })}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {candidates.length > 0 && (
              <div className="mt-4 border-t pt-3">
                <p className="text-xs font-medium text-content">{t("grammar.l4AddTitle")}</p>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {candidates.map((category) => (
                    <li key={tagKey(category)}>
                      <button
                        type="button"
                        onClick={() => {
                          setDraft(addLayout(draft, category));
                          setPath({ at: "l4category", category });
                        }}
                        className="rounded-full border bg-surface-muted/60 px-2.5 py-1 text-xs text-content hover:border-primary hover:text-primary"
                      >
                        + {categoryText(category)}
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-xs text-content-subtle">{t("grammar.l4AddHint")}</p>
              </div>
            )}
          </>
        )}
      </>
    );
  }

  /**
   * Which layout row a paradigm belongs under.
   *
   * A layout keys on a category; a selector is any bundle over the language's
   * inherent vocabulary and reaches entries by **containment** — so a
   * `{VERB, Conjugation=2}` paradigm fills the cells of the `{VERB}` layout and
   * belongs beside it. Matching runs on **scheme-blind atom keys**, for the
   * reason every form-to-cell join already does: a bot writes `Conjugation=2`
   * bare where this editor writes it carrying the minting scheme, and filing a
   * paradigm under only one of the two would hide the other from the person who
   * has to fix it. Where several layouts are contained, the most specific wins.
   */
  function layoutFor(selector: Tag): Tag | undefined {
    const atoms = new Set(tagAtomKeys(selector));
    let best: Tag | undefined;
    let bestSize = -1;
    for (const row of draft.layout ?? []) {
      const keys = tagAtomKeys(row.category);
      if (!keys.every((key) => atoms.has(key))) continue;
      if (keys.length > bestSize) {
        best = row.category;
        bestSize = keys.length;
      }
    }
    return best;
  }

  function paradigmsUnder(category: Tag): ParadigmPointer[] {
    const key = tagKey(category);
    return paradigms.filter((row) => {
      const under = layoutFor(row.selector);
      return under !== undefined && tagKey(under) === key;
    });
  }

  /** The layouts as a list — layer 5's door, one item per table a language draws. */
  function renderL5Root() {
    const declared = draft.layout ?? [];
    // Paradigms no layout covers. Not a defect and not diagnosed here: a
    // selector the language never declared is a disagreement *between two
    // records*, which the AppView indexes and contests rather than refuses. It
    // is listed because somebody has to be able to open and fix it.
    const uncovered = paradigms.filter((row) => layoutFor(row.selector) === undefined);
    return (
      <>
        <p className="mb-3 text-xs text-content-subtle">{t("grammar.l5RootHint")}</p>
        {declared.length === 0 ? (
          <p className="text-sm text-content-muted">{t("grammar.l5NoLayout")}</p>
        ) : (
          <ul className="space-y-1.5">
            {declared.map((row) => (
              <li key={tagKey(row.category)}>
                <button
                  type="button"
                  onClick={() => setPath({ at: "l5category", category: row.category })}
                  className={levelButton}
                >
                  <span className="text-sm text-content">{categoryText(row.category)}</span>
                  <span className="text-xs text-content-subtle">
                    {t("grammar.l5ParadigmCount", { count: paradigmsUnder(row.category).length })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {uncovered.length > 0 && (
          <div className="mt-4 border-t pt-3">
            <p className="text-xs font-medium text-content">{t("grammar.l5Uncovered")}</p>
            <p className="mt-1 text-xs text-content-subtle">{t("grammar.l5UncoveredHint")}</p>
            <ul className="mt-2 space-y-1.5">
              {uncovered.map((row) => (
                <li key={row.paradigmKey}>
                  <button
                    type="button"
                    onClick={() =>
                      setEditing({
                        selector: row.selector,
                        existing: {
                          paradigmKey: row.paradigmKey,
                          recordURI: row.recordURI,
                          cid: row.cid,
                        },
                      })
                    }
                    className={levelButton}
                  >
                    <span className="font-mono text-xs text-content">
                      {formatTagVerbatim(row.selector)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </>
    );
  }

  /** One layout's paradigms, and the selectors a new one may take. */
  function renderL5Category(category: Tag) {
    const rows = paradigmsUnder(category);
    const taken = new Set(rows.map((row) => tagKey(row.selector)));
    // What a new paradigm may select: the layout's own category, and every
    // combination the language has named that falls under it. The cascade
    // supplies the narrower selectors; the manual field is the way out when it
    // has not named the one this author needs.
    const candidates: Tag[] = [category, ...combinationRows(draft).map((row) => row.tag)].filter(
      (option) => {
        const atoms = new Set(tagAtomKeys(option));
        return (
          !taken.has(tagKey(option)) &&
          tagAtomKeys(category).every((key) => atoms.has(key))
        );
      },
    );
    const seen = new Set<string>();
    const offered = candidates.filter((option) => {
      const key = tagKey(option);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return (
      <>
        <p className="mb-3 text-xs text-content-subtle">{t("grammar.l5CategoryHint")}</p>
        {rows.length === 0 ? (
          <p className="text-sm text-content-muted">{t("grammar.l5NoParadigms")}</p>
        ) : (
          <ul className="space-y-1.5">
            {rows.map((row) => (
              <li key={row.paradigmKey}>
                <button
                  type="button"
                  onClick={() =>
                    setEditing({
                      selector: row.selector,
                      existing: {
                        paradigmKey: row.paradigmKey,
                        recordURI: row.recordURI,
                        cid: row.cid,
                      },
                    })
                  }
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
        {offered.length > 0 && (
          <div className="mt-4 border-t pt-3">
            <p className="text-xs font-medium text-content">{t("grammar.l5AddTitle")}</p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {offered.map((option) => (
                <li key={tagKey(option)}>
                  <button
                    type="button"
                    onClick={() => setEditing({ selector: option })}
                    className="rounded-full border bg-surface-muted/60 px-2.5 py-1 text-xs text-content hover:border-primary hover:text-primary"
                  >
                    + {categoryText(option)}
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-content-subtle">{t("grammar.l5AddHint")}</p>
          </div>
        )}
        <ManualSelector
          onPick={(selector) => setEditing({ selector })}
          disabled={(selector) => taken.has(tagKey(selector))}
        />
      </>
    );
  }

  /** One category's blocks, in order, with a preview of what a reader will see. */
  function renderL4Category(category: Tag) {
    const row = layoutRow(draft, category);
    if (row === undefined) return null;
    const resolved = resolveLayout(draft, row);
    return (
      <>
        <div className="mb-3">
          <p className="text-sm font-medium text-content">{categoryText(category)}</p>
          <p className="mt-1 text-xs text-content-subtle">{t("grammar.l4CategoryHint")}</p>
        </div>
        <ol className="space-y-1.5">
          {row.blocks.map((block, index) => (
            <li key={index} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPath({ at: "l4block", category, index })}
                className={`${levelButton} flex-1`}
              >
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="text-sm text-content">
                    {block.kind === "table" ? t("grammar.l4BlockTable") : t("grammar.l4BlockList")}
                  </span>
                  <span className="truncate font-mono text-xs text-content-subtle">
                    {blockSummaryText(block)}
                  </span>
                </span>
                {block.summary === true && (
                  <span className="shrink-0 text-xs text-primary">
                    {t("grammar.l4SummaryBadge")}
                  </span>
                )}
              </button>
              <button
                type="button"
                disabled={index === 0}
                onClick={() => setDraft(moveBlock(draft, category, index, -1))}
                aria-label={t("grammar.l4MoveEarlier")}
                className="px-1 text-content-subtle hover:text-primary disabled:opacity-30"
              >
                ↑
              </button>
              <button
                type="button"
                disabled={index === row.blocks.length - 1}
                onClick={() => setDraft(moveBlock(draft, category, index, 1))}
                aria-label={t("grammar.l4MoveLater")}
                className="px-1 text-content-subtle hover:text-primary disabled:opacity-30"
              >
                ↓
              </button>
            </li>
          ))}
        </ol>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setDraft(addBlock(draft, category, "table"))}
            className="rounded-lg border px-3 py-1.5 text-xs text-content hover:border-primary"
          >
            {t("grammar.l4AddTable")}
          </button>
          <button
            type="button"
            onClick={() => setDraft(addBlock(draft, category, "list"))}
            className="rounded-lg border px-3 py-1.5 text-xs text-content hover:border-primary"
          >
            {t("grammar.l4AddList")}
          </button>
        </div>

        {/* The preview runs through the *same* resolver the viewer will use, so
            what is checked here is the shipped arithmetic and not a second
            drawing of it. */}
        <div className="mt-4 border-t pt-3">
          <p className="text-xs font-medium text-content">{t("grammar.l4PreviewTitle")}</p>
          <div className="mt-2 space-y-3">
            {resolved.map((block, index) => (
              <LayoutBlockView key={index} block={block} />
            ))}
          </div>
        </div>

        <div className="mt-4 border-t pt-3">
          <button
            type="button"
            onClick={() => {
              setDraft(removeLayout(draft, category));
              setPath({ at: "l4root" });
            }}
            className="text-sm text-red-600 hover:text-red-700"
          >
            {t("grammar.l4WithdrawLayout")}
          </button>
        </div>
      </>
    );
  }

  /** A one-line description of a block, for the list above. */
  function blockSummaryText(block: { kind: string; rows?: string[]; columns?: string[]; items?: { coords: LayoutCoord[] }[]; fixed?: LayoutCoord[] }): string {
    const fixed = (block.fixed ?? []).map((c) => `${c.feature}=${c.value}`).join("|");
    const body =
      block.kind === "table"
        ? [...(block.rows ?? []), ...(block.columns ?? [])].join(" × ")
        : `${(block.items ?? []).length}`;
    const text = [fixed, body].filter((part) => part !== "" && part !== "0").join(" · ");
    return text === "" ? t("grammar.l4BlockEmpty") : text;
  }

  /**
   * One block's editor. The grid is resolved with the block's **exclusions set
   * aside**, so an excluded cell is still drawn and can be put back — a designer
   * where excluding a cell removed the only way to undo it would be a trap.
   */
  function renderL4Block(category: Tag, index: number) {
    const row = layoutRow(draft, category);
    const block = row?.blocks[index];
    if (row === undefined || block === undefined) return null;
    const axes = applicableAxes(draft, [category]);

    const summaryToggle = (
      <label className="mt-4 flex items-start gap-2 border-t pt-3">
        <input
          type="checkbox"
          className="mt-1"
          checked={block.summary === true}
          onChange={() => setDraft(toggleBlockSummary(draft, category, index))}
        />
        <span>
          <span className="text-sm text-content">{t("grammar.l4SummaryToggle")}</span>
          <span className="mt-0.5 block text-xs text-content-subtle">
            {t("grammar.l4SummaryHint")}
          </span>
        </span>
      </label>
    );

    const removeBlockButton = (
      <div className="mt-4 border-t pt-3">
        <button
          type="button"
          onClick={() => {
            setDraft(removeBlock(draft, category, index));
            setPath(row.blocks.length === 1 ? { at: "l4root" } : { at: "l4category", category });
          }}
          className="text-sm text-red-600 hover:text-red-700"
        >
          {t("grammar.l4RemoveBlock")}
        </button>
        {row.blocks.length === 1 && (
          <p className="mt-1 text-xs text-content-subtle">{t("grammar.l4RemoveLast")}</p>
        )}
      </div>
    );

    if (block.kind === "list") {
      const items = block.items ?? [];
      return (
        <>
          <p className="mb-3 text-xs text-content-subtle">{t("grammar.l4ItemHint")}</p>
          <p className="text-xs font-medium text-content">{t("grammar.l4ItemsTitle")}</p>
          {items.length === 0 ? (
            <p className="mt-2 text-sm text-content-muted">{t("grammar.l4NoItems")}</p>
          ) : (
            <ol className="mt-2 space-y-1.5">
              {items.map((item, i) => (
                <li
                  key={i}
                  className="flex items-center gap-2 rounded-lg border bg-surface px-3 py-2"
                >
                  <span className="w-5 text-xs text-content-subtle">{i + 1}.</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-content">
                    {item.coords.map((c) => `${c.feature}=${c.value}`).join("|")}
                  </span>
                  <button
                    type="button"
                    disabled={i === 0}
                    onClick={() => setDraft(moveListItem(draft, category, index, i, -1))}
                    aria-label={t("grammar.l4MoveEarlier")}
                    className="px-1 text-content-subtle hover:text-primary disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={i === items.length - 1}
                    onClick={() => setDraft(moveListItem(draft, category, index, i, 1))}
                    aria-label={t("grammar.l4MoveLater")}
                    className="px-1 text-content-subtle hover:text-primary disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraft(removeListItem(draft, category, index, i))}
                    aria-label={t("grammar.l4RemoveItem")}
                    className="px-1 text-content-subtle hover:text-red-600"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ol>
          )}
          <AddressPicker
            id={`layout-manual-${index}`}
            axes={axes}
            onAdd={(coords) => setDraft(addListItem(draft, category, index, coords))}
          />
          {summaryToggle}
          {removeBlockButton}
        </>
      );
    }

    const onRows = block.rows ?? [];
    const onColumns = block.columns ?? [];
    const placed = new Set([...onRows, ...onColumns]);
    // Resolved without exclusions: every cell of the declared product is drawn,
    // and `excludesCell` says which of them the record removes.
    const grid = resolveLayout(draft, {
      category,
      blocks: [blockWithoutExclusions(block)],
    })[0] as ResolvedLayoutTable;
    const fixedFeatures = new Set((block.fixed ?? []).map((coord) => coord.feature));
    /** A cell's coordinates minus the block's constants — what an exclusion names. */
    const axisCoords = (cell: LayoutAddress): LayoutCoord[] =>
      cell.coords.filter((coord) => !fixedFeatures.has(coord.feature));

    return (
      <>
        {(["rows", "columns"] as const).map((dimension) => {
          const on = dimension === "rows" ? onRows : onColumns;
          return (
            <div key={dimension} className="mb-3">
              <p className="text-xs font-medium text-content">
                {dimension === "rows" ? t("grammar.l4RowsTitle") : t("grammar.l4ColumnsTitle")}
              </p>
              <ol className="mt-1 flex flex-wrap items-center gap-1.5">
                {on.map((feature, i) => (
                  <li key={feature} className="flex items-center gap-1 rounded-full border bg-surface px-2 py-0.5">
                    <span className="font-mono text-xs text-content">{feature}</span>
                    <button
                      type="button"
                      disabled={i === 0}
                      onClick={() =>
                        setDraft(moveBlockAxis(draft, category, index, dimension, feature, -1))
                      }
                      aria-label={t("grammar.l4MoveEarlier")}
                      className="text-content-subtle hover:text-primary disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={i === on.length - 1}
                      onClick={() =>
                        setDraft(moveBlockAxis(draft, category, index, dimension, feature, 1))
                      }
                      aria-label={t("grammar.l4MoveLater")}
                      className="text-content-subtle hover:text-primary disabled:opacity-30"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setDraft(toggleBlockAxis(draft, category, index, dimension, feature))
                      }
                      aria-label={t("grammar.l4RemoveItem")}
                      className="text-content-subtle hover:text-red-600"
                    >
                      ×
                    </button>
                  </li>
                ))}
                {axes
                  .filter((axis) => !placed.has(axis.feature.feature))
                  .map((axis) => (
                    <li key={axis.feature.feature}>
                      <button
                        type="button"
                        onClick={() =>
                          setDraft(
                            toggleBlockAxis(draft, category, index, dimension, axis.feature.feature),
                          )
                        }
                        title={axis.feature.label.long}
                        className="rounded-full border border-dashed px-2.5 py-1 font-mono text-xs text-content-muted hover:border-primary hover:text-primary"
                      >
                        + {axis.feature.feature}
                      </button>
                    </li>
                  ))}
              </ol>
            </div>
          );
        })}
        <p className="text-xs text-content-subtle">{t("grammar.l4DimensionHint")}</p>

        {/* Pinning: an axis not on a dimension may be fixed to one value, which
            is how one paradigm becomes several tables. */}
        {axes.some((axis) => !placed.has(axis.feature.feature)) && (
          <div className="mt-4 border-t pt-3">
            <p className="text-xs font-medium text-content">{t("grammar.l4FixedTitle")}</p>
            {axes
              .filter((axis) => !placed.has(axis.feature.feature))
              .map((axis) => {
                const current = (block.fixed ?? []).find(
                  (coord) => coord.feature === axis.feature.feature,
                );
                return (
                  <div key={axis.feature.feature} className="mt-2">
                    <p className="text-xs text-content-subtle">{axis.feature.label.long}</p>
                    <ul className="mt-1 flex flex-wrap gap-1.5">
                      {axis.values.map((value) => {
                        const active = current?.value === value.value;
                        return (
                          <li key={value.value}>
                            <button
                              type="button"
                              onClick={() =>
                                setDraft(
                                  setBlockFixed(
                                    draft,
                                    category,
                                    index,
                                    axis.feature.feature,
                                    active ? null : value.value,
                                  ),
                                )
                              }
                              title={value.label.long}
                              className={
                                active
                                  ? "rounded-full border border-primary bg-surface px-2.5 py-1 text-xs font-medium text-primary"
                                  : "rounded-full border border-dashed px-2.5 py-1 text-xs text-content-muted hover:border-primary hover:text-primary"
                              }
                            >
                              {value.label.short ?? value.label.long}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            <p className="mt-1 text-xs text-content-subtle">{t("grammar.l4FixedHint")}</p>
          </div>
        )}

        <div className="mt-4 border-t pt-3">
          {placed.size === 0 ? (
            <p className="text-sm text-content-muted">{t("grammar.l4NoDimensions")}</p>
          ) : grid.cells.length === 0 ? (
            <p className="text-sm text-content-muted">{t("grammar.l4TooLarge")}</p>
          ) : (
            <>
              <p className="text-xs text-content-subtle">{t("grammar.l4CellHint")}</p>
              <LayoutBlockView
                block={grid}
                excluded={(cell) => excludesCell(block, axisCoords(cell))}
                onCell={(cell) =>
                  setDraft(toggleExcludedCell(draft, category, index, axisCoords(cell)))
                }
              />
            </>
          )}
        </div>
        {summaryToggle}
        {removeBlockButton}
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
              className="text-sm text-red-600 hover:text-red-700"
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
            : path.at === "l2combinationForm"
              ? formatTagVerbatim(path.tag)
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
            : path.at === "l2combinationForm"
              ? findCombination(draft, path.tag)
              : undefined;
    const isUdPos = path.at === "posForm" && HEADWORD_UPOS.some((u) => u.value === path.value);
    // A combination is never minted — provenance rides on its items, which
    // are already bound each with its own scheme — so the mint section is
    // simply not offered.
    const mintable = !isUdPos && path.at !== "l2combinationForm";

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
                const scheme = "scheme" in existing ? existing.scheme : undefined;
                if (path.at === "posForm") {
                  setDraft(removePos(draft, path.value, scheme));
                  setPath({ at: "pos" });
                } else if (path.at === "valueForm") {
                  setDraft(removeValue(draft, path.feature, path.value, scheme));
                  setPath({ at: "values", feature: path.feature });
                } else if (path.at === "l2combinationForm") {
                  // The label goes; the combination's parts stay bound, so it
                  // simply renders by decomposition again.
                  setDraft(removeCombination(draft, path.tag));
                  setPath({ at: "l2feature", category: path.category, feature: path.feature });
                }
              }}
              className="text-sm text-red-600 hover:text-red-700"
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
        return renderL2Category(path.category);
      case "l2feature":
        return renderL2Feature(path.category, path.feature);
      case "l3root":
        return renderL3Root();
      case "l3category":
        return renderL3Category(path.category);
      case "l3feature":
        return renderL3Feature(path.category, path.feature);
      case "l4root":
        return renderL4Root();
      case "l4category":
        return renderL4Category(path.category);
      case "l4block":
        return renderL4Block(path.category, path.index);
      case "l5root":
        return renderL5Root();
      case "l5category":
        return renderL5Category(path.category);
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
              aria-selected={tab === "combinations"}
              onClick={() => setPath({ at: "l2root" })}
              className={
                tab === "combinations"
                  ? "rounded-full border border-primary bg-surface px-3 py-1 text-xs font-medium text-primary"
                  : "rounded-full border px-3 py-1 text-xs text-content-subtle hover:border-primary hover:text-primary"
              }
            >
              {t("grammar.tabCombinations")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "axes"}
              onClick={() => setPath({ at: "l3root" })}
              className={
                tab === "axes"
                  ? "rounded-full border border-primary bg-surface px-3 py-1 text-xs font-medium text-primary"
                  : "rounded-full border px-3 py-1 text-xs text-content-subtle hover:border-primary hover:text-primary"
              }
            >
              {t("grammar.tabAxes")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "layout"}
              onClick={() => setPath({ at: "l4root" })}
              className={
                tab === "layout"
                  ? "rounded-full border border-primary bg-surface px-3 py-1 text-xs font-medium text-primary"
                  : "rounded-full border px-3 py-1 text-xs text-content-subtle hover:border-primary hover:text-primary"
              }
            >
              {t("grammar.tabLayout")}
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
              {defects.length > 0 && (
                <div className="mb-2 text-sm text-red-600">
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
              {error !== null && <p className="mb-2 text-sm text-red-600">{error}</p>}
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
          tag={tag}
          grammar={draft}
          lookup={grammarLookup(draft)}
          selector={editing.selector}
          existing={editing.existing}
          onClose={() => setEditing(null)}
          onPublished={() => {
            setEditing(null);
            // The write is on the author's PDS; the AppView learns of it from
            // the firehose, so this list catches up on the next open rather
            // than immediately. Re-asking costs one request and is right
            // whenever it has.
            void fetchLanguageParadigms(tag)
              .then(setParadigms)
              .catch(() => undefined);
          }}
        />
      )}
    </div>
  );
}

/**
 * Naming a selector the language has not combined — the degrade-to-manual path,
 * as everywhere else in this dialog. Offered always, because a paradigm may key
 * on a bundle nobody thought to name as a headword category.
 */
function ManualSelector({
  onPick,
  disabled,
}: {
  onPick: (selector: Tag) => void;
  disabled: (selector: Tag) => boolean;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const parsed = parseTagInput(value.trim());
  const valid = parsed !== null && !disabled(parsed);
  return (
    <div className="mt-4 border-t pt-3">
      <label className="block text-xs text-content-subtle" htmlFor="paradigm-selector-manual">
        {t("grammar.l5ManualLabel")}
      </label>
      <div className="mt-1 flex gap-2">
        <input
          id="paradigm-selector-manual"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t("grammar.l5ManualPlaceholder")}
          className={inputClass}
        />
        <button
          type="button"
          disabled={!valid}
          onClick={() => {
            if (parsed === null) return;
            onPick(parsed);
            setValue("");
          }}
          className="shrink-0 rounded-lg border px-3 py-2 text-sm text-content hover:border-primary disabled:opacity-50"
        >
          {t("grammar.add")}
        </button>
      </div>
    </div>
  );
}

const levelButton =
  "flex w-full items-center justify-between gap-3 rounded-lg border bg-surface px-3 py-2 text-left hover:border-primary";

/** A cell's identifier, as UD writes it — what a contributor reads in the grid. */
function addressText(cell: LayoutAddress): string {
  return formatTagVerbatim(cell.tag);
}

/**
 * One resolved block, drawn with identifiers in its cells — the designer's view
 * of a paradigm, as against the reader's, which puts forms there instead. Both
 * go through the same table component, so the preview cannot drift from the page
 * it previews.
 *
 * `excluded`/`onCell` are the block editor's: clicking a cell is how a language
 * says it has no such form.
 */
function LayoutBlockView({
  block,
  excluded,
  onCell,
}: {
  block: ResolvedLayoutBlock;
  excluded?: (cell: LayoutAddress) => boolean;
  onCell?: (cell: LayoutAddress) => void;
}) {
  const { t } = useTranslation();
  if (block.kind === "list") {
    return (
      <ParadigmList
        list={block}
        item={(address) => (
          <span className="font-mono text-xs text-content-subtle">{addressText(address)}</span>
        )}
      />
    );
  }
  // No lines at all: dimensions naming nothing the language still declares, or a
  // block past the cell cap. Say so rather than drawing an empty frame.
  if (block.cells.length === 0) {
    return (
      <div>
        <BlockCaption caption={block.caption} />
        <p className="text-sm text-content-muted">{t("grammar.l4BlockEmpty")}</p>
      </div>
    );
  }
  return (
    <ParadigmTable
      table={block}
      cell={(address) => {
        const off = excluded?.(address) === true;
        const body = (
          <span
            className={
              off ? "font-mono text-[10px] line-through opacity-50" : "font-mono text-[10px]"
            }
          >
            {addressText(address)}
          </span>
        );
        if (onCell === undefined) return body;
        return (
          <button
            type="button"
            onClick={() => onCell(address)}
            title={off ? t("grammar.l4CellExcluded") : addressText(address)}
            className="text-left hover:text-primary"
          >
            {body}
          </button>
        );
      }}
    />
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
