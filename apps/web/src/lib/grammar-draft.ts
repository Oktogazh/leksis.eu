import {
  axisKey,
  excludesCell,
  inherentKey,
  tagKey,
  valueTag,
  type Grammar,
  type GrammarAbbreviation,
  type GrammarAxis,
  type GrammarCombination,
  type GrammarFeature,
  type GrammarInherent,
  type GrammarLayout,
  type GrammarPos,
  type GrammarValue,
  type LayoutBlock,
  type LayoutCoord,
  type Tag,
} from "@leksis/types";

// Pure edits on a draft `grammar` object, for the binding editor.
//
// Kept out of the component because a language record is rewritten whole on
// every save: what these functions produce IS what gets published, so the
// arithmetic of adding and removing rows has to be checkable on its own,
// without a browser. Rows are matched on their canonical key, never on object
// identity or array position.
//
// Nothing here enforces the layer-1 gate or the no-orphan rule — those live in
// `grammarIssues` in packages/types, shared with the AppView, which refuses to
// index what it reports (ADR-0015). A draft is allowed to be momentarily
// incoherent while it is being edited; what must not happen is *publishing* it.

/** The parts of speech a language has bound, in record order. */
export function posRows(grammar: Grammar): GrammarPos[] {
  return grammar.pos ?? [];
}

/** The feature names a language has bound, in record order. */
export function featureRows(grammar: Grammar): GrammarFeature[] {
  return grammar.features ?? [];
}

/**
 * The features this language declared itself — what the inflection-class
 * section lists.
 *
 * An inflection class **is a minted feature and nothing more**: a Latin
 * declension or a French conjugation group is a feature whose name and whose
 * values this language declares, because neither UD nor UniMorph defines a
 * paradigm object for it to borrow. So there is no class mechanism to store and
 * this is a *view* over `features`, never a second home.
 *
 * The set is therefore "minted features", which will also catch one minted for
 * something that is not a class at all. That imprecision is deliberate and
 * cheap: both sections edit the same rows, so the cost is a row appearing in
 * two places rather than a fact having two homes.
 */
export function classRows(grammar: Grammar): GrammarFeature[] {
  return featureRows(grammar).filter(
    (row) => row.scheme !== undefined && row.lexicographic !== true,
  );
}

/**
 * The lexicographic label sets — register, domain, editorial usage: "archaic",
 * "neologism", "by extension".
 *
 * Structurally a minted feature, exactly as an inflection class is, and for the
 * same reason: a set of named options a language declares, which UD has no
 * vocabulary for. What differs is what the options *mean*. A class says which
 * paradigm a word follows, so the grammatical layers build on it; a
 * lexicographic set says how a word is used, so they must not — a table of
 * "archaic" against "by extension" addresses no cell.
 *
 * The two are told apart by the flag rather than by which door they were added
 * through, so the row stays in one section however the record is reopened.
 */
export function lexicalRows(grammar: Grammar): GrammarFeature[] {
  return featureRows(grammar).filter((row) => row.lexicographic === true);
}

/**
 * The features the grammatical layers may use — everything but the
 * lexicographic sets. Inflection classes stay in this list: they are minted,
 * but they are grammar.
 */
export function grammaticalFeatureRows(grammar: Grammar): GrammarFeature[] {
  return featureRows(grammar).filter((row) => row.lexicographic !== true);
}

/** The plain abbreviations a language declares, in record order. */
export function abbreviationRows(grammar: Grammar): GrammarAbbreviation[] {
  return grammar.abbreviations ?? [];
}

/** The abbreviation with this short form, if any. */
export function findAbbreviation(
  grammar: Grammar,
  short: string,
): GrammarAbbreviation | undefined {
  return abbreviationRows(grammar).find((row) => row.short === short);
}

/**
 * Add an abbreviation, replacing any existing one with the same short form —
 * matched on `short` alone, because that is the row's identity and not merely
 * one of its two strings.
 */
export function upsertAbbreviation(grammar: Grammar, row: GrammarAbbreviation): Grammar {
  const rows = abbreviationRows(grammar);
  const at = rows.findIndex((r) => r.short === row.short);
  const abbreviations = at === -1 ? [...rows, row] : rows.map((r, i) => (i === at ? row : r));
  return tidy({ ...grammar, abbreviations });
}

