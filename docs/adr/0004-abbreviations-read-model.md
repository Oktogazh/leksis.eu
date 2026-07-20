# 0004 — Abbreviations read model: the DB serves read surfaces beyond search

- **Status:** Accepted
- **Date:** 2026-07-19
- **Deciders:** Alan (with Claude)

## Context

Loop 2 established the record-centric doctrine: records on users' PDSs hold
the content, and the `entries` collection stores *only what search needs*.
The language dashboards milestone needs per-language aggregates the records
alone cannot serve efficiently: which annotation pairs (grammatical
categories + definition notes) a language uses, how many entries use each,
which pairs conflict, which entries await review, and how lively editing is.

Harvesting pairs at ingest requires knowing the *previous* current version's
pairs when a version is superseded, deleted, or promoted — information the
reference-only entry docs did not carry, and which re-fetching records from
PDSs at ingest time would make slow and network-dependent.

## Decision

1. **Entry version docs additionally store their distinct annotation pairs**
   (`abbreviations: [{short|null, long}]`). The doctrine widens from "the DB
   stores what search needs" to **"the DB stores what the AppView's read
   surfaces need"** — still never the content itself (definition texts stay
   on the records).
2. A derived **`abbreviations` collection** holds one doc per distinct
   (language, short, long) pair used by current entry versions:
   `{languageID, short|null, long, entries: [entryKey…], conflictsWith:
   [_key…]}`. The count is the length of `entries`, which points back to the
   entries for maintenance. Two same-language docs conflict when they share
   a short with different longs, or a long with different shorts; a pair
   without a short form never conflicts. The firehose consumer maintains the
   model on every version transition, deletion and promotion
   (`apps/api/src/firehose/abbreviations.ts`); `db:init` rebuilds it
   wholesale. Like `localLanguages`, the model is disposable and
   rebuildable — docs whose last entry leaves are deleted; this deletion is
   sanctioned because no version history lives there (`entries` archival is
   untouched).
3. **The API never exposes the per-pair entry lists** — only pair, count and
   conflicts (`GET /languages/:tag/abbreviations`) — so the dictionary
   cannot be enumerated through its abbreviation list. Consequence: the
   browser cannot bulk-rewrite a conflicted pair's entries (it cannot list
   them, and ADR-0002 keeps the API out of the write path), so **in-dashboard
   bulk rewrite is deferred**; bots bulk-fix their own imports by listing
   their own repos (leksis-ingest skill).

## Consequences

- Dashboards and editor suggestions are answered entirely from the DB — no
  PDS fetches in the ingest or read paths.
- Entry docs indexed before this ADR carry no pairs and contribute nothing
  until re-published; the bots-only reset-and-republish workflow covers the
  migration (no destructive DB migration is run).
- Every new read surface must justify itself against this ADR's widened rule
  rather than silently growing the entry doc.

## Action items

1. ~~`abbreviations` collection + consumer maintenance + `db:init` rebuild~~ (done)
2. ~~`GET /languages/:tag/abbreviations` + `GET /languages/:tag/dashboard`~~ (done)
3. Revisit conflicted-only exposure of entry lists if in-dashboard bulk
   rewrite proves needed.
