import { aql } from "arangojs";
import {
  isValidParadigmRecord,
  normalizeLanguageTag,
  paradigmIdentityKey,
  paradigmIssues,
  paradigmRkey,
  type ParadigmRequirement,
  type ParadigmTable,
  type Tag,
} from "@leksis/types";
import { db } from "../db";
import { expandForParadigm, forgetParadigms } from "./expand-forms";
import type { IngestResult } from "./ingest-language";

// Decomposition of eu.leksis.paradigm records into the `paradigms` collection
// (versioned) — the morphology arc's layer 5.
//
// Versioned like `sources`, not like `entries`: the identity is derived from
// the record's own fields and carried in the record key, so every author's
// paradigm for one set of headword categories shares one ladder by construction
// and there is no `subject` chain to follow. What an OCLC number is to a source,
// a hash of the sorted canonical selector keys is to a paradigm — a natural
// identity for something several people describe independently.
//
// The doc is a reference, with **one cache**: the tables themselves. That is a
// departure from the design note's "the doc is reference-only", and it is
// forced by the same constraint that put `inherent` on the language doc — the expansion job runs inside the firehose consumer, which
// is a single sequential writer, and resolving a paradigm record from its
// author's PDS once per ingested entry would put a stranger's server in the
// middle of this AppView's write path. So the consumer reads tables from here;
// readers still resolve the record (GET /languages/:tag/paradigms serves
// pointers only), which keeps the record the source of truth for everything a
// person sees.

/**
 * One paradigm version as indexed.
 *
 * The join is an **equality** since ADR-0019: one of an entry's `selectorKeys`
 * must equal `headwordMatchKey` of one of this paradigm's selectors, where it
 * used to be a containment test over the retired `inherentAtoms`. Those keys are
 * derived on demand rather than stored — nothing indexes them and the AQL filter
 * is built in JS either way, so a stored copy would be a second thing to keep in
 * step for no lookup. They are scheme-blind for the reason every form-to-cell
 * join is: a bot writes `Conjugation=2` bare where the language's own editor
 * writes it carrying the minting scheme, and a paradigm reaching only one of the
 * two would be worse than one reaching both.
 */
export interface ParadigmDoc {
  /** Stable across versions; equal to the record key by construction. */
  paradigmKey: string;
  languageID: string;
  /** The headword categories this paradigm serves, each matched exactly. */
  selectors: Tag[];
  /**
   * The sorted canonical selector keys, joined — what the identity hash is
   * taken over, and what `GET /languages/:tag/paradigms` sorts on. One string
   * rather than the list, because a sort key has to be one value and a doc
   * carrying only the hash could be ordered by nothing a person recognises.
   */
  selectorKey: string;
  /** Cached for the expansion job — see the note at the top of this file. */
  tables: ParadigmTable[];
  requires: ParadigmRequirement[];
  /**
   * True once this version's record has been deleted from its author's PDS.
   * The `sources` guard, for the same reason: a paradigm is depended on by
   * entries other people wrote, so a withdrawal re-promotes a surviving
   * version — and a version whose own record is gone must never be the one
   * promoted.
   */
  recordDeleted: boolean;
  recordURI: string;
  cid: string;
  authorDID: string;
  createdAt: string;
  indexedAt: string;
  current: boolean;
}

type StoredParadigm = ParadigmDoc & { _key: string };

interface ParsedParadigm {
  paradigmKey: string;
  languageID: string;
  selectors: Tag[];
  selectorKey: string;
  tables: ParadigmTable[];
  requires: ParadigmRequirement[];
  createdAt: string;
}

/**
 * Validate an incoming record (unknown shape — anyone can put anything on their
 * PDS) and return what the index keeps.
 *
 * Three gates, in the order they can fail (ADR-0015 throughout — a record that
 * contradicts *itself* is refused, silently, and the previous version stays
 * current):
 *
 * 1. **Shape and cardinality** (`isValidParadigmRecord`) — a record that cannot
 *    be read at all.
 * 2. **The record key**, which only ingest can see: it must equal the key
 *    derived from this record's own `languageID` and `selectors`. This is what
 *    makes the identity scheme true rather than conventional — without it, a
 *    repository could hold two paradigms for one set of categories, two ladders
 *    neither of which supersedes the other. The `sources` rkey check exactly.
 *    Note the derivation sorts and dedupes the selector keys, so the order they
 *    were written in never changes where a record is filed.
 * 3. **Coherence** (`paradigmIssues`) — a grid that does not tile a rectangle,
 *    two cells at one address, a base that grounds in nothing, a cycle, a
 *    condition that does not compile. Named row by row in the log, as an
 *    incoherent grammar is, because the author of a bot has nothing else to go
 *    on.
 *
 * What is deliberately *not* checked here: whether the language ever declared
 * these selectors or these coordinates. That is a contradiction between two
 * records, which ADR-0015 indexes and contests rather than refuses — and
 * refusing it would create an ingest-order dependency, since Jetstream can
 * deliver a paradigm before the grammar it addresses. Such a paradigm is
 * indexed and simply inert: its selectors match no entry's headword bundle.
 */
