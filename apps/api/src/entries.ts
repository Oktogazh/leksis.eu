import { aql } from "arangojs";
import type { EntryView } from "@leksis/types";
import { db } from "./db";

// Entries read path. The DB supports search only — these queries return the
// minimal EntryView (orthographies, language tag, record reference); the
// frontend resolves the record itself from the author's PDS for the content.

const SEARCH_LIMIT = 50;

/**
 * How many matching forms one hit reports. A regular verb of a language with a
 * dense paradigm has hundreds of forms and a short query can prefix-match a
 * great many of them, all saying the same thing to a reader deciding whether to
 * open the entry; the entry is the result, the forms are the evidence for it.
 */
const FORM_HITS_PER_ENTRY = 8;

/**
 * Case-insensitive prefix search over current entries, optionally scoped to one
 * language: the **headwords** and the word's **other forms**, as two halves that
 * report themselves separately.
 *
 * Ranking, most authoritative first: an exact headword, any headword prefix,
 * then a form-only hit — because a dictionary's answer to a spelling that is
 * both somebody's headword and somebody else's plural is the headword. Ties go
 * alphabetically, as before.
 *
 * Both filters are prefix scans, which no persistent index can serve; the
 * indexes on the two arrays exist for the equality lookups elsewhere, and this
 * reads the collection exactly as it did when the two halves were one array.
 */
export async function searchEntries(query: string, languageID: string): Promise<EntryView[]> {
  const q = query.trim().toLowerCase();
  if (q === "") return [];

  const cursor = await db.query<EntryView>(aql`
    FOR e IN entries
      FILTER e.current == true
      FILTER ${languageID} == "" || e.languageID == ${languageID}
      LET orthographies = NOT_NULL(e.orthographySearch, [])
      LET headword = LENGTH(
        FOR s IN orthographies FILTER STARTS_WITH(s, ${q}) LIMIT 1 RETURN 1
      ) > 0
      LET forms = (
        FOR f IN NOT_NULL(e.otherForms, [])
          FILTER STARTS_WITH(f.search, ${q})
          LIMIT ${FORM_HITS_PER_ENTRY}
          RETURN { form: f.form, tag: f.tag, generated: f.origin == "rule" }
      )
      FILTER headword || LENGTH(forms) > 0
      SORT ${q} IN orthographies DESC, headword DESC, orthographies[0] ASC
      LIMIT ${SEARCH_LIMIT}
      RETURN {
        key: e.entryKey,
        languageID: e.languageID,
        orthography: e.orthography,
        recordURI: e.recordURI,
        authorDID: e.authorDID,
        match: { headword, forms }
      }
  `);
  return cursor.all();
}

/**
 * Map entry-record URIs to the stable entry keys their pages live at, for the
 * URIs this AppView has indexed. Unknown URIs are simply absent.
 *
 * Every **version** is indexed, not only the current one, so a superseded
 * record still resolves — which is the point: a contributor's own feed is full
 * of versions someone else has since replaced, and those must still link to the
 * entry they belong to. Uses the `recordURI` index.
 */
export async function resolveEntryKeys(uris: string[]): Promise<Record<string, string>> {
  if (uris.length === 0) return {};
  const cursor = await db.query<{ recordURI: string; key: string }>(aql`
    FOR e IN entries
      FILTER e.recordURI IN ${uris}
      RETURN { recordURI: e.recordURI, key: e.entryKey }
  `);
  const resolved: Record<string, string> = {};
  for (const row of await cursor.all()) resolved[row.recordURI] = row.key;
  return resolved;
}

/**
 * The current version of one entry by its stable entry key, or null. Served
 * even when that version is a deletion (`deleted: true`) — legacy links must
 * still resolve, to show the deletion reason and, when set, the redirect to
 * the correct entry.
 */
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
        authorDID: e.authorDID,
        deleted: e.deleted,
        deletionReason: e.deletionReason,
        redirectTo: e.redirectTo
      }
  `);
  return (await cursor.next()) ?? null;
}
