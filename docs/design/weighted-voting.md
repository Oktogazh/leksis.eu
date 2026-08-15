# Design note: the weighted voting mechanism

**Status:** **Draft — arbitrated, not yet built.** The structural decisions in §§2–3 were settled in
the 2026-08-07 design session; the numeric parameters in §6 carry concrete v1 values, to be revised
against the shadow ledger (slice 1) before they become binding at slice 4. Nothing here is code yet.
**Date:** 2026-08-07.
**For:** The post-prototype "signature contribution" — replacing last-write-wins with rating-ordered
consensus over the version history that every loop since Loop 1 has been accumulating for exactly
this purpose.
**Related:** the white paper (weighted voting sections), ADR-0003 (versioned indexing — the
substrate), ADR-0011 / `docs/design/semantic-network.md` (style precedent; `relations` as the third
upgradable collection), the `leksis-evolution` skill ("Consensus-ready" scope test).

> **How to read this.** §0 is binding on every session that touches voting. §1 is the prior art the
> design leans on, verified as stated. §2 is the model; §3 the update rules; §4 the attack scenarios
> the configuration was arbitrated against — a change that re-opens one of them is wrong even if it
> works. §5 is the build slices (one programming session each); §6 the open parameters; §7 the open
> questions. Decisions are referred to **by name**, in bold, so references survive edits.

---

## 0. Governing rules

**Rating is the ability to make linguistic consensus.** A record's rating quantifies how broad a
consensus that version commands; a contributor's rating quantifies their demonstrated ability to
produce and to recognise such consensus. Every rule below must stay explainable as a proxy for one
question: *"if the whole community assessed this challenge between two competing records, which record version would make consensus?"* A mechanism that
cannot be narrated in one sentence to a contributor fails the project's explainability principle,
whatever its game-theoretic elegance.

**The flip confers nothing.** Becoming the current version is a display consequence of ratings, never
a rating event. A publisher's rating changes only through *other people's* votes resolving a
challenge — never through publishing, and never through any event the publisher can cause alone.
This single rule is what makes self-pumping (§4.2) structurally impossible rather than merely
expensive.

**Every ballot is a user-authored record.** Votes are `eu.leksis.vote` records on the voter's own
PDS, exactly as entries, languages and relations are. The AppView indexes them; it never mints them,
and deleting the record from the PDS retracts the vote (§7.2).

**The ledger is the truth; ratings are a derived read model.** Every rating — contributor and
record — must be recomputable from scratch by a deterministic fold over the ordered event log
(version records + vote records, in `indexedAt` order). No rating is ever stored that the fold
cannot reproduce. This is what lets the algorithm's parameters — or the algorithm itself — change
later: rebuild the ledger under the new rules, exactly as `db:init` rebuilds `labels` and the
semantic network today. **Recomputability is a hard requirement, not a nice-to-have.**

**Ratings are per language.** A contributor holds one rating per (DID, language); it is earned and
spent only on that language's records. Consensus about Breton belongs to the people the Breton
community has assessed. A relation record touches both of its sides' languages (§7.3).

**Archive-don't-delete is the substrate.** Nothing in this mechanism deletes a version; it only
reorders which one is current. The sanctioned removals (entry versions deleted from their author's
PDS) are unchanged.

---

## 1. Prior art, and what is taken from it

**Elo** (chess). Asynchronous pairwise updates — no full comparison matrix ever assumed, which is
why it fits a firehose-fed AppView where information arrives one vote at a time. Standard form:
expected score `E = 1 / (1 + 10^((R_b − R_a)/400))`, update `ΔR = K·(S − E)`. In FIDE chess K is
10–40 depending on experience and a 400-point gap means ~91% expected score. **Taken:** the logistic
expectation, the K-scaled update, the asynchrony. **Not taken:** zero-sum symmetry between the two
parties of every game (see the saturating record update, §3.2 — deliberately not zero-sum).

**Rasch / IRT.** Same logistic core (base e), but its estimation assumes the full person×item
response matrix — the Cartesian-product assumption this design explicitly avoids. **Taken:** the
framing that a vote is a *probe* of a latent ability. **Not taken:** batch estimation; everything
here updates online.

**Wikipedia.** The current pre-voting model (any account overwrites, history archived) is
Wikipedia's; this mechanism is what Wikipedia never built — a quantified, per-community weight on
the revert war. The lesson taken from it: protection must never make the platform the arbiter of
content (here: ratings order versions, humans author them).

