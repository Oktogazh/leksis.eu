---
name: leksis-ingest
description: >
  Context for building external ingestion bots ("scrapers") that load dictionary content into Leksis (leksis.eu) by writing eu.leksis.* records to the project's bot PDS (pds.leksis.eu). Use this skill in any scraper/importer mini-project repo that converts a source (a dictionary, a Wiktionary dump, etc.) into eu.leksis.language and eu.leksis.entry records. Covers the target architecture, the exact lexicon shapes and their invariants, the grammatical tagging model (UD tags on entries, homolingual labels on the language record) and the abbreviation-mapping file a monolingual-source bot must keep, how to create a bot account and publish records with @atproto/api, and how the AppView will treat what you publish. Maintained in the leksis.eu monorepo (.claude/skills/leksis-ingest/) — it is derived from the canonical files listed at the bottom; if this skill and the live lexicons disagree, the lexicons win.
---

# Leksis ingestion bots — writing records to the bot PDS

## What you are building

Leksis is a distributed, crowdsourced multilingual dictionary on AT Protocol.
Content does not go into its database directly: **contributors publish
`eu.leksis.*` records on their own PDS**, the Bluesky relay crawls that PDS,
Jetstream re-serves the events, and the Leksis AppView (api.leksis.eu) indexes
what its read surfaces need. The record on the PDS remains the source of truth
for the content; the web app renders an entry by fetching the record straight
from the author's PDS.

An ingestion bot is just another contributor: a script with an account on the
project's **bot-only PDS at `pds.leksis.eu`** that converts one external source
into well-formed records and writes them to its own repo. Nothing else — no
direct DB access, no private AppView API. If the records are valid, they flow
into the index automatically.

```
scraper script ──com.atproto.repo.createRecord──▶ pds.leksis.eu
                                                      │ (crawled by bsky.network relay)
                                                      ▼
                                            Jetstream firehose
                                                      │ (wantedCollections=eu.leksis.*)
                                                      ▼
                                       Leksis AppView → ArangoDB read models
```

Consequence: **there is no synchronous feedback.** `createRecord` succeeding
means the record is on the PDS, not that the AppView accepted it. Invalid
records are logged and *silently skipped* by the AppView. Validate locally
before writing (invariants below) — a bad batch is easy to publish and tedious
to clean up.

**A bot publishes two kinds of record, in this order:** one
`eu.leksis.language` record carrying the language's **grammar declaration**,
then the `eu.leksis.entry` records that reference it by tag. The order is not
cosmetic — see *The grammar layer* below, and *The abbreviation mapping file*,
which is the artefact that makes the two consistent.

## The bot PDS

- **Host:** `https://pds.leksis.eu` — a standard `ghcr.io/bluesky-social/pds`
  (v0.4) instance, part of the leksis.eu docker-compose stack, public because
  federation requires it.
- **Accounts:** one account per bot/source, handle directly under the domain,
  e.g. `wikbot.leksis.eu` (the `*.leksis.eu` wildcard covers it). DIDs are
  normal `did:plc` DIDs.
- **Account creation, login, and all writes** are **IP-gated at the Caddy
  edge** to the operator's allowlist (`ALLOWED_IPS` in the server's `.env`),
  which is deny-by-default: everything under `/xrpc/*` is 403'd from outside the
  allowlist except the federation/read surface (`com.atproto.sync.*`,
  `identity.*`, `server.describeServer`, `repo.getRecord`/`listRecords`/
  `describeRepo`, and `/.well-known/*`). So `createSession` (login),
  `createRecord`, `uploadBlob`, etc. only work from an allowed IP — run the bot
  from the server (or an allowlisted IP), or ask Alan to. Reading records works
  from anywhere.
- **Auth for scripts:** plain session auth is fine for bots — no OAuth dance
  needed:

```ts
import { AtpAgent } from "@atproto/api";

const agent = new AtpAgent({ service: "https://pds.leksis.eu" });
await agent.login({
  identifier: "wikbot.leksis.eu",     // handle (or DID)
  password: process.env.BOT_PASSWORD!, // use an app password, keep it in env
});
```

- **Writing a record:**

```ts
await agent.com.atproto.repo.createRecord({
  repo: agent.session!.did,
  collection: "eu.leksis.entry",
  record: entryRecord, // shape below; rkey is a TID, let the PDS mint it
});
```

  For bulk loads prefer `com.atproto.repo.applyWrites` (up to 200 writes per
  call) and pace yourself — a PDS enforces rate limits per repo
  (~5000 write points / hour, a create = 3 points, i.e. roughly 1600
  creates/hour sustained). Batch, throttle, and make the script resumable.
