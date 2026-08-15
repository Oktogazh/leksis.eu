// TEMPORARY verification harness for layer 5 slice 4 — what a reader sees.
// Pure: no database, no browser. It checks the three things the entry page
// delegates to the shared package, which is where they live precisely so they
// can be checked like this — the merge's precedence, a syncretic form spanning
// several cells, and the geometry that draws those cells as one. Deleted once
// the change is verified.
//
//   npx tsx apps/api/src/scripts/verify-paradigm-reader.ts

import {
  blockCells,
  layoutView,
  mergeCellSpans,
  mergeParadigms,
  placeForms,
  type Grammar,
  type LayoutAddress,
  type ParadigmRule,
  type Tag,
} from "@leksis/types";

let failures = 0;
let checks = 0;

function check(name: string, ok: boolean, detail = ""): void {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

/** Gender × Number for nouns, laid out as one table. */
const grammar: Grammar = {
  pos: [{ value: "NOUN", label: { long: "noun", short: "n." } }],
  features: [
    { feature: "Gender", label: { long: "gender" } },
    { feature: "Number", label: { long: "number" } },
  ],
  values: [
    { feature: "Gender", value: "Fem", label: { long: "feminine", short: "f." } },
    { feature: "Gender", value: "Masc", label: { long: "masculine", short: "m." } },
    { feature: "Number", value: "Sing", label: { long: "singular", short: "sg." } },
    { feature: "Number", value: "Plur", label: { long: "plural", short: "pl." } },
  ],
  axes: [
    { category: { upos: { value: "NOUN" } }, feature: "Gender", values: ["Fem", "Masc"] },
    { category: { upos: { value: "NOUN" } }, feature: "Number", values: ["Sing", "Plur"] },
  ],
  layout: [
    {
      category: { upos: { value: "NOUN" } },
      blocks: [{ kind: "table", rows: ["Number"], columns: ["Gender"] }],
    },
  ],
};

const noun: Tag[] = [{ upos: { value: "NOUN" } }];
const feat = (feature: string, value: string) => ({ feature, value });
const tag = (...feats: { feature: string; value: string }[]): Tag => ({ feats });

const rule = (
  coords: { feature: string; value: string }[],
  add: string,
  extra: Partial<ParadigmRule> = {},
): ParadigmRule => ({ coords, add, ...extra });

function main(): void {
  // ---- mergeParadigms: order and precedence ------------------------------
  const asserted = [
    { tag: tag(feat("Gender", "Fem"), feat("Number", "Plur")), form: "ASSERTED" },
  ];

  const one = mergeParadigms(
    [
      {
        id: "specific",
        rules: [
          rule([feat("Gender", "Fem"), feat("Number", "Sing")], "-fs"),
          rule([feat("Gender", "Fem"), feat("Number", "Plur")], "-fp"),
        ],
      },
    ],
    { lemma: "stem", forms: asserted },
  );
  check(
    "the entry's own forms come first, in its own order",
    one.forms[0]?.form === "ASSERTED" && one.forms[0]?.from === undefined,
  );
  check(
    "a generated form the entry did not assert is added",
    one.forms.some((f) => f.form === "stem-fs" && f.from === "specific"),
  );
  check(
    "and a generated form at an asserted address is dropped",
    one.forms.filter((f) => f.form.endsWith("-fp")).length === 0 && one.forms.length === 2,
    one.forms.map((f) => f.form).join(", "),
  );

  const two = mergeParadigms(
    [
      { id: "first", rules: [rule([feat("Gender", "Fem"), feat("Number", "Sing")], "-FIRST")] },
      { id: "second", rules: [rule([feat("Gender", "Fem"), feat("Number", "Sing")], "-SECOND")] },
    ],
    { lemma: "stem", forms: [] },
  );
  check(
    "the earlier paradigm wins a contested cell",
    two.forms.length === 1 && two.forms[0]?.form === "stem-FIRST",
    two.forms.map((f) => f.form).join(", "),
  );

  const missing = mergeParadigms(
    [
      {
        id: "needs",
        rules: [rule([feat("Gender", "Fem"), feat("Number", "Sing")], "-x")],
        requires: [{ coords: [feat("Number", "Plur")], message: "the plural is missing" }],
      },
      { id: "plain", rules: [rule([feat("Gender", "Masc"), feat("Number", "Sing")], "-y")] },
    ],
    { lemma: "stem", forms: [] },
  );
  check(
    "a paradigm missing a required base form contributes nothing",
    !missing.forms.some((f) => f.from === "needs"),
  );
  check(
    "while the others still generate",
    missing.forms.some((f) => f.from === "plain"),
  );
  check(
    "and the unmet requirement names its paradigm and its message",
    missing.missing.length === 1 &&
      missing.missing[0]?.from === "needs" &&
      missing.missing[0]?.message === "the plural is missing",
  );

  // ---- placeForms: syncretism spans, single values do not -----------------
  const blocks = layoutView(grammar, noun, []).blocks;
  const cells = blocks.flatMap(blockCells);
  check("the layout resolves to four cells", cells.length === 4, `${cells.length}`);

  const single = placeForms(cells, [
    { tag: tag(feat("Gender", "Fem"), feat("Number", "Sing")), form: "fs" },
  ]);
  check(
    "a single-valued form fills exactly one cell",
    single.placed.size === 1 && single.leftover.length === 0,
    `${single.placed.size} cell(s)`,
  );

  const syncretic = placeForms(cells, [
    { tag: tag(feat("Gender", "Fem,Masc"), feat("Number", "Plur")), form: "both" },
  ]);
  check(
    "a multivalue form fills every cell it spans",
    syncretic.placed.size === 2 && syncretic.leftover.length === 0,
    `${syncretic.placed.size} cell(s)`,
  );
  check(
    "and it is the same form object in each — what makes them mergeable",
    [...syncretic.placed.values()].every((list) => list[0] === syncretic.placed.values().next().value?.[0]),
  );

  const vague = placeForms(cells, [{ tag: tag(feat("Number", "Sing")), form: "vague" }]);
  check(
    "a form carrying less than an address still matches nothing",
    vague.placed.size === 0 && vague.leftover.length === 1,
  );

  const foreign = placeForms(cells, [{ tag: tag(feat("Case", "Gen")), form: "foreign" }]);
  check("a form addressing no cell stays a leftover", foreign.leftover.length === 1);

  // ---- the reader's whole path -------------------------------------------
  const merged = mergeParadigms(
    [
      {
        id: "p",
        rules: [
          rule([feat("Gender", "Fem"), feat("Number", "Sing")], "-fs"),
          rule([feat("Gender", "Masc"), feat("Number", "Sing")], "-ms"),
          // One form covering both genders in the plural: the settled spelling
          // of syncretism, and the reason the table below merges two cells.
          rule([feat("Gender", "Fem,Masc"), feat("Number", "Plur")], "-p"),
        ],
      },
    ],
    { lemma: "stem", forms: [] },
  );
  const display = merged.forms.map((form, id) => ({ ...form, id, generated: form.from !== undefined }));
  const view = layoutView(grammar, noun, display);
  check(
    "generation alone fills the table — a block no asserted form fills is now drawn",
    view.filled && view.placed.size === 4,
    `${view.placed.size} filled cell(s)`,
  );
  check("and every form in it is marked generated", display.every((f) => f.generated));

  // ---- mergeCellSpans: the geometry --------------------------------------
  const table = view.blocks[0]!;
  if (table.kind !== "table") throw new Error("expected a table block");
  const held = (address: LayoutAddress) => view.placed.get(address.key);
  const key = (address: LayoutAddress): string | undefined => {
    const there = held(address);
    return there === undefined ? undefined : there.map((f) => f.id).join("+");
  };
  const spans = mergeCellSpans(table.cells, key);
  const drawn = spans.flat().filter((span) => span !== "covered");
  check(
    "the syncretic row is drawn as one spanned cell, not two",
    drawn.length === 3 && drawn.some((span) => span.colSpan === 2),
    drawn.map((s) => `${s.colSpan}x${s.rowSpan}`).join(" "),
  );
  check(
    "every grid position is covered exactly once",
    spans.flat().length === 4 &&
      drawn.reduce((total, span) => total + span.colSpan * span.rowSpan, 0) === 4,
  );

  // Two forms that merely agree must NOT merge: same spelling, different
  // instances, which is the distinction the whole multivalue notation exists for.
  const coincide = [
    { tag: tag(feat("Gender", "Fem"), feat("Number", "Plur")), form: "same", id: 0, generated: false },
    { tag: tag(feat("Gender", "Masc"), feat("Number", "Plur")), form: "same", id: 1, generated: false },
  ];
  const coincideView = layoutView(grammar, noun, coincide);
  const coincideTable = coincideView.blocks[0]!;
  if (coincideTable.kind !== "table") throw new Error("expected a table block");
  const coincideSpans = mergeCellSpans(coincideTable.cells, (address) => {
    const there = coincideView.placed.get(address.key);
    return there === undefined ? undefined : there.map((f) => f.id).join("+");
  });
  check(
    "two forms that merely happen to agree are not merged",
    coincideSpans.flat().every((span) => span === "covered" || span.colSpan === 1),
  );

  // A designer's grid passes no key at all and must never merge.
  const noKey = mergeCellSpans(table.cells, () => undefined);
  check(
    "with no merge key nothing merges — the designer's grid is unchanged",
    noKey.flat().every((span) => span !== "covered" && span.colSpan === 1 && span.rowSpan === 1),
  );

  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures > 0) process.exitCode = 1;
}

main();