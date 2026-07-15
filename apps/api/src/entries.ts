import { aql } from "arangojs";
import type { EntryView } from "@leksis/types";
import { db } from "./db";

// Entries read path. The DB supports search only — these queries return the
// minimal EntryView (orthographies, language tag, record reference); the
// frontend resolves the record itself from the author's PDS for the content.

const SEARCH_LIMIT = 50;

/**
 * Case-insensitive prefix search over current entries' orthographies,
 * optionally scoped to one language. Exact matches sort first, then by
 * canonical orthography.
 */
export async function searchEntries(query: string, languageID: string): Promise<EntryView[]> {
  const q = query.trim().toLowerCase();
  if (q === "") return [];

  const cursor = await db.query<EntryView>(aql`
    FOR e IN entries
      FILTER e.current == true
      FILTER ${languageID} == "" || e.languageID == ${languageID}
      FILTER LENGTH(FOR s IN e.search FILTER STARTS_WITH(s, ${q}) LIMIT 1 RETURN 1) > 0
      SORT ${q} IN e.search DESC, e.search[0] ASC
      LIMIT ${SEARCH_LIMIT}
      RETURN {
        key: e.entryKey,
        languageID: e.languageID,
        orthography: e.orthography,
        recordURI: e.recordURI,
        authorDID: e.authorDID
      }
  `);
  return cursor.all();
}

/** The current version of one entry by its stable entry key, or null. */
export async function getEntry(key: string): Promise<EntryView | null> {
  const cursor = await db.query<EntryView>(aql`
    FOR e IN entries
      FILTER e.entryKey == ${key} AND e.current == true
      LIMIT 1
      RETURN {
        key: e.entryKey,
        languageID: e.languageID,
        orthography: e.orthography,
        recordURI: e.recordURI,
        authorDID: e.authorDID
      }
  `);
  return (await cursor.next()) ?? null;
}
