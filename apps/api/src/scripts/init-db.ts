// One-shot, idempotent database bootstrap.
//
// Creates the project database (if missing), the collections and the named
// graphs. Re-running it is safe — existing collections are left untouched.
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
import { rebuildGeneratedForms } from "../firehose/expand-forms";
import { rebuildCognateNetwork } from "../firehose/ingest-cognate";
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
  "cognates",
  "lexemes",
  "sources",
  "paradigms",
  "firehoseState",
];
// The two networks' edge collections. `relationEdges` joins `senses` vertices
// (the semantic network, loop 5); `cognateEdges` joins `lexemes` vertices (the
// cognate network). Both, and both their vertex collections, are derived from
// the record mirrors + `entries` and are rebuilt wholesale at the bottom of
// this script.
const edgeCollections = ["relationEdges", "cognateEdges"];

// Named graphs, declared for **visualization only** (aardvark's graph viewer).
// Nothing in the API reads through the general-graph API: every traversal names
// its edge collection directly in AQL, which is the anonymous-graph form and
// stays the way this codebase queries. Declaring them costs nothing at runtime
// and makes the two networks browsable in the admin UI, which is the whole
// reason they exist.
const namedGraphs = [
  { name: "semanticNetwork", edge: "relationEdges", vertices: "senses" },
  { name: "cognateNetwork", edge: "cognateEdges", vertices: "lexemes" },
];

/**
 * Drop an index by name if the collection still carries it — the counterpart of
 * `ensureIndex`, for one this script used to create and no longer wants.
 * Idempotent, and silent when there is nothing to drop.
 */
