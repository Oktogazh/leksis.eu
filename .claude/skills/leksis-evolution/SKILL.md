---
name: leksis-evolution
description: >
  Process guide for ADVANCING the Leksis project (leksis.eu) through its staged roadmap — figuring
  out where it currently stands, executing the next milestone, and keeping every step aligned with the
  white paper's bottom-up vision and recorded in the right place.
  Use this skill whenever the work is about MOVING THE PROJECT FORWARD rather than just recalling facts:
  "what's next", "where are we", "let's start week N", "is this in scope", "should I build X now or later",
  planning a milestone, deciding whether a feature belongs in the prototype, or recording a decision
  (CHANGELOG / ADR / amendment). It pairs with the `leksis` context skill (which holds the static stack,
  data model, lexicon, and schema): load `leksis` for "what is true", load this for "what to do next and how".
---

# Leksis — Evolution & Roadmap Guide

This skill governs **how the project moves forward**. It does not restate the architecture — for stack,
lexicon, ArangoDB schema, and decomposition logic, use the **`leksis` context skill**. Use this one to
orient, choose the next move, stay faithful to the vision, and record what changed.

## The two-skill split

| Question | Skill |
|---|---|
| "What is the entry lexicon? How does decomposition work? What's the schema?" | **`leksis`** (context/reference) |
| "Where are we? What's next? Is this in scope? Where do I record this decision?" | **`leksis-evolution`** (this one) |

When in doubt, load both.

---

## Source-of-truth map

Read these before advising on direction. They are layered — newer layers override older ones on conflict.

| Layer | Document | Role | On conflict |
|---|---|---|---|
| Vision | **White Paper** (`Distributed Dictionary White Paper.md`, in the `Oktogazh.github.io` repo, `src/content/prevez/`) | The *why* and the long-term constellation. Bottom-up philosophy, priority ordering, weighted voting, future apps. | Lowest priority — aspirational, predates build decisions. |
| Design deltas | **Amendments to White Paper.md** (same folder) | Decisions made in design discussions that diverge from the paper. | Overrides the paper. |
| Architecture | **`docs/adr/*.md`** (this repo) | Accepted, dated architecture decisions with consequences. | Overrides paper + amendments on anything they cover (e.g. ADR-0001 killed Fly.io / ArangoDB Cloud). |
| Built state | **`CHANGELOG.md`** + git tags + the code | Ground truth of what actually exists and ships. | Highest priority — this is reality. |

**Rule:** when the paper says one thing and the code/ADR says another, the code/ADR wins. The paper is a
compass, not a spec. Flag the divergence; don't silently follow the stale layer.

---

## Step 1 — Orient (always do this first)

Before proposing any next step, establish where the project actually is:

1. **Read `CHANGELOG.md`** — the top section is the current milestone.
2. **Check git tags** (`git tag`) — last `vX.Y.Z` = last deployed release. **Releases are
   continuous**: the developer tags several times a day, so master == production or hours
   from it. Treat everything committed as released (or about to be); never assume a
   long-lived "implemented but unreleased" state.
3. **Skim the timeline table** (below) to map the current milestone to a week/loop and see what's next.
4. **Check open ADR action items** (`docs/adr/*.md`) for unfinished infra obligations (e.g. backups before week 3).

State the current position in one sentence ("Week N complete, next is Week N+1: <theme>") before doing anything else.

### Development timeline (8 weeks, 10–20h/week, solo dev)

| Week | Theme | Milestone (definition of done) |
|---|---|---|
| 1 | Foundation + CI/CD | Live URL + green pipeline ✅ |
| 2 | AT Proto auth | Log in with a Bluesky account (OAuth, real session) |
| 3 | Loop 1: Languages | Create and browse languages; **firehose consumption starts** |
| 4 | Loop 2: Entries + orthography | Create, edit, delete entries |
| 5 | Loop 3: Definitions | Look up a word and read its definitions |
| 6 | Loop 4: Structure + grammar | Hierarchical definitions + harvested grammatical tags |
| 7 | Loop 5: Translations | Cross-language graph traversal |
| 8 | Search + polish + release | Public collaborator demo |

> Week 3 is the hinge: once the AppView consumes `subscribeRepos`, it must stay online and **real data
> starts accumulating**. ADR-0001 action items #4 (deploy secrets) and #5 (off-box backups) must be done
> *before* week 3, not after.

---

## Step 2 — Anchor to the vision (the scope test)

Every proposed feature must pass the **bottom-up test**. Reject or defer anything that fails it:

- **Atomic-first.** The dictionary entry is the atom. Build the dictionary before corpora, translation
  memory, or usage tools. Order of priority (from the paper): (1) dictionary → (2) monolingual corpora →
  (3) translation tools/memory → (4) usage/learning tools. Never invert this.
- **Structure over scale.** Value comes from dense annotation of few records, not large unstructured data.
  A feature that adds annotation depth beats one that just adds volume.
- **Universal from the start.** Tools must work for *any* language, not be built for one and retrofitted.
  No hardcoded language assumptions.
- **Decentralised & owned.** Contributions live on users' own PDSs; the AppView only indexes pointers.
  Don't move data ownership into the platform.
