/*
  Publish the Leksis testset fixture set, then regenerate its manifest.

  The agent reading `.claude/skills/leksis-testset` IS the test runner: this is
  the script it runs. It publishes the three quarantined fixture languages, the
  works their examples cite, the entries, and — new at layer 5 — the paradigms,
  in that order, and then reads the live API back to write `manifest.json`.

  Order matters and is the skill's §4.2: tags published before their bindings
  render verbatim until the language catches up, and an example published before
  its source cites a number that resolves to nothing. (The second is not an
  error — a citation to an undescribed number is valid, and is S-02's whole
  subject — but a fixture meant to show a RESOLVED citation should not spend its
  first minutes showing an unresolved one.)

  Credentials come from `apps/web/.env.local`, the gitignored file the dev
  session already reads (`apps/web/src/auth/dev-session.ts`). They are never
  printed and never logged.

    npx tsx scripts/publish-fixtures.ts            # publish, then write the manifest
    npx tsx scripts/publish-fixtures.ts --check    # validate only, write nothing
    npx tsx scripts/publish-fixtures.ts --manifest # rebuild the manifest alone

  Note pds.leksis.eu gates writes to an operator IP allowlist at the Caddy edge.
  Reads work from anywhere; a write from an unlisted host fails at the edge, not
  at the credential.
*/

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AtpAgent } from "@atproto/api";
import {
  LEKSIS_ENTRY_COLLECTION,
  LEKSIS_LANGUAGE_COLLECTION,
  LEKSIS_PARADIGM_COLLECTION,
  LEKSIS_SOURCE_COLLECTION,
  paradigmRkey,
} from "@leksis/types";
import { checkFixtures } from "./fixtures/check.ts";
import { entryFixtures } from "./fixtures/entries.ts";
import { languageFixtures } from "./fixtures/languages.ts";
import { paradigmFixtures } from "./fixtures/paradigms.ts";
import { sourceFixtures } from "./fixtures/sources.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST = join(HERE, "fixtures", "manifest.json");
const ENV_LOCAL = join(HERE, "..", "apps", "web", ".env.local");

const API = process.env.LEKSIS_API ?? "https://leksis.eu/api";
const SITE = process.env.LEKSIS_SITE ?? "https://leksis.eu";

/** How long to wait for the firehose to carry a record into the index. */
const INDEX_TIMEOUT_MS = 60_000;
const POLL_MS = 2000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

/**
 * Read the dev session's three variables out of `apps/web/.env.local`.
 *
 * Deliberately parsed here rather than passed on a command line: the password
 * belongs in the gitignored file the user filled in by hand, and nothing that
 * handles it should ever put it in a shell history or a process listing.
 */
function credentials(): { service: string; identifier: string; password: string } {
  let text: string;
  try {
    text = readFileSync(ENV_LOCAL, "utf8");
  } catch {
    throw new Error(`no ${ENV_LOCAL} — the dev-session variables live there (see CLAUDE.md)`);
  }
  const read = (key: string): string => {
    const line = text.split("\n").find((row) => row.trimStart().startsWith(`${key}=`));
    return line === undefined ? "" : line.slice(line.indexOf("=") + 1).trim();
  };
  const service = read("VITE_DEV_PDS");
  const identifier = read("VITE_DEV_HANDLE");
  const password = read("VITE_DEV_PASSWORD");
  for (const [name, value] of [
    ["VITE_DEV_PDS", service],
    ["VITE_DEV_HANDLE", identifier],
    ["VITE_DEV_PASSWORD", password],
  ] as const) {
    if (value === "") throw new Error(`${name} is blank in ${ENV_LOCAL}`);
  }
  return { service, identifier, password };
}

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

interface Published {
  uri: string;
  cid: string;
}

async function put(
  agent: AtpAgent,
  did: string,
  collection: string,
  rkey: string,
  record: Record<string, unknown>,
): Promise<Published> {
  const response = await agent.com.atproto.repo.putRecord({
    repo: did,
    collection,
    rkey,
    record: { $type: collection, ...record, createdAt: new Date().toISOString() },
  });
  return { uri: response.data.uri, cid: response.data.cid };
}

