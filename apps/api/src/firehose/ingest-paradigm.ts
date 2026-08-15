import { aql } from "arangojs";
import {
  isValidParadigmRecord,
  normalizeLanguageTag,
  paradigmIssues,
  paradigmRkey,
  paradigmSelectorKey,
  tagAtomKeys,
  type ParadigmRequirement,
  type ParadigmRule,
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
// paradigm for one (language, category) shares one ladder by construction and
// there is no `subject` chain to follow. What an OCLC number is to a source, a
// hash of the canonical selector key is to a paradigm — a natural identity for
// something several people describe independently.
//
// The doc is a reference, with **one cache**: the rules themselves. That is a
// departure from the design note's "the doc is reference-only", and it is
// forced by the same constraint that put `inherent` on the language doc at
// slice 2 — the expansion job runs inside the firehose consumer, which is a
// single sequential writer, and resolving a paradigm record from its author's
// PDS once per ingested entry would put a stranger's server in the middle of
// this AppView's write path. So the consumer reads rules from here; readers
// still resolve the record (GET /languages/:tag/paradigms serves pointers
// only), which keeps the record the source of truth for everything a person
// sees.

/**
 * One paradigm version as indexed.
 *
 * `selectorAtoms` is the join: an entry's `inherentAtoms` must **contain** all
 * of them for this paradigm to reach it. Both sides are keyed by `tagAtomKeys`,
 * which is scheme-blind for the reason every form-to-cell join is — a bot
 * writes `Conjugation=2` bare where the language's own editor writes it
 * carrying the minting scheme, and a paradigm reaching only one of the two
 * would be worse than one reaching both.
 */
export interface ParadigmDoc {
  /** Stable across versions; equal to the record key by construction. */
  paradigmKey: string;
  languageID: string;
  selector: Tag;
  /** Canonical key of the selector — what the identity hash is taken over. */
  selectorKey: string;
  /** Scheme-blind atom keys of the selector; matched against `entries.inherentAtoms`. */
  selectorAtoms: string[];
  /** Cached for the expansion job — see the note at the top of this file. */
  rules: ParadigmRule[];
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
  selector: Tag;
  selectorKey: string;
  selectorAtoms: string[];
  rules: ParadigmRule[];
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
 *    derived from this record's own `languageID` and `selector`. This is what
 *    makes the identity scheme true rather than conventional — without it, a
 *    repository could hold two paradigms for one category, two ladders neither
 *    of which supersedes the other. The `sources` rkey check exactly.
 * 3. **Coherence** (`paradigmIssues`) — a base that grounds in nothing, a cycle,
 *    a condition that does not compile. Named row by row in the log, as an
 *    incoherent grammar is, because the author of a bot has nothing else to go
 *    on.
 *
 * What is deliberately *not* checked here: whether the language ever declared
 * this selector or these coordinates. That is a contradiction between two
 * records, which ADR-0015 indexes and contests rather than refuses — and
 * refusing it would create an ingest-order dependency, since Jetstream can
 * deliver a paradigm before the grammar it addresses. Such a paradigm is
 * indexed and simply inert: its selector matches no entry's inherent bundle.
 */
function parseRecord(record: unknown, recordURI: string): ParsedParadigm | null {
  if (!isValidParadigmRecord(record)) return null;

  const languageID = normalizeLanguageTag(record.languageID);
  const paradigmKey = paradigmRkey({ languageID, selector: record.selector });
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
    selector: record.selector,
    selectorKey: paradigmSelectorKey(record.selector),
    selectorAtoms: tagAtomKeys(record.selector),
    rules: record.rules,
    requires: record.requires ?? [],
    createdAt,
  };
}

/**
 * Index one eu.leksis.paradigm record: archive the current version for this
 * (language, category) and insert this one as current, then re-run generation
 * over the entries the paradigm reaches.
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
    selector: parsed.selector,
    selectorKey: parsed.selectorKey,
    selectorAtoms: parsed.selectorAtoms,
    rules: parsed.rules,
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

  // The rules changed, so every form they produced is stale. This is the cost
  // layer 3 accepted and this layer pays: one rule edit re-expands the slice of
  // a language the selector reaches.
  forgetParadigms();
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