- **Consensus-ready.** Keep full version history from day one (`current: false` archival, never delete),
  so the weighted voting mechanism has something to act on later.
- **Sustainability is a requirement, not a bonus.** Favour choices that let the project endure and let
  other AppViews build on it (shared lexicons, public CC-licensed records).

If a request is genuinely valuable but premature, route it to **Deferred Decisions** (in the `leksis`
skill) with a "deferred until" trigger rather than building it now.

---

## Step 3 — Advance one loop (the execution template)

Each feature milestone follows this sequence. Do them in order; don't skip the deploy.

```
1. Expand the eu.leksis.entry lexicon schema      (only the slice this loop needs)
2. Update AppView decomposition logic             (apps/api)
3. Update ArangoDB collections/queries            (AQL)
4. Update shared types                            (packages/types)
5. Build the frontend interface                   (apps/web)
6. Tag a release: git tag vX.Y.Z && git push --tags  → GitHub Actions deploys over SSH
7. Test the milestone on the live URL
```

**Principles for the loop:**
- **Deploy on day one, every loop.** A deployed empty shell is a working pipeline. A pipeline that breaks
  in week 6 is a crisis; in week 1 it's a Tuesday. End every loop on the live URL, not localhost.
- **Smallest schema slice.** Only widen the `eu.leksis.entry` lexicon by what the current loop renders.
  The full lexicon (etymology, cognates, dialectal forms, recordings) is aspirational — pull fields in
  loop by loop, not all at once.
- **Types are the contract.** `packages/types` is shared across web/api and mirrors both the ArangoDB
  schema and the AT Proto lexicon. Change it deliberately; it's how a solo dev keeps three surfaces coherent.
- **Last-write-wins, archive-don't-delete.** Until voting exists, any logged-in user can overwrite an
  entry; the prior version is archived (`current: false`). This is what makes voting buildable later.

---

## Step 4 — Record the evolution (close every meaningful change)

A change isn't done when it works — it's done when it's recorded in the right layer. Match the change to
its home:

| What changed | Where it's recorded | Notes |
|---|---|---|
| A feature shipped / a milestone reached | **`CHANGELOG.md`** under the milestone heading | One section per weekly milestone; mirror the existing structure. |
| An architecture/tech choice with trade-offs | **New `docs/adr/NNNN-*.md`** | Status, Date, Deciders, Context, Decision, Consequences, Action Items. Supersede prior ADRs explicitly. |
| A design decision diverging from the white paper | An **amendment** (in the `Oktogazh.github.io` paper folder) and/or an ADR | Keep the paper's amendments file in sync so the public vision doc doesn't drift silently. |
| A change to *what is true now* (stack, schema, lexicon, status line) | Update the **`leksis` context skill** | The context skill must always describe present reality, including its "Status" line. |
| A non-obvious working preference or constraint learned this session | **Memory** (`feedback`/`project` file + `MEMORY.md` pointer) | Only what isn't already captured by the repo or these skills. |

**Bump the status everywhere it lives:** when a milestone completes, update the "Status" line in the
`leksis` skill, the README banner, and the CHANGELOG heading together — they drift apart otherwise.

---

## Beyond the prototype (the constellation)

Once the word-to-word dictionary is live and stable (post-week 8), the roadmap expands outward on the
**same ArangoDB graph + AT Proto backend**. Keep these in view so today's choices don't foreclose them,
but do **not** build them early:

1. **Weighted voting mechanism** — Elo/Rasch-derived, type-specific contributor ratings layered over the
   existing version history. The project's signature contribution; deferred until the prototype is live.
2. **Sentence / monolingual corpora repository** — per-language content to translate into and out of.
3. **Community translation platform** — separate `apps/translate` frontend, shared backend; its
   translation memory feeds example sentences back into the dictionary.
4. **Usage / language-learning tools** — built on the dictionary graph + translation memory.
5. **Expo / React Native** — migrate once the PWA architecture is validated.

Each is a future AppView, not a prototype feature. The discipline of week 8 is to ship the *one solid
atom* (the dictionary) that the rest can grow from.

---

## Guardrails (hard "don'ts")

- **Don't suggest Fly.io or ArangoDB Cloud** — superseded by ADR-0001. Everything is one self-hosted VPS.
- **Don't invert the priority ladder** — dictionary before corpora before translation before usage tools.
- **Don't build the full lexicon or future apps "to save time"** — scope creep is the main failure mode
  for a solo dev on a constellation-sized vision. Defer, with a trigger.
- **Don't delete records or skip version archival** — it destroys the substrate the voting system needs.
- **Don't end a loop on localhost** — a milestone is reached when it's verified on the live URL.
- **Don't let the white paper and the code silently disagree** — record the divergence as an amendment/ADR.
- **Add the new versions to the package files** – the package.json and package-lock.json must be updated to reflect the new versions of dependencies used in the project, then give the new version number as the conclusion of the answers in the chat session, so that they can be added manually after review.
- **Always edit the code in the master branch without creating new worktrees**, so that the codebase can be navigated and reviewed easily without confusion.