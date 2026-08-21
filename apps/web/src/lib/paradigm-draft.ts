import {
  LEKSIS_PARADIGM_COLLECTION,
  PARADIGM_LIMITS,
  paradigmGrid,
  type GrammarReference,
  type LayoutCoord,
  type LeksisParadigmRecord,
  type ParadigmCell,
  type ParadigmRequirement,
  type ParadigmRule,
  type ParadigmTable,
  type Tag,
} from "@leksis/types";

// The table editor's working copy, and the pure functions that move it.
//
// `grammar-draft.ts` at one layer up: the dialog holds a draft and calls these,
// so what an edit *means* is testable without a browser and the component is
// left with presentation. The difference from that file is what the draft is —
// a whole record rather than a sub-object of one, because a paradigm is its own
// record (settled at layer 2: tables and rules are large, written per class,
// and edited at a different cadence than the tag bindings they address).
//
// **The draft holds a grid, not the record's rows** (the one structural change
// since ADR-0016's rule-list editor). A record writes a spanned cell once,
// where it starts, and omits the positions it covers — an HTML table's own
// convention, and the right *storage*, because a cell should be authored in one
// place. It is the wrong thing to *edit*: inserting a column means adding a
// cell to some rows and widening a span in others, and every operation has to
// know which. So the editor works on the drawn rectangle, where a column is a
// column, and serializes back on the way out (`tableFromGrid`).
//
// Two invariants hold over every operation here, and they are what make the
// grid editor honest rather than merely convenient:
//
//   * **the grid tiles its rectangle** — no holes, no overlaps — so
//     `ragged-table` is unreachable from the interface, in the way the old
//     editor made `unknown-base` unreachable by offering only valid bases;
//   * **every row keeps at least one cell of its own**, because a record row is
//     an array the lexicon requires to be non-empty, and a row entirely covered
//     from above would serialize to `[]`. The two operations that could break it
//     refuse instead (`mergeDown`, `removeColumn`).
//
// Nothing here judges a draft: `paradigmIssues` in packages/types does that,
// and it is the same function ingest runs.

/** One cell of the drawn grid, with the rectangle it covers. */
export interface DraftCell {
  cell: ParadigmCell;
  top: number;
  left: number;
  rowSpan: number;
  colSpan: number;
}

/** One table as the editor holds it: a rectangle, tiled by its cells. */
export interface DraftTable {
  /** The caption, empty rather than absent — dropped on the way to the record. */
  name: string;
  width: number;
  height: number;
  cells: DraftCell[];
}

/** The editor's shape: every optional field present, empty rather than absent. */
export interface ParadigmDraft {
  /**
   * The headword categories these tables serve.
   *
   * **Editable while creating and locked while rewriting** (see
   * `ParadigmEditorDialog`): the record key hashes this list, so changing it is
   * publishing a *different* paradigm rather than changing this one — the
   * `sources` rule about an immutable main language, with a hash standing in
   * for the catalogue number.
   */
  selectors: Tag[];
  label: { long: string; short: string };
  requires: ParadigmRequirement[];
  tables: DraftTable[];
  notes: string[];
  references: GrammarReference[];
}

/** A structural filler cell — what every position of a new grid starts as. */
export function emptyCell(): ParadigmCell {
  return { kind: "empty" };
}

/**
 * A blank two-by-two table.
 *
 * Two rather than one because one cell is not a table, and not more because a
 * paradigm of a single form is an ordinary thing to write (a singulative, a
 * verbal noun) and every unwanted cell has to be removed by hand. Growing a
 * grid is one click; shrinking it is one click per row.
 */
export function emptyTable(): DraftTable {
  return {
    name: "",
    width: 2,
    height: 2,
    cells: [
      { cell: emptyCell(), top: 0, left: 0, rowSpan: 1, colSpan: 1 },
      { cell: emptyCell(), top: 0, left: 1, rowSpan: 1, colSpan: 1 },
      { cell: emptyCell(), top: 1, left: 0, rowSpan: 1, colSpan: 1 },
      { cell: emptyCell(), top: 1, left: 1, rowSpan: 1, colSpan: 1 },
    ],
  };
}

export function emptyDraft(selectors: Tag[]): ParadigmDraft {
  return {
    selectors: [...selectors],
    label: { long: "", short: "" },
    requires: [],
    tables: [emptyTable()],
    notes: [],
    references: [],
  };
}

