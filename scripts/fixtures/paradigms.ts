// The `eu.leksis.paradigm` fixtures for the full fixture language, in the v2
// shape ADR-0019 settled: a paradigm names the headword bundles it applies to
// by **exact match**, and carries its tables cell by cell.
//
// A paradigm has **no searchable field** — the AppView indexes pointers, not
// content, and there is no orthography to carry a handle — so for this lexicon
// the manifest is the only index (`leksis-testset` §6), and the on-record
// purpose text matters more, not less. It goes in `notes`, which is prose for
// other contributors and reaches no reader.
//
// Between them these seven cover the layer as the merge left it: generation
// from the lemma, several rules competing for one cell, a required principal
// part in both states, a base chain, syncretism drawn as one spanning cell, the
// three ways a cell can be blank, authored geometry (headings, filler, merges),
// one record serving several categories, exact match reaching one headword
// flavour and not its sibling, and a selector nobody declared staying inert.

import type { ParadigmFixture } from "./types.ts";

const NOUN = { value: "NOUN" };
const VERB = { value: "VERB" };
const ADJ = { value: "ADJ" };
const fem = { feature: "Gender", value: "Fem" };
const masc = { feature: "Gender", value: "Masc" };
const sing = { feature: "Number", value: "Sing" };
const plur = { feature: "Number", value: "Plur" };
const decl1 = { feature: "Declension", value: "1", scheme: "qtl" };
const decl2 = { feature: "Declension", value: "2", scheme: "qtl" };
const finite = { feature: "VerbForm", value: "Fin" };

/** A bare cell address, the way every stored address is written. */
function at(...coords: [string, string][]): { feature: string; value: string }[] {
  return coords.map(([feature, value]) => ({ feature, value }));
}

/** The three case headings every noun table in this language prints. */
const caseHeadings = ["Rener", "Perc'hennañ", "Reiñ"];

