// Live candidate lists from the Universal Dependencies documentation.
//
// The binding editor offers a contributor what UD currently documents so they
// pick rather than type — which dissolves the question of what any feature's
// value list "really" is: the page says, and the contributor calls the shot.
// Nothing here is transcribed into code, so no inventory in this repo can go
// stale, and the AppView never rejects a tag for being absent from a snapshot.
//
// **The candidate list widens the search, it never narrows it.** A contributor
// binding their language's grammar is served by seeing everything UD has a term
// for and choosing; they are not served by a shorter list that decided for them.
// So nothing here is scoped to a language, a tier or a treebank — a language's
// grammar is what its speakers declare, not what a corpus happened to attest,
// and a low-resource language is exactly the case where a corpus-derived list
// would be emptiest. Filtering happens once, in the editor, and on one ground
// only: a row this language has already bound is not offered twice.
//
// **This is an enhancement, never a dependency.** Every function fails soft:
// on a network error, a 404 or an unparseable page it returns nothing, and the
// editor's manual entry path is untouched. UD's uptime must never become a
// precondition for authoring, or the whole "design for the language that has
// nothing" premise breaks.
//
// The pages are `text/html`, not an API, so the parsing lives here rather than
// in a component: if UD restructures, one file changes, and it can move behind
// an AppView cache without touching a caller.
//
// Verified at source 2026-08-18: universaldependencies.org sends
// `access-control-allow-origin: *`, so a browser may fetch it directly.

export const UD_BASE_URL = "https://universaldependencies.org";

/**
 * The page carrying every feature UD documents globally, rendered one after
 * another. 74 KB over the wire (gzipped), fetched once per editor session and
 * only when the features level is opened.
 */
export const UD_FEATURES_URL = `${UD_BASE_URL}/u/feat/all.html`;

/** A feature name UD documents, with its English gloss. */
export interface UdFeature {
  feature: string;
  /** UD's own gloss, e.g. "gender". Absent when the page could not be read. */
  gloss?: string;
}

/** One documented value of a feature, with its English gloss. */
export interface UdValue {
  value: string;
  gloss?: string;
}

/**
 * Every feature the UD documentation defines, sorted by name.
 *
 * Read off `u/feat/all.html`, which concatenates the whole documented
 * inventory, each feature opening on the same header a single feature page
 * does — `<h2><code>Subcat</code>: subcategorization</h2>` — so one pattern
 * serves both this and `parseFeatureGloss`.
 *
 * Deliberately **not** `u/feat/index.html`, which was the source until
 * 2026-08-18. That index is a glossary of the *universal tier* alone, and
 * reading candidates off it silently withheld two whole classes of feature
 * from every contributor: the non-universal ones that nonetheless have a
 * global page (`Subcat`, `AdpType`, `NumForm`, `VerbType`, `NameType`,
 * `Style`…) and every layered name (`Number[psor]`, `Gender[subj]`). 66 names
 * instead of 27, and a strict superset — nothing the index offered is lost.
 *
 * Names repeat on the page, since a base feature's page cross-references its
 * own layered variants; the first header for a name wins, so a repeat is
 * dropped rather than shown twice.
 */
export function parseFeatureList(html: string): UdFeature[] {
  const features = new Map<string, UdFeature>();
  for (const match of html.matchAll(/<h2><code>([A-Za-z0-9[\]]+)<\/code>:\s*([^<]*)<\/h2>/g)) {
    const feature = match[1]!;
    if (features.has(feature)) continue;
    const gloss = match[2]!.trim();
    features.set(feature, gloss === "" ? { feature } : { feature, gloss });
  }
  return [...features.values()].sort((a, b) => a.feature.localeCompare(b.feature, "en"));
}

/**
 * The values a feature page documents, in the page's own order — which is
 * meaningful (UD lists them by grammatical significance, not alphabetically).
 *
 * Every feature page states its values as
 * `<h3 id="..."><a name="Fem"><code>Fem</code></a>: feminine gender</h3>`.
 * Confirmed against Gender, Number, Case, VerbForm, PronType, Animacy, Aspect,
 * NounClass and Subcat — including the family-specific NounClass inventory and
 * the non-universal Subcat page, which share the shape exactly.
 */
export function parseFeatureValues(html: string): UdValue[] {
  const values: UdValue[] = [];
  const pattern = /<h3[^>]*>\s*<a name="([^"]+)"[^>]*>.*?<\/a>\s*:?\s*([^<]*)<\/h3>/g;
  for (const match of html.matchAll(pattern)) {
    const value = match[1]!.trim();
    if (value === "") continue;
    const gloss = match[2]!.trim();
    values.push(gloss === "" ? { value } : { value, gloss });
  }
  return values;
}

/** A feature page's own gloss, from `<h2><code>Gender</code>: gender</h2>`. */
export function parseFeatureGloss(html: string): string | undefined {
  const match = /<h2><code>([A-Za-z0-9[\]]+)<\/code>:\s*([^<]*)<\/h2>/.exec(html);
  const gloss = match?.[2]?.trim();
  return gloss === undefined || gloss === "" ? undefined : gloss;
}

/** Documentation URL of a feature; a layered name documents on its base page. */
export function featurePageUrl(feature: string): string {
  return `${UD_BASE_URL}/u/feat/${feature.replace(/\[[a-z0-9]+\]$/, "")}.html`;
}

async function fetchText(url: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    // Offline, blocked, aborted, CORS — all the same to a caller: no
    // candidates this time, and the manual path still works.
    return null;
  }
}

/**
 * Every feature UD documents, with its gloss, or an empty list when the fetch
 * fails. An empty result is not an error state to report — it means "no
 * suggestions", and the editor simply shows its manual field.
 */
export async function fetchFeatures(signal?: AbortSignal): Promise<UdFeature[]> {
  const html = await fetchText(UD_FEATURES_URL, signal);
  return html === null ? [] : parseFeatureList(html);
}

/**
 * The values one feature documents, plus the feature's own gloss. Works for
 * any feature with a page, including a layered name (which documents on its
 * base page) and one a contributor typed by hand that no listing carries.
 */
export async function fetchFeatureValues(
  feature: string,
  signal?: AbortSignal,
): Promise<{ values: UdValue[]; gloss?: string }> {
  const html = await fetchText(featurePageUrl(feature), signal);
  if (html === null) return { values: [] };
  const gloss = parseFeatureGloss(html);
  return { values: parseFeatureValues(html), ...(gloss !== undefined ? { gloss } : {}) };
}
