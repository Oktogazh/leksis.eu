// The three quarantined fixture languages (`leksis-testset` §1).
//
// `qtl` is the full one — everything the design says should work, declared
// across layers 1 and 2 in the **merged** shape ADR-0019 settled: a category
// carries its axis and the default value each of its headword flavours sits at,
// and the shape of the inflection tables lives in the paradigm records rather
// than here. `qtm` is bare: no `grammar` at all, which is the degrade path every
// viewer promises. `qto` is defective: published coherent, then rewritten with
// one row per `GrammarIssue` kind, so the rewrite is REFUSED and the coherent
// version stays current (ADR-0015).
//
// The tags come from ISO 639-3's `qaa`–`qtz` local-use range, and each endonym
// says what it is, in the fixture language's own "spelling", so nobody mistakes
// one of these for a real language in the live picker.

import type { Grammar, GrammarValue } from "@leksis/types";
import type { LanguageFixture } from "./types.ts";

/** A `values` row for a bare (feature, value) pair the fixtures reuse. */
function value(
  feature: string,
  val: string,
  long: string,
  short?: string,
  extra?: Partial<GrammarValue>,
): GrammarValue {
  return {
    feature,
    value: val,
    label: short === undefined ? { long } : { long, short },
    ...extra,
  };
}

const NOUN = { value: "NOUN" };
const VERB = { value: "VERB" };
const ADJ = { value: "ADJ" };
const fem = { feature: "Gender", value: "Fem" };
const masc = { feature: "Gender", value: "Masc" };
const decl1 = { feature: "Declension", value: "1", scheme: "qtl" };
const decl2 = { feature: "Declension", value: "2", scheme: "qtl" };
const finite = { feature: "VerbForm", value: "Fin" };
const infinitive = { feature: "VerbForm", value: "Inf" };

// ---------------------------------------------------------------------------
// qtl — the full language
// ---------------------------------------------------------------------------

