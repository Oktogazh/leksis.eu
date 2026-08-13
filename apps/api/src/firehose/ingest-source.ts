import { aql } from "arangojs";
import {
  normalizeLanguageTag,
  normalizeOclc,
  validateSource,
  type SourceCategory,
  type SourceCitation,
} from "@leksis/types";
import { db } from "../db";

// Decomposition of eu.leksis.source records into the `sources` collection
// (versioned): the record reference (URI/cid/author), the OCLC number that
// identifies the work, the languages it covers, and the citation forms — no
// bibliographic content. Title, author, year and url stay in the record and
// are resolved client-side, exactly as an entry's definitions are.
//
// Versioned like `languages`, not like `cognates`: the identity is a natural,
// global one (the OCLC number, carried in the record key), so every author's
// record for one work shares it and there is no `subject` chain to follow.
// The latest record for a number becomes current regardless of author; the
// previous version is archived (current: false); nothing is deleted.
//
// Two things are cached here that the record owns. `citation` so a search hit
// or a language's source list can print a row without one PDS round trip per
// source, and `search` so prefix matching has something lowercased to run on.
// Both are caches of the current version, refreshed on every transition and
// rebuildable from the records — never the source of truth.

interface SourceDoc {
  /** Normalized OCLC number: the identity every version of this work shares. */
  oclc: string;
  category: SourceCategory;
  /** Lowercase BCP 47 tags; `languages[0]` is the main language. */
  languages: string[];
  /**
   * Lowercased citation forms, title and author, deduped — what source search
   * prefix-matches on. The `entries.search` convention: index what search
   * needs, and serve content from the record.
   */
  search: string[];
  citation: SourceCitation;
  /**
   * True when this version's main language differs from its predecessor's.
   *
   * `languages[0]` is immutable by design (the editor refuses to change it),
   * but a record arriving from a PDS has not been through the editor. The
   * version is indexed anyway and merely flagged: rejecting it would make the
   * AppView the arbiter of what a contributor may assert, and the disagreement
   * is exactly the kind a later version — or a vote — should settle.
   */
  mainLanguageConflict: boolean;
  /**
   * True once this version's record has been deleted from its author's PDS.
   *
   * The version is kept — archive-don't-delete — but it can never be current
   * again: its `recordURI` resolves to nothing, so promoting it (below) would
   * hand every citing entry a URI that 404s. Set on *every* version sharing
   * the deleted `recordURI`, because deleting a record removes all of them at
   * once, not merely the one that happened to be current.
   */
  recordDeleted: boolean;
  recordURI: string;
  cid: string;
  authorDID: string;
  createdAt: string;
  indexedAt: string;
  current: boolean;
}

export type IngestResult = "indexed" | "skipped-duplicate" | "skipped-invalid";

/**
 * Validate an incoming record (unknown shape — anyone can put anything on
 * their PDS) against the shared contract, and normalize what is indexed.
 * Returns the document fields, or null when invalid.
 *
 * Beyond `validateSource`, one rule can only be checked here because it needs
 * the record's address: `oclc` must equal the record key. The number is the
 * source's identity and an example sentence cites it directly, so a record
 * filed at one number while claiming another has no unambiguous identity and
 * is not indexed at all.
 */
function parseRecord(
  record: unknown,
  recordURI: string,
): {
  oclc: string;
  category: SourceCategory;
  languages: string[];
  search: string[];
  citation: SourceCitation;
  createdAt: string;
} | null {
  if (typeof record !== "object" || record === null) return null;
  const r = record as Record<string, unknown>;

  if (validateSource(r as never) !== "ok") return null;

  // The record KEY must be the normal form exactly; the `oclc` FIELD need only
  // denote the same number. The asymmetry is deliberate and is what makes "one
  // record per work per repo" true: `12345`, `00012345` and `ocm12345` are all
  // legal record keys that mean one work, so accepting any of them would let a
  // single repo hold two live records for it — two ladders, neither able to
  // supersede the other. Being strict about the key costs a bot one
  // normalization; being lenient about the field means a MARC export writing
  // the zero-padded form is indexed rather than discarded over punctuation.
  const oclc = normalizeOclc(r.oclc as string);
  const rkey = recordURI.split("/").pop() ?? "";
  if (oclc === null || rkey !== oclc) return null;

  // Defaulted rather than required, as ingest-language and ingest-cognate do:
  // the field is lexicon-required, but dropping an otherwise good record over a
  // missing timestamp discards content to make a point about metadata.
  const createdAt =
    typeof r.createdAt === "string" && r.createdAt !== ""
      ? r.createdAt
      : new Date().toISOString();

  // Lowercased for comparison, first occurrence kept: `languages[0]` is the
  // main language, so order is meaning here and a Set would not preserve it.
  const languages: string[] = [];
  for (const tag of r.languages as string[]) {
    const normalized = normalizeLanguageTag(tag);
    if (!languages.includes(normalized)) languages.push(normalized);
  }

  const citation = r.citation as SourceCitation;
  const title = r.title as string;
  const author = typeof r.author === "string" ? r.author : "";
  const search = [
    ...new Set(
      [citation.short, citation.long, title, author]
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s !== ""),
    ),
  ];

  return {
    oclc,
    category: r.category as SourceCategory,
    languages,
    search,
    citation: { short: citation.short, long: citation.long },
    createdAt,
  };
}

