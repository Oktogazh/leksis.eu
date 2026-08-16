// The three quarantined fixture languages (`leksis-testset` §1).
//
// `qtl` is the full one — everything the design says should work, declared
// across layers 1–4 so that layer 5's paradigms have a cell space to fill.
// `qtm` is bare: no `grammar` at all, which is the degrade path every viewer
// promises. `qto` is defective: published coherent, then rewritten with one row
// per `GrammarIssue` kind, so the rewrite is REFUSED and the coherent version
// stays current (ADR-0015).
//
// The tags come from ISO 639-3's `qaa`–`qtz` local-use range, and each endonym
// says what it is, in the fixture language's own "spelling", so nobody mistakes
// one of these for a real language in the live picker.

import type { Grammar, GrammarAxis, GrammarValue, LayoutBlock } from "@leksis/types";
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
    },
    // A lexicographic label set (ADR-0010): its values are ordinary tags an
    // entry may carry, and the grammatical layers must never offer them.
    {
      feature: "Register",
      scheme: "qtl",
      lexicographic: true,
      label: { long: "live-yezh", short: "liv." },
      references: [
        { text: "Leksis fixture — a lexicographic label set, excluded from layers 2–4." },
      ],
    },
  ],

  values: [
    value("Gender", "Fem", "gwregel", "gw."),
    value("Gender", "Masc", "gourel", "gou."),
    // L-17 — the multivalue option an axis offers for a form spanning it.
    value("Gender", "Fem,Masc", "gwregel ha gourel", "gw./gou."),

    // L-02 — a bound UD feature name with more than one of its values.
    value("Number", "Sing", "unander", "un."),
    value("Number", "Plur", "liester", "lie."),
    // L-03 — a value minted on a UD feature, carrying its reference.
    value("Number", "Sgv", "unanennel", "una.", {
      scheme: "qtl",
      references: [
        {
          text: "Leksis fixture L-03 — a singulative minted by qtl on UD's Number, which has no such value.",
          url: "https://universaldependencies.org/u/feat/Number.html",
        },
      ],
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
    // The syncretic slot P-03's spanning rule targets, named so the merged cell
    // has a heading of its own.
    value("Person", "1,2", "kentañ hag eil gour", "1añ/2l"),

    value("Tense", "Pres", "amzer-vremañ", "brem."),
    value("Tense", "Past", "amzer-dremenet", "trem."),
    value("Mood", "Ind", "doare-diskleriañ", "disk."),
    value("VerbForm", "Fin", "stumm displeget", "disp."),
    value("VerbForm", "Inf", "anv-verb", "a.v."),

    value("Number[psor]", "Sing", "ur perc'henn", "p.un."),
    value("Number[psor]", "Plur", "meur a berc'henn", "p.lie."),

    // L-04 — a value may begin with a digit, so an inflection class needs no
    // workaround to be written the way a grammar writes it.
    value("Declension", "1", "kentañ displegadur", "1añ dis.", { scheme: "qtl" }),
    value("Declension", "2", "eil displegadur", "2l dis.", { scheme: "qtl" }),

    value("Register", "Arch", "kozh", "kozh.", { scheme: "qtl" }),
    value("Register", "Fam", "boutin", "bout.", { scheme: "qtl" }),
  ],

  inherent: [
    // L-11 — inherence on a bare part of speech.
    { category: { upos: { value: "NOUN" } }, feature: "Gender" },
    // L-12 — inherence on a combination, which is what sets the depth of the
    // entry editor's narrowing: the class is offered only after the gender.
    {
      category: { upos: { value: "NOUN" }, feats: [{ feature: "Gender", value: "Fem" }] },
      feature: "Declension",
    },
    // What a verb lexeme *is*, which is what lets a paradigm select on it: the
    // finite and non-finite halves of this language's verbs take different
    // paradigms, so `{VERB, VerbForm=Fin}` has to be part of the inherent
    // bundle rather than of a form's address.
    { category: { upos: { value: "VERB" } }, feature: "VerbForm" },
    // What grounds the named pinned combination L-53 uses.
    { category: { feats: [{ feature: "Mood", value: "Ind" }] }, feature: "Tense" },
  ],

  bindings: [
    // L-13 — a named combination: one chip, by exact match.
    {
      tag: { upos: { value: "NOUN" }, feats: [{ feature: "Gender", value: "Fem" }] },
      label: { long: "anv-kadarn gwregel", short: "akg." },
    },
    // L-14 — `{NOUN, Gender=Masc}` is deliberately NOT named. Its atoms are
    // bound separately, so it renders as two chips by decomposition.
    // L-53 — the pair block 0 of the verb layout pins, named so the block's
    // caption is one chip rather than two decomposed ones.
    {
      tag: {
        feats: [
          { feature: "Mood", value: "Ind" },
          { feature: "Tense", value: "Pres" },
        ],
      },
      label: { long: "amzer-vremañ an doare-diskleriañ", short: "brem.disk." },
    },
  ],

  axes: [
    // L-15 — declared in the language's own order, not alphabetically: no
    // grammar prints the accusative first, and `Dat, Gen, Nom` is what sorting
    // would have produced.
    { category: { upos: { value: "NOUN" } }, feature: "Case", values: ["Nom", "Gen", "Dat"] },
    { category: { upos: { value: "NOUN" } }, feature: "Number", values: ["Sing", "Plur", "Sgv"] },
    {
      category: { upos: { value: "NOUN" } },
      feature: "Number[psor]",
      values: ["Sing", "Plur"],
    },
    // L-16 — declared for the finite verb and never for the infinitive, which
    // is how a paradigm stops being rectangular.
    {
      category: { upos: { value: "VERB" }, feats: [{ feature: "VerbForm", value: "Fin" }] },
      feature: "Person",
      values: ["1", "2", "3"],
    },
    {
      category: { upos: { value: "VERB" }, feats: [{ feature: "VerbForm", value: "Fin" }] },
      feature: "Number",
      values: ["Sing", "Plur"],
    },
    // L-17 + L-59 — an axis whose option list includes a multivalue, on a
    // category that declares NO layout: the flat-list fallback, verified by
    // absence.
    {
      category: { upos: { value: "ADJ" } },
      feature: "Gender",
      values: ["Fem", "Masc", "Fem,Masc"],
    },
  ],

  layout: [
    {
      category: { upos: { value: "NOUN" } },
      blocks: [
        // L-56 — the "rosa, rosae" case: printed beside the headword, with the
        // full tables behind the expander.
        {
          kind: "list",
          summary: true,
          items: [
            {
              coords: [
                { feature: "Case", value: "Nom" },
                { feature: "Number", value: "Sing" },
              ],
            },
            {
              coords: [
                { feature: "Case", value: "Gen" },
                { feature: "Number", value: "Sing" },
              ],
            },
          ],
        },
        // L-50 — one axis down, one across, cells derived from the axes' own
        // value order. L-54 — one cell removed inside the grid; the dative line
        // survives on the other two numbers, and the singulative column on the
        // other two cases.
        {
          kind: "table",
          rows: ["Case"],
          columns: ["Number"],
          exclude: [
            {
              coords: [
                { feature: "Case", value: "Dat" },
                { feature: "Number", value: "Sgv" },
              ],
            },
          ],
        },
        // L-51 — two axes nested on one dimension, so the Number header spans
        // its possessor-number columns. A flat grid cannot express this.
        { kind: "table", rows: ["Case"], columns: ["Number", "Number[psor]"] },
        // L-55 — an exclude naming FEWER coordinates than a cell, dropping the
        // whole singulative column rather than printing it empty. No editor
        // writes these, so only a fixture covers them.
        {
          kind: "table",
          fixed: [{ feature: "Gender", value: "Fem" }],
          rows: ["Case"],
          columns: ["Number"],
          exclude: [{ coords: [{ feature: "Number", value: "Sgv" }] }],
        },
        // L-57 — a list item on a value that is bound but declares no axis
        // here: `Gender` is inherent to NOUN, never an axis of it. Legitimate,
        // and must not be reported.
        { kind: "list", items: [{ coords: [{ feature: "Gender", value: "Fem" }] }] },
      ],
    },
    // L-52 — two tables of one category differing only in the pinned tense.
    // L-58 — declared for `{VERB, VerbForm=Fin}` and never for its infinitive
    // sibling, which therefore degrades to the flat list.
    {
      category: { upos: { value: "VERB" }, feats: [{ feature: "VerbForm", value: "Fin" }] },
      blocks: [
        {
          kind: "table",
          fixed: [
            { feature: "Mood", value: "Ind" },
            { feature: "Tense", value: "Pres" },
          ],
          rows: ["Person"],
          columns: ["Number"],
        },
        {
          kind: "table",
          fixed: [
            { feature: "Mood", value: "Ind" },
            { feature: "Tense", value: "Past" },
          ],
          rows: ["Person"],
          columns: ["Number"],
        },
      ],
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

/**
 * L-41 needs a grid past `MAX_LAYOUT_CELLS` (4096). Four axes of 8 · 8 · 8 · 9
 * = 4608 cells trip it with 33 value rows, under features nothing else in `qto`
 * uses — so the oversize block cannot distort any other row's diagnosis.
 */
const BIG_AXES: { feature: string; count: number }[] = [
  { feature: "Big1", count: 8 },
  { feature: "Big2", count: 8 },
  { feature: "Big3", count: 8 },
  { feature: "Big4", count: 9 },
];

const bigValues: GrammarValue[] = BIG_AXES.flatMap(({ feature, count }) =>
  Array.from({ length: count }, (_, i) =>
    value(feature, `V${i + 1}`, `${feature} ${i + 1}`, undefined, { scheme: "qto" }),
  ),
);

const bigAxisRows: GrammarAxis[] = BIG_AXES.map(({ feature, count }) => ({
  category: { upos: { value: "NOUN" } },
  feature,
  values: Array.from({ length: count }, (_, i) => `V${i + 1}`),
}));

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
  inherent: [{ category: { upos: { value: "NOUN" } }, feature: "Gender" }],
  bindings: [
    {
      tag: { upos: { value: "NOUN" }, feats: [{ feature: "Gender", value: "Fem" }] },
      label: { long: "izenn venel", short: "izb." },
    },
  ],
  axes: [{ category: { upos: { value: "NOUN" } }, feature: "Number", values: ["Sing", "Plur"] }],
};

/**
 * The rewrite, carrying one row per `GrammarIssue` kind. Since ADR-0015 this
 * record is refused **whole**, which is what these rows now assert: the coherent
 * version above stays current and `qto` stays browsable, while the browser —
 * which reads `getRecord` by rkey, and a language record's rkey is its tag —
 * reads this content, so the binding editor must list every defect and block
 * Publish (U-16).
 */
const qtoDefective: Grammar = {
  pos: [
    { value: "NOUN", label: { long: "izenn", short: "iz." } },
    { value: "VERB", label: { long: "gwered", short: "gw." } },
  ],
  features: [
    { feature: "Gender", label: { long: "reizhad", short: "rz." } },
    { feature: "Number", label: { long: "niveradur", short: "nv." } },
    ...BIG_AXES.map(({ feature }) => ({
      feature,
      scheme: "qto",
      label: { long: `dave ${feature}` },
    })),
    // L-42 — a lexicographic label set, which the layers below must not reach
    // for. The `inherent` row on it is the `lexicographic-in-grammar` defect.
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
    ...bigValues,
  ],
  inherent: [
    { category: { upos: { value: "NOUN" } }, feature: "Gender" },
    // L-31 `unbound-atom` — a layer-2 row built on a part of speech nobody bound.
    { category: { upos: { value: "ADJ" } }, feature: "Gender" },
    // L-35 `inherent-axis-conflict` — the same (category, feature) declared
    // both ways: a word cannot both *be* a number and vary over one.
    { category: { upos: { value: "NOUN" } }, feature: "Number" },
    // L-42 `lexicographic-in-grammar` — "archaic" is not something a word is.
    { category: { upos: { value: "VERB" } }, feature: "Style" },
  ],
  bindings: [
    {
      tag: { upos: { value: "NOUN" }, feats: [{ feature: "Gender", value: "Fem" }] },
      label: { long: "izenn venel", short: "izb." },
    },
    // L-34 `single-item-binding` — a one-atom row, whose real fix is to move it
    // to `pos` or `values`. The one defect no level of the editor reaches
    // through a (category, feature) pair, so it has a dedicated × control.
    { tag: { upos: { value: "VERB" } }, label: { long: "gwered", short: "g." } },
    // L-33 `ungrounded-combination` — no inherence chain reaches it: nothing
    // declares Number inherent to `{NOUN, Gender=Masc}`, nor Gender to
    // `{NOUN, Number=Plur}`.
    {
      tag: {
        upos: { value: "NOUN" },
        feats: [
          { feature: "Gender", value: "Masc" },
          { feature: "Number", value: "Plur" },
        ],
      },
      label: { long: "izenn dadel lies", short: "iztl." },
    },
  ],
  axes: [
    { category: { upos: { value: "NOUN" } }, feature: "Number", values: ["Sing", "Plur"] },
    // L-32 `duplicate` — a second axis row for the same pair, which would make
    // the value ORDER depend on array order.
    { category: { upos: { value: "NOUN" } }, feature: "Number", values: ["Plur", "Sing"] },
    // L-36 `empty-axis` — an axis with nothing to range over.
    { category: { upos: { value: "VERB" } }, feature: "Gender", values: [] },
    ...bigAxisRows,
  ],
  layout: [
    {
      category: { upos: { value: "NOUN" } },
      blocks: [
        // L-37 `layout-unknown-axis` — a dimension naming a feature this
        // category declares no axis of. L-39 `layout-foreign-coordinate` — an
        // exclusion outside the block's own grid, which can only ever remove
        // nothing. It is the one issue kind that reports something harmless,
        // and therefore the one most likely to be dismissed as noise.
        {
          kind: "table",
          rows: ["Number"],
          columns: ["Gender"],
          exclude: [{ coords: [{ feature: "Number", value: "Sgv" }] }],
        },
        // L-38 `layout-repeated-axis` — one feature on both dimensions.
        { kind: "table", rows: ["Number"], columns: ["Number"] },
        // L-40 `empty-layout-block`, both halves: a table with no dimensions…
        { kind: "table" },
        // …and a list with no items.
        { kind: "list", items: [] },
        // L-41 `layout-too-large` — 8 · 8 · 8 · 9 = 4608 cells, past the 4096
        // cap, so the block draws nothing and says why.
        {
          kind: "table",
          rows: ["Big1", "Big2"],
          columns: ["Big3", "Big4"],
        } satisfies LayoutBlock,
      ],
    },
  ],
  // L-43 `duplicate-abbreviation` — two front-matter entries under one
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
      "L-11", "L-12", "L-13", "L-14", "L-15", "L-16", "L-17",
      "L-50", "L-51", "L-52", "L-53", "L-54", "L-55", "L-56", "L-57", "L-58", "L-59",
    ],
    expect:
      "GET /languages/qtl/labels serves 57 rows. Two pairs are flagged as indistinguishable: `t.` over `troad-rener` and `troad-reiñ` (two values of one feature), and `gou.` over `gour` and `gourel` (a feature NAME against a value — the case pair-keying used to collapse). `troad-gouzañv` sits at count 0, which is legitimate: the language named it before anyone used it. The grammar dialog's Layout tab shows two rows — NOUN with five blocks and {VERB, VerbForm=Fin} with two — and the Paradigms tab lists both, plus an uncovered group holding the {ADJ} paradigm.",
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
    covers: ["L-30", "L-31", "L-32", "L-33", "L-34", "L-35", "L-36", "L-37", "L-38", "L-39", "L-40", "L-41", "L-42", "L-43"],
    expect:
      "GET /languages/qto/currentRecord still points at the COHERENT version — the defective rewrite was refused whole, and never entered the record's history. Opening the grammar dialog on qto reads the defective content from the PDS: Publish is disabled and the footer lists all fourteen defect kinds.",
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