const qtlGrammar: Grammar = {
  // L-01 (two bound UD parts of speech), L-05 (a minted one), L-07/L-08 (a
  // label with both halves, and one with `long` alone).
  pos: [
    { value: "NOUN", label: { long: "anv-kadarn", short: "ak." } },
    { value: "VERB", label: { long: "verb" } },
    { value: "ADJ", label: { long: "anv-gwan", short: "ag." } },
    {
      value: "PREVERB",
      scheme: "qtl",
      label: { long: "rakverb", short: "rv." },
      references: [
        {
          text: "Leksis fixture L-05 — a part of speech minted by qtl. UD has no PREVERB, and its POS page states no extension policy either way.",
          url: "https://universaldependencies.org/u/pos/",
        },
      ],
    },
  ],

  features: [
    { feature: "Gender", label: { long: "reizh", short: "rzh." } },
    { feature: "Number", label: { long: "niver", short: "niv." } },
    { feature: "Case", label: { long: "troad", short: "tro." } },
    { feature: "Person", label: { long: "gour", short: "gou." } },
    { feature: "Tense", label: { long: "amzer", short: "amz." } },
    { feature: "Mood", label: { long: "doare", short: "doa." } },
    { feature: "VerbForm", label: { long: "stumm-verb", short: "s.v." } },
    // L-06 — a layered feature name, bound with values of its own.
    { feature: "Number[psor]", label: { long: "niver ar perc'henn", short: "niv.p." } },
    // L-04 — a minted feature name: this language's inflection classes.
    {
      feature: "Declension",
      scheme: "qtl",
      label: { long: "displegadur", short: "dis." },
      references: [{ text: "Leksis fixture L-04 — an inflection-class feature minted by qtl." }],
      note: "Daou zisplegadur a zo en yezh-mañ. An eil a c'houlenn ur penn-stumm: an troad-perc'hennañ unander.",
    },
    // A lexicographic label set (ADR-0010): its values are ordinary tags an
    // entry may carry, and the grammatical layers must never offer them.
    {
      feature: "Register",
      scheme: "qtl",
      lexicographic: true,
      label: { long: "live-yezh", short: "liv." },
      references: [
        { text: "Leksis fixture — a lexicographic label set, excluded from the grammatical layers." },
      ],
    },
  ],

  values: [
    value("Gender", "Fem", "gwregel", "gw."),
    value("Gender", "Masc", "gourel", "gou."),
    // L-19 — the multivalue value a syncretic cell is addressed by: one form
    // spanning both genders, never two cells that happen to agree.
    value("Gender", "Fem,Masc", "gwregel ha gourel", "gw./gou."),

    // L-02 — a bound UD feature name with more than one of its values.
    value("Number", "Sing", "unander", "un."),
    value("Number", "Plur", "liester", "lie."),
    // UD documents `Coll` (a subtype of singular). Bound here so that a bundle
    // carrying it decomposes into three named chips — the category's own
    // annotations never name it, which is L-14 and E-34.
    value("Number", "Coll", "strollad", "str."),
    // L-03 — a value minted on a UD feature, carrying its reference. It is also
    // the default of a headword flavour (L-18), which is what makes the
    // re-qualification step visible: the entry editor writes the scheme, the
    // category stores the value bare.
    value("Number", "Sgv", "unanennel", "una.", {
      scheme: "qtl",
      references: [
        {
          text: "Leksis fixture L-03 — a singulative minted by qtl on UD's Number, which has no such value.",
          url: "https://universaldependencies.org/u/feat/Number.html",
        },
      ],
      note: "Ar stumm unanennel a zeu eus ur strollad: `bezhin` → `bezhinenn`. N'eo ket al liester.",
    }),

    // L-09 — `Nom` and `Dat` deliberately share the short form `t.` under two
    // different long forms, so `conflictsWith` is populated on both.
    value("Case", "Nom", "troad-rener", "t."),
    value("Case", "Gen", "troad-perc'hennañ", "tp."),
    value("Case", "Dat", "troad-reiñ", "t."),
    // L-10 — bound, named, and used by no entry anywhere in the set.
    value("Case", "Acc", "troad-gouzañv", "tg."),

    value("Person", "1", "kentañ gour", "1añ"),
    value("Person", "2", "eil gour", "2l"),
    value("Person", "3", "trede gour", "3de"),
    // The syncretic slot lxp-03's spanning cell is addressed by, named so the
    // merged cell has a heading of its own.
    value("Person", "1,2", "kentañ hag eil gour", "1añ/2l"),

    value("Tense", "Pres", "amzer-vremañ", "brem."),
    value("Tense", "Past", "amzer-dremenet", "trem."),
    value("Mood", "Ind", "doare-diskleriañ", "disk."),
    value("VerbForm", "Fin", "stumm displeget", "disp."),
    value("VerbForm", "Inf", "stumm anv-verb", "s.a.v."),

    value("Number[psor]", "Sing", "ur perc'henn", "p.un."),
    value("Number[psor]", "Plur", "meur a berc'henn", "p.lie."),
    value("Number[psor]", "Sing,Plur", "forzh pet perc'henn", "p.forzh"),

    // L-04 — a value may begin with a digit, so an inflection class needs no
    // workaround to be written the way a grammar writes it.
    value("Declension", "1", "kentañ displegadur", "1añ dis.", { scheme: "qtl" }),
    value("Declension", "2", "eil displegadur", "2l dis.", { scheme: "qtl" }),

    value("Register", "Arch", "kozh", "kozh.", { scheme: "qtl" }),
    value("Register", "Fam", "boutin", "bout.", { scheme: "qtl" }),
  ],

  inherent: [
    // L-11 — inherence on a bare part of speech.
    { category: { upos: NOUN }, feature: "Gender" },
    // L-12 — inherence on a combination, which is what sets the depth of the
    // entry editor's narrowing: the class is offered only after the gender.
    { category: { upos: NOUN, feats: [fem] }, feature: "Declension" },
    // What a verb lexeme *is*, which is what lets a paradigm select on it: the
    // finite and non-finite halves of this language's verbs take different
    // paradigms, so `{VERB, VerbForm=Fin}` has to be part of the headword
    // bundle rather than of a form's address.
    { category: { upos: VERB }, feature: "VerbForm" },
  ],

  categories: [
    // L-15 — a category of ONE atom, which ADR-0019 made legal: a bare part of
    // speech is a headword category like any other, and it has to be, because a
    // category is now also where an axis is declared.
    // L-16 — an axis with exactly ONE annotation: the ordinary case, where the
    // default rides into every entry created through it.
    {
      category: { upos: ADJ },
      axis: "Gender",
      annotations: [{ long: "anv-gwan gourel", short: "ag.g.", default: "Masc" }],
    },
    // L-17 — the merge's motivating case, and the thing two separate
    // declarations could not express: ONE category whose headwords sit at two
    // different values of its own axis, each with its own abbreviation. An
    // ordinary masculine noun is cited in the singular; an *anv-kadarn stroll*
    // is cited in the PLURAL, its singulative derived by rule.
    {
      category: { upos: NOUN, feats: [masc] },
      axis: "Number",
      annotations: [
        { long: "anv-kadarn gourel", short: "ak.g.", default: "Sing" },
        { long: "anv-kadarn stroll", short: "ak.str.", default: "Plur" },
      ],
    },
    // L-18 — a default that is a MINTED value. The category stores `Sgv` bare;
    // `categoryTags` re-attaches `scheme: "qtl"` from the `values` row that
    // bound it, which is the only reason the chip finds its label and the
    // selector finds the entry.
    {
      category: { upos: NOUN, feats: [fem] },
      axis: "Number",
      annotations: [
        { long: "anv-kadarn gwregel", short: "ak.gw.", default: "Sing" },
        { long: "anv-kadarn unanennel", short: "ak.un.", default: "Sgv" },
      ],
    },
    // The two inflection classes, declared on the refined category the
    // inherence row above made reachable. Each is a paradigm's selector.
    {
      category: { upos: NOUN, feats: [fem, decl1] },
      axis: "Number",
      annotations: [{ long: "anv-kadarn gwregel, kentañ displegadur", short: "ak.gw.1.", default: "Sing" }],
    },
    {
      category: { upos: NOUN, feats: [fem, decl2] },
      axis: "Number",
      annotations: [{ long: "anv-kadarn gwregel, eil displegadur", short: "ak.gw.2.", default: "Sing" }],
    },
    // A finite verb is cited in the first person singular, as a Latin one is.
    {
      category: { upos: VERB, feats: [finite] },
      axis: "Person",
      annotations: [{ long: "verb displeget", short: "v.disp.", default: "1" }],
    },
    // L-13 — a category of two atoms with NO axis at all: an infinitive does
    // not vary over anything, so it names no axis and takes exactly one
    // annotation. An entry carrying this bundle renders as ONE chip by exact
    // match.
    {
      category: { upos: VERB, feats: [infinitive] },
      annotations: [{ long: "anv-verb", short: "a.v." }],
    },
  ],

  abbreviations: [
    { short: "udb.", long: "un dra bennak" },
    { short: "u.b.", long: "unan bennak" },
  ],
};

