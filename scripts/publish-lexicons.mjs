/* 
  Publish Leksis lexicons as com.atproto.lexicon.schema records so that 
  `eu.leksis.*` NSIDs are resolvable (atproto.at, other resolvers, future 
  lexicon tooling).
  Resolution path an external resolver follows:
    NSID  eu.leksis.entry
      -> reverse authority -> DNS TXT `_lexicon.leksis.eu` -> `did=<PUBLISHER_DID>`
      -> fetch at://<PUBLISHER_DID>/com.atproto.lexicon.schema/eu.leksis.entry
  So the DID that runs this script MUST be the same DID the DNS TXT points at.
  This publishes to the project-owned account on pds.leksis.eu.
  IMPORTANT: pds.leksis.eu gates all writes (createSession/putRecord) to the
  operator IP allowlist at the Caddy edge. Run this FROM THE SERVER (or an
  allowlisted IP). Reads work from anywhere, so once published the records
  resolve for everyone.
  
  Usage (from the repo root, on an allowlisted host):
    PDS_URL=https://pds.leksis.eu \
    LEKSIS_HANDLE=lexicons.leksis.eu \
    LEKSIS_APP_PASSWORD=idem-xxxx-xxxx-xxxx \
    node scripts/publish-lexicons.mjs

  Optional: DRY_RUN=1 prints the records and the target DID without writing. */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { AtpAgent } from "@atproto/api";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LEXICON_DIR = join(__dirname, "..", "lexicons");

const {
  PDS_URL = "https://pds.leksis.eu",
  LEKSIS_HANDLE,
  LEKSIS_APP_PASSWORD,
  DRY_RUN,
} = process.env;

function die(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

// Load every lexicons/*.json and turn it into a com.atproto.lexicon.schema
// record. The lexicon file body IS the record body (plus $type); rkey = id.
function loadSchemaRecords() {
  const files = readdirSync(LEXICON_DIR).filter((f) => f.endsWith(".json"));
  if (files.length === 0) die(`No lexicon JSON files in ${LEXICON_DIR}`);

  return files.map((file) => {
    const raw = JSON.parse(readFileSync(join(LEXICON_DIR, file), "utf8"));
    if (raw.lexicon !== 1) die(`${file}: expected "lexicon": 1`);
    if (typeof raw.id !== "string") die(`${file}: missing string "id"`);
    if (typeof raw.defs !== "object") die(`${file}: missing "defs" object`);

    return {
      nsid: raw.id, // rkey of the schema record
      record: {
        $type: "com.atproto.lexicon.schema",
        lexicon: 1,
        id: raw.id,
        defs: raw.defs,
      },
    };
  });
}

async function main() {
  const schemas = loadSchemaRecords();

  if (DRY_RUN) {
    console.log(`DRY_RUN — would publish ${schemas.length} schema record(s):\n`);
    for (const { nsid, record } of schemas) {
      console.log(`• rkey=${nsid}`);
      console.log(JSON.stringify(record, null, 2));
      console.log();
    }
    console.log(
      "Next: point DNS TXT `_lexicon.leksis.eu` at the publisher DID printed on a real run.",
    );
    return;
  }

  if (!LEKSIS_HANDLE || !LEKSIS_APP_PASSWORD)
    die("Set LEKSIS_HANDLE and LEKSIS_APP_PASSWORD (app password) in the env.");

  const agent = new AtpAgent({ service: PDS_URL });
  await agent.login({
    identifier: LEKSIS_HANDLE,
    password: LEKSIS_APP_PASSWORD,
  });
  const did = agent.session.did;
  console.log(`Logged in as ${LEKSIS_HANDLE} → ${did}`);
  console.log(`Publishing to ${PDS_URL}\n`);

  for (const { nsid, record } of schemas) {
    // putRecord (rkey = NSID) so re-runs update in place instead of duplicating.
    await agent.com.atproto.repo.putRecord({
      repo: did,
      collection: "com.atproto.lexicon.schema",
      rkey: nsid,
      record,
    });
    console.log(`✔ published com.atproto.lexicon.schema/${nsid}`);
  }

  console.log(`
Done. Two more steps to make the schemas resolvable:

  1. Add a DNS TXT record:
       name:  _lexicon.leksis.eu
       value: did=${did}

  2. Verify:
       dig +short TXT _lexicon.leksis.eu        # should show did=${did}
       curl -s "${PDS_URL}/xrpc/com.atproto.repo.getRecord?repo=${did}&collection=com.atproto.lexicon.schema&rkey=eu.leksis.entry"

  Then re-open the atproto.at page — the schema should resolve.
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
