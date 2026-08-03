// Contract for the `grammar` sub-object of an eu.leksis.language record —
// layers 1 to 4 of the grammar layer (docs/design/grammatical-tagging.md).
//
// A language declares the grammatical vocabulary it uses by *binding* each
// atom to a homolingual label. Binding is not merely labelling: it is how a
// language declares its inventory, so what a language has bound is what the
// higher layers may offer. `Gender=Neut` left unbound in French means neuter
// never appears as an option downstream.
//
// That cascade governs **authoring, never rendering**. A tag arriving unbound
// — from a bot, or from another AppView — still renders, verbatim and styled
// as unbound. A viewer that rejected unbound tags would make the AppView the
// arbiter of a language's grammar, which is precisely what this design refuses
// to be.
//
// Layer 1 declares three kinds of atom, one array each, and every fact has
// exactly one home:
//
//   pos      — a part of speech this language uses
//   features — a feature *name*: the axis header, and the gate below
//   values   — a value, stating which feature it is an option of
//
// Layer 2 declares what those atoms combine into, in two more arrays:
//
//   inherent — "for this category, this feature is inherent": a property of
//              the word itself rather than of one of its forms
//   bindings — a label for a combination of two or more atoms ("nf.")
//
// The two are gated the same way layer 1 gates a value behind its feature
// name: a combination has to be reachable through the inherence declarations
// that build it up. One rule at two levels — which is why both render as
// navigation in the editor rather than as validation errors.
//
// Layer 3 adds the other half of that declaration, in one more array:
//
//   axes     — "for this category, this feature varies across its forms",
//              naming the values it varies over, in order
//
// Inherence and axes are one relation at two altitudes: layer 2 says what a
// headword *is*, layer 3 says what its forms *range over*, and together they
// are the paradigm's cell-coordinate system. They are keyed identically —
// (category, bare feature name) — so that a pair declared as both can be
// caught, which is the layer's own gate.
//
// Layer 4 arranges that cell space, in one more array:
//
//   layout   — per category, the *shape* of its tables: which axis sits on
//              which dimension, one table or several, in what order, and what
//              is shown without asking
//
// It declares no vocabulary of its own and carries no labels: every string a
// reader sees still comes from the layer-1 rows its axes and coordinates point
// at. Axes alone underdetermine presentation — four axes could be one grid with
// nested headers or four separate tables — and that gap is the whole reason the
// layer exists.

import {
  featureKey,
  formatTagVerbatim,
  isValidTag,
  isValidTagFeat,
  isValidTagUpos,
  tagKey,
  type Tag,
  type TagFeat,
  type TagUpos,
  FEATURE_NAME_PATTERN,
} from "./tag.js";

/**
 * The homolingual label a binding gives its atom — written in the language
 * being described, for a reader of that language: a Breton binding says
 * "anv-kadarn", never "noun". Same shape as an entry's annotation pair, but a
 * distinct type: this one belongs to the language record.
 */
export interface GrammarLabel {
  /** Full form — the only required half. */
  long: string;
  /** Abbreviated display form, shown instead of `long` where present. */
  short?: string;
}

/**
 * Where a binding's claim comes from. For a UD item the documentation URL is
 * derivable from the item itself, so nothing is stored; for a **minted** item
 * it is not, and the reference is what makes the compatibility claim honest —
 * UD's extension licence is conditional on the addition being "properly
 * documented".
 */
export interface GrammarReference {
  text: string;
  url?: string;
}

/** A bound part of speech: `NOUN` → "anv-kadarn" / "an.". */
export interface GrammarPos {
  value: string;
  /** Absent = a UD-documented tag; otherwise the BCP 47 tag that minted it. */
  scheme?: string;
  label: GrammarLabel;
  references?: GrammarReference[];
}

/**
 * A bound feature *name*: `Case` → "troad". Not a tag — a bare name has no
 * value — and not a chip: this is the axis header layer 4 will print, and the
 * gate every value of the feature sits behind.
 */
export interface GrammarFeature {
  feature: string;
  scheme?: string;
  label: GrammarLabel;
  references?: GrammarReference[];
}

/**
 * A bound feature *value*, stating which feature it is an option of:
 * `Gender=Fem` → "benel" / "b.". The `feature` field is what makes this a
 * declaration rather than a label — it is how "list this language's genders"
 * becomes a lookup instead of a scan over bundles.
 *
 * `scheme` qualifies the pair, so a minted value on a UD feature reads
 * naturally: `{feature: "Number", value: "Sgv", scheme: "br"}`.
 */
export interface GrammarValue {
  feature: string;
  value: string;
  scheme?: string;
  label: GrammarLabel;
  references?: GrammarReference[];
}

/**
 * "For this category, this feature is inherent" — layer 2's first step, and
 * the one no earlier design had. Without it, inherence could only be *implied*
 * by which combinations happened to exist, so the system could not tell
 * "aspect is inherent to verbs" from "somebody bound one aspectual verb
 * category".
 *
 * **Both halves are variables and no category is privileged.** `VERB × Aspect`,
 * `ADJ × Degree` and `ADP × Conjugation` (Breton conjugates its prepositions)
 * are as ordinary as `NOUN × Gender`; there is no per-part-of-speech special
 * case anywhere in the layer.
 *
 * `category` being a tag means inherence can be declared on a *combination*,
 * which is what sets the depth of the entry editor's narrowing: a declension
 * inherent to `{NOUN}` is offered straight after "n.", one inherent to
 * `{NOUN, Gender=Fem}` only once the gender has been chosen. That ordering is
 * a lexicographic judgement and it is the language's to make.
 *
 * `feature` is a bare name, matched **by name and never by scheme**, exactly
 * as a value is matched to its feature: within one record a name is
 * unambiguous, and requiring schemes to agree would break the ordinary case of
 * a minted value on a UD feature.
 */
export interface GrammarInherent {
  category: Tag;
  feature: string;
}

/**
 * A label for a combination of two or more atoms: French `{NOUN, Gender=Fem}`
 * → "nf.". A language that prints "n. f." instead binds the two atoms
 * separately and never writes a row here — decomposition renders it, and a
 * synthesised label nobody authored is precisely what the rendering chain
 * refuses to invent.
 *
 * **Two or more items, always.** A one-atom label belongs in `pos` or
 * `values`, so that every fact keeps exactly one home; a single-item row here
 * is reported by `grammarIssues` rather than silently accepted as a second way
 * to say the same thing.
 */
export interface GrammarCombination {
  tag: Tag;
  label: GrammarLabel;
  references?: GrammarReference[];
}

/**
 * "For this category, this feature **varies across its forms**" — layer 3, and
 * the exact counterpart of an inherence declaration one altitude up. Together
 * they are the paradigm's cell-coordinate system: layer 2 says what a headword
 * *is*, layer 3 says what its forms *range over*.
 *
 * **The row names its values, in order**, rather than inheriting whatever layer
 * 1 happens to have bound — because a language's inventory and one category's
 * paradigm are not the same set. A language may distinguish three genders in
 * its adjectives while splitting the masculine of its nouns in two, personal
 * and non-personal; only a per-category value list can say that, and a
 * declaration that spanned every bound value could not. Naming them also fixes
 * their **order**, which is what layer 4's table headers print and what the
 * flat `otherForms` list is sorted by: the alphabetical order of an identifier
 * is not a grammatical order, and no grammar prints the accusative first.
 *
 * `category` is a `Tag`, which is what lets a paradigm stop being rectangular.
 * A language declares Person an axis of `{VERB, VerbForm=Fin}` and simply never
 * declares it for `{VERB, VerbForm=Inf}`, so an infinitive has no person cells
 * to leave conspicuously empty. Note such a category refines by a value that is
 * itself an axis value elsewhere: that is ordinary, and it is why an axis
 * category is checked only for **bound atoms**, exactly as an inherence
 * declaration's category is, and never for layer 2's grounding.
 *
 * `feature` is a bare name and the values are bare strings, both matched **by
 * name and never by scheme** — the same rule a value already follows to reach
 * its feature. An axis is a *selection* from the language's inventory, not a
 * second place to declare it, so it repeats neither provenance nor labels.
 */
export interface GrammarAxis {
  category: Tag;
  feature: string;
  /** The values this category's forms range over, in the order they are shown. */
  values: string[];
}

/**
 * One coordinate of a layout: a bare `Feature=Value` pair.
 *
 * **Bare, and matched by name**, exactly as an axis names its values — a layout
 * is a *selection* from the language's inventory, never a second place to
 * declare it, so it repeats neither provenance nor labels. That has a
 * consequence which is load-bearing rather than cosmetic: provenance is
 * re-attached from the `values` row before anything is displayed or matched
 * (see `coordTag`), because a form authored through the language's own picker
 * carries the minting scheme and an address built without it would match
 * nothing and find no label.
 */
export interface LayoutCoord {
  feature: string;
  /** One value, or several comma-separated ones for a form spanning them all. */
  value: string;
}

/**
 * An addressed cell: a list of coordinates.
 *
 * A list block's item is a **full** address — the cell it prints. An `exclude`
 * entry may be **partial**, and then it removes every cell whose coordinates
 * contain all of its own: a complete address deletes one cell, an incomplete
 * one deletes the whole row, column or slice it names. Without that, a language
 * whose plural half is defective would have to write one row per missing cell.
 */
export interface LayoutCell {
  coords: LayoutCoord[];
}

