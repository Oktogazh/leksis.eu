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
import { CollectionType } from "arangojs/collection";
import type { LanguageTranslation, Tag } from "@leksis/types";
import {
  buildLabelDocs,
  toDeclaredLabel,
  type DeclaredLabel,
} from "../firehose/labels";
import { rebuildSemanticNetwork } from "../firehose/ingest-relation";
import { syncLocalLanguages } from "../firehose/local-languages";

const url = process.env.ARANGO_URL ?? "http://127.0.0.1:8529";
const dbName = process.env.ARANGO_DB ?? "leksis";
const username = process.env.ARANGO_USER ?? "root";
const password = process.env.ARANGO_PASSWORD ?? "";

// `firehoseState` holds the Jetstream cursor (single doc, _key "jetstream").
// `localLanguages` is the per-locale language-name read model (one doc per
// locale tag), kept in sync by the firehose consumer. `labels` is the
// per-language labelled-tag read model — every label a language declares, plus
// every tag its entries use that nothing has named — also consumer-maintained
// and rebuilt below.
const documentCollections = [
  "languages",
  "localLanguages",
  "entries",
  "labels",
  "relations",
  "senses",
  "firehoseState",
];
// The semantic network's edge collection (loop 5). `relationEdges` joins
// `senses` vertices; both are derived from `relations` + `entries` and are
// rebuilt wholesale at the bottom of this script.
const edgeCollections = ["relationEdges"];
// Superseded by the record-centric model (Loop 2): definitions live on the
// entry records themselves, and translation edges will be redesigned in
// Loop 5. Both were created empty in week 1 and never written to.
const obsoleteCollections = ["definitions", "translations"];
// `abbreviations` is `labels` under its former name and former conception (a
// label that acquired a tag, rather than a tag that has a label). Dropped
// rather than warned about: it is a **derived** model, rebuilt wholesale from
// `languages` and `entries` at the bottom of this script, so there is nothing
// in it to lose — the same standing exception `localLanguages` has to the
// archive-forever rule.
const renamedCollections = ["abbreviations"];

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

  for (const name of edgeCollections) {
    const col = db.collection(name);
    if (!(await col.exists())) {
      await col.create({ type: CollectionType.EDGE_COLLECTION });
      console.log(`created edge collection "${name}"`);
    } else {
      console.log(`edge collection "${name}" already exists`);
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

  // A renamed derived collection is dropped even when it has content, unlike an
  // obsolete one: every document in it is recomputed below from `languages` and
  // `entries`, so keeping it would leave two copies of the same read model with
  // only the new one being maintained.
  for (const name of renamedCollections) {
    const col = db.collection(name);
    if (await col.exists()) {
      const count = (await col.count()).count;
      await col.drop();
      console.log(`dropped renamed collection "${name}" (${count} derived doc(s), rebuilt below)`);
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

  // The labels read model is served per language and maintained by entry
  // membership. There is deliberately no unique index on the tag: the doc _key
  // *is* the (language, canonical row key) pair, so one row per tag per
  // language is enforced by the primary key itself and a second index would
  // only restate it.
  await db.collection("labels").ensureIndex({
    type: "persistent",
    name: "idx_language",
    fields: ["languageID"],
    unique: false,
  });
  await db.collection("labels").ensureIndex({
    type: "persistent",
    name: "idx_entries",
    fields: ["entries[*]"],
    unique: false,
  });
  // Declared rows are looked up by the atom they name (the viewer's resolution
  // chain, and the declaration sync's stale sweep).
  await db.collection("labels").ensureIndex({
    type: "persistent",
    name: "idx_bindingkey",
    fields: ["bindingKey"],
    unique: false,
  });
  console.log('ensured indexes on "labels"');

  // Relations are versioned like entries (many docs per relationKey, one
  // current). Two more indexes carry the semantic network's lifecycle: an
  // entry version transition re-anchors the relations touching that entry
  // (by resolved entryKey), and a newly indexed entry version revives the
  // relations that pinned it before it arrived (by the pinned recordURI —
  // Jetstream delivers records in arbitrary order).
  await db.collection("relations").ensureIndex({
    type: "persistent",
    name: "idx_relationkey_current",
    fields: ["relationKey", "current"],
    unique: false,
  });
  await db.collection("relations").ensureIndex({
    type: "persistent",
    name: "idx_recorduri",
    fields: ["recordURI"],
    unique: false,
  });
  await db.collection("relations").ensureIndex({
    type: "persistent",
    name: "idx_side_entrykey",
    fields: ["sides[*].entryKey"],
    unique: false,
  });
  await db.collection("relations").ensureIndex({
    type: "persistent",
    name: "idx_side_recorduri",
    fields: ["sides[*].recordURI"],
    unique: false,
  });
  // The dashboard counts and queues a language's relations from either side.
  await db.collection("relations").ensureIndex({
    type: "persistent",
    name: "idx_side_language",
    fields: ["sides[*].languageID"],
    unique: false,
  });
  console.log('ensured indexes on "relations"');

  // Sense vertices are rebuilt per entry and counted per language (the
  // untranslated-senses figure). Their _key is deterministic, so nothing looks
  // one up by any other identity.
  await db.collection("senses").ensureIndex({
    type: "persistent",
    name: "idx_entrykey",
    fields: ["entryKey"],
    unique: false,
  });
  await db.collection("senses").ensureIndex({
    type: "persistent",
    name: "idx_language",
    fields: ["languageID"],
    unique: false,
  });
  console.log('ensured indexes on "senses"');

  // Edges are rewritten one relation at a time; `_from`/`_to` are indexed by
  // ArangoDB itself, which is what traversal uses.
  await db.collection("relationEdges").ensureIndex({
    type: "persistent",
    name: "idx_relationkey",
    fields: ["relationKey"],
    unique: false,
  });
  console.log('ensured indexes on "relationEdges"');

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

  // Rebuild the derived `labels` read model wholesale. Idempotent by
  // recomputation, so re-running on every deploy self-heals the model; entry
  // docs indexed before tags were stored contribute nothing until their
  // entries are re-published. (The consumer may ingest concurrently during a
  // deploy; the window is tiny and its own sync corrects the affected entry
  // right after.)
  //
  // Entries supply usage only — the tags their current versions carry.
  const usageRowsCursor = await db.query<{
    entryKey: string;
    languageID: string;
    tags: Tag[] | null;
  }>(aql`
    FOR e IN entries
      FILTER e.current == true AND e.tags != null AND e.deleted != true
      RETURN {
        entryKey: e.entryKey,
        languageID: e.languageID,
        tags: e.tags
      }
  `);
  const usageRows = await usageRowsCursor.all();
  // Every label comes from here: the ones each current language record
  // declares. Stored on the language doc precisely so this rebuild does not
  // have to resolve every record from its PDS — without it, a db:init would
  // erase every label the model carries.
  //
  // `bindings` is the field's former name and former row shape; it is read
  // alongside `labels` and mapped forward, so a language indexed before this
  // change keeps its labels instead of losing them until someone happens to
  // republish that record.
  const declaredRowsCursor = await db.query<{ languageID: string; labels: DeclaredLabel[] }>(aql`
    FOR l IN languages
      FILTER l.current == true AND (l.labels != null OR l.bindings != null)
      RETURN { languageID: l.tag, labels: NOT_NULL(l.labels, l.bindings) }
  `);
  const declaredRows = (await declaredRowsCursor.all()).map((row) => ({
    languageID: row.languageID,
    labels: row.labels.map(toDeclaredLabel),
  }));
  const labelDocs = buildLabelDocs(usageRows, declaredRows);
  await db.query(aql`FOR a IN labels REMOVE a IN labels`);
  if (labelDocs.length > 0) {
    await db.query(aql`FOR d IN ${labelDocs} INSERT d INTO labels`);
  }
  const namedCount = labelDocs.filter((d) => d.bindingKey !== null).length;
  console.log(
    `rebuilt "labels": ${labelDocs.length} row(s) ` +
      `from ${declaredRows.length} language grammar(s) (${namedCount} named) ` +
      `and ${usageRows.length} current entry version(s)`,
  );

  // Rebuild the semantic network's derived collections the same way, and for
  // the same reason: `senses` and `relationEdges` are recomputed from
  // `relations` + `entries`, so a re-run self-heals them. Every current
  // relation is re-anchored from scratch rather than trusting its stored pin —
  // an entry version this deploy no longer has must park its relations, not
  // keep serving edges nothing supports.
  const network = await rebuildSemanticNetwork(db);
  console.log(
    `rebuilt the semantic network: ${network.senses} sense(s), ${network.edges} edge(s) from ` +
      `${network.states.live} live relation(s) ` +
      `(parked: ${network.states.stale} stale, ${network.states.unresolved} unresolved, ` +
      `${network.states.oversize} oversize)`,
  );

  console.log("database init complete.");
}

main().catch((err) => {
  console.error("database init failed:", err);
  process.exit(1);
});