// ---------------------------------------------------------------------------
// qto — the defective rewrite
// ---------------------------------------------------------------------------

/** The coherent grammar `qto` is published with first, and keeps. */
const qtoCoherent: Grammar = {
  pos: [
    { value: "NOUN", label: { long: "izenn", short: "iz." } },
    { value: "VERB", label: { long: "gwered", short: "gw." } },
  ],
  features: [
    { feature: "Gender", label: { long: "reizhad", short: "rz." } },
    { feature: "Number", label: { long: "niveradur", short: "nv." } },
  ],
  values: [
    value("Gender", "Fem", "benel", "b."),
    value("Gender", "Masc", "tadel", "t."),
    value("Number", "Sing", "unan", "u."),
    value("Number", "Plur", "lies", "l."),
  ],
  inherent: [{ category: { upos: NOUN }, feature: "Gender" }],
  categories: [
    {
      category: { upos: NOUN, feats: [fem] },
      axis: "Number",
      annotations: [{ long: "izenn venel", short: "izb.", default: "Sing" }],
    },
  ],
};

/**
 * The rewrite, carrying one row per `GrammarIssue` kind. Since ADR-0015 this
 * record is refused **whole**, which is what these rows assert: the coherent
 * version above stays current and `qto` stays browsable, while the browser —
 * which reads `getRecord` by rkey, and a language record's rkey is its tag —
 * reads this content, so the binding editor must list every defect and block
 * Publish.
 *
 * ADR-0019 retired eight kinds with the `axes` and `layout` arrays and added
 * six of its own, so this record is a different shape from the one that stood
 * before it: the defects now live on `categories` rather than on three arrays.
 */
