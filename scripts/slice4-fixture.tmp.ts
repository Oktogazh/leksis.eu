/*
  Slice-4 browser fixture (ADR-0019): one quarantined language whose grammar is
  written in the merged shape, one anv-stroll entry created through it, and one
  v2 paradigm whose tables the reader has to draw.

  `scripts/publish-fixtures.ts` cannot run yet (its fixture files still declare
  `bindings`/`axes`/`layout` — slice 6's action item), so this stands in for the
  one thing slice 4 has to see in a browser: a stored table, rendered.

    npx tsx <this> publish     # publish and wait for the LOCAL API to index
    npx tsx <this> teardown    # delete all three records again

  Reads its credentials from apps/web/.env.local, like publish-fixtures does,
  and never prints them.
*/
import { readFileSync } from "node:fs";
import { AtpAgent } from "@atproto/api";
import {
  LEKSIS_ENTRY_COLLECTION,
  LEKSIS_LANGUAGE_COLLECTION,
  LEKSIS_PARADIGM_COLLECTION,
  paradigmRkey,
  type Grammar,
  type LeksisParadigmRecord,
  type Tag,
} from "@leksis/types";

const REPO = "/Users/alan/Repos/leksis.eu";
const ENV_LOCAL = `${REPO}/apps/web/.env.local`;
const API = process.env.LEKSIS_API ?? "http://127.0.0.1:8080";
const TAG = "qtl";

function credentials(): { service: string; identifier: string; password: string } {
  const text = readFileSync(ENV_LOCAL, "utf8");
  const read = (key: string): string => {
    const line = text.split("\n").find((row) => row.trimStart().startsWith(`${key}=`));
    return line === undefined ? "" : line.slice(line.indexOf("=") + 1).trim();
  };
  const out = {
    service: read("VITE_DEV_PDS"),
    identifier: read("VITE_DEV_HANDLE"),
    password: read("VITE_DEV_PASSWORD"),
  };
  for (const [k, v] of Object.entries(out)) if (v === "") throw new Error(`${k} is blank`);
  return out;
}

const NOUN = { value: "NOUN" };
const masc = { feature: "Gender", value: "Masc" };

/**
 * The merged shape: Gender is inherent to NOUN, and the masculine noun category
 * declares Number as its axis with **two** headword flavours — the ordinary
 * singular one and the anv-kadarn stroll, whose citation form is the plural.
 */
const grammar: Grammar = {
  pos: [{ value: "NOUN", label: { long: "anv-kadarn", short: "an." } }],
  features: [
    { feature: "Gender", label: { long: "reizh" } },
    { feature: "Number", label: { long: "niver" } },
  ],
  values: [
    { feature: "Gender", value: "Masc", label: { long: "gourel", short: "g." } },
    { feature: "Gender", value: "Fem", label: { long: "benel", short: "b." } },
    { feature: "Number", value: "Sing", label: { long: "unan", short: "un." } },
    { feature: "Number", value: "Plur", label: { long: "lies", short: "li." } },
    { feature: "Number", value: "Dual", label: { long: "daouad", short: "daou." } },
    { feature: "Number", value: "Coll", label: { long: "strollad", short: "stro." } },
    { feature: "Number", value: "Ptan", label: { long: "liesañ hepken", short: "lh." } },
    // Minted: UD documents no singulative, so the record addresses `Number=Sgv`
    // bare and only this row says where it came from — which is what the
    // reader's re-qualification step has to find.
    { feature: "Number", value: "Sgv", scheme: TAG, label: { long: "unanenn", short: "un.enn" } },
  ],
  inherent: [{ category: { upos: NOUN }, feature: "Gender" }],
  categories: [
    {
      category: { upos: NOUN, feats: [masc] },
      axis: "Number",
      annotations: [
        { long: "anv-kadarn gourel", short: "g.", default: "Sing" },
        { long: "anv-kadarn stroll", short: "str.", default: "Plur" },
      ],
    },
  ],
};