/** Remove an abbreviation. Nothing references it, so nothing can be orphaned. */
export function removeAbbreviation(grammar: Grammar, short: string): Grammar {
  return tidy({
    ...grammar,
    abbreviations: abbreviationRows(grammar).filter((row) => row.short !== short),
  });
}

/**
 * The bound values of one feature — the reason `values` rows carry their
 * feature rather than being folded into bundles: this is a lookup.
 */
export function valueRows(grammar: Grammar, feature: string): GrammarValue[] {
  return (grammar.values ?? []).filter((row) => row.feature === feature);
}

/**
 * The bound part of speech matching this one, if any — matched by its UPOS
 * name, for the reason `findFeature` is matched by its: the editor addresses a
 * part of speech by name, so a language holding "NOUN" twice under two
 * provenances would have one row it could reach and one it could not.
 */
export function findPos(grammar: Grammar, value: string): GrammarPos | undefined {
  return posRows(grammar).find((row) => row.value === value);
}

/**
 * The bound feature name matching this one, if any — matched **by name, never
 * by scheme**, which is the rule the whole model already runs on: `inherent`
 * and `axes` rows name a bare feature, and `boundFeatureNames` /
 * `isLexicographic` in packages/types compare names. So a feature name is one
 * row per language whatever provenance it carries, and every minted one — an
 * inflection class, a lexicographic label set — is reachable through a path
 * that carries only its name.
 */
export function findFeature(grammar: Grammar, feature: string): GrammarFeature | undefined {
  return featureRows(grammar).find((row) => row.feature === feature);
}

/**
 * The identity of a value row *within one language's grammar*: its feature and
 * its own name, with provenance dropped and any multivalue item normalised into
 * UD's order — the same `valueMatchKey` rule an axis is matched by. Scheme is a
 * property of the row, not part of what tells two rows apart here: two rows for
 * one (feature, value) would be two labels the interface could not tell apart,
 * which is exactly what ADR-0010 keys the labels model to prevent.
 */
function valueName(row: { feature: string; value: string }): string {
  return tagKey(valueTag({ feature: row.feature, value: row.value }));
}

/** The bound value matching this one, if any. */
export function findValue(
  grammar: Grammar,
  feature: string,
  value: string,
): GrammarValue | undefined {
  const key = valueName({ feature, value });
  return (grammar.values ?? []).find((row) => valueName(row) === key);
}

/** Drop the arrays an edit emptied, so an untouched record stays untouched. */
function tidy(grammar: Grammar): Grammar {
  const out: Grammar = {};
  if ((grammar.pos ?? []).length > 0) out.pos = grammar.pos;
  if ((grammar.features ?? []).length > 0) out.features = grammar.features;
  if ((grammar.values ?? []).length > 0) out.values = grammar.values;
  if ((grammar.inherent ?? []).length > 0) out.inherent = grammar.inherent;
  if ((grammar.bindings ?? []).length > 0) out.bindings = grammar.bindings;
  if ((grammar.axes ?? []).length > 0) out.axes = grammar.axes;
  if ((grammar.layout ?? []).length > 0) out.layout = grammar.layout;
  return out;
}

/** Bind a part of speech, replacing any existing binding of the same one. */
export function upsertPos(grammar: Grammar, row: GrammarPos): Grammar {
  const rows = posRows(grammar);
  const at = rows.findIndex((r) => r.value === row.value);
  const pos = at === -1 ? [...rows, row] : rows.map((r, i) => (i === at ? row : r));
  return tidy({ ...grammar, pos });
}

/** Unbind a part of speech. */
export function removePos(grammar: Grammar, value: string): Grammar {
  return tidy({ ...grammar, pos: posRows(grammar).filter((r) => r.value !== value) });
}

/**
 * Bind a feature name, replacing any existing binding of the same one — matched
 * by name, as `findFeature` is, so re-minting a borrowed name (or un-minting a
 * minted one) rewrites the row in place instead of leaving two behind.
 */
