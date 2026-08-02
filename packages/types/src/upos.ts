// UD's part-of-speech inventory, and the documentation links derivable from a
// tag. Layer 1 of the grammar layer (docs/design/grammatical-tagging.md).
//
// This is the one place a UD vocabulary is embedded in Leksis, and it is
// embedded because it is *closed* and stable since UD v2 — 17 tags, its own
// CoNLL-U column, not a feature. The FEATS value inventories are deliberately
// NOT embedded: 27 features, hundreds of values, released twice a year, and a
// stale snapshot used as a validator would reject vocabulary UD has since
// added. Absence already means "unbound", which is what the rendering fallback
// depends on.
//
// Fetched from https://universaldependencies.org/u/pos/ on 2026-08-02.

import { UD_SCHEME } from "./tag.js";

/**
 * One part-of-speech tag with UD's own English gloss.
 *
 * The gloss is **UI chrome, never entry content**: it is shown to a
 * contributor choosing what to bind, in the reader's interface language, so
 * the homolingual rule (entry text is written in the entry's own language) is
 * untouched. It is also a real deliverable rather than decoration — without
 * it, a non-linguist cannot tell which row means "noun".
 */
export interface UposTag {
  value: string;
  /** UD's short English name for the tag, verbatim from `u/pos/`. */
  gloss: string;
}

/** Open class words. */
export const UPOS_OPEN_CLASS: readonly UposTag[] = [
  { value: "ADJ", gloss: "adjective" },
  { value: "ADV", gloss: "adverb" },
  { value: "INTJ", gloss: "interjection" },
  { value: "NOUN", gloss: "noun" },
  { value: "PROPN", gloss: "proper noun" },
  { value: "VERB", gloss: "verb" },
];

/** Closed class words. */
export const UPOS_CLOSED_CLASS: readonly UposTag[] = [
  { value: "ADP", gloss: "adposition" },
  { value: "AUX", gloss: "auxiliary" },
  { value: "CCONJ", gloss: "coordinating conjunction" },
  { value: "DET", gloss: "determiner" },
  { value: "NUM", gloss: "numeral" },
  { value: "PART", gloss: "particle" },
  { value: "PRON", gloss: "pronoun" },
  { value: "SCONJ", gloss: "subordinating conjunction" },
];

/** Other — the three that never head a dictionary entry. */
export const UPOS_OTHER: readonly UposTag[] = [
  { value: "PUNCT", gloss: "punctuation" },
  { value: "SYM", gloss: "symbol" },
  { value: "X", gloss: "other" },
];

/** UD's complete part-of-speech inventory: exactly 17 tags, in UD's own groups. */
export const UPOS_TAGS: readonly UposTag[] = [
  ...UPOS_OPEN_CLASS,
  ...UPOS_CLOSED_CLASS,
  ...UPOS_OTHER,
];

/**
 * The tags a dictionary headword may take: the 17 minus PUNCT, SYM and X.
 *
 * **A Leksis editorial judgement, not UD's.** The POS page states no
 * eligibility policy and no extension policy either way; it says only that to
 * distinguish further properties one should "use the universal features"
 * rather than invent tags. Excluding the three is our call about what a
 * dictionary entry is, and a language may still mint a part of speech when
 * none of the 17 fits.
 */
export const HEADWORD_UPOS: readonly UposTag[] = [...UPOS_OPEN_CLASS, ...UPOS_CLOSED_CLASS];

/** UD's gloss for a tag, or undefined for a minted one. */
export function uposGloss(value: string): string | undefined {
  return UPOS_TAGS.find((tag) => tag.value === value)?.gloss;
}

/**
 * Documentation URL for a part of speech, or null for a minted one — whose
 * source is not derivable, which is exactly why a minted row carries its own
 * `references`. Storing a URL for a UD item would only rot; it is computed.
 */
export function uposDocUrl(upos: { value: string; scheme?: string }): string | null {
  const scheme = upos.scheme === undefined || upos.scheme === "" ? UD_SCHEME : upos.scheme;
  if (scheme !== UD_SCHEME) return null;
  return `https://universaldependencies.org/u/pos/${upos.value}.html`;
}

/**
 * Documentation URL for a feature, or null for a minted one. A layered name
 * (`Number[psor]`) is documented on its base feature's page, so the layer is
 * stripped.
 */
export function featureDocUrl(feature: { feature: string; scheme?: string }): string | null {
  const scheme =
    feature.scheme === undefined || feature.scheme === "" ? UD_SCHEME : feature.scheme;
  if (scheme !== UD_SCHEME) return null;
  const base = feature.feature.replace(/\[[a-z0-9]+\]$/, "");
  return `https://universaldependencies.org/u/feat/${base}.html`;
}