/**
 * The drawn grid of a stored table.
 *
 * `paradigmGrid` does the placing — one implementation of what a span means,
 * shared with the reader and with `paradigmIssues` — and this fills whatever it
 * reports as a **hole** with a filler cell. That heals a ragged record on the
 * way into the editor, deliberately: such a record cannot be drawn at all, so
 * the alternative is refusing to open the one surface that could repair it. The
 * grid on screen is what the author then publishes, so nothing is changed
 * behind their back.
 */
export function gridFromTable(table: ParadigmTable): DraftTable {
  const grid = paradigmGrid(table);
  const cells: DraftCell[] = grid.cells.map((placed) => ({
    cell: placed.cell ?? emptyCell(),
    top: placed.top,
    left: placed.left,
    rowSpan: placed.rowSpan,
    colSpan: placed.colSpan,
  }));
  const width = Math.max(grid.width, 1);
  const height = Math.max(grid.height, 1);
  const covered = coverage({ name: "", width, height, cells });
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (covered[r]?.[c] !== true) {
        cells.push({ cell: emptyCell(), top: r, left: c, rowSpan: 1, colSpan: 1 });
      }
    }
  }
  return { name: table.name ?? "", width, height, cells: sortCells(cells) };
}

/**
 * The table as the record stores it: one row per row of the grid, holding the
 * cells that *start* there, left to right.
 *
 * The round trip is exact because `paradigmGrid` places each cell at the first
 * free position of its row, and a tiling read left to right presents them in
 * exactly that order — the same reconstruction an HTML table relies on.
 */
export function tableFromGrid(grid: DraftTable): ParadigmTable {
  const rows: ParadigmCell[][] = [];
  for (let r = 0; r < grid.height; r++) {
    rows.push(
      grid.cells
        .filter((placed) => placed.top === r)
        .sort((a, b) => a.left - b.left)
        .map((placed) => ({
          ...placed.cell,
          ...(placed.rowSpan > 1 ? { rowSpan: placed.rowSpan } : {}),
          ...(placed.colSpan > 1 ? { colSpan: placed.colSpan } : {}),
        })),
    );
  }
  const name = grid.name.trim();
  return { ...(name !== "" ? { name } : {}), rows };
}

/** Reading order — the order the record writes, and the order a reader meets. */
function sortCells(cells: DraftCell[]): DraftCell[] {
  return [...cells].sort((a, b) => a.top - b.top || a.left - b.left);
}

/** Which positions of the rectangle each cell covers. */
function coverage(grid: DraftTable): boolean[][] {
  const covered: boolean[][] = Array.from({ length: grid.height }, () =>
    Array.from({ length: grid.width }, () => false),
  );
  for (const placed of grid.cells) {
    for (let r = placed.top; r < placed.top + placed.rowSpan; r++) {
      for (let c = placed.left; c < placed.left + placed.colSpan; c++) {
        const line = covered[r];
        if (line !== undefined && c < grid.width) line[c] = true;
      }
    }
  }
  return covered;
}

/** The cell owning a position, if any — `undefined` where a span covers it. */
export function cellAt(grid: DraftTable, top: number, left: number): DraftCell | undefined {
  return grid.cells.find((placed) => placed.top === top && placed.left === left);
}

/** Whether a position is covered by some cell's span rather than owned. */
export function isCovered(grid: DraftTable, top: number, left: number): boolean {
  if (cellAt(grid, top, left) !== undefined) return false;
  return grid.cells.some(
    (placed) =>
      top >= placed.top &&
      top < placed.top + placed.rowSpan &&
      left >= placed.left &&
      left < placed.left + placed.colSpan,
  );
}

/**
 * Whether every row still holds a cell of its own — the record-shape invariant,
 * checked as a post-condition rather than reasoned about per operation.
 */
function rowsInhabited(grid: DraftTable): boolean {
  for (let r = 0; r < grid.height; r++) {
    if (!grid.cells.some((placed) => placed.top === r)) return false;
  }
  return true;
}

/** Replace the cell at a position, keeping the rectangle it covers. */
export function setCellAt(
  grid: DraftTable,
  top: number,
  left: number,
  cell: ParadigmCell,
): DraftTable {
  return {
    ...grid,
    cells: grid.cells.map((placed) =>
      placed.top === top && placed.left === left ? { ...placed, cell } : placed,
    ),
  };
}

export function renameTable(grid: DraftTable, name: string): DraftTable {
  return { ...grid, name };
}

