// Contract for the eu.leksis.paradigm lexicon (lexicons/eu.leksis.paradigm.json)
// and the generator that runs its rules — the morphology arc's layer 5. Types
// are the contract: the lexicon JSON, these shapes and the ArangoDB `paradigms`
// collection move together.
//
// A paradigm is one language's recipe for the forms of one kind of headword:
// the tables they are printed in, and the affix rules that fill their cells. It
// is a record of its own rather than another sub-object on the language record
// because tables and rules are large, written per inflection class, and edited
// at a different cadence than the tag bindings they address (settled at layer
// 2).
//
// Three properties of this file matter more than its shapes.
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
// **The table is the paradigm's, not the language's** (ADR-0019). Cells used to
// be derived — the cartesian product of a category's axes, laid out by a
// `layout` block on the language record. Real tables are not products: they
// carry explanatory headings, cells no combination of features names, and
// merged cells, so a table is authored cell by cell here, and the cell address
// is what a rule fills and what a form finds.
//
// See docs/design/category-axis-merge.md for the merge's reasoning,
// docs/design/paradigm-rules.md for the rule algebra, and ADR-0015 for the
// ingest gate these shapes extend.

import { isValidLanguageTag } from "./bcp47.js";
import type { EntryInflectedForm } from "./entry.js";
import {
  coordTag,
  coordsMatchKey,
  featsMatchKey,
  isValidLayoutCoord,
  type CellAddress,
  type Grammar,
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
 * two numbers this layer enforces itself.
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
  /** Headword categories one paradigm applies to. */
  selectors: 8,
  tables: 16,
  /** Rows of one table. */
  rows: 128,
  /** Cells written in one row — before spans, so a row of the record. */
  cells: 64,
  /** Rules of one form cell, tried in order. */
  rules: 32,
  /** Rows or columns one cell may cover. */
  span: 64,
  requires: 16,
  /** Coordinates of one cell address (`coords`, `base`). */
  coords: 16,
  notes: 16,
  references: 16,
  /** Characters of one rule's `match` pattern. */
  match: 512,
} as const;

/**
 * Drawn positions one record's tables may cover, spans included.
 *
 * `MAX_LAYOUT_CELLS`' successor, and it guards the same thing one altitude
 * lower: a table is now written out rather than derived, so nobody can produce
 * a million cells by declaring one more axis — but a bot can still emit a grid
 * no reader could scroll, and every one of those cells is a regex run per
 * entry. It is a **total** across the record's tables rather than a cap on one
 * of them, because sixteen tables of four thousand cells is the same page.
 *
 * Checked by `paradigmIssues` and not by `isValidParadigmRecord`: it is not the
 * `maxLength` of any one array, so it is arithmetic over the record rather than
 * a shape it fails to have.
 */
export const MAX_TABLE_CELLS = 4096;

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
 * One way of building the form of the cell this rule sits in: the form it
 * starts from, the condition that form must satisfy, and the affixes to
 * exchange.
 *
 * Several rules may sit in one cell — the ordinary Hunspell shape, `-y → -ies`
 * beside `-s` — and the **first matching row in author order wins** it. A row
 * with no condition and no affixes is legitimate: it means the cell is
 * identical to its base.
 *
 * **It carries no address** (ADR-0019). A rule used to name the cell it filled,
 * because cells were derived from the language's axes and a rule was the only
 * thing that could point at one. Now the cell is written out and the rule lives
 * *in* it, so an address on the rule would be a second place to say the same
 * thing — and the first place two records could disagree.
 */
