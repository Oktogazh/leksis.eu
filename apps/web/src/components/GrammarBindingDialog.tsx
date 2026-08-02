import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  grammarDiff,
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
  type GrammarLabel,
  type GrammarReference,
  type LeksisLanguageRecord,
  type Tag,
} from "@leksis/types";
import { fetchFeatureNames, fetchFeatureValues, type UdValue } from "@leksis/ud";
import { useSession } from "../auth/SessionProvider";
import { fetchCurrentLanguageRecord } from "../lib/api";
import { fetchLanguageRecord } from "../lib/atproto-record";
import {
  addInherent,
  featureRows,
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
  | { at: "feature"; feature: string }
  | { at: "featureForm"; feature: string }
  | { at: "values"; feature: string }
  | { at: "valueForm"; feature: string; value: string }
  // Layer 2 — the same shape one level up: pick a category, declare which
  // features are inherent to it, then the combinations for a declared feature
  // become available to name.
  | { at: "l2root" }
  | { at: "l2category"; category: Tag }
  | { at: "l2feature"; category: Tag; feature: string }
  | { at: "l2combinationForm"; category: Tag; feature: string; tag: Tag };

/** Which tab a path belongs to — the tab strip is derived, never stored. */
function pathTab(path: Path): "primitives" | "combinations" {
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
  useEffect(() => {
    if (valuesFeature === null) return;
    const controller = new AbortController();
    setUdValues([]);
    setUdLoading(true);
    fetchFeatureValues(valuesFeature, controller.signal)
      .then((result) => setUdValues(result.values))
      .finally(() => setUdLoading(false));
    return () => controller.abort();
  }, [valuesFeature]);

  /**
   * The no-orphan guard. Only defects this edit *introduces* block the write:
   * a record that arrived already incoherent has to stay editable, or it can
   * never be repaired.
   */
  const introduced = useMemo(
    () => grammarDiff(record?.grammar, draft).introduced,
    [record, draft],
  );

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
    setForm(
      existing === undefined
        ? emptyLabel
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

    if (path.at === "posForm") {
      setDraft(upsertPos(draft, { value: path.value, label, ...extra }));
      setPath({ at: "pos" });
    } else if (path.at === "featureForm") {
      setDraft(upsertFeature(draft, { feature: path.feature, label, ...extra }));
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

      const hasRows =
        (draft.pos ?? []).length > 0 ||
        (draft.features ?? []).length > 0 ||
        (draft.values ?? []).length > 0;
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
  const crumbs: { label: string; go: Path }[] =
    tab === "combinations"
      ? [{ label: t("grammar.crumbL2Root"), go: { at: "l2root" } }]
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
  } else if (path.at !== "root" && path.at !== "l2root") {
    crumbs.push({ label: t("grammar.featuresLevel"), go: { at: "features" } });
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
              {t("grammar.featuresCount", { count: featureRows(draft).length })}
            </span>
          </button>
        </li>
      </ul>
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
        {featureRows(draft).length === 0 ? (
          <p className="text-sm text-content-muted">{t("grammar.featuresEmpty")}</p>
        ) : (
          <ul className="space-y-1.5">
            {featureRows(draft).map((row) => (
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
                setPath({ at: "features" });
              }}
              className="text-sm text-red-600 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("grammar.unbindFeature")}
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
    return (
      <>
        <p className="mb-3 text-xs text-content-subtle">{t("grammar.valuesHint", { feature })}</p>
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
                    {row.scheme !== undefined && (
                      <span className="text-xs text-amber-600">{t("grammar.mintedBadge")}</span>
                    )}
                  </span>
                  <span className="text-sm text-content">{row.label.short ?? row.label.long}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <Candidates
          title={t("grammar.udValues")}
          loading={udLoading}
          items={udValues
            .filter((v) => findValue(draft, feature, v.value) === undefined)
            .map((v) => ({ key: v.value, label: v.value, hint: v.gloss }))}
          onPick={(value) => openForm({ at: "valueForm", feature, value })}
        />
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
              <li key={tagKey(row.tag)}>
                <button
                  type="button"
                  onClick={() => setPath({ at: "l2category", category: row.tag })}
                  className={levelButton}
                >
                  <span className="text-sm text-content">{row.label.short ?? row.label.long}</span>
                  <span className="text-xs text-content-subtle">
                    {t("grammar.l2InherentCount", { count: inherentRows(draft, row.tag).length })}
                  </span>
                </button>
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
    const available = featureRows(draft).filter((row) => !declaredNames.has(row.feature));
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
              {introduced.length > 0 && (
                <p className="mb-2 text-sm text-red-600">
                  {t("grammar.errors.orphans", {
                    rows: introduced.map((i) => i.feature ?? i.key).join(", "),
                  })}
                </p>
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
                  disabled={submitting || !dirty || introduced.length > 0 || !agent}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-fg hover:bg-primary-hover disabled:opacity-50"
                >
                  {submitting ? t("grammar.publishing") : t("grammar.publish")}
                </button>
              </div>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

const levelButton =
  "flex w-full items-center justify-between gap-3 rounded-lg border bg-surface px-3 py-2 text-left hover:border-primary";

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
  pattern: RegExp;
  hint: string;
  onAdd: (value: string) => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const valid = pattern.test(value.trim());
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
