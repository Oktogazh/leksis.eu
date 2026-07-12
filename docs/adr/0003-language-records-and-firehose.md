# ADR-0003 — Language records, the Wikipedia edit model, and Jetstream

**Status:** Accepted
**Date:** 2026-07-11
**Deciders:** Alan Kersaudy (with Claude as analysis support)
**Supersedes:** the open questions in `docs/design/language-selection.md` (Q1–Q7)

## Context

Week 3 (Loop 1: Languages) needs a language selector in the search bar. The
design note `docs/design/language-selection.md` captured the requirements and
proposed shipping a bundled, read-only ISO 639-3 snapshot as the selectable
universe. Working through the open questions produced a different answer: no
bundled registry at all. This ADR records the decisions and their consequences.

## Decisions

### 1. A dedicated `eu.leksis.language` lexicon

The documented plan was a single lexicon (`eu.leksis.entry`) with languages
find-or-created as a side effect of entry decomposition. That cannot give
languages human-readable, translatable names before entries exist, so the
prototype now has **one small lexicon per concern**, starting with
`eu.leksis.language` (`lexicons/eu.leksis.language.json`):

```
{ tag, translations: [{ languageID, translation }], createdAt }
```

- `tag` — well-formed IETF BCP 47 tag, normalized lowercase (`br`, `br-gw`).
- `translations` — the language's name in other languages. The **endonym is
  required**: an item whose `languageID` equals `tag`. So the very first
  language record is human-readable even when no other language exists to
  translate it, and the list grows more multilingual as languages are added.
- The record key (rkey) is the tag itself, so a user rewriting the same
  language produces an update of their own record, not a second one.

### 2. The language list lives only in ArangoDB

There is **no bundled reference universe** (no ISO 639-3 snapshot in the
frontend). The selector offers exactly the languages that exist as records,
fetched from `GET /api/languages`. The list starts empty; the first user
creates the first language. This supersedes the design note's Phase-1
"bundled registry" proposal (its R1 universality is preserved: *any*
well-formed tag can be created, nothing is hardcoded).

### 3. Edit model: records prove authorship, not ownership

Like Wikipedia, **nobody owns content**. Any user may publish an
`eu.leksis.language` record for any tag to their own PDS. The AppView applies
**last-write-wins with archival, regardless of author**: the latest record
for a tag becomes the current version; the previous version is marked
`current: false` and kept forever (never deleted). Archived versions are the
substrate for the future weighted-voting mechanism, which will regulate
overwrites; until then the model is plain last-write-wins.

Phase-1 UI consequence: the frontend only offers *creation* and advises
against already-taken tags (checked against the fetched list). This check is
advisory — a PDS accepts any record — and the AppView's LWW policy is the
real arbiter. An *editing* UI (prefill an existing language, add
translations) is deferred.

### 4. Tag validation: syntax only

Tags are validated for BCP 47 **well-formedness only** (shared validator in
`packages/types/src/bcp47.ts`, used by both the web form and the AppView
ingestion — with one tightening: 4–8-letter primary subtags, RFC-reserved and
unregistered, are rejected because they only occur when someone types a
language *name*). No registry lookup: no words attach to a wrong language at
creation time, and a later record can overwrite the mistake, so typos are
cheap. Invalid records coming off the firehose are logged and skipped, never
indexed.

### 5. Firehose transport: Jetstream

The AppView consumes **Jetstream** (`wss://jetstream2.us-east.bsky.network/subscribe`,
overridable via `JETSTREAM_URL`) with `wantedCollections=eu.leksis.language`,
instead of raw `com.atproto.sync.subscribeRepos`. Rationale: server-side
collection filtering makes the bandwidth negligible for one VPS and the
payload plain JSON, versus receiving and CBOR-decoding the entire network
firehose to keep a handful of events. Trade-offs accepted for the prototype:
Jetstream is Bluesky-operated infrastructure, and its events are not
cryptographically verified. An outage means indexing lag, not data loss —
records live on PDSs and the consumer resumes from a cursor persisted in the
`firehoseState` collection (replay overlap is harmless because ingestion is
idempotent on `recordURI + cid`).

The consumer runs inside the existing api process (no new container; the
compose file is untouched); a consumer failure never takes down HTTP, and
reconnection uses capped exponential backoff.

### 6. Versioned `languages` collection

The Week-1 shape `{ _key: IETFTag, name, createdAt }` is replaced by
versioned documents (auto `_key`, many docs per tag):

```
{ tag, translations, recordURI, cid, authorDID, createdAt, indexedAt, current }
```

with a persistent index on `["tag", "current"]`. `GET /api/languages`
returns only `current: true` docs. Deleting a record archives the matching
current version; reinstating an older version is deferred to the voting
mechanism.

### 7. Shortlist in localStorage

The selector surfaces previously-used languages first (R6/R7), stored in
`localStorage` — the smallest Loop-1 slice. Moving it to the user's PDS
(portable across devices, no generic cross-app preference store exists in AT
Proto today, so it would be another record type) is deferred; trigger:
multi-device use actually reported.

## Consequences

- The frontend writes records straight to the user's PDS (per ADR-0002) and
  learns about them again only via the AppView; the UI bridges that latency with an optimistic insert plus polling.
- Anyone can overwrite any language's name/translations until voting ships —
  accepted, identical in spirit to the entry model ("last write wins,
  archive don't delete").
- The `leksis` skill's "single lexicon" statement is superseded: lexicons are
  added loop by loop (`eu.leksis.entry` arrives with Week 4).
- Localized display names in the *interface* locale (R2) are carried by the
  data model already (pick the translation matching the UI locale, fall back
  to endonym, then tag); wiring that rendering is deferred until a second UI
  locale ships.

## Action items

1. [x] Lexicon, types, validator, consumer, endpoint, selector, creation modal
   (this change).
2. Widen `wantedCollections` and add entry decomposition in Week 4.
3. Revisit delete-reinstatement and edit UI with the voting mechanism.