/**
 * A grid: axes assigned to dimensions, cells **derived** from the values those
 * axes declared.
 *
 * The cells are deliberately not stored. A stored matrix would be a second copy
 * of layer 3's value lists, free to drift from them, and a Latin verb would
 * carry hundreds of rows in a record that is rewritten whole on every edit.
 *
 * `rows` and `columns` hold **feature names, outermost first**: nesting is what
 * makes a header span, and a paradigm's dimensions are not always two — a
 * possessive declension nests possessor number under possessor person. Either
 * may be empty, since one axis on `rows` alone is a one-column table, which is
 * a perfectly ordinary way to print a fifteen-case declension.
 *
 * Non-rectangularity is expressed in three composable ways, which is why a
 * dense grid is not the default: **several blocks** with different `fixed`
 * constants (one table per mood and tense, the way a Latin grammar prints
 * them), **`exclude`** for holes inside one grid, and a **list block** for what
 * no grid reaches at all.
 */
export interface LayoutTable {
  kind: "table";
  fixed?: LayoutCoord[];
  summary?: boolean;
  /** Axes on the vertical dimension, outermost first. */
  rows?: string[];
  /** Axes on the horizontal dimension, outermost first. */
  columns?: string[];
  /**
   * Cells this paradigm does not have. A line or column left entirely excluded
   * is dropped rather than printed empty: "these forms do not exist" and
   * "nobody has entered these forms yet" must not look the same to a reader.
   */
  exclude?: LayoutCell[];
}

/**
 * An ordered list of addressed forms: "rosa, rosae" beside the headword, or the
 * infinitive, gerund and supine that no cell of a Latin finite grid reaches.
 *
 * This is also the **one-dimensional degenerate case of the same declaration**,
 * and so what fixes the order of the flat `otherForms` list — the fallback every
 * entry uses until its language declares a layout.
 */
export interface LayoutList {
  kind: "list";
  fixed?: LayoutCoord[];
  summary?: boolean;
  /** The addresses to print, in the order they are printed. */
  items: LayoutCell[];
}

/**
 * One block of a layout. The two kinds are distinguished by `kind` rather than
 * by a lexicon union: a union would put a `$type` on every block inside the
 * record for a choice between two shapes that are never referenced from
 * anywhere else.
 */
export type LayoutBlock = LayoutTable | LayoutList;

/**
 * How one category's forms are laid out — layer 4, which exists because **axes
 * alone underdetermine presentation** and nothing in layer 3 can say which
 * arrangement was meant.
 *
 * `category` is a `Tag` and is matched the way an axis's category is — the
 * entry's own bundle or any sub-bundle of it — so a layout declared on `{NOUN}`
 * serves an entry categorised `{NOUN, Gender=Fem}`. Where several match, the
 * **most specific wins** (`layoutFor`), which is how a language gives its
 * perfective verbs a different table from its imperfective ones without
 * repeating the parts they share.
 *
 * It carries **no labels and no values**, so it adds nothing to the
 * abbreviations read model and nothing to the API: everything a reader sees is
 * resolved through the layer-1 rows its axes and coordinates point at.
 */
export interface GrammarLayout {
  category: Tag;
  /** The blocks, in the order they are shown. */
  blocks: LayoutBlock[];
}

/**
 * A language's declared grammatical inventory. Every array is optional and
 * holds only *authored* rows: the record stores no skeleton of unbound atoms,
 * because absence already means unbound and a stored "complete" state goes
 * stale the moment UD moves. One representation, not two.
 *
 * All layers share this one object because they reference each other —
 * unbinding an atom orphans every higher row that uses it, and a single
 * self-contained object means one write keeps the whole cascade consistent.
 */
export interface Grammar {
  pos?: GrammarPos[];
  features?: GrammarFeature[];
  values?: GrammarValue[];
  inherent?: GrammarInherent[];
  bindings?: GrammarCombination[];
  axes?: GrammarAxis[];
  layout?: GrammarLayout[];
}

/** The tag a `pos` row binds. */
export function posTag(row: { value: string; scheme?: string }): Tag {
  const upos: TagUpos = { value: row.value, ...(row.scheme !== undefined ? { scheme: row.scheme } : {}) };
  return { upos };
}

/** The tag a `values` row binds — a one-item bundle. */
export function valueTag(row: { feature: string; value: string; scheme?: string }): Tag {
  return {
    feats: [
      {
        feature: row.feature,
        value: row.value,
        ...(row.scheme !== undefined ? { scheme: row.scheme } : {}),
      },
    ],
  };
}

/** What kind of atom a row binds. */
export type GrammarRowKind = "pos" | "feature" | "value" | "combination";

/**
 * Stable identity of an inherence declaration, so two versions' declarations
 * can be compared and an issue can point back at the row it came from. Not a
 * tag key: an inherence row binds no label and names no bundle — it states a
 * relation between a category and a feature name.
 */
export function inherentKey(row: GrammarInherent): string {
  return `${tagKey(row.category)}#${row.feature}`;
}

/**
 * Stable identity of an axis declaration. Deliberately **prefixed**, because an
 * axis and an inherence declaration are keyed on the same (category, feature)
 * pair — that identical keying is what makes the conflict between them
 * detectable — and an issue reported against one must not be indistinguishable
 * from the same issue reported against the other.
 */
export function axisKey(row: { category: Tag; feature: string }): string {
  return `axis#${tagKey(row.category)}#${row.feature}`;
}

/**
 * Stable identity of a layout declaration. Prefixed for the reason `axisKey`
 * is: a layout and an axis are keyed on the same categories, and an issue
 * reported against one must not read as the same issue against the other.
 */
export function layoutKey(row: { category: Tag }): string {
  return `layout#${tagKey(row.category)}`;
}

/**
 * Stable identity of one block of a layout. The index is part of it because a
 * block is not otherwise identifiable — two tables of one layout may differ
 * only in which value they fix — and a repair worklist has to point at one of
 * them rather than at the whole declaration.
 */
export function layoutBlockKey(row: { category: Tag }, index: number): string {
  return `${layoutKey(row)}[${index}]`;
}

/**
 * A feature value's identity for matching, with provenance deliberately
 * dropped and any multivalue item's values normalised into UD's order. An axis
 * names its values bare, so this is the only way it can reach the `values` rows
 * that bound them — and it is the same "by name, never by scheme" rule that
 * already lets a value minted on a UD feature find that feature.
 */
function valueMatchKey(feature: string, value: string): string {
  return tagKey(valueTag({ feature, value }));
}

/** How many atoms a tag bundles. */
export function tagSize(tag: Tag): number {
  return (tag.upos === undefined ? 0 : 1) + (tag.feats ?? []).length;
}

/**
 * One row of a grammar, flattened to what every consumer needs: its canonical
 * key, its label, and — for the two kinds that bind a tag — the tag itself.
 * A `feature` row has no tag, which is the whole reason feature names are not
 * stored as bundles.
 */
export interface GrammarRow {
  kind: GrammarRowKind;
  /** Canonical key: `tagKey` for pos/value rows, `featureKey` for a feature name. */
  key: string;
  label: GrammarLabel;
  references?: GrammarReference[];
  /** The tag this row binds; absent on a `feature` row. */
  tag?: Tag;
  /** The feature this row concerns; absent on a `pos` row. */
  feature?: string;
}

/**
 * Every row of a grammar in one list. Keys are shared with `tagKey`, so the
 * renderer's lookup and the abbreviations read model index the same strings a
 * tag on an entry record resolves to — no second key space.
 */
export function grammarRows(grammar: Grammar): GrammarRow[] {
  const rows: GrammarRow[] = [];
  for (const row of grammar.pos ?? []) {
    const tag = posTag(row);
    rows.push({
      kind: "pos",
      key: tagKey(tag),
      label: row.label,
      ...(row.references !== undefined ? { references: row.references } : {}),
      tag,
    });
  }
  for (const row of grammar.features ?? []) {
    rows.push({
      kind: "feature",
      key: featureKey(row),
      label: row.label,
      ...(row.references !== undefined ? { references: row.references } : {}),
      feature: row.feature,
    });
  }
  for (const row of grammar.values ?? []) {
    const tag = valueTag(row);
    rows.push({
      kind: "value",
      key: tagKey(tag),
      label: row.label,
      ...(row.references !== undefined ? { references: row.references } : {}),
      tag,
      feature: row.feature,
    });
  }
  // Layer 2's combinations are rows like any other, which is the whole reason
  // they need no plumbing of their own: they flow into the abbreviations read
  // model and into the renderer's lookup through this one function, and a
  // language's "nf." lands on the same shelf as its "n.".
  for (const row of grammar.bindings ?? []) {
    rows.push({
      kind: "combination",
      key: tagKey(row.tag),
      label: row.label,
      ...(row.references !== undefined ? { references: row.references } : {}),
      tag: row.tag,
    });
  }
  return rows;
}

/**
 * The atoms this language has bound, by canonical key — the layer-1 inventory
 * every layer-2 row has to draw from. Feature *names* are not in it: they are
 * not tags, and they are checked by name (see `boundFeatureNames`).
 */
function boundAtomKeys(grammar: Grammar): Set<string> {
  const keys = new Set<string>();
  for (const row of grammar.pos ?? []) keys.add(tagKey(posTag(row)));
  for (const row of grammar.values ?? []) keys.add(tagKey(valueTag(row)));
  return keys;
}