/**
 * Add a row, stretching whatever spans across the seam.
 *
 * A cell covering the position a row is inserted at grows by one rather than
 * being cut in half: the author asked for another line of the table, not for a
 * merged cell to come apart. Positions the stretched cells do not cover get
 * filler.
 */
export function insertRow(grid: DraftTable, at: number): DraftTable {
  return canInsertRow(grid, at) ? withRow(grid, at) : grid;
}

function withRow(grid: DraftTable, at: number): DraftTable {
  const moved = grid.cells.map((placed) => {
    if (placed.top >= at) return { ...placed, top: placed.top + 1 };
    if (placed.top + placed.rowSpan > at) {
      return { ...placed, rowSpan: Math.min(placed.rowSpan + 1, PARADIGM_LIMITS.span) };
    }
    return placed;
  });
  const next: DraftTable = { ...grid, height: grid.height + 1, cells: moved };
  const covered = coverage(next);
  for (let c = 0; c < next.width; c++) {
    if (covered[at]?.[c] !== true) {
      next.cells.push({ cell: emptyCell(), top: at, left: c, rowSpan: 1, colSpan: 1 });
    }
  }
  return { ...next, cells: sortCells(next.cells) };
}

/**
 * Whether a row may be inserted here.
 *
 * Almost always yes. The exception is a grid whose every column is spanned
 * across the seam, where the new row would be covered from end to end and
 * serialize to an empty array — reachable only from a *loaded* record, since no
 * merge in this editor can produce it. Refused rather than published broken.
 */
export function canInsertRow(grid: DraftTable, at: number): boolean {
  if (grid.height >= PARADIGM_LIMITS.rows) return false;
  return rowsInhabited(withRow(grid, at));
}

export function insertColumn(grid: DraftTable, at: number): DraftTable {
  if (grid.width >= PARADIGM_LIMITS.cells) return grid;
  const moved = grid.cells.map((placed) => {
    if (placed.left >= at) return { ...placed, left: placed.left + 1 };
    if (placed.left + placed.colSpan > at) {
      return { ...placed, colSpan: Math.min(placed.colSpan + 1, PARADIGM_LIMITS.span) };
    }
    return placed;
  });
  const next: DraftTable = { ...grid, width: grid.width + 1, cells: moved };
  const covered = coverage(next);
  for (let r = 0; r < next.height; r++) {
    if (covered[r]?.[at] !== true) {
      next.cells.push({ cell: emptyCell(), top: r, left: at, rowSpan: 1, colSpan: 1 });
    }
  }
  return { ...next, cells: sortCells(next.cells) };
}

export function canRemoveRow(grid: DraftTable): boolean {
  return grid.height > 1;
}

/**
 * Remove a row. A cell spanning it shrinks by one; a cell that *starts* there
 * and spans further keeps its position and loses a row; one that starts and
 * ends there goes.
 */
export function removeRow(grid: DraftTable, at: number): DraftTable {
  if (!canRemoveRow(grid)) return grid;
  const cells: DraftCell[] = [];
  for (const placed of grid.cells) {
    if (placed.top > at) {
      cells.push({ ...placed, top: placed.top - 1 });
      continue;
    }
    if (placed.top + placed.rowSpan <= at) {
      cells.push(placed);
      continue;
    }
    if (placed.rowSpan > 1) cells.push({ ...placed, rowSpan: placed.rowSpan - 1 });
  }
  return { ...grid, height: grid.height - 1, cells: sortCells(cells) };
}

export function canRemoveColumn(grid: DraftTable, at: number): boolean {
  if (grid.width <= 1) return false;
  return rowsInhabited(withoutColumn(grid, at));
}

function withoutColumn(grid: DraftTable, at: number): DraftTable {
  const cells: DraftCell[] = [];
  for (const placed of grid.cells) {
    if (placed.left > at) {
      cells.push({ ...placed, left: placed.left - 1 });
      continue;
    }
    if (placed.left + placed.colSpan <= at) {
      cells.push(placed);
      continue;
    }
    if (placed.colSpan > 1) cells.push({ ...placed, colSpan: placed.colSpan - 1 });
  }
  return { ...grid, width: grid.width - 1, cells: sortCells(cells) };
}

/**
 * Remove a column — refused when it would leave a row with no cell of its own,
 * which is a record row the lexicon cannot hold.
 */
export function removeColumn(grid: DraftTable, at: number): DraftTable {
  return canRemoveColumn(grid, at) ? withoutColumn(grid, at) : grid;
}