Numeric conventions in this note use the chess presentation (base 10, scale 400) for familiarity;
whether the implementation uses base e (Rasch-style) is a pure change of units (§6).

---

## 2. The model

### 2.1 Upgradable documents and the ladder

Six collections are **upgradable**: `languages` (shared key `tag`), `entries` (`entryKey`),
`relations` (`relationKey`), `cognates` (`cognateKey`, added by ADR-0013), `sources` (shared key
`oclc`, added by `docs/design/sources-and-examples.md` — versioned like `languages`, rkey = the OCLC
number, so all authors' records for one work share a ladder by construction) and `paradigms`
(shared key `paradigmKey`, added by `docs/design/paradigm-rules.md` — rkey derived from
(language, selector), so all authors' rules for one category share a ladder exactly as sources do;
a paradigm's blast radius is a whole language's inflection tables, so §7.6's language-record
question covers paradigms identically). All versions sharing a
key form that object's **ladder** — ordered by record rating, highest first.

A source ladder has one wrinkle of its own: `languages[0]` (the main language) is immutable by
design — the editor refuses to change it and ingest flags a version that does. A flagged version
still enters the ladder (the AppView is never the arbiter), so a `mainLanguageConflict` version is
exactly the kind of challenger the community should vote down; no special voting rule is needed.

A cognate is versioned exactly as a relation is (symmetric record, `subject` chain, archived
predecessors), and it **spans two languages the same way** — so it is governed by the same
resolution as §7's open question 3, not by a rule of its own.

- The top of the ladder is the **current** version (`current: true`).
- The second-from-top is the **challenger** (`current: false, challenger: true`) — the one version
  the reader interface offers for comparison and voting.
- Everything below is visible only in the full version history. A low-rated version does not need to
  be suppressed by any threshold feature: its rating *is* its burial.

One persistent index per collection: `[key, rating desc]` (exact shape at slice 2).

### 2.2 Ratings

- **Contributor rating** `R(did, lang)`: one number per DID per language, created at the **floor**
  `R_floor` on first rated action in that language (§3.5 for how vouching lifts it).
- **Record rating** `R(version)`: one number per version doc, set at publication (§3.1), moved only
  by votes (§3.2). A version keeps its rating when superseded — the ladder position is the rating.

Both live in a derived **`ratings` ledger** (read model), rebuilt wholesale by `db:init` from the
event log per §0. The version docs additionally cache their current rating for the ladder index,
exactly as `entries` caches `tags` — cache, never source.

### 2.3 The vote record — `eu.leksis.vote`

One vote is one record on the voter's PDS (shape to be finalised at slice 1; the semantics are
fixed):

```typescript
{
  subject: string      // at:// URI of the version VOTED FOR
  against?: string     // at:// URI of the version voted against — the current
                       //   counterpart at vote time; recorded so the ledger fold
                       //   is deterministic even after later re-orderings
  createdAt: string
}
```

- Voting **for** a challenger is voting **against** the current version, and vice versa — one
  record, two rating effects (§3.2). There is no standalone downvote.
- **One live vote per (DID, ladder)**: a newer vote record by the same DID on the same ladder
  supersedes the older one (the fold uses the latest; the interface should encourage deleting the
  old record). Never for a version you authored; never for a ladder where the vote's `subject` and
  `against` share your DID on both ends (§7.4 for account clusters).
- A vote by a DID with no rating in the record's language creates that rating at the floor — a vote
  is a rated action.

### 2.4 What the reader sees

The entry/language/relation page shows the current version as today, plus a **challenger affordance**
when one exists: open a side-by-side comparison, and cast one vote for either side. Voting weight and
consequences (§3) are shown before confirming — explainability is a UI requirement, not only an
algorithmic one: the confirmation must display *this vote moves X's rating by ~n and stakes your own
rating on the outcome*.

---

## 3. Update rules

Throughout: `E(a over b) = 1 / (1 + 10^((R_b − R_a)/400))`, the expected score of `a` against `b`.

### 3.1 Initial rating of a version — **a handicap that is deep for creation, light for challenge**

> A version starts below its author's current rating in that language — and never at or above the
> version it challenges. **How far below depends on which act it is.**

