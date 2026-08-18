# ADR-0018 — A language is deletable, like everything else

- **Status:** Accepted
- **Date:** 2026-08-18
- **Deciders:** Alan Kersaudy
- **Supersedes:** ADR-0003 §6 on record deletion ("deleting a record archives the
  matching current version"), and with it the Loop-2 asymmetry between how the
  index treats a deleted `entries` version and a deleted `languages` one.
- **Relates to:** ADR-0012 §3 (deleting a record is a statement about oneself —
  its language bullet described the old behaviour), ADR-0004 / ADR-0010 (the
  `labels` read model, which a deleted language must stop declaring into).

## Context

Loop 2 (2026-07-15) settled record deletion with a rule that reads well —
**the index mirrors the network** — and one exception to it. An `entries`
version whose record is deleted is *removed*, and the most recently indexed
survivor is promoted back to current. A `languages` version was *archived*,
on the grounds that **language references are structural to the app**.

The exception was aimed at a real risk and missed it, because it was written
against a design that was not the one built.

**Entries do not reference a language record.** They carry `languageID`, a
lowercase BCP 47 **tag** — a string, not a document key and not a record URI.
Nothing in `entries`, `relations`, `cognates`, `sources` or `paradigms` resolves
through a `languages` doc. So a language whose record is gone leaves no dangling
reference to protect: the tag still means what it always meant, its entries stay
indexed and searchable, and the surfaces that need a *record* already had a
no-record path — `getLanguageDashboard` returns null for an unknown tag and
`LanguagePage` has had a `not-found` state since loop 2.

What the exception did cost was paid three ways, and the third is the one that
makes this a correction rather than a preference.

**A withdrawn language stayed listed for every reader, forever.** `localLanguages`
is what `GET /languages` serves — the language list, the search scope picker, the
translation target selector. Its own module said so in as many words: *"Deleted
languages stay listed (removal deferred to voting)."* The names on offer there
came from a record that no longer existed and that nobody stood behind.

**Its labels stayed declared by a record that was gone.** `ingestLanguageDelete`
called neither `syncLocalLanguages` nor `syncLanguageLabels` — it touched the
`languages` collection and stopped. Since ADR-0010 a `labels` row is keyed on the
tag and carries both a declaration and its usage, so a row left behind by a
deleted grammar is indistinguishable from a live one. That is not a stale cache;
it is the model asserting something false.

**And archive-and-stop was not a conservative version of removal — it was a third
state neither surface agreed on.** With no promotion, deleting the current
version left the tag with *no* current version while archived ones sat beside it.
`getCurrentLanguageRecord` returned null, the dashboard returned null, the page
said not-found — while the language list went on showing the deleted version's
names. Two read surfaces, two answers, and the disagreement grew out of the rule
rather than out of a bug in it.

## Decision

**Apply the `entries` rule to languages.** Deleting a record removes what the
network no longer holds; being *superseded* still archives.

### 1. `ingestLanguageDelete` becomes `ingestEntryDelete`'s shape

Remove every version doc of the deleted record. If none was current, stop — an
archived version's deletion is invisible to every read surface. If one was,
promote the most recently indexed survivor to current and re-sync the derived
models **from that version's content**. When nothing survives, the language goes:
off `localLanguages`, and its declared labels out of `labels`.

Note this is deliberately *not* what a **source** does (ADR-0014), which archives
and re-promotes rather than removing, and flags `recordDeleted` so a later
deletion cannot resurrect a version whose record is gone. A source is cited **by
number, by strangers**, so leaving the number without a current version degrades
other people's entries. A language is not resolved that way by anything, so the
simpler rule — a removed doc cannot be promoted — buys the same safety for free.

### 2. `translations` is cached on the version doc, and that is what makes this possible

Promotion needs the promoted version's content, and the consumer is a sequential
writer, not an HTTP client: it cannot resolve a record from a PDS to find out what
that version called the language. `labels` and `inherent` are already cached on
the doc for exactly this reason; `translations` joins them.

It is dead weight until somebody withdraws a record — every other route to
becoming current arrives *with* the record that made it so — and it is the whole
reason a promotion can restore the older version's names instead of blanking the
language to its bare tag. The field name is not new: docs written before the
languages/localLanguages split carry one of the same name and shape, which is
what `db:init` has always rebuilt the read model from.

### 3. `removeLocalLanguage` — and the language's own locale doc is not special

The counterpart to `syncLocalLanguages`: strip the language's row from every
locale doc, then remove any doc left with no rows.

`localLanguages/br` holds the names of every language **in Breton**, and those
rows come from other people's records. Withdrawing the Breton language record
says nothing about them, so only the row naming Breton itself goes and the doc
survives with the rest. Deleting a doc that empties follows what the derived
collections already do — the model is rebuildable, so an empty doc is noise
rather than history, and the next record naming that locale recreates it seeded.

### 4. Declared labels go; usage rows stay, unnamed

`syncLanguageLabels(tag, [])` is the existing "this language declares nothing"
call, so removal needed no new code path. A row an entry still **uses** keeps its
tag and loses only its name — which is this model's ordinary worklist state (a
tag in use that nothing has named), not damage. The language is gone; its words
are not.

## Consequences

- **Deletion of a language record is now genuinely destructive, and the
  confirmation says so.** `deleteRecords.consequenceLanguage` gained the outcome
  it was missing: another author's version takes over, or the language itself
  leaves Leksis and its words are left in a language nothing names.
- **Reinstating a *deleted* language stops being a voting question** — there is
  nothing left to reinstate. Reinstating a **superseded** version still is one,
  and is untouched: archival on overwrite is exactly as it was.
- **A language can now vanish from the list while its entries stay indexed.**
  That is the honest state rather than a defect — the words exist, their records
  exist, and nobody currently names the language they are in. They stay
  searchable by tag; the scope picker no longer offers the language, because the
  picker is built from `localLanguages`.
- **`localLanguages` loses its "removal deferred to voting" exemption**, which
  was the last place that clause survived.
- **No migration, and one degrade.** Version docs indexed before this change
  carry no `translations`; promoting one falls back to the bare tag until its
  author republishes — the same treatment `ingestEntryDelete` gives a version
  predating its own caches. Pre-1.0 that is a bot rerunning its import.
- **`db:init`'s backfill quietly became a rebuild.** Its filter
  (`translations != null`) was written to catch pre-split docs and now matches the
  whole collection. It still upserts rather than reconciling, so it does not sweep
  a stale row — unlike the `labels` rebuild, which truncates first. Writing the
  wholesale builder that would let it do the same is left until a drifted read
  model is actually observed.

## Action items

1. ~~Ingest, read model and copy~~ — done. Verified against the local ArangoDB by
   a harness driving the real ingest functions over two authors and two versions:
   18/18, covering the archived-version, promotion and last-version branches, the
   labels hand-off, and the entries left behind.
2. **Drive it in the browser as the feature's testset slice** — publish a
   throwaway fixture language, delete its record from the contributor page, and
   watch it leave the language list. The destructive click has never been fired
   against a real record (ADR-0012's action item, still open); this is the
   cheapest occasion to fire it.
3. **Decide whether "entries in a language nothing names" deserves its own
   surface state.** Today `/language/<tag>` says not-found while its words remain
   searchable, which is accurate but says less than it knows. Trigger: it happens
   to a language somebody cares about.