/**
 * The cells one merge would absorb, or `null` when the merge is not offered.
 *
 * Two conditions, and both are about being predictable rather than clever.
 * The strip has to be **fully owned by single cells** — a neighbour that is
 * itself merged would make the result non-rectangular — and every one of them
 * has to be **filler**, so no merge can discard a heading somebody wrote or a
 * cell's rules. Clearing a cell first is one click, and a silent loss is not
 * recoverable.
 */
function absorbable(
  grid: DraftTable,
  strip: { top: number; left: number }[],
): DraftCell[] | null {
  const cells: DraftCell[] = [];
  for (const position of strip) {
    if (position.top >= grid.height || position.left >= grid.width) return null;
    const found = cellAt(grid, position.top, position.left);
    if (found === undefined) return null;
    if (found.rowSpan !== 1 || found.colSpan !== 1) return null;
    if (found.cell.kind !== "empty") return null;
    cells.push(found);
  }
  return cells;
}

function mergedInto(grid: DraftTable, owner: DraftCell, absorbed: DraftCell[], grow: "row" | "column"): DraftTable {
  const keep = grid.cells.filter((placed) => !absorbed.includes(placed));
  return {
    ...grid,
    cells: sortCells(
      keep.map((placed) =>
        placed === owner
          ? {
              ...placed,
              rowSpan: grow === "row" ? placed.rowSpan + 1 : placed.rowSpan,
              colSpan: grow === "column" ? placed.colSpan + 1 : placed.colSpan,
            }
          : placed,
      ),
    ),
  };
}

/** The one column strip a rightward merge would take in. */
function rightStrip(owner: DraftCell): { top: number; left: number }[] {
  const left = owner.left + owner.colSpan;
  return Array.from({ length: owner.rowSpan }, (_, i) => ({ top: owner.top + i, left }));
}

function downStrip(owner: DraftCell): { top: number; left: number }[] {
  const top = owner.top + owner.rowSpan;
  return Array.from({ length: owner.colSpan }, (_, i) => ({ top, left: owner.left + i }));
}

export function canMergeRight(grid: DraftTable, top: number, left: number): boolean {
  const owner = cellAt(grid, top, left);
  if (owner === undefined || owner.colSpan >= PARADIGM_LIMITS.span) return false;
  return absorbable(grid, rightStrip(owner)) !== null;
}

export function mergeRight(grid: DraftTable, top: number, left: number): DraftTable {
  const owner = cellAt(grid, top, left);
  if (owner === undefined || owner.colSpan >= PARADIGM_LIMITS.span) return grid;
  const absorbed = absorbable(grid, rightStrip(owner));
  if (absorbed === null) return grid;
  return mergedInto(grid, owner, absorbed, "column");
}

export function canMergeDown(grid: DraftTable, top: number, left: number): boolean {
  const owner = cellAt(grid, top, left);
  if (owner === undefined || owner.rowSpan >= PARADIGM_LIMITS.span) return false;
  const absorbed = absorbable(grid, downStrip(owner));
  if (absorbed === null) return false;
  // A row whose every cell is absorbed from above serializes to an empty array,
  // which is not a row of this lexicon. Refused rather than published broken.
  return rowsInhabited(mergedInto(grid, owner, absorbed, "row"));
}

export function mergeDown(grid: DraftTable, top: number, left: number): DraftTable {
  if (!canMergeDown(grid, top, left)) return grid;
  const owner = cellAt(grid, top, left)!;
  return mergedInto(grid, owner, absorbable(grid, downStrip(owner))!, "row");
}

export function canUnmerge(grid: DraftTable, top: number, left: number): boolean {
  const owner = cellAt(grid, top, left);
  return owner !== undefined && (owner.rowSpan > 1 || owner.colSpan > 1);
}

/** Shrink a merged cell back to one position, filling what it releases. */
export function unmerge(grid: DraftTable, top: number, left: number): DraftTable {
  const owner = cellAt(grid, top, left);
  if (owner === undefined) return grid;
  const cells = grid.cells.map((placed) =>
    placed === owner ? { ...placed, rowSpan: 1, colSpan: 1 } : placed,
  );
  for (let r = owner.top; r < owner.top + owner.rowSpan; r++) {
    for (let c = owner.left; c < owner.left + owner.colSpan; c++) {
      if (r === owner.top && c === owner.left) continue;
      cells.push({ cell: emptyCell(), top: r, left: c, rowSpan: 1, colSpan: 1 });
    }
  }
  return { ...grid, cells: sortCells(cells) };
}

// ---- the draft's own rows ------------------------------------------------

