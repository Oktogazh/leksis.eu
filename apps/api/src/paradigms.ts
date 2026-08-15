import { aql } from "arangojs";
import type { ParadigmView } from "@leksis/types";
import { db } from "./db";

// Paradigms read path — the morphology arc's first endpoint, and the first the
// arc has needed at all: layers 1 to 4 declared themselves inside the language
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
 * Every current paradigm of one language, **most specific selector first**.
 *
 * The order is the contract, not a convenience: it is the precedence the
 * expansion job applied when it generated the forms now sitting in the index,
 * so a client that walks this list in order and takes the first paradigm to
 * fill a cell reproduces exactly what search knows. Sorting it client-side
 * would be one more place for the two to drift apart.
 *
 * Specificity is the selector's atom count, with the more recently indexed
 * paradigm winning a tie — `bySpecificity` in the expansion job, expressed in
 * AQL. There is no cap: a language has tens of paradigms, one per inflection
 * class, and a client that cannot render an entry without all of them should
 * not be handed a page of them.
 */
export async function getLanguageParadigms(tag: string): Promise<ParadigmView[]> {
  const cursor = await db.query<ParadigmView>(aql`
    FOR p IN paradigms
      FILTER p.languageID == ${tag} AND p.current == true
      SORT LENGTH(NOT_NULL(p.selectorAtoms, [])) DESC, p.indexedAt DESC
      RETURN {
        paradigmKey: p.paradigmKey,
        languageID: p.languageID,
        selector: p.selector,
        recordURI: p.recordURI,
        cid: p.cid,
        authorDID: p.authorDID
      }
  `);
  return cursor.all();
}
