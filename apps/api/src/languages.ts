import { aql } from "arangojs";
import type { LanguageView } from "@leksis/types";
import { db } from "./db";

/**
 * All available languages, localized for one locale: the `localLanguages`
 * doc keyed by the locale tag, maintained by the firehose sync
 * (firehose/local-languages.ts). When no doc exists for the locale (no
 * record has named it yet, or none was requested), fall back to assembling
 * tag + endonym from each language's own locale doc — every language has
 * one, since the endonym is required.
 */
export async function listLanguages(locale: string): Promise<LanguageView[]> {
  if (locale !== "") {
    const cursor = await db.query<LanguageView[] | null>(aql`
      RETURN DOCUMENT("localLanguages", ${locale}).languages
    `);
    const languages = await cursor.next();
    if (languages) return languages;
  }

  const fallback = await db.query<LanguageView>(aql`
    FOR d IN localLanguages
      FOR e IN NOT_NULL(d.languages, [])
        FILTER e.tag == d._key
        SORT e.tag ASC
        RETURN { tag: e.tag, endonym: e.endonym }
  `);
  return fallback.all();
}
