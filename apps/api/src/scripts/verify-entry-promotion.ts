// TEMPORARY verification harness for the promotion path of entry deletion.
// Drives the real ingest functions against a local ArangoDB and asserts the
// one thing the two promotion branches must agree on: **usage follows the
// version that becomes current, and a withdrawal contributes none** — whether
// that version became current by being published or by being promoted after a
// newer record was deleted.
//
// The second half is what the label rows saw before this was fixed: a
// withdrawal keeps its `tags` on the doc (deliberately — a restoration needs
// them back), so promoting one used to re-declare them, and the entry rejoined
// every row it had once been counted in. Nothing took it out again, since only
// another version transition would, so the count stayed inflated and the
// binding editor's "show me a word carrying this tag" — which does filter
// withdrawals — answered "nothing left carrying it" for a row claiming N.
//
//   npx tsx --env-file-if-exists=.env src/scripts/verify-entry-promotion.ts

import { aql } from "arangojs";
import type { Grammar } from "@leksis/types";
import { db } from "../db";
import { ingestLanguage } from "../firehose/ingest-language";
import { ingestEntry, ingestEntryDelete } from "../firehose/ingest-entry";

const ALICE = "did:plc:alicebot";
const BOB = "did:plc:bobbot";
const CAROL = "did:plc:carolbot";
const TAG = "x-prom";

let failures = 0;
let checks = 0;

function check(name: string, ok: boolean, detail = ""): void {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const uri = (did: string) => `at://${did}/eu.leksis.entry/aaa`;

/** NOUN bound and labelled, so the row survives at zero and can be counted. */
const grammar: Grammar = {
  pos: [{ value: "NOUN", label: { long: "noun", short: "n." } }],
};

/**
 * One version of one entry. Every version after the first carries `subject`,
 * or the ingester would mint a separate entry per author and the promotion
 * this is about would never happen.
 */
function entryRecord(options: { subject?: string; deleted?: boolean } = {}) {
  return {
    $type: "eu.leksis.entry",
    languageID: TAG,
    orthography: ["promenn"],
    categories: [{ upos: { value: "NOUN" } }],
    definitions: [{ place: [1], text: "a thing promoted" }],
    ...(options.subject !== undefined ? { subject: options.subject } : {}),
    ...(options.deleted === true
      ? { deleted: true, deletionReason: "withdrawn in the middle of the version history" }
      : {}),
    createdAt: "2026-08-21T10:00:00Z",
  };
}

/** Entries counted against this language's NOUN row. */
async function nounUsage(): Promise<number> {
  const cursor = await db.query<number>(aql`
    FOR a IN labels
      FILTER a.languageID == ${TAG} AND a.long == "noun"
      RETURN LENGTH(a.entries)
  `);
  return (await cursor.next()) ?? -1;
}

/** The current version's author and whether it is a withdrawal. */
async function currentVersion(): Promise<{ authorDID: string; deleted: boolean } | null> {
  const cursor = await db.query<{ authorDID: string; deleted: boolean }>(aql`
    FOR e IN entries
      FILTER e.languageID == ${TAG} AND e.current == true
      RETURN { authorDID: e.authorDID, deleted: e.deleted == true }
  `);
  return (await cursor.next()) ?? null;
}

/** Senses of the current version — the guarded sibling, as a control. */
async function senseCount(): Promise<number> {
  const cursor = await db.query<number>(aql`
    RETURN LENGTH(FOR s IN senses FILTER s.languageID == ${TAG} RETURN 1)
  `);
  return (await cursor.next()) ?? -1;
}

async function reset(): Promise<void> {
  await db.query(aql`FOR l IN languages FILTER l.tag == ${TAG} REMOVE l IN languages`);
  await db.query(aql`FOR e IN entries FILTER e.languageID == ${TAG} REMOVE e IN entries`);
  await db.query(aql`FOR a IN labels FILTER a.languageID == ${TAG} REMOVE a IN labels`);
  await db.query(aql`FOR s IN senses FILTER s.languageID == ${TAG} REMOVE s IN senses`);
  await db.query(aql`
    FOR d IN localLanguages
      FILTER d._key == ${TAG} REMOVE d IN localLanguages
  `);
  await db.query(aql`
    FOR d IN localLanguages
      LET languages = (FOR e IN NOT_NULL(d.languages, []) FILTER e.tag != ${TAG} RETURN e)
      UPDATE d WITH { languages } IN localLanguages
  `);
}

/** The language whose grammar names NOUN, so its label row is a declared one. */
async function declareLanguage(): Promise<void> {
  await ingestLanguage(ALICE, `at://${ALICE}/eu.leksis.language/${TAG}`, "cidL", {
    $type: "eu.leksis.language",
    tag: TAG,
    translations: [{ languageID: TAG, translation: "Promenneg" }],
    grammar,
    createdAt: "2026-08-21T10:00:00Z",
  });
}

async function main(): Promise<void> {
  // ---- 1. promoting a WITHDRAWN version ----------------------------------
  // A publishes, B withdraws, C republishes, then C deletes their record. The
  // version promoted back to current is B's withdrawal.
  await reset();
  await declareLanguage();

  check("alice's version indexes", (await ingestEntry(ALICE, uri(ALICE), "cidA", entryRecord())) === "indexed");
  check("its usage joins the noun row", (await nounUsage()) === 1);

  check(
    "bob withdraws the entry",
    (await ingestEntry(BOB, uri(BOB), "cidB", entryRecord({ subject: uri(ALICE), deleted: true }))) ===
      "indexed",
  );
  // The published route, for contrast: this is the behaviour the promoted
  // route has to match, and it has always been right.
  check("a published withdrawal declares no usage", (await nounUsage()) === 0);
  check("and offers no senses", (await senseCount()) === 0);

  check(
    "carol republishes it",
    (await ingestEntry(CAROL, uri(CAROL), "cidC", entryRecord({ subject: uri(BOB) }))) === "indexed",
  );
  check("usage comes back with her version", (await nounUsage()) === 1);

  await ingestEntryDelete(uri(CAROL));
  check("bob's withdrawal is promoted back to current", (await currentVersion())?.deleted === true);
  check("a PROMOTED withdrawal declares no usage either", (await nounUsage()) === 0);
  check("and still offers no senses", (await senseCount()) === 0);

  // ---- 2. promoting an ORDINARY version ----------------------------------
  // The other half of the same rule, and the one a fix must not break: a
  // promotion that lands on a normal version puts its usage back.
  await reset();
  await declareLanguage();
  await ingestEntry(ALICE, uri(ALICE), "cidA", entryRecord());
  await ingestEntry(CAROL, uri(CAROL), "cidC", entryRecord({ subject: uri(ALICE) }));
  check("two ordinary versions, one usage", (await nounUsage()) === 1);

  await ingestEntryDelete(uri(CAROL));
  check("alice's version is promoted", (await currentVersion())?.authorDID === ALICE);
  check("a promoted ordinary version keeps its usage", (await nounUsage()) === 1);
  check("and its senses", (await senseCount()) === 1);

  await reset();
  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures > 0) process.exitCode = 1;
}

await main();