export function fromRecord(record: LeksisParadigmRecord): ParadigmDraft {
  return {
    selectors: record.selectors.map((selector) => ({ ...selector })),
    label: { long: record.label?.long ?? "", short: record.label?.short ?? "" },
    requires: (record.requires ?? []).map((row) => ({ ...row, coords: [...row.coords] })),
    tables: (record.tables ?? []).map(gridFromTable),
    notes: [...(record.notes ?? [])],
    references: (record.references ?? []).map((row) => ({ ...row })),
  };
}

/** The draft's tables as the record and the generator see them. */
export function recordTables(draft: ParadigmDraft): ParadigmTable[] {
  return draft.tables.map(tableFromGrid);
}

/** Drop a field that is blank rather than writing an empty string into a record. */
function some(value: string | undefined): string | undefined {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? undefined : trimmed;
}

/** One rule with every blank field omitted rather than written empty. */
function cleanRule(rule: ParadigmRule): ParadigmRule {
  const prefixStrip = some(rule.prefix?.strip);
  const prefixAdd = some(rule.prefix?.add);
  const prefix =
    prefixStrip === undefined && prefixAdd === undefined
      ? undefined
      : {
          ...(prefixStrip !== undefined ? { strip: prefixStrip } : {}),
          ...(prefixAdd !== undefined ? { add: prefixAdd } : {}),
        };
  const match = some(rule.match);
  const strip = some(rule.strip);
  const add = some(rule.add);
  return {
    ...(rule.base !== undefined && rule.base.length > 0 ? { base: rule.base } : {}),
    ...(match !== undefined ? { match } : {}),
    ...(strip !== undefined ? { strip } : {}),
    ...(add !== undefined ? { add } : {}),
    ...(prefix !== undefined ? { prefix } : {}),
  };
}

/** One cell with its optional halves cleaned — spans stay as the grid set them. */
function cleanCell(cell: ParadigmCell): ParadigmCell {
  if (cell.kind === "form") {
    const rules = (cell.rules ?? []).map(cleanRule);
    return {
      kind: "form",
      coords: cell.coords,
      ...(rules.length > 0 ? { rules } : {}),
      ...(cell.rowSpan !== undefined && cell.rowSpan > 1 ? { rowSpan: cell.rowSpan } : {}),
      ...(cell.colSpan !== undefined && cell.colSpan > 1 ? { colSpan: cell.colSpan } : {}),
    };
  }
  return cell;
}

/**
 * The record as it goes to the PDS.
 *
 * Every empty optional is **omitted**, not written blank. The record is what
 * ingest validates and what every reader resolves from a stranger's PDS; a
 * `strip: ""` there is a field that means nothing and that every consumer has
 * to decide about.
 */
export function toRecord(
  draft: ParadigmDraft,
  { languageID, createdAt, subject }: { languageID: string; createdAt: string; subject?: string },
): LeksisParadigmRecord {
  const long = draft.label.long.trim();
  const short = some(draft.label.short);
  const requires = draft.requires
    .filter((row) => row.coords.length > 0)
    .map((row) => ({ coords: row.coords, message: row.message.trim() }));
  const tables = recordTables(draft).map((table) => ({
    ...table,
    rows: table.rows.map((row) => row.map(cleanCell)),
  }));
  const notes = draft.notes.map((note) => note.trim()).filter((note) => note !== "");
  const references = draft.references
    .filter((row) => row.text.trim() !== "")
    .map((row) => {
      const url = some(row.url);
      return { text: row.text.trim(), ...(url !== undefined ? { url } : {}) };
    });

  return {
    $type: LEKSIS_PARADIGM_COLLECTION,
    languageID: languageID.toLowerCase(),
    selectors: draft.selectors,
    ...(long !== "" ? { label: { long, ...(short !== undefined ? { short } : {}) } } : {}),
    ...(requires.length > 0 ? { requires } : {}),
    tables,
    ...(notes.length > 0 ? { notes } : {}),
    ...(references.length > 0 ? { references } : {}),
    ...(subject !== undefined ? { subject } : {}),
    createdAt,
  };
}

// ---- selectors ----------------------------------------------------------

export function canAddSelector(draft: ParadigmDraft): boolean {
  return draft.selectors.length < PARADIGM_LIMITS.selectors;
}

export function addSelector(draft: ParadigmDraft, selector: Tag): ParadigmDraft {
  if (!canAddSelector(draft)) return draft;
  return { ...draft, selectors: [...draft.selectors, selector] };
}

