import {
  featureKey,
  posTag,
  tagKey,
  valueTag,
  type Grammar,
  type GrammarFeature,
  type GrammarPos,
  type GrammarValue,
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
