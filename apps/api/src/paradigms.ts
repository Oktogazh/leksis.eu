import { aql } from "arangojs";
import type { ParadigmView } from "@leksis/types";
import { db } from "./db";

// Paradigms read path — the morphology arc's first endpoint, and the first the
// arc has needed at all: layers 1 to 3 declared themselves inside the language
// record and cost the API nothing. Layer 5 breaks that streak by design, because
// its rules are their own records and a client has to be told which ones to
// resolve.
//
// Pointers only, like every other read surface here. The rules are content: the
// record on its author's PDS is where the browser gets them, through the
// per-URI session cache the source and language records already use. The
// AppView's own copy exists so the firehose consumer can generate forms without
// making an HTTP request per entry — that is a write-path cache, and serving it
// would quietly turn the index into the source of truth for a language's
// morphology.

/**
 * Every current paradigm of one language, ordered by identity key.
 *
 * The order used to be the contract — most specific selector first, matching the
 * precedence the expansion job applied when it generated the forms sitting in
 * the index. ADR-0019 removed the subject: a selector is matched **exactly**, so
 * at most one paradigm reaches any one headword bundle and there is no
 * precedence left for a client to reproduce. What remains is stability, so two
 * calls answer alike and a client rendering a list does not see it shuffle;
 * `selectorKey` is the natural key for that because it is the string the rkey
 * hashes — the paradigm's sorted selector keys, joined.
 *
 * There is no cap: a language has tens of paradigms, one per inflection class,
 * and a client that cannot render an entry without all of them should not be
 * handed a page of them.
 */
export async function getLanguageParadigms(tag: string): Promise<ParadigmView[]> {
  const cursor = await db.query<ParadigmView>(aql`
    FOR p IN paradigms
      FILTER p.languageID == ${tag} AND p.current == true
      SORT p.selectorKey ASC, p.indexedAt DESC
      RETURN {
        paradigmKey: p.paradigmKey,
        languageID: p.languageID,
        selectors: p.selectors,
        recordURI: p.recordURI,
        cid: p.cid,
        authorDID: p.authorDID
      }
  `);
  return cursor.all();
}
