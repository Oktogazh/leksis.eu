// The fixture entries (`leksis-testset` §3.3), plus the rows layer 5 adds.
//
// Every one carries its handle as a NON-canonical orthography, because the
// AppView's search index is the lowercased orthographies plus the `otherForms`
// spellings — so `GET /entries?q=lxt-` returns the entire set with its
// entryKeys, in one call, forever. That is the whole addressing trick, and it is
// why the handle goes in `orthography` rather than in a field the index never
// sees.
//
// The words are invented. They are meant to look like a language so the pages
// render realistically, and to inflect regularly enough that the paradigms in
// `paradigms.ts` have something to bite on.

import type { EntryDefinition, EntryInflectedForm, Tag } from "@leksis/types";
import type { EntryFixture } from "./types.ts";
import { UNDESCRIBED_OCLC } from "./sources.ts";

const NOUN: Tag["upos"] = { value: "NOUN" };

/** A leaf definition at a flat depth-1 place. */
function leaf(index: number, text: string, extra?: Partial<EntryDefinition>): EntryDefinition {
  return { place: [index], text, ...extra };
}

/** A form at a bare cell address. */
function form(coords: [string, string][], spelling: string): EntryInflectedForm {
  return { tag: { feats: coords.map(([feature, value]) => ({ feature, value })) }, form: spelling };
}