/** Poll until the AppView serves this cid for the language, or give up. */
async function waitForLanguage(tag: string, cid: string): Promise<boolean> {
  const deadline = Date.now() + INDEX_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const response = await fetch(`${API}/languages/${tag}/currentRecord`).catch(() => null);
    if (response?.ok === true) {
      const body = (await response.json()) as { cid?: string };
      if (body.cid === cid) return true;
    }
    await sleep(POLL_MS);
  }
  return false;
}

/** Record URI → entryKey, over the endpoint that exists for exactly this. */
async function resolveEntryKey(uri: string): Promise<string | null> {
  const deadline = Date.now() + INDEX_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const response = await fetch(`${API}/entries/resolve?uri=${encodeURIComponent(uri)}`).catch(
      () => null,
    );
    if (response?.ok === true) {
      // `entries` is recordURI → entryKey, not a list.
      const body = (await response.json()) as { entries?: Record<string, string> };
      const found = body.entries?.[uri];
      if (found !== undefined) return found;
    }
    await sleep(POLL_MS);
  }
  return null;
}

/** Every record key the fixture set declares, per collection. */
function declaredKeys(): Map<string, Set<string>> {
  return new Map([
    [LEKSIS_LANGUAGE_COLLECTION, new Set(languageFixtures.map((f) => f.record.tag))],
    [LEKSIS_SOURCE_COLLECTION, new Set(sourceFixtures.map((f) => f.record.oclc))],
    [LEKSIS_PARADIGM_COLLECTION, new Set(paradigmFixtures.map((f) => paradigmRkey(f.record)))],
  ]);
}

/** The quarantined language tags — the boundary every sweep respects. */
const FIXTURE_TAGS = new Set(languageFixtures.map((f) => f.record.tag));

/**
 * Remove everything inside the quarantine that the fixture set does not
 * declare — the leftovers a test session wrote and should not have left behind.
 *
 * **Run this whenever a test that wrote anything completes.** A browsing test
 * that publishes a paradigm to check the publish path, or an entry to check the
 * editor, leaves a record on the PDS *and* a row in the production index; left
 * alone they accumulate, and the next session cannot tell them from the set it
 * is supposed to be asserting against.
 *
 * **The boundary is the quarantine, not the account.** This account is also the
 * one a human logs the dev build in as, so a sweep scoped to "everything in
 * these collections" would take their own work with it. Only records whose
 * language is `qtl`/`qtm`/`qto` (or, for a source, whose number is in the
 * 16-digit fixture range) are touched — anything in a real language is left
 * exactly where it is.
 *
 * **It cannot un-publish a language version.** Deleting the record removes it
 * from the PDS, but `languages` versions archive forever in the index by
 * design. That asymmetry is why `qto` carries the deliberate breakage and `qtl`
 * never does, and it is the reason to think before publishing a language
 * version rather than to rely on this.
 */
