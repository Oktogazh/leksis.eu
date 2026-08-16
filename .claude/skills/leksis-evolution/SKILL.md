---
name: leksis-evolution
description: >
  Process guide for ADVANCING the Leksis project (leksis.eu) through its staged roadmap — figuring
  out where it currently stands, executing the next milestone, and keeping every step aligned with the
  white paper's bottom-up vision and recorded in the right place.
  Use this skill whenever the work is about MOVING THE PROJECT FORWARD rather than just recalling facts:
  "what's next", "where are we", "let's start the next loop", "is this in scope", "should I build X now or later",
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
3. **Skim the loop tables** (below) to place the current milestone and see what's next.
4. **Check open ADR action items** (`docs/adr/*.md`) for unfinished infra obligations.

State the current position in one sentence ("Loop N complete, next is <theme>") before doing anything else.

### The loops

**A loop is a unit of work, not a unit of time.** The original plan called these "weeks" on a
10–20h/week budget; that framing is retired. Loops are finished when their milestone is verified
on the live URL, and several may land in a day or one may take a fortnight. Do not infer a
schedule from a number, do not promise a date, and do not treat a high loop number as "late".

**Two sequences run side by side.** The *content* loops grow the dictionary outward; the
*grammar* loops (the morphology arc, below) grow the entry deeper. They interleave — a grammar
loop may land between two content loops — but a grammar loop never *replaces* a content one, and
the arc must not stall loops 5 and 6.

**Content loops**

| # | Theme | Milestone (definition of done) |
|---|---|---|
| 0 | Foundation + CI/CD | Live URL + green pipeline ✅ |
| 0 | AT Proto auth | Log in with a Bluesky account (OAuth, real session) ✅ |
| 1 | Languages | Create and browse languages; **firehose consumption starts** ✅ |
| 2 | Entries + orthography | Create, edit, delete entries ✅ |
| 3 | Definitions | Look up a word and read its definitions ✅ |
| 4 | Structure + grammar | Hierarchical definitions + a harvested tag worklist ✅ (v0.8) |
| 5 | Translations | Cross-language graph traversal |
| 6 | Search + polish + release | Public collaborator demo |

**Grammar loops** — the morphology arc's layers, one loop each. See the arc section for scope.

| Layer | Declares | Status |
|---|---|---|
| 1 | Primitives — the atoms this language uses | ✅ ADR-0006 |
| 2 | Inherent combinations — what a headword *is* | ✅ ADR-0007 |
| 3 | Axes — what its forms *vary over* | ✅ ADR-0008 |
| 4 | Layout — the shape of the tables | ✅ ADR-0009 |
| 5 | Rules — generation filling the cells | ✅ ADR-0016 |
| 6 | Export — Hunspell, UniMorph, CoNLL-U | |

> Confirm the actual current position from `CHANGELOG.md` + `git tag` at orient time (step 1) —
> these ✅ marks are a convenience, not the source of truth. As of ADR-0009 the grammar arc is
> through layer 4; content loop 5 (translations) is **in progress** — its lexicon, ingest and read
> surface are built (`docs/design/semantic-network.md` §5 slices 1–3), and the reader and writer
> interfaces are what remain.
>
> **Two obligations trail the arc rather than blocking it.** The authoring surfaces of layers 3 and 4
> still have not been driven in a browser — **U-01…U-24 in `leksis-testset` §7**. What changed at
> layer 5 (2026-08-16) is that the excuses are gone: the session wall is solved, the **fixture set is
> published** (three quarantined languages with layers 1–5 declared, so the Layout tab finally has
> something to lay out), and layer 5's own flows were driven and recorded as **U-60…U-71**. U-16 is
> half done — `qto`'s defect list renders, nobody has walked the repairs. And the **published
> lexicons** still lag the code: `scripts/publish-lexicons.mjs` has not been run since
> `grammar.layout` shipped and now owes `eu.leksis.paradigm` too. Neither blocked layer 5; both are
> reasons not to call layer 4 *verified*, and the first is now a morning's work rather than a
> prerequisite hunt.