const qtoDefective: Grammar = {
  pos: [
    { value: "NOUN", label: { long: "izenn", short: "iz." } },
    { value: "VERB", label: { long: "gwered", short: "gw." } },
    // ADJ is deliberately NOT bound, and neither are the feature names `Aspect`
    // and `Tense`, nor the value `Number=Dual`. Each absence is one defect
    // below.
  ],
  features: [
    { feature: "Gender", label: { long: "reizhad", short: "rz." } },
    { feature: "Number", label: { long: "niveradur", short: "nv." } },
    // L-40 — a lexicographic label set, which the grammatical layers must never
    // reach for. The `inherent` row naming it below is the defect.
    {
      feature: "Style",
      scheme: "qto",
      lexicographic: true,
      label: { long: "doareoù", short: "do." },
    },
  ],
  values: [
    value("Gender", "Fem", "benel", "b."),
    value("Gender", "Masc", "tadel", "t."),
    value("Number", "Sing", "unan", "u."),
    value("Number", "Plur", "lies", "l."),
    // L-30 `unbound-feature` — a value whose feature name nothing binds.
    value("Aspect", "Perf", "peurc'hraet", "pc."),
    value("Style", "Arch", "kozh", "kz.", { scheme: "qto" }),
  ],
  inherent: [
    { category: { upos: NOUN }, feature: "Gender" },
    // L-31 `unbound-atom` — a layer-2 row built on a part of speech nobody bound.
    { category: { upos: ADJ }, feature: "Gender" },
    // L-40 `lexicographic-in-grammar` — "archaic" is not something a word is.
    { category: { upos: VERB }, feature: "Style" },
  ],
  categories: [
    // L-35 `category-axis-inherent` — the same (category, feature) declared
    // both ways: a paradigm cannot be built from a coordinate that is also a
    // constant. Its default is bound, so this row carries that defect alone.
    {
      category: { upos: NOUN },
      axis: "Gender",
      annotations: [{ long: "izenn", short: "iz.", default: "Fem" }],
    },
    // L-32 `duplicate` — a second row for the same category, which would make
    // its axis, and with it the whole cell space, depend on array order.
    {
      category: { upos: NOUN },
      axis: "Number",
      annotations: [{ long: "izenn all", short: "iza.", default: "Sing" }],
    },
    // L-34 `category-axis-unbound` — the axis names a feature this language
    // never declared it uses, so nothing downstream can offer its values.
    {
      category: { upos: VERB },
      axis: "Tense",
      annotations: [{ long: "gwered", short: "gwd.", default: "Pres" }],
    },
    // L-33 `ungrounded-combination` — no inherence chain reaches it: nothing
    // declares Number inherent to `{NOUN, Gender=Masc}`, nor Gender to
    // `{NOUN, Number=Plur}`.
    {
      category: {
        upos: NOUN,
        feats: [masc, { feature: "Number", value: "Plur" }],
      },
      annotations: [{ long: "izenn dadel lies", short: "iztl." }],
    },
    // L-37 `category-default-forbidden` — no axis, so there is no feature for
    // the default to be a value of.
    {
      category: { upos: NOUN, feats: [masc] },
      annotations: [{ long: "izenn dadel", short: "izt.", default: "Sing" }],
    },
    // Three defects of the annotation list itself, on one grounded category.
    {
      category: { upos: NOUN, feats: [fem] },
      axis: "Number",
      annotations: [
        { long: "izenn venel", short: "izb.", default: "Sing" },
        // L-39 `category-duplicate-default` — two annotations a reader cannot
        // tell apart, because the default is the only thing distinguishing them.
        { long: "izenn venel all", short: "izba.", default: "Sing" },
        // L-38 `category-default-unbound` — `Number=Dual` is not a value this
        // language bound, so no headword can sit at it.
        { long: "izenn venel daou", short: "izbd.", default: "Dual" },
        // L-36 `category-default-missing` — an axis is declared and this
        // annotation says nothing about where its headwords sit.
        { long: "izenn venel hep", short: "izbh." },
      ],
    },
  ],
  // L-41 `duplicate-abbreviation` — two front-matter entries under one
  // headword, keyed on the short form because that IS the identity.
  abbreviations: [
    { short: "hz.", long: "hervez" },
    { short: "hz.", long: "hep zaou" },
  ],
};

