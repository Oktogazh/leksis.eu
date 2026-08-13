import { aql } from "arangojs";
import type { CurrentSourceRecordResponse, SourceView } from "@leksis/types";
import { db } from "./db";

// Sources read path. As with entries, the DB serves references and the
// citation forms only — a client that wants the title, author or year resolves
// the record from its author's PDS. The citation is cached in the index
// because a list of fifty search hits cannot pay fifty PDS round trips to
// print its rows.

const SEARCH_LIMIT = 50;

/**
 * Upper bound on one language's source list. Sources per language will be in
 * the tens for a long time, so this is a guard rather than a page: when a
 * language's bibliography outgrows it, this is where paging goes.
 */
const LANGUAGE_SOURCES_LIMIT = 200;

const sourceView = aql`{
  oclc: s.oclc,
  category: s.category,
  languages: s.languages,
  citation: s.citation,
  recordURI: s.recordURI,
  authorDID: s.authorDID
}`;

/**
 * Case-insensitive prefix search over current sources' citation forms, title
 * and author, optionally scoped to one language. Exact matches sort first,
 * then by short citation — the `searchEntries` shape, on the field the
 * firehose lowercased at ingest.
 *
 * The language scope asks "does this source declare that language", not "is it
 * that language's source": a bilingual dictionary is offered to the entry
 * editors of both its languages, which is the whole point of the record's
 * `languages` list.
 */
export async function searchSources(query: string, languageID: string): Promise<SourceView[]> {
  const q = query.trim().toLowerCase();
  if (q === "") return [];

  const cursor = await db.query<SourceView>(aql`
    FOR s IN sources
      FILTER s.current == true
      FILTER ${languageID} == "" || ${languageID} IN s.languages
      FILTER LENGTH(FOR t IN s.search FILTER STARTS_WITH(t, ${q}) LIMIT 1 RETURN 1) > 0
      SORT ${q} IN s.search DESC, s.search[0] ASC
      LIMIT ${SEARCH_LIMIT}
      RETURN ${sourceView}
  `);
  return cursor.all();
}

/**
 * Every current source that declares this language, the ones whose MAIN
 * language it is first — a language's own bibliography before the works that
 * merely mention it.
 */
export async function getLanguageSources(tag: string): Promise<SourceView[]> {
  const cursor = await db.query<SourceView>(aql`
    FOR s IN sources
      FILTER s.current == true AND ${tag} IN s.languages
      SORT s.languages[0] == ${tag} DESC, s.citation.short ASC
      LIMIT ${LANGUAGE_SOURCES_LIMIT}
      RETURN ${sourceView}
  `);
  return cursor.all();
}

/**
 * The reference to a source's current eu.leksis.source record, or null when
 * nobody has described this OCLC number — which is an ordinary state, not an
 * error: an entry may cite a work before anyone has described it, and the
 * citation resolves the day somebody does.
 */
export async function getCurrentSourceRecord(
  oclc: string,
): Promise<CurrentSourceRecordResponse | null> {
  const cursor = await db.query<CurrentSourceRecordResponse>(aql`
    FOR s IN sources
      FILTER s.oclc == ${oclc} AND s.current == true
      LIMIT 1
      RETURN { oclc: s.oclc, recordURI: s.recordURI, cid: s.cid, authorDID: s.authorDID }
  `);
  return (await cursor.next()) ?? null;
}
