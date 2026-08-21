import {
  categoryKey,
  inherentKey,
  RETIRED_GRAMMAR_KEYS,
  tagKey,
  valueTag,
  type Grammar,
  type GrammarAbbreviation,
  type GrammarAnnotation,
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
 * bundle, which is the row's identity: one row per category, so declaring an
 * axis and naming a headword flavour are two edits to one row rather than two
 * rows.
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
 * Declare, or change, the feature a category's forms vary over.
 *
 * **Every annotation loses its `default`**, whichever way the axis moved. A
 * default is an address under one particular feature, so carrying `Sing` across
 * from `Number` to `Case` would keep a string and lose its meaning — and
 * `grammarIssues` would then report an unbound value where what actually
 * happened is that nobody has said yet where these headwords sit. The labels
 * are the contributor's writing and are kept; the addresses are the editor's
 * and are asked for again.
 *
 * A no-op when the category has no row yet: a declaration is carried by its
 * annotations (the lexicon requires at least one), so there is nothing for an
 * axis to ride on until the category is named. The dialog holds a *pending*
 * axis for that case and passes it to `upsertAnnotation`, which is what keeps
 * the draft shape-valid at every moment rather than only at publish time.
 */
export function setCategoryAxis(
  grammar: Grammar,
  category: Tag,
  axis: string | undefined,
): Grammar {
  const row = findCategory(grammar, category);
  if (row === undefined || row.axis === axis) return grammar;
  return upsertCategory(grammar, {
    category,
    ...(axis !== undefined ? { axis } : {}),
    annotations: row.annotations.map(({ long, short }) => ({
      long,
      ...(short !== undefined ? { short } : {}),
    })),
  });
}

/**
 * Write one annotation of a category, creating the declaration when this is its
 * first — an index past the end appends, which is how "add another abbreviation"
 * and "edit this one" are the same call.
 *
 * `axis` is used **only when the row is being created**: an existing row's own
 * axis wins, because changing it is `setCategoryAxis`' business and doing it
 * here as a side effect of naming would silently drop the other annotations'
 * defaults.
 */
export function upsertAnnotation(
  grammar: Grammar,
  category: Tag,
  index: number,
  annotation: GrammarAnnotation,
  axis?: string,
): Grammar {
  const row = findCategory(grammar, category);
  const annotations = row === undefined ? [] : [...row.annotations];
  if (index >= 0 && index < annotations.length) annotations[index] = annotation;
  else annotations.push(annotation);
  const declared = row?.axis ?? axis;
  return upsertCategory(grammar, {
    category,
    ...(declared !== undefined ? { axis: declared } : {}),
    annotations,
  });
}

/**
 * Remove one annotation. Removing the **last** one withdraws the declaration
 * itself: a category with no annotation names nothing, and the lexicon refuses
 * it outright (`minLength: 1`), so leaving an empty row behind would be leaving
 * a draft that publishes into silence.
 */
export function removeAnnotation(grammar: Grammar, category: Tag, index: number): Grammar {
  const row = findCategory(grammar, category);
  if (row === undefined) return grammar;
  const annotations = row.annotations.filter((_, i) => i !== index);
  if (annotations.length === 0) return removeCategory(grammar, category);
  return upsertCategory(grammar, {
    category,
    ...(row.axis !== undefined ? { axis: row.axis } : {}),
    annotations,
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

// ---- loading a record written before the merge ---------------------------

/**
 * A `grammar` object as some record on a PDS actually holds it — which may be
 * any shape at all, and in practice is often the pre-ADR-0019 one.
 */
type StoredGrammar = Grammar & {
  /** Layer 2's combinations, renamed `categories` by ADR-0019. */
  bindings?: { tag: Tag; label: { long: string; short?: string } }[];
  /** Layer 3's standalone axes, retired by ADR-0019. */
  axes?: unknown;
  /** Layer 4's table shapes, moved into the paradigm record by ADR-0019. */
  layout?: unknown;
};

/**
 * The draft to open the binding editor on, from the grammar a record carries.
 *
 * **This is the only migration path a pre-merge record has, and it has to be
 * here rather than at ingest.** The AppView refuses a record still carrying
 * `axes` or `layout` (they declare things this lexicon no longer defines), and
 * it ignores `bindings` the way it ignores any renamed field. So a contributor
 * opening a language declared before the merge would otherwise load those keys
 * into the draft invisibly, see no defect — `grammarIssues` cannot report a
 * field it does not know — and have every publish silently refused.
 *
 * Two different acts, deliberately not one:
 *
 * - **`bindings` is carried forward**, one category per row with a single
 *   annotation. That is exactly the shape this editor writes for a named
 *   combination, and a one-atom row maps too: a bare part of speech is a
 *   headword category now, which is what the merge inverted. Nothing is lost
 *   and nobody has to retype a label.
 * - **`axes` and `layout` are dropped.** They cannot be carried forward, and
 *   pretending otherwise would be worse than losing them. An axis's *feature*
 *   could be moved onto its category, but which of its values a headword sits at
 *   — the whole point of the merge — is a lexicographic judgement nobody has
 *   made yet, so the guessed category would be incoherent on arrival. A layout
 *   has no home here at all: its cells belong to a paradigm record.
 *
 * The dropped declarations stay on the record until the contributor publishes
 * over them, so nothing is destroyed by opening the dialog.
 */
/**
 * Whether a loaded record still holds any declaration ADR-0019 retired — so the
 * editor can say that publishing will rewrite it.
 *
 * Worth telling a contributor, because the alternative is a Publish button that
 * is enabled the moment the dialog opens, with nothing on screen changed and an
 * `axes` declaration quietly going away when they press it. That a rewrite is
 * *needed* does not make it something to do behind their back.
 */
export function carriesRetiredGrammar(grammar: Grammar | undefined): boolean {
  if (grammar === undefined) return false;
  const stored = grammar as StoredGrammar & Record<string, unknown>;
  if ((stored.bindings ?? []).length > 0) return true;
  return RETIRED_GRAMMAR_KEYS.some((key) => stored[key] !== undefined);
}

export function draftFromRecord(grammar: Grammar | undefined): Grammar {
  if (grammar === undefined) return {};
  const stored = grammar as StoredGrammar;
  const carried = (stored.bindings ?? [])
    .filter((row) => row.tag !== undefined && typeof row.label?.long === "string")
    .map((row) => ({
      category: row.tag,
      annotations: [
        {
          long: row.label.long,
          ...(row.label.short !== undefined ? { short: row.label.short } : {}),
        },
      ],
    }));
  // A row already in `categories` wins: a record carrying both is one whose
  // author has begun the rewrite, and their newer declaration is the truth.
  const declared = categoryRows(grammar);
  const declaredKeys = new Set(declared.map((row) => categoryKey(row)));
  return tidy({
    pos: grammar.pos,
    features: grammar.features,
    values: grammar.values,
    inherent: grammar.inherent,
    categories: [
      ...declared,
      ...carried.filter((row) => !declaredKeys.has(categoryKey(row))),
    ],
    abbreviations: grammar.abbreviations,
  });
}