async function sweepScratch(
  agent: AtpAgent,
  did: string,
  dryRun: boolean,
  /**
   * `"scratch"` spares what the fixture set declares — the sweep a test run
   * ends with. `"all"` spares nothing inside the quarantine: the **teardown**,
   * which is how a session that published the set removes it again, so the
   * production index does not carry fake entries between runs.
   */
  mode: "scratch" | "all" = "scratch",
): Promise<void> {
  const declared = mode === "all" ? new Map<string, Set<string>>() : declaredKeys();
  const fixtureHandles = mode === "all" ? new Set<string>() : new Set(entryFixtures.map((f) => f.handle));
  const doomed: { collection: string; rkey: string; why: string }[] = [];
  // Counted so that "nothing left behind" is distinguishable from "scanned
  // nothing" — a sweep that silently walked an empty repo would report success.
  let scanned = 0;

  for (const collection of [
    LEKSIS_LANGUAGE_COLLECTION,
    LEKSIS_SOURCE_COLLECTION,
    LEKSIS_ENTRY_COLLECTION,
    LEKSIS_PARADIGM_COLLECTION,
  ]) {
    let cursor: string | undefined;
    do {
      const page = await agent.com.atproto.repo.listRecords({
        repo: did,
        collection,
        limit: 100,
        ...(cursor === undefined ? {} : { cursor }),
      });
      for (const row of page.data.records) {
        scanned += 1;
        const rkey = row.uri.slice(row.uri.lastIndexOf("/") + 1);
        const value = row.value as { languageID?: unknown; orthography?: unknown; oclc?: unknown };

        if (collection === LEKSIS_ENTRY_COLLECTION) {
          // In the quarantine, and not one of the declared handles.
          if (typeof value.languageID !== "string" || !FIXTURE_TAGS.has(value.languageID)) continue;
          const orthography = Array.isArray(value.orthography) ? value.orthography : [];
          const claims = orthography.some(
            (item) => typeof item === "string" && fixtureHandles.has(item),
          );
          if (!claims) {
            doomed.push({
              collection,
              rkey,
              why: mode === "all" ? "a fixture-language entry" : "a fixture-language entry with no declared handle",
            });
          }
          continue;
        }

        if (collection === LEKSIS_SOURCE_COLLECTION) {
          // The 16-digit range is the source quarantine; a real number is not ours.
          if (typeof value.oclc !== "string" || value.oclc.length !== 16) continue;
          if (!(declared.get(collection)?.has(rkey) ?? false)) {
            doomed.push({ collection, rkey, why: "a source in the fixture number range" });
          }
          continue;
        }

        // Languages and paradigms: keyed on the tag / the selector hash.
        const tag = collection === LEKSIS_LANGUAGE_COLLECTION ? rkey : value.languageID;
        if (typeof tag !== "string" || !FIXTURE_TAGS.has(tag)) continue;
        if (!(declared.get(collection)?.has(rkey) ?? false)) {
          doomed.push({ collection, rkey, why: "inside the quarantine" });
        }
      }
      cursor = page.data.cursor;
    } while (cursor !== undefined);
  }

  if (doomed.length === 0) {
    console.log(
      `sweep: scanned ${scanned} record(s), nothing left behind — the PDS holds exactly what the fixture set declares`,
    );
    return;
  }
  console.log(`sweep: scanned ${scanned} record(s)`);
  for (const row of doomed) {
    console.log(`  ${dryRun ? "would delete" : "deleting"} ${row.collection}/${row.rkey} — ${row.why}`);
  }
  if (dryRun) return;
  for (const row of doomed) {
    await agent.com.atproto.repo.deleteRecord({ repo: did, collection: row.collection, rkey: row.rkey });
  }
  console.log(`sweep: removed ${doomed.length} leftover record(s)`);
}

/**
 * Delete the bot's existing fixture entries, so a re-run replaces the set
 * instead of doubling it.
 *
 * An entry's record key is a TID, which cannot be derived from a handle, so
 * this is the only way the script can be idempotent — and it is the skill's own
 * reset path: entry deletions are mirrored by the AppView, so deleting these
 * genuinely cleans the index.
 *
 * **Scoped to records carrying an `lxt-` handle**, never to the whole
 * collection: this account is also the one a human logs the dev build in as,
 * and sweeping its repo wholesale would take their own test entries with it.
 */
async function sweepFixtureEntries(agent: AtpAgent, did: string): Promise<number> {
  const doomed: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await agent.com.atproto.repo.listRecords({
      repo: did,
      collection: LEKSIS_ENTRY_COLLECTION,
      limit: 100,
      ...(cursor === undefined ? {} : { cursor }),
    });
    for (const row of page.data.records) {
      const orthography = (row.value as { orthography?: unknown }).orthography;
      const isFixture =
        Array.isArray(orthography) &&
        orthography.some((item) => typeof item === "string" && item.startsWith("lxt-"));
      if (isFixture) doomed.push(row.uri.slice(row.uri.lastIndexOf("/") + 1));
    }
    cursor = page.data.cursor;
  } while (cursor !== undefined);

  for (const rkey of doomed) {
    await agent.com.atproto.repo.deleteRecord({
      repo: did,
      collection: LEKSIS_ENTRY_COLLECTION,
      rkey,
    });
  }
  return doomed.length;
}

interface ManifestEntry {
  handle: string;
  languageID: string;
  entryKey: string | null;
  url: string | null;
  recordURI: string;
  covers: string[];
  expect: string;
}