export function removeSelector(draft: ParadigmDraft, index: number): ParadigmDraft {
  return { ...draft, selectors: draft.selectors.filter((_, i) => i !== index) };
}

// ---- tables -------------------------------------------------------------

export function canAddTable(draft: ParadigmDraft): boolean {
  return draft.tables.length < PARADIGM_LIMITS.tables;
}

export function addTable(draft: ParadigmDraft): ParadigmDraft {
  if (!canAddTable(draft)) return draft;
  return { ...draft, tables: [...draft.tables, emptyTable()] };
}

/** Remove a table. The last one stays: a paradigm with no table is not one. */
export function removeTable(draft: ParadigmDraft, index: number): ParadigmDraft {
  if (draft.tables.length <= 1) return draft;
  return { ...draft, tables: draft.tables.filter((_, i) => i !== index) };
}

export function updateTable(draft: ParadigmDraft, index: number, grid: DraftTable): ParadigmDraft {
  return { ...draft, tables: draft.tables.map((row, i) => (i === index ? grid : row)) };
}

// ---- rules, on the cell they sit in -------------------------------------

/** The rules of a cell, or none where the cell is not a form. */
export function rulesOf(cell: ParadigmCell | undefined): ParadigmRule[] {
  return cell !== undefined && cell.kind === "form" ? (cell.rules ?? []) : [];
}

/** A form cell with a different rule list — the one way rules are edited. */
export function withRules(cell: ParadigmCell, rules: ParadigmRule[]): ParadigmCell {
  if (cell.kind !== "form") return cell;
  return { ...cell, rules };
}

export function canAddRule(cell: ParadigmCell | undefined): boolean {
  return rulesOf(cell).length < PARADIGM_LIMITS.rules;
}

/**
 * Move a rule through its cell's list.
 *
 * Order **is** the semantics here, not presentation: the first row whose
 * `match` the base satisfies wins the cell, which is how `-y → -ies` sits in
 * front of the plain `-s`. So this is the one control that changes what the
 * rules generate without changing a character of any row.
 */
export function movedRules(rules: ParadigmRule[], index: number, by: -1 | 1): ParadigmRule[] {
  const target = index + by;
  if (target < 0 || target >= rules.length) return rules;
  const next = [...rules];
  const [row] = next.splice(index, 1);
  next.splice(target, 0, row!);
  return next;
}

// ---- requirements, notes, references ------------------------------------

export function canAddRequirement(draft: ParadigmDraft): boolean {
  return draft.requires.length < PARADIGM_LIMITS.requires;
}

export function addRequirement(draft: ParadigmDraft, coords: LayoutCoord[]): ParadigmDraft {
  if (!canAddRequirement(draft)) return draft;
  return { ...draft, requires: [...draft.requires, { coords, message: "" }] };
}

export function updateRequirement(
  draft: ParadigmDraft,
  index: number,
  patch: Partial<ParadigmRequirement>,
): ParadigmDraft {
  return {
    ...draft,
    requires: draft.requires.map((row, i) => (i === index ? { ...row, ...patch } : row)),
  };
}

export function removeRequirement(draft: ParadigmDraft, index: number): ParadigmDraft {
  return { ...draft, requires: draft.requires.filter((_, i) => i !== index) };
}

export function addNote(draft: ParadigmDraft): ParadigmDraft {
  if (draft.notes.length >= PARADIGM_LIMITS.notes) return draft;
  return { ...draft, notes: [...draft.notes, ""] };
}

export function updateNote(draft: ParadigmDraft, index: number, text: string): ParadigmDraft {
  return { ...draft, notes: draft.notes.map((note, i) => (i === index ? text : note)) };
}

export function removeNote(draft: ParadigmDraft, index: number): ParadigmDraft {
  return { ...draft, notes: draft.notes.filter((_, i) => i !== index) };
}

export function addReference(draft: ParadigmDraft): ParadigmDraft {
  if (draft.references.length >= PARADIGM_LIMITS.references) return draft;
  return { ...draft, references: [...draft.references, { text: "" }] };
}

export function updateReference(
  draft: ParadigmDraft,
  index: number,
  patch: Partial<GrammarReference>,
): ParadigmDraft {
  return {
    ...draft,
    references: draft.references.map((row, i) => (i === index ? { ...row, ...patch } : row)),
  };
}

export function removeReference(draft: ParadigmDraft, index: number): ParadigmDraft {
  return { ...draft, references: draft.references.filter((_, i) => i !== index) };
}