function parseRecord(record: unknown, recordURI: string): ParsedParadigm | null {
  if (!isValidParadigmRecord(record)) return null;

  const languageID = normalizeLanguageTag(record.languageID);
  const paradigmKey = paradigmRkey({ languageID, selectors: record.selectors });
  const rkey = recordURI.split("/").pop() ?? "";
  if (rkey !== paradigmKey) return null;

  const issues = paradigmIssues(record);
  if (issues.length > 0) {
    console.warn(
      `firehose: paradigm ${paradigmKey} rejected — ${issues.length} incoherent row(s): ` +
        issues.map((i) => `${i.kind}(${i.key})`).join(", "),
    );
    return null;
  }

  // Defaulted rather than required, as every other ingest here does: dropping
  // an otherwise good record over a missing timestamp discards a contribution
  // to make a point about metadata.
  const createdAt =
    typeof record.createdAt === "string" && record.createdAt !== ""
      ? record.createdAt
      : new Date().toISOString();

  return {
    paradigmKey,
    languageID,
    selectors: record.selectors,
    selectorKey: paradigmIdentityKey(record.selectors),
    tables: record.tables,
    requires: record.requires ?? [],
    createdAt,
  };
}

/**
 * Index one eu.leksis.paradigm record: archive the current version for this set
 * of categories and insert this one as current, then re-run generation over the
 * entries the paradigm reaches.
 *
 * Re-processing the same (recordURI, cid) is a no-op, so Jetstream cursor
 * overlap on reconnect is harmless. The consumer is the only writer and
 * processes events sequentially, so read-then-write is race-free.
 */
export async function ingestParadigm(
  authorDID: string,
  recordURI: string,
  cid: string,
  record: unknown,
): Promise<IngestResult> {
  const parsed = parseRecord(record, recordURI);
  if (!parsed) {
    console.warn(`firehose: skipped invalid paradigm record ${recordURI}`);
    return "skipped-invalid";
  }

  const currentCursor = await db.query<StoredParadigm>(aql`
    FOR p IN paradigms
      FILTER p.paradigmKey == ${parsed.paradigmKey} AND p.current == true
      LIMIT 1
      RETURN p
  `);
  const current = await currentCursor.next();

  if (current && current.recordURI === recordURI && current.cid === cid) {
    return "skipped-duplicate";
  }

  const doc: ParadigmDoc = {
    paradigmKey: parsed.paradigmKey,
    languageID: parsed.languageID,
    selectors: parsed.selectors,
    selectorKey: parsed.selectorKey,
    tables: parsed.tables,
    requires: parsed.requires,
    recordDeleted: false,
    recordURI,
    cid,
    authorDID,
    createdAt: parsed.createdAt,
    indexedAt: new Date().toISOString(),
    current: true,
  };

  if (current) {
    await db.query(aql`UPDATE ${current._key} WITH { current: false } IN paradigms`);
  }
  await db.query(aql`INSERT ${doc} INTO paradigms`);

  console.log(
    `firehose: indexed paradigm ${doc.paradigmKey} ` +
      `(${current ? "new version" : "new paradigm"}) from ${authorDID}`,
  );

  // The tables changed, so every form they produced is stale. This is the cost
  // ingest-time expansion accepts: one rule edit re-expands the slice of a
  // language the selectors reach.
  forgetParadigms();
  // The sweep inside it is what covers the version this one replaced: entries
  // are found by `paradigmKey`, which every version of one paradigm shares, so
  // a row the old tables left on an entry the new ones no longer reach is still
  // named. A rewrite cannot change which entries are reachable in the first
  // place — the selectors are hashed into the record key, so changing them
  // files a different paradigm rather than editing this one.
  await expandForParadigm(db, doc);
  return "indexed";
}

/**
 * Handle a delete op: archive every version of the deleted record, then
 * **promote the most recent surviving version by another author**, and re-run
 * generation either way.
 *
 * The `sources` shape rather than the `languages` one, and for the same reason:
 * a paradigm is referenced by strangers. Every entry of a category renders the
 * forms whichever version is current produces, so leaving the category with no
 * current paradigm the moment one author withdrew their description would
 * silently empty tables that somebody else's rules can still fill. `recordDeleted`
 * is what keeps that safe — set on *every* version of the withdrawn record, so a
 * later deletion on the same identity can never resurrect a version whose record
 * is gone.
 */
export async function ingestParadigmDelete(recordURI: string): Promise<void> {
  const cursor = await db.query<{ paradigmKey: string; wasCurrent: boolean }>(aql`
    FOR p IN paradigms
      FILTER p.recordURI == ${recordURI}
      UPDATE p WITH { current: false, recordDeleted: true } IN paradigms
      RETURN { paradigmKey: NEW.paradigmKey, wasCurrent: OLD.current }
  `);
  const withdrawn = await cursor.all();
  const first = withdrawn[0];
  if (first === undefined) return;

  const paradigmKey = first.paradigmKey;
  console.log(`firehose: archived paradigm ${paradigmKey} (record deleted)`);

  // Deleting a version that was already superseded changes nothing about what
  // any entry renders, so there is nothing to promote and nothing to re-expand.
  if (!withdrawn.some((v) => v.wasCurrent)) return;

  const promotedCursor = await db.query<StoredParadigm>(aql`
    FOR p IN paradigms
      FILTER p.paradigmKey == ${paradigmKey} AND p.recordDeleted != true
      SORT p.indexedAt DESC
      LIMIT 1
      UPDATE p WITH { current: true } IN paradigms
      RETURN NEW
  `);
  const promoted = await promotedCursor.next();
  if (promoted) {
    console.log(`firehose: promoted surviving paradigm ${paradigmKey} from ${promoted.authorDID}`);
  }

  forgetParadigms();
  // With nothing left to promote, the archived version still says which
  // language and which entries carried this paradigm's output — which is
  // exactly what has to be swept away.
  const stale = await db.query<StoredParadigm>(aql`
    FOR p IN paradigms
      FILTER p.paradigmKey == ${paradigmKey}
      SORT p.indexedAt DESC
      LIMIT 1
      RETURN p
  `);
  const doc = promoted ?? (await stale.next());
  if (doc) await expandForParadigm(db, doc);
}
