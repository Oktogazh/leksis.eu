// One-shot, idempotent database bootstrap.
//
// Creates the project database (if missing) and the collections. Re-running
// it is safe — existing collections are left untouched. It also drops the
// week-1 `definitions` and `translations` collections (Loop 2 decision:
// entry records carry their own definitions; the DB supports search, it
// does not hold content — both collections were still empty).
//
//   npm run db:init            (from repo root)
//   npm run db:init -w @leksis/api
//
// Requires ARANGO_URL / ARANGO_DB / ARANGO_USER / ARANGO_PASSWORD in the env.

import { aql, Database } from "arangojs";
import type { LanguageTranslation } from "@leksis/types";
import { buildAbbreviationDocs, type AbbreviationPair } from "../firehose/abbreviations";
import { syncLocalLanguages } from "../firehose/local-languages";

const url = process.env.ARANGO_URL ?? "http://127.0.0.1:8529";
const dbName = process.env.ARANGO_DB ?? "leksis";
const username = process.env.ARANGO_USER ?? "root";
const password = process.env.ARANGO_PASSWORD ?? "";

// `firehoseState` holds the Jetstream cursor (single doc, _key "jetstream").
// `localLanguages` is the per-locale language-name read model (one doc per
// locale tag), kept in sync by the firehose consumer. `abbreviations` is the
// per-language annotation-pair read model (categories + definition notes of
// current entry versions), also consumer-maintained and rebuilt below.
const documentCollections = [
  "languages",
  "localLanguages",
  "entries",
  "abbreviations",
  "firehoseState",
];
// Superseded by the record-centric model (Loop 2): definitions live on the
// entry records themselves, and translation edges will be redesigned in
// Loop 5. Both were created empty in week 1 and never written to.
const obsoleteCollections = ["definitions", "translations"];

async function main() {
  // Connect to _system first so we can create the project DB if needed.
  const system = new Database({ url, auth: { username, password } });

  const existing = await system.listDatabases();
  if (!existing.includes(dbName)) {
    await system.createDatabase(dbName);
    console.log(`created database "${dbName}"`);
  } else {
    console.log(`database "${dbName}" already exists`);
  }

  const db = system.database(dbName);

  for (const name of documentCollections) {
    const col = db.collection(name);
    if (!(await col.exists())) {
      await col.create();
      console.log(`created document collection "${name}"`);
    } else {
      console.log(`document collection "${name}" already exists`);
    }
  }

  for (const name of obsoleteCollections) {
    const col = db.collection(name);
    if (await col.exists()) {
      const count = (await col.count()).count;
      if (count > 0) {
        // Never destroy data silently — an obsolete collection with content
        // needs a human decision, not an automatic drop.
        console.warn(`obsolete collection "${name}" has ${count} doc(s) — NOT dropping it`);
      } else {
        await col.drop();
        console.log(`dropped obsolete empty collection "${name}"`);
      }
    }
  }

  // Languages are versioned (many docs per tag, one with current: true);
  // every read filters on tag and/or current. ensureIndex is idempotent.
  await db.collection("languages").ensureIndex({
    type: "persistent",
    name: "idx_tag_current",
    fields: ["tag", "current"],
    unique: false,
  });
  console.log('ensured index "idx_tag_current" on "languages"');

  // Entries are versioned the same way (many docs per entryKey, one with
  // current: true). Search filters on language + lowercased orthographies
  // (`search[*]`); ingestion looks versions up by entryKey and recordURI.
  await db.collection("entries").ensureIndex({
    type: "persistent",
    name: "idx_entrykey_current",
    fields: ["entryKey", "current"],
    unique: false,
  });
  await db.collection("entries").ensureIndex({
    type: "persistent",
    name: "idx_recorduri",
    fields: ["recordURI"],
    unique: false,
  });
  await db.collection("entries").ensureIndex({
    type: "persistent",
    name: "idx_language_search",
    fields: ["languageID", "search[*]"],
    unique: false,
  });
  // Per-language reads (dashboard counters, todo queue, activity) filter on
  // language + currency without touching orthographies.
  await db.collection("entries").ensureIndex({
    type: "persistent",
    name: "idx_language_current",
    fields: ["languageID", "current"],
    unique: false,
  });
  console.log('ensured indexes on "entries"');

  // The abbreviations read model is served per language and maintained by
  // entry membership.
  await db.collection("abbreviations").ensureIndex({
    type: "persistent",
    name: "idx_language",
    fields: ["languageID"],
    unique: false,
  });
  await db.collection("abbreviations").ensureIndex({
    type: "persistent",
    name: "idx_entries",
    fields: ["entries[*]"],
    unique: false,
  });
  console.log('ensured indexes on "abbreviations"');

  // Backfill the localLanguages read model from language docs indexed before
  // the languages/localLanguages split, which still carry `translations`.
  // Legacy fields are left in place (archive, never migrate destructively);
  // syncLocalLanguages upserts, so re-running is safe.
  const legacyCursor = await db.query<{ tag: string; translations: LanguageTranslation[] }>(aql`
    FOR l IN languages
      FILTER l.current == true AND l.translations != null
      SORT l.tag ASC
      RETURN { tag: l.tag, translations: l.translations }
  `);
  const legacy = await legacyCursor.all();
  for (const { tag, translations } of legacy) {
    await syncLocalLanguages(db, tag, translations);
  }
  if (legacy.length > 0) {
    console.log(`backfilled "localLanguages" from ${legacy.length} pre-split language doc(s)`);
  }

  // Rebuild the derived `abbreviations` read model wholesale from current
  // entry versions' stored pairs. Idempotent by recomputation, so re-running
  // on every deploy self-heals the model; entry docs indexed before pairs
  // were stored contribute nothing until their entries are re-published.
  // (The consumer may ingest concurrently during a deploy; the window is
  // tiny and its own sync corrects the affected entry right after.)
  const pairRowsCursor = await db.query<{
    entryKey: string;
    languageID: string;
    abbreviations: AbbreviationPair[];
  }>(aql`
    FOR e IN entries
      FILTER e.current == true AND e.abbreviations != null
      RETURN { entryKey: e.entryKey, languageID: e.languageID, abbreviations: e.abbreviations }
  `);
  const pairRows = await pairRowsCursor.all();
  const abbreviationDocs = buildAbbreviationDocs(pairRows);
  await db.query(aql`FOR a IN abbreviations REMOVE a IN abbreviations`);
  if (abbreviationDocs.length > 0) {
    await db.query(aql`FOR d IN ${abbreviationDocs} INSERT d INTO abbreviations`);
  }
  console.log(
    `rebuilt "abbreviations": ${abbreviationDocs.length} pair doc(s) from ${pairRows.length} current entry version(s)`,
  );

  console.log("database init complete.");
}

main().catch((err) => {
  console.error("database init failed:", err);
  process.exit(1);
});