export const entryFixtures: EntryFixture[] = [
  // -------------------------------------------------------------------------
  // The floor, and the record shapes
  // -------------------------------------------------------------------------
  {
    handle: "lxt-01",
    covers: ["E-01"],
    expect:
      "The absolute floor: one spelling besides the handle, one flat definition, no categories, no notes, no references, no forms. This is the ONE fixture whose purpose is stated nowhere on the record — both purpose slots are deliberately empty, so it is identified by its handle and this manifest alone.",
    record: {
      languageID: "qtl",
      orthography: ["tavesk", "lxt-01"],
      categories: [],
      definitions: [leaf(1, "Ar stumm izelañ a c'hall un enmont kaout.")],
    },
  },
  {
    handle: "lxt-02",
    covers: ["E-02", "E-10", "E-14", "E-15", "E-16"],
    expect:
      "Four spellings, all of them searchable. Three flat definitions numbered 1. 2. 3.; the second carries a free prose remark before its text. Entry-level notes render below the definitions (the evicted editorial label as prose), and two references at the very bottom — one a link, one plain text.",
    record: {
      languageID: "qtl",
      orthography: ["kambr", "kammr", "kamr", "lxt-02"],
      categories: [{ upos: NOUN, feats: [{ feature: "Gender", value: "Masc" }] }],
      definitions: [
        leaf(1, "Ul lec'h serret e-barzh un ti."),
        leaf(2, "Dre astenn, forzh peseurt egor bihan.", {
          notes: ["Nemet e brezhoneg ar mor."],
        }),
        leaf(3, "En doare kozh: ur c'hambr-gousk."),
      ],
      notes: [
        "kozh. — n'eo ket implijet ken gant ar re yaouank. Amañ e teu al label lexicografek da vezañ prozenn, evel ma c'houlenn ADR-0008.",
      ],
      references: [
        { text: "Leksis fixture lxt-02 — orthography variants, notes and references.", url: "https://leksis.eu/language/qtl" },
        { text: "Un dave hep liamm ebet." },
      ],
    },
  },
  {
    handle: "lxt-03",
    covers: ["E-03", "E-04"],
    expect:
      "The canonical spelling has no ASCII alphanumerics at all, so its entryKey was minted through the empty-slug path (`qtl--<hash>`). An IPA transcription renders under the headword.",
    record: {
      languageID: "qtl",
      orthography: ["ταβεσκ", "lxt-03"],
      transcription: "[taˈvesk]",
      categories: [{ upos: NOUN, feats: [{ feature: "Gender", value: "Masc" }] }],
      definitions: [leaf(1, "Ur ger skrivet en ul lizherenneg all.")],
      references: [{ text: "Leksis fixture lxt-03 — a non-Latin canonical orthography, and a transcription." }],
    },
  },

  // -------------------------------------------------------------------------
  // Layer 5's showcase: what generation looks like
  // -------------------------------------------------------------------------
  {
    handle: "lxt-04",
    covers: ["E-09", "E-17", "E-19", "E-27", "E-28", "P-01", "P-08", "P-11", "P-12"],
    expect:
      "The main layer-5 page. The main noun grid is mostly GENERATED from the lemma `roska` by lxp-01 and styled as derived, not asserted: roska, roskas, roskenn, roskae, roskai, roskis. One cell is the entry's own and wins: `roskerum` overrides the genitive plural lxp-01 would otherwise have produced (roskarum). Gen×Sgv is EMPTY — a faint dot, no rule reaches it — while Dat×Sgv is EXCLUDED, an em dash; the two must look different, and that distinction is the whole reason the layer draws them apart. The possessed block below is filled ENTIRELY by generation from lxp-04 — a block no asserted form fills, drawn anyway, which is the layer-4 rule ADR-0009 predicted layer 5 would revise. In the feminine-pinned block, `roskai-hir` lands in the dative singular although its tag also carries a part of speech no cell address asks for: the placement's superset tolerance. Searching `roskerum` returns this entry.",
    record: {
      languageID: "qtl",
      orthography: ["roska", "lxt-04"],
      // A minted tag in use: `Declension` is qtl's own feature and `1` its own
      // value, and both are what lxp-01's selector matches on.
      categories: [
        {
          upos: NOUN,
          feats: [
            { feature: "Gender", value: "Fem" },
            { feature: "Declension", value: "1", scheme: "qtl" },
          ],
        },
      ],
      otherForms: [
        // An irregular form: it overrides the cell lxp-01 generates.
        form([["Case", "Gen"], ["Number", "Plur"]], "roskerum"),
        // Carries MORE than the cell address — the part of speech and the
        // inherent gender ride along — and must still land in its cell.
        {
          tag: {
            upos: NOUN,
            feats: [
              { feature: "Gender", value: "Fem" },
              { feature: "Case", value: "Dat" },
              { feature: "Number", value: "Sing" },
            ],
          },
          form: "roskai-hir",
        },
      ],
      definitions: [
        leaf(1, "Ur voger vihan a zispleg hervez ar c'hentañ displegadur."),
        leaf(2, "Dre astenn, forzh petra a zispleg reizh."),
      ],
      references: [
        { text: "Leksis fixture lxt-04 — generation, override, superset placement, empty vs excluded cells." },
      ],
    },
  },
  {
    handle: "lxt-05",
    covers: ["P-03", "P-09"],
    expect:
      "A second-declension noun that SUPPLIES the principal part lxp-02 requires (the genitive singular, `kerneris`). So the paradigm runs: the nominative plural is built from that form (kerneri), and the genitive plural from the plural in turn (kernerium) — a two-link base chain, neither link touching the lemma.",
    record: {
      languageID: "qtl",
      orthography: ["kernos", "lxt-05"],
      categories: [
        {
          upos: NOUN,
          feats: [
            { feature: "Gender", value: "Fem" },
            { feature: "Declension", value: "2", scheme: "qtl" },
          ],
        },
      ],
      otherForms: [form([["Case", "Gen"], ["Number", "Sing"]], "kerneris")],
      definitions: [leaf(1, "Un dra a zispleg hervez an eil displegadur.")],
      references: [{ text: "Leksis fixture lxt-05 — a `requires` row satisfied, and a two-link base chain." }],
    },
  },
  {
    handle: "lxt-06",
    covers: ["P-04"],
    expect:
      "The same declension as lxt-05 and NO genitive singular, so lxp-02 is skipped ENTIRELY rather than half-generated — a paradigm missing a principal part would otherwise produce a plausible, wrong half-table, which is worse for a dictionary than an empty one. Its main grid is therefore blank where lxt-05's is full. Note lxp-04 still runs, because it requires nothing: one paradigm being skipped does not silence the others. /language/qtl's missing-forms card lists this entry carrying lxp-02's own message, in the fixture language, word for word — nothing paraphrases it, because the person who wrote the rule is a speaker.",
    record: {
      languageID: "qtl",
      orthography: ["tornos", "lxt-06"],
      categories: [
        {
          upos: NOUN,
          feats: [
            { feature: "Gender", value: "Fem" },
            { feature: "Declension", value: "2", scheme: "qtl" },
          ],
        },
      ],
      definitions: [leaf(1, "Un dra a zispleg hervez an eil displegadur, hep ma vije roet ar penn-stumm.")],
      references: [
        { text: "Leksis fixture lxt-06 — the missing-principal-part case. Deliberately incomplete; do not 'fix' it." },
      ],
    },
  },
  {
    handle: "lxt-07",
    covers: ["P-05", "P-07", "L-52", "L-53"],
    expect:
      "A perfectly regular verb that carries NO forms at all — the arc's promise in one page: kanan, kanez, kana, kanont are all generated. `kanomp` fills the 1st AND 2nd person plural under one merged heading rather than being printed twice, which is syncretism expressed instead of expanded. Two tables, told apart by their pinned tense: the present block's caption is ONE chip (the pair is named) and the past block's is two.",
    record: {
      languageID: "qtl",
      orthography: ["kan", "lxt-07"],
      categories: [{ upos: { value: "VERB" }, feats: [{ feature: "VerbForm", value: "Fin" }] }],
      definitions: [leaf(1, "Ober trouz gant ar vouezh, en un doare reizh.")],
      references: [
        { text: "Leksis fixture lxt-07 — a lemma that carries nothing: the whole table is generated." },
      ],
    },
  },
  {
    handle: "lxt-08",
    covers: ["L-58"],
    expect:
      "The non-finite sibling. The language declares axes and a layout for `{VERB, VerbForm=Fin}` and NEITHER for `{VERB, VerbForm=Inf}`, and lxp-03's selector does not reach it — so this entry degrades to the flat `otherForms` list, which is the fallback layer 5 must never break.",
    record: {
      languageID: "qtl",
      orthography: ["kanañ", "lxt-08"],
      categories: [{ upos: { value: "VERB" }, feats: [{ feature: "VerbForm", value: "Inf" }] }],
      otherForms: [form([["Number", "Sing"]], "kanadenn")],
      definitions: [leaf(1, "Anv-verb `kan`.")],
      references: [{ text: "Leksis fixture lxt-08 — the sibling category with no axes and no layout." }],
    },
  },
  {
    handle: "lxt-09",
    covers: ["L-17", "L-59", "P-10"],
    expect:
      "An adjective. `{ADJ}` declares an axis (Gender) and NO layout, so the forms print as a flat list in the axis's declared order, never as a fake table — the row verified by absence. lxp-05 generates the feminine (`brava`), and the entry's own `bravik` is tagged with the multivalue `Gender=Fem,Masc`: one form spanning the whole axis, which must never look like a form nobody entered.",
    record: {
      languageID: "qtl",
      orthography: ["brav", "lxt-09"],
      categories: [{ upos: { value: "ADJ" } }],
      otherForms: [form([["Gender", "Fem,Masc"]], "bravik")],
      definitions: [leaf(1, "Plijus d'ar sell.")],
      references: [{ text: "Leksis fixture lxt-09 — axes with no layout, and a form spanning an axis." }],
    },
  },

  // -------------------------------------------------------------------------
  // The definition tree
  // -------------------------------------------------------------------------
  {
    handle: "lxt-10",
    covers: ["E-11"],
    expect:
      "Depth 2 by IMPLICIT grouping: three leaves and no group items at all, rendering I. 1., I. 2., II. 1. The hierarchy is inferred from the leaves' places, which is what makes bare grouping free.",
    record: {
      languageID: "qtl",
      orthography: ["gwez", "lxt-10"],
      categories: [{ upos: NOUN, feats: [{ feature: "Gender", value: "Masc" }] }],
      definitions: [
        { place: [0, 1, 1], text: "Ur blantenn uhel gant ur c'hef koad." },
        { place: [0, 1, 2], text: "Ar c'hoad e-unan, evel danvez." },
        { place: [0, 2, 1], text: "Dre skeudenn, un tiegezh hir." },
      ],
      references: [{ text: "Leksis fixture lxt-10 — implicit grouping, no group nodes on the record." }],
    },
  },
  {
    handle: "lxt-11",
    covers: ["E-12", "E-13"],
    expect:
      "Depth 3 with EXPLICIT group nodes: A. / A. I. / A. I. 1. and so on. A group node exists on the record only because it carries something — notes, or its own categories. The `A. I.` heading carries a sense-level category, so the transitivity is stated once at the heading rather than repeated on every leaf beneath it.",
    record: {
      languageID: "qtl",
      orthography: ["dougen", "lxt-11"],
      categories: [{ upos: { value: "VERB" }, feats: [{ feature: "VerbForm", value: "Inf" }] }],
      definitions: [
        { place: [1, 0, 0], notes: ["Gant un objed."] },
        {
          place: [1, 1, 0],
          notes: ["Er ster pouezusañ."],
          // Sense-level altitude: a tag on a group node, not on the entry.
          categories: [{ feats: [{ feature: "Register", value: "Fam", scheme: "qtl" }] }],
        },
        { place: [1, 1, 1], text: "Kas un dra eus ul lec'h d'ul lec'h all." },
        { place: [1, 1, 2], text: "Bezañ karget eus ur pouez." },
        { place: [1, 2, 0], notes: ["Er ster skeudennek."] },
        { place: [1, 2, 1], text: "Bezañ kiriek eus un dra bennak." },
        { place: [2, 0, 0], notes: ["Hep objed ebet."] },
        { place: [2, 1, 1], text: "Mont war-raok, komz eus ur vag." },
      ],
      references: [{ text: "Leksis fixture lxt-11 — explicit group nodes and a sense-level category." }],
    },
  },

  // -------------------------------------------------------------------------
  // Forms that do not fit
  // -------------------------------------------------------------------------
  {
    handle: "lxt-12",
    covers: ["E-06", "E-18", "E-29", "L-14"],
    expect:
      "The category `{NOUN, Gender=Masc}` is deliberately NOT named as a combination although both its atoms are bound, so it renders as TWO chips by decomposition. Two forms fall outside the grid for different reasons and both survive below it, neither dropped: `dizanv` is tagged on a feature the language declares no axis of at all, while `kernosmo-hep` is tagged on a declared axis whose combination no block addresses.",
    record: {
      languageID: "qtl",
      orthography: ["mor", "lxt-12"],
      categories: [{ upos: NOUN, feats: [{ feature: "Gender", value: "Masc" }] }],
      otherForms: [
        form([["Polarity", "Neg"]], "dizanv"),
        form([["Number[psor]", "Sing"]], "kernosmo-hep"),
      ],
      definitions: [leaf(1, "An dour bras a zo tro-dro d'an douar.")],
      references: [{ text: "Leksis fixture lxt-12 — a decomposed category, and two kinds of unplaceable form." }],
    },
  },
  {
    handle: "lxt-13",
    covers: ["E-07", "E-08"],
    expect:
      "Two categories, both partly unbound. The first is a well-formed tag nobody bound at all, rendered VERBATIM and styled unbound. The second mixes a bound part of speech with the same unbound feature, so it decomposes partially: one resolved chip beside one verbatim one.",
    record: {
      languageID: "qtl",
      orthography: ["nann", "lxt-13"],
      categories: [
        { feats: [{ feature: "Polarity", value: "Neg" }] },
        { upos: NOUN, feats: [{ feature: "Polarity", value: "Neg" }] },
      ],
      definitions: [leaf(1, "Ar ger a nac'h.")],
      references: [{ text: "Leksis fixture lxt-13 — an unbound tag, and a mixed bundle." }],
    },
  },
  {
    handle: "lxt-14",
    covers: ["E-05", "L-57"],
    expect:
      "The category is EXACTLY the combination the language named, so it renders as ONE chip (`akg.`, expanding to `anv-kadarn gwregel` on hover) rather than as its two atoms. Contrast lxt-12, whose category is equally well bound and deliberately unnamed. Its form `skeudez` is what draws the last list block: the block is addressed on `Gender=Fem`, a value the language has bound and declared NO axis of — legitimate, and it must never be reported as a defect.",
    record: {
      languageID: "qtl",
      orthography: ["skeud", "lxt-14"],
      categories: [{ upos: NOUN, feats: [{ feature: "Gender", value: "Fem" }] }],
      // The only form in the set addressed on a bound non-axis value, and so
      // the only thing that makes the layout's last block draw at all.
      otherForms: [form([["Gender", "Fem"]], "skeudez")],
      definitions: [leaf(1, "Ar pezh a zeu diouzh un dra etre an heol hag an douar.")],
      references: [
        { text: "Leksis fixture lxt-14 — an exact-match category, and a list block on a non-axis value." },
      ],
    },
  },

  // -------------------------------------------------------------------------
  // The queues, the history, the removals
  // -------------------------------------------------------------------------
  {
    handle: "lxt-15",
    covers: ["E-20"],
    expect:
      "Carries exactly ONE todo item. With lxt-16's two, the flagged-for-review counter on /language/qtl is a known constant — 2 entries — and its dialog lists both with their items.",
    record: {
      languageID: "qtl",
      orthography: ["nezenn", "lxt-15"],
      categories: [{ upos: NOUN, feats: [{ feature: "Gender", value: "Fem" }] }],
      definitions: [leaf(1, "Un neudenn voan.")],
      todo: ["Gwiriañ ar ster eil."],
      references: [{ text: "Leksis fixture lxt-15 — exactly one todo item." }],
    },
  },
  {
    handle: "lxt-16",
    covers: ["E-20"],
    expect:
      "Carries exactly TWO todo items, so several bots or editors can each track their own. It is also the entry lxt-19's withdrawal redirects readers to.",
    record: {
      languageID: "qtl",
      orthography: ["seren", "lxt-16"],
      categories: [{ upos: NOUN, feats: [{ feature: "Gender", value: "Fem" }] }],
      definitions: [leaf(1, "Ur steredenn vihan.")],
      todo: ["Ouzhpennañ un daveenn.", "Gwiriañ an distagadur."],
      references: [{ text: "Leksis fixture lxt-16 — two todo items, and the redirect target of lxt-19." }],
    },
  },
  {
    handle: "lxt-17",
    covers: ["E-22"],
    expect:
      "Shares its canonical spelling `seren` with lxt-16 and is a DIFFERENT entry — homonyms coexist, because an entry's identity is its record chain and not its spelling. Each page lists the other under homonyms.",
    record: {
      languageID: "qtl",
      orthography: ["seren", "lxt-17"],
      categories: [{ upos: NOUN, feats: [{ feature: "Gender", value: "Masc" }] }],
      definitions: [leaf(1, "Ur seurt pesk dour-dous, hep kar ebet gant lxt-16.")],
      references: [{ text: "Leksis fixture lxt-17 — the homonym of lxt-16." }],
    },
  },
  {
    handle: "lxt-18",
    covers: ["E-21"],
    expect:
      "Three versions chained by `subject`, so the entry has a real history to vote on later. Only the last is current: the page shows three definitions, and the first two versions are archived rather than deleted.",
    record: {
      languageID: "qtl",
      orthography: ["ster", "lxt-18"],
      categories: [{ upos: NOUN, feats: [{ feature: "Gender", value: "Masc" }] }],
      definitions: [leaf(1, "Ar pezh a dalvez ur ger. (stumm 1)")],
      references: [{ text: "Leksis fixture lxt-18 — version history: three versions, chained." }],
    },
    versions: [
      {
        languageID: "qtl",
        orthography: ["ster", "lxt-18"],
        categories: [{ upos: NOUN, feats: [{ feature: "Gender", value: "Masc" }] }],
        definitions: [
          leaf(1, "Ar pezh a dalvez ur ger. (stumm 2)"),
          leaf(2, "Ivez: ar blijadur a gaver en un dra."),
        ],
        references: [{ text: "Leksis fixture lxt-18 — version history: three versions, chained." }],
      },
      {
        languageID: "qtl",
        orthography: ["ster", "lxt-18"],
        categories: [{ upos: NOUN, feats: [{ feature: "Gender", value: "Masc" }] }],
        definitions: [
          leaf(1, "Ar pezh a dalvez ur ger. (stumm 3, red)"),
          leaf(2, "Ivez: ar blijadur a gaver en un dra."),
          leaf(3, "Er yezh teknikel: talvoudegezh un arouez."),
        ],
        references: [{ text: "Leksis fixture lxt-18 — version history: three versions, chained." }],
      },
    ],
  },
  {
    handle: "lxt-19",
    covers: ["E-23"],
    expect:
      "Withdrawn: absent from search entirely, and still served at /entry/<key> with its reason, so old links resolve and the withdrawal can be contested. A statement about the dictionary, not about its author — the record itself was never deleted.",
    record: {
      languageID: "qtl",
      orthography: ["faziek", "lxt-19"],
      categories: [{ upos: { value: "ADJ" } }],
      definitions: [leaf(1, "Ur ger n'eus ket anezhañ e gwirionez.")],
      deleted: true,
      deletionReason: "N'eus ket eus ar ger-mañ er yezh: fazi un urzhiataer eo.",
      references: [{ text: "Leksis fixture lxt-19 — a withdrawal with a reason and no redirect." }],
    },
  },
  {
    handle: "lxt-20",
    covers: ["E-24"],
    expect:
      "Withdrawn as a duplicate, with a redirect: the page points readers at lxt-16, whose entryKey the publisher resolved after that entry landed.",
    record: {
      languageID: "qtl",
      orthography: ["serenn", "lxt-20"],
      categories: [{ upos: NOUN, feats: [{ feature: "Gender", value: "Fem" }] }],
      definitions: [leaf(1, "Un eil enmont evit `seren`.")],
      deleted: true,
      deletionReason: "Doubl: gwelet lxt-16.",
      references: [{ text: "Leksis fixture lxt-20 — a withdrawal that redirects." }],
    },
    redirectToHandle: "lxt-16",
  },

  // -------------------------------------------------------------------------
  // Volume, and the citation states
  // -------------------------------------------------------------------------
  {
    handle: "lxt-21",
    covers: ["E-25"],
    expect:
      "The ceiling on how big one fixture gets: eight definitions across two levels and six other forms, so the layout has something to strain against. Nothing here is exotic — it is bulk.",
    record: {
      languageID: "qtl",
      orthography: ["dour", "lxt-21"],
      categories: [
        {
          upos: NOUN,
          feats: [
            { feature: "Gender", value: "Fem" },
            { feature: "Declension", value: "1", scheme: "qtl" },
          ],
        },
      ],
      otherForms: [
        form([["Case", "Nom"], ["Number", "Plur"]], "douras"),
        form([["Case", "Gen"], ["Number", "Sing"]], "dourae"),
        form([["Case", "Dat"], ["Number", "Sing"]], "dourai"),
        form([["Case", "Nom"], ["Number", "Sgv"]], "dourenn"),
        form([["Case", "Gen"], ["Number", "Plur"]], "dourarum"),
        form([["Case", "Dat"], ["Number", "Plur"]], "douris"),
      ],
      definitions: [
        { place: [0, 1, 1], text: "An danvez red a ev an dud." },
        { place: [0, 1, 2], text: "Ur bern eus an danvez-se: ul lenn, ur stêr." },
        { place: [0, 1, 3], text: "Glav." },
        { place: [0, 2, 1], text: "Dre astenn, forzh peseurt danvez red." },
        { place: [0, 2, 2], text: "Er yezh-micher: ul lien fin." },
        { place: [0, 3, 1], text: "Dre skeudenn, ar berr-amzer." },
        { place: [0, 3, 2], text: "Er c'hoari: an dro gentañ." },
        { place: [0, 3, 3], text: "Kozh: ar mor." },
      ],
      references: [{ text: "Leksis fixture lxt-21 — volume: eight definitions, six forms." }],
    },
  },
  {
    handle: "lxt-22",
    covers: ["E-30", "E-31"],
    expect:
      "The three citation states, on one line each and visibly different. On the first leaf: one example citing lxs-01 with a locator (renders as the short citation form), one UNSOURCED (the sentence alone — a legitimate object, not an incomplete citation), and one citing a number no record describes (the bare `OCLC …`, styled unresolved, carrying the invitation to describe it). The second leaf cites lxs-01 AGAIN with a different locator: one description, two citations, resolved once through the per-number cache — and correcting the source corrects both.",
    record: {
      languageID: "qtl",
      orthography: ["gwerz", "lxt-22"],
      categories: [{ upos: NOUN, feats: [{ feature: "Gender", value: "Fem" }] }],
      definitions: [
        {
          place: [1],
          text: "Ur ganaouenn hir a gont un darvoud.",
          examples: [
            {
              text: "Kanet eo bet ar werz-mañ e-pad an noz.",
              source: { oclc: "9000000000000001", locator: "p. 142" },
            },
            { text: "Ur werz nevez a zo bet savet warlene." },
            {
              text: "N'eus ket kalz a werzioù kozh a chom.",
              source: { oclc: UNDESCRIBED_OCLC, locator: "§4" },
            },
          ],
        },
        {
          place: [2],
          text: "Dre astenn, ur gontadenn c'hlac'harus.",
          examples: [
            {
              text: "Ar werz-se a zo displeget e penn kentañ al levr.",
              source: { oclc: "9000000000000001", locator: "s.v. gwerz" },
            },
          ],
        },
      ],
      references: [{ text: "Leksis fixture lxt-22 — the three citation states, and one work cited twice." }],
    },
  },

  // -------------------------------------------------------------------------
  // The bare language
  // -------------------------------------------------------------------------
  {
    handle: "lxt-23",
    covers: ["E-26", "L-21", "L-22"],
    expect:
      "A well-formed tag in a language that has declared NO grammar at all, so it renders verbatim and styled unbound, and appears on GET /languages/qtm/labels as a row with a COUNT and no `long` — the worklist item, and the reason a bound label's `long` is nullable.",
    record: {
      languageID: "qtm",
      orthography: ["nozel", "lxt-23"],
      categories: [{ upos: NOUN, feats: [{ feature: "Gender", value: "Fem" }] }],
      otherForms: [form([["Number", "Plur"]], "nozelioù")],
      definitions: [leaf(1, "Ur ger er yezh n'he deus disklêriet netra.")],
      references: [{ text: "Leksis fixture lxt-23 — the bare language: verbatim tags and the worklist." }],
    },
  },
  {
    handle: "lxt-24",
    covers: ["E-26", "L-21"],
    expect:
      "A second bare-language entry, so the unbound-tag worklist has more than one row and its counts are distinguishable. Its forms print as the flat list, because no layout can exist without a grammar.",
    record: {
      languageID: "qtm",
      orthography: ["skalier", "lxt-24"],
      categories: [{ upos: { value: "VERB" } }],
      otherForms: [
        form([["Number", "Plur"]], "skalieroù"),
        form([["Tense", "Past"]], "skaliere"),
      ],
      definitions: [leaf(1, "Un ober er yezh noaz.")],
      references: [{ text: "Leksis fixture lxt-24 — the flat list with no grammar behind it." }],
    },
  },
  {
    handle: "lxt-25",
    covers: ["E-26", "S-04"],
    expect:
      "A bare-language entry citing lxs-04, the work whose only language is qtm — proving an example and its source are independent of the grammar cascade: a language that has declared nothing can still quote a book.",
    record: {
      languageID: "qtm",
      orthography: ["levr", "lxt-25"],
      categories: [],
      definitions: [
        {
          place: [1],
          text: "Un dastumad follennoù skrivet.",
          examples: [
            {
              text: "Lennet em eus al levr-mañ e-pad ar goañv.",
              source: { oclc: "9000000000000004", locator: "p. 7" },
            },
          ],
        },
      ],
      references: [{ text: "Leksis fixture lxt-25 — a citation from the bare language." }],
    },
  },
];
