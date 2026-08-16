// Layer 5's fixtures: `eu.leksis.paradigm` records for the full fixture
// language.
//
// A paradigm has **no searchable field** — the AppView indexes pointers, not
// content, and there is no orthography to carry a handle — so for this lexicon
// the manifest is the only index (`leksis-testset` §6), and the on-record
// purpose text matters more, not less. It goes in `notes`, which is prose for
// other contributors and reaches no reader.
//
// Between them these five cover the whole layer: generation from the lemma,
// several rows competing for one cell, a required principal part (present on one
// entry and missing on another), a base chain, syncretism spanning an axis,
// most-specific-selector precedence, and a paradigm no layout row covers.

import type { ParadigmFixture } from "./types.ts";

const NOUN = { value: "NOUN" };
const VERB = { value: "VERB" };

export const paradigmFixtures: ParadigmFixture[] = [
  // -------------------------------------------------------------------------
  {
    handle: "lxp-01",
    covers: ["P-01", "P-02", "P-06"],
    expect:
      "On /entry/<lxt-04>, the noun grid is filled by generation from the lemma `roska`: roskae, roskai, roskas, roskarum, roskis, roskenn — each styled as generated, not asserted. Gen×Sgv is EMPTY (no rule targets it) while Dat×Sgv is EXCLUDED, and the two must not look the same. The genitive singular comes from the FIRST of the two rows targeting it whose condition matches.",
    record: {
      languageID: "qtl",
      selector: {
        upos: NOUN,
        feats: [{ feature: "Declension", value: "1", scheme: "qtl" }],
      },
      label: { long: "kentañ displegadur", short: "1añ dis." },
      rules: [
        // A row with no condition and no affixes is legitimate: this cell is
        // identical to its base, which here is the lemma.
        { coords: [{ feature: "Case", value: "Nom" }, { feature: "Number", value: "Sing" }] },
        // Two rows for one cell, the ordinary Hunspell shape. The narrower
        // condition is written FIRST, because the first matching row wins —
        // rule order is semantics, not presentation.
        {
          coords: [{ feature: "Case", value: "Gen" }, { feature: "Number", value: "Sing" }],
          match: "ia",
          strip: "ia",
          add: "iae",
        },
        {
          coords: [{ feature: "Case", value: "Gen" }, { feature: "Number", value: "Sing" }],
          match: "a",
          strip: "a",
          add: "ae",
        },
        {
          coords: [{ feature: "Case", value: "Dat" }, { feature: "Number", value: "Sing" }],
          match: "a",
          strip: "a",
          add: "ai",
        },
        {
          coords: [{ feature: "Case", value: "Nom" }, { feature: "Number", value: "Plur" }],
          match: "a",
          strip: "a",
          add: "as",
        },
        {
          coords: [{ feature: "Case", value: "Gen" }, { feature: "Number", value: "Plur" }],
          match: "a",
          strip: "a",
          add: "arum",
        },
        {
          coords: [{ feature: "Case", value: "Dat" }, { feature: "Number", value: "Plur" }],
          match: "a",
          strip: "a",
          add: "is",
        },
        // The minted singulative. Gen×Sgv is deliberately left ungenerated.
        {
          coords: [{ feature: "Case", value: "Nom" }, { feature: "Number", value: "Sgv" }],
          match: "a",
          strip: "a",
          add: "enn",
        },
      ],
      notes: [
        "Leksis fixture lxp-01 — the first-declension noun paradigm: generation from the lemma alone, with two rows competing for the genitive singular and one cell deliberately left ungenerated.",
      ],
      references: [{ text: "Leksis fixture set — not a real language." }],
    },
  },

  // -------------------------------------------------------------------------
  {
    handle: "lxp-02",
    covers: ["P-03", "P-04", "P-09"],
    expect:
      "On /entry/<lxt-05> the paradigm runs, because that entry supplies the genitive singular `kerneris`: the plural is built from it (kerneri), and the genitive plural from THAT (kernerium) — a two-link base chain. On /entry/<lxt-06> nothing is generated at all, and /language/qtl's missing-forms card lists it carrying this record's own message, in the fixture language, unaltered.",
    record: {
      languageID: "qtl",
      selector: {
        upos: NOUN,
        feats: [{ feature: "Declension", value: "2", scheme: "qtl" }],
      },
      label: { long: "eil displegadur", short: "2l dis." },
      // A principal part: this declension cannot be generated from the citation
      // form alone. An entry missing it is SKIPPED rather than half-generated,
      // and lands on the dashboard queue carrying this message.
      requires: [
        {
          coords: [{ feature: "Case", value: "Gen" }, { feature: "Number", value: "Sing" }],
          message:
            "Mankout a ra ar stumm troad-perc'hennañ unander. Hep se ne c'haller ket displegañ ar ger-mañ: ouzhpennit anezhañ e stummoù all ar ger.",
        },
      ],
      rules: [
        { coords: [{ feature: "Case", value: "Nom" }, { feature: "Number", value: "Sing" }] },
        // The stem, built once from the supplied genitive…
        {
          coords: [{ feature: "Case", value: "Nom" }, { feature: "Number", value: "Plur" }],
          base: [{ feature: "Case", value: "Gen" }, { feature: "Number", value: "Sing" }],
          strip: "is",
          add: "i",
        },
        // …and inflected from there, which is the second link of the chain.
        {
          coords: [{ feature: "Case", value: "Gen" }, { feature: "Number", value: "Plur" }],
          base: [{ feature: "Case", value: "Nom" }, { feature: "Number", value: "Plur" }],
          add: "um",
        },
        {
          coords: [{ feature: "Case", value: "Dat" }, { feature: "Number", value: "Plur" }],
          base: [{ feature: "Case", value: "Nom" }, { feature: "Number", value: "Plur" }],
          add: "bus",
        },
        {
          coords: [{ feature: "Case", value: "Dat" }, { feature: "Number", value: "Sing" }],
          base: [{ feature: "Case", value: "Gen" }, { feature: "Number", value: "Sing" }],
          strip: "is",
          add: "ei",
        },
        {
          coords: [{ feature: "Case", value: "Nom" }, { feature: "Number", value: "Sgv" }],
          base: [{ feature: "Case", value: "Gen" }, { feature: "Number", value: "Sing" }],
          strip: "is",
          add: "enn",
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
    covers: ["P-05", "P-07"],
    expect:
      "On /entry/<lxt-07> the present-tense block fills (kanan, kanez, kana, kanont) and ONE form, `kanomp`, spans the 1st and 2nd person plural cells under a merged heading — never printed twice. The past-tense block is a second table of the same category, told apart by its pinned tense, and its caption reads as ONE chip for the present pair and two for the past.",
    record: {
      languageID: "qtl",
      selector: { upos: VERB, feats: [{ feature: "VerbForm", value: "Fin" }] },
      label: { long: "displegadur ar verb", short: "disp.v." },
      rules: [
        // The rules carry the block's pinned constants, because that is what the
        // cell address is: placement matches exactly first, then by containment.
        {
          coords: [
            { feature: "Mood", value: "Ind" },
            { feature: "Tense", value: "Pres" },
            { feature: "Person", value: "1" },
            { feature: "Number", value: "Sing" },
          ],
          add: "an",
        },
        {
          coords: [
            { feature: "Mood", value: "Ind" },
            { feature: "Tense", value: "Pres" },
            { feature: "Person", value: "2" },
            { feature: "Number", value: "Sing" },
          ],
          add: "ez",
        },
        {
          coords: [
            { feature: "Mood", value: "Ind" },
            { feature: "Tense", value: "Pres" },
            { feature: "Person", value: "3" },
            { feature: "Number", value: "Sing" },
          ],
          add: "a",
        },
        // Syncretism: ONE form covering two cells, written as a multivalue
        // coordinate. Deliberately not a wildcard — a form covering an axis and
        // a form nobody has entered must never look the same to a reader.
        {
          coords: [
            { feature: "Mood", value: "Ind" },
            { feature: "Tense", value: "Pres" },
            { feature: "Person", value: "1,2" },
            { feature: "Number", value: "Plur" },
          ],
          add: "omp",
        },
        {
          coords: [
            { feature: "Mood", value: "Ind" },
            { feature: "Tense", value: "Pres" },
            { feature: "Person", value: "3" },
            { feature: "Number", value: "Plur" },
          ],
          add: "ont",
        },
        {
          coords: [
            { feature: "Mood", value: "Ind" },
            { feature: "Tense", value: "Past" },
            { feature: "Person", value: "1" },
            { feature: "Number", value: "Sing" },
          ],
          add: "en",
        },
        {
          coords: [
            { feature: "Mood", value: "Ind" },
            { feature: "Tense", value: "Past" },
            { feature: "Person", value: "3" },
            { feature: "Number", value: "Sing" },
          ],
          add: "e",
        },
        {
          coords: [
            { feature: "Mood", value: "Ind" },
            { feature: "Tense", value: "Past" },
            { feature: "Person", value: "3" },
            { feature: "Number", value: "Plur" },
          ],
          add: "ent",
        },
      ],
      notes: [
        "Leksis fixture lxp-03 — the finite verb. Exercises syncretism (one form spanning the 1st and 2nd person plural) and rules addressing a block's pinned constants.",
      ],
    },
  },

  // -------------------------------------------------------------------------
  {
    handle: "lxp-04",
    covers: ["P-08", "P-12"],
    expect:
      "The possessed-declension block on /entry/<lxt-04> fills from this broader paradigm, which the narrower lxp-01 never addresses. Where the two DO collide — the dative plural — the more specific selector wins: the cell reads `roskis` (from lxp-01), never `roskaobus`.",
    record: {
      languageID: "qtl",
      // Broader than lxp-01's `{NOUN, Declension=1}`, and matching the same
      // entries: what proves most-specific-selector precedence.
      selector: { upos: NOUN },
      label: { long: "displegadur boutin", short: "disp.b." },
      rules: [
        {
          coords: [
            { feature: "Case", value: "Nom" },
            { feature: "Number", value: "Sing" },
            { feature: "Number[psor]", value: "Sing" },
          ],
          add: "mo",
        },
        {
          coords: [
            { feature: "Case", value: "Nom" },
            { feature: "Number", value: "Sing" },
            { feature: "Number[psor]", value: "Plur" },
          ],
          add: "nos",
        },
        {
          coords: [
            { feature: "Case", value: "Gen" },
            { feature: "Number", value: "Sing" },
            { feature: "Number[psor]", value: "Sing" },
          ],
          add: "emo",
        },
        {
          coords: [
            { feature: "Case", value: "Nom" },
            { feature: "Number", value: "Plur" },
            { feature: "Number[psor]", value: "Sing" },
          ],
          add: "smo",
        },
        // The deliberate collision with lxp-01, which also targets this cell.
        {
          coords: [{ feature: "Case", value: "Dat" }, { feature: "Number", value: "Plur" }],
          add: "obus",
        },
      ],
      notes: [
        "Leksis fixture lxp-04 — a paradigm on the bare part of speech, broader than lxp-01. Fills the possessed block, and collides with lxp-01 on exactly one cell so that most-specific-selector precedence is visible.",
      ],
    },
  },

  // -------------------------------------------------------------------------
  {
    handle: "lxp-05",
    covers: ["P-10"],
    expect:
      "No layout row covers `{ADJ}`, so the Paradigms tab lists this one under its own 'no layout covers these' heading — LISTED, never diagnosed. Its generated forms still reach /entry/<lxt-09>, in the FLAT list, which is the fallback the whole layer must never break.",
    record: {
      languageID: "qtl",
      selector: { upos: { value: "ADJ" } },
      label: { long: "displegadur an anv-gwan", short: "disp.ag." },
      rules: [
        { coords: [{ feature: "Gender", value: "Masc" }] },
        { coords: [{ feature: "Gender", value: "Fem" }], add: "a" },
      ],
      notes: [
        "Leksis fixture lxp-05 — a paradigm for a category with declared axes and NO layout. Its forms land in the flat list, and the Paradigms tab files it under the uncovered group.",
      ],
    },
  },
];