export function upsertFeature(grammar: Grammar, row: GrammarFeature): Grammar {
  const rows = featureRows(grammar);
  const at = rows.findIndex((r) => r.feature === row.feature);
  const features = at === -1 ? [...rows, row] : rows.map((r, i) => (i === at ? row : r));
  return tidy({ ...grammar, features });
}

/**
 * Unbind a feature name. Deliberately does **not** cascade to its values: the
 * result would orphan them, which `grammarDiff` then reports and the editor
 * refuses to publish. Deleting a contributor's value bindings as a side effect
 * of an unbind would be a far worse outcome than making them say so first.
 */
export function removeFeature(grammar: Grammar, feature: string): Grammar {
  return tidy({
    ...grammar,
    features: featureRows(grammar).filter((r) => r.feature !== feature),
  });
}

/** Bind a feature value, replacing any existing binding of the same one. */
export function upsertValue(grammar: Grammar, row: GrammarValue): Grammar {
  const key = valueName(row);
  const rows = grammar.values ?? [];
  const at = rows.findIndex((r) => valueName(r) === key);
  const values = at === -1 ? [...rows, row] : rows.map((r, i) => (i === at ? row : r));
  return tidy({ ...grammar, values });
}

/** Unbind a feature value. */
export function removeValue(grammar: Grammar, feature: string, value: string): Grammar {
  const key = valueName({ feature, value });
  return tidy({
    ...grammar,
    values: (grammar.values ?? []).filter((r) => valueName(r) !== key),
  });
}

// ---- layer 2 -------------------------------------------------------------

/** The inherence declarations made on exactly this category, in record order. */
export function inherentRows(grammar: Grammar, category: Tag): GrammarInherent[] {
  const key = tagKey(category);
  return (grammar.inherent ?? []).filter((row) => tagKey(row.category) === key);
}

/** Declare a feature inherent to a category (a no-op when already declared). */
export function addInherent(grammar: Grammar, row: GrammarInherent): Grammar {
  const key = inherentKey(row);
  if ((grammar.inherent ?? []).some((r) => inherentKey(r) === key)) return grammar;
  return tidy({ ...grammar, inherent: [...(grammar.inherent ?? []), row] });
}

/**
 * Withdraw an inherence declaration. Deliberately does **not** cascade to the
 * combinations standing on it — the same reasoning as `removeFeature`: the
 * result may be ungrounded, `grammarDiff` reports it, and the editor refuses
 * to publish. Deleting labelled rows as a side effect would be worse than
 * making the contributor say so first.
 */
export function removeInherent(grammar: Grammar, row: GrammarInherent): Grammar {
  const key = inherentKey(row);
  return tidy({
    ...grammar,
    inherent: (grammar.inherent ?? []).filter((r) => inherentKey(r) !== key),
  });
}

/** The combinations a language has named, in record order. */
export function combinationRows(grammar: Grammar): GrammarCombination[] {
  return grammar.bindings ?? [];
}

/** The named combination matching this tag, if any. */
export function findCombination(grammar: Grammar, tag: Tag): GrammarCombination | undefined {
  const key = tagKey(tag);
  return (grammar.bindings ?? []).find((row) => tagKey(row.tag) === key);
}

/** Name a combination, replacing any existing label for the same tag. */
export function upsertCombination(grammar: Grammar, row: GrammarCombination): Grammar {
  const key = tagKey(row.tag);
  const rows = grammar.bindings ?? [];
  const at = rows.findIndex((r) => tagKey(r.tag) === key);
  const bindings = at === -1 ? [...rows, row] : rows.map((r, i) => (i === at ? row : r));
  return tidy({ ...grammar, bindings });
}

/** Remove a combination's label. Its parts stay bound; decomposition renders it. */
export function removeCombination(grammar: Grammar, tag: Tag): Grammar {
  const key = tagKey(tag);
  return tidy({
    ...grammar,
    bindings: (grammar.bindings ?? []).filter((r) => tagKey(r.tag) !== key),
  });
}

// ---- layer 3 -------------------------------------------------------------

/** The axes declared on exactly this category, in record order. */
export function axisRows(grammar: Grammar, category: Tag): GrammarAxis[] {
  const key = tagKey(category);
  return (grammar.axes ?? []).filter((row) => tagKey(row.category) === key);
}

