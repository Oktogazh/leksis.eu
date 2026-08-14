// Contract for grammatical tags — the machine-readable half of the grammar
// layer (docs/design/grammatical-tagging.md, layer 1).
//
// A tag is what an entry record carries; the *label* a reader sees lives on
// the language record, which binds `tag → {long, short}`. The two never
// coexist on one item: a tag is an identifier, never reader-facing text, so
// nothing here produces prose in anyone's language.
//
// Vocabulary comes from Universal Dependencies, and only UD. Where UD has no
// term for something a language needs, the escape hatch is a **minted** item —
// `scheme` set to the minting language's BCP 47 tag — which UD's own extension
// licence allows: "UD treebanks may use additional features and values if they
// are properly documented" (universaldependencies.org/u/feat/index.html).
// Nothing in this file enumerates a vocabulary: it validates *shape*, so a
// language may bind any well-formed item without the AppView adjudicating
// whether that item is real.

/**
 * Provenance of an item whose `scheme` is absent: documented somewhere on
 * universaldependencies.org — which includes the universal inventory, the
 * non-universal features with a global page (`Subcat`), and the
 * language-specific ones in treebank documentation. Any other value is the
 * BCP 47 tag of the language that minted the item.
 */
export const UD_SCHEME = "ud";

/**
 * UD's feature-name grammar, verified at source (format.html): "Feature names
 * must have the form `[A-Z][A-Za-z0-9]*(\[[a-z0-9]+\])?`". The optional
 * bracketed suffix is a *layered* name — `Number[psor]`, the number of a
 * possessor rather than of the word itself.
 */
export const FEATURE_NAME_PATTERN = /^[A-Z][A-Za-z0-9]*(\[[a-z0-9]+\])?$/;

/**
 * UD's feature-value grammar, verified at source (format.html): "feature
 * values must have the form `[A-Z0-9][A-Za-z0-9]*`". Note a value may begin
 * with a digit, so a minted `Conjugation=1` is well-formed UD shape and needs
 * no workaround. `_` is excluded by the pattern: in CoNLL-U it marks an empty
 * FEATS field, so it is never a value.
 */
export const FEATURE_VALUE_PATTERN = /^[A-Z0-9][A-Za-z0-9]*$/;

/**
 * Shape required of a part-of-speech name. **A Leksis rule, not UD's**: UD
 * publishes no grammar for POS names (its own 17 are bare uppercase) and no
 * extension policy either way, so this constrains only what a language may
 * mint, and deliberately mirrors the feature-name shape.
 */
export const POS_VALUE_PATTERN = /^[A-Z][A-Za-z0-9]*$/;

/**
 * The most `Feature=Value` items one bundle may carry, mirroring the
 * `maxLength` its `feats` array declares in `lexicons/eu.leksis.defs.json`.
 *
 * The lexicon's limit is validation, not documentation (ADR-0015): a bundle past
 * it is not a tag of this lexicon, so no editor could have written it. Real
 * bundles are two or three items — this is a ceiling, not a target, and it binds
 * every site a tag appears at, on an entry as much as on a language record.
 */
export const MAX_TAG_FEATS = 32;

/** Separator between the features of a bundle in UD's FEATS serialisation. */
export const FEATS_SEPARATOR = "|";

/** Separator between the values of one multivalue feature (`Gender=Fem,Masc`). */
export const FEATS_VALUE_SEPARATOR = ",";

/** A part-of-speech item: one of UD's 17, or a POS a language minted. */
export interface TagUpos {
  value: string;
  /** Absent = documented by UD; otherwise the BCP 47 tag that minted it. */
  scheme?: string;
}

/**
 * One `Feature=Value` item. `scheme` qualifies the pair as a whole, which is
 * what makes a minted value on a UD feature expressible: `Number=Sgv` with
 * scheme `br` says UD owns `Number` and Breton owns `Sgv`.
 */
