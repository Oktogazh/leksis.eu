// Contract for the `grammar` sub-object of an eu.leksis.language record —
// layers 1 and 2 of the grammar layer (docs/design/grammatical-tagging.md,
// revised by docs/design/category-axis-merge.md and then by ADR-0020, which
// wins over both).
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
//   features — a feature *name*: the header a table prints, and the gate below
//   values   — a value, stating which feature it is an option of
//
// Layer 2 declares what those atoms combine into, in two more arrays:
//
//   inherent   — "for this category, this feature is inherent": a property of
//                the word itself rather than of one of its forms
//   categories — a headword category and the one label a reader sees for it
//
// The two are gated the same way layer 1 gates a value behind its feature
// name: a category of two or more atoms has to be reachable through the
// inherence declarations that build it up. One rule at two levels — which is
// why both render as navigation in the editor rather than as validation errors.
//
// **Nothing here says what a word's forms vary over** (ADR-0020, which removed
// the per-category `axis` ADR-0019 had just introduced, one revision after the
// standalone `axes` and `layout` arrays went). The line an axis drew — this
// feature identifies the word, that one varies across its forms — is not one a
// language can draw: Breton cites an ordinary noun in the singular, a
// collective-only noun in the collective, and an *anv-kadarn stroll* in the
// **plural**, so `Number` both identifies those headwords and is what their
// forms range over. Three flavours are therefore three **categories**, one
// abbreviation each, at the depth the inherence tree reaches them.
//
// So a category is a **labelled tag**, exactly what an entry created through it
// carries. That is what makes the entry record self-describing and what makes a
// paradigm's selector an exact match rather than a containment test.
//
// The *shape* of the inflection tables is declared nowhere here: it belongs to
// the eu.leksis.paradigm record, which defines its cells one by one, because
// real conjugation tables are not cartesian products of anything.
//
// Two more things a dictionary prints are declared here and take part in none
// of that cascade, because they are lexicography rather than grammar:
//
//   a **lexicographic** feature — register, domain, editorial usage ("arch.",
//     "neol.", "by extension"). Structurally a minted feature with values, so
//     its values are ordinary tags an entry or a sense carries; flagged so the
//     grammatical layers never offer it, since "by extension" is not something
//     a word *is* nor something its forms *vary over*
//   abbreviations — `udb.` for "un dra bennak": shallow primitives standing for
//     no tag at all, identified by their own short form
//
// Both exist because the alternative is worse. An editorial label written as
// free prose on an entry is one the language cannot govern — invisible to the
// worklist, uncorrectable in one place, free to drift between two entries — and
// that is exactly what ADR-0008 removed from the entry lexicon. Naming them
// here keeps a single home for every displayed string.

import {
  featureKey,
  featValues,
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
  /**
   * Free homolingual prose about the part of speech — see
   * {@link GrammarValue.note}, whose reasoning it shares.
   *
   * It lives here rather than on a category because **a bare part of speech has
   * no category row to live on**: its tag is the one this row binds, so a
   * `categories` row for it would be a `duplicate`. The editor's category level
   * therefore reads and writes *this* row when the bundle is a bare part of
   * speech — one fact, one home, reachable through both doors.
   */
  note?: string;
}

/**
 * A bound feature *name*: `Case` → "troad". Not a tag — a bare name has no
 * value — and not a chip: this is the header a paradigm's tables print, and the
 * gate every value of the feature sits behind.
 */