/** The feature names this language has bound. */
function boundFeatureNames(grammar: Grammar): Set<string> {
  return new Set((grammar.features ?? []).map((row) => row.feature));
}

/**
 * The feature values this language has bound, keyed so a bare (feature, value)
 * pair can find them — the layer-1 inventory an axis draws its values from.
 * Distinct from `boundAtomKeys`, which keys on the full tag including scheme:
 * a category in an `inherent` or `bindings` row carries its provenance and is
 * matched exactly, while an axis value does not carry any and cannot be.
 */
function boundValueKeys(grammar: Grammar): Set<string> {
  return new Set((grammar.values ?? []).map((row) => valueMatchKey(row.feature, row.value)));
}

/** Whether this language declares `feature` inherent to exactly this category. */
export function isInherent(grammar: Grammar, category: Tag, feature: string): boolean {
  const key = tagKey(category);
  return (grammar.inherent ?? []).some(
    (row) => row.feature === feature && tagKey(row.category) === key,
  );
}

/** Whether this language declares `feature` an axis of exactly this category. */
export function isAxis(grammar: Grammar, category: Tag, feature: string): boolean {
  const key = tagKey(category);
  return (grammar.axes ?? []).some(
    (row) => row.feature === feature && tagKey(row.category) === key,
  );
}

/** One declared axis, resolved to the layer-1 rows that give it its labels. */
export interface ResolvedAxis {
  feature: GrammarFeature;
  /** The axis's values in the order the language declared them. */
  values: GrammarValue[];
}

/**
 * The axes this language declares for exactly this category, resolved to their
 * bound rows — what the `otherForms` editor offers, and what layer 4 will lay
 * out. Declaration order is preserved: it is the language's default axis order,
 * as each row's `values` order is its default header order.
 *
 * A row naming a feature or a value nobody bound is skipped rather than shown
 * unnamed, exactly as `inherentFeatures` skips its orphans: an authoring
 * surface is not where an orphan gets repaired, the worklist is. An axis whose
 * values are *all* orphaned drops out entirely — an axis with nothing to range
 * over offers no choice.
 */
export function axesOf(grammar: Grammar, category: Tag): ResolvedAxis[] {
  const key = tagKey(category);
  return resolveAxes(
    grammar,
    (grammar.axes ?? []).filter((row) => tagKey(row.category) === key),
  );
}

/**
 * The axes that apply to an entry carrying these categories — what its forms
 * may vary over, and so what the `otherForms` editor offers.
 *
 * Wider than `axesOf` on purpose: an axis declared on `{NOUN}` applies to an
 * entry categorised `{NOUN, Gender=Fem}`, because that entry *is* a noun.
 * Requiring the declaration to match the entry's bundle exactly would make the
 * ordinary case — a language declaring number of nouns in general, an entry
 * naming its gender as well — silently offer nothing. So a row applies when
 * its category is the entry's bundle **or any sub-bundle of it**, which is the
 * same containment the renderer's decomposition walks.
 *
 * Rows are returned in the language's own declaration order, one per feature:
 * a paradigm has one Number axis, however many categories of the entry
 * declared it.
 */
export function applicableAxes(grammar: Grammar, categories: readonly Tag[]): ResolvedAxis[] {
  return resolveAxes(grammar, applicableAxisRows(grammar, categories));
}

/**
 * The keys of every bundle these categories *contain* — each category itself
 * and all of its sub-bundles. This is what "applies to" means everywhere a
 * language-level declaration has to reach an entry that named more than the
 * declaration did, and it is the same containment the renderer's decomposition
 * walks.
 */
function heldKeys(categories: readonly Tag[]): Set<string> {
  const held = new Set<string>();
  for (const category of categories) {
    const parts =
      tagSize(category) <= MAX_DECOMPOSED_ITEMS ? subBundles(category) : tagAtoms(category);
    for (const part of parts) held.add(tagKey(part));
    held.add(tagKey(category));
  }
  return held;
}

/**
 * The axis rows that apply to these categories, unresolved and in record order.
 *
 * Separate from `applicableAxes` because the two callers want different things:
 * a renderer wants axes resolved to their labels, with orphans dropped, while
 * the validator has to speak about the *declarations* — an axis whose values are
 * all orphaned has already been reported as such, and reporting a layout that
 * uses it as naming an undeclared axis would be a second, misleading issue for
 * one defect.
 */
function applicableAxisRows(grammar: Grammar, categories: readonly Tag[]): GrammarAxis[] {
  const held = heldKeys(categories);
  return (grammar.axes ?? []).filter((row) => held.has(tagKey(row.category)));
}

/** Resolve axis rows to their bound layer-1 rows, one per feature, in order. */
function resolveAxes(grammar: Grammar, rows: readonly GrammarAxis[]): ResolvedAxis[] {
  const features = grammar.features ?? [];
  const values = grammar.values ?? [];
  const seen = new Set<string>();
  const out: ResolvedAxis[] = [];
  for (const row of rows) {
    if (seen.has(row.feature)) continue;
    const feature = features.find((f) => f.feature === row.feature);
    if (feature === undefined) continue;
    const resolved: GrammarValue[] = [];
    for (const value of row.values) {
      const wanted = valueMatchKey(row.feature, value);
      const bound = values.find(
        (v) => v.feature === row.feature && valueMatchKey(v.feature, v.value) === wanted,
      );
      if (bound !== undefined) resolved.push(bound);
    }
    if (resolved.length === 0) continue;
    seen.add(row.feature);
    out.push({ feature, values: resolved });
  }
  return out;
}

// ---- layer 4: laying the cell space out ----------------------------------
//
// Everything below turns a stored `layout` row into what a viewer draws and
// what a form is matched against. It lives here rather than in a component
// because one generator has to serve the viewer now and the exporters later,
// and because a grid derived from a declaration is exactly the kind of
// arithmetic that has to be checkable without a browser.

/**
 * Above this many cells a table block resolves to nothing and reports
 * `layout-too-large`. Real paradigms are far below it — a Latin tense table is
 * a dozen cells, a Hungarian possessive declension a few hundred — so the cap
 * only ever catches a mistyped declaration, and it catches it loudly on the
 * dashboard instead of silently in a reader's browser.
 */
export const MAX_LAYOUT_CELLS = 4096;

/**
 * The `values` row a bare coordinate names, matched by name with provenance
 * ignored — the same rule that lets an axis name its values bare.
 */
function resolveCoord(grammar: Grammar, coord: LayoutCoord): GrammarValue | undefined {
  const wanted = valueMatchKey(coord.feature, coord.value);
  return (grammar.values ?? []).find(
    (row) => row.feature === coord.feature && valueMatchKey(row.feature, row.value) === wanted,
  );
}

/**
 * Coordinates as a feats-only tag, **re-qualified from the rows that bound
 * them**.
 *
 * This is the step that makes minted vocabulary work. Coordinates are stored
 * bare, but a Breton form authored through the language's own picker carries
 * `scheme: "br"`, and a label for it is stored under a key that includes the
 * scheme — so an address built from the bare pair would neither find its label
 * nor match the form it addresses. An unbound coordinate keeps no scheme, which
 * is the honest thing to say about it.
 */
export function coordTag(grammar: Grammar, coords: readonly LayoutCoord[]): Tag {
  const feats: TagFeat[] = coords.map((coord) => {
    const scheme = resolveCoord(grammar, coord)?.scheme;
    return {
      feature: coord.feature,
      value: coord.value,
      ...(scheme !== undefined ? { scheme } : {}),
    };
  });
  return { feats };
}

/**
 * A tag's feature items keyed with **provenance dropped and the part of speech
 * ignored** — the key a form's tag is joined to a cell's address on.
 *
 * Scheme-blind in both directions: a bot writes `Number=Sgv` with no scheme
 * where the language's own editor writes it with one. Part-of-speech-blind for
 * the same reason: a form tagged `NOUN|Case=Gen` carries a part of speech no
 * cell address does, and neither difference means a different form.
 */
export function featsMatchKey(tag: Tag): string {
  return tagKey({
    feats: (tag.feats ?? []).map((feat) => ({ feature: feat.feature, value: feat.value })),
  });
}

/** The scheme-blind keys of a tag's feature items. */
function featKeySet(tag: Tag): Set<string> {
  return new Set((tag.feats ?? []).map((feat) => valueMatchKey(feat.feature, feat.value)));
}

/** Whether every one of these coordinates appears among those keys. */
function coordsContained(coords: readonly LayoutCoord[], keys: ReadonlySet<string>): boolean {
  return coords.every((coord) => keys.has(valueMatchKey(coord.feature, coord.value)));
}

/**
 * Whether a block's exclusions remove the cell at these coordinates — the rule
 * the renderer applies, exported because the designer has to show the same
 * truth. A designer previews a block with its exclusions **set aside**, so that
 * an excluded cell stays visible and clickable rather than vanishing with no way
 * back, and then asks this which of those cells are excluded.
 *
 * Containment, not equality: an exclusion naming fewer coordinates than a cell
 * removes every cell that contains it, which is how one row removes a whole
 * slice.
 */
export function excludesCell(
  block: { exclude?: LayoutCell[] },
  coords: readonly LayoutCoord[],
): boolean {
  const keys = new Set(coords.map((coord) => valueMatchKey(coord.feature, coord.value)));
  return (block.exclude ?? []).some(
    (cell) => cell.coords.length > 0 && coordsContained(cell.coords, keys),
  );
}