export interface TagFeat {
  feature: string;
  /** One value, or several comma-separated ones for a multivalue item. */
  value: string;
  scheme?: string;
}

/**
 * A grammatical tag: a **bundle**, not an atom, because languages abbreviate
 * at different granularities — French `nf.` is one label for NOUN + Gender=Fem
 * where Breton uses two. At least one of `upos`/`feats` is present.
 *
 * Provenance rides on each **item**, never on the bundle: a bundle-level
 * scheme could not describe `{NOUN (ud), Number=Sgv (br)}`, and marking the
 * whole thing `br` would break matching against `ud`-scheme bindings and leave
 * an exporter unable to tell which halves are exportable.
 */
export interface Tag {
  upos?: TagUpos;
  feats?: TagFeat[];
}

/** The scheme an item is in, with the default made explicit. */
export function tagScheme(item: { scheme?: string }): string {
  return item.scheme === undefined || item.scheme === "" ? UD_SCHEME : item.scheme;
}

/** The individual values of a (possibly multivalue) feature item. */
export function featValues(feat: TagFeat): string[] {
  return feat.value.split(FEATS_VALUE_SEPARATOR);
}

/**
 * UD's sort order, verified at source (format.html): features are "sorted
 * alphabetically by attribute names" and multiple values "are sorted
 * alphabetically", where "uppercase letters are considered identical to their
 * lowercase counterparts". Case therefore cannot break ties, so an exact
 * comparison follows it to keep the ordering total (and the key stable).
 */