// ---------------------------------------------------------------------------

export const languageFixtures: LanguageFixture[] = [
  {
    role: "full",
    covers: [
      "L-01", "L-02", "L-03", "L-04", "L-05", "L-06", "L-07", "L-08", "L-09", "L-10",
      "L-11", "L-12", "L-13", "L-14", "L-15", "L-16", "L-17", "L-18", "L-19",
    ],
    expect:
      "Two pairs of rows are flagged as indistinguishable on GET /languages/qtl/labels: `t.` over `troad-rener` and `troad-reiñ` (two values of one feature), and `gou.` over `gour` and `gourel` (a feature NAME against a value — the case pair-keying used to collapse). `troad-gouzañv` sits at count 0, which is legitimate: the language named it before anyone used it. The Categories level of the grammar dialog lists seven categories, of which `{NOUN, Gender=Masc}` and `{NOUN, Gender=Fem}` each carry TWO abbreviations under one declaration — the anv-stroll case — and `{VERB, VerbForm=Inf}` carries no axis at all. The Paradigms level lists seven records.",
    record: {
      tag: "qtl",
      translations: [
        { languageID: "qtl", translation: "Leksis tesk (klok)" },
        { languageID: "en", translation: "leksis test (full)" },
      ],
      grammar: qtlGrammar,
    },
  },
  {
    role: "bare",
    covers: ["L-20"],
    expect:
      "No grammar at all: the dashboard offers to declare one, and every tag its entries carry renders verbatim and unbound.",
    record: {
      tag: "qtm",
      translations: [
        { languageID: "qtm", translation: "Leksis tesk (noaz)" },
        { languageID: "en", translation: "leksis test (bare)" },
      ],
    },
  },
  {
    role: "defective",
    covers: ["L-30", "L-31", "L-32", "L-33", "L-34", "L-35", "L-36", "L-37", "L-38", "L-39", "L-40", "L-41"],
    expect:
      "GET /languages/qto/currentRecord still points at the COHERENT version — the defective rewrite was refused whole, and never entered the record's history. Opening the grammar dialog on qto reads the defective content from the PDS: Publish is disabled and the footer lists all twelve defect kinds.",
    record: {
      tag: "qto",
      translations: [
        { languageID: "qto", translation: "Leksis tesk (terret)" },
        { languageID: "en", translation: "leksis test (broken grammar)" },
      ],
      grammar: qtoCoherent,
    },
    rewrite: {
      tag: "qto",
      translations: [
        { languageID: "qto", translation: "Leksis tesk (terret)" },
        { languageID: "en", translation: "leksis test (broken grammar)" },
      ],
      grammar: qtoDefective,
    },
  },
];