/**
 * The layout that applies to an entry carrying these categories, or none.
 *
 * Matched by containment, as an axis is: a layout declared on `{NOUN}` serves an
 * entry categorised `{NOUN, Gender=Fem}`. Where several match, **the most
 * specific wins** — a language that lays out verbs in general and perfective
 * verbs particularly means the second for a perfective verb — and an exact tie
 * goes to the earlier declaration, so the choice never depends on anything but
 * the record's own order.
 */
export function layoutFor(grammar: Grammar, categories: readonly Tag[]): GrammarLayout | undefined {
  const held = heldKeys(categories);
  let best: GrammarLayout | undefined;
  let bestSize = -1;
  for (const row of grammar.layout ?? []) {
    if (!held.has(tagKey(row.category))) continue;
    const size = tagSize(row.category);
    if (size > bestSize) {
      best = row;
      bestSize = size;
    }
  }
  return best;
}

/** One header cell of a resolved table: a value, and how far it reaches. */
export interface LayoutHeader {
  feature: GrammarFeature;
  value: GrammarValue;
  /** Index of the first line this header covers. */
  start: number;
  /** How many lines it covers — its nesting, minus whatever was dropped. */
  span: number;
  /** Nesting depth; 0 is the outermost axis of the dimension. */
  depth: number;
}

/** One addressed cell of a resolved block. */
export interface LayoutAddress {
  /** The block's `fixed` first, then one coordinate per axis, outermost first. */
  coords: LayoutCoord[];
  /**
   * The address as a feats-only tag with provenance re-attached: what layer 5
   * will key a generated cell on, and what a contributor clicks to define the
   * rule that fills it.
   */
  tag: Tag;
  /** Scheme-blind join key — how a form finds its cell. */
  key: string;
}

/** A table block, resolved to what a viewer draws. */
export interface ResolvedLayoutTable {
  kind: "table";
  summary: boolean;
  /** The `fixed` coordinates resolved for display; empty when the block fixes nothing. */
  caption: ResolvedTagPart[];
  rowAxes: ResolvedAxis[];
  columnAxes: ResolvedAxis[];
  rowHeaders: LayoutHeader[];
  columnHeaders: LayoutHeader[];
  /** `cells[line][column]`, `undefined` where the paradigm has no such cell. */
  cells: (LayoutAddress | undefined)[][];
}

/** A list block, resolved to what a viewer prints. */
export interface ResolvedLayoutList {
  kind: "list";
  summary: boolean;
  caption: ResolvedTagPart[];
  items: LayoutAddress[];
}

export type ResolvedLayoutBlock = ResolvedLayoutTable | ResolvedLayoutList;

/**
 * A layout resolved against the language that declared it — the blocks a viewer
 * draws, in the order it draws them.
 *
 * Rows the declaration cannot support are **skipped rather than reported here**,
 * exactly as `resolveAxes` skips an orphaned value: a dimension naming an axis
 * this category does not have, or naming one twice, simply does not appear.
 * `grammarIssues` is where those are surfaced, because a repair worklist is
 * where they get fixed, and a reader must never be shown a broken table instead
 * of a smaller correct one.
 */
export function resolveLayout(grammar: Grammar, layout: GrammarLayout): ResolvedLayoutBlock[] {
  const lookup = grammarLookup(grammar);
  const axes = new Map(
    applicableAxes(grammar, [layout.category]).map((axis) => [axis.feature.feature, axis]),
  );
  return layout.blocks.map((block) =>
    block.kind === "list"
      ? resolveListBlock(grammar, lookup, block)
      : resolveTableBlock(grammar, lookup, axes, block),
  );
}

/** Every addressed cell of a resolved block, in reading order. */
export function blockCells(block: ResolvedLayoutBlock): LayoutAddress[] {
  if (block.kind === "list") return block.items;
  return block.cells.flat().filter((cell): cell is LayoutAddress => cell !== undefined);
}

/** A coordinate list resolved to an address. */
function toAddress(grammar: Grammar, coords: readonly LayoutCoord[]): LayoutAddress {
  const copied = coords.map((coord) => ({ feature: coord.feature, value: coord.value }));
  const tag = coordTag(grammar, copied);
  return { coords: copied, tag, key: featsMatchKey(tag) };
}

/** A block's caption: its constants, rendered by the ordinary chain. */
function blockCaption(
  grammar: Grammar,
  lookup: ReadonlyMap<string, GrammarLabel>,
  fixed: readonly LayoutCoord[],
): ResolvedTagPart[] {
  // A language that named the whole combination gets its own label for the
  // block ("present indicative"); one that named only the parts gets them in
  // order. That is `resolveTag`'s job and there is no second rule for captions.
  return fixed.length === 0 ? [] : resolveTag(coordTag(grammar, fixed), lookup);
}

function resolveListBlock(
  grammar: Grammar,
  lookup: ReadonlyMap<string, GrammarLabel>,
  block: LayoutList,
): ResolvedLayoutList {
  const fixed = block.fixed ?? [];
  return {
    kind: "list",
    summary: block.summary === true,
    caption: blockCaption(grammar, lookup, fixed),
    items: (block.items ?? []).map((cell) => toAddress(grammar, [...fixed, ...cell.coords])),
  };
}

function resolveTableBlock(
  grammar: Grammar,
  lookup: ReadonlyMap<string, GrammarLabel>,
  axes: ReadonlyMap<string, ResolvedAxis>,
  block: LayoutTable,
): ResolvedLayoutTable {
  const fixed = block.fixed ?? [];
  const caption = blockCaption(grammar, lookup, fixed);
  const empty: ResolvedLayoutTable = {
    kind: "table",
    summary: block.summary === true,
    caption,
    rowAxes: [],
    columnAxes: [],
    rowHeaders: [],
    columnHeaders: [],
    cells: [],
  };

  // A feature can sit on one dimension only: the same axis on both would put
  // two of its values in one address, which is not a tag at all.
  const taken = new Set<string>();
  const dimension = (names: readonly string[]): ResolvedAxis[] => {
    const out: ResolvedAxis[] = [];
    for (const name of names) {
      const axis = axes.get(name);
      if (axis === undefined || taken.has(name)) continue;
      taken.add(name);
      out.push(axis);
    }
    return out;
  };
  const rowAxes = dimension(block.rows ?? []);
  const columnAxes = dimension(block.columns ?? []);
  if (rowAxes.length === 0 && columnAxes.length === 0) return empty;

  // Counted before anything is built: the product is what could be large, so
  // capping after building it would be capping nothing.
  const size = (dim: readonly ResolvedAxis[]): number =>
    dim.reduce((n, axis) => n * axis.values.length, 1);
  if (size(rowAxes) * size(columnAxes) > MAX_LAYOUT_CELLS) {
    return { ...empty, rowAxes, columnAxes };
  }

  const rowLines = leafLines(rowAxes);
  const columnLines = leafLines(columnAxes);
  // An exclusion with no coordinates would empty the whole table; the lexicon
  // forbids one, and `excludesCell` ignores a record that carries one anyway.
  const excluded = (line: readonly GrammarValue[], column: readonly GrammarValue[]): boolean =>
    excludesCell(block, [...line, ...column]);

  // A line or column with nothing left in it is dropped, and the headers are
  // built from what survived — which is why they are built here and not from
  // the axes directly. Excluding the plural half of a nested table must remove
  // those lines, not print them empty.
  const keptRows = rowLines.filter((line) => columnLines.some((column) => !excluded(line, column)));
  const keptColumns = columnLines.filter((column) =>
    keptRows.some((line) => !excluded(line, column)),
  );

  return {
    kind: "table",
    summary: block.summary === true,
    caption,
    rowAxes,
    columnAxes,
    rowHeaders: headersOf(rowAxes, keptRows),
    columnHeaders: headersOf(columnAxes, keptColumns),
    cells: keptRows.map((line) =>
      keptColumns.map((column) =>
        excluded(line, column)
          ? undefined
          : toAddress(grammar, [
              ...fixed,
              ...[...line, ...column].map((value) => ({
                feature: value.feature,
                value: value.value,
              })),
            ]),
      ),
    ),
  };
}

/**
 * One list of values per leaf line of a dimension — the cartesian product of
 * its axes, outermost varying slowest, which is what nesting means. With no
 * axes there is exactly one unnamed line, so a table with axes on one dimension
 * only needs no special case anywhere else.
 */
function leafLines(axes: readonly ResolvedAxis[]): GrammarValue[][] {
  let lines: GrammarValue[][] = [[]];
  for (const axis of axes) {
    const next: GrammarValue[][] = [];
    for (const line of lines) for (const value of axis.values) next.push([...line, value]);
    lines = next;
  }
  return lines;
}

/**
 * The header cells of one dimension, from the lines that survived exclusion.
 * Filtering preserves order, so lines sharing a prefix are still adjacent and
 * one pass per depth finds every span.
 */
function headersOf(
  axes: readonly ResolvedAxis[],
  lines: readonly GrammarValue[][],
): LayoutHeader[] {
  const out: LayoutHeader[] = [];
  const same = (a: readonly GrammarValue[], b: readonly GrammarValue[], depth: number): boolean => {
    for (let i = 0; i <= depth; i++) {
      if (a[i]?.feature !== b[i]?.feature || a[i]?.value !== b[i]?.value) return false;
    }
    return true;
  };
  for (let depth = 0; depth < axes.length; depth++) {
    let start = 0;
    while (start < lines.length) {
      let end = start + 1;
      while (end < lines.length && same(lines[start]!, lines[end]!, depth)) end++;
      const value = lines[start]![depth];
      if (value !== undefined) {
        out.push({ feature: axes[depth]!.feature, value, start, span: end - start, depth });
      }
      start = end;
    }
  }
  return out;
}

