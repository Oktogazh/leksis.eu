---
name: leksis-ingest
description: >
  Context for building external ingestion bots ("scrapers") that load dictionary content into Leksis (leksis.eu) by writing eu.leksis.* records to the project's bot PDS (pds.leksis.eu). Use this skill in any scraper/importer mini-project repo that converts a source (a dictionary, a Wiktionary dump, etc.) into eu.leksis.entry records. Covers the target architecture, the exact lexicon shapes and their invariants, how to create a bot account and publish records with @atproto/api, and how the AppView will treat what you publish. Maintained in the leksis.eu monorepo (.claude/skills/leksis-ingest/) — it is derived from the canonical files listed at the bottom; if this skill and the live lexicons disagree, the lexicons win.
---

# Leksis ingestion bots — writing records to the bot PDS

## What you are building

Leksis is a distributed, crowdsourced multilingual dictionary on AT Protocol.
Content does not go into its database directly: **contributors publish
`eu.leksis.*` records on their own PDS**, the Bluesky relay crawls that PDS,
Jetstream re-serves the events, and the Leksis AppView (api.leksis.eu) indexes
what search needs. The record on the PDS remains the source of truth for the
content; the web app renders an entry by fetching the record straight from the
author's PDS.

An ingestion bot is just another contributor: a script with an account on the
project's **bot-only PDS at `pds.leksis.eu`** that converts one external source
into well-formed `eu.leksis.entry` records and writes them to its own repo.
Nothing else — no direct DB access, no private AppView API. If the records are
valid, they flow into the index automatically.

```
scraper script ──com.atproto.repo.createRecord──▶ pds.leksis.eu
                                                      │ (crawled by bsky.network relay)
                                                      ▼
                                            Jetstream firehose
                                                      │ (wantedCollections=eu.leksis.*)
                                                      ▼
                                       Leksis AppView → ArangoDB search index
```

Consequence: **there is no synchronous feedback.** `createRecord` succeeding
means the record is on the PDS, not that the AppView accepted it. Invalid
records are logged and *silently skipped* by the AppView. Validate locally
before writing (invariants below) — a bad batch is easy to publish and tedious
to clean up.

## The bot PDS

- **Host:** `https://pds.leksis.eu` — a standard `ghcr.io/bluesky-social/pds`
  (v0.4) instance, part of the leksis.eu docker-compose stack, public because
  federation requires it.
- **Accounts:** one account per bot/source, handle directly under the domain,
  e.g. `wikbot.leksis.eu` (the `*.leksis.eu` wildcard covers it). DIDs are
  normal `did:plc` DIDs.
- **Account creation** (`com.atproto.server.createAccount`) is **IP-gated at
  the Caddy edge** to the operator's allowlist (`AARDVARK_ALLOW_IPS` in the
  server's `.env`). Create the bot account once from an allowed IP (or ask
  Alan to); everything else (login, writes, reads) works from anywhere.
- **Auth for scripts:** plain session auth is fine for bots — no OAuth dance
  needed:

```ts
import { AtpAgent } from "@atproto/api";

const agent = new AtpAgent({ service: "https://pds.leksis.eu" });
await agent.login({
  identifier: "wikbot.leksis.eu",     // handle (or DID)
  password: process.env.BOT_PASSWORD!, // use an app password, keep it in env
});
```

- **Writing a record:**

```ts
await agent.com.atproto.repo.createRecord({
  repo: agent.session!.did,
  collection: "eu.leksis.entry",
  record: entryRecord, // shape below; rkey is a TID, let the PDS mint it
});
```

  For bulk loads prefer `com.atproto.repo.applyWrites` (up to 200 writes per
  call) and pace yourself — a PDS enforces rate limits per repo
  (~5000 write points / hour, a create = 3 points, i.e. roughly 1600
  creates/hour sustained). Batch, throttle, and make the script resumable.
- **Fixing mistakes:** `putRecord` (same rkey, full rewrite) republishes a
  version; `deleteRecord` removes it — and the AppView mirrors entry deletions
  (see lifecycle below), so deleting a bad record genuinely cleans the index.

## Record lifecycle rules (what the AppView does with your records)

- **Records prove authorship, not ownership** (Wikipedia model). Nobody owns
  an entry; the latest version wins, previous versions are archived.
- A record **without `subject` is a brand-new entry** — homonyms deliberately
  coexist. A record **with `subject`** (the `at://` URI of an existing entry
  record version) is a proposed new version of that entry and becomes its
  current version (last write wins). A `subject` the AppView never indexed
  degrades to a new entry.
- Records are always **full rewrites**, never patches.
- **Deletions are mirrored for entries:** deleting an `eu.leksis.entry` record
  from the bot's repo removes that version from the index; deleting an entry's
  last version removes the entry from search. (Language versions, by
  contrast, archive forever.)
- **Idempotency is on `recordURI + cid`** — replaying the same record is
  harmless, but re-*creating* the same content mints a new rkey and therefore
  a **duplicate entry**. A rerunnable importer must track what it already
  published (local state file, or `com.atproto.repo.listRecords` on its own
  repo) and use `putRecord`/`subject` to update rather than re-create.
