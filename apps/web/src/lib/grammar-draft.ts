import {
  categoryKey,
  inherentKey,
  isValidGrammar,
  migrateGrammar,
  RETIRED_GRAMMAR_KEYS,
  tagKey,
  valueTag,
  type Grammar,
  type GrammarAbbreviation,
  type GrammarCategory,
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

/** The abbreviation with this identity, if any. */
export function findAbbreviation(
  grammar: Grammar,
  value: string,
): GrammarAbbreviation | undefined {
  return abbreviationRows(grammar).find((row) => row.value === value);
}

/**
 * Add an abbreviation, replacing any existing one with the same identity —
 * matched on `value` alone, which is what makes correcting the printed form an
 * edit rather than a delete-and-re-add (ADR-0020).
 */
export function upsertAbbreviation(grammar: Grammar, row: GrammarAbbreviation): Grammar {
  const rows = abbreviationRows(grammar);
  const at = rows.findIndex((r) => r.value === row.value);
  const abbreviations = at === -1 ? [...rows, row] : rows.map((r, i) => (i === at ? row : r));
  return tidy({ ...grammar, abbreviations });
}

/** Remove an abbreviation. Nothing references it, so nothing can be orphaned. */
export function removeAbbreviation(grammar: Grammar, value: string): Grammar {
  return tidy({
    ...grammar,
    abbreviations: abbreviationRows(grammar).filter((row) => row.value !== value),
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
 * UD's order — the same `valueMatchKey` rule a cell coordinate is matched by. Scheme is a
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

/**
 * Drop the arrays an edit emptied, so an untouched record stays untouched.
 *
 * **Every array of the object, without exception** — a rebuilt literal is how
 * this function works, so an array missing from the list is one silently dropped
 * on the next edit of any other. `abbreviations` was missing here until ADR-0019
 * rewrote the function, which meant every abbreviation a contributor added was
 * discarded by the very call that added it.
 */
function tidy(grammar: Grammar): Grammar {
  const out: Grammar = {};
  if ((grammar.pos ?? []).length > 0) out.pos = grammar.pos;
  if ((grammar.features ?? []).length > 0) out.features = grammar.features;
  if ((grammar.values ?? []).length > 0) out.values = grammar.values;
  if ((grammar.inherent ?? []).length > 0) out.inherent = grammar.inherent;
  if ((grammar.categories ?? []).length > 0) out.categories = grammar.categories;
  if ((grammar.abbreviations ?? []).length > 0) out.abbreviations = grammar.abbreviations;
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

/** The category declarations a language has made, in record order. */
export function categoryRows(grammar: Grammar): GrammarCategory[] {
  return grammar.categories ?? [];
}

/**
 * The declaration for exactly this category, if any — matched on the category
 * bundle, which is the row's identity: one row per category, and since ADR-0020
 * one label per row, so a headword flavour cited differently is a row of its
 * own rather than a second name on this one.
 */
export function findCategory(grammar: Grammar, category: Tag): GrammarCategory | undefined {
  const key = categoryKey({ category });
  return categoryRows(grammar).find((row) => categoryKey(row) === key);
}

/** Declare or rewrite a category, keeping its position in the record. */
export function upsertCategory(grammar: Grammar, row: GrammarCategory): Grammar {
  const key = categoryKey(row);
  const rows = categoryRows(grammar);
  const at = rows.findIndex((r) => categoryKey(r) === key);
  const categories = at === -1 ? [...rows, row] : rows.map((r, i) => (i === at ? row : r));
  return tidy({ ...grammar, categories });
}

/**
 * Name a category, or rewrite its name and its note — creating the declaration
 * when this is its first, which is what makes "name this category" and "edit
 * this name" one call.
 *
 * One label per category since ADR-0020, so there is no index to write at and
 * no annotation list to keep in order: the bundle is the identity and the label
 * is what is written on it.
 */
export function nameCategory(
  grammar: Grammar,
  category: Tag,
  label: GrammarCategory["label"],
  note?: string,
): Grammar {
  return upsertCategory(grammar, {
    category,
    label,
    ...(note !== undefined && note !== "" ? { note } : {}),
  });
}

/**
 * Withdraw a category declaration. Its atoms stay bound and its parts stay
 * named, so an entry carrying the bundle simply renders by decomposition again.
 */
export function removeCategory(grammar: Grammar, category: Tag): Grammar {
  const key = categoryKey({ category });
  return tidy({
    ...grammar,
    categories: categoryRows(grammar).filter((row) => categoryKey(row) !== key),
  });
}

// ---- loading a record written before the current shape --------------------

/**
 * Whether a loaded record still holds a declaration this lexicon has left
 * behind — so the editor can say that publishing will rewrite it.
 *
 * Worth telling a contributor, because the alternative is a Publish button that
 * is enabled the moment the dialog opens, with nothing on screen changed and an
 * `axes` declaration quietly going away when they press it. That a rewrite is
 * *needed* does not make it something to do behind their back.
 *
 * Three generations answer yes: ADR-0019's `bindings`, `axes` and `layout`, and
 * ADR-0020's per-flavour `annotations` and short-form-keyed abbreviations.
 */
export function carriesLegacyGrammar(grammar: Grammar | undefined): boolean {
  if (grammar === undefined) return false;
  const stored = grammar as Record<string, unknown>;
  if (Array.isArray(stored.bindings) && stored.bindings.length > 0) return true;
  if (RETIRED_GRAMMAR_KEYS.some((key) => stored[key] !== undefined)) return true;
  const categories = stored.categories;
  if (
    Array.isArray(categories) &&
    categories.some((row) => row !== null && typeof row === "object" && "annotations" in row)
  ) {
    return true;
  }
  const abbreviations = stored.abbreviations;
  return (
    Array.isArray(abbreviations) &&
    abbreviations.some(
      (row) => row !== null && typeof row === "object" && !("value" in row),
    )
  );
}

/**
 * The draft to open the binding editor on, from the grammar a record carries.
 *
 * **The forward map is `migrateGrammar` in packages/types** — shared with the
 * record reader, so an old record renders the same way it edits — and this adds
 * only what is the editor's business: tidying the arrays a map may have emptied,
 * and refusing to hand over a shape the checker cannot recognise, which would
 * otherwise reach the publish button as a record the AppView drops.
 *
 * The dropped declarations stay on the record until the contributor publishes
 * over them, so nothing is destroyed by opening the dialog.
 */
export function draftFromRecord(grammar: Grammar | undefined): Grammar {
  if (grammar === undefined) return {};
  const migrated = migrateGrammar(grammar);
  if (!isValidGrammar(migrated)) {
    console.warn("a language record's grammar could not be mapped forward; opening it empty");
    return {};
  }
  return tidy(migrated);
}
