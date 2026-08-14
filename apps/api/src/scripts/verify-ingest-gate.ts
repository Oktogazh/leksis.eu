// TEMPORARY verification harness for the interface-publishable ingest rule
// (ADR-0015). Drives the real ingest functions against a local ArangoDB and
// asserts that a record the web editors could not have published is refused,
// that the previous version stays current when one is, and that the coherent
// and lenient cases still index. Deleted once the change is verified.
//
//   ARANGO_URL=http://127.0.0.1:8529 ARANGO_PASSWORD=… npx tsx src/scripts/verify-ingest-gate.ts

import { aql } from "arangojs";
import { GRAMMAR_LIMITS, MAX_TAG_FEATS, type Grammar } from "@leksis/types";
import { db } from "../db";
import { ingestLanguage } from "../firehose/ingest-language";
import { ingestEntry } from "../firehose/ingest-entry";
import { ingestSource } from "../firehose/ingest-source";

const DID = "did:plc:gatebot";
const TAG = "x-gate";

let failures = 0;
let checks = 0;

function check(name: string, ok: boolean, detail = ""): void {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const languageURI = (rkey: string) => `at://${DID}/eu.leksis.language/${rkey}`;
const entryURI = (rkey: string) => `at://${DID}/eu.leksis.entry/${rkey}`;
const sourceURI = (rkey: string) => `at://${DID}/eu.leksis.source/${rkey}`;

function languageRecord(grammar?: Grammar) {
  return {
    $type: "eu.leksis.language",
    tag: TAG,
    translations: [{ languageID: TAG, translation: "Gate" }],
    ...(grammar !== undefined ? { grammar } : {}),
    createdAt: "2026-08-14T10:00:00Z",
  };
}

function entryRecord(extra: Record<string, unknown> = {}) {
  return {
    $type: "eu.leksis.entry",
    languageID: TAG,
    orthography: ["gate"],
    categories: [],
    definitions: [{ place: [1], text: "a way in" }],
    createdAt: "2026-08-14T10:00:00Z",
    ...extra,
  };
}

function sourceRecord(languages: string[]) {
  return {
    $type: "eu.leksis.source",
    category: "bibliographic",
    oclc: "999000111",
    title: "Gate",
    languages,
    citation: { short: "Gate", long: "Gate, a work" },
    createdAt: "2026-08-14T10:00:00Z",
  };
}

/** A coherent grammar: NOUN bound, Gender bound, Gender=Fem bound under it. */
const coherent: Grammar = {
  pos: [{ value: "NOUN", label: { long: "noun", short: "n." } }],
  features: [{ feature: "Gender", label: { long: "gender" } }],
  values: [{ feature: "Gender", value: "Fem", label: { long: "feminine", short: "f." } }],
};

async function currentCid(): Promise<string | null> {
  const cursor = await db.query<string>(aql`
    FOR l IN languages FILTER l.tag == ${TAG} AND l.current == true LIMIT 1 RETURN l.cid
  `);
  return (await cursor.next()) ?? null;
}

async function reset(): Promise<void> {
  await db.query(aql`FOR l IN languages FILTER l.tag == ${TAG} REMOVE l IN languages`);
  await db.query(aql`FOR e IN entries FILTER e.languageID == ${TAG} REMOVE e IN entries`);
  await db.query(aql`FOR s IN sources FILTER s.oclc == "999000111" REMOVE s IN sources`);
  await db.query(aql`FOR l IN localLanguages FILTER l._key == ${TAG} REMOVE l IN localLanguages`);
  await db.query(aql`FOR l IN labels FILTER l.languageID == ${TAG} REMOVE l IN labels`);
}

async function main(): Promise<void> {
  await reset();

  // ---- the language gate ------------------------------------------------
  check(
    "a language with no grammar indexes",
    (await ingestLanguage(DID, languageURI(TAG), "cid1", languageRecord())) === "indexed",
  );
  check(
    "a coherent grammar indexes",
    (await ingestLanguage(DID, languageURI(TAG), "cid2", languageRecord(coherent))) === "indexed",
  );
  check("and becomes current", (await currentCid()) === "cid2");

  // An orphan: the value's feature name is not bound. This is the shape a bot
  // produces, and the shape the binding editor cannot navigate to.
  const orphaned: Grammar = {
    pos: coherent.pos,
    values: [{ feature: "Case", value: "Gen", label: { long: "genitive" } }],
  };
  check(
    "an orphaned value row is refused",
    (await ingestLanguage(DID, languageURI(TAG), "cid3", languageRecord(orphaned))) ===
      "skipped-invalid",
  );
  check("and the coherent version stays current", (await currentCid()) === "cid2");

  const ungroundedCategory: Grammar = {
    ...coherent,
    inherent: [{ category: { upos: { value: "VERB" } }, feature: "Gender" }],
  };
  check(
    "an inherence row on an unbound category is refused",
    (await ingestLanguage(DID, languageURI(TAG), "cid4", languageRecord(ungroundedCategory))) ===
      "skipped-invalid",
  );

  const singleItem: Grammar = {
    ...coherent,
    bindings: [{ tag: { upos: { value: "NOUN" } }, label: { long: "noun again" } }],
  };
  check(
    "a one-atom combination is refused",
    (await ingestLanguage(DID, languageURI(TAG), "cid5", languageRecord(singleItem))) ===
      "skipped-invalid",
  );

  const conflict: Grammar = {
    ...coherent,
    inherent: [{ category: { upos: { value: "NOUN" } }, feature: "Gender" }],
    axes: [{ category: { upos: { value: "NOUN" } }, feature: "Gender", values: ["Fem"] }],
  };
  check(
    "a feature both inherent and an axis is refused",
    (await ingestLanguage(DID, languageURI(TAG), "cid6", languageRecord(conflict))) ===
      "skipped-invalid",
  );

  const oversize: Grammar = {
    ...coherent,
    values: Array.from({ length: GRAMMAR_LIMITS.values + 1 }, (_, i) => ({
      feature: "Gender",
      value: `V${i}`,
      label: { long: `value ${i}` },
    })),
  };
  check(
    "a values array past the lexicon's cap is refused",
    (await ingestLanguage(DID, languageURI(TAG), "cid7", languageRecord(oversize))) ===
      "skipped-invalid",
  );

  // Vocabulary is still never judged: a minted POS and a minted value on a UD
  // feature are what the whole layer exists for.
  const minted: Grammar = {
    pos: [{ value: "PARTICLE", scheme: TAG, label: { long: "particle" } }],
    features: [{ feature: "Number", label: { long: "number" } }],
    values: [{ feature: "Number", value: "Sgv", scheme: TAG, label: { long: "singulative" } }],
  };
  check(
    "a minted vocabulary is still indexed",
    (await ingestLanguage(DID, languageURI(TAG), "cid8", languageRecord(minted))) === "indexed",
  );
  check("and becomes current", (await currentCid()) === "cid8");

  // ---- the entry gate ---------------------------------------------------
  check(
    "a plain entry indexes",
    (await ingestEntry(DID, entryURI("ok"), "cid1", entryRecord())) === "indexed",
  );
  check(
    "a tag past the feats cap is refused",
    (await ingestEntry(
      DID,
      entryURI("bigtag"),
      "cid1",
      entryRecord({
        categories: [
          {
            upos: { value: "NOUN" },
            feats: Array.from({ length: MAX_TAG_FEATS + 1 }, (_, i) => ({
              feature: `Feat${i}`,
              value: "X",
            })),
          },
        ],
      }),
    )) === "skipped-invalid",
  );
  check(
    "a todo list past the lexicon's cap is refused",
    (await ingestEntry(
      DID,
      entryURI("bigtodo"),
      "cid1",
      entryRecord({ todo: Array.from({ length: 65 }, (_, i) => `task ${i}`) }),
    )) === "skipped-invalid",
  );
  check(
    "an etymology that is not prose is refused",
    (await ingestEntry(DID, entryURI("badety"), "cid1", entryRecord({ etymology: [42] }))) ===
      "skipped-invalid",
  );
  check(
    "an etymology past the lexicon's cap is refused",
    (await ingestEntry(
      DID,
      entryURI("bigety"),
      "cid1",
      entryRecord({ etymology: Array.from({ length: 17 }, (_, i) => `paragraph ${i}`) }),
    )) === "skipped-invalid",
  );
  check(
    "a well-formed etymology still indexes",
    (await ingestEntry(
      DID,
      entryURI("ety"),
      "cid1",
      entryRecord({ etymology: ["From an older word."] }),
    )) === "indexed",
  );

  // ---- the source gate --------------------------------------------------
  check(
    "a source naming one language indexes",
    (await ingestSource(DID, sourceURI("999000111"), "cid1", sourceRecord([TAG]))) === "indexed",
  );
  check(
    "a source past the languages cap is refused",
    (await ingestSource(
      DID,
      sourceURI("999000111"),
      "cid2",
      sourceRecord(Array.from({ length: 65 }, (_, i) => `x-l${i}`)),
    )) === "skipped-invalid",
  );

  await reset();
  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures > 0) process.exitCode = 1;
}

await main();