/** Where each form landed, and which landed nowhere. */
export interface PlacedForms<T> {
  /** Cell join key → the forms in it, in the entry's own order. */
  placed: Map<string, T[]>;
  /** The forms no cell claimed — the flat-list fallback, and the safe failure. */
  leftover: T[];
}

/**
 * Put an entry's forms in the cells they address.
 *
 * Exact first, then containment: a form carrying **more** than the address —
 * an inherent feature repeated on it, or a part of speech a bot wrote in — is
 * still that cell's form, and the most specific containing cell claims it, so a
 * form is never taken by a vaguer cell than the one it actually matches. A form
 * carrying **less** matches nothing and stays a leftover: a table of case and
 * number cannot know which number a form tagged only for case belongs to, and
 * guessing would put a word in a reader's mouth.
 *
 * Nothing is ever dropped. Layer 5 will override generated cells from this same
 * placement, and an `otherForm` matching no declared cell has to keep rendering
 * somewhere — that is the failure the flat list exists to absorb.
 */
export function placeForms<T extends { tag: Tag }>(
  cells: readonly LayoutAddress[],
  forms: readonly T[],
): PlacedForms<T> {
  const byKey = new Set(cells.map((cell) => cell.key));
  const placed = new Map<string, T[]>();
  const leftover: T[] = [];
  const put = (key: string, form: T): void => {
    const list = placed.get(key);
    if (list === undefined) placed.set(key, [form]);
    else list.push(form);
  };

  for (const form of forms) {
    const key = featsMatchKey(form.tag);
    if (byKey.has(key)) {
      put(key, form);
      continue;
    }
    const held = featKeySet(form.tag);
    let best: LayoutAddress | undefined;
    for (const cell of cells) {
      if (cell.coords.length === 0 || !coordsContained(cell.coords, held)) continue;
      if (best === undefined || cell.coords.length > best.coords.length) best = cell;
    }
    if (best === undefined) leftover.push(form);
    else put(best.key, form);
  }
  return { placed, leftover };
}

/** Everything a viewer needs to draw one entry's paradigm. */
export interface LayoutView<T> {
  /** The blocks to draw, resolved; empty when nothing applies. */
  blocks: ResolvedLayoutBlock[];
  /** Cell join key → the forms in it. */
  placed: Map<string, T[]>;
  /** Forms no cell claimed — the flat list beside or below the blocks. */
  leftover: T[];
  /** Whether any cell holds a form: the test for drawing a table at all. */
  filled: boolean;
}

/**
 * The whole viewer path in one call — find the layout that applies to these
 * categories, resolve it, and place the entry's forms in its cells.
 *
 * It exists so that the component drawing a paradigm contains no arithmetic: one
 * generator serves the viewer now and the exporters later, and what a reader sees
 * can be checked without a browser.
 *
 * **The degradation is total, and deliberately expressed as one shape.** No
 * grammar (the record would not load, the language declared none), no layout for
 * this category, or a layout that resolves to no cells at all: each returns no
 * blocks and every form as a leftover — which *is* the flat list, today's
 * behaviour and the fallback this layer must never break. A caller that renders
 * `leftover` whenever `blocks` is empty cannot get the fallback wrong.
 */
export function layoutView<T extends { tag: Tag }>(
  grammar: Grammar | undefined,
  categories: readonly Tag[],
  forms: readonly T[],
): LayoutView<T> {
  const flat: LayoutView<T> = {
    blocks: [],
    placed: new Map<string, T[]>(),
    leftover: [...forms],
    filled: false,
  };
  if (grammar === undefined) return flat;
  const layout = layoutFor(grammar, categories);
  if (layout === undefined) return flat;
  const blocks = resolveLayout(grammar, layout);
  const cells = blocks.flatMap(blockCells);
  if (cells.length === 0) return flat;
  const { placed, leftover } = placeForms(cells, forms);
  return { blocks, placed, leftover, filled: placed.size > 0 };
}

/**
 * The order a flat list of forms is shown in — the one-dimensional degenerate
 * case of a layout, and what every entry falls back to.
 *
 * Three orders, in descending strength. With a **layout**, the blocks' own cell
 * order, leftovers last. With **axes** only, the order the axes and their values
 * were declared in, which is still a grammatical order where the record's is
 * merely the order a bot's source happened to print. With neither, the record's
 * own order, untouched — today's behaviour, and the fallback the layer must
 * never break.
 */
export function flatFormOrder<T extends { tag: Tag }>(
  grammar: Grammar,
  categories: readonly Tag[],
  forms: readonly T[],
): T[] {
  const layout = layoutFor(grammar, categories);
  if (layout !== undefined) {
    const cells = resolveLayout(grammar, layout).flatMap(blockCells);
    const { placed, leftover } = placeForms(cells, forms);
    const out: T[] = [];
    const done = new Set<string>();
    for (const cell of cells) {
      if (done.has(cell.key)) continue;
      done.add(cell.key);
      out.push(...(placed.get(cell.key) ?? []));
    }
    return [...out, ...leftover];
  }

  const axes = applicableAxes(grammar, categories);
  if (axes.length === 0) return [...forms];
  // A form saying nothing about an axis, or something the axis does not
  // declare, sorts after every value that axis does declare: an unrecognised
  // form belongs at the end of the list, not scattered through it.
  const rank = (form: T): number[] =>
    axes.map((axis) => {
      const feat = (form.tag.feats ?? []).find((f) => f.feature === axis.feature.feature);
      if (feat === undefined) return axis.values.length;
      const wanted = valueMatchKey(feat.feature, feat.value);
      const at = axis.values.findIndex(
        (value) => valueMatchKey(value.feature, value.value) === wanted,
      );
      return at === -1 ? axis.values.length : at;
    });
  return forms
    .map((form, index) => ({ form, index, rank: rank(form) }))
    .sort((a, b) => {
      for (let i = 0; i < a.rank.length; i++) {
        const difference = a.rank[i]! - b.rank[i]!;
        if (difference !== 0) return difference;
      }
      // The entry author's order breaks every tie, so two forms of one cell
      // stay in the order they were written.
      return a.index - b.index;
    })
    .map((item) => item.form);
}

/** The same tag without its i-th feature item. */
function tagWithoutFeat(tag: Tag, index: number): Tag {
  const feats = (tag.feats ?? []).filter((_, i) => i !== index);
  return {
    ...(tag.upos !== undefined ? { upos: tag.upos } : {}),
    ...(feats.length > 0 ? { feats } : {}),
  };
}

/**
 * Whether a combination is reachable through the inherence declarations that
 * build it up — layer 2's gate, and the exact analogue of layer 1's "a value's
 * feature name must be bound".
 *
 * A combination is grounded when some feature item of it can be *removed* to
 * leave a category that (a) this language declares that feature inherent to,
 * and (b) is itself grounded or a bound atom. Removing only feature items, and
 * never the part of speech, is what makes this the same walk the entry editor
 * takes forwards: a contributor starts from a part of speech and adds one
 * inherent feature at a time.
 *
 * Above `MAX_DECOMPOSED_ITEMS` items the check is skipped and the combination
 * passes: the search is exponential in the number of items, and a bundle that
 * large is pathological rather than something to spend an exponential
 * validator on — the same cap, and the same reasoning, as the renderer's
 * decomposition.
 */
export function isGroundedCombination(grammar: Grammar, tag: Tag): boolean {
  if (tagSize(tag) > MAX_DECOMPOSED_ITEMS) return true;
  const atoms = boundAtomKeys(grammar);
  const seen = new Map<string, boolean>();

  function grounded(current: Tag): boolean {
    const key = tagKey(current);
    const cached = seen.get(key);
    if (cached !== undefined) return cached;
    // Guard against a cycle in the memo while this branch is still open; a
    // shrinking bundle cannot actually cycle, but the map must not be read as
    // "false" by a sibling branch mid-walk.
    seen.set(key, false);

    let result = false;
    if (tagSize(current) <= 1) {
      result = atoms.has(key);
    } else {
      const feats = current.feats ?? [];
      for (let i = 0; i < feats.length; i++) {
        const smaller = tagWithoutFeat(current, i);
        if (isInherent(grammar, smaller, feats[i]!.feature) && grounded(smaller)) {
          result = true;
          break;
        }
      }
    }
    seen.set(key, result);
    return result;
  }

  return grounded(tag);
}

/**
 * Canonical key → label, for resolving a tag to what a reader should see.
 * Built fresh from a grammar; on a duplicate key the first row wins, and
 * `grammarIssues` reports the duplicate so it can be repaired.
 */
export function grammarLookup(grammar: Grammar): Map<string, GrammarLabel> {
  const lookup = new Map<string, GrammarLabel>();
  for (const row of grammarRows(grammar)) {
    if (!lookup.has(row.key)) lookup.set(row.key, row.label);
  }
  return lookup;
}