export interface ParadigmRule {
  /**
   * The form this rule transforms. Absent means the lemma, which is the
   * ordinary case. Otherwise it addresses another cell — one the entry supplies
   * (a `requires` row) or one another cell generates, so a paradigm can build a
   * stem once and inflect it many times.
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
 * One cell of a table: a heading, a form, or structural filler.
 *
 * `kind` is a discriminator rather than three optional fields because the three
 * are genuinely different things and a cell that is two of them at once has no
 * meaning. It is read leniently — an unknown kind is drawn as filler rather
 * than refused — so a later kind of cell does not break a reader written before
 * it, the `knownValues` rule a relation's `kind` already follows.
 *
 * **Merging is authored, not inferred.** A cell says how many rows and columns
 * it covers, exactly as an HTML table does, and a form covering several cells
 * is written as *one* cell with a multivalue coordinate (`Gender=Fem,Masc`) —
 * never as several cells that happen to agree. That distinction is the whole
 * reason syncretism has a spelling: a form covering an axis and two forms that
 * coincide are different claims about a language.
 */
export type ParadigmCell =
  | {
      kind: "title";
      /** The heading's prose, in this language. */
      text: string;
      rowSpan?: number;
      colSpan?: number;
    }
  | {
      kind: "empty";
      rowSpan?: number;
      colSpan?: number;
    }
  | {
      kind: "form";
      /**
       * This cell's address — bare, as every stored address is. A coordinate
       * carrying several comma-separated values spans every cell it names with
       * **one** form: the settled spelling of syncretism.
       */
      coords: LayoutCoord[];
      /**
       * How the form is built, first matching rule first. **Absent or empty is
       * meaningful**: the cell is manual-only, fillable by an entry's own
       * `otherForms` and by nothing else — which a reader is shown differently
       * from a cell whose rules all declined for this word.
       */
      rules?: ParadigmRule[];
      rowSpan?: number;
      colSpan?: number;
    };

/** One grid of the paradigm, authored cell by cell. */
export interface ParadigmTable {
  /** Caption printed above the grid, in this language. */
  name?: string;
  /**
   * The rows, top to bottom, each skipping the positions cells above already
   * span — an HTML table's own convention, so a cell appears exactly once.
   */
  rows: ParadigmCell[][];
}

/**
 * The eu.leksis.paradigm record as written to a user's PDS.
 *
 * The record key is `{languageID}-{16 hex characters}` over this record's own
 * sorted selector keys (`paradigmRkey`), which is checked at ingest the way a
 * source's OCLC key is. Identity therefore comes from the key: every author's
 * paradigm for one set of categories shares one, and `selectors` is immutable
 * for a given identity — changing the categories is publishing a *different*
 * paradigm.
 */
export interface LeksisParadigmRecord {
  $type: typeof LEKSIS_PARADIGM_COLLECTION;
  /** Well-formed BCP 47 tag, lowercase. */
  languageID: string;
  /**
   * The headword categories these rules apply to: **full bundles** over what
   * the language declared — a part of speech, its inherent features, and the
   * default axis value where the category names one.
   *
   * Matched against an entry by **exact match** since ADR-0019, not by
   * containment: `{VERB}` reaches only entries whose headword bundle is
   * literally a bare verb, and `{VERB, Conjugation=2}` is a different paradigm
   * rather than a more specific one. Two paradigms can therefore never both
   * reach one entry, which is what retired the most-specific-wins machinery.
   *
   * A **list** because one set of tables genuinely serves several categories —
   * a declension shared by two genders — and listing them is the only way to
   * say that without either duplicating the tables or reintroducing
   * containment.
   */
  selectors: Tag[];
  /** Homolingual name of the paradigm ("first declension"). */
  label?: GrammarLabel;
  requires?: ParadigmRequirement[];
  /** The grids the forms are printed in, in the order a reader meets them. */
  tables: ParadigmTable[];
  notes?: string[];
  references?: GrammarReference[];
  /** at:// URI of the version this rewrites — an audit trail; identity is the key. */
  subject?: string;
  createdAt: string;
}

/**
 * The canonical keys of a paradigm's selectors: **sorted and deduplicated**,
 * which is what makes the identity independent of the order they were written
 * in.
 *
 * Two authors describing the same pair of categories must land on one identity,
 * and nothing about which of the two they typed first is part of what they are
 * saying. Deduplication is the same argument read once more: a record listing
 * one selector twice says exactly what a record listing it once says.
 */
export function paradigmSelectorKeys(selectors: readonly Tag[]): string[] {
  return [...new Set(selectors.map((selector) => tagKey(selector)))].sort();
}

/**
 * Separator between selector keys inside the identity string.
 *
 * A semicolon, because a canonical tag key never contains one: its parts are
 * UD feature names, values, and BCP 47 schemes, joined with `|`, `:` and `=`.
 * So no pair of selector lists can produce one identity by running together.
 */
const SELECTOR_SEPARATOR = ";";

/**
 * The string a paradigm's identity is hashed from — its sorted selector keys,
 * joined.
 *
 * Named and exported because the AppView stores it: it is the natural sort key
 * for a language's paradigms, and a doc that carried only the hash could not be
 * ordered by anything a person would recognise.
 */
export function paradigmIdentityKey(selectors: readonly Tag[]): string {
  return paradigmSelectorKeys(selectors).join(SELECTOR_SEPARATOR);
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
 * its sorted selector keys.
 *
 * **Derived from the record's own fields**, which is the whole point: the
 * editor computes it before publishing and ingest recomputes it and refuses a
 * mismatch, so every author's paradigm for "Breton, `{VERB}`" lands on one
 * identity by construction and no repository can hold two paradigms for one set
 * of categories. The `sources` precedent, with a hash standing in for the OCLC
 * number because a category has no catalogue.
 *
 * The language tag is lowercased here — it is part of an identity, and `br` and
 * `BR` are one language.
 */
export function paradigmRkey(
  record: Pick<LeksisParadigmRecord, "languageID" | "selectors">,
): string {
  return `${record.languageID.toLowerCase()}-${paradigmHash(paradigmIdentityKey(record.selectors))}`;
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

/** A span as written: absent means one, and anything else must be a whole number in range. */
function isValidSpan(value: unknown): boolean {
  if (value === undefined) return true;
  if (typeof value !== "number" || !Number.isInteger(value)) return false;
  return value >= 1 && value <= PARADIGM_LIMITS.span;
}

function isValidRule(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  if (value.base !== undefined && !isValidCoords(value.base, { required: true })) return false;
  if (value.match !== undefined) {
    if (typeof value.match !== "string" || value.match.length > PARADIGM_LIMITS.match) return false;
  }
  if (!isValidAffixString(value.strip) || !isValidAffixString(value.add)) return false;
  if (value.prefix !== undefined) {
    if (!isPlainObject(value.prefix)) return false;
    if (!isValidAffixString(value.prefix.strip) || !isValidAffixString(value.prefix.add)) {
      return false;
    }
  }
  return true;
}

/**
 * Whether a cell is well-formed *for the kind it declares*.
 *
 * An unknown `kind` passes: it is drawn as filler, following the forward
 * compatibility rule an unrecognised relation kind already follows. What is
 * refused is a cell that claims to be a form and carries no address, because
 * that one has no reading at all — a form cell *is* its address.
 */
function isValidCell(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  if (typeof value.kind !== "string") return false;
  if (!isValidSpan(value.rowSpan) || !isValidSpan(value.colSpan)) return false;
  if (value.kind === "title" && typeof value.text !== "string") return false;
  if (value.kind === "form") {
    if (!isValidCoords(value.coords, { required: true })) return false;
    if (value.rules !== undefined) {
      if (!Array.isArray(value.rules) || value.rules.length > PARADIGM_LIMITS.rules) return false;
      if (!value.rules.every(isValidRule)) return false;
    }
  }
  return true;
}

function isValidTable(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  if (value.name !== undefined && typeof value.name !== "string") return false;
  if (!Array.isArray(value.rows) || value.rows.length === 0) return false;
  if (value.rows.length > PARADIGM_LIMITS.rows) return false;
  for (const row of value.rows) {
    if (!Array.isArray(row) || row.length === 0 || row.length > PARADIGM_LIMITS.cells) return false;
    if (!row.every(isValidCell)) return false;
  }
  return true;
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
 * under — the `validateSource` precedent exactly. And `selectors` are not
 * checked against anything the language declared: a paradigm naming a category
 * no grammar has bound contradicts *another record*, not itself, so it is
 * indexed and simply matches no entry (design note §4).
 */
export function isValidParadigmRecord(value: unknown): value is LeksisParadigmRecord {
  if (!isPlainObject(value)) return false;

  // Case is not enforced, only well-formedness: ingest lowercases what it
  // stores, and refusing "BR" would discard a paradigm to make a point about
  // capitalization.
  if (typeof value.languageID !== "string" || !isValidLanguageTag(value.languageID)) return false;

  // `selectors` is the identity: an empty list is not a paradigm with no
  // categories, it is a record with no key to be filed under.
  if (!Array.isArray(value.selectors) || value.selectors.length === 0) return false;
  if (value.selectors.length > PARADIGM_LIMITS.selectors) return false;
  if (!value.selectors.every(isValidTag)) return false;

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

  // `tables` is the record: a grid that addresses nothing is reported as a
  // contradiction rather than a parse failure — but a missing array is not a
  // record of this lexicon at all.
  if (!Array.isArray(value.tables) || value.tables.length === 0) return false;
  if (value.tables.length > PARADIGM_LIMITS.tables) return false;
  if (!value.tables.every(isValidTable)) return false;

  if (typeof value.createdAt !== "string") return false;
  if (value.subject !== undefined && typeof value.subject !== "string") return false;
  return true;
}

// ---- table geometry -----------------------------------------------------
//
// A table is a list of rows of cells, each cell covering a rectangle of the
// drawn grid — the way an HTML table is written, and for the same reason: a
// merged cell should be authored once, where it starts, rather than repeated in
// every position it covers.
//
// Laying that out is arithmetic, so it lives here rather than in a component:
// it is what decides whether a record is drawable at all (`paradigmIssues`),
// and what the reader and the slice-5 editor both draw from. One implementation
// or three, and three would be three chances to disagree about a span.

/** A cell of a table, placed on the drawn grid. */
export interface PlacedCell {
  cell: ParadigmCell;
  /** Where it is written in the record: the row's index, and its place in that row. */
  row: number;
  index: number;
  /** Where it starts on the drawn grid. */
  top: number;
  left: number;
  /** Clamped to at least one, whatever the record says. */
  rowSpan: number;
  colSpan: number;
}

/** A table laid out: where every cell sits, and whether the result is a rectangle. */
export interface ParadigmGrid {
  width: number;
  height: number;
  cells: PlacedCell[];
  /**
   * Positions inside `width × height` that no cell covers.
   *
   * The one defect this layout can produce: cells are placed at the first free
   * position, so nothing can overlap, but a row one cell short of the others
   * leaves a hole — and a hole is a table nobody can draw. It is counted rather
   * than listed because the repair is to look at the grid, not at a coordinate.
   */
  holes: number;
}

/** A span as the layout uses it: at least one, and never past the declared cap. */
function span(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return Math.min(Math.max(Math.floor(value), 1), PARADIGM_LIMITS.span);
}

/**
 * Lay a table's cells onto the grid they draw.
 *
 * **Total, like everything else a draft is handed to.** A cell with a
 * nonsensical span is clamped rather than refused, and a ragged grid produces
 * holes rather than an exception: the caller that cares (`paradigmIssues`)
 * reports them, and the caller that must render anyway (the editor's preview)
 * draws what there is.
 */
export function paradigmGrid(table: ParadigmTable): ParadigmGrid {
  /** Rows of the drawn grid, each a list of covered column indices. */
  const occupied: boolean[][] = [];
  const covers = (row: number, column: number): boolean => occupied[row]?.[column] === true;
  const cover = (row: number, column: number): void => {
    const line = occupied[row] ?? (occupied[row] = []);
    line[column] = true;
  };

  const cells: PlacedCell[] = [];
  let width = 0;
  let height = 0;

  (table.rows ?? []).forEach((line, row) => {
    let column = 0;
    (line ?? []).forEach((cell, index) => {
      while (covers(row, column)) column += 1;
      const rowSpan = span(cell?.rowSpan);
      const colSpan = span(cell?.colSpan);
      for (let r = row; r < row + rowSpan; r++) {
        for (let c = column; c < column + colSpan; c++) cover(r, c);
      }
      cells.push({ cell, row, index, top: row, left: column, rowSpan, colSpan });
      width = Math.max(width, column + colSpan);
      height = Math.max(height, row + rowSpan);
      column += colSpan;
    });
    height = Math.max(height, row + 1);
  });

  let holes = 0;
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) if (!covers(r, c)) holes += 1;
  }

  return { width, height, cells, holes };
}

/** Every form cell of a record's tables, in reading order. */
function formCells(
  tables: readonly ParadigmTable[],
): { table: number; placed: PlacedCell; coords: LayoutCoord[]; rules: ParadigmRule[] }[] {
  const out: { table: number; placed: PlacedCell; coords: LayoutCoord[]; rules: ParadigmRule[] }[] =
    [];
  tables.forEach((table, index) => {
    for (const placed of paradigmGrid(table).cells) {
      if (placed.cell?.kind !== "form") continue;
      out.push({
        table: index,
        placed,
        coords: placed.cell.coords ?? [],
        rules: placed.cell.rules ?? [],
      });
    }
  });
  return out;
}

/**
 * A defect *inside* one paradigm record.
 *
 * The kinds, and why each is a contradiction rather than a disagreement:
 *
 * - `no-cells` — tables that address nothing: headings and filler, no form cell
 *   anywhere. The `empty-rules` successor, and the same argument — a generation
 *   recipe that generates nothing says nothing at all.
 * - `ragged-table` — a grid that does not tile a rectangle once spans are
 *   counted. There is no honest way to draw it, and guessing which row is short
 *   would be the viewer inventing a cell the author did not write.
 * - `duplicate-cell` — two form cells of one record at the same address. Which
 *   one fills it would then depend on reading order, and an address is what a
 *   form is matched on: two cells claiming it means a word's form has two
 *   places to be, chosen by accident.
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
 * - `too-many-cells` — past `MAX_TABLE_CELLS` drawn positions across the record.
 *
 * A row's identity is its **position**, since nothing else distinguishes two
 * rules of one cell and the order between them is what decides which fills it:
 * `key` is `cell#<table>.<row>.<index>`, `rule#<table>.<row>.<index>.<i>`,
 * `requires#<i>`, `table#<i>` or `tables`. `address` carries the offending
 * coordinates in UD's notation, for the ingest log and the editor's footer.
 */
export interface ParadigmIssue {
  kind:
    | "no-cells"
    | "ragged-table"
    | "duplicate-cell"
    | "unknown-base"
    | "base-cycle"
    | "invalid-match"
    | "empty-message"
    | "too-many-cells";
  /** Position of the offending row — see the note above. */
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
  paradigm: Pick<LeksisParadigmRecord, "tables"> & Partial<Pick<LeksisParadigmRecord, "requires">>,
): ParadigmIssue[] {
  const issues: ParadigmIssue[] = [];
  const requires = paradigm.requires ?? [];
  const tables = paradigm.tables ?? [];

  requires.forEach((row, index) => {
    if (row.message.trim() === "") {
      issues.push({
        kind: "empty-message",
        key: `requires#${index}`,
        address: formatCoords(row.coords),
      });
    }
  });

  let drawn = 0;
  tables.forEach((table, index) => {
    const grid = paradigmGrid(table);
    drawn += grid.width * grid.height;
    if (grid.holes > 0) issues.push({ kind: "ragged-table", key: `table#${index}` });
  });
  if (drawn > MAX_TABLE_CELLS) issues.push({ kind: "too-many-cells", key: "tables" });

  const cells = formCells(tables);
  if (cells.length === 0) {
    issues.push({ kind: "no-cells", key: "tables" });
    return issues;
  }

  /** Address key → the first cell holding it. Later ones are duplicates. */
  const targets = new Map<string, (typeof cells)[number]>();
  for (const cell of cells) {
    const key = coordsMatchKey(cell.coords);
    const first = targets.get(key);
    if (first === undefined) {
      targets.set(key, cell);
      continue;
    }
    issues.push({
      kind: "duplicate-cell",
      key: `cell#${cell.table}.${cell.placed.row}.${cell.placed.index}`,
      address: formatCoords(cell.coords),
    });
  }

  const suppliedKeys = new Set(requires.map((row) => coordsMatchKey(row.coords)));

  // Which cells each cell's rules start from — the graph a cycle would live in.
  // Keyed by target rather than by rule because a cell reachable through any of
  // its rules is reachable, and it is the *cells* that loop.
  const basesOf = new Map<string, Set<string>>();
  for (const cell of cells) {
    const target = coordsMatchKey(cell.coords);
    for (const rule of cell.rules) {
      if (rule.base === undefined) continue;
      const baseKey = coordsMatchKey(rule.base);
      if (!targets.has(baseKey)) continue; // an asserted or unknown base ends the chain
      const set = basesOf.get(target);
      if (set === undefined) basesOf.set(target, new Set([baseKey]));
      else set.add(baseKey);
    }
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

  for (const cell of cells) {
    const target = coordsMatchKey(cell.coords);
    const at = `${cell.table}.${cell.placed.row}.${cell.placed.index}`;
    cell.rules.forEach((rule, index) => {
      const key = `rule#${at}.${index}`;
      if (rule.match !== undefined && rule.match !== "" && !compilesAsMatch(rule.match)) {
        issues.push({ kind: "invalid-match", key, address: formatCoords(cell.coords) });
      }
      if (rule.base === undefined) return;
      const baseKey = coordsMatchKey(rule.base);
      if (!suppliedKeys.has(baseKey) && !targets.has(baseKey)) {
        issues.push({
          kind: "unknown-base",
          key,
          address: formatCoords(cell.coords),
          base: formatCoords(rule.base),
        });
        return;
      }
      if (targets.has(baseKey) && reaches(baseKey, target, new Set())) {
        issues.push({
          kind: "base-cycle",
          key,
          address: formatCoords(cell.coords),
          base: formatCoords(rule.base),
        });
      }
    });
  }

  return issues;
}

// ---- the resolved table, as a reader draws it ---------------------------

/** One cell of a table with its address resolved against the language. */
export type ResolvedParadigmCell =
  | { kind: "title"; text: string; rowSpan: number; colSpan: number }
  | { kind: "empty"; rowSpan: number; colSpan: number }
  | {
      kind: "form";
      /** The address, bare and re-qualified and keyed — what a form is matched on. */
      address: CellAddress;
      /** Empty means a manual-only cell: no rule can ever fill it. */
      rules: ParadigmRule[];
      rowSpan: number;
      colSpan: number;
    };

/** One table with every cell resolved, in the rows the record wrote. */
export interface ResolvedParadigmTable {
  name?: string;
  /** The record's own rows — a spanned cell appears once, where it starts. */
  rows: ResolvedParadigmCell[][];
  width: number;
  height: number;
}

/**
 * A record's tables with their addresses re-qualified from the language's own
 * declarations — the one step between a stored table and a drawn one.
 *
 * The re-qualification is `coordTag`'s and it is load-bearing rather than
 * cosmetic: coordinates are stored bare, but a Breton form authored through the
 * language's own picker carries `scheme: "br"`, and a label for it is stored
 * under a key that includes the scheme. An address built from the bare pair
 * would find no label — so a table drawn without this step prints canonical
 * keys where a reader expects their language's words.
 *
 * With no grammar in hand every address stays bare, which is exactly what a
 * language that has declared nothing should produce: the cells are still there
 * and still match forms (the join key is scheme-blind either way), and the
 * headings fall back to UD's own notation.
 */
export function resolveParadigmTables(
  grammar: Grammar | undefined,
  tables: readonly ParadigmTable[],
): ResolvedParadigmTable[] {
  return tables.map((table) => {
    const grid = paradigmGrid(table);
    const rows: ResolvedParadigmCell[][] = (table.rows ?? []).map(() => []);
    for (const placed of grid.cells) {
      const line = rows[placed.row];
      if (line === undefined) continue;
      const { rowSpan, colSpan } = placed;
      const cell = placed.cell;
      if (cell?.kind === "form") {
        const coords = cell.coords ?? [];
        line.push({
          kind: "form",
          address: {
            coords,
            tag: coordTag(grammar ?? {}, coords),
            key: coordsMatchKey(coords),
          },
          rules: cell.rules ?? [],
          rowSpan,
          colSpan,
        });
      } else if (cell?.kind === "title") {
        line.push({ kind: "title", text: cell.text ?? "", rowSpan, colSpan });
      } else {
        // Including an unknown kind: drawn as filler rather than refused, so a
        // later kind of cell leaves a gap in an old reader instead of a crash.
        line.push({ kind: "empty", rowSpan, colSpan });
      }
    }
    return {
      ...(table.name !== undefined ? { name: table.name } : {}),
      rows,
      width: grid.width,
      height: grid.height,
    };
  });
}

/** Every address a resolved table addresses — what `placeForms` is handed. */
export function paradigmCellAddresses(
  tables: readonly ResolvedParadigmTable[],
): CellAddress[] {
  const out: CellAddress[] = [];
  for (const table of tables) {
    for (const row of table.rows) {
      for (const cell of row) if (cell.kind === "form") out.push(cell.address);
    }
  }
  return out;
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
  /** Which rule of the cell produced it, for a preview that explains itself. */
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
 * recompiling each cell's conditions per entry is the one hot path this file
 * has. The cache is dropped wholesale when it grows past the bound rather than
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
 * lemma's rule, and another rule of the cell may be. A rule that would produce
 * an empty string declines too — no cell is better than a blank one.
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
 * 2. **Form cells in reading order** — table by table, row by row, left to
 *    right — one form each. Within a cell the first rule whose condition
 *    matches wins it; a cell no rule matches is simply not generated, which is
 *    an empty cell and not an error. A cell with **no rules at all** is
 *    manual-only and generates nothing by construction.
 * 3. **Bases resolve on demand.** A rule starting from another cell's address
 *    generates that cell first, so a paradigm can build a stem once and inflect
 *    it many times. Chains are memoised, and a cycle yields nothing rather than
 *    recursing — `paradigmIssues` refuses such a record, and this function still
 *    has to be total when handed a draft that has not been through it.
 *
 * **Syncretism is expressed, not expanded**: a cell addressed
 * `Gender=Fem,Masc` produces **one** form whose address spans both cells,
 * because the table draws that cell with a span rather than printing the form
 * twice — and because a form covering an axis must not be indistinguishable
 * from two forms that happen to agree.
 *
 * Nothing here reads the language record: a bare address is all a rule needs,
 * and `coordsMatchKey` is the same join key a resolved table computes with the
 * grammar in hand.
 */
export function generateForms(
  paradigm: Pick<LeksisParadigmRecord, "tables"> & Partial<Pick<LeksisParadigmRecord, "requires">>,
  facts: ParadigmEntryFacts,
): ParadigmGeneration {
  const cells = formCells(paradigm.tables ?? []);
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

  /**
   * Address key → the cell at it, and the order the cells were met in.
   *
   * The **first** cell wins a repeated address, which is the same tiebreak
   * `paradigmIssues` reports the second one under: a record with two cells at
   * one address is refused, and a draft that has one still has to render
   * something rather than nothing.
   */
  const cellAt = new Map<string, (typeof cells)[number]>();
  const order: string[] = [];
  for (const cell of cells) {
    const key = coordsMatchKey(cell.coords);
    if (cellAt.has(key)) continue;
    cellAt.set(key, cell);
    order.push(key);
  }

  const produced = new Map<string, GeneratedForm | null>();
  const running = new Set<string>();

  /** The generated form at an address, generating it (and its base) if needed. */
  const produce = (key: string): GeneratedForm | null => {
    const cached = produced.get(key);
    if (cached !== undefined) return cached;
    if (running.has(key)) return null; // a cycle: refused at ingest, survivable here
    running.add(key);

    const cell = cellAt.get(key);
    let result: GeneratedForm | null = null;
    let index = 0;
    for (const rule of cell?.rules ?? []) {
      let base: string | undefined;
      if (rule.base === undefined) {
        base = facts.lemma;
      } else {
        const baseKey = coordsMatchKey(rule.base);
        base = supplied.get(baseKey) ?? produce(baseKey)?.form;
      }
      if (base !== undefined && base !== "") {
        const generated = applyRule(rule, base);
        if (generated !== undefined) {
          result = { form: generated, coords: cell?.coords ?? [], key, rule: index };
          break;
        }
      }
      index += 1;
    }

    running.delete(key);
    produced.set(key, result);
    return result;
  };

  // Reading order, which is the table's own: a reader meets the forms in the
  // order the paradigm draws them, and so does anything that lists them flat.
  const forms: GeneratedForm[] = [];
  for (const key of order) {
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
  tables: ParadigmTable[];
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
 * written against.
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
  // by `placeForms`, which knows the cells. Here there are no tables in hand.
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
 * One paradigm as the API serves it — **a pointer, never the tables**.
 *
 * The tables and rules are content, like an entry's definitions and a source's
 * title: the record on its author's PDS is where a reader gets them, and this
 * says which record that is. The AppView does cache them internally (its
 * expansion job is a sequential writer that cannot make an HTTP round trip per
 * entry), but a cache is not a read surface — serving it would make the index
 * look like the source of truth for a language's morphology, which is exactly
 * what `subject`-less, last-write-wins records are designed not to have.
 *
 * `selectors` ride along because a client has to know which paradigm to resolve
 * for the entry it is looking at, and asking it to fetch every paradigm of a
 * language to find out would defeat the point of an index.
 */
export interface ParadigmView {
  /** Stable identity across versions, and the record key: `{lang}-{hash16}`. */
  paradigmKey: string;
  languageID: string;
  /** The headword categories these tables serve, each matched exactly. */
  selectors: Tag[];
  /** at:// URI of the current record (resolved client-side for the tables). */
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
 * one language, ordered by identity key for stability.
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
