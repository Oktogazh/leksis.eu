// Contract for the eu.leksis.source lexicon (lexicons/eu.leksis.source.json)
// and the API's sources endpoints. Types are the contract: the lexicon JSON,
// these shapes, and the ArangoDB `sources` collection move together.
//
// A source is a work an example sentence can be taken from. It is a record of
// its own rather than a field on an entry for one reason above the others: the
// citation a reader sees after an example is rendered from this record, so
// fixing a mistyped title fixes every entry that quotes the work, instead of
// requiring each of them to be republished by whoever wrote them.
//
// It is versioned like a language and not like a cognate: the identity is a
// natural, global one — the OCLC number — so it lives in the record key, every
// author's record for one work shares that key, and there is no `subject`
// chain to follow. An example sentence references the NUMBER, never a record
// URI, which is what lets somebody cite a book before anybody has described it.
//
// See docs/design/sources-and-examples.md for the reasoning.

import { isValidLanguageTag } from "./bcp47.js";

/** AT Proto collection NSID for source records. */
export const LEKSIS_SOURCE_COLLECTION = "eu.leksis.source";

/**
 * The kinds of source that exist. One today; the field is written down rather
 * than assumed because a recording, a web page and a named oral informant are
 * all sources an example may come from, and each needs an identity scheme of
 * its own. Adding a member here later is not a breaking change.
 */
export const SOURCE_CATEGORIES = ["bibliographic"] as const;

export type SourceCategory = (typeof SOURCE_CATEGORIES)[number];

/**
 * How a source is rendered after an example sentence that cites it: what is
 * shown inline, and what it expands to. Both forms live on the source, so a
 * citation is written once rather than once per citing entry.
 */
export interface SourceCitation {
  /** Sigil or author-year shown beside the example ("GBAV", "Ernault 1904"). */
  short: string;
  /** The full bibliographic line the short form expands to. */
  long: string;
}

/**
 * The eu.leksis.source record as written to a user's PDS.
 *
 * The record key is the normalized OCLC number and `oclc` must repeat it —
 * see `validateSource`. Records prove authorship, not ownership: the AppView
 * keeps the latest record for a number as current and archives earlier ones.
 */
export interface LeksisSourceRecord {
  $type: typeof LEKSIS_SOURCE_COLLECTION;
  category: SourceCategory;
  /** Normalized OCLC number; equal to the record key. */
  oclc: string;
  title: string;
  /** Absent means the work has no author, not that nobody filled it in. */
  author?: string;
  /** Text, not a number: "c. 1850" and "1904–1911" are real publication dates. */
  year?: string;
  /** Catalogue page, digitized copy, publisher's page. */
  url?: string;
  /**
   * BCP 47 tags of the languages present in the source, lowercase — the
   * languages whose entry editors offer it and whose dashboards list it.
   *
   * `languages[0]` is the main language and is **immutable**: it is set when
   * the source is first described and never edited, so a source whose main
   * language is wrong is deleted and described again rather than rewritten.
   * The editor enforces that; the AppView only flags a version that changes
   * it, because an index is not the arbiter of what a contributor may assert.
   */
  languages: string[];
  citation: SourceCitation;
  createdAt: string;
}

/**
 * Longest OCLC number accepted. Real numbers are around ten digits today; the
 * cap exists to bound the record key and to reject a paste that is obviously
 * not a number, not to predict OCLC's growth.
 */
export const MAX_OCLC_DIGITS = 16;

/**
 * Reduce an OCLC number to its normal form: the digits, without the wrapper
 * and prefixes catalogues print around them, and without leading zeros.
 * Returns null when the input is not an OCLC number at all.
 *
 *   "12345"            → "12345"
 *   "00012345"         → "12345"     (leading zeros are presentation)
 *   "ocm00012345"      → "12345"     (old 8-digit prefix)
 *   "ocn123456789"     → "123456789" (9-digit prefix)
 *   "on1234567890"     → "1234567890"
 *   "(OCoLC)12345"     → "12345"     (the wrapper MARC records carry)
 *   "(OCoLC)ocm12345"  → "12345"     (both at once)
 *   "0" / "" / "abc"   → null
 *
 * One function, deliberately: the record key, the record's own `oclc` field,
 * ingest's rkey check and the example-sentence citation input must all agree
 * on what "the same source" means, and they can only do that by sharing this.
 */
export function normalizeOclc(input: string): string | null {
  if (typeof input !== "string") return null;

  // Whitespace anywhere is a paste artefact: the result has to be digits, so
  // dropping it can never make a non-number look like one.
  const cleaned = input.trim().toLowerCase().replace(/\s+/g, "");
  const digits = cleaned.replace(/^\(ocolc\)/, "").replace(/^(?:ocm|ocn|on)/, "");
  if (!/^[0-9]+$/.test(digits)) return null;

  const normalized = digits.replace(/^0+/, "");
  if (normalized === "" || normalized.length > MAX_OCLC_DIGITS) return null;
  return normalized;
}