/**
 * A defect in a grammar: a row that cannot mean what it says.
 *
 * - `unbound-feature` — a value, or an inherence declaration, naming a feature
 *   nobody bound. This is the layer-1 gate: a feature name must be bound
 *   before any of its values can be, and the mirror holds, so unbinding a name
 *   orphans its values.
 * - `duplicate` — two rows sharing a canonical key, which makes the label a
 *   tag resolves to depend on array order.
 * - `unbound-atom` — a layer-2 row built on an atom layer 1 does not bind: a
 *   category can only be made of what the language has declared it uses.
 * - `ungrounded-combination` — a labelled combination that no chain of
 *   inherence declarations reaches. Layer 2's gate, and the same rule as
 *   `unbound-feature` one level up.
 * - `single-item-binding` — a combination row holding a single atom, which
 *   already has a home in `pos` or `values`. Two ways to state one fact is how
 *   the two come to disagree.
 * - `inherent-axis-conflict` — a (category, feature) pair declared both
 *   inherent and an axis: the language says the same feature both identifies
 *   the word and varies across its forms, and a paradigm cannot be built from
 *   a coordinate that is also a constant. The apparent counterexample resolves
 *   through the keying rather than through this rule — `Number` is an axis of
 *   `{NOUN}` and inherent to `{NOUN, Number=Ptan}`, which are different
 *   categories and so never meet here.
 * - `empty-axis` — an axis row naming no values, which declares that a feature
 *   varies without saying what it varies over.
 * - `layout-unknown-axis` — a table dimension naming a feature this category
 *   does not declare an axis of. Layer 4's own gate: a layout arranges a cell
 *   space, so it can only name dimensions layer 3 gave it.
 * - `layout-repeated-axis` — one feature on more than one dimension of a table,
 *   which would put two of its values in a single cell address.
 * - `layout-foreign-coordinate` — an `exclude` coordinate the block's grid does
 *   not contain: an unknown feature, or a value that dimension's axis does not
 *   declare. It removes nothing, and a declaration that silently does nothing
 *   is exactly what a worklist is for.
 * - `empty-layout-block` — a table with no dimensions, or a list with no items:
 *   a block that says a paradigm is laid out without saying how.
 * - `layout-too-large` — a table whose axes multiply out past
 *   `MAX_LAYOUT_CELLS`. The block renders nothing rather than hanging a reader's
 *   browser, and this is what says so.
 */
export interface GrammarIssue {
  kind:
    | "unbound-feature"
    | "duplicate"
    | "unbound-atom"
    | "ungrounded-combination"
    | "single-item-binding"
    | "inherent-axis-conflict"
    | "empty-axis"
    | "layout-unknown-axis"
    | "layout-repeated-axis"
    | "layout-foreign-coordinate"
    | "empty-layout-block"
    | "layout-too-large";
  /** Canonical key of the offending row. */
  key: string;
  /** The feature name at fault, on an `unbound-feature` issue. */
  feature?: string;
  /**
   * The unbound atom, written the way UD writes it, on an `unbound-atom`
   * issue. One row can be built on several unbound atoms, so this is part of
   * the issue's identity rather than a decoration.
   */
  atom?: string;
}

/** Stable identity of an issue, so two versions' issues can be compared. */
export function grammarIssueKey(issue: GrammarIssue): string {
  // A NUL separator, so no combination of a kind and a key can spell the
  // same identity as another pair. Written as an escape rather than a
  // literal, which would make this source file read as binary to grep.
  const atom = issue.atom === undefined ? "" : `\u0000${issue.atom}`;
  return `${issue.kind}\u0000${issue.key}${atom}`;
}

/**
 * Every defect in a grammar.
 *
 * The gate matches a value to its feature **by name**, ignoring `scheme`:
 * within one record a name is unambiguous, and requiring the schemes to agree
 * would break the ordinary case of a minted value on a UD feature, where the
 * `features` row for `Number` is UD's and the `values` row for `Sgv` is the
 * language's. The pathological case — a language minting a feature whose name
 * UD already uses, meaning something else — is accepted rather than designed
 * around.
 */
export function grammarIssues(grammar: Grammar): GrammarIssue[] {
  const issues: GrammarIssue[] = [];
  const boundNames = boundFeatureNames(grammar);
  const atoms = boundAtomKeys(grammar);

  for (const row of grammar.values ?? []) {
    if (!boundNames.has(row.feature)) {
      issues.push({ kind: "unbound-feature", key: tagKey(valueTag(row)), feature: row.feature });
    }
  }

  // Layer 2, downwards: an inherence declaration may only name a feature and a
  // category this language has actually declared it uses.
  for (const row of grammar.inherent ?? []) {
    const key = inherentKey(row);
    if (!boundNames.has(row.feature)) {
      issues.push({ kind: "unbound-feature", key, feature: row.feature });
    }
    for (const atom of tagAtoms(row.category)) {
      if (!atoms.has(tagKey(atom))) {
        issues.push({ kind: "unbound-atom", key, atom: formatTagVerbatim(atom) });
      }
    }
  }

  for (const row of grammar.bindings ?? []) {
    const key = tagKey(row.tag);
    if (tagSize(row.tag) < 2) {
      // One defect per row: a single-item row's real fix is to move it to
      // `pos` or `values`, and saying so twice helps nobody.
      issues.push({ kind: "single-item-binding", key });
      continue;
    }
    const unbound = tagAtoms(row.tag).filter((atom) => !atoms.has(tagKey(atom)));
    for (const atom of unbound) {
      issues.push({ kind: "unbound-atom", key, atom: formatTagVerbatim(atom) });
    }
    // Grounding necessarily fails when an atom is missing, so it is only worth
    // reporting once the parts are all there: otherwise one unbound atom
    // produces two issues and the repair worklist reads as twice the work.
    if (unbound.length === 0 && !isGroundedCombination(grammar, row.tag)) {
      issues.push({ kind: "ungrounded-combination", key });
    }
  }

  // Layer 3. An axis is checked against layer 1 the same way everything above
  // it is — its category's atoms and its feature name must be bound — plus the
  // check only it can make: its *values* must be bound too. That is the
  // cascade's mirror at this altitude, and it is what makes unbinding a value
  // still used as an axis option show up as an orphan rather than silently
  // shrinking a paradigm.
  const boundValues = boundValueKeys(grammar);
  const seenAxes = new Set<string>();
  const flaggedAxes = new Set<string>();
  for (const row of grammar.axes ?? []) {
    const key = axisKey(row);
    if (seenAxes.has(key)) {
      // A second row for the same pair makes the value *order* depend on array
      // order, which is the same defect a duplicate label is, and its other
      // defects were already reported against the first row.
      if (!flaggedAxes.has(key)) {
        flaggedAxes.add(key);
        issues.push({ kind: "duplicate", key });
      }
      continue;
    }
    seenAxes.add(key);

    if (!boundNames.has(row.feature)) {
      issues.push({ kind: "unbound-feature", key, feature: row.feature });
    }
    for (const atom of tagAtoms(row.category)) {
      if (!atoms.has(tagKey(atom))) {
        issues.push({ kind: "unbound-atom", key, atom: formatTagVerbatim(atom) });
      }
    }
    for (const value of row.values) {
      if (!boundValues.has(valueMatchKey(row.feature, value))) {
        issues.push({
          kind: "unbound-atom",
          key,
          atom: formatTagVerbatim(valueTag({ feature: row.feature, value })),
        });
      }
    }
    // Both carry the feature name: an editor reporting these should be able to
    // say which axis is at fault without printing a canonical key at a reader.
    if (row.values.length === 0) {
      issues.push({ kind: "empty-axis", key, feature: row.feature });
    }
    if (isInherent(grammar, row.category, row.feature)) {
      issues.push({ kind: "inherent-axis-conflict", key, feature: row.feature });
    }
  }

  // Layer 4. A layout declares no vocabulary of its own, so every check here is
  // the cascade's: the category's atoms must be bound, a dimension must be an
  // axis this category declares, and a coordinate must name something the
  // block's own grid contains.
  //
  // One asymmetry is deliberate. `fixed` and a list's items are required to be
  // **bound** but not to be axis values, because pinning a constant outside the
  // coordinate system is a legitimate thing for a table to do — a block of the
  // definite forms in a language that never declared Definite an axis. An
  // `exclude` coordinate outside the grid can only ever be a silent no-op, so
  // that one is reported.
  const seenLayouts = new Set<string>();
  const flaggedLayouts = new Set<string>();
  for (const row of grammar.layout ?? []) {
    const key = layoutKey(row);
    if (seenLayouts.has(key)) {
      // A second layout for one category makes which one applies depend on
      // array order, the same defect a duplicate label is.
      if (!flaggedLayouts.has(key)) {
        flaggedLayouts.add(key);
        issues.push({ kind: "duplicate", key });
      }
      continue;
    }
    seenLayouts.add(key);

    const unboundCategory = tagAtoms(row.category).filter((atom) => !atoms.has(tagKey(atom)));
    for (const atom of unboundCategory) {
      issues.push({ kind: "unbound-atom", key, atom: formatTagVerbatim(atom) });
    }
    // A category the language has not declared can have no axes, so every
    // dimension of every block would be reported "unknown" on top of the one
    // defect that actually needs fixing — the same reason layer 2 holds back
    // grounding until a combination's atoms are all bound.
    if (unboundCategory.length > 0) continue;

    // Declarations, not resolved axes: an axis whose values are all orphaned has
    // already been reported as such, and calling a layout that uses it
    // "unknown" would be a second issue for one defect.
    const declared = new Map(
      applicableAxisRows(grammar, [row.category]).map((axis) => [axis.feature, axis]),
    );
    for (let index = 0; index < row.blocks.length; index++) {
      const block = row.blocks[index]!;
      const blockKey = layoutBlockKey(row, index);

      for (const coord of block.fixed ?? []) {
        if (!boundValues.has(valueMatchKey(coord.feature, coord.value))) {
          issues.push({ kind: "unbound-atom", key: blockKey, atom: formatTagVerbatim(valueTag(coord)) });
        }
      }

      if (block.kind === "list") {
        for (const cell of block.items ?? []) {
          for (const coord of cell.coords) {
            if (!boundValues.has(valueMatchKey(coord.feature, coord.value))) {
              issues.push({
                kind: "unbound-atom",
                key: blockKey,
                atom: formatTagVerbatim(valueTag(coord)),
              });
            }
          }
        }
        if ((block.items ?? []).length === 0) {
          issues.push({ kind: "empty-layout-block", key: blockKey });
        }
        continue;
      }

      const dimensions = [...(block.rows ?? []), ...(block.columns ?? [])];
      if (dimensions.length === 0) issues.push({ kind: "empty-layout-block", key: blockKey });
      const grid = new Map<string, GrammarAxis>();
      const seenDimensions = new Set<string>();
      for (const feature of dimensions) {
        if (seenDimensions.has(feature)) {
          issues.push({ kind: "layout-repeated-axis", key: blockKey, feature });
          continue;
        }
        seenDimensions.add(feature);
        const axis = declared.get(feature);
        if (axis === undefined) {
          issues.push({ kind: "layout-unknown-axis", key: blockKey, feature });
          continue;
        }
        grid.set(feature, axis);
      }

      for (const cell of block.exclude ?? []) {
        for (const coord of cell.coords) {
          const axis = grid.get(coord.feature);
          const wanted = valueMatchKey(coord.feature, coord.value);
          const known =
            axis !== undefined &&
            axis.values.some((value) => valueMatchKey(coord.feature, value) === wanted);
          if (!known) {
            issues.push({
              kind: "layout-foreign-coordinate",
              key: blockKey,
              feature: coord.feature,
              atom: formatTagVerbatim(valueTag(coord)),
            });
          }
        }
      }

      let cells = 1;
      for (const axis of grid.values()) cells *= axis.values.length;
      if (grid.size > 0 && cells > MAX_LAYOUT_CELLS) {
        issues.push({ kind: "layout-too-large", key: blockKey });
      }
    }
  }

  const seen = new Set<string>();
  const flagged = new Set<string>();
  for (const row of grammarRows(grammar)) {
    if (seen.has(row.key)) {
      if (!flagged.has(row.key)) {
        flagged.add(row.key);
        issues.push({ kind: "duplicate", key: row.key });
      }
      continue;
    }
    seen.add(row.key);
  }
  return issues;
}

