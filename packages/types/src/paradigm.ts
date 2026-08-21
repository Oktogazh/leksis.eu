// Contract for the eu.leksis.paradigm lexicon (lexicons/eu.leksis.paradigm.json)
// and the generator that runs its rules — the morphology arc's layer 5. Types
// are the contract: the lexicon JSON, these shapes and the ArangoDB `paradigms`
// collection move together.
//
// A paradigm is one language's recipe for the forms of one category of words.
// It is a record of its own rather than another sub-object on the language
// record because rules are large, written per inflection class, and edited at a
// different cadence than the tag bindings they address (settled at layer 2).
//
// Two properties of this file matter more than its shapes.
//
// **The generator is one pure function, and it lives here** (morphology
// invariant 6): the AppView's expansion job, the entry page and the layer-6
// exporters all call `generateForms`, so what a reader sees, what search
// indexes and what a Hunspell dictionary exports cannot disagree. It is
// therefore deterministic and **total** — a malformed condition makes a rule
// not apply, never throws, because the same call runs inside the firehose
// consumer's single sequential writer and inside a reader's browser.
//
// **Generation never touches an entry record** (invariant 5): an entry carries
// its category and its irregular forms, a paradigm carries the rules, and the
// two meet only in the AppView's index and in the viewer. Fixing a wrong rule
// re-renders a language without anybody republishing anything.
//
// See docs/design/paradigm-rules.md for the reasoning, ADR-0009 for the cell
// space these rules fill, and ADR-0015 for the ingest gate they extend.

import { isValidLanguageTag } from "./bcp47.js";
import type { EntryInflectedForm } from "./entry.js";
import {
  coordsMatchKey,
  featsMatchKey,
  isValidLayoutCoord,
  type GrammarLabel,
  type GrammarReference,
  type LayoutCoord,
} from "./grammar.js";
import { formatTagVerbatim, isValidTag, tagKey, type Tag } from "./tag.js";

/** AT Proto collection NSID for paradigm records. */
export const LEKSIS_PARADIGM_COLLECTION = "eu.leksis.paradigm";

/**
 * The maximum length of every array a paradigm record holds, mirroring the
 * `maxLength` each one declares in `lexicons/eu.leksis.paradigm.json`, plus the
 * one string length this layer enforces.
 *
 * The array caps are the ADR-0015 rule as usual — a record past one of them is
 * not a record of this lexicon, so no editor could have written it and ingest
 * refuses it. `match` is the deliberate exception to that ADR's *other* half,
 * which leaves string caps unenforced: a definition one grapheme too long still
 * renders, but a `match` pattern is compiled and run, so its length is a bound
 * on work the generator does rather than a point about counting characters.
 * (The lexicon counts UTF-8 bytes there and this counts UTF-16 units; they are
 * two guards with two purposes, and neither is trying to be the other.)
 */
export const PARADIGM_LIMITS = {
  rules: 512,
  requires: 16,
  /** Coordinates of one cell address (`coords`, `base`). */
  coords: 16,
  notes: 16,
  references: 16,
  /** Characters of one rule's `match` pattern. */
  match: 512,
} as const;

/**
 * A literal exchange at the front of a form — what to remove, what to put in
 * its place. Either half may be absent.
 *
 * It exists for the augments and initial mutations a suffix pair cannot
 * express. Note what it deliberately does *not* carry: a condition of its own.
 * A rule's `match` tests the **end** of the base, following Hunspell's suffix
 * condition, so a mutation whose trigger is the word's first letter cannot yet
 * be conditioned on it. Design note §7.4 holds that open on purpose — the rule
 * algebra grows when a real language's paradigm cannot be written, not before,
 * and this record shape can grow additively when it does.
 */
export interface ParadigmAffix {
  strip?: string;
  add?: string;
}

/**
 * A base form the rules need beyond the lemma: the cell an entry must have
 * filled in itself, and what a contributor is told when it has not.
 *
 * Many languages cannot generate a paradigm from the citation form alone — a
 * Latin noun needs its genitive, a strong Germanic verb its preterite — and
 * this is where a paradigm says so, rather than generating something wrong.
 *
 * `message` is written **in the rule** because the person who wrote the rule is
 * a speaker of the language: that is what lets the dashboard's missing-forms
 * queue be homolingual with no translation layer anywhere in the AppView.
 */