async function publishAll(): Promise<void> {
  const { service, identifier, password } = credentials();
  const agent = new AtpAgent({ service });
  await agent.login({ identifier, password });
  const did = agent.session?.did;
  if (did === undefined) throw new Error("logged in but no DID on the session");
  console.log(`publishing as ${did}`);

  // --- 1. languages ------------------------------------------------------
  const languages: {
    tag: string;
    role: string;
    url: string;
    recordURI: string;
    covers: string[];
    expect: string;
  }[] = [];
  for (const fixture of languageFixtures) {
    const { tag } = fixture.record;
    const published = await put(agent, did, LEKSIS_LANGUAGE_COLLECTION, tag, fixture.record);
    // Since ADR-0015 an incoherent grammar is REFUSED, so a run that publishes
    // one leaves the language silently on its previous version. There is no
    // `grammarIssues` field to check any more: confirm the AppView serves the
    // cid we just wrote, and treat a stale one as a failed run.
    const indexed = await waitForLanguage(tag, published.cid);
    if (!indexed) throw new Error(`${tag}: the version just published never became current`);
    console.log(`  ${tag} (${fixture.role}) indexed`);

    if (fixture.rewrite !== undefined) {
      // The defective rewrite. It must be REFUSED: the coherent version above
      // stays current, so the language stays browsable, while the browser reads
      // this content by rkey and the binding editor lists every defect.
      const rewritten = await put(agent, did, LEKSIS_LANGUAGE_COLLECTION, tag, fixture.rewrite);
      await sleep(POLL_MS * 4);
      const response = await fetch(`${API}/languages/${tag}/currentRecord`);
      const body = (await response.json()) as { cid?: string };
      if (body.cid === rewritten.cid) {
        throw new Error(
          `${tag}: the DEFECTIVE rewrite was indexed — the ADR-0015 gate did not refuse it`,
        );
      }
      console.log(`  ${tag} defective rewrite refused, as it must be`);
    }
    languages.push({
      tag,
      role: fixture.role,
      url: `${SITE}/language/${tag}`,
      recordURI: published.uri,
      covers: fixture.covers,
      expect: fixture.expect,
    });
  }

  // --- 2. sources --------------------------------------------------------
  const sources = [];
  for (const fixture of sourceFixtures) {
    const { oclc } = fixture.record;
    const published = await put(agent, did, LEKSIS_SOURCE_COLLECTION, oclc, fixture.record);
    console.log(`  source ${oclc} published`);
    sources.push({
      oclc,
      url: `${SITE}/source/${oclc}`,
      recordURI: published.uri,
      covers: fixture.covers,
      expect: fixture.expect,
    });
  }

  // --- 3. entries --------------------------------------------------------
  const swept = await sweepFixtureEntries(agent, did);
  if (swept > 0) console.log(`  swept ${swept} entry record(s) from a previous run`);

  // Two passes, because a redirect names an entryKey the AppView mints from the
  // creating record's URI — which cannot be known before that record lands.
  const byHandle = new Map<string, ManifestEntry>();
  const deferred: typeof entryFixtures = [];
  for (const fixture of entryFixtures) {
    if (fixture.redirectToHandle !== undefined) {
      deferred.push(fixture);
      continue;
    }
    byHandle.set(fixture.handle, await publishEntry(agent, did, fixture));
  }
  for (const fixture of deferred) {
    const target = byHandle.get(fixture.redirectToHandle!);
    if (target?.entryKey == null) {
      throw new Error(`${fixture.handle}: cannot redirect at ${fixture.redirectToHandle} — unresolved`);
    }
    byHandle.set(fixture.handle, await publishEntry(agent, did, fixture, target.entryKey));
  }

  // --- 4. paradigms ------------------------------------------------------
  // Last, so that every entry a rule reaches is already indexed and the
  // expansion job's "entries the selector reaches now" path is what runs.
  const paradigms = [];
  for (const fixture of paradigmFixtures) {
    const rkey = paradigmRkey(fixture.record);
    const published = await put(agent, did, LEKSIS_PARADIGM_COLLECTION, rkey, fixture.record);
    console.log(`  paradigm ${fixture.handle} → ${rkey}`);
    paradigms.push({
      handle: fixture.handle,
      languageID: fixture.record.languageID,
      paradigmKey: rkey,
      recordURI: published.uri,
      covers: fixture.covers,
      expect: fixture.expect,
    });
  }

  // Whatever a previous session left inside the quarantine and this set does
  // not declare, goes now — so the run ends with the PDS holding exactly the
  // manifest, and no later session has to tell a leftover from a fixture.
  await sweepScratch(agent, did, false);

  await writeManifest(did, languages, sources, [...byHandle.values()], paradigms);
}