/**
 * Whole-record validation, mirroring validateCognate: returns a machine code
 * so the editor and the API report the same failure, with `ok` the sole
 * success value.
 *
 * Rules:
 *  - `category` is a known value ("category");
 *  - `oclc` is a string that reads as an OCLC number ("oclc") — *not* one
 *    already in normal form. Normalizing is what `normalizeOclc` is for, and
 *    the identity check that matters (does this record's number agree with the
 *    key it is filed under) belongs to ingest, which is the only layer that can
 *    see the key. Rejecting `00012345` here would discard a MARC export over
 *    zero-padding, which is the same mistake as rejecting "BR" for "br" below;
 *  - `title` is non-empty ("title");
 *  - `languages` is non-empty and every tag is well-formed BCP 47 ("languages");
 *  - `citation.short` and `citation.long` are both non-empty ("citation").
 *
 * Three things are deliberately NOT checked here.
 *
 * `createdAt` and the record key are shape, not content: the key is only
 * visible at ingest (which checks that it equals `oclc`), and leaving the
 * timestamp out lets the editor validate a draft it has not stamped yet.
 *
 * Tag CASE is not enforced, only well-formedness — `isValidLanguageTag` is
 * itself case-insensitive, and ingest normalizes what it stores. Skipping a
 * whole source record over "BR" instead of "br" would discard a contribution
 * to make a point about capitalization.
 *
 * And `languages[0]`'s immutability cannot be seen from one record: it is a
 * relation between two versions, so ingest flags it (never rejects it) and the
 * editor refuses to publish such a change in the first place.
 */
export type SourceError = "category" | "oclc" | "title" | "languages" | "citation";

export function validateSource(
  record: Pick<LeksisSourceRecord, "category" | "oclc" | "title" | "languages" | "citation">,
): SourceError | "ok" {
  // Total on every input, including the ones the type says cannot arrive: this
  // runs on records from strangers' PDSs inside the firehose consumer, which is
  // a single sequential writer — a throw there costs more than a returned code.
  if (typeof record !== "object" || record === null) return "category";

  if (!SOURCE_CATEGORIES.includes(record.category as SourceCategory)) return "category";

  if (typeof record.oclc !== "string" || normalizeOclc(record.oclc) === null) return "oclc";

  if (typeof record.title !== "string" || record.title.trim() === "") return "title";

  const languages = record.languages;
  if (!Array.isArray(languages) || languages.length === 0) return "languages";
  for (const tag of languages) {
    if (typeof tag !== "string" || !isValidLanguageTag(tag)) return "languages";
  }

  const citation = record.citation;
  if (typeof citation?.short !== "string" || citation.short.trim() === "") return "citation";
  if (typeof citation.long !== "string" || citation.long.trim() === "") return "citation";

  return "ok";
}

/**
 * One source as the API serves it, from the current version of its record.
 *
 * The bibliographic fields (title, author, year, url) are absent by design:
 * they are record content, resolved client-side from the author's PDS exactly
 * as an entry's or a language's content is. What is served is what a list has
 * to print without a round trip per row — the citation forms — plus the
 * identity needed to resolve the rest.
 */
export interface SourceView {
  /** Normalized OCLC number: the source's identity and its URL. */
  oclc: string;
  category: string;
  /** Lowercase BCP 47 tags; `languages[0]` is the main language. */
  languages: string[];
  citation: SourceCitation;
  /** at:// URI of the current record (resolved client-side for the rest). */
  recordURI: string;
  authorDID: string;
}

/** Response shape of GET /sources?q=&l= — source search. */
export interface SourcesResponse {
  sources: SourceView[];
}

/**
 * Response shape of GET /languages/:tag/sources — every source that declares
 * this language, its own first. The tag is echoed as GET /languages/:tag/labels
 * echoes it, so a client holding only the response knows what it asked about.
 */
export interface LanguageSourcesResponse {
  languageID: string;
  sources: SourceView[];
}

/**
 * Response shape of GET /sources/:oclc/currentRecord — the reference to a
 * source's current record, so the browser can resolve and rewrite it without
 * searching for it first. Null on the wire is served as 404, which is the
 * ordinary case for a source that entries cite but nobody has described yet.
 */
export interface CurrentSourceRecordResponse {
  oclc: string;
  /** at:// URI of the current source record (resolved client-side). */
  recordURI: string;
  /**
   * CID of that version. An editor re-reads this immediately before
   * publishing, so a rewrite made against a stale copy can be refused rather
   * than silently dropping whatever the other author added.
   */
  cid: string;
  authorDID: string;
}
