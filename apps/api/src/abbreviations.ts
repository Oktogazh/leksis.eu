import { aql } from "arangojs";
import type { AbbreviationView } from "@leksis/types";
import { db } from "./db";

// Abbreviations read path: a language's labels — the ones its grammar binds —
// with usage counts and conflicts, plus the tags its entries use that nothing
// has named yet. The entries behind a row stay in the database: the API
// exposes only their number, so the dictionary cannot be enumerated through
// its abbreviation list.

/** All abbreviation rows of one language, most used first. */
export async function listAbbreviations(languageID: string): Promise<AbbreviationView[]> {
  const cursor = await db.query<AbbreviationView>(aql`
    FOR a IN abbreviations
      FILTER a.languageID == ${languageID}
      SORT LENGTH(a.entries) DESC, NOT_NULL(a.long, "") ASC
      LET conflictsWith = (
        FOR key IN a.conflictsWith
          LET other = DOCUMENT("abbreviations", key)
          FILTER other != null
          RETURN MERGE({ long: other.long }, other.short == null ? {} : { short: other.short })
      )
      RETURN MERGE(
        { count: LENGTH(a.entries), bound: a.bindingKey != null, conflictsWith },
        a.long == null ? {} : { long: a.long },
        a.short == null ? {} : { short: a.short },
        a.tag == null ? {} : { tag: a.tag }
      )
  `);
  return cursor.all();
}
