import { aql } from "arangojs";
import type { LabelView } from "@leksis/types";
import { db } from "./db";

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