export interface ParadigmRequirement {
  coords: LayoutCoord[];
  message: string;
}

/**
 * One generation rule: which cell it fills, which form it starts from, the
 * condition that form must satisfy, and the affixes to exchange.
 *
 * Several rules may target one cell with different conditions — the ordinary
 * Hunspell shape, `-y → -ies` beside `-s` — and the **first matching row in
 * author order wins** it. A row with no condition and no affixes is legitimate:
 * it means the cell is identical to its base.
 */
export interface ParadigmRule {
  /**
   * The cell this rule fills. A coordinate carrying several comma-separated
   * values (`Gender=Fem,Masc`) spans every cell it names with **one** form:
   * that is how syncretism is written, and it is deliberately not a wildcard,
   * because a form covering an axis and a form nobody has entered must not look
   * the same to a reader.
   */
  coords: LayoutCoord[];
  /**
   * The form this rule transforms. Absent means the lemma, which is the
   * ordinary case. Otherwise it addresses another cell — one the entry supplies
   * (a `requires` row) or one an earlier rule generates, so a paradigm can build
   * a stem once and inflect it many times.
   */
  base?: LayoutCoord[];
  /**
   * A regular expression the **end** of the base must satisfy. Anchored by the
   * generator, so it carries no trailing `$` of its own.
   */
  match?: string;
  /** A literal ending removed from the base before `add`. */
  strip?: string;
  /** A literal ending appended after the strip. */
  add?: string;
  /** The same exchange at the front of the form; applied together with the suffix pair. */
  prefix?: ParadigmAffix;
}

/**
 * The eu.leksis.paradigm record as written to a user's PDS.
 *
 * The record key is `{languageID}-{16 hex characters}` over the canonical key of
 * `selector` (`paradigmRkey`), which is checked at ingest the way a source's
 * OCLC key is. Identity therefore comes from the key: every author's paradigm
 * for one category shares one, and `selector` is immutable for a given
 * identity — changing the category is publishing a *different* paradigm.
 */
export interface LeksisParadigmRecord {
  $type: typeof LEKSIS_PARADIGM_COLLECTION;
  /** Well-formed BCP 47 tag, lowercase. */
  languageID: string;
  /**
   * The category these rules apply to: a **full headword bundle** over what the
   * language declared — its part of speech, its inherent features, and the
   * default axis value where the category names one.
   *
   * Matched against an entry by **exact match** on that bundle since ADR-0019,
   * not by containment: `{VERB}` reaches only entries whose headword bundle is
   * literally a bare verb, and `{VERB, Conjugation=2}` is a different paradigm
   * rather than a more specific one. Two paradigms can therefore never both
   * reach one entry, which is what retired the most-specific-wins machinery.
   */
  selector: Tag;
  /** Homolingual name of the paradigm ("first declension"). */
  label?: GrammarLabel;
  requires?: ParadigmRequirement[];
  rules: ParadigmRule[];
  notes?: string[];
  references?: GrammarReference[];
  /** at:// URI of the version this rewrites — an audit trail; identity is the key. */
  subject?: string;
  createdAt: string;
}

/**
 * The canonical key of a paradigm's selector: the string two paradigms are the
 * same paradigm on. Nothing but `tagKey`, named so that every caller of the
 * identity scheme reads as one thing rather than as an incidental use of a tag
 * helper.
 */
export function paradigmSelectorKey(selector: Tag): string {
  return tagKey(selector);
}

/*
 * FNV-1a, 64-bit, over UTF-16 code units — the whole hash, deliberately.
 *
 * Two constraints picked it. It must be **synchronous**, because the editor
 * computes a record key while building the record and WebCrypto's digest is a
 * promise; and it must be **one implementation**, because the browser minting
 * the key and the AppView recomputing it have to agree forever — a second
 * implementation is a second chance to disagree. So it lives here, in the
 * package both import, rather than being node's `createHash` on one side and
 * something else on the other.
 *
 * It is **not cryptographic and does not need to be**. A crafted collision
 * would let one record claim another selector's identity — which buys an
 * attacker nothing, since paradigms are last-write-wins across authors and
 * anybody may publish a paradigm for a selector directly. Honest collisions are
 * the real risk, and a language has tens of paradigms against 2^64 keys.
 *
 * Code units rather than bytes because a canonical tag key is ASCII by
 * construction (UD's feature-name and value grammars, and BCP 47 schemes, admit
 * nothing else), so the two agree — and where they would not, code units are
 * still deterministic in every JS runtime, which is the property that matters.
 */
