# ADR-0015 — The AppView indexes only what the interface could have published

- **Status:** Accepted
- **Date:** 2026-08-14
- **Deciders:** Alan Kersaudy
- **Supersedes, on this point only:** ADR-0006 §5 ("At the AppView both are
  **detection only, never rejection**"), and the same clause where ADR-0007 §3,
  ADR-0008 and ADR-0009 repeat it for their own issue kinds. The reasoning that
  produced it is preserved below and answered, not deleted.
- **Relates to:** ADR-0004 and ADR-0010 (the `labels` read model, whose
  grammar-issues sibling this ADR removes), ADR-0014 (`validateDefinitions`
  strict at ingest — the precedent this generalises), and
  `docs/design/grammatical-tagging.md`, whose referential-integrity section this
  amends.

## Context

The AppView had two settings for a record it did not like. **Malformed shape**
rejected the whole record; **well-formed but incoherent** was indexed, flagged,
and surfaced on the language dashboard as a repair worklist. The second setting
was deliberate, and ADR-0006 gave two reasons for it: rejecting a version would
discard everything else that version carries to punish one row, and an AppView
that refuses a language's grammar has made itself the arbiter of that language's
grammar.

Both reasons were about *vocabulary and content*. Neither survives contact with
what actually arrived.

**A bot published grammar objects the interface cannot operate on.** Not
unreadable — well-formed, indexed, and rendering. But the binding editor
navigates the cascade: its layer-2 root lists the parts of speech and the
combinations a language has *bound*, its values level is reached through a bound
feature name, its layout level through a bound category. So a row hanging off
something unbound has no level that lists it, no control that edits it, and no
button that removes it. The dashboard reported such rows as needing repair and
the editor offered nowhere to repair them. The worst of them was a `bindings` row
holding a single atom — `{NOUN}` bound as a "combination" — which no
(category, feature) pair can ever lead to, so nothing in the interface could
reach it at all.

**And nothing enforced the lexicon's own limits.** `lexicons/eu.leksis.language.json`
declares a `maxLength` on every array in `grammar` (64 parts of speech, 2048
values, 512 abbreviations, …); `eu.leksis.defs.json` caps a tag's `feats` at 32;
the entry lexicon caps `todo` at 64 and `etymology` at 16; the source lexicon
caps `languages` at 64. `isValidGrammar` and `isValidTag` checked none of them,
and ingest checked only the two caps that had been written as constants. So one
bot could publish ten thousand `values` rows: ten thousand list items in the
binding editor, ten thousand docs in the `labels` model, and a dashboard nobody
can load. That is not a record whose grammar is contested — it is not a record of
this lexicon at all.

So the state to avoid is not "a record making a claim we dislike". It is **a
record the interface can neither produce nor repair** — a deadlock, arrived at
through the front door, with the repair worklist pointing at rows no contributor
could reach.

The precedent for the fix was already in the codebase, one lexicon over. An
entry's definition tree is checked whole at ingest by `validateDefinitions`: an
out-of-order place, a leaf without text, an example on a group node, and the
record is refused. Nobody argued that made the AppView the arbiter of anybody's
lexicography, because it does not — it refuses a record that contradicts
*itself*. `grammarIssues` is the language record's exact counterpart and was the
one not wired to that consequence.

## Decision

**The AppView indexes only records the interface could have published. Structure
is validated; vocabulary and assertions are not.**

### 1. An incoherent grammar is refused, not flagged

`ingestLanguage` now rejects a record whose `grammar` produces any
`grammarIssues` — all fourteen kinds, from `unbound-feature` to
`duplicate-abbreviation`. The check sits in `parseRecord`, before any database
access, and names the offending rows in the log: this is a bot's output being
refused row by row, and "invalid record" alone would leave its author nothing to
fix.

Three properties make this safe, and they are what answers ADR-0006's objection:

- **Nothing is lost.** The record stays on its author's PDS and is indexed the
  moment it is fixed. The *previous* version stays current, so the language keeps
  a grammar every editor and every viewer can still work with. Rejecting a
  version is not deleting anything; it is declining to make it current.
- **No vocabulary is judged.** A minted part of speech, a minted feature, a
  minted value on a UD feature, a tag no snapshot of UD documents — all still
  index, and a tag nothing has bound still renders verbatim. The cascade governs
  authoring, never rendering, and that asymmetry is untouched.
- **Refusing is now the *less* interventionist option.** Indexing an incoherent
  grammar handed the interface a record it could not repair. The AppView was
  not staying out of the way; it was propagating a deadlock.

### 2. The lexicon's declared limits are validation, not documentation

Every array cap the lexicons declare is enforced in the shared validators, so the
browser and the AppView refuse the same thing: `GRAMMAR_LIMITS` in
`packages/types/src/grammar.ts` (the sixteen grammar-object caps), `MAX_TAG_FEATS`
in `tag.ts` (which binds every site a tag appears at, an entry as much as a
language record), `MAX_ENTRY_ETYMOLOGY` and `MAX_ENTRY_TODO`, and
`MAX_SOURCE_LANGUAGES` inside the existing `validateSource`.

`etymology` was not validated at all — a record could carry numbers where
paragraphs belong and be indexed. It is now checked like `notes`.

**String length caps are deliberately not enforced** (`maxLength` /
`maxGraphemes` on the twenty capped text fields). A definition one grapheme over
its cap renders, wraps and edits perfectly well; refusing the record would lose a
contribution to make a point about counting. Array caps are different in kind:
they multiply interface rows and database documents. Deferred with a trigger —
see the table in the `leksis` skill.

### 3. The two gates are one gate, so the browser blocks what ingest would drop

The binding editor's publish guard used to block only the defects an edit
*introduced* (`grammarDiff`), precisely so that an already-incoherent record
stayed editable. With nothing incoherent indexed, the record the editor loads is
coherent to begin with, "introduced" and "present" coincide, and the diff has
nothing left to say — it is retired, along with `grammarIssueKey`, which existed
only to compare two versions' issues.

The guard is now `grammarIssues(draft)`: **any** defect blocks publishing. This is
not a stricter rule than before for any record the AppView accepted; it is the
same rule, stated where the contributor can act on it. Leaving the old guard in
place would have been the real regression — the browser would happily publish a
version the AppView then dropped in silence, so the contributor's edit would
appear to succeed and simply never arrive.

The per-kind copy that explained each defect on the dashboard moves into the
editor (`grammar.issue.*`) and is rendered one line per defect in its footer,
beside the blocked Publish button. The defects are now shown where the rows they
name live.

### 4. One new control, for the one row nothing could reach

A `bindings` row of fewer than two atoms gets a remove button on the layer-2
root — the only place in the editor that can remove one, because every other
level reaches a combination through a (category, feature) pair and a lone atom
has none. Deliberately narrow: a well-formed combination is still removed where
it was declared.

This matters because of something the rkey scheme makes unavoidable. **A language
record's rkey is its tag, so a refused rewrite still replaces the content behind
the pointer the AppView serves.** The index keeps the coherent version's `cid`,
but `com.atproto.repo.getRecord` is addressed by rkey, so the browser reads
whatever is there now. A contributor can therefore still be handed an incoherent
draft, and every defect must have a repair path in the editor. Every other kind
already had one — bind the missing atom, bind the missing feature name, declare
the inherence that grounds the combination, or remove the row at the level that
lists it. This was the exception.

### 5. What stays lenient, and why it is not the same thing

Three leniencies are untouched, and conflating them with incoherence would be the
easy mistake to make here:

- **An unbound tag renders.** Verbatim, styled unbound. A viewer that refused it
  would make the AppView the arbiter of a language's grammar — the objection
  ADR-0006 raised, which is correct about *rendering* and always was.
- **An unrecognised relation `kind` is indexed and never traversed.** `kind` is
  `knownValues`, not `enum`: the lexicon deliberately admits values a future
  version of Leksis, or another AppView, will define. Refusing them would mean
  this AppView refusing its own future records. Forward compatibility is not
  incoherence.
- **A source version that changes `languages[0]` is flagged, never rejected**
  (ADR-0014). It is a *contested assertion* between two versions, not a
  self-contradiction inside one, and nothing about the record becomes
  unreachable: the source editor still edits everything else, and the work stays
  citable. Rejecting it would make the first version ever indexed unappealable,
  which is the opposite of the Wikipedia model.

The line: **a record that contradicts itself is refused; a record that
contradicts somebody else is indexed and contested.**

## Consequences

- **The grammar repair worklist is gone** — the stored `grammarIssues` field on
  the language doc, the dashboard payload's `grammarIssues`, the field on
  `LanguageDashboardResponse`, the card on `LanguagePage` and the
  `languagePage.grammarIssue*` copy. Under the new rule the current version of
  every language is coherent by construction, so the card could only ever have
  rendered empty. The **labels worklist stays**: a tag some entry uses that no
  declaration has named is a gap *between* records, not a defect inside one, and
  no gate can close it.
- **A pre-rule version may still be current in an index built before this
  shipped**, and it can no longer publish a repair through the browser without
  fixing every defect at once. This is a transient concern by design: ADR-0013
  already noted that the production database is to be replaced wholesale under a
  new name, and until then the editor lists exactly what to fix.
- **Bots must now produce coherent grammar objects.** This is the intended cost
  and the reason for the change: "index loudly but don't block" existed so that
  imperfect bots could load external dictionaries and be refined by hand later,
  which is right for *content* — an unnamed tag, a thin definition, a missing
  translation — and wrong for a language's grammar, where one bad row reaches
  every entry in the language and the hand-refinement it counted on was
  impossible.
- **The API cost was negative.** One AQL projection shrank, one collection field
  disappeared, no endpoint was added, and the coherence check runs before the
  first database round trip — so a refused record now costs *less* than an
  accepted one used to.
- **`grammarDiff` and `grammarIssueKey` are gone from `packages/types`.** Do not
  reintroduce the diff without re-opening the question of what an indexed
  incoherent record would be *for*.
- **A refused record is silent to readers.** Nothing surfaces it: no worklist, no
  badge, no dashboard counter. It is logged server-side with its offending rows,
  and it is visible to its author in the editor the next time they open it. A
  reader-facing "somebody published something we refused" notice would be
  reporting a stranger's mistake to the wrong person.
- **Every gate is shared code.** `grammarIssues`, `isValidGrammar`, `isValidTag`
  and `validateSource` all live in `packages/types` and run in both the browser
  and the consumer, which is what makes "the interface could have published it"
  checkable rather than aspirational.

## Action items

- [x] `grammarIssues` enforced at ingest, with the offending rows named in the log.
- [x] Lexicon array caps enforced in the shared validators (grammar, tag, entry,
      source); `etymology` validated.
- [x] Publish guard switched to all defects; per-kind copy moved into the editor.
- [x] Remove control for a one-atom `bindings` row.
- [x] Grammar repair worklist removed end to end.
- [x] Verified with `apps/api/src/scripts/verify-ingest-gate.ts` against a local
      ArangoDB — 19 checks, including that a refused version leaves the previous
      one current and that minted vocabulary still indexes.
- [ ] **Publish the lexicons.** `scripts/publish-lexicons.mjs` has not been run
      since `grammar.layout` shipped, and the `grammar` description now states
      this rule. Pre-existing debt, not created here.
- [ ] Drive the binding editor in a browser once the session wall is solved: the
      blocked-publish footer and the new remove control have never been rendered
      for a human (see the `verify` skill's §"The session wall").