/** The axis declared for this (category, feature), if any. */
export function findAxis(
  grammar: Grammar,
  category: Tag,
  feature: string,
): GrammarAxis | undefined {
  const key = axisKey({ category, feature });
  return (grammar.axes ?? []).find((row) => axisKey(row) === key);
}

/**
 * Declare a feature an axis of a category, with no values yet — the
 * contributor picks them next. A row with no values is deliberately
 * publishable-blocking rather than impossible: it is reported as `empty-axis`,
 * which says "you declared this varies but not what over", and that is more
 * useful than silently refusing the declaration halfway through making it.
 */
export function addAxis(grammar: Grammar, category: Tag, feature: string): Grammar {
  if (findAxis(grammar, category, feature) !== undefined) return grammar;
  return tidy({ ...grammar, axes: [...(grammar.axes ?? []), { category, feature, values: [] }] });
}

/** Withdraw an axis declaration entirely, values and all. */
export function removeAxis(grammar: Grammar, category: Tag, feature: string): Grammar {
  const key = axisKey({ category, feature });
  return tidy({ ...grammar, axes: (grammar.axes ?? []).filter((r) => axisKey(r) !== key) });
}

/** Replace an axis's value list, keeping the row's position in the record. */
function withAxisValues(
  grammar: Grammar,
  category: Tag,
  feature: string,
  values: string[],
): Grammar {
  const key = axisKey({ category, feature });
  return tidy({
    ...grammar,
    axes: (grammar.axes ?? []).map((r) => (axisKey(r) === key ? { ...r, values } : r)),
  });
}

/**
 * Add or remove one value of an axis. A newly ticked value is **appended**,
 * never inserted in the language's `values` order: an axis's order is a
 * grammatical claim the contributor makes here, so it starts as the order they
 * ticked them in and is theirs to rearrange.
 */
export function toggleAxisValue(
  grammar: Grammar,
  category: Tag,
  feature: string,
  value: string,
): Grammar {
  const axis = findAxis(grammar, category, feature);
  if (axis === undefined) return grammar;
  const values = axis.values.includes(value)
    ? axis.values.filter((v) => v !== value)
    : [...axis.values, value];
  return withAxisValues(grammar, category, feature, values);
}

/** Move one of an axis's values one place earlier or later. */
export function moveAxisValue(
  grammar: Grammar,
  category: Tag,
  feature: string,
  value: string,
  direction: -1 | 1,
): Grammar {
  const axis = findAxis(grammar, category, feature);
  if (axis === undefined) return grammar;
  const at = axis.values.indexOf(value);
  const to = at + direction;
  if (at === -1 || to < 0 || to >= axis.values.length) return grammar;
  const values = [...axis.values];
  [values[at], values[to]] = [values[to]!, values[at]!];
  return withAxisValues(grammar, category, feature, values);
}

// ---- layer 4 -------------------------------------------------------------
//
// A layout holds no vocabulary: every edit here moves, orders or pins something
// layers 1 and 3 already declared. So these functions never mint a label and
// never touch another array — the worst an incoherent one can do is arrange
// nothing, which `grammarIssues` reports as an empty block.

/** The layout declared for exactly this category, if any. */
export function layoutRow(grammar: Grammar, category: Tag): GrammarLayout | undefined {
  const key = tagKey(category);
  return (grammar.layout ?? []).find((row) => tagKey(row.category) === key);
}

/**
 * Declare a layout for a category, opened on **one empty table** rather than on
 * nothing.
 *
 * The same choice `addAxis` makes, for the same reason: a row that says "laid
 * out, but not along what" is reported as `empty-layout-block` and blocks the
 * publish, which is more use to a contributor than refusing the declaration
 * halfway through making it. It also keeps the record within its own contract,
 * where `blocks` has a minimum of one.
 */
export function addLayout(grammar: Grammar, category: Tag): Grammar {
  if (layoutRow(grammar, category) !== undefined) return grammar;
  return tidy({
    ...grammar,
    layout: [...(grammar.layout ?? []), { category, blocks: [{ kind: "table" }] }],
  });
}

/** Withdraw a category's layout entirely. Its forms fall back to the flat list. */
export function removeLayout(grammar: Grammar, category: Tag): Grammar {
  const key = tagKey(category);
  return tidy({
    ...grammar,
    layout: (grammar.layout ?? []).filter((row) => tagKey(row.category) !== key),
  });
}

