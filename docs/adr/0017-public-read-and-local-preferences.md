# ADR-0017 — The dictionary is public; the rate limit is what pays for it

- **Status:** Accepted
- **Date:** 2026-08-17
- **Deciders:** Alan Kersaudy
- **Relates to:** ADR-0002 (browser-only OAuth — the reason the AppView cannot
  tell a logged-in caller from a stranger), ADR-0005 (`eu.leksis.profile` as
  client-side configuration — the shape this ADR mirrors into localStorage), and
  ADR-0012 (the contributor page, already public-read and until now unreachable
  while logged out).

## Context

Everything except the landing page sat behind a login. `App.tsx` rendered the
landing page for a disconnected visitor and, worse, **rewrote any resource URL
they arrived on to `/`** — so a link to an entry, a language or a cited work
landed a stranger on a login form, having silently discarded what they clicked.

Three things were wrong with that, in increasing order of seriousness.

**It asked for the account before giving the reason to want one.** The answer to
"what is Leksis?" was a password prompt. A dictionary explains itself in about
four seconds if you can look a word up in it, and not at all otherwise.

**It made the project uncitable.** A reference work that cannot be linked to is
not a reference work. Every fixture URL, every entry a contributor wanted to show
somebody, every citation in a paper — all of them 404-in-effect for anyone
without an AT Protocol account. The white paper's whole argument for a
lexicographic commons assumes the commons can be read.

**And it was not even buying security.** Nothing about the login gated the data:
`GET /entries` was already unauthenticated and already public, because ADR-0002
puts the API outside the auth path entirely. The wall was in the SPA. Anyone who
wanted the index could curl it; only readers were stopped.

The reason not to open it was real, though, and it is the one this ADR has to
answer: **one VPS, one ArangoDB, and `/translate` is a bounded graph traversal
that a crawler could point at all day.**

## Decision

**Open every read surface to visitors without accounts, and pay for it with a
per-IP rate limit on the three search endpoints.**

### 1. The limit is per IP, in memory, in the API process

`SEARCH_RATE_LIMIT_MS` is **5 seconds**, shared between `GET /entries`,
`GET /sources` and `GET /translate` — **one bucket, not one per route**, because
they are three ways of asking one question and a per-route limit would hand a
caller three times the allowance for alternating between them.

A `Map<ip, timestamp>` in the Hono process, swept on a timer. Not Redis, not a
token bucket, not a rate-limiting dependency: there is one process on one host,
so a map in that process *is* the coordination problem. The costs are stated
rather than discovered — state is lost on restart (a deploy briefly forgives
everyone, which is harmless) and it does not survive a second instance (there is
none; the day there is, this moves to a shared store and the middleware's shape
does not change).

**Two details are load-bearing and both are easy to get wrong.**

The address is the **rightmost** `X-Forwarded-For` entry, not the conventional
leftmost. Caddy *appends* the connecting peer to whatever the client sent, so the
last element is the only one Caddy wrote and the only one a client cannot forge.
Reading the leftmost would let any caller mint a fresh identity per request by
sending its own header — a rate limiter that rate-limits nobody. Nothing but
Caddy can reach the API process, so there is exactly one hop to trust.

And the timestamp is written **before** the handler, not after. The window is
between the *arrivals* of two searches; stamping on the way out would start the
clock when the slowest query finished, buying a heavy traversal a longer
allowance than a cheap one — precisely backwards.

### 2. It applies to everybody, and that is forced rather than chosen

ADR-0002 put the API outside the auth path: authentication is browser-only
OAuth, writes go browser → the author's own PDS, and the AppView never sees a
session. **So there is no "logged-in" for it to exempt.** A 5-second window is
what makes that acceptable — no human reading a dictionary meets it — and the
one client that legitimately polls (a contributor waiting for their own record to
be indexed) now paces itself against the shared constant instead of being
throttled by it.

The browser absorbs **one** refusal: it waits exactly as long as the server said
and retries once. Throughput is unchanged — the retry cannot produce a second
answer inside the window, only move this one to the far side of it — but someone
who hits Back and re-runs a search sees a pause instead of an error. A *second*
refusal surfaces, because a UI that retried forever looks broken rather than busy.

### 3. Keyed reads are not limited

Only the corpus-wide queries carry the limiter. `/entries/:key`,
`/languages/:tag/*`, `/sources/:oclc/currentRecord` and the rest are addressed by
a key the caller had to learn first, which makes them a read of one known thing
rather than a question asked of the whole index — and an entry page issues five
of them. A reader opening a word must not spend their search on it.

### 4. Contribution affordances stay visible and ask, rather than disappearing

The alternative was hiding every editing control from logged-out readers. It is
less code and a worse product: **the affordances are the explanation.** A reader
who never sees that a definition can be improved, a language named, or a book
described has been shown a read-only website rather than a project they could
join.