/**
 * The defects a proposed grammar would **introduce** — the no-orphan check,
 * as a pure function over (old, new).
 *
 * Unbinding is not a delete operation: the whole record is rewritten, so the
 * only way to catch an orphan is to compare proposed against current. Only
 * *introduced* defects are reported, never pre-existing ones: a record that
 * arrived orphaned (from a bot, or another client) must stay editable, or the
 * repair worklist is unreachable and the damage is permanent.
 *
 * Enforced in the browser, which refuses to publish. At the AppView this is
 * **detection only, never rejection** — rejecting a version would discard its
 * good content to punish one bad row, and would make the AppView the arbiter
 * of a language's grammar; an orphan already renders safely by decomposition
 * or verbatim.
 */
export function grammarDiff(
  previous: Grammar | undefined,
  next: Grammar,
): { introduced: GrammarIssue[] } {
  const before = new Set(
    (previous === undefined ? [] : grammarIssues(previous)).map(grammarIssueKey),
  );
  return {
    introduced: grammarIssues(next).filter((issue) => !before.has(grammarIssueKey(issue))),
  };
}

/** One chip a tag renders as. */
export interface ResolvedTagPart {
  /** The bound homolingual label, when this part resolved to one. */
  label?: GrammarLabel;
  /** The raw UD-shaped identifier, when it did not. */
  verbatim?: string;
  /** False when the part fell through to `verbatim` — style it as unbound. */
  bound: boolean;
}

/**
 * Above this many items, sub-bundle enumeration is skipped and each item is
 * resolved on its own. A bundle of n items has 2ⁿ−1 sub-bundles, and nobody
 * should ship an exponential renderer; real bundles are two or three items.
 */
const MAX_DECOMPOSED_ITEMS = 6;

/** Every non-empty sub-bundle of a tag, largest first. */
function subBundles(tag: Tag): Tag[] {
  const items: Tag[] = [];
  const feats = tag.feats ?? [];
  const atoms: Tag[] = [
    ...(tag.upos !== undefined ? [{ upos: tag.upos }] : []),
    ...feats.map((feat) => ({ feats: [feat] })),
  ];
  const n = atoms.length;
  for (let mask = (1 << n) - 1; mask >= 1; mask--) {
    const chosen = atoms.filter((_, i) => (mask & (1 << i)) !== 0);
    const upos = chosen.find((c) => c.upos !== undefined)?.upos;
    const bundleFeats = chosen.flatMap((c) => c.feats ?? []);
    items.push({
      ...(upos !== undefined ? { upos } : {}),
      ...(bundleFeats.length > 0 ? { feats: bundleFeats } : {}),
    });
  }
  return items.sort(
    (a, b) =>
      ((b.upos ? 1 : 0) + (b.feats?.length ?? 0)) - ((a.upos ? 1 : 0) + (a.feats?.length ?? 0)),
  );
}

/** The atoms of a tag, in the bundle's own order. */
function tagAtoms(tag: Tag): Tag[] {
  return [
    ...(tag.upos !== undefined ? [{ upos: tag.upos }] : []),
    ...(tag.feats ?? []).map((feat) => ({ feats: [feat] })),
  ];
}

/**
 * How a tag should be displayed, given what a language has bound:
 * **exact → decomposition → verbatim**. This is how the viewer *chooses*
 * between valid renderings, not merely a fallback chain.
 *
 * 1. **Exact bundle match.** A language that bound `{NOUN, Gender=Fem}` to
 *    "nf." shows `nf.` — one chip, because that is the label it authored.
 * 2. **Decomposition**, greedily by largest bound sub-bundle, rendered in the
 *    bundle's own order. A language that bound `{NOUN}` and `{Gender=Fem}`
 *    separately shows `n. f.` — never a synthesised `nf.` nobody wrote.
 *    Partial decomposition still beats a raw tag: bound parts render as
 *    labels and only the remainder falls through.
 * 3. **Verbatim**, styled as unbound. Deliberately not UD's English gloss,
 *    which would read as content and breach the homolingual rule; an
 *    untranslated identifier reads as "this needs binding", which is the
 *    wanted signal. Bots know the tag before any label exists, so this is the
 *    common path, not an edge case — and it is why a viewer never rejects an
 *    unbound tag: doing so would make the AppView the arbiter of a language's
 *    grammar.
 */
export function resolveTag(
  tag: Tag,
  lookup: ReadonlyMap<string, GrammarLabel>,
): ResolvedTagPart[] {
  const exact = lookup.get(tagKey(tag));
  if (exact !== undefined) return [{ label: exact, bound: true }];

  const atoms = tagAtoms(tag);
  if (atoms.length === 0) return [];
  const atomKeys = atoms.map(tagKey);

  // Above the cap, only single atoms are considered: a bundle that large is
  // pathological, and enumerating its sub-bundles is exponential.
  const candidates = atoms.length <= MAX_DECOMPOSED_ITEMS ? subBundles(tag) : atoms;

  interface Group {
    label: GrammarLabel;
    keys: Set<string>;
  }
  const groups: Group[] = [];
  const claimed = new Set<string>();
  // Greedy: the largest bound sub-bundle whose atoms are all still free wins,
  // so `{NOUN, Gender=Fem, Number=Plur}` in a language that bound "nf." and
  // "pl." renders as those two, not as three separate atoms.
  for (const candidate of candidates) {
    const label = lookup.get(tagKey(candidate));
    if (label === undefined) continue;
    const keys = tagAtoms(candidate).map(tagKey);
    if (keys.some((k) => claimed.has(k))) continue;
    for (const k of keys) claimed.add(k);
    groups.push({ label, keys: new Set(keys) });
  }

  // Emit in the bundle's own order, so the author's phrasing survives; each
  // group appears once, at the position of its first atom.
  const out: ResolvedTagPart[] = [];
  const done = new Set<Group>();
  for (let i = 0; i < atoms.length; i++) {
    const group = groups.find((g) => g.keys.has(atomKeys[i]!));
    if (group === undefined) {
      out.push({ verbatim: formatTagVerbatim(atoms[i]!), bound: false });
      continue;
    }
    if (done.has(group)) continue;
    done.add(group);
    out.push({ label: group.label, bound: true });
  }
  return out;
}

/** One category a contributor can pick or refine to, with what to show for it. */
export interface CategoryOption {
  tag: Tag;
  /**
   * The homolingual label to show. **Always a bound one:** a combination's own
   * label when the language named that combination, otherwise the label of the
   * atom being added. Never a raw identifier — which is only possible because
   * `categories` is tag-only, so the grammar had to be declared first.
   */
  label: GrammarLabel;
  /** Whether the language named this exact combination, rather than its parts. */
  named: boolean;
}