/** Replace a layout's blocks, dropping the layout when none are left. */
function withBlocks(grammar: Grammar, category: Tag, blocks: LayoutBlock[]): Grammar {
  if (blocks.length === 0) return removeLayout(grammar, category);
  const key = tagKey(category);
  return tidy({
    ...grammar,
    layout: (grammar.layout ?? []).map((row) =>
      tagKey(row.category) === key ? { ...row, blocks } : row,
    ),
  });
}

/** Rewrite one block of a layout, leaving the others alone. */
function withBlock(
  grammar: Grammar,
  category: Tag,
  index: number,
  edit: (block: LayoutBlock) => LayoutBlock,
): Grammar {
  const row = layoutRow(grammar, category);
  if (row === undefined || index < 0 || index >= row.blocks.length) return grammar;
  return withBlocks(
    grammar,
    category,
    row.blocks.map((block, i) => (i === index ? edit(block) : block)),
  );
}

/**
 * The same block without one optional key — so an edit that empties an array
 * drops it, exactly as `tidy` drops an emptied top-level one, and an untouched
 * record stays byte-for-byte untouched.
 */
function omitKey(
  block: LayoutBlock,
  key: "fixed" | "exclude" | "rows" | "columns",
): LayoutBlock {
  const copy = { ...block } as Record<string, unknown>;
  delete copy[key];
  return copy as unknown as LayoutBlock;
}

/**
 * The same block with its exclusions set aside — what the designer resolves for
 * its editing grid. An excluded cell has to stay visible and clickable there, or
 * excluding one would be a one-way door; which cells those are is then asked of
 * `excludesCell`, so the editor and the viewer never disagree about the rule.
 */
export function blockWithoutExclusions(block: LayoutBlock): LayoutBlock {
  return omitKey(block, "exclude");
}

/** Append a block. A list starts with no items, a table with no dimensions. */
export function addBlock(grammar: Grammar, category: Tag, kind: "table" | "list"): Grammar {
  const row = layoutRow(grammar, category);
  if (row === undefined) return grammar;
  const block: LayoutBlock = kind === "list" ? { kind: "list", items: [] } : { kind: "table" };
  return withBlocks(grammar, category, [...row.blocks, block]);
}

/**
 * Remove a block — and with the last one, the whole layout: a category laid out
 * in no blocks at all is not a declaration, it is the absence of one, and the
 * fallback to a flat list is exactly what absence means.
 */
export function removeBlock(grammar: Grammar, category: Tag, index: number): Grammar {
  const row = layoutRow(grammar, category);
  if (row === undefined) return grammar;
  return withBlocks(
    grammar,
    category,
    row.blocks.filter((_, i) => i !== index),
  );
}

/** Move a block one place earlier or later — the order they are shown in. */
export function moveBlock(
  grammar: Grammar,
  category: Tag,
  index: number,
  direction: -1 | 1,
): Grammar {
  const row = layoutRow(grammar, category);
  if (row === undefined) return grammar;
  const to = index + direction;
  if (index < 0 || index >= row.blocks.length || to < 0 || to >= row.blocks.length) return grammar;
  const blocks = [...row.blocks];
  [blocks[index], blocks[to]] = [blocks[to]!, blocks[index]!];
  return withBlocks(grammar, category, blocks);
}

/** Show or stop showing a block beside the headword. */
export function toggleBlockSummary(grammar: Grammar, category: Tag, index: number): Grammar {
  return withBlock(grammar, category, index, (block) => {
    const { summary, ...rest } = block;
    return summary === true ? (rest as LayoutBlock) : { ...block, summary: true };
  });
}

/**
 * Put an axis on a dimension, or take it off. Appending rather than inserting:
 * the order of a dimension is nesting depth, a claim the contributor makes here,
 * so a newly added axis becomes the innermost until they move it.
 *
 * Adding an axis also takes it off the other dimension, because one feature on
 * both would need two of its values in a single cell address.
 */