async function dropIndex(db: Database, collection: string, name: string): Promise<void> {
  const indexes = await db.collection(collection).indexes();
  const found = indexes.find((index) => index.name === name);
  if (found === undefined) return;
  await db.collection(collection).dropIndex(found.id);
  console.log(`dropped superseded index "${name}" on "${collection}"`);
}

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

  // Adopting existing collections, so this runs after they are created.
  for (const { name, edge, vertices } of namedGraphs) {
    const graph = db.graph(name);
    if (!(await graph.exists())) {
      await db.createGraph(name, [{ collection: edge, from: [vertices], to: [vertices] }]);
      console.log(`created named graph "${name}" (${vertices} –${edge}→ ${vertices})`);
    } else {
      console.log(`named graph "${name}" already exists`);
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

  // Sources are versioned exactly as languages are (many docs per OCLC number,
  // one with current: true). Reads: by number (the citation an entry renders,
  // and the currentRecord endpoint), by recordURI (ingest and deletion), and by
  // language (a language dashboard's source list).
  //
  // `search[*]` is indexed for exact membership only. Source search is a PREFIX
  // scan (STARTS_WITH inside a subquery, copied from searchEntries), which no
  // persistent index can serve, so /sources?q= reads the collection. That is
  // the same trade entries already make and is fine at this size; when it stops
  // being fine, the fix is an ArangoSearch view, not another persistent index.
  await db.collection("sources").ensureIndex({
    type: "persistent",
    name: "idx_oclc_current",
    fields: ["oclc", "current"],
    unique: false,
  });
  await db.collection("sources").ensureIndex({
    type: "persistent",
    name: "idx_source_recorduri",
    fields: ["recordURI"],
    unique: false,
  });
  await db.collection("sources").ensureIndex({
    type: "persistent",
    name: "idx_source_languages_current",
    fields: ["languages[*]", "current"],
    unique: false,
  });
  await db.collection("sources").ensureIndex({
    type: "persistent",
    name: "idx_source_search",
    fields: ["search[*]"],
    unique: false,
  });
  console.log('ensured 4 indexes on "sources"');

  // Paradigms are versioned exactly as sources are: the identity is derived
  // from the record's own fields and carried in its key, so every author's
  // paradigm for one (language, category) shares one ladder. Reads: by identity
  // (the version transition), by recordURI (deletion), and by language — which
  // is both the read endpoint and the expansion job's "which rules apply here".
  await db.collection("paradigms").ensureIndex({
    type: "persistent",
    name: "idx_paradigmkey_current",
    fields: ["paradigmKey", "current"],
    unique: false,
  });
  await db.collection("paradigms").ensureIndex({
    type: "persistent",
    name: "idx_paradigm_recorduri",
    fields: ["recordURI"],
    unique: false,
  });
  await db.collection("paradigms").ensureIndex({
    type: "persistent",
    name: "idx_paradigm_language_current",
    fields: ["languageID", "current"],
    unique: false,
  });
  console.log('ensured 3 indexes on "paradigms"');

  // Entries are versioned the same way (many docs per entryKey, one with
  // current: true). Ingestion looks versions up by entryKey and recordURI.
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
  // Search is two halves now — the headwords and the word's other forms — so a
  // hit can say which one it came from and a form hit can name the form. Two
  // indexed arrays where there was one, which is the whole cost of the split;
  // prefix semantics are unchanged.
  await db.collection("entries").ensureIndex({
    type: "persistent",
    name: "idx_language_orthography",
    fields: ["languageID", "orthographySearch[*]"],
    unique: false,
  });
  await db.collection("entries").ensureIndex({
    type: "persistent",
    name: "idx_language_forms",
    fields: ["languageID", "otherForms[*].search"],
    unique: false,
  });
  // The layer-5 join: "every entry in this language whose inherent bundle
  // contains this selector" is an indexed intersection filter, which is what
  // lets a newly published paradigm find the entries it reaches without
  // scanning the language and comparing bundles doc by doc.
  await db.collection("entries").ensureIndex({
    type: "persistent",
    name: "idx_language_inherent",
    fields: ["languageID", "inherentAtoms[*]"],
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
  // The flat `search` array's index, superseded by the two above. Dropped
  // rather than left in place: it indexes a field nothing writes any more, so
  // every entry write would keep paying for it and nothing would ever read it.
  await dropIndex(db, "entries", "idx_language_search");
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

  // Cognates are versioned like relations, and carry the same lifecycle
  // lookups: re-anchoring on an entry version transition (by resolved
  // entryKey), and reviving a cognate that arrived before the entry it pins
  // (by the pinned recordURI). There is no place-expansion index to add — a
  // cognate addresses the word, so its side has no sense address at all.
  await db.collection("cognates").ensureIndex({
    type: "persistent",
    name: "idx_cognatekey_current",
    fields: ["cognateKey", "current"],
    unique: false,
  });
  await db.collection("cognates").ensureIndex({
    type: "persistent",
    name: "idx_recorduri",
    fields: ["recordURI"],
    unique: false,
  });
  await db.collection("cognates").ensureIndex({
    type: "persistent",
    name: "idx_side_entrykey",
    fields: ["sides[*].entryKey"],
    unique: false,
  });
  await db.collection("cognates").ensureIndex({
    type: "persistent",
    name: "idx_side_recorduri",
    fields: ["sides[*].recordURI"],
    unique: false,
  });
  // Per-language reads (counts, and a future dashboard queue) from either side.
  await db.collection("cognates").ensureIndex({
    type: "persistent",
    name: "idx_side_language",
    fields: ["sides[*].languageID"],
    unique: false,
  });
  console.log('ensured indexes on "cognates"');

  // Lexeme vertices are keyed by entryKey itself, so nothing looks one up by
  // any other identity; the language index serves per-language counts.
  await db.collection("lexemes").ensureIndex({
    type: "persistent",
    name: "idx_language",
    fields: ["languageID"],
    unique: false,
  });
  console.log('ensured indexes on "lexemes"');

  await db.collection("cognateEdges").ensureIndex({
    type: "persistent",
    name: "idx_cognatekey",
    fields: ["cognateKey"],
    unique: false,
  });
  console.log('ensured indexes on "cognateEdges"');

  // Rebuild the localLanguages read model from the language docs' cached
  // `translations`. This block used to be a one-way backfill for docs indexed
  // before the languages/localLanguages split — the only ones that carried the
  // field — and it still covers those unchanged: ADR-0018 made `translations` a
  // live cache on every version doc, so the same filter now matches the whole
  // collection and the same loop became a genuine rebuild.
  //
  // It upserts rather than reconciles, which is the one way it differs from the
  // `labels` rebuild below — that one truncates first and rebuilds wholesale. So
  // a language added or renamed is picked up here, while a stale row is not
  // swept and a language ADR-0018 removed is not put back. Truncating would need
  // a pure wholesale builder (`buildLabelDocs`'s counterpart) that this model has
  // never had; worth writing when a drifted read model is actually observed.
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

  // Reshape entry docs written before the search index was split in two
  // (docs/design/paradigm-rules.md §2.2). Only the headword half is
  // recoverable from the doc — it is the lowercased orthographies, which are
  // stored. The form half is not: the retired `search` array pooled the form
  // spellings with the orthographies and said nothing about which form each one
  // was, and a form's tag lives only in the record. Neither does the inherent
  // bundle, computed from the record's lexeme-level categories. Both come back
  // when an entry's author republishes it — pre-1.0 that is a bot rerunning its
  // import, not a migration, which is why nothing here fetches a record.
  const pendingCursor = await db.query<number>(aql`
    RETURN LENGTH(FOR e IN entries FILTER e.orthographySearch == null RETURN 1)
  `);
  const pending = (await pendingCursor.next()) ?? 0;
  if (pending > 0) {
    await db.query(aql`
      FOR e IN entries
        FILTER e.orthographySearch == null
        LET headwords = e.deleted == true
          ? []
          : UNIQUE(FOR o IN NOT_NULL(e.orthography, []) RETURN LOWER(o))
        UPDATE e WITH {
          orthographySearch: headwords,
          otherForms: [],
          inherentAtoms: [],
          search: null
        } IN entries OPTIONS { keepNull: false }
    `);
    console.log(
      `reshaped ${pending} entry doc(s) to the split search index ` +
        `(headwords recomputed; forms and inherent atoms on republication)`,
    );
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

  // The cognate network the same way. Its vertices are materialized on demand —
  // only words a live cognate touches — so `lexemes` counts the network's size,
  // not the dictionary's.
  const cognateNetwork = await rebuildCognateNetwork(db);
  console.log(
    `rebuilt the cognate network: ${cognateNetwork.lexemes} lexeme(s), ` +
      `${cognateNetwork.edges} edge(s) from ${cognateNetwork.states.live} live cognate(s) ` +
      `(parked: ${cognateNetwork.states.stale} stale, ` +
      `${cognateNetwork.states.unresolved} unresolved)`,
  );

  // And the generated half of the search index, on the same principle: every
  // `origin: "rule"` form is recomputed from the paradigms and the entries, so
  // a re-run self-heals it. Cleared before it is rebuilt, which is what makes a
  // paradigm deleted while this AppView was down stop producing forms.
  const forms = await rebuildGeneratedForms(db);
  console.log(
    `rebuilt generated forms: cleared ${forms.cleared} entry version(s), ` +
      `re-expanded ${forms.expanded} across ${forms.languages} language(s) with paradigms`,
  );

  console.log("database init complete.");
}

main().catch((err) => {
  console.error("database init failed:", err);
  process.exit(1);
});
