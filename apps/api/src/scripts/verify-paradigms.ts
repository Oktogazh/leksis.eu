// TEMPORARY verification harness for layer 5 slice 3 — paradigm ingest and
// ingest-time form generation. Drives the real ingest functions against a local
// ArangoDB and asserts the identity gate, the coherence gate, the three
// expansion trigger paths, cross-paradigm precedence, the missing-base-form
// queue, and that a generated form is findable by search. Deleted once the
// change is verified.
//
//   ARANGO_URL=http://127.0.0.1:8529 ARANGO_PASSWORD=… npx tsx src/scripts/verify-paradigms.ts

import { aql } from "arangojs";
import {
  coordsMatchKey,
  paradigmRkey,
  type Grammar,
  type LeksisParadigmRecord,
  type Tag,
} from "@leksis/types";
import { db } from "../db";
import { getLanguageDashboard } from "../dashboard";
import { searchEntries } from "../entries";
import { getLanguageParadigms } from "../paradigms";
import { ingestEntry, ingestEntryDelete } from "../firehose/ingest-entry";
import { ingestLanguage } from "../firehose/ingest-language";
import { ingestParadigm, ingestParadigmDelete } from "../firehose/ingest-paradigm";

const DID = "did:plc:parabot";
const OTHER_DID = "did:plc:parabot2";
const TAG = "x-para";

let failures = 0;
let checks = 0;