export interface GrammarFeature {
  feature: string;
  scheme?: string;
  label: GrammarLabel;
  references?: GrammarReference[];
  /**
   * Free homolingual prose about the nature of this item — see
   * {@link GrammarValue.note}, which it shares its reasoning with. On a feature
   * it covers all three of the shapes a feature can be: a grammatical feature,
   * an inflection class and a lexicographic label set are one row type
   * distinguished by `scheme` and `lexicographic`, so they need one field, not
   * three.
   */
  note?: string;
  /**
   * True when this is a **lexicographic** label set rather than a grammatical
   * feature: register, domain, editorial usage — `arch.`, `neol.`, "by
   * extension". Its values are ordinary tags an entry or a sense may carry, and
   * they render and bind exactly like any other; what the flag withholds is
   * participation in the grammatical layers. A lexicographic feature is never
   * inherent to a category and never part of a category's own bundle, because
   * neither describes it: "by extension" is not something a word *is*.
   *
   * It is a flag on a feature rather than a sixth array because the machinery
   * is a feature's exactly — one name, several values, one label each — and a
   * fact keeps one home. The exclusions are rendered as navigation in the
   * editor — a lexicographic set is simply absent from the grammatical layers'
   * pickers — and reported by `grammarIssues`, which is now also what refuses
   * such a record at ingest (ADR-0015).
   */
  lexicographic?: boolean;
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
  /**
   * Free prose about the nature of this item, written in the language being
   * described, for a reader of it — what it covers here, where its border with
   * a sibling falls, when a contributor should reach for it.
   *
   * **It is the third thing a row can say, and the other two cannot say it.**
   * `label` *names* the item and is a display string, sized for a chip;
   * `references` say where the claim comes from and are a citation, not an
   * explanation. Neither carries "this language's Number=Sgv is the singulative,
   * a form derived from a collective — not the plural", which is the sentence a
   * printed dictionary puts under the heading in its front matter and the one a
   * contributor needs before choosing between two values.
   *
   * A single string rather than a list: an entry's `notes[]` is a list of
   * independent remarks about a word, where this is one remark about one row.
   * Paragraphs are newlines.
   *
   * **Content, indexed nowhere** — the precedent is a paradigm's rules
   * (ADR-0016) and an example sentence (ADR-0014). It rides to a reader on the language record
   * the dashboard already resolves from its author's PDS, so it cost no
   * collection, no endpoint and no ingest logic beyond being accepted.
   */
  note?: string;
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
 * A headword category this language names: what a word *is*, and what this
 * dictionary calls it.
 *
 * **One row per category, and it carries one label.** French `{NOUN,
 * Gender=Fem}` → "nf."; a language that prints "n. f." instead binds the two
 * atoms separately and never writes a row here — decomposition renders it, and
 * a synthesised label nobody authored is precisely what the rendering chain
 * refuses to invent.
 *
 * **A single atom is allowed** by the shape, but has no use: its tag is the one
 * the `pos` row binds, so a row for it is a `duplicate`. The editor's category
 * level edits that `pos` row instead — same label, same note, one home.
 *
 * **What a category never declares is what its forms vary over.** ADR-0019 put
 * an `axis` here and one annotation per headword flavour of it; ADR-0020 took
 * both away, because the distinction was not one a language can draw. Breton's
 * *anv-kadarn stroll* is cited in the plural, so `Number` identifies that
 * headword — and it is also what an ordinary noun's forms range over. A feature
 * that is a constant here and a coordinate there is the ordinary case, not a
 * contradiction, so the only honest declaration is the one that says which
 * features **define** the headword (`inherent`), and the paradigm's own tables
 * say which cells exist. One flavour, one category, one abbreviation.
 */
export interface GrammarCategory {
  category: Tag;
  /** How this dictionary names the category — its one labelled tag. */
  label: GrammarLabel;
  /**
   * Free homolingual prose about the category — see {@link GrammarValue.note},
   * whose reasoning it shares exactly. `label` *names* the category and is
   * sized for a chip; this is the paragraph a printed dictionary puts under the
   * heading in its front matter, and the one a contributor needs before
   * choosing between two categories that look alike.
   *
   * Content, indexed nowhere: it rides to a reader on the language record the
   * dashboard already resolves from its author's PDS.
   */
  note?: string;
}

/**
 * One coordinate of a cell address: a bare `Feature=Value` pair.
 *
 * **Bare, and matched by name** — an address is a *selection* from the
 * language's inventory, never a second place to declare it, so it repeats
 * neither provenance nor labels. That has a consequence which is load-bearing
 * rather than cosmetic: provenance is re-attached from the `values` row before
 * anything is displayed or matched (see `coordTag`), because a form authored
 * through the language's own picker carries the minting scheme and an address
 * built without it would match nothing and find no label.
 *
 * It lives here rather than with the paradigm shapes because the re-qualifying
 * step needs the grammar.
 */
export interface LayoutCoord {
  feature: string;
  /** One value, or several comma-separated ones for a form spanning them all. */
  value: string;
}

/**
 * A traditional dictionary abbreviation: `udb.` → "un dra bennak", `s.o.` →
 * "someone". A shallow primitive — not a feature, not a value, not an option to
 * pick from a list — and the one row of the whole object that stands for no tag
 * at all.
 *
 * **`value` is the identity and `short` is what is printed** (ADR-0020, which
 * split them). Every other row here already separates the two — a `values` row
 * keys on `Sgv` and prints "una." — and an abbreviation now does too, for the
 * reason that split exists anywhere: an identifier is ASCII and shapeless where
 * a printed form is neither. "u.d.b." carries stops, a Cyrillic or Greek
 * tradition abbreviates in its own script, and a key made of either travels
 * badly through a document key and a URL. Keying on the printed form also made
 * *correcting* it impossible: changing "udb." to "u.d.b." was deleting one row
 * and adding another.
 *
 * It carries no `scheme`. Provenance answers "which tagset is this from", and
 * for an abbreviation the answer is always the same one: this language's own
 * lexicographic tradition.
 */
export interface GrammarAbbreviation {
  /**
   * The row's identity, unique within a language: ASCII letters and digits, the
   * shape of an identifier rather than of a printed abbreviation
   * ({@link ABBREVIATION_VALUE_PATTERN}). Never displayed to a reader.
   */
  value: string;
  /** The abbreviated form, exactly as this dictionary prints it. */
  short: string;
  /** What it stands for, written out. */
  long: string;
  /**
   * Free homolingual prose about what the abbreviation covers — the same field
   * a feature, a value and a category carry, for the same reason: `long` is the
   * expansion, and an expansion is not always an explanation. "un dra bennak"
   * says what "udb." unfolds to and not when a contributor should reach for it.
   */
  note?: string;
  references?: GrammarReference[];
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
 *
 * `abbreviations` references nothing and nothing references it, so it could
 * have lived elsewhere; it does not, because a contributor opening "the labels
 * of this language" means one shelf, and splitting the front matter of a
 * dictionary across two records would buy nothing.
 */
export interface Grammar {
  pos?: GrammarPos[];
  features?: GrammarFeature[];
  values?: GrammarValue[];
  inherent?: GrammarInherent[];
  categories?: GrammarCategory[];
  abbreviations?: GrammarAbbreviation[];
}

/**
 * The maximum length of every array the `grammar` object holds, mirroring the
 * `maxLength` each one declares in `lexicons/eu.leksis.language.json`.
 *
 * **The lexicon's limits are validation, not documentation.** A record past one
 * of them is not a record of this lexicon, so the interface could never have
 * published it and `isValidGrammar` refuses it — the cardinality half of the
 * rule in ADR-0015. They are what stops one bot from turning the binding editor
 * into ten thousand list items and the `labels` model into ten thousand docs;
 * every real declaration is orders of magnitude below them.
 */
export const GRAMMAR_LIMITS = {
  pos: 64,
  features: 256,
  values: 2048,
  inherent: 512,
  categories: 1024,
  abbreviations: 512,
  /** Coordinates of one cell address. */
  coords: 16,
  /** References on one row. */
  references: 16,
} as const;

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
export type GrammarRowKind = "pos" | "feature" | "value" | "combination" | "abbreviation";

/**
 * The shape an abbreviation's identity must take: ASCII letters and digits,
 * starting with either.
 *
 * Deliberately **not** one of the tag patterns, and deliberately looser than
 * `FEATURE_VALUE_PATTERN`: an abbreviation is not a tag, so requiring an
 * initial capital would be borrowing UD's convention for something UD has no
 * opinion about, and "udb" reads better as itself than as "Udb". What it does
 * borrow is the part that matters — an identifier with no stops, no spaces and
 * no script of its own, so it survives a document key and a URL where the
 * printed form ("u.d.b.", "сущ.") would not.
 */
export const ABBREVIATION_VALUE_PATTERN = /^[A-Za-z0-9]+$/;

/**
 * Canonical key of an abbreviation row — its identity, **prefixed**, for the
 * reason `categoryKey` is: an abbreviation shares one key space with every
 * tag a language binds, and `abbr#` is what guarantees it can never be mistaken
 * for one. A tag lookup asking for this key gets nothing, which is correct: an
 * abbreviation stands for no tag, so no tag should ever resolve to it.
 */
export function abbreviationKey(row: { value: string }): string {
  return `abbr#${row.value}`;
}

/**
 * The feature names this language declared as lexicographic label sets — the
 * ones the grammatical layers must not offer.
 */
export function lexicographicFeatures(grammar: Grammar): Set<string> {
  return new Set(
    (grammar.features ?? []).filter((row) => row.lexicographic === true).map((row) => row.feature),
  );
}

/** Whether this language declares `feature` a lexicographic label set. */
export function isLexicographic(grammar: Grammar, feature: string): boolean {
  return (grammar.features ?? []).some(
    (row) => row.feature === feature && row.lexicographic === true,
  );
}

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
 * Stable identity of a category **declaration** — the row, not the tag it
 * labels.
 *
 * Deliberately **prefixed**: a declaration and the tag it names would otherwise
 * key the same string, and an issue reported against the row ("this atom is not
 * bound") must not read as an issue against the label. It is also what makes
 * "two rows for one category" reportable at all.
 */
export function categoryKey(row: { category: Tag }): string {
  return `category#${tagKey(row.category)}`;
}

/**
 * A feature value's identity for matching, with provenance deliberately
 * dropped and any multivalue item's values normalised into UD's order. A cell
 * coordinate names its value bare, so this is the only way it can reach the
 * `values` row that bound it — and it is the same "by name, never by scheme"
 * rule that already lets a value minted on a UD feature find that feature.
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
  // Layer 2's categories are rows like any other, which is the whole reason
  // they need no plumbing of their own: they flow into the labels read model
  // and into the renderer's lookup through this one function, and a language's
  // "nf." lands on the same shelf as its "n.".
  //
  // **One row per declaration** — which is what ADR-0020 restored by removing
  // the axis: a category is one bundle with one label, so a headword flavour
  // cited at a particular value of a feature is a category of its own, named on
  // its own row, and `resolveTag`'s exact branch finds it without anything here
  // having to synthesise a tag.
  for (const row of grammar.categories ?? []) {
    rows.push({
      kind: "combination",
      key: tagKey(row.category),
      label: row.label,
      tag: row.category,
    });
  }
  // An abbreviation flows through here for the same reason a combination does:
  // it is a row like any other, so it reaches the language's label list with no
  // plumbing of its own. What it never gets is a `tag` — there is none, and the
  // prefixed key keeps it out of the renderer's lookup entirely.
  for (const row of grammar.abbreviations ?? []) {
    rows.push({
      kind: "abbreviation",
      key: abbreviationKey(row),
      label: { long: row.long, short: row.short },
      ...(row.references !== undefined ? { references: row.references } : {}),
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

/** Whether this language declares `feature` inherent to exactly this category. */
export function isInherent(grammar: Grammar, category: Tag, feature: string): boolean {
  const key = tagKey(category);
  return (grammar.inherent ?? []).some(
    (row) => row.feature === feature && tagKey(row.category) === key,
  );
}

/**
 * The category declaration for exactly this bundle, if any.
 *
 * Exact, not by containment: a declaration *is* a row about one category, and
 * two rows for one bundle is a defect `grammarIssues` reports rather than a
 * precedence question. Reaching an entry that named more than the declaration
 * did is `headwordKeys`' business, and it is by containment there.
 */
export function categoryRow(grammar: Grammar, category: Tag): GrammarCategory | undefined {
  const key = tagKey(category);
  return (grammar.categories ?? []).find((row) => tagKey(row.category) === key);
}

// ---- layer 5: which entries a paradigm reaches ---------------------------
//
// A paradigm selects the entries it generates forms for by **exact match** on
// the headword bundle (ADR-0019, which replaced containment over the entry's
// inherent atoms). The bundle carries every feature the language declares
// identifying, so it fully identifies a kind of headword: `{NOUN}` selects only
// entries whose headword bundle is literally a bare noun, and the *anv-kadarn
// stroll* flavour `{NOUN, Gender=Masc, Number=Plur}` is a different paradigm
// rather than a more specific one. That is what removes the whole
// most-specific-wins machinery: two paradigms cannot both reach one entry.
//
// Both sides are reduced to the same scheme-blind key, which is what lets the
// AppView store an entry's on its doc and answer "every entry this new rule
// reaches" with an indexed equality lookup — never a scan, and never a record
// fetched from a PDS.

/**
 * The keys of a bundle's atoms, **scheme-blind** — the alphabet a category's
 * atoms are compared in.
 *
 * Provenance is dropped for the reason `featsMatchKey` drops it wherever a form
 * meets a cell: a bot writes `Conjugation=2` bare where the language's own
 * editor writes it carrying the minting language's scheme, and a rule reaching
 * only one of the two would be worse than one reaching both. The part of speech
 * keeps its own slot, as it does in every key here — it is its own CoNLL-U
 * column, and `upos=` can never collide with a feature item.
 */
export function tagAtomKeys(tag: Tag): string[] {
  const keys: string[] = [];
  if (tag.upos !== undefined) keys.push(tagKey({ upos: { value: tag.upos.value } }));
  for (const feat of tag.feats ?? []) keys.push(featsMatchKey({ feats: [feat] }));
  return keys;
}

/**
 * A whole bundle's key with provenance dropped — the string a paradigm's
 * selector and an entry's headword bundle are compared on.
 *
 * `featsMatchKey` one altitude up: it keeps the part of speech, because a
 * selector without one selects a different thing from a selector with one,
 * while a form's address never carries one at all.
 */
export function headwordMatchKey(tag: Tag): string {
  return tagKey({
    ...(tag.upos !== undefined ? { upos: { value: tag.upos.value } } : {}),
    feats: (tag.feats ?? []).map((feat) => ({ feature: feat.feature, value: feat.value })),
  });
}

/**
 * The **headword keys** of an entry: one per category bundle it carries, each
 * the scheme-blind key of that bundle stripped to what identifies a kind of
 * word — its part of speech and the features the language declares inherent
 * for it.
 *
 * The filter is the point. `categories` is lexeme-level, but nothing stops a
 * record from carrying a form's feature there, and an atom the language never
 * declared identifying is noise a rule must not select on. What survives is
 * precisely the bundle a paradigm's `selector` is compared with.
 *
 * **One declaration decides it, since ADR-0020**: `inherent`. ADR-0019 had a
 * second term here — an axis value the category named as one of its defaults —
 * and removing the axis removed it. Nothing is lost: the value that identified
 * an *anv-kadarn stroll* is now declared the way every other identifying
 * feature is, `Number` inherent to `{NOUN, Gender=Masc}`, so the same bundle
 * survives the filter through the rule that was always there.
 *
 * Inherence is read **per category and by containment**, so a declaration on
 * `{NOUN}` reaches an entry categorised `{NOUN, Gender=Fem}`, and one on
 * `{NOUN, Gender=Masc}` reaches an entry that also names its declension.
 *
 * The part of speech needs no declaration of any kind: it is what a paradigm
 * minimally selects on, and requiring it to be bound first would make every
 * paradigm of a language whose labels nobody has written yet silently inert.
 *
 * Takes a declarations object rather than the whole grammar because the caller
 * is the firehose consumer, which holds `inherent` cached on the language doc
 * and has no record in hand. Deduped and sorted, so one entry's stored value is
 * stable and two runs cannot differ on ordering alone.
 */
export function headwordKeys(
  declarations: { inherent?: readonly GrammarInherent[] },
  categories: readonly Tag[],
): string[] {
  const inherent = declarations.inherent ?? [];
  const keys = new Set<string>();
  for (const category of categories) {
    const held = heldKeys([category]);
    const feats = (category.feats ?? []).filter((feat) =>
      inherent.some((row) => row.feature === feat.feature && held.has(tagKey(row.category))),
    );
    const bundle: Tag = {
      ...(category.upos !== undefined ? { upos: category.upos } : {}),
      ...(feats.length > 0 ? { feats } : {}),
    };
    if (category.upos === undefined && feats.length === 0) continue;
    keys.add(headwordMatchKey(bundle));
  }
  return [...keys].sort();
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

// ---- cell addresses ------------------------------------------------------
//
// Everything below is about an **address**: the bare coordinates that name one
// cell of a paradigm, how provenance is re-attached to them, and how an entry's
// own forms find the cell they belong in. The cells themselves are declared by
// the eu.leksis.paradigm record (ADR-0019), which is why nothing here derives a
// grid from anything.
//
// It lives in this package rather than in a component because one generator has
// to serve the viewer now and the exporters later, and because deciding which
// form lands where is exactly the kind of arithmetic that has to be checkable
// without a browser.

/**
 * The `values` row a bare coordinate names, matched by name with provenance
 * ignored — the same rule that lets a category's `default` name its value
 * bare.
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

/**
 * The join key of a bare coordinate list — the same string `featsMatchKey`
 * produces for the tag those coordinates address, **without needing the
 * grammar**.
 *
 * The equality is not a coincidence and is what makes this safe: `coordTag`
 * only re-attaches provenance, and `featsMatchKey` drops it again. So a rule
 * engine can address a cell before the language record has been resolved —
 * which layer 5's expansion job does, since it runs inside ingest with only the
 * paradigm record in hand — and still land on the address a viewer computed the
 * long way round.
 */
export function coordsMatchKey(coords: readonly LayoutCoord[]): string {
  return featsMatchKey({
    feats: coords.map((coord) => ({ feature: coord.feature, value: coord.value })),
  });
}

/** The scheme-blind keys of a tag's feature items. */
function featKeySet(tag: Tag): Set<string> {
  return new Set((tag.feats ?? []).map((feat) => valueMatchKey(feat.feature, feat.value)));
}

/**
 * Above this many spanned addresses one form stops being expanded and is matched
 * as written. A form covering three binary axes spans eight cells; anything past
 * this is a record mistyped rather than a language with unusually deep
 * syncretism, and a cartesian product is not the place to find that out.
 */
const MAX_SPANNED_ADDRESSES = 64;

/**
 * The addresses one form **spans**: its own, expanded over every multivalue item
 * it carries.
 *
 * This is how syncretism reaches the table. A form written `Gender=Fem,Masc`
 * says "one form, both genders" — the settled spelling, deliberately not a
 * wildcard — so in a gendered grid it belongs in the feminine cell *and* the
 * masculine one, where a form written `Gender=Fem` belongs in exactly one. UD's
 * multivalue notation is the only thing that makes a form answer to several
 * distinct addresses, so expanding it is the whole of the rule.
 *
 * A form carrying no multivalue expands to itself, which is what makes this
 * change invisible to everything written before layer 5: single-valued
 * placement is bit-for-bit what it was.
 */
function spannedTags(tag: Tag): Tag[] {
  const feats = tag.feats ?? [];
  if (!feats.some((feat) => featValues(feat).length > 1)) return [tag];

  let spread: TagFeat[][] = [[]];
  for (const feat of feats) {
    const values = featValues(feat);
    if (spread.length * values.length > MAX_SPANNED_ADDRESSES) return [tag];
    spread = spread.flatMap((prefix) =>
      values.map((value) => [...prefix, { ...feat, value }]),
    );
  }
  return spread.map((expanded) => ({ ...tag, feats: expanded }));
}

/** Whether every one of these coordinates appears among those keys. */
function coordsContained(coords: readonly LayoutCoord[], keys: ReadonlySet<string>): boolean {
  return coords.every((coord) => keys.has(valueMatchKey(coord.feature, coord.value)));
}

/**
 * One addressed cell of a paradigm — what a form is matched against.
 *
 * Three fields and each earns its place: `coords` is the address as the record
 * stores it, bare; `tag` is the same address with provenance re-attached
 * (`coordTag`), because a reader is shown the cell's **labels** and a key
 * cannot be resolved back into one; and `key` is the scheme-blind join key a
 * form finds its cell on.
 */
export interface CellAddress {
  coords: LayoutCoord[];
  tag: Tag;
  /** Scheme-blind join key — how a form finds its cell. */
  key: string;
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
 * **Multivalue spans from both sides** (ADR-0019). A form written
 * `Gender=Fem,Masc` has always covered every address it names; since the table
 * moved into the paradigm record a *cell* may be written the same way, and a
 * syncretic cell is now the ordinary way to draw one. So each side is expanded
 * to the addresses it spans before they meet, and a cell keeps its own key
 * whichever of its addresses a form landed on — which is what keeps the
 * placement map keyed by the cell the viewer draws. While cells were derived
 * from a layout they were single-valued by construction, so this expansion is a
 * no-op on everything written before it.
 *
 * Nothing is ever dropped. A generated cell is overridden from this same
 * placement, and an `otherForm` matching no declared cell has to keep rendering
 * somewhere — that is the failure the flat list exists to absorb.
 */
export function placeForms<T extends { tag: Tag }>(
  cells: readonly CellAddress[],
  forms: readonly T[],
): PlacedForms<T> {
  /** Every address each cell spans, each still carrying the cell's own key. */
  const spread = cells.flatMap((cell) =>
    spannedTags({ feats: cell.coords.map((coord) => ({ ...coord })) }).map((address) => ({
      key: cell.key,
      coords: (address.feats ?? []) as LayoutCoord[],
      matchKey: featsMatchKey(address),
    })),
  );
  // First cell wins a shared address: two cells claiming one is a defect the
  // record is refused for, and a draft that has one still has to render.
  const byKey = new Map<string, string>();
  for (const address of spread) {
    if (!byKey.has(address.matchKey)) byKey.set(address.matchKey, address.key);
  }
  const placed = new Map<string, T[]>();
  const leftover: T[] = [];
  const put = (key: string, form: T): void => {
    const list = placed.get(key);
    if (list === undefined) placed.set(key, [form]);
    else list.push(form);
  };

  for (const form of forms) {
    // Every address this form spans — itself, unless it carries a multivalue
    // item, in which case one form covers several cells and has to land in each
    // of them. Each address is then matched exactly as a single-valued form
    // always was.
    const claimed = new Set<string>();
    for (const address of spannedTags(form.tag)) {
      const exact = byKey.get(featsMatchKey(address));
      if (exact !== undefined) {
        claimed.add(exact);
        continue;
      }
      const held = featKeySet(address);
      let best: (typeof spread)[number] | undefined;
      for (const cell of spread) {
        if (cell.coords.length === 0 || !coordsContained(cell.coords, held)) continue;
        if (best === undefined || cell.coords.length > best.coords.length) best = cell;
      }
      if (best !== undefined) claimed.add(best.key);
    }
    // Spanning some cells and not others is not a failure: a form covering both
    // genders of a table that only lays out one still belongs in the cell it
    // found. Only a form that reached **no** cell at all is a leftover.
    if (claimed.size === 0) leftover.push(form);
    else for (const key of claimed) put(key, form);
  }
  return { placed, leftover };
}

/**
 * How one drawn cell of a table covers the grid: itself, or a rectangle of
 * merged cells. `"covered"` marks a position some earlier cell already spans,
 * which the viewer draws nothing at.
 */
export type CellSpan = { colSpan: number; rowSpan: number } | "covered";

/**
 * Plan a table's cells into merged rectangles — the geometry of syncretism.
 *
 * A form written `Gender=Fem,Masc` covers both cells with **one** form, and a
 * table that printed it twice would say two things where the language said one.
 * So contiguous cells whose contents are *the same form* are drawn as a single
 * spanned cell. `key` decides sameness and must identify the form **instance**,
 * never its spelling: two forms that merely happen to agree are two answers that
 * coincide, and merging them would assert a syncretism nobody declared. A `key`
 * of `undefined` never merges, which is how a designer's grid keeps every cell
 * separately clickable.
 *
 * Only whole matching runs extend downwards, so every merge is a rectangle and
 * never claims a position it does not cover; a non-rectangular group simply
 * becomes several rectangles, which is still merged rather than repeated.
 *
 * It lives here rather than in the component for the reason `placeForms` does:
 * what a reader sees should be checkable without a browser.
 */
export function mergeCellSpans(
  cells: readonly (CellAddress | undefined)[][],
  key: (address: CellAddress) => string | undefined,
): CellSpan[][] {
  const rows = cells.length;
  const spans: CellSpan[][] = cells.map((line) => line.map(() => ({ colSpan: 1, rowSpan: 1 })));
  const keyAt = (row: number, column: number): string | undefined => {
    const address = cells[row]?.[column];
    return address === undefined ? undefined : key(address);
  };

  for (let row = 0; row < rows; row++) {
    const line = cells[row]!;
    for (let column = 0; column < line.length; column++) {
      if (spans[row]![column] === "covered") continue;
      const wanted = keyAt(row, column);
      if (wanted === undefined) continue;

      let colSpan = 1;
      while (
        column + colSpan < line.length &&
        spans[row]![column + colSpan] !== "covered" &&
        keyAt(row, column + colSpan) === wanted
      ) {
        colSpan += 1;
      }
      let rowSpan = 1;
      while (
        row + rowSpan < rows &&
        Array.from({ length: colSpan }, (_, i) => keyAt(row + rowSpan, column + i)).every(
          (below) => below === wanted,
        )
      ) {
        rowSpan += 1;
      }

      spans[row]![column] = { colSpan, rowSpan };
      for (let r = row; r < row + rowSpan; r++) {
        for (let c = column; c < column + colSpan; c++) {
          if (r !== row || c !== column) spans[r]![c] = "covered";
        }
      }
    }
  }
  return spans;
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
 *   tag resolves to depend on array order. Also two **category declarations**
 *   for one category, which would make its label depend on array order.
 * - `unbound-atom` — a layer-2 row built on an atom layer 1 does not bind: a
 *   category can only be made of what the language has declared it uses.
 * - `ungrounded-combination` — a category of two or more atoms that no chain of
 *   inherence declarations reaches. Layer 2's gate, and the same rule as
 *   `unbound-feature` one level up. A single-atom category needs no grounding —
 *   a part of speech on its own is a headword category, which is what ADR-0019
 *   dropped the old two-atom floor for.
 * - `lexicographic-in-grammar` — a lexicographic label set, or one of its
 *   values, used where the grammatical layers expect a grammatical feature: as
 *   an inherent feature, or inside a category's own bundle. The flag says this
 *   vocabulary describes usage rather than form, so a paradigm cannot be built
 *   from it — a table of "archaic" against "by extension" addresses no cell.
 * - `duplicate-abbreviation` — two abbreviations sharing an identity. Distinct
 *   from `duplicate` because the defect is different: a duplicate label makes a
 *   *tag* resolve by array order, while two rows under one `value` are two
 *   entries in the front matter under one headword.
 *
 * **Six kinds, where ADR-0019 reported twelve.** The six `category-*` kinds it
 * added were all defects of the axis and its defaults, and ADR-0020 removed
 * what they were about. A category is a bundle with a label again, so what can
 * go wrong with one is what can go wrong with any bundle: an unbound atom, no
 * grounding, a duplicate, or lexicographic vocabulary where grammar belongs.
 */
export interface GrammarIssue {
  kind:
    | "unbound-feature"
    | "duplicate"
    | "unbound-atom"
    | "ungrounded-combination"
    | "lexicographic-in-grammar"
    | "duplicate-abbreviation";
  /** Canonical key of the offending row. */
  key: string;
  /** The feature name at fault, on an `unbound-feature` issue. */
  feature?: string;
  /**
   * The unbound atom, written the way UD writes it, on an `unbound-atom` issue.
   * One row can be built on several unbound atoms, so this is part of the
   * issue's identity rather than a decoration.
   */
  atom?: string;
}

/**
 * Every defect in a grammar. **Empty is the condition for publishing one and
 * the condition for indexing one — the same condition, checked twice**
 * (ADR-0015).
 *
 * An incoherent grammar is a state no editor in `apps/web` can produce, because
 * the binding editor navigates the cascade: a row hanging off something unbound
 * has no level that lists it, no control that edits it and no button that
 * removes it. So indexing one put the interface in front of a record it could
 * neither render as intended nor repair — a deadlock the dashboard could report
 * and nobody could clear. The browser now refuses to publish one and the AppView
 * refuses to index one, which makes the current version of every language
 * coherent by construction.
 *
 * Both callers want the list rather than a boolean — one to log which rows were
 * refused, the other to name them to the contributor — which is why there is no
 * `isCoherentGrammar` predicate wrapping this.
 *
 * Vocabulary is still never judged: an item absent from a UD snapshot is not a
 * defect, and a tag nothing has bound still renders verbatim. What is refused is
 * a grammar that contradicts *itself*.
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

  // The vocabulary the grammatical layers must not reach for. Checked by
  // **name** wherever a feature is named and by the feature of each item
  // wherever a tag is used, which are the only two ways this vocabulary can
  // appear anywhere above layer 1.
  const lexicographic = lexicographicFeatures(grammar);
  /** Report every lexicographic item a category or combination carries. */
  const lexicographicInTag = (key: string, tag: Tag): void => {
    for (const feat of tag.feats ?? []) {
      if (!lexicographic.has(feat.feature)) continue;
      issues.push({
        kind: "lexicographic-in-grammar",
        key,
        feature: feat.feature,
        atom: formatTagVerbatim(valueTag(feat)),
      });
    }
  };
  /** Report a named feature that turns out to be a lexicographic label set. */
  const lexicographicFeature = (key: string, feature: string): void => {
    if (lexicographic.has(feature)) {
      issues.push({ kind: "lexicographic-in-grammar", key, feature });
    }
  };

  for (const row of grammar.values ?? []) {
    if (!boundNames.has(row.feature)) {
      issues.push({ kind: "unbound-feature", key: tagKey(valueTag(row)), feature: row.feature });
    }
  }

  // Two abbreviations under one identity are two front-matter entries under one
  // headword. Keyed on `value` rather than on the printed form since ADR-0020:
  // two rows may legitimately print alike in two traditions, and it is the key
  // a reader's lookup travels through that must be unique.
  const seenAbbreviations = new Set<string>();
  const flaggedAbbreviations = new Set<string>();
  for (const row of grammar.abbreviations ?? []) {
    const key = abbreviationKey(row);
    if (seenAbbreviations.has(key)) {
      if (!flaggedAbbreviations.has(key)) {
        flaggedAbbreviations.add(key);
        issues.push({ kind: "duplicate-abbreviation", key });
      }
      continue;
    }
    seenAbbreviations.add(key);
  }

  // Layer 2, downwards: an inherence declaration may only name a feature and a
  // category this language has actually declared it uses.
  for (const row of grammar.inherent ?? []) {
    const key = inherentKey(row);
    if (!boundNames.has(row.feature)) {
      issues.push({ kind: "unbound-feature", key, feature: row.feature });
    }
    lexicographicFeature(key, row.feature);
    lexicographicInTag(key, row.category);
    for (const atom of tagAtoms(row.category)) {
      if (!atoms.has(tagKey(atom))) {
        issues.push({ kind: "unbound-atom", key, atom: formatTagVerbatim(atom) });
      }
    }
  }

  // Layer 2's categories. Every check here is the cascade's, and since ADR-0020
  // that is all of them: the category's atoms must be bound and grounded, and it
  // must be made of grammar rather than of lexicographic vocabulary. What a
  // category says about its forms is nothing at all — the paradigm's tables say
  // it — so there is no longer an axis to be unbound, inherent, or missing a
  // default.
  const seenCategories = new Set<string>();
  const flaggedCategories = new Set<string>();
  for (const row of grammar.categories ?? []) {
    const key = categoryKey(row);
    if (seenCategories.has(key)) {
      // A second row for one category makes the label a reader sees depend on
      // array order, which is the same defect a duplicate binding is.
      if (!flaggedCategories.has(key)) {
        flaggedCategories.add(key);
        issues.push({ kind: "duplicate", key });
      }
      continue;
    }
    seenCategories.add(key);

    lexicographicInTag(key, row.category);
    const unbound = tagAtoms(row.category).filter((atom) => !atoms.has(tagKey(atom)));
    for (const atom of unbound) {
      issues.push({ kind: "unbound-atom", key, atom: formatTagVerbatim(atom) });
    }
    // Grounding necessarily fails when an atom is missing, so it is only worth
    // reporting once the parts are all there: otherwise one unbound atom
    // produces two issues and the repair worklist reads as twice the work. A
    // single-atom category has nothing to ground — the check above is the whole
    // of its gate, which is what makes a bare part of speech a category.
    if (
      unbound.length === 0 &&
      tagSize(row.category) > 1 &&
      !isGroundedCombination(grammar, row.category)
    ) {
      issues.push({ kind: "ungrounded-combination", key });
    }
  }

  const seen = new Set<string>();
  const flagged = new Set<string>();
  for (const row of grammarRows(grammar)) {
    // Abbreviations were swept above, under a kind that says what is actually
    // wrong with two of them; reporting them here as well would put one defect
    // on the worklist twice.
    if (row.kind === "abbreviation") continue;
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
    // Dropped for the same reason `resolveAxes` drops one: a lexicographic
    // label set is not something a headword *is*, so it never narrows the entry
    // editor's tree even if some record declares it inherent.
    if (feature === undefined || feature.lexicographic === true) continue;
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

/** A feature a form can be addressed by, with the values it can take. */
export interface FormAxis {
  feature: GrammarFeature;
  /** Every value layer 1 bound under it, in record order. */
  values: GrammarValue[];
}

/**
 * The features the `otherForms` editor offers one selector per — every
 * grammatical feature this language bound that has at least one bound value.
 *
 * **Not filtered by the entry's own categories, since ADR-0020.** It used to
 * read the `axis` each declared category named, which is gone — and gone
 * because the filter it fed was wrong wherever it mattered most. Breton's
 * *anv-kadarn stroll* is identified by `Number=Plur` and inflects for `Number`
 * all the same, so a rule that offered a feature only where it was *not*
 * identifying would have hidden the one selector that noun's other form needs.
 *
 * What is offered is therefore a superset, and deliberately: the authoritative
 * statement of which cells exist is the paradigm's tables, this is the manual
 * path beside them, and a manual path that withholds a coordinate is worse than
 * one that offers a coordinate nobody uses. Lexicographic label sets are still
 * absent — "archaic" addresses no cell — and so is any feature with nothing
 * bound under it, which would draw an empty selector.
 *
 * An empty result is the ordinary state of a language that has bound nothing,
 * and the editor degrades to its flat picker plus manual entry.
 */
export function formAxes(grammar: Grammar): FormAxis[] {
  const out: FormAxis[] = [];
  for (const feature of grammar.features ?? []) {
    if (feature.lexicographic === true) continue;
    const values = (grammar.values ?? []).filter((value) => value.feature === feature.feature);
    if (values.length === 0) continue;
    out.push({ feature, values });
  }
  return out;
}

/**
 * The next step of the entry editor's narrowing tree, from a category — a
 * **derived view of layers 1 and 2**, never a separate declaration: the
 * inherence rows and the named categories are what generate it, and nothing
 * extra is authored to get it.
 *
 * Each option is this category plus one bound value of an inherent feature.
 * Options whose combination the language has not named are still offered:
 * their tag renders by decomposition, and the alternative — hiding them —
 * would turn layer 2 into a whitelist, which is exactly what it must not be.
 * A feature already present in the category is not offered again.
 *
 * **One kind of step, since ADR-0020.** ADR-0019 appended a second one for the
 * category's axis, whose options were the flavours it had named; with the axis
 * gone, the feature that says an *anv-kadarn stroll* is cited in the plural is
 * declared inherent like any other, and the walk that reaches it is this one.
 * A contributor's clicks are unchanged — noun, masculine, plural — and what
 * they emit is the same bundle.
 */
export function categoryRefinements(grammar: Grammar, category: Tag): CategoryRefinement[] {
  const present = new Set((category.feats ?? []).map((feat) => feat.feature));
  // Every category the language has named, so a refinement landing on one shows
  // its own label rather than the added atom's.
  const named = new Map(
    (grammar.categories ?? []).map((row) => [tagKey(row.category), row.label] as const),
  );

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
  if (!Array.isArray(value) || value.length > GRAMMAR_LIMITS.references) return false;
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
 * A row's free-prose note: absent, or a non-empty string. Blank is refused on
 * the same terms a blank `references[].text` is — the editor trims and omits an
 * empty note, so a record carrying `note: ""` is one the interface could not
 * have published (ADR-0015). The declared length caps are deliberately not
 * checked here, with every other string cap in the lexicons: an over-long note
 * renders, wraps and edits fine, so refusing the whole grammar over one would
 * lose a contribution to make a point about counting.
 */
function isValidNote(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && value.trim() !== "");
}

/**
 * A cell coordinate is shape-checked as the feature item it stands for, so a
 * multivalue coordinate ("Gender=Fem,Masc" for an épicène cell) is accepted on
 * exactly the terms layer 1 accepts one. A `scheme` is not read: coordinates are
 * bare by design and provenance is re-attached from the row that bound them.
 */
export function isValidLayoutCoord(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return isValidTagFeat({ feature: value.feature, value: value.value });
}

/**
 * Whether an unknown value is a well-formed `grammar` object — **shape and
 * cardinality**, never vocabulary. A row is never rejected for naming an item
 * absent from a UD snapshot, which is what lets a language with no published
 * tagset declare its own; an array past the `maxLength` its lexicon declares
 * *is* rejected, because that is not a record of this lexicon at all.
 *
 * Coherence — the gate and the orphan rule — is `isCoherentGrammar`'s business.
 * Both now reject at ingest (ADR-0015); they stay separate functions because
 * only this one describes a record that cannot be *read*.
 */
export function isValidGrammar(value: unknown): value is Grammar {
  if (!isPlainObject(value)) return false;

  if (value.pos !== undefined) {
    if (!Array.isArray(value.pos) || value.pos.length > GRAMMAR_LIMITS.pos) return false;
    for (const row of value.pos) {
      if (!isPlainObject(row)) return false;
      if (!isValidTagUpos({ value: row.value, scheme: row.scheme })) return false;
      if (!isValidLabel(row.label) || !isValidScheme(row.scheme)) return false;
      if (!isValidReferences(row.references) || !isValidNote(row.note)) return false;
    }
  }

  if (value.features !== undefined) {
    if (!Array.isArray(value.features) || value.features.length > GRAMMAR_LIMITS.features) {
      return false;
    }
    for (const row of value.features) {
      if (!isPlainObject(row)) return false;
      if (typeof row.feature !== "string" || !FEATURE_NAME_PATTERN.test(row.feature)) return false;
      if (!isValidLabel(row.label) || !isValidScheme(row.scheme)) return false;
      if (!isValidReferences(row.references) || !isValidNote(row.note)) return false;
      if (row.lexicographic !== undefined && typeof row.lexicographic !== "boolean") return false;
    }
  }

  // An abbreviation is the one row with no tag to check, so all three of its
  // strings are required — a row missing any of them says nothing at all, where
  // every other shape failure here would be losing information the record does
  // carry. `value` is checked against its own pattern for the reason a feature
  // name is checked against UD's: it is an identifier, and a malformed one
  // becomes an unreachable row rather than a visible mistake.
  if (value.abbreviations !== undefined) {
    if (
      !Array.isArray(value.abbreviations) ||
      value.abbreviations.length > GRAMMAR_LIMITS.abbreviations
    ) {
      return false;
    }
    for (const row of value.abbreviations) {
      if (!isPlainObject(row)) return false;
      if (typeof row.value !== "string" || !ABBREVIATION_VALUE_PATTERN.test(row.value)) {
        return false;
      }
      if (typeof row.short !== "string" || row.short.trim() === "") return false;
      if (typeof row.long !== "string" || row.long.trim() === "") return false;
      if (!isValidReferences(row.references) || !isValidNote(row.note)) return false;
    }
  }

  if (value.values !== undefined) {
    if (!Array.isArray(value.values) || value.values.length > GRAMMAR_LIMITS.values) return false;
    for (const row of value.values) {
      if (!isPlainObject(row)) return false;
      if (!isValidTagFeat({ feature: row.feature, value: row.value, scheme: row.scheme })) {
        return false;
      }
      if (!isValidLabel(row.label) || !isValidScheme(row.scheme)) return false;
      if (!isValidReferences(row.references) || !isValidNote(row.note)) return false;
    }
  }

  if (value.inherent !== undefined) {
    if (!Array.isArray(value.inherent) || value.inherent.length > GRAMMAR_LIMITS.inherent) {
      return false;
    }
    for (const row of value.inherent) {
      if (!isPlainObject(row)) return false;
      if (!isValidTag(row.category)) return false;
      if (typeof row.feature !== "string" || !FEATURE_NAME_PATTERN.test(row.feature)) return false;
    }
  }

  // Layer 2's categories: a bundle, its label, and prose about it. Since
  // ADR-0020 that is the whole shape — the `axis` and the `annotations` array
  // are gone, and with them every undecidable state they could be in.
  //
  // A row carrying the ADR-0019 shape therefore fails here, which is the
  // deliberate half of the change: it declares an axis this lexicon no longer
  // defines, so indexing it would silently drop what its author said about the
  // headword flavours. An *editor* loading one has the opposite answer — see
  // `migrateGrammar`, which maps it forward so publishing converts it.
  if (value.categories !== undefined) {
    if (!Array.isArray(value.categories) || value.categories.length > GRAMMAR_LIMITS.categories) {
      return false;
    }
    for (const row of value.categories) {
      if (!isPlainObject(row)) return false;
      if (!isValidTag(row.category)) return false;
      if (!isValidLabel(row.label) || !isValidNote(row.note)) return false;
    }
  }

  // The two arrays ADR-0019 retired, refused outright rather than ignored. An
  // unknown field is ordinarily ignored (AT Proto extensibility) and a renamed
  // one is too, but these two are declarations whose *meaning* moved: an axis
  // now belongs to its category and a layout to the paradigm record. A record
  // still carrying them is asserting something this lexicon no longer defines,
  // and indexing it would silently drop half of what its author declared.
  //
  // An *editor* loading such a record has the opposite problem and the opposite
  // answer — see `migrateGrammar`.
  for (const key of RETIRED_GRAMMAR_KEYS) {
    if (value[key] !== undefined) return false;
  }
  return true;
}

/**
 * A `grammar` object as some record on a PDS actually holds it: any shape at
 * all, and in practice often one of the two this lexicon has already left
 * behind. Only the fields the forward map reads are named.
 */
interface StoredGrammar {
  /** Layer 2's combinations, renamed `categories` by ADR-0019. */
  bindings?: unknown;
  categories?: unknown;
  abbreviations?: unknown;
  inherent?: unknown;
  values?: unknown;
  [key: string]: unknown;
}

/** A legacy category row: ADR-0019's axis and its per-flavour annotations. */
interface LegacyCategory {
  category?: unknown;
  axis?: unknown;
  annotations?: { long?: unknown; short?: unknown; default?: unknown }[];
}

/**
 * The `values` row a bare (feature, value) pair names, from an unvalidated
 * array — the migration's own `resolveCoord`, which cannot use that one because
 * what it is holding is not a `Grammar` yet.
 */
function storedValueScheme(values: unknown, feature: string, value: string): string | undefined {
  if (!Array.isArray(values)) return undefined;
  const wanted = valueMatchKey(feature, value);
  for (const row of values) {
    if (!isPlainObject(row)) continue;
    if (typeof row.feature !== "string" || typeof row.value !== "string") continue;
    if (row.feature !== feature) continue;
    if (valueMatchKey(row.feature, row.value) !== wanted) continue;
    return typeof row.scheme === "string" ? row.scheme : undefined;
  }
  return undefined;
}

/** An identifier from a printed abbreviation: ASCII letters and digits, or none. */
function abbreviationSlug(short: string): string {
  return short
    .normalize("NFD")
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 64);
}

/**
 * The `grammar` keys ADR-0019 retired: the standalone axis declarations, whose
 * feature and default values moved onto the category, and the layout blocks,
 * whose cells moved into the eu.leksis.paradigm record.
 */
export const RETIRED_GRAMMAR_KEYS = ["axes", "layout"] as const;

/**
 * The same object mapped forward onto the shape this lexicon defines now — what
 * an **editor** validates and edits, where the AppView validates the record as
 * it stands.
 *
 * The asymmetry is deliberate and it is the ADR-0015 rule read from both sides.
 * The index refuses a record declaring something this lexicon no longer defines,
 * because indexing it would silently drop half of what its author said. An
 * editor must do the reverse: refusing to *load* it would leave every language
 * declared before the change permanently unrepairable through the only
 * interface that could repair it — precisely the deadlock ADR-0015 exists to
 * prevent. So the record is mapped forward on the way in, and publishing is what
 * commits the conversion.
 *
 * Four maps, all of them lossless except where the source was already a defect:
 *
 * - **`axes` and `layout` are dropped** (ADR-0019). They declare things no
 *   lexicon defines any more; a layout's cells belong to a paradigm record.
 * - **`bindings` becomes a category** (ADR-0019), one row per binding, its label
 *   carried across unchanged.
 * - **A category's `annotations` become categories** (ADR-0020). Each annotation
 *   is a headword flavour, so each becomes a category of its own: the row's
 *   bundle plus the axis value that annotation named, carrying that
 *   annotation's label. The axis's provenance is re-attached from the `values`
 *   row that bound it, exactly as `coordTag` re-qualifies a coordinate — without
 *   which a minted `Number=Sgv` flavour would key differently from what the
 *   entry editor writes. And the axis itself becomes an **inherence
 *   declaration** on the parent, which is what keeps the new categories grounded
 *   and what keeps `headwordKeys` returning the same bundle it did before.
 * - **An abbreviation gains an identity** (ADR-0020), slugged from the form it
 *   was keyed on. Two rows slugging alike are numbered apart rather than
 *   collapsed: they were two rows and they stay two.
 *
 * Everything it does not recognise is passed through untouched, so a genuinely
 * malformed grammar is still malformed afterwards and `isValidGrammar` still
 * refuses it. This maps shapes forward; it does not clean records up.
 */
export function migrateGrammar(grammar: unknown): unknown {
  if (!isPlainObject(grammar)) return grammar;
  const stored = grammar as StoredGrammar;
  const out: StoredGrammar = { ...stored };
  for (const key of RETIRED_GRAMMAR_KEYS) delete out[key];

  const categories: unknown[] = [];
  const inherent: unknown[] = Array.isArray(stored.inherent) ? [...stored.inherent] : [];
  const inherentKeys = new Set(
    inherent
      .filter(isPlainObject)
      .filter((row) => isValidTag(row.category) && typeof row.feature === "string")
      .map((row) => inherentKey({ category: row.category as Tag, feature: row.feature as string })),
  );
  const declare = (category: Tag, feature: string): void => {
    const key = inherentKey({ category, feature });
    if (inherentKeys.has(key)) return;
    inherentKeys.add(key);
    inherent.push({ category, feature });
  };

  // A binding is a category with the same label, so it maps straight across.
  if (Array.isArray(stored.bindings)) {
    for (const row of stored.bindings) {
      if (!isPlainObject(row) || !isValidTag(row.tag) || !isValidLabel(row.label)) continue;
      categories.push({ category: row.tag, label: row.label });
    }
  }

  if (Array.isArray(stored.categories)) {
    for (const row of stored.categories) {
      if (!isPlainObject(row)) continue;
      const legacy = row as LegacyCategory;
      if (legacy.annotations === undefined || row.label !== undefined) {
        categories.push(row);
        continue;
      }
      if (!isValidTag(legacy.category) || !Array.isArray(legacy.annotations)) {
        categories.push(row);
        continue;
      }
      const category = legacy.category;
      const axis = typeof legacy.axis === "string" ? legacy.axis : undefined;
      for (const annotation of legacy.annotations) {
        if (!isPlainObject(annotation) || typeof annotation.long !== "string") continue;
        const label: GrammarLabel = {
          long: annotation.long,
          ...(typeof annotation.short === "string" ? { short: annotation.short } : {}),
        };
        const value = typeof annotation.default === "string" ? annotation.default : undefined;
        if (axis === undefined || value === undefined) {
          categories.push({ category, label });
          continue;
        }
        const scheme = storedValueScheme(stored.values, axis, value);
        categories.push({
          category: {
            ...(category.upos !== undefined ? { upos: category.upos } : {}),
            feats: [
              ...(category.feats ?? []),
              { feature: axis, value, ...(scheme !== undefined ? { scheme } : {}) },
            ],
          },
          label,
        });
        // What told the flavours apart is now what identifies them, so the
        // declaration that used to read "these forms vary over Number" is
        // rewritten as "Number is part of what this headword is".
        declare(category, axis);
      }
    }
  }

  // Two rows for one category would be a `duplicate` the editor cannot repair
  // one half of, since a category is addressed by its bundle: the first wins.
  // The only way to reach this is a record that was already reported duplicate.
  const seen = new Set<string>();
  const deduped = categories.filter((row) => {
    if (!isPlainObject(row) || !isValidTag(row.category)) return true;
    const key = tagKey(row.category);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (deduped.length > 0 || stored.categories !== undefined) out.categories = deduped;
  if (inherent.length > 0) out.inherent = inherent;
  delete out.bindings;

  if (Array.isArray(stored.abbreviations)) {
    // Seeded with the identities the record already carries, not only with the
    // ones this pass mints: a half-converted record (one row hand-written as
    // `udb`, one still legacy printing "udb.") would otherwise slug the second
    // onto the first and produce a `duplicate-abbreviation` nobody could see,
    // since only one of the two rows is reachable by its identity.
    const taken = new Set<string>(
      stored.abbreviations
        .filter(isPlainObject)
        .map((row) => row.value)
        .filter((value): value is string => typeof value === "string"),
    );
    out.abbreviations = stored.abbreviations.map((row, index) => {
      if (!isPlainObject(row) || typeof row.value === "string") return row;
      const short = typeof row.short === "string" ? row.short : "";
      const slug = abbreviationSlug(short);
      let value = slug === "" ? `abbr${index + 1}` : slug;
      for (let n = 2; taken.has(value); n++) value = `${slug === "" ? "abbr" : slug}${n}`;
      taken.add(value);
      return { ...row, value };
    });
  }

  return out;
}
