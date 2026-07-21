# 0005 — User profile: a client-only, un-indexed lexicon

- **Status:** Accepted
- **Date:** 2026-07-20
- **Deciders:** Alan (with Claude)

## Context

Two pieces of per-user state lived in `localStorage`: the UI interface
language (`leksis.lang`) and the language "shortlist" surfaced in the search
bar. Both were explicitly deferred to "move onto the user's PDS" (the
`leksis` skill's Deferred Decisions: *shortlist → multi-device use reported*;
localised UI language implied by the i18n model). Onboarding — the first-run
flow that gathers interface language and languages of interest — needs a
durable home for these choices, and the natural home in this architecture is
a record on the user's own PDS.

Every prior lexicon (`eu.leksis.language`, `eu.leksis.entry`) is **dictionary
content**: authored by anyone for any subject, indexed by the AppView from
Jetstream under last-write-wins, and archived-never-deleted so the future
voting mechanism has a substrate. A user's own preferences are none of those
things — they are private-ish configuration, owned by exactly one user, of no
interest to any other user or to search, dashboards, or voting.

## Decision

1. Add a `eu.leksis.profile` lexicon: `{ interfaceLanguage, languages[],
   createdAt }`, singleton record key `literal:self` (the AT Proto convention
   for per-repo config records, as `app.bsky.actor.profile` uses).
2. **The AppView does not index it.** `eu.leksis.profile` is *not* added to
   the Jetstream `wantedCollections` filter; there is no ArangoDB collection,
   no ingestion path, and no API endpoint for it. This is a deliberate
   divergence from the "every lexicon is indexed" pattern of Loops 1–2, and
   from ADR-0004's "the DB stores what the read surfaces need" — no read
   surface needs one user's preferences.
3. The **browser reads and writes it directly** on the user's own PDS through
   their authenticated agent: `getRecord`/`putRecord` on rkey `self`
   (`apps/web/src/lib/profile.ts`). A missing record (`RecordNotFound`) is the
   onboarding signal. `SessionProvider` loads it after a session restores,
   applies the interface language, and exposes `profile` + `saveProfile`.
4. The profile's `languages` list **replaces `localStorage` as the source of
   truth** for the search-bar shortlist (the old `lib/shortlist.ts` is
   removed). `localStorage` remains only as the pre-login / anonymous UI-language
   fallback in the i18n bootstrap.

## Consequences

- **Cheapest correct design:** no firehose bandwidth, no schema, no migration.
  The record is per-user config, so keeping it off the content pipeline is
  both simpler and more correct.
- **Reversible without data loss:** because the record already lives on PDSs,
  a future need (e.g. a "contributors of language X" view) can add
  `eu.leksis.profile` to `wantedCollections` and backfill from the network —
  the source of truth is unchanged. This ADR forecloses nothing.
- **Not archived, not voted on:** last-write-wins on `self` is a plain
  overwrite of one's own record; the archive-forever content rule (and the
  reviewer guardrail against destructive change) does **not** apply to
  `eu.leksis.profile`. It is the third sanctioned non-archived record type,
  alongside the derived `localLanguages` and `abbreviations` read models —
  here because it is private config, not because it is rebuildable.
- **Onboarding gate:** a connected user with no profile is shown the
  onboarding flow inside HomePage until the record is written; a transient PDS
  read failure degrades to the same flow rather than wedging on a blank
  screen, at the accepted cost (bots-only, pre-users) of possibly re-writing
  an existing profile.
