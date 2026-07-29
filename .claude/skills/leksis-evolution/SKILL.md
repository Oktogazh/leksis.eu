---
name: leksis-evolution
description: >
  Process guide for ADVANCING the Leksis project (leksis.eu) through its staged roadmap — figuring
  out where it currently stands, executing the next milestone, and keeping every step aligned with the
  white paper's bottom-up vision and recorded in the right place.
  Use this skill whenever the work is about MOVING THE PROJECT FORWARD rather than just recalling facts:
  "what's next", "where are we", "let's start week N", "is this in scope", "should I build X now or later",
  planning a milestone, deciding whether a feature belongs in the prototype, or recording a decision
  (CHANGELOG / ADR / amendment). Also holds the north star for the **morphology arc** — grammatical
  tagging (UPOS/FEATS/UniMorph) and language-level inflection paradigms — so load it before designing
  anything involving categories, annotations, inflected forms or tagsets.
  It pairs with the `leksis` context skill (which holds the static stack,
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
| 2 | AT Proto auth | Log in with a Bluesky account (OAuth, real session) ✅ |
| 3 | Loop 1: Languages | Create and browse languages; **firehose consumption starts** ✅ |
| 4 | Loop 2: Entries + orthography | Create, edit, delete entries ✅ |
| 5 | Loop 3: Definitions | Look up a word and read its definitions ✅ |
| 6 | Loop 4: Structure + grammar | Hierarchical definitions + harvested grammatical tags — ✅ (tree-shaped definitions + abbreviations read model shipped v0.8; other forms, per-node notes, references added) |
| 7 | Loop 5: Translations | Cross-language graph traversal |
| 8 | Search + polish + release | Public collaborator demo |

> Confirm the actual current position from `CHANGELOG.md` + `git tag` at orient time (step 1) —
> these ✅ marks are a convenience, not the source of truth. As of v0.8 the prototype is past
> Loop 4's core; Loop 5 (translations) is the next unbuilt loop.

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

> If the proposal touches grammatical categories, annotations, inflected forms or tagging, read
> **The morphology arc** below *before* judging it — that section holds the invariants it must not break.

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

## The morphology arc — north star for the coming loops

*Recorded 2026-07-29 as alignment context, not as a plan. Detailed planning is deliberately deferred to
the top of each rung. This section exists so that (a) every loop between now and then picks shapes this
arc can grow into, and (b) no session invents tagset details nobody has actually verified.*

### Where it ends up

Opening an entry **hydrates it with language-level grammatical knowledge** and renders the word's full
morphology as a table (declension, conjugation, mutation set…):

- the **entry** declares what kind of word it is — its part of speech and its *inherent* features;
- the **language** declares, once, the **paradigms**: the inflection table that applies to each kind of
  word, and the Hunspell-like rules that generate each cell from the lemma;
- the entry adds **only what cannot be derived** — irregular forms, plus the *diagnostic* form that
  **selects** the paradigm (a Latin genitive picks the declension group; the system fills the rest);
- a perfectly regular lemma carries **nothing**: the table is generated in the frontend;
- with no paradigm defined for that language, it degrades to today's behaviour — `otherForms` shown as a
  flat list above the definitions, never a fake table.

Paradigm = the language-level object. Irregular/diagnostic forms = the entry-level override. Generation =
from language-level rules, not stored data.

### Why it is in scope

It passes the scope test hard: it is the purest form of **structure over scale** — the annotation depth
that stands in for the corpus a low-resource language does not have — and it feeds the white paper's
promised outputs (Hunspell dictionaries, spell/grammar checking, NLP substrate). It is **universal from
the start** *only if* designed for languages with no published tagset at all; see the note on treebanks
below.

The risk is equally clear: a general morphology engine is a research project. So the arc advances in
**thin rungs, each shippable and useful alone**, and it never displaces loops 5–8.

### Invariants any design must satisfy

These are the alignment guarantees. A plan that breaks one is wrong even if it works.

1. **Three annotation altitudes, kept apart.** UD/UniMorph separate what Leksis currently mixes:
   - *lexeme-level* — part of speech + **inherent** features (gender, animacy, noun class, Slavic aspect)
     → the entry's `categories`;
   - *form-level* — **inflectional** features (case, number, tense, person, mood) → they belong to a
     **form**, never to the entry as a whole (`otherForms`, later paradigm cells);
   - *sense-level* — features that vary by sense (a verb's transitivity across its I./II. groups) → the
     definition **group node**, which already exists for exactly this.

   `categories` is lexeme-level and must stay so: "plural" is not a category, it is a form's feature.
2. **Tags are machine data; labels are homolingual display.** The entry lexicon's homolingual rule (every
   piece of text in an entry is written in the entry's own language) holds. A UD tag is not reader-facing
   text — it is an identifier. So the tag rides on the record while the **language record carries the
   binding `tag → {long, short}` in that language**. Never render a raw tag; never store an English label
   inside an entry.
3. **Free annotation never disappears.** Most labels a real dictionary uses (`bot.`, `arch.`, `fam.`,
   register, dialect) have no UD/UniMorph equivalent. Tagging is an **optional machine layer bound to**
   the existing `{long, short}` pair, not a replacement for it. An entry in a language whose tagset nobody
   has declared yet must stay fully editable.
4. **Four different things live at annotation sites — don't let them collapse into one.**
   (a) a taggable grammatical feature; (b) an untaggable editorial/domain/register label — stays a free
   pair; (c) a free prose remark — `plainNotes`; (d) a **collocation or example phrase** (a word shown
   beside other words), which is *content*, not annotation, and needs its own field rather than being
   smuggled into notes. Getting this separation right is the point of the whole exercise — the project's
   bet is that structure substitutes for corpus size, and a mislabelled note is structure lost.
5. **Paradigm edits never touch entry records.** Fixing a language's rule must re-render every entry in
   that language without republishing anything on anyone's PDS. Therefore entries store *selectors and
   exceptions*, never generated forms.
6. **One generator, shared.** The rule engine serves the web viewer now and exporters later (Hunspell
   `.aff`/`.dic`, UniMorph TSV) → it belongs in a shared package (`packages/types`, or a new
   `packages/morphology`), never inside a React component.
7. **Records prove authorship, not ownership** — paradigms are records like any other: last-write-wins,
   archived, contestable, votable later. A paradigm's blast radius is an entire language, which makes
   version history *more* important here, not less.

### Open questions — do not answer these by guessing

- **Its own lexicon?** `eu.leksis.paradigm` vs. fields on `eu.leksis.language`. Deciders: AT Proto record
  size (a full Finnish/Basque paradigm set is not small — check the actual PDS record limit), authorship
  granularity (one contributor per paradigm vs. per language), and the blast radius of a rewrite.
- **Search vs. generation.** Inflected spellings are searchable today *because* `otherForms` carries them
  into the `search` index. Generated forms are not in the record → **regular words would silently lose
  inflected-form search**. Resolve deliberately: run the generator at ingest to expand the index,
  normalise queries, or accept the gap.
- **Binding vs. harvest.** The `abbreviations` read model (ADR-0004) *derives* pairs from entries; a tag
  binding would be *authored* on the language record. Decide how they coexist (likely: authored binding +
  derived free pairs, both surfaced on the language dashboard).
- **XPOS at all?** Whether Leksis needs a language-specific POS layer, or whether UPOS + FEATS + free
  pairs cover it.
- **Which schema wins where.** UD and UniMorph overlap and disagree; choose per layer and record it in an
  ADR rather than drifting between them.

### Known unknowns: UD and UniMorph

**The developer has not studied Universal Dependencies or UniMorph yet, and no session may paper over
that.** Rules for any session touching this arc:

- **Never invent tag names, feature names or values.** Anything written into a lexicon, a type or the UI
  must be traceable to a published inventory. If you cannot cite it, you do not know it.
- **Verify at the source — do not trust the table below, and do not trust model recall.** Tagset details
  are exactly the kind of thing an LLM reproduces confidently and wrongly. Fetch the pages.
- **Design each rung so it does not depend on the parts not yet understood.** Bind the container
  generically (a tag + the scheme it comes from + its homolingual label pair) so a later layer slots in
  without a new mechanism.
- **An explicit list of "I don't know yet" is a valid deliverable** for a rung's plan, and better than a
  confident wrong vocabulary baked into records living on other people's PDSs. Lexicon shape mistakes are
  not local: records already published elsewhere cannot be migrated by us.

**Orientation only — verify every cell before relying on it:**

| Thing | What it is (unverified summary) | Where it fits |
|---|---|---|
| **UPOS** (UD) | ~17 closed, universal part-of-speech tags (NOUN, VERB, ADJ, ADV, ADP, AUX, CCONJ, SCONJ, DET, NUM, PART, PRON, PROPN, INTJ, PUNCT, SYM, X) | The most stable, least contested rung. Lexeme-level; maps to the first item of today's `categories`. |
| **FEATS** (UD) | `Feature=Value` pairs (`Case=Gen\|Number=Sing`), a universal inventory plus documented language-specific extensions | Splits lexeme-inherent from form-inflectional features; supplies the paradigm's cell coordinates. |
| **XPOS** (UD) | Free, unstandardised language-specific POS string | Possibly unnecessary — see open questions. |
| **UniMorph** | Paradigm-oriented schema: `lemma ⇥ form ⇥ features` (`V;IND;PRS;1;SG`), full inflection tables per lemma; v4 ships a UD↔UniMorph feature mapping | Closer to what a *paradigm* is than UD, which annotates tokens in running text rather than lexemes. |
| **Hunspell** `.aff`/`.dic` | Affix rules + per-word flags selecting them | The generation model already in mind; also a concrete export target. |
| **Apertium `lttoolbox`** monodix | `<pardef>` paradigms declared once, entries pointing at a paradigm | Near-exact prior art for "paradigm at language level, selector on the entry". |
| **Wikidata Lexemes** | Lexeme / Form / Sense split with grammatical features | Prior art for the entry/form/sense layering at scale. |

Canonical sources to fetch: `universaldependencies.org/u/pos/`, `universaldependencies.org/u/feat/`,
`universaldependencies.org/format.html`, the per-language pages under `universaldependencies.org/treebanks/`
(language-specific features), `unimorph.github.io`, `wiki.apertium.org/wiki/Monodix_basics`,
`man 5 hunspell`.

> **Design for the language that has nothing.** A low-resource language usually has **no UD treebank**, so
> no documented language-specific feature set exists for it at all. That is not a gap in Leksis — it is
> Leksis's job: the language record becomes the place where that language's tagset is *declared*. Never
> design a flow that assumes a published tagset already exists for the language.

### The ladder (indicative order, not a commitment)

Each rung must ship and be useful on its own. A rung may be interleaved with loops 5–8; none may replace
one. Plan a rung at its top, not now.

1. **UPOS binding** — the language record declares `tag → {long, short}` in its own language; an entry's
   category can carry the tag. Editor suggests from the binding, viewer displays the homolingual label.
2. **Inherent FEATS** — lexeme-level features (gender, animacy, noun class) bound the same way.
3. **Form-level FEATS** — `otherForms` carry feature bundles alongside (or instead of) a free label,
   without breaking inflected-form search.
4. **Paradigm definition** — the language-level paradigm object, its cells addressed by feature bundles,
   plus the selector/diagnostic form on the entry.
5. **Generation** — Hunspell-like rules fill regular cells client-side; entries carry only exceptions;
   the flat list becomes a table.
6. **Export** — Hunspell dictionaries and UniMorph TSV out of the graph: the annotation *becomes* the NLP
   resource the white paper promises.

---

## Beyond the prototype (the constellation)

Where the morphology arc grows the atom **deeper**, the constellation grows **outward**. Once the
word-to-word dictionary is live and stable (post-week 8), the roadmap expands on the **same ArangoDB graph
+ AT Proto backend**. Keep these in view so today's choices don't foreclose them, but do **not** build
them early:

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

- **Don't invert the priority ladder** — dictionary before corpora before translation before usage tools.
- **Don't build the full lexicon or future apps "to save time"** — scope creep is the main failure mode
  for a solo dev on a constellation-sized vision. Defer, with a trigger.
- **Don't delete records or skip version archival** — it destroys the substrate the voting system needs.
- **Don't end a loop on localhost** — a milestone is reached when it's verified on the live URL.
- **Don't let the white paper and the code silently disagree** — record the divergence as an amendment/ADR.
- **Don't guess a tagset.** No UD/UniMorph tag, feature or value goes into a lexicon, type or UI unless it
  was checked against the published inventory in that session. Records live on other people's PDSs — a
  wrong vocabulary cannot be migrated away later.
- **Don't let the morphology arc pre-empt the loops** — it advances in thin, individually shippable rungs
  beside loops 5–8, never instead of them; and it never breaks the "no paradigm defined" fallback.
- **Add the new versions to the package files** – the package.json and package-lock.json must be updated to reflect the new versions of dependencies used in the project, then give the new version number as the conclusion of the answers in the chat session, so that they can be added manually after review.
- **Always edit the code in the master branch without creating new worktrees**, so that the codebase can be navigated and reviewed easily without confusion.