- The AppView validates strictly at ingest: BCP 47 syntax on `languageID`,
  non-empty `orthography` and `definitions`, well-formed `{short, long}`
  pairs, and the `place` invariants. Invalid → skipped, no error surfaces.

## The `eu.leksis.entry` lexicon (rkey = TID)

Canonical JSON: `lexicons/eu.leksis.entry.json` in the leksis.eu repo.

```ts
{
  $type: "eu.leksis.entry",
  languageID: string,        // well-formed BCP 47 tag, LOWERCASE ("br", "br-gw"); max 64 chars
  orthography: string[],     // ≥1 spelling; [0] is the canonical form; each ≤128 graphemes
  categories: Annotation[],  // ordered grammatical categories; may be empty
  definitions: Definition[], // ≥1, FLAT list sorted by place (reading order)
  subject?: string,          // at:// URI of the version this modifies; omit for new entries
  createdAt: string,         // ISO datetime
}

Annotation = { short: string, long: string }
// One shape for both categories and notes: abbreviated form + what it stands
// for, e.g. { short: "n.", long: "noun" }, { short: "arch.", long: "archaic" }.
// Freeform — no enforced vocabulary — but keep one source's pairs consistent.
// short ≤32 graphemes, long ≤128.

Definition = {
  place: number[],           // hierarchy coordinate, 1–3 non-negative ints (see below)
  notes: Annotation[],       // lexicographic notes before the text; may be empty
  text: string,              // ≤2048 graphemes
}
```

### `place` — hierarchical definitions as a flat list

Each definition carries its coordinate in a hierarchy of up to 3 dimensions:
one 0-based index per dimension, deepest last; the array's **length is the
definition's own depth**. `[0]` = first top-level definition; `[1,0]` = first
sub-definition of the second; a standalone `[2]` can sit beside them (mixed
depths are legal). Display numbering follows the deepest length used:
1 → `1.`; 2 → `I. 1.`; 3 → `A. I. 1.`.

**Whole-list invariants — the AppView rejects the record if any fails:**

1. Sorted in reading order (lexicographic on place).
2. Sibling indices contiguous from 0 (no gaps: after `[1]` comes `[2]`, not `[3]`).
3. No place is a prefix of another (`[1]` and `[1,0]` cannot both exist — a
   definition cannot also be a group).

Equivalently, walked pairwise: each place increments its predecessor at
exactly one level and resets all deeper levels to 0. The reference validator
is `validDefinitionPlaces()` in `packages/types/src/entry.ts` of the leksis.eu
repo — copy it into the scraper and run it on every record before publishing.
A single flat list `[0], [1], [2]…` is always valid; only build hierarchy when
the source genuinely has one.

### Mapping a source into the shape — conventions

- **One entry record per headword sense-block** as the source structures it;
  spelling variants of the same word go into `orthography`, not separate
  entries. Distinct homonyms (separate entries in the source) → separate
  records.
- `languageID` is the language **being defined**; definition text is normally
  written in that same language for a monolingual source. Normalize the tag
  to lowercase and validate BCP 47 syntax (syntax only — like the AppView).
- Preserve the source's own labels as annotation pairs: expand abbreviations
  into `long` when the source documents them; if only the abbreviation is
  known, it's acceptable to set both to it — but prefer real expansions.
- `createdAt` = time of scraping/publication (it's client-declared version
  time, not the source's publication date).
- **Attribution & licensing:** only ingest sources whose license permits it,
  and make the bot account's profile state the source and license. Provenance
  fields on the record itself don't exist yet — don't invent extra fields;
  lexicon-unknown fields may be rejected or dropped.
- The language of your entries should exist as a `eu.leksis.language` record
  (shape: `{ tag, translations: [{languageID, translation}], createdAt }`,
  rkey = the lowercase tag, endonym required — i.e. one translation whose
  `languageID` equals `tag`). Check `GET https://leksis.eu/api/languages`
  first; publish the language record from the bot before the entries if it's
  missing.

## Verifying an ingestion run

1. **On the PDS:** `com.atproto.repo.listRecords` (repo = bot DID,
   collection = `eu.leksis.entry`) shows what was written.
2. **In the index (after relay/Jetstream propagation, usually seconds):**
   `GET https://leksis.eu/api/entries?q=<orthography>&l=<languageID>` should
   return the entry; `GET https://leksis.eu/api/entries/:key` its view.
3. **In the app:** search on leksis.eu; the entry page (`?e=<key>`) resolves
   the record content from the PDS — this exercises the full path.

If records are on the PDS but never appear in the index, they failed AppView
validation (check the invariants) or the PDS isn't being crawled — surface
that to Alan rather than re-publishing.

## Canonical sources (in the leksis.eu repo — resync this skill from them)

- `lexicons/eu.leksis.entry.json`, `lexicons/eu.leksis.language.json` — record shapes
- `packages/types/src/entry.ts` — TS contract + place validators (copy these)
- `packages/types/src/bcp47.ts` — BCP 47 syntax validator
- `apps/api/src/firehose/ingest-entry.ts` — exactly what the AppView accepts
- `docker-compose.yml` + `.env.example` — PDS deployment & account-creation gating
