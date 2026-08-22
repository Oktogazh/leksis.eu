// TEMPORARY verification harness for the interface-publishable ingest rule
// (ADR-0015). Drives the real ingest functions against a local ArangoDB and
// asserts that a record the web editors could not have published is refused,
// that the previous version stays current when one is, and that the coherent
// and lenient cases still index. Deleted once the change is verified.
//
// Extended by ADR-0019 (the category–axis merge) with the outright refusal of
// the retired `axes` and `layout` arrays and the headword bundle an entry is
// indexed under (`selectorKeys`), then by ADR-0020, which removed the axis
// itself: a category is a bundle with one label, so what a `categories` row can
// break is what any bundle can break, and a row still carrying the ADR-0019
// shape is refused as malformed rather than judged as incoherent.
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

/** The headword keys an entry version was indexed under. */
async function selectorKeysOf(recordURI: string): Promise<string[]> {
  const cursor = await db.query<string[] | null>(aql`
    FOR e IN entries FILTER e.recordURI == ${recordURI} LIMIT 1 RETURN e.selectorKeys
  `);
  return (await cursor.next()) ?? [];
}

async function reset(): Promise<void> {
  await db.query(aql`FOR l IN languages FILTER l.tag == ${TAG} REMOVE l IN languages`);
  await db.query(aql`FOR e IN entries FILTER e.languageID == ${TAG} REMOVE e IN entries`);
  await db.query(aql`FOR s IN sources FILTER s.oclc == "999000111" REMOVE s IN sources`);
  await db.query(aql`FOR l IN localLanguages FILTER l._key == ${TAG} REMOVE l IN localLanguages`);
  await db.query(aql`FOR l IN labels FILTER l.languageID == ${TAG} REMOVE l IN labels`);
  await db.query(aql`FOR p IN paradigms FILTER p.languageID == ${TAG} REMOVE p IN paradigms`);
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

  // A category is a bundle with one label. The two-atom floor is gone, so a bare
  // part of speech is a legitimate category — but naming one that the `pos` row
  // already names is two labels for one tag, and one row per tag per language is
  // the policy the labels model is keyed on (ADR-0010).
  const posOnly: Grammar = {
    ...coherent,
    categories: [{ category: { upos: { value: "NOUN" } }, label: { long: "noun again" } }],
  };
  check(
    "a bare part of speech named a second time is refused",
    (await ingestLanguage(DID, languageURI(TAG), "cid5", languageRecord(posOnly))) ===
      "skipped-invalid",
  );
  check("and the coherent version stays current", (await currentCid()) === "cid2");

  const ungrounded: Grammar = {
    ...coherent,
    categories: [
      {
        category: { upos: { value: "NOUN" }, feats: [{ feature: "Gender", value: "Fem" }] },
        label: { long: "feminine noun", short: "nf." },
      },
    ],
  };
  check(
    "a category no inherence chain reaches is refused",
    (await ingestLanguage(DID, languageURI(TAG), "cid6", languageRecord(ungrounded))) ===
      "skipped-invalid",
  );
  check("and the coherent version is still current", (await currentCid()) === "cid2");

  const unboundAtom: Grammar = {
    ...coherent,
    inherent: [{ category: { upos: { value: "NOUN" } }, feature: "Gender" }],
    categories: [
      {
        category: { upos: { value: "NOUN" }, feats: [{ feature: "Gender", value: "Neut" }] },
        label: { long: "neuter noun" },
      },
    ],
  };
  check(
    "a category built on an unbound value is refused",
    (await ingestLanguage(DID, languageURI(TAG), "cid7", languageRecord(unboundAtom))) ===
      "skipped-invalid",
  );

  const duplicated: Grammar = {
    ...coherent,
    inherent: [{ category: { upos: { value: "NOUN" } }, feature: "Gender" }],
    categories: [
      {
        category: { upos: { value: "NOUN" }, feats: [{ feature: "Gender", value: "Fem" }] },
        label: { long: "feminine noun", short: "nf." },
      },
      {
        category: { upos: { value: "NOUN" }, feats: [{ feature: "Gender", value: "Fem" }] },
        label: { long: "feminine noun, again", short: "nf.2" },
      },
    ],
  };
  check(
    "two rows for one category are refused",
    (await ingestLanguage(DID, languageURI(TAG), "cid8", languageRecord(duplicated))) ===
      "skipped-invalid",
  );

  const numbered: Grammar = {
    ...coherent,
    features: [...coherent.features!, { feature: "Number", label: { long: "number" } }],
    values: [
      ...coherent.values!,
      { feature: "Number", value: "Sing", label: { long: "singular", short: "sg." } },
      { feature: "Number", value: "Plur", label: { long: "plural", short: "pl." } },
    ],
  };

  // The ADR-0019 row shape, refused as **malformed** rather than incoherent: it
  // declares an axis this lexicon no longer defines, so indexing it would
  // silently drop what its author said about the headword flavours. The editor
  // takes the opposite path and maps it forward (`migrateGrammar`).
  check(
    "a category still carrying `axis` and `annotations` is refused",
    (await ingestLanguage(
      DID,
      languageURI(TAG),
      "cid9",
      languageRecord({
        ...numbered,
        categories: [
          {
            category: { upos: { value: "NOUN" } },
            axis: "Number",
            annotations: [{ long: "noun", default: "Sing" }],
          },
        ],
      } as unknown as Grammar),
    )) === "skipped-invalid",
  );

  // An abbreviation whose identity is not an identifier: the shape check, not a
  // judgement about what a dictionary may print (ADR-0020).
  check(
    "an abbreviation whose `value` is not an identifier is refused",
    (await ingestLanguage(
      DID,
      languageURI(TAG),
      "cid10",
      languageRecord({
        ...coherent,
        abbreviations: [{ value: "u.d.b.", short: "udb.", long: "un dra bennak" }],
      }),
    )) === "skipped-invalid",
  );
  check(
    "and the same row with an identifier indexes",
    (await ingestLanguage(
      DID,
      languageURI(TAG),
      "cid11",
      languageRecord({
        ...coherent,
        abbreviations: [{ value: "udb", short: "udb.", long: "un dra bennak" }],
      }),
    )) === "indexed",
  );

  // The two headword flavours the merge was for, declared the way ADR-0020
  // declares them: the feature that tells them apart is inherent, one level
  // down, and each flavour is a category with its own abbreviation.
  const merged: Grammar = {
    ...numbered,
    inherent: [
      { category: { upos: { value: "NOUN" } }, feature: "Gender" },
      {
        category: { upos: { value: "NOUN" }, feats: [{ feature: "Gender", value: "Fem" }] },
        feature: "Number",
      },
    ],
    categories: [
      {
        category: { upos: { value: "NOUN" }, feats: [{ feature: "Gender", value: "Fem" }] },
        label: { long: "feminine noun", short: "nf." },
      },
      {
        category: {
          upos: { value: "NOUN" },
          feats: [
            { feature: "Gender", value: "Fem" },
            { feature: "Number", value: "Plur" },
          ],
        },
        label: { long: "feminine collective noun", short: "nf. str." },
      },
    ],
  };
  check(
    "one category per headword flavour indexes",
    (await ingestLanguage(DID, languageURI(TAG), "cid12", languageRecord(merged))) === "indexed",
  );
  check("and becomes current", (await currentCid()) === "cid12");

  // The two arrays ADR-0019 retired: refused outright rather than ignored,
  // because what they declared moved rather than being renamed.
  check(
    "a record still carrying `axes` is refused",
    (await ingestLanguage(
      DID,
      languageURI(TAG),
      "cid13",
      languageRecord({
        ...merged,
        axes: [{ category: { upos: { value: "NOUN" } }, feature: "Number", values: ["Sing"] }],
      } as Grammar),
    )) === "skipped-invalid",
  );
  check(
    "a record still carrying `layout` is refused",
    (await ingestLanguage(
      DID,
      languageURI(TAG),
      "cid14",
      languageRecord({
        ...merged,
        layout: [{ category: { upos: { value: "NOUN" } }, blocks: [{ kind: "table" }] }],
      } as Grammar),
    )) === "skipped-invalid",
  );
  check("and the merged version stays current", (await currentCid()) === "cid12");

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
    (await ingestLanguage(DID, languageURI(TAG), "cid15", languageRecord(oversize))) ===
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
    (await ingestLanguage(DID, languageURI(TAG), "cid16", languageRecord(minted))) === "indexed",
  );
  check("and becomes current", (await currentCid()) === "cid16");

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

  // ---- the headword bundle an entry is indexed under --------------------
  //
  // ADR-0019's other half: an entry's `selectorKeys` is the bundle a paradigm's
  // selector is compared with, exactly. It keeps the part of speech and the
  // features the language declares inherent — and nothing else, which is what
  // the second entry below checks.
  check(
    "the merged grammar is current again",
    (await ingestLanguage(DID, languageURI(TAG), "cid17", languageRecord(merged))) === "indexed",
  );
  check(
    "a feminine noun in the plural flavour indexes",
    (await ingestEntry(
      DID,
      entryURI("stroll"),
      "cid1",
      entryRecord({
        orthography: ["strollad"],
        categories: [
          {
            upos: { value: "NOUN" },
            feats: [
              { feature: "Gender", value: "Fem" },
              { feature: "Number", value: "Plur" },
            ],
          },
        ],
      }),
    )) === "indexed",
  );
  const strollKeys = await selectorKeysOf(entryURI("stroll"));
  check(
    "its headword key carries both inherent features",
    strollKeys.length === 1 &&
      strollKeys[0] === "upos=ud:NOUN|ud:Gender=Fem|ud:Number=Plur",
    JSON.stringify(strollKeys),
  );
  check(
    "an entry carrying an undeclared feature indexes",
    (await ingestEntry(
      DID,
      entryURI("noise"),
      "cid1",
      entryRecord({
        orthography: ["trouz"],
        categories: [
          {
            upos: { value: "NOUN" },
            feats: [
              { feature: "Gender", value: "Fem" },
              { feature: "Case", value: "Gen" },
            ],
          },
        ],
      }),
    )) === "indexed",
  );
  const noiseKeys = await selectorKeysOf(entryURI("noise"));
  check(
    "and that feature is left out of its headword key",
    noiseKeys.length === 1 && noiseKeys[0] === "upos=ud:NOUN|ud:Gender=Fem",
    JSON.stringify(noiseKeys),
  );

  await reset();
  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures > 0) process.exitCode = 1;
}

await main();