- Brand-new object (no ladder): `R(version) = R(author, lang) − ε_new`.
- Challenger of an incumbent `I`: `R(version) = min(R(author, lang), R(I)) − ε`.

A handicap applies in *both* cases (2026-08-07 revision): no record ever starts at its author's own
level, so a fresh record always leaves a foothold for critique from below — starting a record at the
author's full rating would gift it a height it has not yet earned by consensus, in a system where
accepted records only rise.

**Two handicaps, because the two acts are not symmetric** (2026-08-07, second revision). `ε_new` is
a **full league** — 400 points, against `ε`'s 24 — and the asymmetry is the design's statement about
lexicography itself: **critique is easier than creation, and creation is where mistakes are made.**
A brand-new record is an unreviewed assertion by one person; a challenger is an assertion *plus* a
concrete comparison the community can already judge against something. So a creation lands one
league under its author, inside reach of voters an entire league below them (the gradient of §3.2
read in the other direction: at 400 points, a critic's vote is ~0.18 of a peer's, not the ~0.02 of
two leagues — audible, not decisive), while a challenge lands `ε` under the incumbent, where one
peer-level confirming vote closes the gap.

Three consequences worth stating plainly, because they are the point rather than side effects:

1. **Nobody's first draft outranks the community.** An author at 1800 creating a new entry starts it
   at 1400 — near the working range's floor, not its ceiling. The rating a record ends up with is
   earned from votes, and the author's standing only sets where the earning begins.
2. **A newcomer's creation starts near `R_min`-adjacent territory** (`R_0` − `ε_new` = 600 at v1
   values). This is intended: an unknown speaker's first entry in a new language is *accepted and
   published* (§3.5 — publishing stays fully open), it simply starts low on its own ladder and
   climbs on consensus like everything else. It is not suppressed; a lone entry on an uncontested
   ladder is still the current version.
3. **The creation handicap is not a challenge handicap.** `ε_new` never applies to a challenger,
   even when the challenger's author is far above the incumbent — otherwise improving an existing
   record would be systematically harder than replacing the object wholesale, which would push
   contributors toward duplicate creation and directly damage the ladder model.

One rule, two behaviours the design needs: a high-rated contributor's fix starts at `R(I) − ε` —
one light confirming vote flips it, so trusted corrections are fast but **never unreviewed** — while
a low-rated account's challenge starts at its own low rating, possibly deep under the existing
ladder, buried below even the challenger slot with no extra threshold machinery. This supersedes
both earlier candidate designs (the author-chosen `x`, and the equal-rating start): the author-chosen
stake was dropped because once the flip confers nothing (§0) it bought only unreviewed currency —
all vandalism surface, no incentive benefit — and the equal start was dropped because it gave spam
challengers a free seat at the top of the ladder.

**There is no auto-accept path.** Currency flips the moment the challenger's rating exceeds the
incumbent's (§3.3), which requires at least one vote by someone other than the author.

### 3.2 Record updates on a vote — **the saturating update**

A vote is a game between the *voter* and each of the two versions:

```
R(subject) += K · (1 − E(subject over voter))     // always > 0: an upvote always raises
R(against) −= K · (1 − E(voter over against))     // always < 0: symmetric decrement
```

This keeps the session's founding intuition — an equal-rated voter moves the record by ~K/2, a
higher-rated voter by more, a lower-rated one by less — but in the exact Elo expected-score form
rather than an ad-hoc multiple/fraction, because the exact form is what defeats ossification
(§4.5): as a record climbs above its supporters, `E(subject over voter) → 1` and the increment
vanishes. **A record's rating saturates at the level of the voters who sustain it** and can never
run away above the active population, so a comparable challenger always has a reachable target and
there is no theoretical limit to the number of editions an object can undergo. Upvotes remain
strictly positive per the system's definition; they are simply not constant.

The voter's own rating does **not** move at vote time — it moves at resolution (§3.4).

#### The negation gradient — how far apart is "negated"

"At what rating gap is an actor's contribution negated?" has no threshold in this system — negation
is a **gradient that falls out of the update formula**, `Δ = K / (1 + 10^(D/400))` for a voter `D`
points below the record, and the 400-scale gives it clean league arithmetic:

| Gap below the record | Vote weight (× an equal-rated vote) | Voters needed to match one peer |
|---|---|---|
| 0 | 1 (= K/2) | 1 |
| 200 | ~0.48 | ~2 |
| **400** | ~0.18 | ~5.5 |
| 600 | ~0.06 | ~16 |
| **800** | ~0.02 | ~50 |

