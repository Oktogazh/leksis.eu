// Live candidate lists from the Universal Dependencies documentation.
//
// The binding editor offers a contributor what UD currently documents so they
// pick rather than type — which dissolves the question of what any feature's
// value list "really" is: the page says, and the contributor calls the shot.
// Nothing here is transcribed into code, so no inventory in this repo can go
// stale, and the AppView never rejects a tag for being absent from a snapshot.
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
// Verified at source 2026-08-02: universaldependencies.org sends
// `access-control-allow-origin: *`, so a browser may fetch it directly.

export const UD_BASE_URL = "https://universaldependencies.org";

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
 * Feature names linked from the universal features index.
 *
 * The index is an alphabetical glossary of *value* glosses ("abessive" →
 * `Case.html`), so the feature names come from deduplicating the link targets
 * rather than from the link text. Only the universal tier appears here;
 * non-universal features with a global page (`Subcat`) and language-specific
 * ones do not, which is precisely why manual entry stays available.
 */
export function parseFeatureIndex(html: string): string[] {
  const names = new Set<string>();
  for (const match of html.matchAll(/href="([A-Z][A-Za-z0-9]*)\.html"/g)) {
    names.add(match[1]!);
  }
  return [...names].sort((a, b) => a.localeCompare(b, "en"));
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
 * The universal feature names UD currently documents, or an empty list when
 * the fetch fails. An empty result is not an error state to report — it means
 * "no suggestions", and the editor simply shows its manual field.
 */
export async function fetchFeatureNames(signal?: AbortSignal): Promise<string[]> {
  const html = await fetchText(`${UD_BASE_URL}/u/feat/index.html`, signal);
  return html === null ? [] : parseFeatureIndex(html);
}

/**
 * The values one feature documents, plus the feature's own gloss. Works for
 * any feature with a page, including the non-universal ones absent from the
 * index — so a contributor who typed `Subcat` manually still gets its values.
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