export const paradigmFixtures: ParadigmFixture[] = [
  // -------------------------------------------------------------------------
  {
    handle: "lxp-01",
    covers: ["P-01", "P-02", "P-06", "P-11", "P-12"],
    expect:
      "On /entry/<lxt-04> the first table is drawn as authored — a blank corner cell, a heading row of three numbers, a heading column of three cases — and filled by generation from the lemma `roska`: roska, roskas, roskenn, roskae, roskai. The genitive singular comes from the FIRST of the two rules in that cell whose condition matches. Three cells are blank for three different reasons and must not look alike: the genitive singular of the singulative column has no rule at all (manual-only), the dative plural has a rule whose condition declines for this lemma, and the dative singulative is structural filler — a cell the language says cannot exist. The genitive plural is the entry's own `roskerum` and is marked as asserted over the `roskarum` the rule would have produced. The second table's possessed forms are filled entirely by generation, and its genitive row is ONE cell spanning both possessor columns.",
    record: {
      languageID: "qtl",
      selectors: [{ upos: NOUN, feats: [fem, decl1, sing] }],
      label: { long: "kentañ displegadur", short: "1añ dis." },
      tables: [
        {
          name: "Displegadur",
          rows: [
            [
              // The blank corner of a header grid — and the reason `empty`
              // earns its place beside a heading with no text: a `title` here
              // would be announced as the column header for the case column.
              { kind: "empty" },
              { kind: "title", text: "Unander" },
              { kind: "title", text: "Liester" },
              { kind: "title", text: "Unanenn" },
            ],
            [
              { kind: "title", text: caseHeadings[0]! },
              // No condition and no affixes: the cell is identical to its base,
              // which here is the lemma. A legitimate rule, not an empty one.
              { kind: "form", coords: at(["Case", "Nom"], ["Number", "Sing"]), rules: [{}] },
              {
                kind: "form",
                coords: at(["Case", "Nom"], ["Number", "Plur"]),
                rules: [{ match: "a", strip: "a", add: "as" }],
              },
              {
                kind: "form",
                coords: at(["Case", "Nom"], ["Number", "Sgv"]),
                rules: [{ match: "a", strip: "a", add: "enn" }],
              },
            ],
            [
              { kind: "title", text: caseHeadings[1]! },
              {
                kind: "form",
                coords: at(["Case", "Gen"], ["Number", "Sing"]),
                // Two rules in one cell, the ordinary Hunspell shape. The
                // narrower condition is written FIRST, because the first
                // matching rule wins — order is semantics, not presentation.
                rules: [
                  { match: "ia", strip: "ia", add: "iae" },
                  { match: "a", strip: "a", add: "ae" },
                ],
              },
              {
                kind: "form",
                coords: at(["Case", "Gen"], ["Number", "Plur"]),
                rules: [{ match: "a", strip: "a", add: "arum" }],
              },
              // No rules at all: manual-only, fillable by an entry's own form
              // and by nothing else.
              { kind: "form", coords: at(["Case", "Gen"], ["Number", "Sgv"]) },
            ],
            [
              { kind: "title", text: caseHeadings[2]! },
              {
                kind: "form",
                coords: at(["Case", "Dat"], ["Number", "Sing"]),
                rules: [{ match: "a", strip: "a", add: "ai" }],
              },
              {
                kind: "form",
                coords: at(["Case", "Dat"], ["Number", "Plur"]),
                // A rule whose condition DECLINES for `roska` and holds for
                // `dour`'s neighbours: the language's own answer is "no form
                // here", which is a different statement from "nobody filled it
                // in" and must read differently.
                rules: [{ match: "os", strip: "os", add: "ois" }],
              },
              // Structural filler: the language says this cell cannot exist.
              { kind: "empty" },
            ],
          ],
        },
        {
          name: "Stummoù perc'hennet",
          rows: [
            // A heading spanning the whole table, above the two possessor
            // columns it introduces.
            [{ kind: "title", text: "Perc'henn", colSpan: 3 }],
            [
              { kind: "empty" },
              { kind: "title", text: "Ur perc'henn" },
              { kind: "title", text: "Meur a berc'henn" },
            ],
            [
              { kind: "title", text: caseHeadings[0]! },
              {
                kind: "form",
                coords: at(["Case", "Nom"], ["Number", "Sing"], ["Number[psor]", "Sing"]),
                rules: [{ add: "mo" }],
              },
              {
                kind: "form",
                coords: at(["Case", "Nom"], ["Number", "Sing"], ["Number[psor]", "Plur"]),
                rules: [{ add: "nos" }],
              },
            ],
            [
              { kind: "title", text: caseHeadings[1]! },
              // Syncretism drawn as ONE cell: a multivalue coordinate spanning
              // both possessor numbers, merged across the two columns it covers.
              // Never two cells that happen to agree.
              {
                kind: "form",
                coords: at(["Case", "Gen"], ["Number", "Sing"], ["Number[psor]", "Sing,Plur"]),
                rules: [{ add: "emo" }],
                colSpan: 2,
              },
            ],
          ],
        },
      ],
      notes: [
        "Leksis fixture lxp-01 — the first-declension noun. Generation from the lemma, two rules competing for one cell, the three blank states side by side, an asserted form overriding a generated one, and a second table whose geometry is authored: a spanning heading, a blank corner and a merged syncretic cell.",
      ],
      references: [{ text: "Leksis fixture set — not a real language." }],
    },
  },

  // -------------------------------------------------------------------------
  {
    handle: "lxp-02",
    covers: ["P-03", "P-04", "P-07"],
    expect:
      "On /entry/<lxt-05> the paradigm runs, because that entry supplies the genitive singular `kerneris`: the plural is built from it (kerneri), and the genitive plural from THAT (kernerium) — a two-link base chain, neither link touching the lemma. On /entry/<lxt-06> nothing is generated at all — the paradigm is skipped entirely rather than half-generated — and /language/qtl's missing-forms card lists that entry carrying this record's own message, in the fixture language, unaltered.",
    record: {
      languageID: "qtl",
      selectors: [{ upos: NOUN, feats: [fem, decl2, sing] }],
      label: { long: "eil displegadur", short: "2l dis." },
      // A principal part: this declension cannot be generated from the citation
      // form alone. An entry missing it is SKIPPED rather than half-generated,
      // and lands on the dashboard queue carrying this message.
      requires: [
        {
          coords: at(["Case", "Gen"], ["Number", "Sing"]),
          message:
            "Mankout a ra ar stumm troad-perc'hennañ unander. Hep se ne c'haller ket displegañ ar ger-mañ: ouzhpennit anezhañ e stummoù all ar ger.",
        },
      ],
      tables: [
        {
          name: "Displegadur",
          rows: [
            [
              { kind: "empty" },
              { kind: "title", text: "Unander" },
              { kind: "title", text: "Liester" },
            ],
            [
              { kind: "title", text: caseHeadings[0]! },
              { kind: "form", coords: at(["Case", "Nom"], ["Number", "Sing"]), rules: [{}] },
              {
                kind: "form",
                coords: at(["Case", "Nom"], ["Number", "Plur"]),
                // The stem, built once from the supplied genitive…
                rules: [
                  { base: at(["Case", "Gen"], ["Number", "Sing"]), strip: "is", add: "i" },
                ],
              },
            ],
            [
              { kind: "title", text: caseHeadings[1]! },
              // The cell the `requires` row names: the entry's own form fills
              // it, and no rule ever will.
              { kind: "form", coords: at(["Case", "Gen"], ["Number", "Sing"]) },
              {
                kind: "form",
                coords: at(["Case", "Gen"], ["Number", "Plur"]),
                // …and inflected from there, which is the second link.
                rules: [{ base: at(["Case", "Nom"], ["Number", "Plur"]), add: "um" }],
              },
            ],
            [
              { kind: "title", text: caseHeadings[2]! },
              {
                kind: "form",
                coords: at(["Case", "Dat"], ["Number", "Sing"]),
                rules: [
                  { base: at(["Case", "Gen"], ["Number", "Sing"]), strip: "is", add: "ei" },
                ],
              },
              {
                kind: "form",
                coords: at(["Case", "Dat"], ["Number", "Plur"]),
                rules: [{ base: at(["Case", "Nom"], ["Number", "Plur"]), add: "bus" }],
              },
            ],
          ],
        },
      ],
      notes: [
        "Leksis fixture lxp-02 — the second declension, which needs a principal part. Exercises `requires` in both states (supplied on lxt-05, missing on lxt-06) and a two-link base chain.",
      ],
    },
  },

  // -------------------------------------------------------------------------
  {
    handle: "lxp-03",
    covers: ["P-05", "P-12"],
    expect:
      "On /entry/<lxt-07> two tables fill from the lemma `kan`, one per tense, each captioned in the language's own words. In the present table `kanomp` occupies ONE cell spanning the first and second person plural — a multivalue coordinate merged down two rows, never the same form printed twice — while `kanan`, `kanez`, `kana` and `kanont` fill their own. The past table repeats the geometry with a gap: nobody wrote a second-person singular rule, so that cell is manual-only.",
    record: {
      languageID: "qtl",
      selectors: [{ upos: VERB, feats: [finite, { feature: "Person", value: "1" }] }],
      label: { long: "displegadur ar verb", short: "disp.v." },
      tables: [
        {
          name: "Doare-diskleriañ, amzer-vremañ",
          rows: [
            [
              { kind: "empty" },
              { kind: "title", text: "Unander" },
              { kind: "title", text: "Liester" },
            ],
            [
              { kind: "title", text: "1añ gour" },
              {
                kind: "form",
                coords: at(["Mood", "Ind"], ["Tense", "Pres"], ["Person", "1"], ["Number", "Sing"]),
                rules: [{ add: "an" }],
              },
              // One form covering the first and second person plural, drawn as
              // one cell merged down the two rows it covers.
              {
                kind: "form",
                coords: at(["Mood", "Ind"], ["Tense", "Pres"], ["Person", "1,2"], ["Number", "Plur"]),
                rules: [{ add: "omp" }],
                rowSpan: 2,
              },
            ],
            [
              { kind: "title", text: "2l gour" },
              {
                kind: "form",
                coords: at(["Mood", "Ind"], ["Tense", "Pres"], ["Person", "2"], ["Number", "Sing"]),
                rules: [{ add: "ez" }],
              },
            ],
            [
              { kind: "title", text: "3de gour" },
              {
                kind: "form",
                coords: at(["Mood", "Ind"], ["Tense", "Pres"], ["Person", "3"], ["Number", "Sing"]),
                rules: [{ add: "a" }],
              },
              {
                kind: "form",
                coords: at(["Mood", "Ind"], ["Tense", "Pres"], ["Person", "3"], ["Number", "Plur"]),
                rules: [{ add: "ont" }],
              },
            ],
          ],
        },
        {
          name: "Doare-diskleriañ, amzer-dremenet",
          rows: [
            [
              { kind: "empty" },
              { kind: "title", text: "Unander" },
              { kind: "title", text: "Liester" },
            ],
            [
              { kind: "title", text: "1añ gour" },
              {
                kind: "form",
                coords: at(["Mood", "Ind"], ["Tense", "Past"], ["Person", "1"], ["Number", "Sing"]),
                rules: [{ add: "en" }],
              },
              {
                kind: "form",
                coords: at(["Mood", "Ind"], ["Tense", "Past"], ["Person", "1"], ["Number", "Plur"]),
                rules: [{ add: "emp" }],
              },
            ],
            [
              { kind: "title", text: "2l gour" },
              // Manual-only: nobody has written the rule yet, which is a
              // different state from a rule that declined.
              {
                kind: "form",
                coords: at(["Mood", "Ind"], ["Tense", "Past"], ["Person", "2"], ["Number", "Sing"]),
              },
              {
                kind: "form",
                coords: at(["Mood", "Ind"], ["Tense", "Past"], ["Person", "2"], ["Number", "Plur"]),
                rules: [{ add: "ec'h" }],
              },
            ],
            [
              { kind: "title", text: "3de gour" },
              {
                kind: "form",
                coords: at(["Mood", "Ind"], ["Tense", "Past"], ["Person", "3"], ["Number", "Sing"]),
                rules: [{ add: "e" }],
              },
              {
                kind: "form",
                coords: at(["Mood", "Ind"], ["Tense", "Past"], ["Person", "3"], ["Number", "Plur"]),
                rules: [{ add: "ent" }],
              },
            ],
          ],
        },
      ],
      notes: [
        "Leksis fixture lxp-03 — the finite verb, cited in the first person. Two tables, one per tense, and a syncretic cell spanning the first and second person plural.",
      ],
    },
  },

  // -------------------------------------------------------------------------
  {
    handle: "lxp-04",
    covers: ["P-08"],
    expect:
      "The merge's motivating case, seen from the reader's side. This paradigm selects `{NOUN, Gender=Masc, Number=Plur}` — the anv-kadarn stroll, whose citation form IS the plural — so on /entry/<lxt-26> the lemma `bezhin` fills the collective cell and the singulative `bezhinenn` is derived from it. It must NOT reach /entry/<lxt-02>, whose bundle is the same category at `Number=Sing`: exact match, not containment, and the sibling therefore draws lxp-05's table instead.",
    record: {
      languageID: "qtl",
      selectors: [{ upos: NOUN, feats: [masc, plur] }],
      label: { long: "anvioù-kadarn stroll", short: "ak.str." },
      tables: [
        {
          name: "Stroll hag unanenn",
          rows: [
            [
              { kind: "title", text: "Stroll" },
              { kind: "title", text: "Unanenn" },
            ],
            [
              { kind: "form", coords: at(["Number", "Plur"]), rules: [{}] },
              { kind: "form", coords: at(["Number", "Sgv"]), rules: [{ add: "enn" }] },
            ],
            [
              { kind: "title", text: "Liester an unanenn", colSpan: 2 },
            ],
            [
              {
                kind: "form",
                coords: at(["Number", "Sgv"], ["Number[psor]", "Plur"]),
                rules: [{ add: "ennoù" }],
                colSpan: 2,
              },
            ],
          ],
        },
      ],
      notes: [
        "Leksis fixture lxp-04 — the anv-kadarn stroll: a category whose headword sits at the plural, its singulative derived by -enn. The sibling flavour of the same category, cited in the singular, is a different selector and this record never reaches it.",
      ],
    },
  },

  // -------------------------------------------------------------------------
  {
    handle: "lxp-05",
    covers: ["P-09"],
    expect:
      "ONE record serving TWO categories: the masculine and the feminine noun at their singular default, which decline alike in this language. Both /entry/<lxt-02> (masculine) and /entry/<lxt-14> (feminine) draw this table, and the manifest's paradigmKey is the same for both — the identity is the sorted set of selectors, so the order they were written in is not part of what the record says.",
    record: {
      languageID: "qtl",
      selectors: [
        { upos: NOUN, feats: [masc, sing] },
        { upos: NOUN, feats: [fem, sing] },
      ],
      label: { long: "displegadur boutin", short: "disp.b." },
      tables: [
        {
          name: "Displegadur boutin",
          rows: [
            [
              { kind: "empty" },
              { kind: "title", text: "Unander" },
              { kind: "title", text: "Liester" },
            ],
            [
              { kind: "title", text: caseHeadings[0]! },
              { kind: "form", coords: at(["Case", "Nom"], ["Number", "Sing"]), rules: [{}] },
              {
                kind: "form",
                coords: at(["Case", "Nom"], ["Number", "Plur"]),
                rules: [{ add: "où" }],
              },
            ],
            [
              { kind: "title", text: caseHeadings[1]! },
              {
                kind: "form",
                coords: at(["Case", "Gen"], ["Number", "Sing"]),
                rules: [{ add: "ig" }],
              },
              {
                kind: "form",
                coords: at(["Case", "Gen"], ["Number", "Plur"]),
                rules: [{ add: "ouig" }],
              },
            ],
          ],
        },
      ],
      notes: [
        "Leksis fixture lxp-05 — one set of tables for two categories, which is what `selectors` being a list is for: a declension shared by two genders, said once.",
      ],
    },
  },

  // -------------------------------------------------------------------------
  {
    handle: "lxp-06",
    covers: ["P-10"],
    expect:
      "An INERT paradigm: its selector is the minted part of speech `PREVERB`, which the language binds at layer 1 and declares no category for, and which no entry in the set carries. It is indexed like any other record and listed on the Paradigms level, and it reaches nothing — listed, never diagnosed. A paradigm arriving before the grammar that would declare its category is the same state, which is why this is not an error.",
    record: {
      languageID: "qtl",
      selectors: [{ upos: { value: "PREVERB", scheme: "qtl" } }],
      label: { long: "displegadur ar rakverboù", short: "disp.rv." },
      tables: [
        {
          rows: [
            [
              { kind: "title", text: "Unander" },
              { kind: "title", text: "Liester" },
            ],
            [
              { kind: "form", coords: at(["Number", "Sing"]), rules: [{}] },
              { kind: "form", coords: at(["Number", "Plur"]), rules: [{ add: "int" }] },
            ],
          ],
        },
      ],
      notes: [
        "Leksis fixture lxp-06 — a paradigm for a category nobody declared and no entry carries. Inert by design: it proves that a selector the grammar does not know is a disagreement between two records, never a defect inside one.",
      ],
    },
  },

  // -------------------------------------------------------------------------
  {
    handle: "lxp-07",
    covers: ["P-05", "P-11"],
    expect:
      "The adjective. `brava` is generated into the feminine cell of /entry/<lxt-09>, while the entry's own `bravik`, tagged `Gender=Fem,Masc|Number=Plur`, lands in the merged cell addressed the same way — one form spanning the whole axis, drawn as ONE cell across both columns and marked as asserted. A form spanning an axis and a form nobody entered must never look alike.",
    record: {
      languageID: "qtl",
      selectors: [{ upos: ADJ, feats: [masc] }],
      label: { long: "displegadur an anv-gwan", short: "disp.ag." },
      tables: [
        {
          name: "Reizh",
          rows: [
            [
              { kind: "title", text: "Gourel" },
              { kind: "title", text: "Gwregel" },
            ],
            [
              {
                kind: "form",
                coords: at(["Gender", "Masc"], ["Number", "Sing"]),
                rules: [{}],
              },
              {
                kind: "form",
                coords: at(["Gender", "Fem"], ["Number", "Sing"]),
                rules: [{ add: "a" }],
              },
            ],
            [{ kind: "title", text: "Liester", colSpan: 2 }],
            [
              // Syncretic and manual-only: the plural does not distinguish the
              // genders, so ONE cell is addressed by a multivalue coordinate and
              // merged across the two columns it covers. Nothing generates it —
              // it is where an entry's own spanning form lands.
              //
              // Note the two rows above are addressed at `Number=Sing` rather
              // than on gender alone. A spanning cell whose addresses another
              // cell already owns can never be reached: `placeForms` gives a
              // shared address to the first cell claiming it, so a bare
              // `Gender=Fem,Masc` cell under bare `Gender=Fem` and
              // `Gender=Masc` ones would be dead on arrival.
              {
                kind: "form",
                coords: at(["Gender", "Fem,Masc"], ["Number", "Plur"]),
                colSpan: 2,
              },
            ],
          ],
        },
      ],
      notes: [
        "Leksis fixture lxp-07 — the adjective, with a merged manual-only cell addressed by a multivalue coordinate: where a form spanning the whole axis lands.",
      ],
    },
  },
];