**One league = 400 points** (an outsider needs ~5–6 heads to match one peer); **two leagues =
800 points = effectively negated** (~50:1), because the vote weight times K eventually rounds to zero. No cutoff is enforced anywhere — which keeps the
explanation honest: *"your vote counts on everything, proportionally less on content the community
has rated far above you."* The same gradient governs every other weighted quantity (settlements,
the challenger handicap's reachability), so these two league marks are the system's whole intuition.

### 3.3 The flip

Whenever a vote (or a settlement) leaves a non-current version with the ladder's highest rating,
currency flips: old current archived in place (`current: false`), new current promoted, challenger
flag recomputed to the new second-highest. Flips are ordinary, repeatable and reversible — a ladder
may flip back. Every flip is a **resolution event** (§3.4). Downstream read models
(`localLanguages`, the semantic network's re-anchoring) already key on currency transitions and are
untouched by *why* currency changed — this is the seam ADR-0003/0011 left for this mechanism.

### 3.4 Settlement at resolution — publishers and voters

At each flip on a ladder, with `W` the newly current version and `L` the version it displaced:

**Publishers** (the Elo table from the session brief, in exact form; `R_W`, `R_L` are the versions'
ratings at flip time):

```
R(author(W), lang) += K · (1 − E(author(W) over W))    // unexpected win pays more
R(author(L), lang) −= K · (1 − E(L over author(L)))    // unexpected loss costs more
```

A contributor rated above the newly accepted record gains little (victory expected) and loses much
when displaced (defeat unexpected); one rated below it gains much and loses little — the brief's
2×2 table, produced by the logistic instead of a table. Same-author `W` and `L` (self-supersession)
settles nothing — the flip confers nothing, and this is the base case that closes the alt-account
laundering route at the settlement layer too (§4.3). **Natural deflation lives here:** an inactive
early contributor's old records get displaced one by one, and each displacement debits them. No
inactivity clock is needed, and none is added.

**Voters** — **a vote is a prediction, settled symmetrically**. Every unsettled vote on this ladder
cast since the previous flip is settled once: votes whose `subject` is `W` scored `S = 1`, votes
whose `subject` is `L` scored `S = 0`, each against the version they backed:

```
R(voter, lang) += K_v · (S − E(voter's side over the other side))   // at vote time, cached in the ledger
```

Backing an underdog that wins pays well; backing it and losing costs little; backing the favourite
is near-neutral either way — which is precisely "ability to recognise consensus" made into a score,
and the lever that makes downvote-bombing and sybil voting self-destructive (§4.1, §4.4). A vote is
settled **at most once** (marked in the ledger); if the ladder later flips back, only votes cast
after the previous flip settle then. Voter settlement is zero-sum-*shaped* (gains mirror losses
through the same expectation), which is the deflationary counterweight to the strictly-positive
record upvotes.

### 3.5 Bootstrap — **fair start, emergent leagues, vouching as accelerator**

(2026-08-07 revision: the earlier "deep floor + vouching as the only ladder up" bootstrap was
replaced — a punitive floor fails the low-resource premise that the system must genuinely accept
newcomers' contributions.)

- New (DID, language) ratings start at **`R_0` = 1000** — a fair start with real weight *among
  peers*. What protects established content is not a floor but the **emergent league gap**:
  community-sustained records saturate at their sustaining voters' level (§3.2), which sits 1–2
  leagues above `R_0` once a community is active, so newcomers' votes on them are proportionally
  light per the negation gradient — no rule enforces this; it is the working range self-organising
  above the entry point.
- **`R_min` = 100** is a hard floor so settlements can never drive a rating negative; an account
  driven near it is where the reserved minimum-rating-to-publish idea (§7.5) would bite.
- **Vouching** survives in reduced form — an *accelerator*, not a gate: an established contributor
  may stake a bounded slice of their own rating to lift a newcomer toward the community range faster
  than settlement alone would (shape: an `eu.leksis.vouch` record or a field on the vote lexicon —
  slice 4). The stake rides on the newcomer's next settlements: the voucher gains/loses a fraction
  of what the newcomer gains/loses until the stake amortises. A real account's rating on the line is
  the one thing a sybil ring cannot manufacture.
- Publishing brand-new objects stays fully open at `R_0` (the dictionary must accept a first entry
  in a new language from an unknown speaker — the low-resource premise); the containment for what
  that opens is §4.1's honest accounting.

---

## 4. Attack scenarios — the arbitration record

Each configuration decision above was chosen against these. **A future change that re-opens one of
these scenarios is wrong even if it works.** Parameter constraints named here bind §6.

### 4.1 The sybil ring

*N fresh accounts publish records and upvote each other.* Honest accounting under the fair start
(§3.5): ten fresh accounts at `R_0` carry real collective weight (~10·K/2 ≈ 160 points) **against
peer-level content** — that is the price of genuinely accepting newcomers, paid knowingly. What
contains the ring: **established content sits 1–2 emergent leagues above `R_0`** (a ten-bot ring
moves a record 600 points up by ~10 points total — the negation gradient, needing ~50 bots per
peer-vote at two leagues); **vote-as-prediction** settles the ring's votes as losses when real
voters flip their versions back, bleeding the ring below `R_0` where it entered; and the ring's
mutual settlements among themselves are zero-sum-shaped, so the ring as a whole cannot mint rating
from internal games. What remains exposed is *new, unwatched* content: the ring can top its own
fresh spam ladders — but the creation handicap (§3.1) means those records enter at `R_0 − ε_new`
(600 at v1 values), **a full league below newcomer height and roughly two below the working range**,
so they sit at the bottom of every rating-ordered surface and any single real contributor's
challenge outranks them on arrival. The authors gain nothing from the flips (the flip confers
nothing), and the first real community attention triggers the settlement bleed. Constraint carried to §6: the working range must in
practice clear `R_0` by ≥400 points for this containment to hold — the drift telemetry of slice 1
watches exactly this.

### 4.2 The self-pump

*Publish trivial rewrites and profit from their acceptance.* Structurally dead: publishing moves no
rating, the flip confers nothing, self-votes are forbidden, and self-supersession settles nothing.
The only way a rewrite pays its author is other people voting it past the incumbent — which is the
system working as intended.

### 4.3 The sleeper vandal

*Earn rating honestly (or steal an account), then mass-replace current versions.* No auto-accept
path exists, so every replacement needs one independent vote — damage is capped at the speed the
vandal can find accomplices, not at machine speed. Each successful vandal flip that the community
reverts then settles as a loss *against the vandal* at their full rating (defeat of a high-rated
author's record is the expensive quadrant of the 2×2 table), so a spree is self-liquidating in
O(rating/K) reverted flips. Constraint: `ε` must be small enough that honest high-rated fixes need
only one light vote, but the real guard is the vote requirement, not `ε`.

### 4.4 The downvote bomb

*Suppress a rival's records by mass down-voting.* A downvote is only the `against` half of a vote
*for* the other ladder member, so bombing requires backing a concrete alternative — and
vote-as-prediction stakes the bomber's rating on that alternative actually winning the community
over. Floor-rated bombers barely dent an established record (saturating update, symmetric side);
established bombers bleed rating every time the community flips the ladder back. There is no
cost-free negative action anywhere in the system.

### 4.5 Ossification / rating inflation

*Record ratings only rise, so old records drift above every possible challenger and editing halts.*
Dissolved by the saturating update (§3.2): a record cannot rise meaningfully above the rating level
of the voters who actually sustain it, so the reachable-target property is invariant over time. The
complementary drift — contributor inflation — is checked by voter settlement being zero-sum-shaped
and publisher settlement debiting every displaced author. No global renormalisation pass is needed;
if ledger telemetry (slice 1) ever shows drift anyway, the recomputability rule (§0) is the escape
hatch: change the parameters and rebuild.

### 4.6 The vote-then-retract

*Vote, wait for settlement, delete the vote record if it lost.* Deletion retracts the vote in the
fold — but settlement already happened in wall-clock history. Rule: **a settled vote's settlement
survives its retraction in the live ledger; a full rebuild replays deletions honestly** (a deleted
vote never existed for the fold). The divergence is deliberate and bounded: live behaviour must not
let retraction undo a loss, while the rebuild path stays a pure function of the surviving log. If
this bound proves exploitable in practice, the fix is retention of vote tombstones, priced at
slice 1 (§7.2).

---

## 5. Build slices — one programming session each

Sliced so every slice leaves master deployable and observable on its own, and **the mechanism runs
in shadow long before it governs currency**.

1. **The ledger, in shadow.** `eu.leksis.vote` lexicon + ingest + the `ratings` read model + the
   deterministic fold + `db:init` rebuild. Votes are indexed and ratings computed, but **currency is
   still last-write-wins** — the ledger is observable (an internal endpoint / dashboard card) and
   tunable against real behaviour with zero user-facing risk. Includes the parameter table (§6) as
   code-level constants with a single home.
2. **Ladders.** The per-collection rating index, `challenger` flag maintenance, initial-rating rule
   at ingest, and the flip logic — still shadow (a shadow-currency field beside the real one, so
   divergence between LWW and rating-order is *measured* before it is *switched*).
3. **The reader surface.** Challenger affordance, side-by-side comparison, the vote dialog with its
   explainability requirements (§2.4). Users vote for real; currency still LWW.
4. **The switch + settlement.** Flip governs `current`; publisher and voter settlement live;
   vouching. The LWW rule retires for upgradable documents. This is the slice that needs the
   testset extended (fixture ladders per the `leksis-testset` coverage rule) before it ships.
5. **Trust surfaces.** Per-language rating display on profiles/dashboards, ladder history view,
   recompute tooling and drift telemetry, and the deferred-decision reviews of §7.

Each slice closes with the usual recording step (CHANGELOG; slice 4 is ADR-worthy: it changes the
edit model that every prior ADR assumes).

## 6. Parameters — v1 values, tuned in shadow

Resolved 2026-08-07 to concrete v1 values; the shadow ledger (slice 1) exists to revise them against
real behaviour before slice 4 makes them binding, and recomputability (§0) makes any revision a
rebuild, never a migration.

| Parameter | v1 value | Role | Constraint it satisfies |
|---|---|---|---|
| scale | base 10, divisor 400 | the coordinate system | chess units → the league arithmetic of §3.2's gradient table |
| `R_0` | 1000 | newcomer start, per language | fair start; leaves headroom above (working range) and below (decline) |
| `R_min` | 100 | hard floor | settlements can never go negative |
| `K` | 32 | record-update step | equal-rated vote moves a record ±16 |
| `ε` | 24 | **challenger** handicap | must be `< K` so ONE equal-rated confirming vote (±16 each side = 32-point swing) flips an ε-gap challenge |
| `ε_new` | 400 | **creation** handicap | one full league, so critique from a league below is audible (~0.18 of a peer vote) rather than negated; `ε_new ≫ ε` is the asymmetry between creating and challenging (§3.1) |
| `K_v` | 8 | voter-settlement step | ¼ of `K` — voting matters, publishing matters more |
| vouch stake bounds + amortisation | open (slice 4) | bootstrap accelerator | stake loss must exceed any gain a sybil chain can return |

Standing invariants over any retuning: `ε < K` (one peer vote closes a challenge gap);
`ε_new ≈ one league ≫ ε` (creation is reviewable from below, challenge is confirmable from beside);
`R_0 − ε_new > R_min` (a newcomer's creation must not start at the floor — at v1 values, 600 > 100);
and the observed working range must clear `R_0` by ≥400 points (§4.1) — if telemetry shows it does
not, raise `K` or lower `R_0`, then rebuild.

## 7. Deliberately open questions

1. **The name.** "Ladder" vs "thread" vs another term — settle before slice 1 mints field names.
2. **Vote retraction semantics** (§4.6): accept the live/rebuild divergence, or keep tombstones.
3. **Relations span two languages** — settle on which rating votes/settlements touch (both halves at
   half weight is the current lean; decide at slice 2 when the ladder index forces it). **This now
   covers cognates too** (ADR-0013): they are two-language objects of the same shape, so whatever is
   settled here applies to both, and the question must not be answered for one alone.
4. **Account clusters** — "never for yourself" is per-DID; whether/how to widen it (vouch-graph
   proximity? nothing?) is open, noting §4.1/§4.2 already remove most of the profit.
5. **Minimum rating to publish** — held in reserve; trigger: burial-by-rating proves insufficient
   against spam on *new* objects.
6. **Language records' special weight** — a language record's blast radius (its whole grammar) may
   warrant a larger `ε` or more votes; decide when slice 2 meets real language-record ladders.
