import {
  axisKey,
  featureKey,
  inherentKey,
  posTag,
  tagKey,
  valueTag,
  type Grammar,
  type GrammarAxis,
  type GrammarCombination,
  type GrammarFeature,
  type GrammarInherent,
  type GrammarPos,
  type GrammarValue,
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
// `grammarIssues`/`grammarDiff` in packages/types, shared with the AppView.
// A draft is allowed to be momentarily incoherent while it is being edited;
// what must not happen is *publishing* it.

/** The parts of speech a language has bound, in record order. */
export function posRows(grammar: Grammar): GrammarPos[] {
  return grammar.pos ?? [];
}

/** The feature names a language has bound, in record order. */
export function featureRows(grammar: Grammar): GrammarFeature[] {
  return grammar.features ?? [];
}

/**
 * The bound values of one feature — the reason `values` rows carry their
 * feature rather than being folded into bundles: this is a lookup.
 */
export function valueRows(grammar: Grammar, feature: string): GrammarValue[] {
  return (grammar.values ?? []).filter((row) => row.feature === feature);
}

/** The bound part of speech matching this one, if any. */
export function findPos(
  grammar: Grammar,
  value: string,
  scheme?: string,
): GrammarPos | undefined {
  const key = tagKey(posTag({ value, scheme }));
  return posRows(grammar).find((row) => tagKey(posTag(row)) === key);
}

/** The bound feature name matching this one, if any. */
export function findFeature(
  grammar: Grammar,
  feature: string,
  scheme?: string,
): GrammarFeature | undefined {
  const key = featureKey({ feature, scheme });
  return featureRows(grammar).find((row) => featureKey(row) === key);
}

/** The bound value matching this one, if any. */
export function findValue(
  grammar: Grammar,
  feature: string,
  value: string,
  scheme?: string,
): GrammarValue | undefined {
  const key = tagKey(valueTag({ feature, value, scheme }));
  return (grammar.values ?? []).find((row) => tagKey(valueTag(row)) === key);
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
  const key = tagKey(posTag(row));
  const rows = posRows(grammar);
  const at = rows.findIndex((r) => tagKey(posTag(r)) === key);
  const pos = at === -1 ? [...rows, row] : rows.map((r, i) => (i === at ? row : r));
  return tidy({ ...grammar, pos });
}

/** Unbind a part of speech. */
export function removePos(grammar: Grammar, value: string, scheme?: string): Grammar {
  const key = tagKey(posTag({ value, scheme }));
  return tidy({ ...grammar, pos: posRows(grammar).filter((r) => tagKey(posTag(r)) !== key) });
}

/** Bind a feature name, replacing any existing binding of the same one. */
export function upsertFeature(grammar: Grammar, row: GrammarFeature): Grammar {
  const key = featureKey(row);
  const rows = featureRows(grammar);
  const at = rows.findIndex((r) => featureKey(r) === key);
  const features = at === -1 ? [...rows, row] : rows.map((r, i) => (i === at ? row : r));
  return tidy({ ...grammar, features });
}

/**
 * Unbind a feature name. Deliberately does **not** cascade to its values: the
 * result would orphan them, which `grammarDiff` then reports and the editor
 * refuses to publish. Deleting a contributor's value bindings as a side effect
 * of an unbind would be a far worse outcome than making them say so first.
 */
export function removeFeature(grammar: Grammar, feature: string, scheme?: string): Grammar {
  const key = featureKey({ feature, scheme });
  return tidy({
    ...grammar,
    features: featureRows(grammar).filter((r) => featureKey(r) !== key),
  });
}

/** Bind a feature value, replacing any existing binding of the same one. */
export function upsertValue(grammar: Grammar, row: GrammarValue): Grammar {
  const key = tagKey(valueTag(row));
  const rows = grammar.values ?? [];
  const at = rows.findIndex((r) => tagKey(valueTag(r)) === key);
  const values = at === -1 ? [...rows, row] : rows.map((r, i) => (i === at ? row : r));
  return tidy({ ...grammar, values });
}

/** Unbind a feature value. */
export function removeValue(
  grammar: Grammar,
  feature: string,
  value: string,
  scheme?: string,
): Grammar {
  const key = tagKey(valueTag({ feature, value, scheme }));
  return tidy({
    ...grammar,
    values: (grammar.values ?? []).filter((r) => tagKey(valueTag(r)) !== key),
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