> **Loop 1 was the hinge**: once the AppView consumes the firehose it must stay online and **real
> data accumulates**. ADR-0001 action items #4 (deploy secrets) and #5 (off-box backups) were due
> *before* that point — check them at orient time rather than assuming.

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
- **Every linguistic resource is a user-authored record.** The `eu.leksis.*` family is *designed to keep
  growing*: entries and languages today; tag bindings and inflection paradigms in the morphology arc;
  and beyond the prototype, example sentences, corpora, the weighted-voting ballots themselves, and even
  the UI's own interface translations — all of them records any user can publish, none of them platform
  configuration. So when a new kind of linguistic knowledge appears, **the default answer is "a new
  lexicon", not "a table only admins can write"** or a hardcoded asset in `apps/web`. Two consequences
  that regularly get designed away by accident: (a) a record type being *hot* (frequently rewritten by
  many people, like a language record collecting tag bindings) is normal and not an argument against
  making it a record; (b) any surface that reads such data must tolerate it being absent, partial, or
  authored by someone the reader has never heard of.
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
6. Verification slice: run the pre-tag gate below (testset pass + docker build)
7. Tag a release: git tag vX.Y.Z && git push --tags  → GitHub Actions deploys over SSH
8. Test the milestone on the live URL
```

### When to tag, and the pre-tag gate (decided 2026-08-14)

**A tag marks a feature's final slice, not a deployable commit.** Every commit on
master must still leave the repo deployable, but deployability is no longer a
reason to tag — intermediate slices of a feature are committed untagged, and one
tag ships the finished feature. (This replaces the earlier practice of tagging
several times a day.)

Before ANY `git tag`, two gates must pass, in this order:

1. **The testset pass** — run the `leksis-testset` skill's verification protocol
   as the feature's dedicated final slice: publish/refresh whatever fixture rows
   the feature added to the coverage matrix, then drive the affected flows in the
   browser against the manifest's `expect` lines. A feature whose testset slice
   has not run is not finished.
2. **The Docker build** — the api + web images must build locally:

   ```bash
   PDS_ADMIN_PASSWORD=x PDS_JWT_SECRET=x PDS_PLC_ROTATION_KEY=x docker compose build api web
   ```

   (The dummy vars satisfy the `pds` service's required-variable interpolation,
   which otherwise fails the compose file parse on a dev machine; the build
   itself never reads them.) `npm run build` alone has twice passed while the image build failed
   in production (custom packages missing from the Docker context when UD and
   OCLC packages were added); the image build is the deploy's real build, so it
   is the one that gates the tag. No CI duplication needed — the deploy workflow
   already builds on the server; this gate exists so a failure is found *before*
   the tag, not after it.

Tagging itself remains a hard stop: propose the tag, never push it without
explicit user approval.

**Principles for the loop:**
- **Deploy on day one, every loop.** A deployed empty shell is a working pipeline. A pipeline that breaks
  late is a crisis; on day one it's a Tuesday. End every loop on the live URL, not localhost.
- **Smallest schema slice.** Only widen the `eu.leksis.entry` lexicon by what the current loop renders.
  The full lexicon (etymology, cognates, dialectal forms, recordings) is aspirational — pull fields in
  loop by loop, not all at once.
- **Types are the contract.** `packages/types` is shared across web/api and mirrors both the ArangoDB
  schema and the AT Proto lexicon. Change it deliberately; it's how a solo dev keeps three surfaces coherent.
- **Last-write-wins, archive-don't-delete.** Until voting exists, any logged-in user can overwrite an
  entry; the prior version is archived (`current: false`). This is what makes voting buildable later.
- **Before `v1.0.0`, breaking lexicon changes are free — take them.** The app is not public and every
  contribution is a test contribution, so a lexicon change that invalidates existing records costs
  nothing but a bot reset-and-republish (the precedent: `botSource` removal, v0.9). **Do not** design
  around backward compatibility, add compatibility shims, or accept a worse shape to avoid a migration
  while pre-1.0. Get the shape right instead. This inverts at `v1.0.0`: from then on records live on
  strangers' PDSs and *cannot* be migrated by us, so the cost of a wrong shape goes from a republish to
  permanent. **The corollary is a sequencing rule:** any change that must be breaking (e.g. narrowing a
  field's type) has a window that closes at 1.0 — surface that timing when it applies, and let the user
  decide, rather than deferring it silently into impossibility.

---

## Step 4 — Record the evolution (close every meaningful change)

A change isn't done when it works — it's done when it's recorded in the right layer. Match the change to
its home:

| What changed | Where it's recorded | Notes |
|---|---|---|
| A feature shipped / a milestone reached | **`CHANGELOG.md`** under the milestone heading | One section per loop (content or grammar); mirror the existing structure. |
| An architecture/tech choice with trade-offs | **New `docs/adr/NNNN-*.md`** | Status, Date, Deciders, Context, Decision, Consequences, Action Items. Supersede prior ADRs explicitly. |
| A design decision diverging from the white paper | An **amendment** (in the `Oktogazh.github.io` paper folder) and/or an ADR | Keep the paper's amendments file in sync so the public vision doc doesn't drift silently. |
| A change to *what is true now* (stack, schema, lexicon, status line) | Update the **`leksis` context skill** | The context skill must always describe present reality, including its "Status" line. |
| A non-obvious working preference or constraint learned this session | **Memory** (`feedback`/`project` file + `MEMORY.md` pointer) | Only what isn't already captured by the repo or these skills. |

**Bump the status everywhere it lives:** when a milestone completes, update the "Status" line in the
`leksis` skill, the README banner, and the CHANGELOG heading together — they drift apart otherwise.

---

## The morphology arc — north star for the coming loops

*Alignment context, not a plan. Detailed planning is deliberately deferred to the top of each layer. This
section exists so that (a) every loop picks shapes this arc can grow into, and (b) no session invents tagset
details nobody has actually verified. **Layers 1 to 4 shipped (ADR-0006, ADR-0007, ADR-0008, ADR-0009); the
next thing to build is layer 5.***

### Where it ends up

Opening an entry **hydrates it with language-level grammatical knowledge** and renders the word's full
morphology as a table (declension, conjugation, mutation set…):

- the **entry** declares what kind of word it is — its part of speech, its *inherent* features, and its
  inflection class;
- the **language** declares, once, both the **layout** of the inflection tables and the Hunspell-like
  **rules** that generate each cell from the lemma;
- the entry adds **only what cannot be derived** — irregular forms, which override generated cells;
- a perfectly regular lemma carries **nothing**: the table is generated in the frontend;
- with no layout declared for that language, it degrades to today's behaviour — `otherForms` shown as a
  flat list above the definitions, never a fake table.

Layout and rules = the language-level objects. Irregular forms and the class selector = the entry-level
override. Generation = from language-level rules, not stored data.

### Why it is in scope

It passes the scope test hard: it is the purest form of **structure over scale** — the annotation depth
that stands in for the corpus a low-resource language does not have — and it feeds the white paper's
promised outputs (Hunspell dictionaries, spell/grammar checking, NLP substrate). It is **universal from
the start** *only if* designed for languages with no published tagset at all; see the note on treebanks
below.

The risk is equally clear: a general morphology engine is a research project. So the arc advances in
**thin layers, each shippable and useful alone**, and it never displaces loops 5–8.

### Invariants any design must satisfy

These are the alignment guarantees — the **test** a plan must pass. A plan that breaks one is wrong even if
it works. The *mechanisms* that satisfy them live in `docs/design/grammatical-tagging.md`; these are
deliberately short so they stay readable as a checklist.

1. **Three annotation altitudes, kept apart.** *lexeme-level* → the entry's `categories`; *form-level* →
   a **form**, never the entry as a whole (`otherForms`, later paradigm cells); *sense-level* → the
   definition **group node**. `categories` is lexeme-level and must stay so: "plural" is not a category, it
   is a form's feature. Sense-level is **no longer aspirational** — layer 1's lexicon break makes
   `definition.notes` annotation-XOR-tag.

   **Altitude is a property of (category × feature), not of a feature** — and UD says so itself (Animacy is
   "usually a lexical feature of nouns and inflectional feature of other parts of speech"; Aspect is lexical
   in Slavic, inflectional in Turkish). So there is **no global list of inherent features to hardcode**: the
   language declares it, **per category rather than per POS**, because a Slavic perfective verb's cell space
   differs from an imperfective one's. That declaration is also the paradigm's cell-coordinate system.
2. **Tags are machine data; labels are homolingual display, and the two never coexist on one item.** The
   tag rides on the entry record; the **language record carries the binding**. Never render a raw tag as
   prose; never store an English label inside an entry. A tag is a **bundle**, not an atom, and provenance
   rides on **each item** of it.
3. **A label lives on the language, never on an entry — and the tag is what a label names.**
   The framing is **"a labelled tag"** (ADR-0010, which reversed ADR-0006's "a tagged abbreviation"): the
   tag is the identity, the label is what this language calls it, and ADR-0004's read model — renamed
   `labels` — stays the single home rather than gaining a parallel tag collection. Its doc key is
   `(language, canonical row key)`, so **one row per tag per language** is enforced by the primary key
   itself. An entry in a language whose tagset nobody has declared must stay fully editable (through the
   flat picker and manual tag entry).
   **⚠ This invariant was REVERSED in part by ADR-0008 and the old wording is retired.** It used to read
   "free annotation never disappears": that most of what a dictionary prints (`bot.`, `arch.`, `fam.`) has no
   UD equivalent and stays a free `{long, short}` pair on the entry *forever*. The reasoning was right about
   **vocabulary** and wrong about **storage**. The freedom stands — a language may name anything, minting a
   feature where UD has no term — but a label written on an entry is one the language cannot govern:
   invisible to the worklist, uncorrectable in one place, free to drift between two entries. So free pairs
   were removed from the entry lexicon at layer 3; an evicted editorial label becomes prose in `notes`, or a
   minted feature bound on the language record. Do not re-introduce a free-pair field on an entry.
   **ADR-0010 gave that eviction a proper home**: a **lexicographic label set** — a feature flagged
   `lexicographic` on the language record, structurally a minted feature with values, whose values are
   ordinary tags an entry or a sense carries but which the grammatical layers never offer. Alongside it,
   **plain abbreviations** (`udb.` → "un dra bennak") stand for no tag at all and are identified by their own
   short form. Neither weakens this invariant: both live on the *language*, and an entry still carries tags
   and prose and nothing else.
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

### Settled questions — recorded, do not re-litigate

**Every design decision for this arc lives in `docs/design/grammatical-tagging.md`**, organised by layer and
referenced *by name*. Read it before touching any layer, do not re-derive it from recall, and do not re-open
what it has closed. The closed set, named so a session recognises them on sight:

**follow UD and only UD** · **UD supplies the vocabulary, Leksis defines its lexicographic use** ·
**`scheme: "ud"` means documented anywhere on universaldependencies.org** · **per-item provenance** ·
**one bundle, one chip** · **exact → decomposition → verbatim** · **the canonical key** ·
**tag-only `categories`, and the friction is deliberate** · **strict per-site type separation** (replaced the XOR rule at layer 1 — ADR-0006) ·
**binding is declaring (the cascade)** · **store sparse, display complete** ·
**"a labelled tag"** (ADR-0010 reversed "a tagged abbreviation"; harvest-first was already retired at layer
3 — labels are single-sourced from the language, and the read model is keyed on the tag) ·
**identity on the tag, one row per tag per language, enforced by the doc key** ·
**a lexicographic label set is a flagged feature, excluded from layers 2–4** ·
**a plain abbreviation stands for no tag and is identified by its short form** ·
**bindings, axes and layout on the language record, rules in their
own lexicon** · **no XPOS as storage** · **`VerbForm=` on a VERB** · **the triage gate before minting** ·
**the no-orphan rule** · **the layer-1 name→value gate** · **the layer-2 inherence gate, and its enumeration
prompt is not a constraint** · **inflection classes are minted primitives, declared inherent at layer 2 —
there is no separate class layer and no `appliesTo`** · **a (category, feature) pair is inherent XOR an
axis** · **live UD candidate lists with degrade-to-manual** · **sense-level tagging on definition nodes** ·
**`categories` order is the author's, `otherForms` order is the language's** ·
**an axis names its values in order** · **a label lives on the language, never on an entry** (ADR-0008) ·
**derived cells, never a stored matrix** · **a summary flag per block, not indices** · **bare coordinates,
re-qualified before use** · **exact → containment → leftover** · **"no such form" ≠ "not entered yet"** ·
**an inflection class is a minted feature and gets a door, not a mechanism** (ADR-0009) ·
**index expansion at ingest for inflected-form search** (leaning, priced at layer 5) ·
**the AppView indexes only what the interface could have published — structure validated, vocabulary and
assertions not** (ADR-0015, which reversed "detection only, never rejection" for coherence while leaving it
intact for rendering) · **the lexicons' declared array caps are validation, not documentation** ·
**a record that contradicts itself is refused; one that contradicts somebody else is indexed and
contested**.

**Settled by the layer-1 build (ADR-0006), do not re-derive:** `grammar` is `pos` + `features` + `values`,
with `bindings` reserved for layer-2 *combinations* (≥2 items) — a `values` row names its feature, which is
the declaration a bundle cannot make. Annotation sites separate **by field, not by union** — `categories`
(tags) · `notes` (prose), identically on the entry and the definition node. (Layer 1 had a third,
`annotations` for free pairs; **layer 3 removed it** — ADR-0008.) The read model was keyed
on the **label**, a tag being an attribute it acquired; layer 1 made it dual-sourced, **layer 3 made it
single-sourced from the language's bindings**, and **ADR-0010 re-keyed it on the tag and renamed it
`labels`**. §4.2's progressive narrowing was **cut from layer 1 and is
layer 2's to build** — it derives from inherence, so it could not ship before the thing it derives from.

### Still genuinely open — do not answer these by guessing

- ~~**Should the entry-level annotation site also accept a *tag*, or free pairs only?**~~ **Dissolved by
  ADR-0008** — the site itself is gone. The question it leaves behind is sharper and still open: a
  whole-entry label that is *not* a grammatical category (`arch.`, `fam.`) now has only prose `notes` or a
  minted feature. Watch whether contributors reach for a minted `Register` feature; if they do, that is
  evidence the triage gate needs a fourth answer, not that free pairs should come back.
- **The `layout` sub-object's inner shape** (layer 4) — deliberately undesigned until a real conjugation
  table has been drawn by hand. Note layer 3 proved paradigms may be **non-rectangular**, so a dense grid
  is not a safe default.
- ~~**The lexicon `union` encoding for annotation-XOR-tag.**~~ **Moot** — sites separate by field, so no
  union is needed (ADR-0006).
- **The remaining ~19 UD FEATS value inventories.** *Not* a layer-1 blocker — layer 1 validates shape, not
  vocabulary, and the editor fetches candidates live — but nothing in the table below may be extended from
  memory.

### Rules that bind every session touching this arc

- **Never invent tag names, feature names or values.** Anything written into a lexicon, a type or the UI
  must be traceable to a published inventory *or* explicitly minted as a language-declared tag. If you
  cannot cite it and it is not language-declared, you do not know it.
- **Verify at the source — do not trust the table below, and do not trust model recall.** Tagset details
  are exactly what an LLM reproduces confidently and wrongly.
- **An explicit list of "I don't know yet" is a valid deliverable** for a layer's plan, and better than a
  confident wrong vocabulary. Pre-1.0 a wrong shape costs a bot republish; post-1.0 it is permanent.

| Verified at source | What it is |
|---|---|
| **UPOS** | Exactly 17, its own CoNLL-U column (never a feature). *Open* ADJ ADV INTJ NOUN PROPN VERB; *closed* ADP AUX CCONJ DET **NUM** PART PRON SCONJ; *other* PUNCT SYM X. The page states **no extension policy either way**. PUNCT/SYM/X are excluded from headwords by **Leksis's** judgement, not UD's. ART routes to DET + `PronType=Art`; COMP → SCONJ. |
| **FEATS** | `Feature=Value`, `\|`-separated, features **and** multivalue values sorted alphabetically (`Gender=Fem,Masc`); layered names `Number[psor]`. **"UD treebanks may use additional features and values if they are properly documented"** — the licence for minting. |
| **Inventories fetched** | Gender, Case, NounClass; `Number` (11, **no singulative**; `Coll` is a subtype of *singular*); `VerbForm` (Conv Fin Gdv Ger Inf Part Sup Vnoun); `PronType` (11, incl. `Art`); `Animacy` (Anim **Hum** Inan Nhum); `Aspect` (Hab Imp Iter Perf Prog Prosp). `Animacy=Hum` answers "noun denoting a male person" with **no minting**; Breton's singulative genuinely must be minted. |
| **Three tiers of UD docs** | universal (the index) · non-universal **with a global page** (`Subcat`, whose value list is unsettled) · language-specific in treebank docs (`Gender[psor]`). Only the third needs minting. |
| **`NounClass`** | Family-specific values (`Bantu1`–`Bantu23`, `Wol1`–`Wol12`); UD says comparable systems should be developed for other families — **the citation that makes a language declaring its own inventory UD working as designed.** |
| **Altitude, in UD's own words** | Animacy is "usually a lexical feature of nouns and inflectional feature of other parts of speech"; Aspect is lexical in Slavic, inflectional in Turkish. Cite these for invariant 1. |
| **AT Proto** | Record ceiling ~1 MiB; a full grammar object is ~30 KB, so **size never constrains this arc**. The real pressure is firehose churn, since every edit republishes the whole record. |
| **Apertium / Hunspell** | `<pardef>` + `<par n>` — stem plus paradigm pointer — is **the** prior art, since neither UD nor UniMorph defines a paradigm object. Hunspell affix rules are the generation model and are **not cheaply invertible**, which is why search wants ingest-time expansion. |

> **Design for the language that has nothing.** A low-resource language usually has **no UD treebank**, so
> no documented language-specific feature set exists for it at all. That is not a gap in Leksis — it is
> Leksis's job: the language record becomes the place where that language's tagset is *declared*. Never
> design a flow that assumes a published tagset already exists for the language.

### The layer model

The arc is a **stack of layers on the language record**, each shippable on its own. Full shapes, record
schema and reasoning: `docs/design/grammatical-tagging.md`.

A layer may be interleaved with loops 5–8; none may replace one. **The scopes are deliberately
hard-edged** — the failure mode of this arc is a layer quietly absorbing the next one. Still plan each
layer at its top; the scope says *what is in and out*, not *how*.

> **The cascade is the core mechanism.** Each layer draws its options from the layer below, so an option
> not declared below cannot be chosen above. In layer 1 a language binds only the tags it actually uses;
> `Gender=Neut` left unbound in French means neuter never appears as an option in layers 2–5. **Binding
> is therefore not merely labelling — it is how a language declares its inventory**, which is what makes
> the flow work for a language with no published tagset.
>
> **The cascade governs authoring, never rendering.** A tag arriving unbound from a bot or another
> AppView still renders (verbatim, styled unbound — design note §2.4). A viewer that *rejected* unbound
> tags would make the AppView the arbiter of a language's grammar, which invariant 3 forbids.

| Layer | What it declares | Status |
|---|---|---|
| **0 — Abbreviations** | homolingual labels bound to nothing: plain abbreviations, and (ADR-0010) lexicographic label sets for register, domain and editorial usage | **shipped** (v0.8); its entry-level site was removed at layer 3, and ADR-0010 gave it a home on the language record |
| **1 — Primitives** | the atoms this language uses: 14 headword-eligible UPOS, feature *names*, feature *values*. **Minting lives here**, including inflection-class features and their values | **shipped** — see **ADR-0006**, which is authoritative over the design note for this layer |
| **2 — Inherent combinations** | which features are **inherent** to a category, then the labelled headword categories that follow: masculine noun, first-declension feminine noun, transitive imperfective verb | **shipped** — see **ADR-0007**, authoritative over the design note for this layer |
| **3 — Axes** | per category, which features **vary across its forms**, over which values, **in order** — the option set of the `otherForms` editor | **shipped** — see **ADR-0008**, authoritative over the design note for this layer |
| **4 — Layout** | the *shape* of the inflection tables: which axis sits where, one table or several, their order, what is shown by default, and the order of the flat `otherForms` list — **not** chip order | **shipped** — see **ADR-0009**, authoritative over the design note for this layer |
| **5 — Rules** | Hunspell-shaped rules populating cells, overridden by the entry's own `otherForms`; its own lexicon | **shipped** — see **ADR-0016**, authoritative over `docs/design/paradigm-rules.md` for this layer |
| **6 — Export** | Hunspell `.aff`/`.dic`, UniMorph TSV, CoNLL-U — and XPOS as a *derived* output | |

**Layer 1 — Primitives.** *In:* the tag type in `packages/types` (per-item `scheme`, canonical key for
matching); `grammar.bindings` + `grammar.features` on `eu.leksis.language`; the `labels` read model
widened to carry the tag and to surface **unbound tags in use** as a worklist; the
entry editor's suggestion flow; the viewer resolving **exact → decomposition → verbatim**. Two row kinds are
both needed: a feature *name* row (the axis header layer 4 prints) and a feature *value* row (the chip), and
they are **gated — a feature name must be bound before any of its values can be**, mirror included. The 14
headword-eligible UPOS are 17 minus PUNCT/SYM/X — **a Leksis editorial judgement, not UD's**, which states
no extension or eligibility policy on its POS page.
*Also in, and non-negotiable:* **minting** (`scheme` = the language's BCP 47 tag) at three granularities: a
new value on a UD feature (`Number=Sgv` for the Breton singulative — UD's Number has none); a new feature
name; and, reluctantly and as a justified exception, a POS. **Inflection classes are minted primitives and
nothing more** — a Latin declension or French conjugation group is a minted *feature* whose *values* are
minted and bound here; which category it applies to is layer 2's business.
*Also in — the whole entry-lexicon break, done once:* `categories` narrowed to **tag-only**; the new
**entry-level annotation site** it evicts `vulg.`/`arch.` into; and `definition.notes` becoming
**annotation-XOR-tag**, so a sense group can be tagged transitive while the entry itself is `VERB`. Pre-1.0
one break costs one bot republish; two breaks cost two.
*Also in — two interfaces, both specified in design note §4:* the **binding editor**, a tabbed path-scoped
tree whose navigation *is* the gate (one level at a time, path in the sidebar, everything inside the layer's
own tab), with **live UD candidate lists** and a **degrade-to-manual** guardrail; and the **entry editor's
progressive narrowing** — the contributor clicks the language's own labels and each click narrows what is offered
next (`n.` → gender options → `nf.` → declension options), never typing a criterion. Four properties that
must hold: the suggestion tree is a **derived view** of layers 1–2, not a separate declaration; a refinement
path stores **one bundle, not an accumulation**; it **degrades to a flat multi-select** and never blocks an
unenumerated combination; and **every step shows a bound homolingual label**, which is only possible because
tag-only `categories` forced the grammar to be declared first.
Note layer 1 also binds **form-level vocabulary** (Tense and Case values, for table headers layer 4 will
print), so it applies **no altitude filter**: altitude emerges from which higher layer references an item.
*Out:* inherence, axes, layout, rules, export.

**Layer 2 — Inherent combinations. ✅ shipped (ADR-0007).** Two steps, and the first is the one no earlier
design had:
**declare that a feature is inherent to a category at all** *before* any of its value-combinations can be
bound. Previously inherence was only *implied* by which combinations happened to exist, so the system could
not distinguish "aspect is inherent to verbs" from "somebody bound one aspectual verb category". The editor
then **prompts** for one combination per bound value — `{VERB, Aspect=Perf}`, `{VERB, Aspect=Imp}`, … — each
with its own label.
**This is every category, not nouns.** The row is `(category, feature)` and *both* halves are variables:
`VERB × Aspect`, `VERB × Conjugation`, `ADJ × Degree`, `PRON × Person`, `ADP × Conjugation` (Breton
conjugates prepositions), `NOUN × Gender`, `NOUN × Declension`. No privileged category, no per-UPOS
special-casing. And since `category` is a `Tag`, inherence may be declared on a **combination** too, which is
what sets the *depth* of the entry editor's narrowing tree: `Declension` inherent to `{NOUN}` offers it
straight after `n.`, inherent to `{NOUN, Gender=Fem}` only after the gender is chosen. The language's call.
**The enumeration is a prompt, not a constraint:** an incomplete set must not block a save, because a
language may bind a value for another category's sake while no headword of this one takes it.
Note the **gate symmetry** — layer 1 gates value-behind-name, layer 2 gates
value-combination-behind-inherence. One rule at two levels, which is why both render as navigation rather
than as validation errors. *Never a whitelist:* an unenumerated combination stays authorable and renders by
decomposition. *Out:* anything concerning forms.

**What layer 2 settled, and layer 3 inherits (ADR-0007), do not re-derive:** `inherent` rows are singular
`(category, feature)` with a **bare feature name** — which is exactly how layer 3's `axes` should key, so
the two read as one relation at two altitudes. **Grounding** is the gate's name: a named combination must be
reachable by removing one feature at a time, each removal licensed by an inherence declaration, down to a
bound atom. Completeness ("2 of 3 named") is a **counter and never a constraint**. Combinations reach the
`labels` model through `grammarRows` alone, so **the API cost of the layer was zero** — expect the
same of layer 3 if its shapes are right, and treat any need for new indexing as a signal to re-check the
design. The entry editor resolves the grammar from the **language record via its PDS**, not from an index:
an authoring surface may pay that round trip where the viewers never do. `Tag` now lives in a shared
**`eu.leksis.defs`** lexicon, which is where layer 5's paradigms should get it too.

**Layer 3 — Axes. ✅ shipped (ADR-0008).** Per category, which features **vary across its forms**, over
which **values**, in which **order** — the `otherForms` editor's option set. With layer 2 this completes
invariant 1's declaration: layer 2 is its inherent half, layer 3 its axis half, and the pair *is* the
paradigm's cell-coordinate system.

**What layer 3 settled, and layer 4 inherits (ADR-0008), do not re-derive:** an `axes` row is
`{category: Tag, feature: string, values: string[]}` — it **names its values in order**, because a
language's inventory and one category's paradigm are not the same set (three genders in the adjectives, a
split masculine in the nouns) and because that order is what layer 4 prints. It keys exactly as `inherent`
does — a `Tag` category, a **bare** feature name — which is what makes `inherent-axis-conflict` detectable;
`empty-axis` is the other new issue kind, and both are issues rather than shape rejections. An axis
category is checked for **bound atoms only, never grounding**, and that is what lets a paradigm be
non-rectangular: `{VERB, VerbForm=Fin}` takes a Person axis, `{VERB, VerbForm=Inf}` simply never declares
one — so **layer 4 must not assume a rectangular grid**. `applicableAxes` walks an entry's *sub-bundles*,
so an axis on `{NOUN}` reaches an entry categorised `{NOUN, Gender=Fem}`; layer 4 should read the cell
space through it, not through exact matching. `otherForms[].annotation` became `otherForms[].tag`, **one
bundle** — the cell address layer 5 will match by canonical key. The API cost was **zero** again, as at
layer 2; treat any need for new indexing at layer 4 as a signal to re-check the design.

**Layer 4 — Layout. ✅ shipped (ADR-0009).** Layer 3 gives a category's *cell space*; it does **not** say what the table looks
like, and axes alone underdetermine presentation — four axes could be one grid with nested headers or four
separate tables. So, per category: which axis sits on which dimension, one table or several, the order the
tables appear in, and **what is shown by default** — Latin dictionaries print the genitive and expect the
reader to derive the rest, so a full table is not always wanted. It also fixes the display order of the flat
`otherForms` list, the one-dimensional degenerate case of the same declaration. **Chip order is *not*
here** — `categories` order stays the entry author's: order-as-phrasing belongs to the entry,
order-as-table-geometry to the language.
**Ships alone and is immediately useful:** with no rules behind it, an entry's own hand-entered forms land
in a proper grid instead of a flat list, and the fallback becomes exactly "no layout declared → flat list".
*Out:* generation.

**What layer 4 settled, and layer 5 inherits (ADR-0009), do not re-derive:** a `layout` row is
`{category: Tag, blocks[]}`; a block is a **table** (axis feature *names* per dimension, outermost first) or
a **list** (explicit addresses in order), either able to pin constants with `fixed` and be flagged
`summary` — a flag per block, never indices on the layout. **Cells are derived, never stored**, so
non-rectangularity comes from several blocks with different constants, `exclude` for holes, and a list block
for what no grid reaches; that is the answer to "the inner shape", and layer 5 should fill cells rather than
enumerate them. A coordinate is bare `{feature, value}` and is **re-qualified from its `values` row by
`coordTag` before display or matching** — the step that makes minted vocabulary work, and the one to copy
when a rule addresses a cell. The join is **scheme- and part-of-speech-blind** (`featsMatchKey`), because a
bot and the editor write the same form differently. `placeForms` already matches **exact, then containment,
most specific first**, and keeps the unplaced as **leftovers** — which is precisely the override layer 5
needs, so a rule engine should generate into the *same* addresses and let this decide. Five new issue kinds
(`layout-unknown-axis`, `layout-repeated-axis`, `layout-foreign-coordinate`, `empty-layout-block`,
`layout-too-large`) with `MAX_LAYOUT_CELLS` at 4096; a layout whose category is unbound is **not inspected
further**, one defect one issue. Two reader-facing rules are now fixed: a cell the language says **cannot
exist** renders differently from one **nobody filled in**, and a block no form fills is **not drawn** — the
second is layer 5's to revisit, since generation is exactly what makes an empty table stop being empty.
The API cost was **zero** for the third layer running, but note layer 5 breaks that streak by design: its
rules get their own lexicon, and ingest-time index expansion for inflected-form search is its cost to price.

**Layer 5 — Rules. ✅ shipped (ADR-0016).** A new `eu.leksis.paradigm` lexicon (not fields on the language record): Hunspell-like
rules populating the cells layer 4 laid out. **The entry's own `otherForms` override any generated cell** —
matched by canonical key on the cell address, which is why layer 3 must make a form's annotation a bundle. An
`otherForm` matching no declared cell falls back to the flat list rather than being dropped; that is the safe
failure. The entry carries its inherent categories plus exceptions, never generated forms (invariant 5).
**Which inherent feature selects a paradigm is decided here, not declared anywhere** — a rule keys on
whatever bundle its author chooses (`{VERB, Conjugation=1}`, `{VERB, Aspect=Perf}`, or both), which is why
deleting the old class layer cost nothing. Apertium's `<pardef>` + `<par n>` is the model; the record ceiling
is ~1 MiB (verified). One shared generator (invariant 6). Three things to price honestly: cells are
**many-to-one** (syncretism — the table must merge, not repeat); ingest-time index expansion means a rule
edit re-expands an entire language; and **"no such cell" and "one form spanning the whole axis" must render
differently**, or a reader cannot tell a missing form from an incomplete entry — spell the second as a UD
multivalue over the language's declared inventory (`Gender=Fem,Masc`, values alphabetical), never as a
UniMorph `*`. Per-lexeme defectiveness is an entry-level exception here, not a property of any declaration.
*Out:* export formats.

**What layer 5 settled, and layer 6 inherits (ADR-0016), do not re-derive:** identity is the **rkey**,
`{languageID}-{hash16(canonical selector key)}`, recomputed at ingest and refused on mismatch — so `selector`
is immutable per identity, and an exporter reading a language's paradigms gets one per category by
construction. A paradigm reaches an entry by containment on its **inherent bundle** (`inherentAtoms`, the
UPOS plus the feats the language declares inherent), **never on all of `categories`** — an exporter walking
entries must use the same test, and it lives in one place per side (`expand-forms.ts` in the AppView,
`paradigmsReaching` in the browser). Several paradigms may reach one entry, **most specific selector wins per
cell**. Display precedence is asserted → generated → the layer-4 states, which is also the precedence an
export must flatten: a Hunspell `.dic` cannot carry "this one was derived". `generateForms` is **total** — a
bad regex is a validation issue and never a throw, a base cycle yields nothing — because it runs inside the
single sequential writer, and layer 6 will run it in bulk. `paradigmIssues` refuses a record whose rules
contradict *themselves* and judges **nothing the language record says**, so an *inert* paradigm (a selector
nobody declared) is an ordinary state an exporter will meet and must skip rather than error on. And the
zero-API-cost streak **ended by design and only just**: one endpoint (`GET /languages/:tag/paradigms`,
pointers only), one collection, two cached fields on `entries` — treat any further indexing at layer 6 as the
same signal to re-check the design that it was at layers 2–4.

**Layer 6 — Export.** Hunspell `.aff`/`.dic`, UniMorph TSV, CoNLL-U FEATS out of the graph: the annotation
*becomes* the NLP resource the white paper promises. Losses are declared, not accidental. XPOS belongs here
too — a string *generated* from layers 1–2, never storage.

**Referential integrity — the cost of the cascade.** Unbinding a layer-1 atom orphans every higher row that
references it. All of layers 0–4 therefore live in **one self-contained `grammar` sub-object** on the
language record, so a single write keeps it consistent — which is why bindings are *not* lifted into their
own record type: the layers couple them, and splitting would cost cross-record integrity. Two guards, both
required at layer 1:

- **The no-orphan rule.** Unbinding is refused while any higher layer depends on the row — including a
  feature name whose values are still bound. "Unbinding" is not a delete operation: the whole `grammar`
  object is rewritten, so the check is a pure function over the *whole* object in `packages/types`
  (`grammarIssues`). **Enforced in the browser and at the AppView, as one rule — ADR-0015 reversed this
  entry's original answer**, which was "detection only, never rejection" with the dashboard surfacing a
  **repair worklist**. That was wrong for one reason the argument never considered: the editor *navigates*
  the cascade, so it has no level that lists a row hanging off something unbound — the worklist named rows
  nobody could reach. An incoherent grammar is now refused at ingest (the previous version stays current)
  and the browser blocks publishing **any** defect, not only a newly introduced one; the diff over
  (old, new) is retired. Rendering stays lenient — refusing to *display* an orphan would make the AppView
  the arbiter of a language's grammar, which the original objection was right about. The unbound-*tag*
  worklist is untouched: a gap between two records is not a contradiction inside one.
- **An optimistic-concurrency guard.** Refuse the write if the record changed since load: last-write-wins
  can now drop a reference, not merely a label.

---

## Beyond the prototype (the constellation)

Where the morphology arc grows the atom **deeper**, the constellation grows **outward**. Once the
word-to-word dictionary is live and stable (after the last content loop), the roadmap expands on the **same ArangoDB graph
+ AT Proto backend**. Keep these in view so today's choices don't foreclose them, but do **not** build
them early:

1. **Weighted voting mechanism** — Elo/Rasch-derived, type-specific contributor ratings layered over the
   existing version history. The project's signature contribution; deferred until the prototype is live.
2. **Sentence / monolingual corpora repository** — per-language content to translate into and out of.
3. **Community translation platform** — separate `apps/translate` frontend, shared backend; its
   translation memory feeds example sentences back into the dictionary.
4. **Usage / language-learning tools** — built on the dictionary graph + translation memory.
5. **Expo / React Native** — migrate once the PWA architecture is validated.

Each is a future AppView, not a prototype feature. The discipline of the last content loop is to ship the *one solid
atom* (the dictionary) that the rest can grow from.

---

## Guardrails (hard "don'ts")

- **Don't invert the priority ladder** — dictionary before corpora before translation before usage tools.
- **Don't build the full lexicon or future apps "to save time"** — scope creep is the main failure mode
  for a solo dev on a constellation-sized vision. Defer, with a trigger.
- **Don't delete records or skip version archival** — it destroys the substrate the voting system needs.
- **Don't end a loop on localhost** — a milestone is reached when it's verified on the live URL.
- **Don't let the white paper and the code silently disagree** — record the divergence as an amendment/ADR.
- **Don't guess a tagset, and don't reach for UniMorph.** Leksis follows **UD only**; a UniMorph tag never
  enters a lexicon, type or UI — it exists solely in the layer-7 exporter. No UD tag, feature or value goes
  in either unless it was checked against the published inventory in that session, **or** is explicitly
  minted as a language-declared tag (`scheme` ≠ `"ud"`), which is a legitimate and expected act — not a
  fallback for not having checked. Pre-1.0 a wrong vocabulary costs a bot reset-and-republish; from 1.0 on,
  records live on strangers' PDSs and it cannot be migrated away at all.
- **Don't let the morphology arc pre-empt the loops** — it advances in thin, individually shippable layers
  beside loops 5–8, never instead of them; and it never breaks the "no layout declared" fallback.
- **Add the new versions to the package files** – the package.json and package-lock.json must be updated to reflect the new versions of dependencies used in the project, then give the new version number as the conclusion of the answers in the chat session, so that they can be added manually after review.