const languageRecord = {
  tag: TAG,
  translations: [
    { languageID: TAG, translation: "Qatalen" },
    { languageID: "en", translation: "Qatalen (fixture)" },
  ],
  grammar,
};

/** The anv-stroll headword: its citation form IS the plural. */
const entryRecord = {
  languageID: TAG,
  orthography: ["bezhin", "lxs-01"],
  categories: [{ upos: NOUN, feats: [masc, { feature: "Number", value: "Plur" }] }],
  definitions: [{ place: [1], text: "Louzoù-mor, dastumet war an aod." }],
  // Addressed at a cell no table carries: it must still render, below the
  // tables, which is the "nothing is ever dropped" half of the reader.
  otherForms: [{ tag: { feats: [{ feature: "Number", value: "Ptan" }] }, form: "bezhinoù" }],
};

const selector: Tag = {
  upos: NOUN,
  feats: [masc, { feature: "Number", value: "Plur" }],
};

const paradigmRecord: Omit<LeksisParadigmRecord, "$type" | "createdAt"> = {
  languageID: TAG,
  selectors: [selector],
  label: { long: "anvioù-kadarn stroll", short: "str." },
  tables: [
    {
      name: "Niveroù",
      rows: [
        [{ kind: "title", text: "Niver", colSpan: 2 }],
        [
          { kind: "title", text: "Stroll" },
          { kind: "title", text: "Unanenn" },
        ],
        [
          // No affixes at all: the cell is identical to its base, which for the
          // stroll headword is the lemma itself.
          { kind: "form", coords: [{ feature: "Number", value: "Plur" }], rules: [{}] },
          {
            kind: "form",
            coords: [{ feature: "Number", value: "Sgv" }],
            rules: [{ add: "enn" }],
          },
        ],
      ],
    },
    {
      name: "Stummoù all",
      rows: [
        [
          { kind: "title", text: "Daouad" },
          { kind: "title", text: "Strollad" },
        ],
        [
          // A rule that declines for this lemma: the language's own answer is
          // "no form here", drawn as an em dash.
          {
            kind: "form",
            coords: [{ feature: "Number", value: "Dual" }],
            rules: [{ match: "zz", add: "où" }],
          },
          // No rules at all: manual-only, drawn as a dot — an invitation.
          { kind: "form", coords: [{ feature: "Number", value: "Coll" }] },
        ],
      ],
    },
  ],
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

let lastTid = 0n;
function tid(): string {
  const CHARS = "234567abcdefghijklmnopqrstuvwxyz";
  let now = BigInt(Date.now()) * 1000n;
  if (now <= lastTid) now = lastTid + 1n;
  lastTid = now;
  let value = (now << 10n) | BigInt(Math.floor(Math.random() * 1024));
  let out = "";
  for (let i = 0; i < 13; i++) {
    out = CHARS[Number(value & 31n)]! + out;
    value >>= 5n;
  }
  return out;
}

async function put(
  agent: AtpAgent,
  did: string,
  collection: string,
  rkey: string,
  record: Record<string, unknown>,
): Promise<string> {
  const res = await agent.com.atproto.repo.putRecord({
    repo: did,
    collection,
    rkey,
    record: { $type: collection, ...record, createdAt: new Date().toISOString() },
  });
  return res.data.uri;
}

async function waitFor(url: string, ok: (body: unknown) => boolean): Promise<boolean> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const res = await fetch(url).catch(() => null);
    if (res?.ok === true && ok(await res.json())) return true;
    await sleep(2000);
  }
  return false;
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? "publish";
  const { service, identifier, password } = credentials();
  const agent = new AtpAgent({ service });
  await agent.login({ identifier, password });
  const did = agent.session?.did;
  if (did === undefined) throw new Error("logged in but no DID");
  const paradigmKey = paradigmRkey({ languageID: TAG, selectors: [selector] });

  if (mode === "teardown") {
    for (const collection of [
      LEKSIS_ENTRY_COLLECTION,
      LEKSIS_PARADIGM_COLLECTION,
      LEKSIS_LANGUAGE_COLLECTION,
    ]) {
      const page = await agent.com.atproto.repo.listRecords({ repo: did, collection, limit: 100 });
      for (const row of page.data.records) {
        const value = row.value as Record<string, unknown>;
        const rkey = row.uri.slice(row.uri.lastIndexOf("/") + 1);
        const lang = collection === LEKSIS_LANGUAGE_COLLECTION ? rkey : value.languageID;
        if (lang !== TAG) continue;
        await agent.com.atproto.repo.deleteRecord({ repo: did, collection, rkey });
        console.log(`deleted ${collection}/${rkey}`);
      }
    }
    return;
  }

  const languageURI = await put(agent, did, LEKSIS_LANGUAGE_COLLECTION, TAG, languageRecord);
  console.log(`language ${languageURI}`);
  // `currentRecord` serves a POINTER, not the record: the AppView never sends a
  // language's content. Seeing the cid we just wrote is the whole check — and
  // since ADR-0015 a refused grammar leaves the previous cid in place, so a
  // stale one is exactly how a refusal shows.
  const gotLanguage = await waitFor(
    `${API}/languages/${TAG}/currentRecord`,
    (body) => typeof (body as { cid?: string }).cid === "string",
  );
  console.log(`  indexed: ${gotLanguage}`);

  // The other flavour of the same category: an ordinary singular headword.
  // Its bundle is `{NOUN, Gender=Masc, Number=Sing}`, so the paradigm above —
  // which selects the plural-headword bundle — must not reach it. That is the
  // merge's whole point, seen from the reader's side.
  const singURI = await put(agent, did, LEKSIS_ENTRY_COLLECTION, tid(), {
    ...entryRecord,
    orthography: ["kambr", "lxs-02"],
    categories: [{ upos: NOUN, feats: [masc, { feature: "Number", value: "Sing" }] }],
    definitions: [{ place: [1], text: "Ul lec'h serret e-barzh un ti." }],
    otherForms: [],
  });
  let singKey: string | null = null;
  await waitFor(`${API}/entries/resolve?uri=${encodeURIComponent(singURI)}`, (body) => {
    const found = (body as { entries?: Record<string, string> }).entries?.[singURI];
    if (found === undefined) return false;
    singKey = found;
    return true;
  });
  console.log(`  singular headword: ${singKey ?? "UNRESOLVED"}`);

  const entryURI = await put(agent, did, LEKSIS_ENTRY_COLLECTION, tid(), entryRecord);
  console.log(`entry ${entryURI}`);
  let entryKey: string | null = null;
  await waitFor(`${API}/entries/resolve?uri=${encodeURIComponent(entryURI)}`, (body) => {
    const found = (body as { entries?: Record<string, string> }).entries?.[entryURI];
    if (found === undefined) return false;
    entryKey = found;
    return true;
  });
  console.log(`  entryKey: ${entryKey ?? "UNRESOLVED"}`);

  const paradigmURI = await put(
    agent,
    did,
    LEKSIS_PARADIGM_COLLECTION,
    paradigmKey,
    paradigmRecord as unknown as Record<string, unknown>,
  );
  console.log(`paradigm ${paradigmURI} (${paradigmKey})`);
  const gotParadigm = await waitFor(`${API}/languages/${TAG}/paradigms`, (body) =>
    (body as { paradigms: { paradigmKey: string }[] }).paradigms.some(
      (p) => p.paradigmKey === paradigmKey,
    ),
  );
  console.log(`  indexed: ${gotParadigm}`);
  console.log(`\nentry page: http://127.0.0.1:5173/entry/${entryKey ?? "?"}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
