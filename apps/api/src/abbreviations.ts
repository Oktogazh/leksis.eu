import { aql } from "arangojs";
import type { AbbreviationView } from "@leksis/types";
import { db } from "./db";

// Abbreviations read path: a language's annotation pairs (categories +
// definition notes of current entry versions) with usage counts and
// conflicts. The entries using a pair stay in the database — the API never
// exposes them, only their number, so the dictionary cannot be enumerated
// through its abbreviation list.

/** All abbreviation pairs of one language, most used first. */
export async function listAbbreviations(languageID: string): Promise<AbbreviationView[]> {
  const cursor = await db.query<AbbreviationView>(aql`
    FOR a IN abbreviations
      FILTER a.languageID == ${languageID}
      SORT LENGTH(a.entries) DESC, a.long ASC
      LET conflictsWith = (
        FOR key IN a.conflictsWith
          LET other = DOCUMENT("abbreviations", key)
          FILTER other != null
          RETURN MERGE({ long: other.long }, other.short == null ? {} : { short: other.short })
      )
      RETURN MERGE(
        { long: a.long, count: LENGTH(a.entries), conflictsWith },
        a.short == null ? {} : { short: a.short }
      )
  `);
  return cursor.all();
}
