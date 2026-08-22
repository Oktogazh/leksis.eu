// The three quarantined fixture languages (`leksis-testset` §1).
//
// `qtl` is the full one — everything the design says should work, declared
// across layers 1 and 2 in the shape ADR-0020 settled: one category per
// headword flavour, each with one abbreviation, the features that identify a
// flavour declared inherent at the depth they belong to, and the shape of the
// inflection tables living in the paradigm records rather than here. `qtm` is bare: no `grammar` at all, which is the degrade path every
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
const sing = { feature: "Number", value: "Sing" };
const plur = { feature: "Number", value: "Plur" };
// The minted singulative carries its provenance wherever it is matched as an
// atom — a category's own bundle included (L-18).
const sgv = { feature: "Number", value: "Sgv", scheme: "qtl" };
const person1 = { feature: "Person", value: "1" };

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
    // L-17 — the citation number, declared one level below the gender. This is
    // what ADR-0020 replaced the axis with: an ordinary masculine noun is cited
    // in the singular and an *anv-kadarn stroll* in the plural, so the number is
    // part of what those two headwords ARE — and it is also what their forms
    // vary over, which the paradigm's tables say and no declaration here does.
    { category: { upos: NOUN, feats: [masc] }, feature: "Number" },
    { category: { upos: NOUN, feats: [fem] }, feature: "Number" },
    // One level deeper again, so a noun of a declared class can be cited too:
    // grounding walks one atom at a time, so each rung needs its own row.
    { category: { upos: NOUN, feats: [fem, decl1] }, feature: "Number" },
    { category: { upos: NOUN, feats: [fem, decl2] }, feature: "Number" },
    // What a verb lexeme *is*, which is what lets a paradigm select on it: the
    // finite and non-finite halves of this language's verbs take different
    // paradigms, so `{VERB, VerbForm=Fin}` has to be part of the headword
    // bundle rather than of a form's address.
    { category: { upos: VERB }, feature: "VerbForm" },
    // A finite verb is cited in the first person singular, as a Latin one is.
    { category: { upos: VERB, feats: [finite] }, feature: "Person" },
    { category: { upos: ADJ }, feature: "Gender" },
  ],

  categories: [
    // L-16 — the ordinary case: a part of speech plus the one value its
    // headwords are cited at, named once.
    {
      category: { upos: ADJ, feats: [masc] },
      label: { long: "anv-gwan gourel", short: "ag.g." },
    },
    // L-17 — the case the merge was for, and the case ADR-0020 declares as two
    // categories rather than one category with two abbreviations: an ordinary
    // masculine noun cited in the singular, and an *anv-kadarn stroll* cited in
    // the PLURAL with its singulative derived by rule. Two flavours, two rows,
    // two abbreviations, and each is a bundle an entry carries verbatim.
    {
      category: { upos: NOUN, feats: [masc, sing] },
      label: { long: "anv-kadarn gourel", short: "ak.g." },
      note: "An anv-kadarn gourel boutin, meneget en unander.",
    },
    {
      category: { upos: NOUN, feats: [masc, plur] },
      label: { long: "anv-kadarn stroll", short: "ak.str." },
      note: "Meneget e liester: eus ar stroll e teu an unanenn, dre reol.",
    },
    {
      category: { upos: NOUN, feats: [fem, sing] },
      label: { long: "anv-kadarn gwregel", short: "ak.gw." },
    },
    // L-18 — a category whose own bundle carries a MINTED value. The atom is
    // matched with its provenance, so the row writes `scheme: "qtl"` exactly as
    // the entry editor does; a bare `Sgv` here would key differently and find no
    // label.
    {
      category: { upos: NOUN, feats: [fem, sgv] },
      label: { long: "anv-kadarn unanennel", short: "ak.un." },
    },
    // The two inflection classes, one level deeper again — the walk the entry
    // editor takes: anv-kadarn, gwregel, kentañ displegadur, unander.
    {
      category: { upos: NOUN, feats: [fem, decl1, sing] },
      label: { long: "anv-kadarn gwregel, kentañ displegadur", short: "ak.gw.1." },
    },
    {
      category: { upos: NOUN, feats: [fem, decl2, sing] },
      label: { long: "anv-kadarn gwregel, eil displegadur", short: "ak.gw.2." },
    },
    {
      category: { upos: VERB, feats: [finite, person1] },
      label: { long: "verb displeget", short: "v.disp." },
    },
    // L-13 — a category identified by a feature nothing is cited *at*: an
    // infinitive is one form and there is no second flavour to tell it from, so
    // its bundle is the part of speech plus the form that names it. An entry
    // carrying it renders as ONE chip by exact match.
    {
      category: { upos: VERB, feats: [infinitive] },
      label: { long: "anv-verb", short: "a.v." },
    },
  ],

  // L-21 — the identity and the printed form are two fields (ADR-0020): `udb`
  // keys the row, "udb." is what a reader sees, and the note says when to reach
  // for it, which the expansion alone does not.
  abbreviations: [
    {
      value: "udb",
      short: "udb.",
      long: "un dra bennak",
      note: "Implijet evit an traoù, n'eo ket evit an dud.",
    },
    { value: "ub", short: "u.b.", long: "unan bennak" },
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
  inherent: [
    { category: { upos: NOUN }, feature: "Gender" },
    { category: { upos: NOUN, feats: [fem] }, feature: "Number" },
  ],
  categories: [
    {
      category: { upos: NOUN, feats: [fem, sing] },
      label: { long: "izenn venel", short: "izb." },
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
 * The kind list has shrunk twice. ADR-0019 retired eight with the `axes` and
 * `layout` arrays and added six of its own; ADR-0020 removed those six with the
 * axis they were about, leaving **six kinds in total** — everything that can go
 * wrong with a bundle, and nothing about what its forms do.
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
    // L-32 `duplicate` — two rows for one category, which makes the label a
    // reader sees depend on array order. A bare part of speech is a category
    // the `pos` row above already names, so naming it here is the same defect
    // twice over.
    { category: { upos: NOUN }, label: { long: "izenn", short: "iz." } },
    { category: { upos: NOUN }, label: { long: "izenn all", short: "iza." } },
    // L-33 `ungrounded-combination` — no inherence chain reaches it: nothing
    // declares Number inherent to `{NOUN, Gender=Masc}`, nor Gender to
    // `{NOUN, Number=Plur}`.
    {
      category: { upos: NOUN, feats: [masc, plur] },
      label: { long: "izenn dadel lies", short: "iztl." },
    },
    // L-31 `unbound-atom`, on a category rather than on an inherence row: the
    // part of speech it is built on is one nobody bound.
    { category: { upos: ADJ, feats: [fem] }, label: { long: "hanel benel", short: "hb." } },
    // L-40 `lexicographic-in-grammar` inside a category's own bundle: "archaic"
    // is not something a word IS, so no category can be made of it.
    {
      category: { upos: NOUN, feats: [fem, { feature: "Style", value: "Arch", scheme: "qto" }] },
      label: { long: "izenn venel kozh", short: "izbk." },
    },
  ],
  // L-41 `duplicate-abbreviation` — two front-matter entries under one
  // identity, which is what a lookup travels through.
  abbreviations: [
    { value: "hz", short: "hz.", long: "hervez" },
    { value: "hz", short: "h.z.", long: "hep zaou" },
  ],
};

// ---------------------------------------------------------------------------

export const languageFixtures: LanguageFixture[] = [
  {
    role: "full",
    covers: [
      "L-01", "L-02", "L-03", "L-04", "L-05", "L-06", "L-07", "L-08", "L-09", "L-10",
      "L-11", "L-12", "L-13", "L-14", "L-16", "L-17", "L-18", "L-19", "L-21",
    ],
    expect:
      "Two pairs of rows are flagged as indistinguishable on GET /languages/qtl/labels: `t.` over `troad-rener` and `troad-reiñ` (two values of one feature), and `gou.` over `gour` and `gourel` (a feature NAME against a value — the case pair-keying used to collapse). `troad-gouzañv` sits at count 0, which is legitimate: the language named it before anyone used it. The Categories level of the grammar dialog lists nine categories, one abbreviation each: `{NOUN, Gender=Masc, Number=Sing}` and `{NOUN, Gender=Masc, Number=Plur}` are the anv-stroll case as two rows, and the sidebar walking into the second reads `ak. / Gender= / Masc / Number= / Plur`. The NOUN dashboard's Gender button counts SIX categories below it, where a count of its direct children would have said none — neither `{NOUN, Gender=Masc}` nor `{NOUN, Gender=Fem}` is itself named. The Paradigms level lists seven records.",
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
    covers: ["L-30", "L-31", "L-32", "L-33", "L-40", "L-41"],
    expect:
      "GET /languages/qto/currentRecord still points at the COHERENT version — the defective rewrite was refused whole, and never entered the record's history. Opening the grammar dialog on qto reads the defective content from the PDS: Publish is disabled and the footer lists all six defect kinds.",
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
