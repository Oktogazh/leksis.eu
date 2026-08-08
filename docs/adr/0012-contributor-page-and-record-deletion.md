# ADR-0012 — The contributor page: reading a foreign lexicon, and real deletion

- **Status:** Accepted
- **Date:** 2026-08-08
- **Deciders:** Alan Kersaudy
- **Extends:** ADR-0005 (`eu.leksis.profile` is client-only and un-indexed) —
  which this relies on and does not change
- **Relates to:** ADR-0002 (browser-only OAuth; the API is never in the auth
  path) and ADR-0004 (the DB stores what the read surfaces need)

## Context

Contributions live on contributors' own PDSs — that is the project's first
promise, printed on the landing page. Until now the app never showed it. A user
could see the dictionary but not *their own* place in it: no page said what they
had published, and nothing let them take it back.

Building that page raised a question the architecture had not yet had to answer.
Every surface so far reads from the AppView, which indexes only what its read
surfaces need. "What has this person published, and when" is emphatically **not**
one of those needs — it is per-contributor, unbounded, and of no use to search or
to any dashboard. Adding a `users` collection to serve it would have put the
platform between a user and their own repository, which is exactly backwards.

Two smaller questions came with it. A profile page wants a picture and a display
name; Leksis has no lexicon for either, while `app.bsky.actor.profile` — sitting
in the same repository — has both. And a page that shows what you published
invites the obvious next question: can I remove it?

## Decision

### 1. The page reads the repository directly; the AppView is not in the path

`/user/<did-or-handle>` is served entirely from the viewed user's own PDS:
`describeRepo` for the collections they have, `listRecords` through each, and
`getRecord` for `eu.leksis.profile`. No new collection, no new indexing, no
ingestion change.

The collections are **discovered by NSID prefix** (`eu.leksis.`), not hardcoded.
The lexicon family is designed to keep growing, and a page listing "everything
you published" must not need editing each time it does.

Consequences that follow from the source rather than being designed in: a record
appears the instant it is written, with no firehose latency, and disappears the
instant it is deleted, whatever the index still believes. The page also works
for an account the AppView has **never seen** — which is what makes it honest
about where the data lives.

Cost: unbounded repositories are paged with a cap (20 pages of 100 per
collection) and the page **says so** when it truncates. A silent cap would let a
half-drawn year of activity pass for a whole one.

### 2. `app.bsky.actor.profile` is read — the first foreign lexicon

The handle comes from `describeRepo`; the display name, bio and avatar from the
`app.bsky.actor.profile` record; the avatar bytes from that repo's **own**
`com.atproto.sync.getBlob`.

This is a use of the protocol, not a dependency on Bluesky: the record is in the
user's repository and their PDS serves the blob, so a user on any PDS gets their
picture and a user with no such record simply has none. Every field is optional
and the UI degrades to an initial. **No Leksis lexicon gained an avatar or a
display name**, and none should — duplicating identity we can already read would
create two answers to one question.

The lexicon question this page was expected to force — extending
`eu.leksis.profile` — **did not need answering**. The existing `languages` field
was already everything the page shows. The one thing that did change is its
character: a field specified as private-ish configuration now has a
reader-facing role. That is a reason to watch it, not to alter it now; a
Leksis-side avatar for PDSs without a Bluesky record, and a bio, are deferred
with the same trigger — someone actually lacking one.

### 3. Deleting a record is a second, distinct act — and it is real

The app already had a way to remove an entry: publish a version carrying
`deleted: true` and a reason (`DeleteEntryDialog`). That is a **statement about
the dictionary** — "this entry should not exist" — it keeps the entry
resolvable, and anyone may make it.

The contributor page adds `com.atproto.repo.applyWrites#delete` against one's
own repo. That is a **statement about oneself** — "I withdraw my contribution" —
only the author can make it, and it is permanent: the record ceases to exist,
the firehose emits a delete, and the AppView drops it (an `entries` version is
removed and the previous promoted back to current; a `languages` version is
archived, which withdraws that language's names *and its whole grammar
declaration* from every reader).

**These two must never be presented as the same thing.** The confirmation names
the difference in its first sentence and then states the consequence **per
collection**, filtered to the kinds actually being deleted — a dialog that said
"this cannot be undone" to both an entry version and a language record would be
technically true and useless. The language bullet is rendered in the danger
colour because it is the only one whose blast radius leaves the author's own
work.

Whole-repo deletion covers every `eu.leksis.*` record **except the profile**,
and requires typing one's handle. Excluding the profile is deliberate: it is
settings, not a contribution, and emptying it as a side effect would drop the
user into onboarding. This is as close to "delete my account" as an AppView on
AT Proto can offer, and the copy says exactly that rather than implying more.

### 4. One endpoint, because one fact cannot be computed client-side

`GET /entries/resolve?uri=…` maps entry-record URIs to entry keys, over the
existing `recordURI` index. An `entryKey` is minted from a hash of the
**creating** record's URI and inherited through the `subject` chain, so a
version's own URI says nothing about it — a client holding records from a PDS
cannot make the link back. Every **version** resolves, not only the current one,
which is the point: a contributor's feed is full of versions others have since
replaced.

The client **never throws** on it: an unresolved row is a row without a link.
That also covers the window where the frontend is newer than the deployed API.

## Consequences

- **The promise is now visible.** "Your words, your server" stops being a
  footer slogan and becomes a page that reads from the server in question and
  lets you empty it.
- **No schema, no migration, no firehose cost.** One endpoint over an existing
  index is the entire backend cost of the feature.
- **The AppView cannot be the arbiter of a contributor's history**, because it
  is not consulted for it. A future need (say, "contributors of language X")
  would be a genuine new read surface and should be decided on its own merits.
- **Deletion is genuinely destructive and reaches production**, since writes
  have never gone through the API. This raises the stakes of the local dev
  proxy now pointing at the production AppView (see `.claude/skills/verify`).
- **Two navigation changes**: the navbar's handle and Log out button became an
  avatar + account menu, and preferences moved from that navbar onto the profile
  page, next to the setting they change.

## Action items

- [ ] **Deploy before the feed's links work.** `GET /entries/resolve` does not
      exist in production yet, so entry and relation rows render unlinked until
      a release is tagged. The degrade is deliberate and silent by design.
- [ ] **Exercise the delete path.** Every surface was driven in a browser except
      the destructive click itself, which was deliberately never fired against
      real records. The `applyWrites` batching, the progress display and the
      partial-failure branch are typechecked and unrun; a single old record is
      the cheap first test.
- [ ] **Exercise the truncation path.** No repository here holds more than 100
      records in a collection, so `truncated` has never been true. A bot repo
      will be the first real test.
- [ ] **Reconsider `eu.leksis.profile`** if contributors on PDSs without an
      `app.bsky.actor.profile` record turn out to want a picture, or if the
      languages-of-interest list starts being read as a public statement rather
      than as a search-bar shortlist.