async function publishEntry(
  agent: AtpAgent,
  did: string,
  fixture: (typeof entryFixtures)[number],
  redirectTo?: string,
): Promise<ManifestEntry> {
  const first = redirectTo === undefined ? fixture.record : { ...fixture.record, redirectTo };
  let published = await put(agent, did, LEKSIS_ENTRY_COLLECTION, tid(), first);
  const firstURI = published.uri;
  for (const version of fixture.versions ?? []) {
    // Chained by `subject`, which is what makes these versions of ONE entry
    // rather than a pile of homonyms.
    published = await put(agent, did, LEKSIS_ENTRY_COLLECTION, tid(), {
      ...version,
      subject: published.uri,
    });
  }
  // The entryKey hashes the CREATING record's URI and rides the subject chain,
  // so it is the first version that has to be resolved, not the last.
  const entryKey = await resolveEntryKey(firstURI);
  console.log(`  ${fixture.handle} → ${entryKey ?? "UNRESOLVED"}`);
  return {
    handle: fixture.handle,
    languageID: fixture.record.languageID,
    entryKey,
    url: entryKey === null ? null : `${SITE}/entry/${entryKey}`,
    recordURI: published.uri,
    covers: fixture.covers,
    expect: fixture.expect,
  };
}

/** A record key in TID order, which is what the entry lexicon asks for. */
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

async function writeManifest(
  botDID: string,
  languages: unknown[],
  sources: unknown[],
  entries: ManifestEntry[],
  paradigms: unknown[],
): Promise<void> {
  const manifest = {
    generatedAt: new Date().toISOString(),
    botDID,
    site: SITE,
    note: "Regenerated from the live API by scripts/publish-fixtures.ts. Never hand-edit: a stale manifest sends an agent to a 404 and it reports a regression that does not exist.",
    languages,
    sources,
    entries,
    paradigms,
  };
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`manifest written: ${MANIFEST}`);
  const unresolved = entries.filter((row) => row.entryKey === null);
  if (unresolved.length > 0) {
    console.warn(`  ${unresolved.length} entr(ies) unresolved: ${unresolved.map((r) => r.handle).join(", ")}`);
  }
}

// ---------------------------------------------------------------------------

/**
 * Rebuild the manifest from what is live, publishing nothing.
 *
 * Reads are public, so this needs no credentials — which is the point: a later
 * session that only wants to refresh the addresses should not have to touch the
 * write path. It reads the bot's repo rather than the search endpoint, because
 * a WITHDRAWN entry is absent from search by design and must still be findable
 * at its own URL.
 */
async function rebuildManifest(): Promise<void> {
  const botDID = process.env.LEKSIS_FIXTURE_DID ?? readManifestDID();
  const agent = new AtpAgent({ service: process.env.LEKSIS_PDS ?? "https://pds.leksis.eu" });

  const records = new Map<string, { uri: string; value: Record<string, unknown> }[]>();
  for (const collection of [LEKSIS_ENTRY_COLLECTION, LEKSIS_PARADIGM_COLLECTION]) {
    const all: { uri: string; value: Record<string, unknown> }[] = [];
    let cursor: string | undefined;
    do {
      const page = await agent.com.atproto.repo.listRecords({
        repo: botDID,
        collection,
        limit: 100,
        ...(cursor === undefined ? {} : { cursor }),
      });
      for (const row of page.data.records) {
        all.push({ uri: row.uri, value: row.value as Record<string, unknown> });
      }
      cursor = page.data.cursor;
    } while (cursor !== undefined);
    records.set(collection, all);
  }

  const entryRecords = records.get(LEKSIS_ENTRY_COLLECTION) ?? [];
  const entries: ManifestEntry[] = [];
  for (const fixture of entryFixtures) {
    // The entryKey hashes the CREATING record's URI and rides the `subject`
    // chain, so the oldest record carrying this handle is the one to resolve.
    const mine = entryRecords
      .filter((row) => {
        const orthography = row.value.orthography;
        return Array.isArray(orthography) && orthography.includes(fixture.handle);
      })
      .sort((a, b) => a.uri.localeCompare(b.uri));
    const first = mine[0];
    const entryKey = first === undefined ? null : await resolveEntryKey(first.uri);
    entries.push({
      handle: fixture.handle,
      languageID: fixture.record.languageID,
      entryKey,
      url: entryKey === null ? null : `${SITE}/entry/${entryKey}`,
      recordURI: mine[mine.length - 1]?.uri ?? "",
      covers: fixture.covers,
      expect: fixture.expect,
    });
  }

  const paradigms = paradigmFixtures.map((fixture) => {
    const rkey = paradigmRkey(fixture.record);
    return {
      handle: fixture.handle,
      languageID: fixture.record.languageID,
      paradigmKey: rkey,
      recordURI: `at://${botDID}/${LEKSIS_PARADIGM_COLLECTION}/${rkey}`,
      covers: fixture.covers,
      expect: fixture.expect,
    };
  });

  await writeManifest(
    botDID,
    languageFixtures.map((fixture) => ({
      tag: fixture.record.tag,
      role: fixture.role,
      url: `${SITE}/language/${fixture.record.tag}`,
      recordURI: `at://${botDID}/${LEKSIS_LANGUAGE_COLLECTION}/${fixture.record.tag}`,
      covers: fixture.covers,
      expect: fixture.expect,
    })),
    sourceFixtures.map((fixture) => ({
      oclc: fixture.record.oclc,
      url: `${SITE}/source/${fixture.record.oclc}`,
      recordURI: `at://${botDID}/${LEKSIS_SOURCE_COLLECTION}/${fixture.record.oclc}`,
      covers: fixture.covers,
      expect: fixture.expect,
    })),
    entries,
    paradigms,
  );
}