/**
 * Where the entry editor's narrowing starts: the parts of speech this language
 * has bound, in record order. A language that has bound none offers nothing to
 * start from, and the editor falls back to picking atoms independently.
 */
export function categoryRoots(grammar: Grammar): CategoryOption[] {
  return (grammar.pos ?? []).map((row) => ({
    tag: posTag(row),
    label: row.label,
    named: true,
  }));
}

/**
 * The features this language declares inherent to exactly this category, as
 * their bound `features` rows. A declaration naming a feature nobody bound is
 * skipped rather than shown unnamed: it is an orphan, and the repair worklist
 * — not the entry editor — is where it gets fixed.
 */
export function inherentFeatures(grammar: Grammar, category: Tag): GrammarFeature[] {
  const key = tagKey(category);
  const rows = grammar.features ?? [];
  const seen = new Set<string>();
  const out: GrammarFeature[] = [];
  for (const declaration of grammar.inherent ?? []) {
    if (tagKey(declaration.category) !== key || seen.has(declaration.feature)) continue;
    const feature = rows.find((row) => row.feature === declaration.feature);
    if (feature === undefined) continue;
    seen.add(declaration.feature);
    out.push(feature);
  }
  return out;
}

/** One step of the narrowing: a feature, and the categories choosing it leads to. */
export interface CategoryRefinement {
  feature: GrammarFeature;
  options: CategoryOption[];
}

/**
 * The next step of the entry editor's narrowing tree, from a category — a
 * **derived view of layers 1 and 2**, never a separate declaration: the
 * inherence rows and the named combinations are what generate it, and nothing
 * extra is authored to get it.
 *
 * Each option is this category plus one bound value of an inherent feature.
 * Options whose combination the language has not named are still offered:
 * their tag renders by decomposition, and the alternative — hiding them —
 * would turn layer 2 into a whitelist, which is exactly what it must not be.
 * A feature already present in the category is not offered again.
 */
export function categoryRefinements(grammar: Grammar, category: Tag): CategoryRefinement[] {
  const present = new Set((category.feats ?? []).map((feat) => feat.feature));
  const named = new Map((grammar.bindings ?? []).map((row) => [tagKey(row.tag), row.label]));

  const refinements: CategoryRefinement[] = [];
  for (const feature of inherentFeatures(grammar, category)) {
    if (present.has(feature.feature)) continue;
    const options: CategoryOption[] = [];
    for (const value of grammar.values ?? []) {
      if (value.feature !== feature.feature) continue;
      const tag: Tag = {
        ...(category.upos !== undefined ? { upos: category.upos } : {}),
        feats: [...(category.feats ?? []), valueTag(value).feats![0]!],
      };
      const label = named.get(tagKey(tag));
      options.push({
        tag,
        label: label ?? value.label,
        named: label !== undefined,
      });
    }
    if (options.length > 0) refinements.push({ feature, options });
  }
  return refinements;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidLabel(value: unknown): value is GrammarLabel {
  if (!isPlainObject(value)) return false;
  if (typeof value.long !== "string" || value.long.trim() === "") return false;
  return value.short === undefined || typeof value.short === "string";
}

function isValidReferences(value: unknown): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value)) return false;
  return value.every((item) => {
    if (!isPlainObject(item)) return false;
    if (typeof item.text !== "string" || item.text.trim() === "") return false;
    return item.url === undefined || typeof item.url === "string";
  });
}

function isValidScheme(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && value !== "");
}

/**
 * A layout coordinate is shape-checked as the feature item it stands for, so a
 * multivalue coordinate ("Gender=Fem,Masc" for an épicène cell) is accepted on
 * exactly the terms layer 1 accepts one. A `scheme` is not read: coordinates are
 * bare by design and provenance is re-attached from the row that bound them.
 */
function isValidLayoutCoord(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return isValidTagFeat({ feature: value.feature, value: value.value });
}

function isValidLayoutCoords(value: unknown): boolean {
  return Array.isArray(value) && value.every(isValidLayoutCoord);
}

function isValidLayoutCells(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.every((cell) => isPlainObject(cell) && isValidLayoutCoords(cell.coords));
}

function isValidLayoutDimension(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.every((name) => typeof name === "string" && FEATURE_NAME_PATTERN.test(name));
}

function isValidLayoutBlock(value: unknown): value is LayoutBlock {
  if (!isPlainObject(value)) return false;
  if (value.kind !== "table" && value.kind !== "list") return false;
  if (value.summary !== undefined && typeof value.summary !== "boolean") return false;
  if (value.fixed !== undefined && !isValidLayoutCoords(value.fixed)) return false;
  if (value.rows !== undefined && !isValidLayoutDimension(value.rows)) return false;
  if (value.columns !== undefined && !isValidLayoutDimension(value.columns)) return false;
  if (value.exclude !== undefined && !isValidLayoutCells(value.exclude)) return false;
  // A list's items are the block itself, so their absence is a shape failure
  // where a table's is nothing at all.
  if (value.kind === "list") return isValidLayoutCells(value.items);
  return value.items === undefined || isValidLayoutCells(value.items);
}

/**
 * Whether an unknown value is a well-formed `grammar` object. **Shape only**:
 * a row is never rejected for naming vocabulary absent from a UD snapshot,
 * which is what lets a language with no published tagset declare its own. The
 * gate and the orphan rule are reported by `grammarIssues`, not enforced here
 * — they describe a grammar that is well-formed but incoherent, and the two
 * failures have deliberately different consequences.
 */
export function isValidGrammar(value: unknown): value is Grammar {
  if (!isPlainObject(value)) return false;

  if (value.pos !== undefined) {
    if (!Array.isArray(value.pos)) return false;
    for (const row of value.pos) {
      if (!isPlainObject(row)) return false;
      if (!isValidTagUpos({ value: row.value, scheme: row.scheme })) return false;
      if (!isValidLabel(row.label) || !isValidScheme(row.scheme)) return false;
      if (!isValidReferences(row.references)) return false;
    }
  }

  if (value.features !== undefined) {
    if (!Array.isArray(value.features)) return false;
    for (const row of value.features) {
      if (!isPlainObject(row)) return false;
      if (typeof row.feature !== "string" || !FEATURE_NAME_PATTERN.test(row.feature)) return false;
      if (!isValidLabel(row.label) || !isValidScheme(row.scheme)) return false;
      if (!isValidReferences(row.references)) return false;
    }
  }

  if (value.values !== undefined) {
    if (!Array.isArray(value.values)) return false;
    for (const row of value.values) {
      if (!isPlainObject(row)) return false;
      if (!isValidTagFeat({ feature: row.feature, value: row.value, scheme: row.scheme })) {
        return false;
      }
      if (!isValidLabel(row.label) || !isValidScheme(row.scheme)) return false;
      if (!isValidReferences(row.references)) return false;
    }
  }

  if (value.inherent !== undefined) {
    if (!Array.isArray(value.inherent)) return false;
    for (const row of value.inherent) {
      if (!isPlainObject(row)) return false;
      if (!isValidTag(row.category)) return false;
      if (typeof row.feature !== "string" || !FEATURE_NAME_PATTERN.test(row.feature)) return false;
    }
  }

  // An axis naming no values is well-formed and merely says nothing, so like a
  // single-item combination it is reported by `grammarIssues` rather than
  // rejected here: shape failures discard the whole record, and one empty row
  // is not worth a language's entire declaration.
  if (value.axes !== undefined) {
    if (!Array.isArray(value.axes)) return false;
    for (const row of value.axes) {
      if (!isPlainObject(row)) return false;
      if (!isValidTag(row.category)) return false;
      if (typeof row.feature !== "string" || !FEATURE_NAME_PATTERN.test(row.feature)) return false;
      if (!Array.isArray(row.values)) return false;
      // Each value is validated as the feature item it stands for, so a
      // multivalue option ("Gender=Fem,Masc" for an épicène form) is accepted
      // on exactly the terms layer 1 accepts one.
      for (const item of row.values) {
        if (!isValidTagFeat({ feature: row.feature, value: item })) return false;
      }
    }
  }

  // Layer 4. Every field present is checked, whichever kind the block claims to
  // be, so a malformed array cannot ride along unvalidated; which fields are
  // *meaningful* is the `kind`'s business, and a table carrying a stray `items`
  // is ignored rather than rejected. An empty block, like an empty axis, is
  // reported by `grammarIssues` instead of discarding the record.
  if (value.layout !== undefined) {
    if (!Array.isArray(value.layout)) return false;
    for (const row of value.layout) {
      if (!isPlainObject(row)) return false;
      if (!isValidTag(row.category)) return false;
      if (!Array.isArray(row.blocks)) return false;
      for (const block of row.blocks) {
        if (!isValidLayoutBlock(block)) return false;
      }
    }
  }

  // A single-item combination is well-formed and merely redundant, so it is
  // *not* rejected here: shape failures reject the whole record, and a whole
  // language's declaration is far too much to discard over one row that says
  // something true in the wrong place. `grammarIssues` reports it instead.
  if (value.bindings !== undefined) {
    if (!Array.isArray(value.bindings)) return false;
    for (const row of value.bindings) {
      if (!isPlainObject(row)) return false;
      if (!isValidTag(row.tag)) return false;
      if (!isValidLabel(row.label)) return false;
      if (!isValidReferences(row.references)) return false;
    }
  }

  return true;
}
