// Bibliographic metadata for an OCLC number, from OpenLibrary.
//
// The source editor asks a contributor for a number and fills in the prose:
// title, subtitle, authors, year, a link. Nothing here is authoritative — the
// contributor is. What the lookup buys is that describing a catalogued work
// costs one paste instead of six fields typed from the book in front of you.
//
// **This is an enhancement, never a dependency**, exactly as `@leksis/ud` is.
// Every function fails soft: on a network error, an HTTP error, an unknown
// number or an unparseable body it returns null, and every field of the editor
// stays typed by hand. A source must always be describable offline, because
// the works that matter most here — a parish pamphlet, a local edition, a
// grammar printed once in 1904 — are the least likely to be catalogued.
//
// Why OpenLibrary and not WorldCat: OCLC's own Search API needs a key, which
// would force a server-side proxy into a content path that has none today, and
// OCLC has retired public endpoints before (Classify, xISBN). Scraping the
// public WorldCat page is fragile and CORS-blocked. Recorded in
// docs/design/sources-and-examples.md §2.3 so neither is re-proposed.
//
// Verified at source 2026-08-13, with an `Origin` header set:
//   - `access-control-allow-origin: *`, so a browser may fetch it directly;
//   - a known number answers `{"OCLC:<n>": {…}}`;
//   - an UNKNOWN number answers `200 {}` — an empty object, not a 404. That is
//     the single most important fact about this provider: "not catalogued" and
//     "request failed" arrive looking completely different, and both have to
//     end up as the same null here.

export const OPENLIBRARY_BASE_URL = "https://openlibrary.org";

/**
 * What a lookup can tell the editor about a work. Every field is nullable
 * because every field is genuinely absent for some real work: an anonymous
 * chapbook has no author, an undated manuscript no year.
 *
 * Deliberately narrower than what OpenLibrary returns. Publisher, pagination,
 * subjects and classifications are all there in the response and none of them
 * are fields of `eu.leksis.source`, so lifting them here would be inventing a
 * lexicon change in a fetch package.
 */
export interface OclcMetadata {
  title: string | null;
  /**
   * Carried separately rather than folded into `title` so the caller decides.
   * A scholarly work's subtitle is part of its title bibliographically, but
   * only the caller knows whether it is filling a title field or a citation.
   */
  subtitle: string | null;
  /** May be empty; joined for display by `authorLine`. */
  authors: string[];
  /** Verbatim, and a string on purpose: "1952", "c. 1850", "1904–1911". */
  year: string | null;
  /** The edition's page on the provider, https-normalized. */
  url: string | null;
}

/** The two halves of a title as a bibliography prints them. */
export function fullTitle(meta: OclcMetadata): string {
  if (meta.title === null) return "";
  return meta.subtitle === null ? meta.title : `${meta.title}: ${meta.subtitle}`;
}

/** The authors as one field value; empty when the work names none. */
export function authorLine(meta: OclcMetadata): string {
  return meta.authors.join(", ");
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Upgrade a provider link to https. OpenLibrary answers over https but prints
 * `http://openlibrary.org/...` inside the JSON, and storing that in a record
 * would hand every future reader a redirect — and a mixed-content warning
 * wherever the link is rendered from a secure page.
 */
function httpsUrl(raw: string | null): string | null {
  if (raw === null) return null;
  return raw.startsWith("http://") ? `https://${raw.slice("http://".length)}` : raw;
}

/**
 * Read one work out of the `bibkeys` response body.
 *
 * Kept pure and exported so the shape can be exercised without a network: the
 * fetch is three lines, the parsing is the part that can be wrong.
 *
 * The body is keyed by the bibkey as *requested* (`"OCLC:12345"`), so the
 * caller's number is the lookup key. When exactly one entry came back under a
 * different key it is still taken — an edition legitimately carries several
 * OCLC numbers (verified: 45733840 also lists 45733797), and the provider may
 * answer about the sibling. The number the contributor typed remains the
 * identity regardless; this only decides whose prose fills the form.
 */
export function parseBooksResponse(body: unknown, oclc: string): OclcMetadata | null {
  const root = asRecord(body);
  if (root === null) return null;

  const keys = Object.keys(root);
  if (keys.length === 0) return null; // the "not catalogued here" answer

  const entry = asRecord(root[`OCLC:${oclc}`] ?? (keys.length === 1 ? root[keys[0]!] : undefined));
  if (entry === null) return null;

  const authors: string[] = [];
  const rawAuthors = entry["authors"];
  if (Array.isArray(rawAuthors)) {
    for (const author of rawAuthors) {
      const name = asString(asRecord(author)?.["name"]);
      if (name !== null) authors.push(name);
    }
  }

  const meta: OclcMetadata = {
    title: asString(entry["title"]),
    subtitle: asString(entry["subtitle"]),
    authors,
    year: asString(entry["publish_date"]),
    url: httpsUrl(asString(entry["url"])),
  };

  // A body that parsed but carries nothing usable is a miss, not a hit: the
  // editor should show "nothing found" rather than silently clearing fields.
  const empty =
    meta.title === null && meta.subtitle === null && meta.year === null && meta.url === null && authors.length === 0;
  return empty ? null : meta;
}

/** The lookup URL for a number, exported so a caller can show where it looked. */
export function booksApiUrl(oclc: string): string {
  return `${OPENLIBRARY_BASE_URL}/api/books?bibkeys=OCLC:${encodeURIComponent(oclc)}&format=json&jscmd=data`;
}

/**
 * Look up one OCLC number, or null.
 *
 * Null covers every failure without distinguishing them, on purpose: offline,
 * blocked, aborted, rate-limited, unknown number, garbage body. A caller that
 * could tell them apart would be tempted to treat some of them as errors worth
 * showing, and none of them are — the manual path is right there either way.
 *
 * The number must already be normalized (`normalizeOclc` in `@leksis/types`);
 * this does not normalize, because the caller holds the identity and a fetch
 * package quietly rewriting a key would be the wrong place for that decision.
 */
export async function fetchOclcMetadata(
  oclc: string,
  signal?: AbortSignal,
): Promise<OclcMetadata | null> {
  try {
    const res = await fetch(booksApiUrl(oclc), {
      signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    return parseBooksResponse(await res.json(), oclc);
  } catch {
    return null;
  }
}