/** The DID the last run published as, so a rebuild needs no argument. */
function readManifestDID(): string {
  try {
    const existing = JSON.parse(readFileSync(MANIFEST, "utf8")) as { botDID?: string };
    if (typeof existing.botDID === "string" && existing.botDID !== "") return existing.botDID;
  } catch {
    /* falls through to the error below */
  }
  throw new Error("no botDID: pass LEKSIS_FIXTURE_DID, or run a full publish first");
}

async function main(): Promise<void> {
  const { failures, notes } = checkFixtures();
  for (const note of notes) console.log(`· ${note}`);
  if (failures.length > 0) {
    console.error(`\n${failures.length} fixture(s) would not survive ingest:`);
    for (const failure of failures) console.error(`  ✗ ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log("· every fixture passes the validators the AppView runs\n");
  if (process.argv.includes("--check")) return;
  if (process.argv.includes("--manifest")) {
    await rebuildManifest();
    return;
  }
  const teardown = process.argv.includes("--teardown") || process.argv.includes("--teardown-dry");
  const sweep = process.argv.includes("--sweep") || process.argv.includes("--sweep-dry");
  if (teardown || sweep) {
    const { service, identifier, password } = credentials();
    const agent = new AtpAgent({ service });
    await agent.login({ identifier, password });
    const did = agent.session?.did;
    if (did === undefined) throw new Error("logged in but no DID on the session");
    const dry = process.argv.includes("--sweep-dry") || process.argv.includes("--teardown-dry");
    await sweepScratch(agent, did, dry, teardown ? "all" : "scratch");
    if (teardown && !dry) {
      // A manifest naming records that no longer exist is worse than none: it
      // sends the next session to a 404 and it reports a regression that does
      // not exist. So the teardown blanks it rather than leaving it standing.
      writeFileSync(
        MANIFEST,
        `${JSON.stringify(
          {
            tornDownAt: new Date().toISOString(),
            botDID: did,
            site: SITE,
            note: "The fixture set is NOT published. It is ephemeral: publish it (npx tsx scripts/publish-fixtures.ts), test against the manifest that run writes, then tear it down again. entryKeys are minted per run and never repeat, so nothing here can be predicted in advance.",
            languages: [],
            sources: [],
            entries: [],
            paradigms: [],
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
      console.log(`manifest blanked: ${MANIFEST}`);
      console.log(
        "\nNOTE: the three fixture LANGUAGES stay listed. `languages` versions archive rather than\n" +
          "un-publish (language references are structural to the app), so qtl/qtm/qto remain in the\n" +
          "picker and on GET /languages permanently. Their entries, sources and paradigms are gone.",
      );
    }
    return;
  }
  await publishAll();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
