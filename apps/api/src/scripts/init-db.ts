// One-shot, idempotent database bootstrap.
//
// Creates the project database (if missing) and the first empty collections
// per the week-1 plan: `languages`, `entries`, `definitions` (document nodes)
// and `translations` (edge). Re-running it is safe — existing collections are
// left untouched.
//
//   npm run db:init            (from repo root)
//   npm run db:init -w @leksis/api
//
// Requires ARANGO_URL / ARANGO_DB / ARANGO_USER / ARANGO_PASSWORD in the env.

import { Database } from "arangojs";

const url = process.env.ARANGO_URL ?? "http://127.0.0.1:8529";
const dbName = process.env.ARANGO_DB ?? "leksis";
const username = process.env.ARANGO_USER ?? "root";
const password = process.env.ARANGO_PASSWORD ?? "";

const documentCollections = ["languages", "entries", "definitions"];
const edgeCollections = ["translations"];

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
      await col.create({ type: 3 }); // 3 = edge collection
      console.log(`created edge collection "${name}"`);
    } else {
      console.log(`edge collection "${name}" already exists`);
    }
  }

  console.log("database init complete.");
}

main().catch((err) => {
  console.error("database init failed:", err);
  process.exit(1);
});
