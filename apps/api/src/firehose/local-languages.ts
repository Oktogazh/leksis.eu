import { aql, type Database } from "arangojs";
import type { LanguageTranslation, LanguageView } from "@leksis/types";

// Maintenance of the `localLanguages` read model: one doc per locale
// (_key = lowercase BCP 47 tag), whose `languages` array lists every
// available language as { tag, endonym, name? } — `name` being that
// language's name in the doc's locale, when its record provides one.
//
// syncLocalLanguages runs whenever a language version becomes current in
// the `languages` collection (firehose ingest today, the voting mechanism
// later), so the read model stays in step regardless of what decides
// currency. removeLocalLanguage is its counterpart: a language whose last
// record was deleted leaves the model entirely (ADR-0018), where it used to
// stay listed forever because a `languages` version was never removed.

/**
 * Propagate a now-current language version into `localLanguages`.
 *
 * - A doc is created for every locale this record names (including the
 *   language itself, via the required endonym), seeded with all available
 *   languages as code + endonym. A locale doc can only be missing if no
 *   earlier record named it, so no local names are lost by seeding bare.
 * - Every doc (old and new) then gets this language's entry replaced with
 *   the fresh endonym and per-locale name.
 *
 * Callers are sequential single writers (firehose consumer, db:init
 * backfill), so read-then-write here is race-free.
 */
export async function syncLocalLanguages(
  db: Database,
  tag: string,
  translations: LanguageTranslation[],
): Promise<void> {
  const endonym = translations.find((t) => t.languageID === tag)?.translation ?? tag;
  const names = Object.fromEntries(translations.map((t) => [t.languageID, t.translation]));

  const existingCursor = await db.query<string>(aql`
    FOR d IN localLanguages RETURN d._key
  `);
  const existing = new Set(await existingCursor.all());
  const missing = Object.keys(names).filter((locale) => !existing.has(locale));

  if (missing.length > 0) {
    // Seed entries: every current language, endonym taken from its own
    // locale doc, falling back to legacy pre-split `languages.translations`
    // (still present on docs indexed before the read model existed), then
    // to the bare tag.
    const seedCursor = await db.query<LanguageView>(aql`
      FOR l IN languages
        FILTER l.current == true
        LET selfDoc = DOCUMENT("localLanguages", l.tag)
        LET fromDoc = selfDoc == null ? null : FIRST(
          FOR e IN NOT_NULL(selfDoc.languages, [])
            FILTER e.tag == l.tag
            RETURN e.endonym)
        LET fromLegacy = FIRST(
          FOR t IN NOT_NULL(l.translations, [])
            FILTER t.languageID == l.tag
            RETURN t.translation)
        SORT l.tag ASC
        RETURN { tag: l.tag, endonym: NOT_NULL(fromDoc, fromLegacy, l.tag) }
    `);
    const seed = await seedCursor.all();
    await db.query(aql`
      FOR locale IN ${missing}
        INSERT { _key: locale, languages: ${seed} } INTO localLanguages
    `);
  }

  // Replace this language's entry in every locale doc, localized per doc.
  await db.query(aql`
    FOR d IN localLanguages
      LET name = ${names}[d._key]
      LET entry = name == null
        ? { tag: ${tag}, endonym: ${endonym} }
        : { tag: ${tag}, endonym: ${endonym}, name }
      LET languages = (
        FOR e IN APPEND(
          (FOR o IN NOT_NULL(d.languages, []) FILTER o.tag != ${tag} RETURN o),
          [entry]
        )
          SORT e.tag ASC
          RETURN e
      )
      UPDATE d WITH { languages } IN localLanguages
  `);
}

/**
 * Withdraw a language from the read model: its row leaves every locale doc,
 * and a doc left with no rows at all is removed.
 *
 * Its **own** locale doc is not special-cased. `localLanguages/br` holds the
 * names of every language *in Breton*, and those rows come from other people's
 * records — withdrawing the Breton language record says nothing about them, so
 * only the row naming Breton itself goes. The doc survives with the rest.
 *
 * Deleting a doc that empties follows the rule the derived collections already
 * use (`labels`, the two network models): the model is rebuildable, so an empty
 * doc is noise rather than history, and `syncLocalLanguages` recreates it —
 * seeded with every available language — the moment a record names that locale
 * again.
 *
 * Two queries rather than one because AQL cannot UPDATE and REMOVE the same
 * collection in a single operation. Same sequential-single-writer assumption as
 * its counterpart, so nothing can read between them.
 */
export async function removeLocalLanguage(db: Database, tag: string): Promise<void> {
  await db.query(aql`
    FOR d IN localLanguages
      LET languages = (
        FOR e IN NOT_NULL(d.languages, [])
          FILTER e.tag != ${tag}
          RETURN e
      )
      UPDATE d WITH { languages } IN localLanguages
  `);
  await db.query(aql`
    FOR d IN localLanguages
      FILTER LENGTH(NOT_NULL(d.languages, [])) == 0
      REMOVE d IN localLanguages
  `);
}
