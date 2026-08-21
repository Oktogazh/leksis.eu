import { aql } from "arangojs";
import type { LabelSample, LabelView } from "@leksis/types";
import { db } from "./db";
import { labelKey } from "./firehose/labels";

// Labels read path: a language's labelled tags — the ones its grammar declares
// — with usage counts and conflicts, plus the tags its entries use that nothing
// has named yet. The entries behind a row stay in the database: the API exposes
// only their number, so the dictionary cannot be enumerated through its label
// list.

/** All label rows of one language, most used first. */
export async function listLabels(languageID: string): Promise<LabelView[]> {
  const cursor = await db.query<LabelView>(aql`
    FOR a IN labels
      FILTER a.languageID == ${languageID}
      SORT LENGTH(a.entries) DESC, NOT_NULL(a.long, "") ASC
      LET conflictsWith = (
        FOR key IN a.conflictsWith
          LET other = DOCUMENT("labels", key)
          FILTER other != null
          RETURN MERGE({ long: other.long }, other.short == null ? {} : { short: other.short })
      )
      RETURN MERGE(
        { count: LENGTH(a.entries), bound: a.bindingKey != null, conflictsWith },
        a.long == null ? {} : { long: a.long },
        a.short == null ? {} : { short: a.short },
        a.kind == null ? {} : { kind: a.kind },
        a.tag == null ? {} : { tag: a.tag }
      )
  `);
  return cursor.all();
}

/**
 * How many members of a row are drawn before one is resolved. Drawing several
 * at once is what keeps the *answer* O(1) in the size of the row — the
 * alternative, reading the whole `entries` array out and picking in
 * JavaScript, would ship every key of a tag like NOUN to Node to name one
 * word. (The doc itself is still read whole by ArangoDB, so the query is O(1)
 * in transfer and O(row) in storage read. It is the same read `listLabels`
 * already performs on *every* row of the language to count them, so this
 * route is the cheaper of the two by a wide margin.)
 *
 * Eight, because a member can fail to resolve: `entries` holds the entryKeys
 * whose current version carries the tag, and a version that is a **withdrawal**
 * is one of those (a withdrawn entry keeps its tags on the doc) while being no
 * kind of example. One draw would then answer "nothing" for a row that has
 * plenty; eight independent draws make that vanishingly unlikely without making
 * the lookup measurably bigger.
 */
const SAMPLE_DRAWS = 8;

/**
 * One entry using a row of a language's front matter, drawn at random — the
 * "show me a word tagged like this" of the binding editor, where a contributor
 * has just declared what a tag means and wants to see what it did.
 *
 * Null when the row is unknown to this language, when nothing uses it (the
 * ordinary state of a label declared before anybody applied it), or when every
 * drawn member turned out to be withdrawn. The caller cannot tell those apart
 * and does not need to: all three mean "no example to show".
 *
 * **One entry per call, never a list** — the same restraint `listLabels`
 * exercises by serving `count` alone, and the reason ADR-0004's "the dictionary
 * cannot be enumerated through its label list" survives this route: the API's
 * shape is unchanged, no response here is a bulk surface.
 *
 * It is *not* claimed that repeated calls could not eventually collect a row.
 * They could — about n·ln(n) of them, unmetered. That is accepted rather than
 * overlooked (ADR-0019), for three reasons: an entryKey is a public identifier
 * for a public record, and a crawler that wants them reads the authors' PDSs
 * directly, which no AppView rule can prevent; this query is strictly cheaper
 * than the unmetered `GET /languages/:tag/labels` the same page already calls;
 * and metering it would break the one control it exists for, a button whose
 * whole purpose is being pressed again.
 */
export async function sampleLabelEntry(
  languageID: string,
  rowKey: string,
): Promise<LabelSample | null> {
  const cursor = await db.query<LabelSample>(aql`
    LET doc = DOCUMENT("labels", ${labelKey(languageID, rowKey)})
    FILTER doc != null AND doc.languageID == ${languageID}
    LET pool = NOT_NULL(doc.entries, [])
    FILTER LENGTH(pool) > 0
    LET drawn = (FOR i IN 1..${SAMPLE_DRAWS} RETURN pool[FLOOR(RAND() * LENGTH(pool))])
    FOR e IN entries
      FILTER e.entryKey IN drawn AND e.current == true AND e.deleted != true
      FILTER LENGTH(NOT_NULL(e.orthography, [])) > 0
      /* The draws are already uniform; this only keeps the *resolution* from
         favouring whichever candidate the index reaches first. */
      SORT RAND()
      LIMIT 1
      RETURN { key: e.entryKey, orthography: e.orthography[0] }
  `);
  return (await cursor.next()) ?? null;
}