So they render, and raise a prompt carrying **the reason they were asked for** —
"proposing a change publishes your version alongside the existing one; nothing is
overwritten and nothing is lost" is a better description of this project's model
than any paragraph on a landing page, and it arrives at the moment somebody
wanted to act.

The line: **discovery affordances ask; account-scoped and repair controls stay
hidden.** Your profile, log out, delete your records are meaningless without an
account rather than an invitation to get one; a parked relation awaiting
re-anchoring is addressed to somebody already contributing and explains nothing
to a passer-by.

This also fixed a live defect. "Propose changes" was gated by *nothing* — the
one affordance on the entry page nobody had wrapped in `did !== null` — so
opening the dictionary to logged-out readers would have handed them an editor
that could not publish.

### 5. Preferences live in localStorage, in the profile record's own shape

A reader with no PDS still wants their languages of interest first in the search
bar and their theme remembered. `leksis.prefs` holds a **`LeksisProfileRecord`** —
the same object `eu.leksis.profile` carries.

That is the whole trick, not a convenience: `SessionProvider` serves it under the
same `profile` field it serves the PDS record under, so the search bar's
shortlist, the preferences dialog and the language dashboard were not touched,
and signing up **promotes** an existing object rather than translating between
two shapes that would then need keeping in step. Onboarding seeds itself from it,
so nobody is asked the same question twice.

**The line this must not cross: preferences only, never contributions.** An entry
written to localStorage would be a contribution the network never sees, owned by
a browser profile rather than by its author — the exact inversion of this
project's premise. Anything a reader writes *about the dictionary* requires a
PDS; localStorage is for what they say about *their own view of it*.

Logging out does **not** clear it. The person logging out is the same reader on
the same browser, reading the same languages.

### 6. A dark theme, and the honesty its arrival forced

The token system had been built for this since v0.8 and it worked: one
`[data-theme="dark"]` block, one registry entry, no component changes. First
visit follows `prefers-color-scheme`; an explicit choice wins forever after,
because it was *stated* where the system preference is inferred.

Shipping it exposed two things a single-theme app could hide.

**`darkMode` was unset**, so Tailwind's `dark:` variants keyed off the operating
system while the palette keyed off `data-theme`. A reader on a light OS choosing
dark got dark surfaces with light-theme overrides painted on them. Now
`darkMode: ["selector", '[data-theme="dark"]']` — one authority for one question.

**~100 hardcoded palette colours** (`text-red-600` for every error string,
`text-amber-700 dark:text-amber-400` for every warning) never followed the theme
and failed AA on dark surfaces. Swept to `text-danger` and a new
`--color-warning` token. The light theme's `--color-content-subtle` was darkened
too: at `#a1a1a1` it sat at **2.5:1** on the canvas, and every use of it is text
a reader has to read.

## Consequences

- **The AppView is now a public read surface in fact as well as in shape.** Links
  work for strangers. That is the point, and it is also the new exposure: the
  rate limit is the only thing standing between the search endpoints and a
  crawler, so it is now load-bearing infrastructure rather than a nicety.
- **The limit is per address, so shared addresses share it** — a university NAT,
  a mobile carrier CGNAT, a classroom. At 5 seconds this is tolerable and the
  message says what happened ("searches from your network are arriving faster
  than the dictionary answers them") rather than blaming the reader. If real
  users hit it, the answer is a burst allowance, not a bigger window.
- **A restart forgives everyone**, and a second API instance would halve the
  effective limit per client. Both are acceptable at one host and both are
  reasons this moves to a shared store before horizontal scaling, not after.
- **`--anon` exists in the dev session.** The scripted login logged in on every
  load, so the half of the product this ADR creates was the one half a dev build
  could not see. `?anon=1` opts out, stickily.
- **Two obligations this ADR does not discharge.** The lexicons still have not
  been republished (`scripts/publish-lexicons.mjs`, owed since `grammar.layout`
  and now `eu.leksis.paradigm` too), and `leksis-testset` §7's authoring-flow
  debt (U-01…U-24) is untouched — though its opening claim that "App.tsx sends a
  logged-out visitor to `/`" is now false and has been corrected in the skill.

## Action items

1. ~~Rate-limit the search endpoints~~ — done, verified against the local API:
   shared bucket, spoof-resistant keying, 5s decay, `Retry-After`.
2. ~~Open the read surfaces, gate the writes~~ — done, driven in the browser
   against the published fixture set.
3. ~~localStorage preferences and the dark theme~~ — done.
4. **Watch for shared-address complaints.** The fix is a small burst allowance
   (say 3 searches then 1/5s), not a longer window — a reader who searches three
   times in ten seconds is reading, not crawling.
5. **The mobile reading header is still tall.** Three stacked form controls sit
   above the headword at 375px. Reading mode dropped the kind tabs and the
   translation target; the scope selector and term box could share a row.