export function toggleBlockAxis(
  grammar: Grammar,
  category: Tag,
  index: number,
  dimension: "rows" | "columns",
  feature: string,
): Grammar {
  return withBlock(grammar, category, index, (block) => {
    if (block.kind !== "table") return block;
    const on = block[dimension] ?? [];
    if (on.includes(feature)) {
      const left = on.filter((f) => f !== feature);
      return left.length === 0 ? omitKey(block, dimension) : { ...block, [dimension]: left };
    }
    const other = dimension === "rows" ? "columns" : "rows";
    const freed = (block[other] ?? []).filter((f) => f !== feature);
    const moved: LayoutBlock = { ...block, [dimension]: [...on, feature] };
    return freed.length === 0 ? omitKey(moved, other) : { ...moved, [other]: freed };
  });
}

/** Move an axis one place out or in within its dimension. */
export function moveBlockAxis(
  grammar: Grammar,
  category: Tag,
  index: number,
  dimension: "rows" | "columns",
  feature: string,
  direction: -1 | 1,
): Grammar {
  return withBlock(grammar, category, index, (block) => {
    if (block.kind !== "table") return block;
    const on = [...(block[dimension] ?? [])];
    const at = on.indexOf(feature);
    const to = at + direction;
    if (at === -1 || to < 0 || to >= on.length) return block;
    [on[at], on[to]] = [on[to]!, on[at]!];
    return { ...block, [dimension]: on };
  });
}

/**
 * Pin one feature to a value across the whole block, or unpin it. At most one
 * value per feature: a constant that is two values is not a constant.
 */
export function setBlockFixed(
  grammar: Grammar,
  category: Tag,
  index: number,
  feature: string,
  value: string | null,
): Grammar {
  return withBlock(grammar, category, index, (block) => {
    const rest = (block.fixed ?? []).filter((coord) => coord.feature !== feature);
    const fixed = value === null ? rest : [...rest, { feature, value }];
    return fixed.length === 0 ? omitKey(block, "fixed") : { ...block, fixed };
  });
}

/**
 * Exclude the cell at these coordinates, or put it back.
 *
 * Putting it back removes **every** exclusion covering the cell, which matters
 * only for a record authored elsewhere: a partial exclusion covering a whole
 * slice is removed whole rather than split around the cell that was clicked.
 * Splitting would invent rows nobody wrote, and this editor only ever writes
 * complete addresses.
 */
export function toggleExcludedCell(
  grammar: Grammar,
  category: Tag,
  index: number,
  coords: LayoutCoord[],
): Grammar {
  return withBlock(grammar, category, index, (block) => {
    if (block.kind !== "table" || coords.length === 0) return block;
    if (excludesCell(block, coords)) {
      const kept = (block.exclude ?? []).filter(
        (cell) => !(cell.coords.length > 0 && excludesCell({ exclude: [cell] }, coords)),
      );
      return kept.length === 0 ? omitKey(block, "exclude") : { ...block, exclude: kept };
    }
    return { ...block, exclude: [...(block.exclude ?? []), { coords }] };
  });
}

/** Append an address to a list block. */
export function addListItem(
  grammar: Grammar,
  category: Tag,
  index: number,
  coords: LayoutCoord[],
): Grammar {
  return withBlock(grammar, category, index, (block) => {
    if (block.kind !== "list" || coords.length === 0) return block;
    return { ...block, items: [...(block.items ?? []), { coords }] };
  });
}

/** Remove one address from a list block. */
export function removeListItem(
  grammar: Grammar,
  category: Tag,
  index: number,
  item: number,
): Grammar {
  return withBlock(grammar, category, index, (block) => {
    if (block.kind !== "list") return block;
    return { ...block, items: (block.items ?? []).filter((_, i) => i !== item) };
  });
}

/** Move one address of a list block earlier or later — the order it prints in. */
export function moveListItem(
  grammar: Grammar,
  category: Tag,
  index: number,
  item: number,
  direction: -1 | 1,
): Grammar {
  return withBlock(grammar, category, index, (block) => {
    if (block.kind !== "list") return block;
    const items = [...(block.items ?? [])];
    const to = item + direction;
    if (item < 0 || item >= items.length || to < 0 || to >= items.length) return block;
    [items[item], items[to]] = [items[to]!, items[item]!];
    return { ...block, items };
  });
}