/**
 * Index one eu.leksis.source record: archive the current version for this OCLC
 * number and insert this one as current.
 *
 * Re-processing the same (recordURI, cid) is a no-op, so Jetstream cursor
 * overlap on reconnect is harmless. The consumer is the only writer and
 * processes events sequentially, so read-then-write is race-free.
 */
export async function ingestSource(
  authorDID: string,
  recordURI: string,
  cid: string,
  record: unknown,
): Promise<IngestResult> {
  const parsed = parseRecord(record, recordURI);
  if (!parsed) {
    console.warn(`firehose: skipped invalid source record ${recordURI}`);
    return "skipped-invalid";
  }

  const currentCursor = await db.query<SourceDoc & { _key: string }>(aql`
    FOR s IN sources
      FILTER s.oclc == ${parsed.oclc} AND s.current == true
      RETURN s
  `);
  const current = await currentCursor.next();

  if (current && current.recordURI === recordURI && current.cid === cid) {
    return "skipped-duplicate";
  }

  // Compared against the FIRST version ever indexed for this number, not
  // against the predecessor. "Immutable" is a property of the whole ladder: a
  // predecessor comparison only catches the transition, so one extra republish
  // of the changed value would compare it against itself and clear the flag —
  // laundering the change — while an author *restoring* the original main
  // language would be flagged as if they were the one breaking it.
  const originalCursor = await db.query<string>(aql`
    FOR s IN sources
      FILTER s.oclc == ${parsed.oclc}
      SORT s.indexedAt ASC
      LIMIT 1
      RETURN s.languages[0]
  `);
  const originalMain = await originalCursor.next();
  const mainLanguageConflict = originalMain !== undefined && originalMain !== parsed.languages[0];
  if (mainLanguageConflict) {
    console.warn(
      `firehose: source ${parsed.oclc} declares main language "${parsed.languages[0]}" ` +
        `where the source was first described as "${originalMain}" — indexed and flagged`,
    );
  }

  const doc: SourceDoc = {
    oclc: parsed.oclc,
    category: parsed.category,
    languages: parsed.languages,
    search: parsed.search,
    citation: parsed.citation,
    mainLanguageConflict,
    recordDeleted: false,
    recordURI,
    cid,
    authorDID,
    createdAt: parsed.createdAt,
    indexedAt: new Date().toISOString(),
    current: true,
  };

  if (current) {
    await db.query(aql`UPDATE ${current._key} WITH { current: false } IN sources`);
  }
  await db.query(aql`INSERT ${doc} INTO sources`);

  console.log(
    `firehose: indexed source ${doc.oclc} (${current ? "new version" : "new source"}) from ${authorDID}`,
  );
  return "indexed";
}

/**
 * Handle a delete op: archive the current version if it is the one whose
 * record was deleted, then **promote the most recent surviving version by
 * another author**.
 *
 * This is the one place a source deliberately diverges from a language, which
 * simply archives and stops. A language record is deleted by the person whose
 * names it carried; a source record is referenced *by strangers* — every
 * example sentence that cites this OCLC number renders its citation from
 * whatever version is current. Leaving the number with no current version
 * would degrade all of those citations to a bare number the moment one author
 * withdrew their description, even though somebody else's description of the
 * same work is sitting in the collection.
 *
 * Only versions whose own record still exists are eligible. Deleting a record
 * removes every version of it, so all of them are marked `recordDeleted` and
 * none can be promoted — including by a *later* deletion of somebody else's
 * record, which is the case that makes the flag necessary rather than merely
 * tidy: without it, the last deletion on a number would resurrect a version
 * whose record was withdrawn earlier and hand every citing entry a dead URI.
 */
export async function ingestSourceDelete(recordURI: string): Promise<void> {
  // Every version of this record, not only the current one: they all point at
  // a record that no longer exists.
  const cursor = await db.query<{ oclc: string; wasCurrent: boolean }>(aql`
    FOR s IN sources
      FILTER s.recordURI == ${recordURI}
      UPDATE s WITH { current: false, recordDeleted: true } IN sources
      RETURN { oclc: NEW.oclc, wasCurrent: OLD.current }
  `);
  const withdrawn = await cursor.all();
  const first = withdrawn[0];
  if (first === undefined) return;

  const oclc = first.oclc;
  console.log(`firehose: archived source ${oclc} (record deleted)`);

  // Only when the withdrawal actually left the number without a current
  // version. Deleting a record that was already superseded changes nothing
  // about what readers see, and promoting unconditionally would re-set
  // `current` on the version that already held it and log a promotion that
  // never happened.
  if (!withdrawn.some((v) => v.wasCurrent)) return;

  const promotedCursor = await db.query<string>(aql`
    FOR s IN sources
      FILTER s.oclc == ${oclc} AND s.recordDeleted != true
      SORT s.indexedAt DESC
      LIMIT 1
      UPDATE s WITH { current: true } IN sources
      RETURN NEW.authorDID
  `);
  const promotedAuthor = await promotedCursor.next();
  if (promotedAuthor) {
    console.log(`firehose: promoted surviving source ${oclc} from ${promotedAuthor}`);
  }
}