function check(name: string, ok: boolean, detail = ""): void {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const languageURI = (rkey: string) => `at://${DID}/eu.leksis.language/${rkey}`;
const entryURI = (rkey: string) => `at://${DID}/eu.leksis.entry/${rkey}`;
const paradigmURI = (rkey: string, did = DID) => `at://${did}/eu.leksis.paradigm/${rkey}`;

/** VERB bound; Conjugation minted and inherent; Number an axis over Sing/Plur. */
const grammar: Grammar = {
  pos: [{ value: "VERB", label: { long: "verb", short: "v." } }],
  features: [
    { feature: "Conjugation", scheme: TAG, label: { long: "conjugation" } },
    { feature: "Number", label: { long: "number" } },
  ],
  values: [
    { feature: "Conjugation", value: "1", scheme: TAG, label: { long: "first conjugation" } },
    { feature: "Conjugation", value: "2", scheme: TAG, label: { long: "second conjugation" } },
    { feature: "Number", value: "Sing", label: { long: "singular", short: "sg." } },
    { feature: "Number", value: "Plur", label: { long: "plural", short: "pl." } },
  ],
  inherent: [{ category: { upos: { value: "VERB" } }, feature: "Conjugation" }],
  axes: [
    {
      category: { upos: { value: "VERB" } },
      feature: "Number",
      values: ["Sing", "Plur"],
    },
  ],
};

function languageRecord() {
  return {
    $type: "eu.leksis.language",
    tag: TAG,
    translations: [{ languageID: TAG, translation: "Para" }],
    grammar,
    createdAt: "2026-08-15T10:00:00Z",
  };
}

/** A second-conjugation verb, categorised the way the language's editor would. */
function entryRecord(extra: Record<string, unknown> = {}) {
  return {
    $type: "eu.leksis.entry",
    languageID: TAG,
    orthography: ["kanañ"],
    categories: [
      {
        upos: { value: "VERB" },
        feats: [{ feature: "Conjugation", value: "2", scheme: TAG }],
      },
    ],
    definitions: [{ place: [1], text: "to sing" }],
    createdAt: "2026-08-15T10:00:00Z",
    ...extra,
  };
}

/**
 * The selector is written **bare** — no scheme on the minted `Conjugation=2` —
 * where the entry above carries one, which is the scheme-blindness the join is
 * built on: a bot and the language's own editor must reach the same entries.
 */
const conj2: Tag = {
  upos: { value: "VERB" },
  feats: [{ feature: "Conjugation", value: "2" }],
};
const anyVerb: Tag = { upos: { value: "VERB" } };

function paradigmRecord(
  selector: Tag,
  rules: LeksisParadigmRecord["rules"],
  extra: Partial<LeksisParadigmRecord> = {},
) {
  return {
    $type: "eu.leksis.paradigm",
    languageID: TAG,
    selector,
    rules,
    createdAt: "2026-08-15T10:00:00Z",
    ...extra,
  } as unknown;
}

const sing = [{ feature: "Number", value: "Sing" }];
const plur = [{ feature: "Number", value: "Plur" }];

// The index stores a form under the scheme-qualified join key its coordinates
// produce, so the assertions address cells through the same function a rule
// does rather than through a hand-written string.
const SING = coordsMatchKey(sing);
const PLUR = coordsMatchKey(plur);

/** The current entry doc's generated + asserted forms, as a readable map. */
async function forms(): Promise<Map<string, { form: string; origin: string }>> {
  const cursor = await db.query<{ feats: string; form: string; origin: string }[]>(aql`
    FOR e IN entries
      FILTER e.languageID == ${TAG} AND e.current == true AND e.deleted != true
      LIMIT 1
      RETURN NOT_NULL(e.otherForms, [])
  `);
  const rows = (await cursor.next()) ?? [];
  return new Map(rows.map((row) => [row.feats, { form: row.form, origin: row.origin }]));
}

async function issueMessages(): Promise<string[]> {
  const cursor = await db.query<string[]>(aql`
    FOR e IN entries
      FILTER e.languageID == ${TAG} AND e.current == true
      LIMIT 1
      RETURN NOT_NULL(e.formIssues, [])[*].message
  `);
  return (await cursor.next()) ?? [];
}

async function currentParadigmCid(paradigmKey: string): Promise<string | null> {
  const cursor = await db.query<string>(aql`
    FOR p IN paradigms
      FILTER p.paradigmKey == ${paradigmKey} AND p.current == true
      LIMIT 1
      RETURN p.cid
  `);
  return (await cursor.next()) ?? null;
}

async function reset(): Promise<void> {
  await db.query(aql`FOR l IN languages FILTER l.tag == ${TAG} REMOVE l IN languages`);
  await db.query(aql`FOR e IN entries FILTER e.languageID == ${TAG} REMOVE e IN entries`);
  await db.query(aql`FOR p IN paradigms FILTER p.languageID == ${TAG} REMOVE p IN paradigms`);
  await db.query(aql`FOR l IN localLanguages FILTER l._key == ${TAG} REMOVE l IN localLanguages`);
  await db.query(aql`FOR l IN labels FILTER l.languageID == ${TAG} REMOVE l IN labels`);
  await db.query(aql`FOR s IN senses FILTER s.languageID == ${TAG} REMOVE s IN senses`);
}

async function main(): Promise<void> {
  await reset();

  check(
    "the language and its grammar index",
    (await ingestLanguage(DID, languageURI(TAG), "lang1", languageRecord())) === "indexed",
  );

  // ---- the identity gate ------------------------------------------------
  const key2 = paradigmRkey({ languageID: TAG, selector: conj2 });
  const keyAny = paradigmRkey({ languageID: TAG, selector: anyVerb });
  check("two selectors give two identities", key2 !== keyAny, `${key2} / ${keyAny}`);

  const sungRule = [{ coords: sing, strip: "añ", add: "an" }];
  check(
    "a record filed under the wrong key is refused",
    (await ingestParadigm(DID, paradigmURI("br-deadbeefdeadbeef"), "p0", paradigmRecord(conj2, sungRule))) ===
      "skipped-invalid",
  );

  // ---- the coherence gate ------------------------------------------------
  check(
    "empty rules are refused",
    (await ingestParadigm(DID, paradigmURI(key2), "p0", paradigmRecord(conj2, []))) ===
      "skipped-invalid",
  );
  check(
    "a base grounding in nothing is refused",
    (await ingestParadigm(
      DID,
      paradigmURI(key2),
      "p0",
      paradigmRecord(conj2, [{ coords: sing, base: plur, add: "x" }]),
    )) === "skipped-invalid",
  );
  check(
    "a base cycle is refused",
    (await ingestParadigm(
      DID,
      paradigmURI(key2),
      "p0",
      paradigmRecord(conj2, [
        { coords: sing, base: plur, add: "a" },
        { coords: plur, base: sing, add: "b" },
      ]),
    )) === "skipped-invalid",
  );
  check(
    "a condition that does not compile is refused",
    (await ingestParadigm(
      DID,
      paradigmURI(key2),
      "p0",
      paradigmRecord(conj2, [{ coords: sing, match: "([a-", add: "x" }]),
    )) === "skipped-invalid",
  );
  check(
    "a requirement with a blank message is refused",
    (await ingestParadigm(
      DID,
      paradigmURI(key2),
      "p0",
      paradigmRecord(conj2, sungRule, {
        requires: [{ coords: plur, message: "  " }],
      }),
    )) === "skipped-invalid",
  );
  check("and nothing was indexed", (await currentParadigmCid(key2)) === null);

  // A selector naming a category no grammar declared is a disagreement between
  // two records, not a contradiction inside one: indexed, and simply inert.
  const inertKey = paradigmRkey({ languageID: TAG, selector: { upos: { value: "ADP" } } });
  check(
    "a paradigm for an undeclared category is indexed, not refused",
    (await ingestParadigm(
      DID,
      paradigmURI(inertKey),
      "inert1",
      paradigmRecord({ upos: { value: "ADP" } }, sungRule),
    )) === "indexed",
  );

  // ---- path 1: a paradigm published over existing entries -----------------
  check(
    "the entry indexes",
    (await ingestEntry(DID, entryURI("kanan"), "e1", entryRecord())) === "indexed",
  );
  check("with no generated forms yet", (await forms()).size === 0);

  check(
    "a coherent paradigm indexes",
    (await ingestParadigm(
      DID,
      paradigmURI(key2),
      "p1",
      paradigmRecord(conj2, [
        { coords: sing, strip: "añ", add: "an" },
        { coords: plur, strip: "añ", add: "omp" },
      ]),
    )) === "indexed",
  );
  const afterPublish = await forms();
  check(
    "the existing entry was re-expanded (path 1)",
    afterPublish.get(SING)?.form === "kanan" &&
      afterPublish.get(PLUR)?.form === "kanomp",
    [...afterPublish.values()].map((f) => f.form).join(", "),
  );
  check(
    "and the rows are marked generated",
    [...afterPublish.values()].every((f) => f.origin === "rule"),
  );
  check(
    "the bare selector matched the entry's schemed atom",
    afterPublish.size === 2,
    `${afterPublish.size} form(s)`,
  );

  // ---- search finds an entry by a generated form --------------------------
  const hits = await searchEntries("kanom", TAG);
  check(
    "a generated form is findable by search",
    hits.length === 1 && hits[0]?.match?.forms[0]?.form === "kanomp",
    hits.map((h) => h.orthography[0]).join(", "),
  );
  check(
    "and the hit reports it as generated, not as a headword",
    hits[0]?.match?.headword === false && hits[0]?.match?.forms[0]?.generated === true,
  );

  // ---- path 2: an entry republished under an existing paradigm ------------
  check(
    "a new version of the entry indexes",
    (await ingestEntry(
      DID,
      entryURI("kanan2"),
      "e2",
      entryRecord({ subject: entryURI("kanan") }),
    )) === "indexed",
  );
  const afterRepublish = await forms();
  check(
    "the new version was expanded on ingest (path 2)",
    afterRepublish.get(SING)?.form === "kanan" &&
      afterRepublish.get(PLUR)?.form === "kanomp",
  );

  // ---- an asserted form overrides a generated cell ------------------------
  check(
    "a version asserting one of the cells indexes",
    (await ingestEntry(
      DID,
      entryURI("kanan3"),
      "e3",
      entryRecord({
        subject: entryURI("kanan2"),
        otherForms: [
          { tag: { feats: [{ feature: "Number", value: "Plur" }] }, form: "kanimp" },
        ],
      }),
    )) === "indexed",
  );
  const withAsserted = await forms();
  check(
    "the asserted form wins its cell and is not duplicated",
    withAsserted.get(PLUR)?.form === "kanimp" &&
      withAsserted.get(PLUR)?.origin === "record" &&
      withAsserted.size === 2,
    [...withAsserted.entries()].map(([k, v]) => `${k}=${v.form}/${v.origin}`).join(", "),
  );

  // ---- cross-paradigm precedence -----------------------------------------
  check(
    "a less specific paradigm also indexes",
    (await ingestParadigm(
      OTHER_DID,
      paradigmURI(keyAny, OTHER_DID),
      "pa1",
      paradigmRecord(anyVerb, [{ coords: sing, strip: "añ", add: "GENERIC" }]),
    )) === "indexed",
  );
  check(
    "the more specific selector still wins the shared cell",
    (await forms()).get(SING)?.form === "kanan",
    (await forms()).get(SING)?.form,
  );

  const listed = await getLanguageParadigms(TAG);
  check(
    "the endpoint serves both, most specific first",
    listed.length === 3 && listed[0]?.paradigmKey === key2,
    listed.map((p) => p.paradigmKey).join(", "),
  );

  // ---- deletion: archive, re-promote, and re-expand ------------------------
  await ingestParadigmDelete(paradigmURI(key2));
  check(
    "deleting the specific paradigm hands the cell to the general one",
    (await forms()).get(SING)?.form === "kanGENERIC",
    (await forms()).get(SING)?.form,
  );

  check(
    "a second author's version of the same identity indexes",
    (await ingestParadigm(
      OTHER_DID,
      paradigmURI(key2, OTHER_DID),
      "p2",
      paradigmRecord(conj2, [{ coords: sing, strip: "añ", add: "SECOND" }]),
    )) === "indexed",
  );
  check(
    "and its rules take the cell back",
    (await forms()).get(SING)?.form === "kanSECOND",
    (await forms()).get(SING)?.form,
  );
  await ingestParadigmDelete(paradigmURI(key2, OTHER_DID));
  check(
    "withdrawing it again sweeps its output",
    (await forms()).get(SING)?.form === "kanGENERIC",
    (await forms()).get(SING)?.form,
  );

  // ---- required base forms -----------------------------------------------
  const message = "Mankout a ra ar stumm-lies.";
  check(
    "a paradigm requiring a base form indexes",
    (await ingestParadigm(
      DID,
      paradigmURI(key2),
      "p3",
      paradigmRecord(
        conj2,
        [{ coords: sing, base: plur, strip: "imp", add: "an" }],
        { requires: [{ coords: plur, message }] },
      ),
    )) === "indexed",
  );
  check(
    "the entry supplies it, so the chained rule runs",
    (await forms()).get(SING)?.form === "kanan",
    (await forms()).get(SING)?.form,
  );
  check("and no issue is recorded", (await issueMessages()).length === 0);

  // Republish the entry without the asserted plural: the requirement is now
  // unmet, the paradigm is skipped whole, and the message lands on the doc.
  check(
    "a version dropping the required form indexes",
    (await ingestEntry(
      DID,
      entryURI("kanan4"),
      "e4",
      entryRecord({ subject: entryURI("kanan3") }),
    )) === "indexed",
  );
  const missing = await issueMessages();
  check(
    "the unmet requirement is recorded in the rule author's own words",
    missing.length === 1 && missing[0] === message,
    missing.join(" / "),
  );
  check(
    "and that paradigm generated nothing, while the other still did",
    (await forms()).get(SING)?.form === "kanGENERIC" &&
      (await forms()).get(PLUR) === undefined,
    [...(await forms()).entries()].map(([k, v]) => `${k}=${v.form}`).join(", "),
  );

  const dashboard = await getLanguageDashboard(TAG);
  check(
    "the dashboard counts and lists the entry, carrying the message",
    dashboard?.missingFormsCount === 1 &&
      dashboard.missingFormEntries[0]?.messages[0] === message,
    `${dashboard?.missingFormsCount} / ${dashboard?.missingFormEntries[0]?.messages.join(" ")}`,
  );

  // Supplying the form again clears the issue — an entry edit, path 2.
  check(
    "supplying the base form again indexes",
    (await ingestEntry(
      DID,
      entryURI("kanan5"),
      "e5",
      entryRecord({
        subject: entryURI("kanan4"),
        otherForms: [
          { tag: { feats: [{ feature: "Number", value: "Plur" }] }, form: "kanimp" },
        ],
      }),
    )) === "indexed",
  );
  check("the issue is cleared", (await issueMessages()).length === 0);
  check(
    "and the chained rule runs again",
    (await forms()).get(SING)?.form === "kanan",
  );

  // ---- an entry withdrawal generates nothing -------------------------------
  check(
    "a withdrawn version indexes",
    (await ingestEntry(
      DID,
      entryURI("kanan6"),
      "e6",
      entryRecord({
        subject: entryURI("kanan5"),
        deleted: true,
        deletionReason: "duplicate",
      }),
    )) === "indexed",
  );
  const withdrawnCursor = await db.query<number>(aql`
    FOR e IN entries
      FILTER e.languageID == ${TAG} AND e.current == true
      LIMIT 1
      RETURN LENGTH(NOT_NULL(e.otherForms, []))
  `);
  check("and carries no forms at all", (await withdrawnCursor.next()) === 0);

  // Deleting that record promotes the previous version, which must be
  // re-expanded rather than served with whatever it cached last time.
  await ingestEntryDelete(entryURI("kanan6"));
  check(
    "promoting the previous version re-expands it",
    (await forms()).get(SING)?.form === "kanan",
    (await forms()).get(SING)?.form,
  );

  // KEEP=1 leaves the fixture in place, so the db:init rebuild (expansion path
  // 3) and the HTTP endpoints can be exercised against it — in the state the
  // dashboard's queue exists for, which is the one with a requirement unmet.
  if (process.env.KEEP) {
    await ingestEntry(
      DID,
      entryURI("kanan7"),
      "e7",
      entryRecord({ subject: entryURI("kanan5") }),
    );
    console.log("\nKEEP: fixture left with one entry missing its required base form");
  } else {
    await reset();
  }
  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures > 0) process.exitCode = 1;
}

await main();