- **Rate-limit bypass key:** the PDS's per-repo write limits are hardcoded
  (not tunable), so bulk imports bypass them with the server's
  `PDS_RATE_LIMIT_BYPASS_KEY` secret (in the leksis.eu server `.env` — ask
  Alan for it, keep it in the scraper's env, never commit it). Send it as a
  header on every write:

```ts
await agent.com.atproto.repo.applyWrites(
  { repo: agent.session!.did, writes },
  { headers: { "x-ratelimit-bypass": process.env.PDS_RATELIMIT_BYPASS! } },
);
```

  Without the header, normal limits apply — fine for small runs, too slow for
  a full dictionary load.
- **Fixing mistakes:** `putRecord` (same rkey, full rewrite) republishes a
  version; `deleteRecord` removes it — and the AppView mirrors entry deletions
  (see lifecycle below), so deleting a bad record genuinely cleans the index.

## Record lifecycle rules (what the AppView does with your records)

- **Records prove authorship, not ownership** (Wikipedia model). Nobody owns
  an entry or a language; the latest version wins, previous versions are
  archived. **Any user may publish a record for any language tag** — including
  one whose grammar another bot declared. Read before you rewrite.
- A record **without `subject` is a brand-new entry** — homonyms deliberately
  coexist. A record **with `subject`** (the `at://` URI of an existing entry
  record version) is a proposed new version of that entry and becomes its
  current version (last write wins). A `subject` the AppView never indexed
  degrades to a new entry.
- Records are always **full rewrites**, never patches. This matters most for
  the language record, which accumulates a whole language's grammar: rewriting
  it from a stale copy silently drops everyone else's bindings.
- **Deletions are mirrored for entries:** deleting an `eu.leksis.entry` record
  from the bot's repo removes that version from the index; deleting an entry's
  last version removes the entry from search. (Language versions, by
  contrast, archive forever — the current one is un-currented and nothing is
  reinstated.)
- **Withdrawal is not the same as deletion.** Publishing a version with
  `deleted: true` + `deletionReason` (+ optional `redirectTo`) keeps the entry
  addressable at its `entryKey` — legacy links resolve and show the reason —
  while removing it from search. That is the right tool for "this import
  produced a duplicate"; `deleteRecord` is the right tool for "this record
  should never have existed".
- **Idempotency is on `recordURI + cid`** — replaying the same record is
  harmless, but re-*creating* the same content mints a new rkey and therefore
  a **duplicate entry**. A rerunnable importer must track what it already
  published — keep a local state file mapping each source item to the rkey /
  recordURI it created (or list its own repo with
  `com.atproto.repo.listRecords` and match by content) — and use
  `putRecord`/`subject` to update rather than re-create.
- The AppView validates strictly at ingest: any wrong type **rejects the whole
  record**, silently. See *What the AppView checks* below for the current list.
- **Breaking lexicon changes are handled by reset-and-republish**: while the
  app is bots-only, the operator deletes the old records and the updated bots
  republish in the new shape. Keep every bot able to regenerate its full
  output from source + local state. **Layer 3 (v0.9.0) was such a break** — see
  *Migrating from the pre-v0.9 shape*.

---

# The grammar layer — tags, labels, and how the two records meet

This is the part a bot most often gets wrong, because it is the part with no
UI to lean on. Read this whole section before writing a converter.

## 1. The one rule: an entry carries tags, a language carries labels

A **tag** is a machine identifier following Universal Dependencies. A **label**
is the reader-facing string a human sees (`n.`, `an.`, `nf.`). They never
coexist on one item:

| | lives on | is | example |
|---|---|---|---|
| **tag** | the **entry** record | machine data, language-neutral | `{upos:{value:"NOUN"}}` |
| **label** | the **language** record | homolingual display text | `{long:"anv-kadarn", short:"an."}` |

An entry record therefore contains **no reader-facing grammatical text at
all**. There is no `annotations` field, no `{long, short}` pair anywhere in
`eu.leksis.entry`, and nothing on an entry that says "noun". A bot that has a
source abbreviation and no tag for it has two legal moves: emit prose in
`notes`, or bind a tag for it on the language record. It may not write the
abbreviation into a category.

Why: a label written on an entry is one the language cannot govern — invisible
to the worklist, uncorrectable in one place, free to drift between two
entries. Single-sourcing the label is what makes the dictionary's front-matter
abbreviation list a real, maintainable object.

## 2. A tag is a bundle

```ts
Tag = {
  upos?: { value: string; scheme?: string },
  feats?: { feature: string; value: string; scheme?: string }[],
}
// at least one of upos / feats must be present
```

- **A bundle, not an atom**, because languages abbreviate at different
  granularities: French `nf.` is *one* label for `NOUN + Gender=Fem` where
  Breton prints two (`an.`, `b.`). One bundle renders as one chip when the
  language named that bundle, and as several when it named only the parts.
- **`scheme` rides on each item, never on the bundle.** Absent (or `"ud"`)
  means "documented somewhere on universaldependencies.org"; anything else is
  the **BCP 47 tag of the language that minted the item**. This is what makes
  `{NOUN (ud), Number=Sgv (br)}` expressible — a UD part of speech beside a
  Breton-minted value. Marking the whole bundle `br` would break matching
  against `ud`-scheme bindings and leave a future exporter unable to tell
  which halves are exportable.
- **Shape, verified at source (UD `format.html`):** feature names match
  `[A-Z][A-Za-z0-9]*(\[[a-z0-9]+\])?` (the bracketed suffix is a *layered*
  name — `Number[psor]`, the number of a possessor); values match
  `[A-Z0-9][A-Za-z0-9]*`, so a value **may begin with a digit** and a minted
  `Conjugation=1` is well-formed. Several comma-separated values in one item
  mean the item **spans them all**: `Gender=Fem,Masc` is an épicène form, not
  two tags.
- **Bundle equality is computed on a canonical key**, not on the literal
  object: features sorted by name, multivalue values sorted, `upos` in its own
  slot, absent scheme written out as `ud`. Use `tagKey()` from
  `packages/types/src/tag.ts`; comparing objects directly fails silently
  whenever two authors listed the same items in a different order.
- **Never invent a UD item.** Either cite it (you checked the published
  inventory this session) or mint it explicitly with `scheme`. Minting is a
  legitimate, expected act — not a fallback for not having checked.

## 3. Three altitudes, kept apart

The same `Tag` type appears at three altitudes, and putting a tag at the wrong
one is the most common modelling error in an import:

| altitude | field | what it says | typical source label |
|---|---|---|---|
| **lexeme** | `entry.categories` | what the headword *is* | `n.`, `v.`, `nf.` |
| **sense** | `definitions[].categories` | what *this sense* is | `v.t.` on sense II |
| **form** | `otherForms[].tag` | *which form* this spelling is | `pl.`, `gen. pl.` |

"Plural" is **not** a lexeme category — it is a form's feature. A verb is
`VERB` at the lexeme level and transitive on one sense group, intransitive on
another; both are legal at once, and a dictionary that prints `v.t.` in the
headword line *and* splits senses by transitivity is doing something normal.

All three altitudes feed the AppView's tag worklist, so an unnamed
`Number=Plur` on a plural form is as much a gap in a language's declaration as
an unnamed `NOUN` on a headword.

> **Transitivity, the commonest sense-level label, needs checking before use.**
> UD expresses subcategorisation through the non-universal `Subcat` feature,
> which has a global documentation page but whose value list is not settled in
> this project's notes. Fetch the page and use what it publishes, or mint
> explicitly — do **not** assume values from memory.

## 4. How a tag becomes something a reader can read

The viewer resolves every tag through one chain, **exact → decomposition →
verbatim**:

1. **Exact bundle match** — the language bound `{NOUN, Gender=Fem}` → `nf.`
   renders as one chip, `nf.`
2. **Decomposition** — no exact match, but the parts are bound: render the
   parts in the bundle's own order. A language that bound `{NOUN}` → `an.` and
   `{Gender=Fem}` → `b.` shows `an. b.` — never a synthesised `anb.` nobody
   authored. Greedy on the largest bound sub-bundle, and **partial
   decomposition still beats a raw tag**.
3. **Verbatim** — the UD-shaped identifier (`NOUN Gender=Fem`), visibly styled
   as unbound.

**Consequence for bots, and it is the important one:** publishing a tag no
language has bound is *expected*, not an error. It renders verbatim and shows
up on that language's dashboard as a translation worklist item. The cascade
(below) governs **authoring, never rendering** — the AppView will never reject
your entry over an unbound tag, because doing so would make it the arbiter of
a language's grammar.

That said, a bot that leaves everything unbound has done half the job. If your
source has an abbreviation list — and a monolingual dictionary always does —
that list *is* the language's binding declaration, and publishing it is part
of the import.

## 5. The language record's `grammar` sub-object

```ts
// eu.leksis.language record
{
  $type: "eu.leksis.language",
  tag: string,                      // lowercase BCP 47; rkey = this same string
  translations: [{ languageID, translation }],   // MUST include the endonym
  grammar?: {
    // ---- layer 1: the atoms this language uses ----
    pos?:      { value, scheme?, label, references? }[],
    features?: { feature, scheme?, label, references? }[],
    values?:   { feature, value, scheme?, label, references? }[],

    // ---- layer 2: what those atoms combine into ----
    inherent?: { category: Tag, feature: string }[],
    bindings?: { tag: Tag, label, references? }[],   // COMBINATIONS ONLY (≥2 items)

    // ---- layer 3: what a category's forms vary over ----
    axes?:     { category: Tag, feature: string, values: string[] }[],
  },
  createdAt: string,
}

label     = { long: string, short?: string }   // long REQUIRED; homolingual
reference = { text: string, url?: string }
```

**Binding is declaring — this is the core mechanism.** A language's `grammar`
is not decoration on top of a fixed tagset; it *is* the language's inventory.
`Gender=Neut` left unbound in French means neuter never appears as an option
anywhere downstream. Designed for the language that has **nothing**: a
low-resource language usually has no UD treebank, so no documented tagset
exists for it at all, and the language record is where that tagset gets
declared for the first time. Never assume a published tagset exists.

### Layer 1 — the atoms

- **`pos`** — a part of speech. UD's inventory is exactly 17 and closed;
  Leksis treats **14** as headword-eligible (the 17 minus `PUNCT`, `SYM`, `X`
  — a Leksis editorial judgement, not UD's). A language may still mint one
  when none fits.
- **`features`** — a feature **name** (`Gender`, `Case`, `Number[psor]`). Not
  a tag: a bare name has no value. It is the axis header a table will print,
  and the **gate** every one of its values sits behind.
- **`values`** — a value, *stating which feature it is an option of*. That
  `feature` field is what makes the row a declaration rather than a label: it
  turns "list this language's genders" into a lookup instead of a scan.
- **The gate:** a feature name must be bound in `features` before any of its
  values can be bound in `values`. Violating it produces an
  `unbound-feature` issue.

### Layer 2 — inherence and named combinations

- **`inherent`** — `{category: Tag, feature: string}`, read as *"for this
  category, this feature is inherent"*: a property of the word itself rather
  than of one of its forms. **Both halves are variables and no category is
  privileged** — `VERB × Aspect`, `ADJ × Degree`, `ADP × Conjugation` (Breton
  conjugates its prepositions) are as ordinary as `NOUN × Gender`. The
  `feature` is a **bare name**, matched by name and never by scheme.
- Because `category` is itself a `Tag`, inherence may be declared on a
  *combination*: declaring a declension inherent to `{NOUN, Gender=Fem}`
  rather than to `{NOUN}` is a lexicographic judgement about what a
  contributor is asked first, and it is the language's to make.
- **`bindings`** — a label for a combination of **two or more** atoms:
  French `{NOUN, Gender=Fem}` → `nf.`. A language that prints `n. f.` simply
  binds the two atoms separately and writes **no** row here — decomposition
  renders it. A one-atom row belongs in `pos` or `values`; putting it here
  produces a `single-item-binding` issue.
- **Grounding** is the gate: a named combination must be reachable by removing
  one feature at a time, each removal licensed by an `inherent` declaration,
  down to a bound atom. Otherwise: `ungrounded-combination`.
- Enumerating every combination is a **prompt, never a constraint**. An
  unenumerated combination stays perfectly authorable and renders by
  decomposition.

### Layer 3 — axes

- **`axes`** — `{category: Tag, feature: string, values: string[]}`, read as
  *"for this category, this feature varies across its forms, over these
  values, **in this order**"*. This is the option set for `otherForms`.
- **The row names its values, in order**, rather than inheriting the whole
  inventory, because a language's inventory and one category's paradigm are
  not the same set (three genders in the adjectives, a split masculine in the
  nouns). The order is grammatical order — no grammar prints the accusative
  first — and the alphabetical order of an identifier is not it.
- Keyed exactly as `inherent` (a `Tag` category, a bare feature name), which
  is what makes the conflict between them detectable: the same
  (category, feature) pair declared both ways is an
  `inherent-axis-conflict`. A paradigm cannot be built from a coordinate that
  is also a constant. (`Number` an axis of `{NOUN}` and inherent to
  `{NOUN, Number=Ptan}` is *not* a conflict — different categories.)
- An axis category is checked for **bound atoms only, never grounding**, and
  that is what lets a paradigm be non-rectangular: declare Person an axis of
  `{VERB, VerbForm=Fin}` and simply never declare it for
  `{VERB, VerbForm=Inf}`.
- An axis with no values is an `empty-axis` issue.
- An axis declared on `{NOUN}` applies to an entry categorised
  `{NOUN, Gender=Fem}` — matching walks **sub-bundles**, not exact keys.

### What the AppView does with a malformed grammar

Two very different failures, deliberately:

- **Shape failure** (`isValidGrammar` returns false — a row that is not an
  object, a feature name breaking the pattern, a label with no `long`):
  **the whole record is rejected**, silently. The language keeps its previous
  version.
- **Coherence failure** (`grammarIssues` — `unbound-feature`,
  `unbound-atom`, `duplicate`, `ungrounded-combination`,
  `single-item-binding`, `inherent-axis-conflict`, `empty-axis`): the record
  is **indexed anyway**, and the issues are stored and served on the language
  dashboard as a **repair worklist**. Rejecting would discard a whole
  language's declaration to punish one row, and would make the AppView the
  arbiter of a language's grammar.

So a sloppy bot does not get an error — it gets a dirty dashboard. Run
`grammarIssues()` locally before publishing and treat a non-empty result as a
build failure.

### Rewriting a language record safely

The record is a **full rewrite** and it is *hot* — several bots and humans
accumulate bindings on the same record. Two obligations:

1. **Read before write.** `GET https://leksis.eu/api/languages/:tag/currentRecord`
   returns `{tag, recordURI, cid, authorDID}` — a *reference*, not the content
   — so resolve the `at://` URI against its author's PDS
   (`com.atproto.repo.getRecord`) to get the grammar itself, then merge your
   additions into what is already there. Untouched translations and other
   authors' bindings must survive. The `cid` is your concurrency token:
   re-fetch it immediately before publishing and, if it changed, reload and
   re-merge rather than overwriting. Last-write-wins can now drop a
   *reference*, not merely a label.
2. **The no-orphan rule.** Unbinding an atom orphans every higher row that
   references it, and "unbinding" is invisible — it is just an absence in a
   rewritten object. Run `grammarDiff(previous, next)` from `packages/types`
   and refuse to publish a version whose `introduced` list is non-empty.

## 6. Minting — the triage gate

Minting (an item with `scheme` = the language's BCP 47 tag) is legitimate and
expected. Reaching for it first is how "follow UD and only UD" dies quietly.
Run these **in order** before minting anything:

1. **Is it a grammatical feature at all?** Register, domain, dialect and
   editorial hedges (`arch.`, `fam.`, `vulg.`, `bot.`) are **not**. They stay
   out of the tag system entirely — prose in `notes`. "Masculine but sometimes
   used as feminine" fails here too: a bundle cannot hedge. (True épicène is
   different: that is multivalue `Gender=Fem,Masc`.)
2. **Which altitude?** Lexeme / sense / form. Transitivity is sense-level in
   most dictionaries.
3. **Does UD already express it?** Check across all three tiers of UD
   documentation (universal index; non-universal features with a global page;
   language-specific features in treebank docs) and via UD's own routing
   rules — articles → `DET` + `PronType=Art`; participles → `VerbForm=`;
   "spans the axis" → multivalue. **Check at source.** The assumption that UD
   lacks something is often wrong: `Animacy=Hum` already covers "noun denoting
   a human", and `NounClass` explicitly invites family-specific inventories.
4. **Only then mint**, and record why: a minted row **must** carry
   `references: [{text, url?}]`. UD's extension licence — "UD treebanks may
   use additional features and values if they are properly documented" — is
   conditional on that documentation, so the reference is what makes the
   compatibility claim honest. (A `ud`-scheme item needs none: its
   documentation URL is derivable from the item itself.)

Three granularities of minting, all legal: a new **value** on a UD feature
(`Number=Sgv` for the Breton singulative — UD's `Number` has none); a new
**feature name**; and, reluctantly, a **part of speech**. Inflection classes
(a Latin declension, a French conjugation group) are minted *features* whose
values are minted and bound at layer 1, then declared inherent at layer 2 —
there is no separate "class" concept.

---

# The abbreviation mapping file

**A bot importing a monolingual dictionary must publish that language's
`eu.leksis.language` record, and must keep a local file mapping the source's
own abbreviations to the tags and labels that record binds.**

This is not bookkeeping. It is the only way the two record types can agree:

- the language record's `grammar` needs the source's abbreviations to exist at
  all — a print dictionary's front matter *is* the binding declaration;
- the entry records need the reverse lookup — every `n.` in the source body
  must become the same tag every time, or the abbreviations read model fills
  with near-duplicates nobody can merge.

Generate the `grammar` **from** the map; never hand-write the two in parallel.

## Recommended shape (`abbreviations.map.json`, committed to the scraper repo)

```jsonc
{
  "source": { "title": "…", "url": "…", "license": "…" },
  "languageID": "br",

  // One row per abbreviation AS PRINTED IN THE SOURCE. The key is the source's
  // exact string — that is what the body text will be matched against.
  "labels": {
    "an.": {
      "disposition": "tag",          // tag | prose | content | ignore
      "altitude": "lexeme",          // lexeme | sense | form
      "layer": "pos",                // pos | feature | value | combination
      "tag": { "upos": { "value": "NOUN" } },
      "label": { "long": "anv-kadarn", "short": "an." },
      "why": "UD u/pos/NOUN, checked 2026-08-03"
    },
    "b.": {
      "disposition": "tag", "altitude": "lexeme", "layer": "value",
      "feature": "Gender", "value": "Fem",
      "tag": { "feats": [{ "feature": "Gender", "value": "Fem" }] },
      "label": { "long": "benel", "short": "b." }
    },
    "un.": {
      "disposition": "tag", "altitude": "form", "layer": "value",
      "feature": "Number", "value": "Sgv", "scheme": "br",
      "minted": true,
      "tag": { "feats": [{ "feature": "Number", "value": "Sgv", "scheme": "br" }] },
      "label": { "long": "unanennek", "short": "un." },
      "references": [{ "text": "…grammar citing the singulative…", "url": "…" }],
      "why": "UD Number has no singulative value (checked at source); minted"
    },
    "v.p.": {
      "disposition": "tag", "altitude": "lexeme", "layer": "combination",
      "tag": { "upos": { "value": "VERB" },
               "feats": [{ "feature": "Aspect", "value": "Perf" }] },
      "label": { "long": "verb peurechu", "short": "v.p." }
    },
    "kozh": {
      "disposition": "prose",        // editorial/register label: NOT a category
      "text": "kozh",                // emitted verbatim into the node's `notes`
      "why": "archaic — register, fails triage step 1"
    },
    "sl.": { "disposition": "ignore", "why": "typographic marker, no content" }
  },

  // Layer 2/3 declarations, referencing the label keys above.
  "inherent":     [ { "category": "an.", "feature": "Gender" } ],
  "axes":         [ { "category": "an.", "feature": "Number",
                      "values": ["Sing", "Plur", "Sgv"] } ],
  "combinations": [ { "of": ["an.", "b."], "label": { "long": "anv benel", "short": "anb." } } ]
}
```

The exact schema is the bot's to choose. What must hold:

1. **One row per source abbreviation, keyed by the source's own printed
   string.** Including the ones you decided are *not* tags — a row saying
   `"disposition": "prose"` is a decision recorded, and its absence is a
   decision forgotten.
2. **Every row states its disposition and its altitude.** The same printed
   abbreviation can legitimately appear at two altitudes (`pl.` as a form tag
   in the headword line, `pl.` inside a sense); model that as two rows keyed
   distinctly, never as one row used both ways.
3. **The language record is generated from this file**, in one function, so
   the `grammar` and the entries provably use the same tags.
4. **An abbreviation found in the source body with no row halts the run.** Do
   not guess, do not silently drop. Either add the row, or emit the entry with
   the label as prose in `notes` *and* a `todo` item naming the unmapped
   abbreviation, so a reviewer sees it on the dashboard.
5. **Minted rows carry `references` and a `why`.** The `why` is for the human
   reviewing your import; the `references` are for UD's licence.

## The order of an import run

```
1. Harvest the source's front-matter abbreviation list        → labels
2. Triage each one (§6 gate); write abbreviations.map.json    → human review
3. Generate `grammar` from the map; run grammarIssues() +
   grammarDiff(current, proposed) locally — both must be clean
4. Fetch the language's current record, merge, publish
   eu.leksis.language (rkey = the lowercase tag)
5. Convert entries, resolving every source label through the map
6. Verify (see below); record source-item → rkey in local state
```

Steps 3–4 come **before** step 5 so that by the time an entry lands, its tags
already resolve to labels. Inverting them is not fatal — unbound tags render
verbatim and the dashboard lists them — but it means every entry page in the
language shows raw identifiers until the language record catches up.

---

# The `eu.leksis.entry` lexicon (rkey = TID)

Canonical JSON: `lexicons/eu.leksis.entry.json` in the leksis.eu repo.
The `Tag` shape lives in the shared `lexicons/eu.leksis.defs.json`.

```ts
{
  $type: "eu.leksis.entry",
  languageID: string,        // well-formed BCP 47 tag, LOWERCASE ("br", "br-gw"); max 64 chars
  orthography: string[],     // ≥1 spelling; [0] is the canonical form; each ≤128 graphemes
  transcription?: string,    // IPA ("[ˈbrɛːzɔ̃nɛk]"); ≤128 graphemes; record-only, not indexed
  categories: Tag[],         // LEXEME-level tags, ordered; TAGS ONLY; may be empty
  otherForms?: InflectedForm[], // other grammatical forms; each spelling INDEXED for search
  definitions: Definition[], // ≥1, FLAT list of tree nodes sorted by place (reading order)
  notes?: string[],          // entry-level free-text prose shown below the definitions
  references?: Reference[],  // bibliographic references, shown at the bottom
  subject?: string,          // at:// URI of the version this modifies; omit for new entries
  todo?: string[],           // pending-work notes, ONE ITEM PER TASK; ≤64 items, ≤1024 graphemes
  deleted?: boolean,         // withdraw this entry from search (requires deletionReason)
  deletionReason?: string,   // why it was withdrawn; ≤1024 graphemes
  redirectTo?: string,       // when the reason is a duplicate: the correct entry's entryKey
  createdAt: string,         // ISO datetime
}

Tag = { upos?: { value: string, scheme?: string },
        feats?: { feature: string, value: string, scheme?: string }[] }
// See "The grammar layer" above. A bundle of an optional part of speech and any
// number of Feature=Value items, at least one present. It carries NO
// reader-facing text. `scheme` is per item: absent = UD-documented, otherwise
// the BCP 47 tag of the minting language.

Definition = {
  place: number[],           // tree address, 1–3 non-negative ints (see below)
  categories?: Tag[],        // SENSE-level tags of this node (e.g. transitivity)
  notes?: string[],          // free-text prose shown before the node's content
  text?: string,             // ≤2048 graphemes; REQUIRED on a leaf, FORBIDDEN on a group node
}

InflectedForm = { tag: Tag, form: string }
// ONE tag — the form's address in the paradigm: "gen. pl." is one coordinate in
// two dimensions, so it is one bundle carrying Case=Gen AND Number=Plur, not two
// tags. The values are normally the ones the language declares as `axes` of the
// entry's category, but nothing enforces it: an axis declaration is a menu, never
// a whitelist, and a form matching no declared axis simply stays in the flat list.
// Each `form` is added to the entry's search index, so an inflected form leads
// back to the entry.

Reference = { text: string, url?: string }  // text ≤256 graphemes; url ≤2048 chars
```

**There is no `annotations` field, at any level.** A record still carrying one
is *not* rejected — a lexicon-unknown field is ignored, which is how AT Proto
records stay extensible — but the field is dropped and its content is lost.

### `place` — definitions as a tree

`definitions` is a flat list of **tree nodes**; each node's `place` is its
address (up to 3 dimensions). The **last index is the node type**:

- **non-zero → a leaf** — the definition proper: it MUST carry non-empty `text`.
- **0 → a group node** — a heading that carries `categories`/`notes` but MUST
  NOT carry `text` (e.g. state the "transitive" tag once at `[1,0,0]` = A., and
  every sense under it inherits it without repeating).

A non-last `0` means "no grouping at that dimension", so a place renders
shallower than its length: `[0,1,1]` = I. 1., and `[1]` = `[0,1]` = `[0,0,1]`
= 1. Display: each non-zero index `n` shows as the n-th label of its dimension
(1 → A/I/1, 2 → B/II/2) and each `0` is skipped; the scheme follows the
displayed depth — 1 → `1.`; 2 → `I. 1.`; 3 → `A. I. 1.` (so `[1,2,0]` = A. II.,
`[1,1,1]` = A. I. 1.).

**Bare grouping is implicit:** a group node appears in the list ONLY when it
carries tags or notes. If a group carries neither, omit it — the AppView infers
the hierarchy from the leaves. So a simple two-level entry is just leaves at
`[0,1,1]`, `[0,1,2]`… (I. 1., I. 2.) with no group item; add a `[0,1,0]`
(= I., last index 0) only to annotate that heading.

**Whole-tree invariants — the AppView rejects the record if any fails:**

1. Leaf ⇒ non-empty `text`; group node ⇒ no `text`.
2. Sorted in strict reading order (lexicographic on place), no duplicates.
3. Sibling indices contiguous from 1 (no gaps).
4. At least one leaf.

The reference validator is `validateDefinitions()` in
`packages/types/src/entry.ts` of the leksis.eu repo (returns `"ok"` or a rule
code: `order` / `structure` / `text-rule` / `empty`) — copy it into the scraper
and run it on every record before publishing. A single flat list of leaves
`[1], [2], [3]…` is always valid; only build hierarchy when the source
genuinely has one.

### `todo` — the bot maintenance flag

**`todo`** is a list of pending-work notes, **one item per task** — e.g.
`["conversion unverified", "abbreviation 'stn.' unmapped"]` — so several bots
(or a bot and a human) can each track their own item on the same entry. Omit
it entirely when nothing is pending: the AppView indexes only whether any
non-empty item exists, as a boolean flag, so whitespace-only or boilerplate
items pollute the needs-attention pool. Reviewers see the items on the entry
page and each language's dashboard lists the flagged entries; clearing a task
= publishing a new version without its item (an empty/absent list marks the
entry complete).

### Withdrawing an entry

Publishing a version with `deleted: true` requires a non-empty
`deletionReason`; a bare `deleted: true` rejects the record. The version still
has to carry `orthography` / `categories` / `definitions` (the lexicon
requires them — carry the previous version's content forward), but the AppView
empties its search index, so the entry stops appearing in results while
staying reachable at `/entry/<entryKey>`. Add `redirectTo: "<entryKey>"` when
the reason is a duplicate.

### What the AppView checks at ingest

Any failure rejects the **whole record**, silently
(`apps/api/src/firehose/ingest-entry.ts`):

- `languageID` — a string, normalised to lowercase, well-formed BCP 47
  **syntax** (no registry lookup);
- `orthography` — a non-empty array of non-empty strings;
- `categories` and every definition node's `categories` — arrays of
  well-formed `Tag`s. **Shape only** — vocabulary is never judged, so a minted
  tag is fine and a tag no language has bound is fine;
- `otherForms` — each item a well-formed `Tag` under `tag` **plus** a non-empty
  `form`. A form written to the pre-v0.9 `{annotation: {short, long}}` shape
  has no `tag` and **rejects the record**;
- `definitions` — a non-empty array passing the whole-tree invariants above;
- `notes` / definition `notes` — arrays of strings;
- `references` — array of `{text (non-empty string), url?: string}`;
- `todo` — an array of strings; `transcription` — a string;
- `subject` — a string starting with `at://`;
- `deleted` — a boolean, and `deletionReason` non-empty when it is true;
  `redirectTo` — a string.

Indexed from all of that: `orthography`, the lowercased search index
(orthographies **+ otherForms spellings**), the record reference, the `todo`
boolean, the deletion fields, and the version's **distinct tags at all three
altitudes**. Everything else stays on the record.

For `eu.leksis.language` (`ingest-language.ts`): a well-formed lowercase tag,
a non-empty `translations` array of `{languageID (valid BCP 47), translation
(non-empty)}`, **the endonym present** (an item whose `languageID` equals the
record's `tag`), and — when present — a `grammar` passing `isValidGrammar`.
Grammar *issues* do not reject (see above).

### Mapping a source into the shape — conventions

- **One entry record per headword sense-block** as the source structures it;
  spelling variants of the same word go into `orthography`, not separate
  entries. Distinct homonyms (separate entries in the source) → separate
  records.
- `languageID` is the language **being defined**; definition text is normally
  written in that same language for a monolingual source. Normalize the tag
  to lowercase and validate BCP 47 syntax (syntax only — like the AppView).
- **Source labels become tags via the mapping file**, never free text in
  `categories`. A label that failed the triage gate goes into `notes` as
  prose, at whichever altitude the source printed it (entry-level `notes` for a
  headword label, the definition node's `notes` for a sense-level one).
- **Put a form's whole address in one bundle.** `gen. pl.` is
  `{feats:[{feature:"Case",value:"Gen"},{feature:"Number",value:"Plur"}]}` —
  one `otherForms` item, not two.
- `createdAt` = time of scraping/publication (it's client-declared version
  time, not the source's publication date).
- **Attribution & licensing:** only ingest sources whose license permits it,
  and make the bot account's profile state the source and license. Per-record
  provenance (source URL / citation) goes in `references` when it is worth
  showing to readers; the bot's own source-item → rkey mapping lives in its
  local state file.
- **Don't invent extra fields** — lexicon-unknown fields are dropped.

## Migrating from the pre-v0.9 shape

Layer 3 (ADR-0008, `v0.9.0`) broke the entry lexicon. If a bot was written
against the earlier shape:

| before | now |
|---|---|
| `categories: Annotation[]` (`{long, short}`) | `categories: Tag[]` |
| entry-level `annotations: Annotation[]` | **removed** → prose in `notes`, or a minted+bound feature |
| definition-node `annotations` | **removed** → the node's `categories` (tags) or `notes` (prose) |
| `otherForms[].annotation` | `otherForms[].tag` — one `Tag` bundle |
| labels harvested from entries | labels **bound on the language record**; entries supply usage only |

An old-shape `otherForms` **rejects the record**; the removed `annotations`
fields are ignored rather than rejected, so an un-migrated bot fails quietly
by losing content. Reset and republish: delete the old records, regenerate
from source + the mapping file. Pre-1.0 this is the sanctioned migration path
and it is cheap — take the correct shape rather than a compatible one.

---

# Verifying an ingestion run

1. **On the PDS:** `com.atproto.repo.listRecords` (repo = bot DID,
   collection = `eu.leksis.entry` / `eu.leksis.language`) shows what was
   written.
2. **In the index** (after relay/Jetstream propagation, usually seconds):
   - `GET https://leksis.eu/api/languages` — your language is listed;
   - `GET https://leksis.eu/api/languages/<tag>/dashboard` — entry counter,
     todo queue, activity feed, and **`grammarIssues`: this must be empty**;
   - `GET https://leksis.eu/api/languages/<tag>/abbreviations` — every label
     your language record bound, each with a usage `count` (zero is normal for
     a label declared before use) and `conflictsWith`; plus every tag your
     entries use that **nothing has named**, which appear as rows with a
     `count` and **no `long`**. That list is the direct measure of how much of
     your source's abbreviation list you actually bound;
   - `GET https://leksis.eu/api/entries?q=<orthography>&l=<languageID>` —
     the entry is searchable. **Note the search is prefix-based and an empty
     `q` returns nothing**: there is no "list all entries" endpoint;
   - `GET https://leksis.eu/api/entries/<entryKey>` — its view.
3. **In the app:** search on leksis.eu; the entry page (`/entry/<key>`)
   resolves the record content from the PDS — this exercises the full path,
   including tag rendering (a chip styled as unbound is a tag you did not
   bind). The language dashboard (`/language/<tag>`) shows the counters, the
   grammar repair worklist, the abbreviations with conflicts, and the todo
   queue your records feed.

If records are on the PDS but never appear in the index, they failed AppView
validation (check the invariants) or the PDS isn't being crawled — surface
that to Alan rather than re-publishing.

---

# Canonical sources (in the leksis.eu repo — resync this skill from them)

- `lexicons/eu.leksis.entry.json`, `lexicons/eu.leksis.language.json`,
  `lexicons/eu.leksis.defs.json` — record shapes (`defs` holds the shared `Tag`)
- `packages/types/src/tag.ts` — `Tag`, `tagKey`, the UD patterns, `parseTagInput`
- `packages/types/src/grammar.ts` — the `grammar` contract, `grammarIssues`,
  `grammarDiff`, `resolveTag`, `applicableAxes` (copy these)
- `packages/types/src/upos.ts` — the 17 UPOS, the 14 headword-eligible ones,
  and the derivable UD documentation URLs
- `packages/types/src/entry.ts` — TS contract + `validateDefinitions` (copy it)
- `packages/types/src/bcp47.ts` — BCP 47 syntax validator
- `apps/api/src/firehose/ingest-entry.ts`, `ingest-language.ts` — exactly what
  the AppView accepts
- `docs/design/grammatical-tagging.md` — the design note (layers, triage gate,
  rendering precedence); `docs/adr/0006-*`, `0007-*`, `0008-*` — the shipped
  decisions, authoritative over the design note for their layer
- `docker-compose.yml` + `.env.example` — PDS deployment & account-creation gating