function compareUd(a: string, b: string): number {
  const folded = a.toLowerCase().localeCompare(b.toLowerCase(), "en");
  if (folded !== 0) return folded;
  return a < b ? -1 : a > b ? 1 : 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether an unknown value is a well-formed part-of-speech item. */
export function isValidTagUpos(value: unknown): value is TagUpos {
  if (!isPlainObject(value)) return false;
  if (typeof value.value !== "string" || !POS_VALUE_PATTERN.test(value.value)) return false;
  return value.scheme === undefined || (typeof value.scheme === "string" && value.scheme !== "");
}

/** Whether an unknown value is a well-formed `Feature=Value` item. */
export function isValidTagFeat(value: unknown): value is TagFeat {
  if (!isPlainObject(value)) return false;
  if (typeof value.feature !== "string" || !FEATURE_NAME_PATTERN.test(value.feature)) return false;
  if (typeof value.value !== "string" || value.value === "") return false;
  // Every part of a multivalue item must itself be a well-formed value.
  if (!value.value.split(FEATS_VALUE_SEPARATOR).every((v) => FEATURE_VALUE_PATTERN.test(v))) {
    return false;
  }
  return value.scheme === undefined || (typeof value.scheme === "string" && value.scheme !== "");
}

/**
 * Whether an unknown value is a well-formed tag. Shape and cardinality only —
 * a tag is never rejected for naming something absent from a UD snapshot, since
 * the whole point of the layer is that a language may declare vocabulary UD has
 * not; a bundle past `MAX_TAG_FEATS` is rejected, because the lexicon says a
 * bundle that size does not exist.
 */
export function isValidTag(value: unknown): value is Tag {
  if (!isPlainObject(value)) return false;
  if (value.upos !== undefined && !isValidTagUpos(value.upos)) return false;
  if (value.feats !== undefined) {
    if (!Array.isArray(value.feats) || value.feats.length > MAX_TAG_FEATS) return false;
    if (!value.feats.every(isValidTagFeat)) return false;
  }
  const feats = Array.isArray(value.feats) ? value.feats : [];
  return value.upos !== undefined || feats.length > 0;
}

/**
 * The canonical key of a tag: the string two tags are equal on. Bundle
 * equality *must* be computed on this rather than on the literal object, or
 * matching silently fails whenever two authors listed the same items in a
 * different order.
 *
 * It normalises the four things that can differ without the tag differing:
 * the part of speech gets its own slot (UPOS is its own CoNLL-U column, never
 * a feature); features are sorted by name; a multivalue item's values are
 * sorted; and an absent `scheme` is written out as `ud`, so `{value:"NOUN"}`
 * and `{value:"NOUN",scheme:"ud"}` cannot key differently.
 *
 * **Derived, never stored on a record.** It may appear in ArangoDB, which is
 * rebuildable, and its format may change without a lexicon break.
 */
export function tagKey(tag: Tag): string {
  const parts: string[] = [];
  if (tag.upos !== undefined) {
    // Lowercase prefix, so this can never collide with a feature item: UD
    // feature names must begin with an uppercase letter.
    parts.push(`upos=${tagScheme(tag.upos)}:${tag.upos.value}`);
  }
  const feats = (tag.feats ?? []).map((feat) => {
    const values = [...featValues(feat)].sort(compareUd).join(FEATS_VALUE_SEPARATOR);
    return `${tagScheme(feat)}:${feat.feature}=${values}`;
  });
  feats.sort(compareUd);
  return [...parts, ...feats].join(FEATS_SEPARATOR);
}

/** The canonical key of a bare feature *name* — an axis, not a tag. */
export function featureKey(feature: { feature: string; scheme?: string }): string {
  return `name=${tagScheme(feature)}:${feature.feature}`;
}

/**
 * The tag written the way UD writes it: the part of speech, then the FEATS
 * string, features alphabetical. This is the **last** resort of the viewer's
 * resolution chain — shown only when nothing about the tag has been bound, and
 * always styled as unbound.
 *
 * It must never be dressed up as prose: an untranslated identifier reads as
 * "this needs binding", which is the wanted signal, whereas UD's English
 * documentation name would look like content and breach the homolingual rule.
 * `scheme` is provenance and is deliberately not shown.
 */
export function formatTagVerbatim(tag: Tag): string {
  const feats = (tag.feats ?? [])
    .map((feat) => ({
      sort: feat.feature,
      text: `${feat.feature}=${[...featValues(feat)].sort(compareUd).join(FEATS_VALUE_SEPARATOR)}`,
    }))
    .sort((a, b) => compareUd(a.sort, b.sort))
    .map((f) => f.text)
    .join(FEATS_SEPARATOR);
  if (tag.upos === undefined) return feats;
  return feats === "" ? tag.upos.value : `${tag.upos.value} ${feats}`;
}

/**
 * Parse a tag typed by hand — `NOUN`, `Gender=Fem`, `NOUN|Gender=Fem` — in
 * UD's own notation, items separated by `|` or whitespace. This is the
 * degrade-to-manual path: it is what keeps authoring possible when the live UD
 * candidate lists cannot be fetched, so it must never depend on them.
 *
 * **It never infers provenance.** Every item comes back without a `scheme`,
 * i.e. claiming UD; assigning the minting language's tag is the caller's job,
 * and a UI that skips it silently mislabels a minted item as documented.
 * Returns null when the input is not well-formed.
 */
export function parseTagInput(input: string): Tag | null {
  const tokens = input
    .split(/[|\s]+/)
    .map((token) => token.trim())
    .filter((token) => token !== "");
  if (tokens.length === 0) return null;

  let upos: TagUpos | undefined;
  const feats: TagFeat[] = [];
  for (const token of tokens) {
    const eq = token.indexOf("=");
    if (eq === -1) {
      if (upos !== undefined) return null; // a bundle has at most one part of speech
      if (!POS_VALUE_PATTERN.test(token)) return null;
      upos = { value: token };
      continue;
    }
    const feat: TagFeat = { feature: token.slice(0, eq), value: token.slice(eq + 1) };
    if (!isValidTagFeat(feat)) return null;
    feats.push(feat);
  }
  return { ...(upos !== undefined ? { upos } : {}), ...(feats.length > 0 ? { feats } : {}) };
}
