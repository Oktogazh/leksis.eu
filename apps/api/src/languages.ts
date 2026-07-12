import { aql } from "arangojs";
import type { LanguageView } from "@leksis/types";
import { db } from "./db";

/**
 * All current language versions, sorted by tag. Archived versions
 * (current: false) stay in the collection but never leave the API.
 */
export async function listLanguages(): Promise<LanguageView[]> {
  const cursor = await db.query<LanguageView>(aql`
    FOR l IN languages
      FILTER l.current == true
      SORT l.tag ASC
      RETURN { tag: l.tag, translations: l.translations, createdAt: l.createdAt }
  `);
  return cursor.all();
}
