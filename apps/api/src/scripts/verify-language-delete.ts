// TEMPORARY verification harness for language deletion (ADR-0018). Drives the
// real ingest functions against a local ArangoDB and asserts the three
// outcomes: an archived version's deletion touches nothing current, the current
// version's deletion promotes the surviving one and hands the read models ITS
// content, and the last version's deletion takes the language off the list and
// strips its declared labels while leaving the tag rows entries still use.
// Deleted once the change is verified.
//
//   npx tsx --env-file-if-exists=.env src/scripts/verify-language-delete.ts

import { aql } from "arangojs";
import type { Grammar } from "@leksis/types";
import { db } from "../db";
import { ingestLanguage, ingestLanguageDelete } from "../firehose/ingest-language";
import { ingestEntry } from "../firehose/ingest-entry";

const ALICE = "did:plc:alicebot";
const BOB = "did:plc:bobbot";
const TAG = "x-del";

let failures = 0;
let checks = 0;

function check(name: string, ok: boolean, detail = ""): void {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const uri = (did: string) => `at://${did}/eu.leksis.language/${TAG}`;

/** NOUN bound and labelled — the label row the deletion must withdraw. */
const grammar: Grammar = {
  pos: [{ value: "NOUN", label: { long: "noun", short: "n." } }],
};

function languageRecord(names: Record<string, string>, withGrammar = false) {
  return {
    $type: "eu.leksis.language",
    tag: TAG,
    translations: Object.entries(names).map(([languageID, translation]) => ({
      languageID,
      translation,
    })),
    ...(withGrammar ? { grammar } : {}),
    createdAt: "2026-08-18T10:00:00Z",
  };
}

async function versions(): Promise<{ authorDID: string; current: boolean }[]> {
  const cursor = await db.query<{ authorDID: string; current: boolean }>(aql`
    FOR l IN languages FILTER l.tag == ${TAG}
      SORT l.indexedAt ASC RETURN { authorDID: l.authorDID, current: l.current }
  `);
  return cursor.all();
}

/** This language's row as locale `locale` sees it. */
async function row(locale: string): Promise<{ endonym: string; name?: string } | null> {
  const cursor = await db.query<{ endonym: string; name?: string }>(aql`
    FOR e IN NOT_NULL(DOCUMENT("localLanguages", ${locale}).languages, [])
      FILTER e.tag == ${TAG} RETURN e
  `);
  return (await cursor.next()) ?? null;
}

async function labelRows(): Promise<{ long: string | null; entries: number }[]> {
  const cursor = await db.query<{ long: string | null; entries: number }>(aql`
    FOR a IN labels FILTER a.languageID == ${TAG}
      RETURN { long: a.long, entries: LENGTH(a.entries) }
  `);
  return cursor.all();
}

async function reset(): Promise<void> {
  await db.query(aql`FOR l IN languages FILTER l.tag == ${TAG} REMOVE l IN languages`);
  await db.query(aql`FOR e IN entries FILTER e.languageID == ${TAG} REMOVE e IN entries`);
  await db.query(aql`FOR a IN labels FILTER a.languageID == ${TAG} REMOVE a IN labels`);
  await db.query(aql`FOR s IN senses FILTER s.languageID == ${TAG} REMOVE s IN senses`);
  await db.query(aql`
    FOR d IN localLanguages
      FILTER d._key IN ${[TAG, "x-loc"]} REMOVE d IN localLanguages
  `);
  // ...and this language's row out of every other locale doc it seeded itself into.
  await db.query(aql`
    FOR d IN localLanguages
      LET languages = (FOR e IN NOT_NULL(d.languages, []) FILTER e.tag != ${TAG} RETURN e)
      UPDATE d WITH { languages } IN localLanguages
  `);
}

async function main(): Promise<void> {
  await reset();

  // Two authors, two versions. Alice's names the language in x-loc too; Bob's
  // (current) does not, and declares the grammar.
  check(
    "alice's version indexes",
    (await ingestLanguage(ALICE, uri(ALICE), "cidA", languageRecord({ [TAG]: "Delel", "x-loc": "Deletian" }))) ===
      "indexed",
  );
  check(
    "bob's version supersedes it",
    (await ingestLanguage(BOB, uri(BOB), "cidB", languageRecord({ [TAG]: "Delell" }, true))) ===
      "indexed",
  );
  check(
    "bob's is current, alice's archived",
    JSON.stringify(await versions()) ===
      JSON.stringify([
        { authorDID: ALICE, current: false },
        { authorDID: BOB, current: true },
      ]),
  );
  check("the endonym is bob's", (await row(TAG))?.endonym === "Delell");
  check("and alice's x-loc name was dropped by his rewrite", (await row("x-loc"))?.name === undefined);
  check(
    'bob\'s label "noun" is declared',
    (await labelRows()).some((r) => r.long === "noun" && r.entries === 0),
  );

  // An entry using NOUN — its usage must outlive the language.
  await ingestEntry(BOB, `at://${BOB}/eu.leksis.entry/aaa`, "cidE", {
    $type: "eu.leksis.entry",
    languageID: TAG,
    orthography: ["delenn"],
    categories: [{ upos: { value: "NOUN" } }],
    definitions: [{ place: [1], text: "a thing deleted" }],
    createdAt: "2026-08-18T10:00:00Z",
  });
  check(
    "the entry's usage joins the label row",
    (await labelRows()).some((r) => r.long === "noun" && r.entries === 1),
  );

  // ---- 1. deleting an ARCHIVED version -----------------------------------
  await ingestLanguageDelete(uri(ALICE));
  check(
    "alice's archived version is gone, bob's untouched",
    JSON.stringify(await versions()) === JSON.stringify([{ authorDID: BOB, current: true }]),
  );
  check("the current names are unchanged", (await row(TAG))?.endonym === "Delell");

  // Re-add alice underneath bob so the promotion branch has something to find.
  await reset();
  await ingestLanguage(ALICE, uri(ALICE), "cidA", languageRecord({ [TAG]: "Delel", "x-loc": "Deletian" }));
  await ingestLanguage(BOB, uri(BOB), "cidB", languageRecord({ [TAG]: "Delell" }, true));
  await ingestEntry(BOB, `at://${BOB}/eu.leksis.entry/aaa`, "cidE", {
    $type: "eu.leksis.entry",
    languageID: TAG,
    orthography: ["delenn"],
    categories: [{ upos: { value: "NOUN" } }],
    definitions: [{ place: [1], text: "a thing deleted" }],
    createdAt: "2026-08-18T10:00:00Z",
  });

  // ---- 2. deleting the CURRENT version -----------------------------------
  await ingestLanguageDelete(uri(BOB));
  check(
    "bob's version is gone and alice's is promoted",
    JSON.stringify(await versions()) === JSON.stringify([{ authorDID: ALICE, current: true }]),
  );
  check("the endonym reverts to alice's", (await row(TAG))?.endonym === "Delel");
  check("and her x-loc name comes back with her", (await row("x-loc"))?.name === "Deletian");
  check(
    "bob's declared label is withdrawn, the tag row survives on usage",
    JSON.stringify(await labelRows()) === JSON.stringify([{ long: null, entries: 1 }]),
  );

  // ---- 3. deleting the LAST version --------------------------------------
  await ingestLanguageDelete(uri(ALICE));
  check("no version remains", (await versions()).length === 0);
  check("the language is off its own locale doc", (await row(TAG)) === null);
  check("and off every other locale doc", (await row("x-loc")) === null);
  check(
    "the entry's unnamed tag row still stands",
    JSON.stringify(await labelRows()) === JSON.stringify([{ long: null, entries: 1 }]),
  );
  const orphaned = await db.query<number>(aql`
    RETURN LENGTH(FOR e IN entries FILTER e.languageID == ${TAG} AND e.current == true RETURN 1)
  `);
  check("the entry itself is untouched", (await orphaned.next()) === 1);

  await reset();
  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures > 0) process.exitCode = 1;
}

await main();