const FNV64_OFFSET = 0xcbf29ce484222325n;
const FNV64_PRIME = 0x100000001b3n;
const FNV64_MASK = 0xffffffffffffffffn;

/** 16 hex characters of a 64-bit FNV-1a hash — the identity half of an rkey. */
export function paradigmHash(input: string): string {
  let hash = FNV64_OFFSET;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash ^ BigInt(input.charCodeAt(i))) * FNV64_PRIME) & FNV64_MASK;
  }
  return hash.toString(16).padStart(16, "0");
}

/**
 * The record key a paradigm must be filed under: `{languageID}-{hash16}` over
 * the canonical key of its selector.
 *
 * **Derived from the record's own fields**, which is the whole point: the
 * editor computes it before publishing and ingest recomputes it and refuses a
 * mismatch, so every author's paradigm for "Breton, `{VERB}`" lands on one
 * identity by construction and no repository can hold two paradigms for one
 * category. The `sources` precedent, with a hash standing in for the OCLC
 * number because a category has no catalogue.
 *
 * The language tag is lowercased here — it is part of an identity, and `br` and
 * `BR` are one language.
 */
export function paradigmRkey(
  record: Pick<LeksisParadigmRecord, "languageID" | "selector">,
): string {
  return `${record.languageID.toLowerCase()}-${paradigmHash(paradigmSelectorKey(record.selector))}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidAffixString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isValidCoords(value: unknown, { required }: { required: boolean }): boolean {
  if (!Array.isArray(value)) return false;
  if (value.length > PARADIGM_LIMITS.coords) return false;
  if (required && value.length === 0) return false;
  return value.every(isValidLayoutCoord);
}

function isValidLabel(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isPlainObject(value)) return false;
  if (typeof value.long !== "string") return false;
  return value.short === undefined || typeof value.short === "string";
}

function isValidReferences(value: unknown): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > PARADIGM_LIMITS.references) return false;
  return value.every(
    (row) =>
      isPlainObject(row) &&
      typeof row.text === "string" &&
      (row.url === undefined || typeof row.url === "string"),
  );
}

/**
 * Whether an unknown value is a well-formed paradigm record — **shape and
 * cardinality**, never vocabulary and never coherence.
 *
 * The split is the language record's: this function describes a record that
 * cannot be *read*, `paradigmIssues` a record that contradicts itself. Both
 * refuse it at ingest (ADR-0015); keeping them apart is what lets the log and
 * the editor name the defect instead of saying that something, somewhere, could
 * not be parsed.
 *
 * Two checks are deliberately absent. The **record key** is not compared with
 * `paradigmRkey` here, because only ingest can see the key a record was filed
 * under — the `validateSource` precedent exactly. And `selector` is not checked
 * against anything the language declared: a paradigm naming a category no
 * grammar has bound contradicts *another record*, not itself, so it is indexed
 * and simply matches no entry (design note §4).
 */
export function isValidParadigmRecord(value: unknown): value is LeksisParadigmRecord {
  if (!isPlainObject(value)) return false;

  // Case is not enforced, only well-formedness: ingest lowercases what it
  // stores, and refusing "BR" would discard a paradigm to make a point about
  // capitalization.
  if (typeof value.languageID !== "string" || !isValidLanguageTag(value.languageID)) return false;
  if (!isValidTag(value.selector)) return false;
  if (!isValidLabel(value.label)) return false;
  if (!isValidReferences(value.references)) return false;

  if (value.notes !== undefined) {
    if (!Array.isArray(value.notes) || value.notes.length > PARADIGM_LIMITS.notes) return false;
    if (!value.notes.every((note) => typeof note === "string")) return false;
  }

  // An empty `message` is well-formed and merely useless, so it is
  // `paradigmIssues`' to report rather than this function's to refuse.
  if (value.requires !== undefined) {
    if (!Array.isArray(value.requires) || value.requires.length > PARADIGM_LIMITS.requires) {
      return false;
    }
    for (const row of value.requires) {
      if (!isPlainObject(row)) return false;
      if (!isValidCoords(row.coords, { required: true })) return false;
      if (typeof row.message !== "string") return false;
    }
  }

  // `rules` is the record: an empty array is a paradigm that generates nothing,
  // which `paradigmIssues` reports as a contradiction rather than a parse
  // failure — but a missing array is not a record of this lexicon at all.
  if (!Array.isArray(value.rules) || value.rules.length > PARADIGM_LIMITS.rules) return false;
  for (const row of value.rules) {
    if (!isPlainObject(row)) return false;
    if (!isValidCoords(row.coords, { required: true })) return false;
    if (row.base !== undefined && !isValidCoords(row.base, { required: true })) return false;
    if (row.match !== undefined) {
      if (typeof row.match !== "string" || row.match.length > PARADIGM_LIMITS.match) return false;
    }
    if (!isValidAffixString(row.strip) || !isValidAffixString(row.add)) return false;
    if (row.prefix !== undefined) {
      if (!isPlainObject(row.prefix)) return false;
      if (!isValidAffixString(row.prefix.strip) || !isValidAffixString(row.prefix.add)) {
        return false;
      }
    }
  }

  if (typeof value.createdAt !== "string") return false;
  if (value.subject !== undefined && typeof value.subject !== "string") return false;
  return true;
}

/**
 * A defect *inside* one paradigm record.
 *
 * The kinds, and why each is a contradiction rather than a disagreement:
 *
 * - `empty-rules` — a generation recipe that generates nothing. The `empty-axis`
 *   twin: well-formed, and says nothing at all.
 * - `unknown-base` — a rule starting from a form the record never arranges to
 *   have. A base chain must ground in the lemma or in a `requires` row, or the
 *   rule can only ever be skipped.
 * - `base-cycle` — a chain of bases that returns to itself, which no order of
 *   evaluation resolves.
 * - `invalid-match` — a condition that does not compile. It is refused rather
 *   than ignored because the generator must never throw, and a rule whose
 *   condition cannot be read is not the rule its author wrote.
 * - `empty-message` — a `requires` row whose error text is blank: the row exists
 *   to tell a contributor what to add, and an error nobody can read contradicts
 *   its own purpose.
 *
 * A rule row's identity is its **position**: several rows may legitimately
 * target one cell, and the order is what decides between them, so `key` is
 * `rule#3` / `requires#1` rather than a canonical row key. `address` carries the
 * offending coordinates in UD's notation, for the ingest log and the editor's
 * footer.
 */
export interface ParadigmIssue {
  kind: "empty-rules" | "unknown-base" | "base-cycle" | "invalid-match" | "empty-message";
  /** Position of the offending row: `rule#<i>`, `requires#<i>`, or `rules`. */
  key: string;
  /** The row's own address, written the way UD writes a bundle. */
  address?: string;
  /** The base address at fault, on a base issue. */
  base?: string;
}

/** Coordinates written the way UD writes a bundle — for a log line or a footer. */
function formatCoords(coords: readonly LayoutCoord[]): string {
  return formatTagVerbatim({ feats: coords.map((c) => ({ feature: c.feature, value: c.value })) });
}

/** Whether a `match` pattern compiles — the generator's own test, run early. */
function compilesAsMatch(pattern: string): boolean {
  return compileMatch(pattern) !== null;
}

/**
 * Every defect in a paradigm. **Empty is the condition for publishing one and
 * the condition for indexing one — the same condition, checked twice**, exactly
 * as `grammarIssues` is (ADR-0015).
 *
 * Vocabulary is never judged here, and neither is anything the *language*
 * record says: a selector or a coordinate nobody declared is a contradiction
 * between two records, which ADR-0015 indexes and contests rather than refuses.
 * Refusing it would also create an ingest-order dependency, since a paradigm may
 * arrive before the grammar it addresses. Such a paradigm is simply inert — it
 * matches no entry, or addresses no cell.
 *
 * Callers want the list rather than a boolean: one to log which rows were
 * refused, the other to name them to the contributor.
 */
export function paradigmIssues(
  paradigm: Pick<LeksisParadigmRecord, "rules"> & Partial<Pick<LeksisParadigmRecord, "requires">>,
): ParadigmIssue[] {
  const issues: ParadigmIssue[] = [];
  const requires = paradigm.requires ?? [];
  const rules = paradigm.rules ?? [];

  requires.forEach((row, index) => {
    if (row.message.trim() === "") {
      issues.push({
        kind: "empty-message",
        key: `requires#${index}`,
        address: formatCoords(row.coords),
      });
    }
  });

  if (rules.length === 0) {
    issues.push({ kind: "empty-rules", key: "rules" });
    return issues;
  }

  const suppliedKeys = new Set(requires.map((row) => coordsMatchKey(row.coords)));
  const targetKeys = new Set(rules.map((row) => coordsMatchKey(row.coords)));

  // Which cells each cell's rules start from — the graph a cycle would live in.
  // Keyed by target rather than by row because a cell reachable through any of
  // its rows is reachable, and it is the *cells* that loop.
  const basesOf = new Map<string, Set<string>>();
  for (const row of rules) {
    if (row.base === undefined) continue;
    const baseKey = coordsMatchKey(row.base);
    if (!targetKeys.has(baseKey)) continue; // an asserted or unknown base ends the chain
    const target = coordsMatchKey(row.coords);
    const set = basesOf.get(target);
    if (set === undefined) basesOf.set(target, new Set([baseKey]));
    else set.add(baseKey);
  }

  /** Whether following bases from `from` ever reaches `goal`. */
  const reaches = (from: string, goal: string, seen: Set<string>): boolean => {
    if (from === goal) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    for (const next of basesOf.get(from) ?? []) {
      if (reaches(next, goal, seen)) return true;
    }
    return false;
  };

  rules.forEach((row, index) => {
    const key = `rule#${index}`;
    if (row.match !== undefined && row.match !== "" && !compilesAsMatch(row.match)) {
      issues.push({ kind: "invalid-match", key, address: formatCoords(row.coords) });
    }
    if (row.base === undefined) return;
    const baseKey = coordsMatchKey(row.base);
    if (!suppliedKeys.has(baseKey) && !targetKeys.has(baseKey)) {
      issues.push({
        kind: "unknown-base",
        key,
        address: formatCoords(row.coords),
        base: formatCoords(row.base),
      });
      return;
    }
    if (targetKeys.has(baseKey) && reaches(baseKey, coordsMatchKey(row.coords), new Set())) {
      issues.push({
        kind: "base-cycle",
        key,
        address: formatCoords(row.coords),
        base: formatCoords(row.base),
      });
    }
  });

  return issues;
}

/**
 * What the generator needs to know about one entry: its lemma, and the forms it
 * asserts itself.
 *
 * The asserted forms are the entry's own `otherForms` — what `requires`
 * resolves against, and (at display time, not here) what overrides a generated
 * cell. Deliberately the record's shape rather than the index's: whatever the
 * AppView caches for search, the thing a rule reasons about is a tagged form.
 */
export interface ParadigmEntryFacts {
  /** The entry's canonical orthography — the implicit base of every rule. */
  lemma: string;
  forms: readonly EntryInflectedForm[];
}

/** One form the rules produced, and the cell it fills. */
export interface GeneratedForm {
  form: string;
  /**
   * The cell address, bare — re-qualify with `coordTag` before showing it, as
   * everything else addressing a cell does.
   */
  coords: LayoutCoord[];
  /** Scheme-blind join key of `coords`: what `placeForms` matches a cell on. */
  key: string;
  /** Index of the rule row that produced it, for a preview that explains itself. */
  rule: number;
}

/** A base form the paradigm needs and the entry has not supplied. */
export interface MissingBaseForm {
  /** Join key of the required address. */
  key: string;
  /** The address, written the way UD writes a bundle. */
  address: string;
  /** The rule author's own words, in the language — shown as-is. */
  message: string;
}

/**
 * What running a paradigm over one entry produced.
 *
 * `missing` non-empty means the paradigm was **skipped entirely** for this
 * entry, and `forms` is empty: a paradigm missing a principal part would
 * otherwise generate a plausible, wrong half-table, which is worse for a
 * dictionary than an empty one. The AppView records these on the entry so the
 * language dashboard can list the entries a contributor needs to complete.
 */
export interface ParadigmGeneration {
  forms: GeneratedForm[];
  missing: MissingBaseForm[];
}

/**
 * Compiled `match` patterns, bounded.
 *
 * The expansion job runs one paradigm over every entry of a language, so
 * recompiling each row's condition per entry is the one hot path this file has.
 * The cache is dropped wholesale when it grows past the bound rather than
 * evicted one by one: it is a memo of pure compilations, so losing it costs
 * nothing but the next compile.
 */
const MATCH_CACHE_LIMIT = 1024;
const matchCache = new Map<string, RegExp | null>();

function compileMatch(pattern: string): RegExp | null {
  if (pattern.length > PARADIGM_LIMITS.match) return null;
  const cached = matchCache.get(pattern);
  if (cached !== undefined) return cached;
  let compiled: RegExp | null = null;
  try {
    // Grouped before anchoring: `a|b` conditions an alternation on the whole
    // ending, where `a|b$` would condition it on "a anywhere, or b at the end".
    compiled = new RegExp(`(?:${pattern})$`);
  } catch {
    compiled = null;
  }
  if (matchCache.size >= MATCH_CACHE_LIMIT) matchCache.clear();
  matchCache.set(pattern, compiled);
  return compiled;
}

/**
 * Apply one rule to one base string, or decline.
 *
 * Declining is the normal outcome, not a failure: a rule whose condition does
 * not match, or whose `strip` is not there to remove, is simply not this
 * lemma's rule, and another row may be. A rule that would produce an empty
 * string declines too — no cell is better than a blank one.
 */
function applyRule(rule: ParadigmRule, base: string): string | undefined {
  if (rule.match !== undefined && rule.match !== "") {
    const condition = compileMatch(rule.match);
    if (condition === null || !condition.test(base)) return undefined;
  }
  const suffix = rule.strip ?? "";
  const prefix = rule.prefix?.strip ?? "";
  if (suffix !== "" && !base.endsWith(suffix)) return undefined;
  if (prefix !== "" && !base.startsWith(prefix)) return undefined;
  // Both ends are removed from one string, so a word shorter than the two of
  // them together satisfies each test and neither.
  if (prefix.length + suffix.length > base.length) return undefined;
  const core = base.slice(prefix.length, base.length - suffix.length);
  const generated = `${rule.prefix?.add ?? ""}${core}${rule.add ?? ""}`;
  return generated === "" ? undefined : generated;
}

/**
 * The asserted form at an address: exact match first, then the closest form
 * carrying more than the address asks for.
 *
 * The containment half is `placeForms`' rule read from the other side — a form
 * tagged `NOUN|Case=Gen|Number=Sing` answers a requirement for `Case=Gen`,
 * because the part of speech and the number are more than the address, not
 * something else. "Closest" is the fewest extra items, and an exact tie goes to
 * the entry's own order, so the choice never depends on anything but the record.
 */
function assertedForm(
  coords: readonly LayoutCoord[],
  forms: readonly EntryInflectedForm[],
): string | undefined {
  const wanted = coordsMatchKey(coords);
  const atoms = coords.map((coord) => coordsMatchKey([coord]));
  let best: EntryInflectedForm | undefined;
  let bestSize = Number.POSITIVE_INFINITY;

  for (const form of forms) {
    const feats = form.tag.feats ?? [];
    if (coordsMatchKey(feats) === wanted) return form.form;
    const held = new Set(feats.map((feat) => coordsMatchKey([feat])));
    if (!atoms.every((atom) => held.has(atom))) continue;
    if (feats.length < bestSize) {
      best = form;
      bestSize = feats.length;
    }
  }
  return best?.form;
}

/**
 * Run a paradigm's rules over one entry: the layer-5 generator, and the one
 * place inflected forms are derived (invariant 6).
 *
 * The order of business:
 *
 * 1. **Required base forms first.** Any one of them missing skips the paradigm
 *    for this entry and returns those rows' own messages, unaltered.
 * 2. **Rules in author order**, one cell each. The first row whose condition
 *    matches a cell wins it; a cell no row matches is simply not generated,
 *    which is an empty cell and not an error.
 * 3. **Bases resolve on demand.** A rule starting from another rule's target
 *    generates that target first, so a paradigm can build a stem once and
 *    inflect it many times. Chains are memoised, and a cycle yields nothing
 *    rather than recursing — `paradigmIssues` refuses such a record, and this
 *    function still has to be total when handed a draft that has not been
 *    through it.
 *
 * **Syncretism is expressed, not expanded**: a rule targeting
 * `Gender=Fem,Masc` produces **one** form whose address spans both cells,
 * because the table merges those cells under a spanning header rather than
 * printing the form twice — and because a form covering an axis must not be
 * indistinguishable from two forms that happen to agree.
 *
 * Nothing here reads the language record: a bare address is all a rule needs,
 * and `coordsMatchKey` is the same join key a resolved layout computes with the
 * grammar in hand.
 */
export function generateForms(
  paradigm: Pick<LeksisParadigmRecord, "rules"> & Partial<Pick<LeksisParadigmRecord, "requires">>,
  facts: ParadigmEntryFacts,
): ParadigmGeneration {
  const rules = paradigm.rules ?? [];
  const missing: MissingBaseForm[] = [];
  /** Address key → the entry's own form there. */
  const supplied = new Map<string, string>();

  for (const row of paradigm.requires ?? []) {
    const key = coordsMatchKey(row.coords);
    const form = assertedForm(row.coords, facts.forms);
    if (form === undefined) {
      missing.push({ key, address: formatCoords(row.coords), message: row.message });
      continue;
    }
    supplied.set(key, form);
  }
  if (missing.length > 0) return { forms: [], missing };

  const rulesFor = new Map<string, number[]>();
  rules.forEach((row, index) => {
    const key = coordsMatchKey(row.coords);
    const list = rulesFor.get(key);
    if (list === undefined) rulesFor.set(key, [index]);
    else list.push(index);
  });

  const produced = new Map<string, GeneratedForm | null>();
  const running = new Set<string>();

  /** The generated form at an address, generating it (and its base) if needed. */
  const produce = (key: string): GeneratedForm | null => {
    const cached = produced.get(key);
    if (cached !== undefined) return cached;
    if (running.has(key)) return null; // a cycle: refused at ingest, survivable here
    running.add(key);

    let result: GeneratedForm | null = null;
    for (const index of rulesFor.get(key) ?? []) {
      const rule = rules[index]!;
      let base: string | undefined;
      if (rule.base === undefined) {
        base = facts.lemma;
      } else {
        const baseKey = coordsMatchKey(rule.base);
        base = supplied.get(baseKey) ?? produce(baseKey)?.form;
      }
      if (base === undefined || base === "") continue;
      const generated = applyRule(rule, base);
      if (generated === undefined) continue;
      result = { form: generated, coords: rule.coords, key, rule: index };
      break;
    }

    running.delete(key);
    produced.set(key, result);
    return result;
  };

  // Iterated over the rules rather than over `rulesFor`, so the output follows
  // the record's own order: the first row targeting a cell decides where that
  // cell appears, whichever row ends up filling it.
  const forms: GeneratedForm[] = [];
  const emitted = new Set<string>();
  for (const row of rules) {
    const key = coordsMatchKey(row.coords);
    if (emitted.has(key)) continue;
    emitted.add(key);
    const form = produce(key);
    if (form !== null) forms.push(form);
  }

  return { forms, missing };
}

/**
 * One paradigm handed to the merger, with whatever the caller identifies it by:
 * a `paradigmKey` in the AppView, the resolved record itself in a browser.
 */
export interface ParadigmSource<P> {
  id: P;
  rules: ParadigmRule[];
  requires?: ParadigmRequirement[];
}

/** One form of an entry as a reader (or an index) holds it, after merging. */
export interface MergedForm<P> {
  tag: Tag;
  form: string;
  /** Scheme-blind join key of the address — what a cell is matched on. */
  key: string;
  /**
   * Which paradigm produced it. **Absent means the entry asserts it itself**,
   * and that is the whole of the distinction a reader is shown: a generated form
   * is derived, not a claim its author made.
   */
  from?: P;
}

/** A required base form the entry lacks, and the paradigm that wanted it. */
export interface MergedMissing<P> extends MissingBaseForm {
  from: P;
}

export interface MergedForms<P> {
  /** The entry's own forms in its own order, then the generated ones. */
  forms: MergedForm<P>[];
  missing: MergedMissing<P>[];
}

/**
 * Every form an entry has — asserted and generated — with the precedence
 * settled: **the entry's own `otherForms` win their cells**, and among
 * paradigms the earlier one in the list wins.
 *
 * Since ADR-0019 a selector is matched exactly, so at most one paradigm reaches
 * an entry and the precedence below is a formality — kept because the shape is
 * a list and a caller handing it two paradigms deserves a defined answer.
 *
 * This exists so that the AppView's expansion job and the reader's entry page
 * cannot disagree. They already share the *generator* (invariant 6); without
 * sharing this they would still be free to differ on which of two candidates
 * fills a cell, and a word findable by a form the page does not show — or worse,
 * showing a form search cannot find — is the exact failure invariant 6 was
 * written against. The caller supplies the paradigms **in precedence order**
 * (most specific selector first, which is the order both the AppView's expansion
 * and its `/paradigms` endpoint use); this decides nothing about which paradigms
 * apply, only what happens when two of them fill one cell.
 *
 * A paradigm missing a required base form contributes **nothing** — not a
 * partial table. Its rows land in `missing`, which the AppView records for the
 * dashboard queue and a reader never sees: a dictionary reader has no use for
 * the news that a principal part is absent, and half a generated paradigm is
 * worse for them than none.
 */
export function mergeParadigms<P>(
  paradigms: readonly ParadigmSource<P>[],
  facts: ParadigmEntryFacts,
): MergedForms<P> {
  const forms: MergedForm<P>[] = facts.forms.map((form) => ({
    tag: form.tag,
    form: form.form,
    key: featsMatchKey(form.tag),
  }));
  const missing: MergedMissing<P>[] = [];
  // Exact-key suppression only. A generated form contained by an asserted one
  // at a *vaguer* address is left in and settled where it is actually visible —
  // by `placeForms`, which knows the cells. Here there is no layout in hand.
  const taken = new Set(forms.map((form) => form.key));

  for (const paradigm of paradigms) {
    const generated = generateForms(paradigm, facts);
    for (const row of generated.missing) missing.push({ ...row, from: paradigm.id });
    for (const row of generated.forms) {
      if (taken.has(row.key)) continue;
      taken.add(row.key);
      forms.push({
        // Bare coordinates, as every stored cell address is: re-qualifying them
        // against the language's `values` rows (`coordTag`) is a display step,
        // and the join key above is scheme-blind either way.
        tag: { feats: row.coords.map((coord) => ({ ...coord })) },
        form: row.form,
        key: row.key,
        from: paradigm.id,
      });
    }
  }

  return { forms, missing };
}

/**
 * One paradigm as the API serves it — **a pointer, never the rules**.
 *
 * The rules are content, like an entry's definitions and a source's title: the
 * record on its author's PDS is where a reader gets them, and this says which
 * record that is. The AppView does cache them internally (its expansion job is
 * a sequential writer that cannot make an HTTP round trip per entry), but a
 * cache is not a read surface — serving it here would make the index look like
 * the source of truth for a language's morphology, which is exactly what
 * `subject`-less, last-write-wins records are designed not to have.
 *
 * `selector` rides along because a client has to know which paradigm to resolve
 * for the entry it is looking at, and asking it to fetch every paradigm of a
 * language to find out would defeat the point of an index.
 */
export interface ParadigmView {
  /** Stable identity across versions, and the record key: `{lang}-{hash16}`. */
  paradigmKey: string;
  languageID: string;
  /** The category these rules fill cells for, matched against an entry exactly. */
  selector: Tag;
  /** at:// URI of the current record (resolved client-side for the rules). */
  recordURI: string;
  /**
   * CID of that version, for the editor's stale-rewrite guard. Present for the
   * reason a source's is: a paradigm is rewritten by strangers, and one whose
   * blast radius is every entry of a category should not be overwritten from a
   * copy loaded ten minutes ago.
   */
  cid: string;
  authorDID: string;
}

/**
 * Response shape of GET /languages/:tag/paradigms — every current paradigm of
 * one language, ordered by selector key for stability.
 *
 * The order carried meaning while selectors were matched by containment and the
 * most specific one won a cell; under ADR-0019's exact match at most one
 * paradigm reaches an entry, so there is no precedence left for a client to
 * inherit and the sort exists only so two calls answer alike.
 */
export interface LanguageParadigmsResponse {
  languageID: string;
  paradigms: ParadigmView[];
}
