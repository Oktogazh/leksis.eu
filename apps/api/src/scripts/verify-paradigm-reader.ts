// TEMPORARY verification harness for ADR-0019 slice 4 — what a reader sees.
// Pure: no database, no browser. It checks the things the entry page delegates
// to the shared package, which is where they live precisely so they can be
// checked like this — the grid a record's cells tile, the re-qualification of a
// bare address, the merge's precedence, a syncretic form spanning several
// cells, and the generator's reading order. Deleted once the change is
// verified.
//
//   npx tsx apps/api/src/scripts/verify-paradigm-reader.ts

import {
  generateForms,
  mergeParadigms,
  paradigmCellAddresses,
  paradigmGrid,
  paradigmIdentityKey,
  paradigmIssues,
  paradigmRkey,
  placeForms,
  resolveParadigmTables,
  type Grammar,
  type ParadigmCell,
  type ParadigmTable,
  type Tag,
} from "@leksis/types";

let failures = 0;
let checks = 0;

function check(name: string, ok: boolean, detail = ""): void {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

/**
 * Gender × Number for nouns. `Number=Sgv` is **minted** (scheme "x-read"), which
 * is what makes the re-qualification check below mean something: the record
 * addresses it bare and only the grammar knows where it came from.
 */
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
    {
      feature: "Number",
      value: "Sgv",
      scheme: "x-read",
      label: { long: "singulative", short: "sgv." },
    },
  ],
};

const feat = (feature: string, value: string) => ({ feature, value });
const tag = (...feats: { feature: string; value: string }[]): Tag => ({ feats });

const fs = [feat("Gender", "Fem"), feat("Number", "Sing")];
const ms = [feat("Gender", "Masc"), feat("Number", "Sing")];
const bothPlur = [feat("Gender", "Fem,Masc"), feat("Number", "Plur")];

const title = (text: string, colSpan?: number): ParadigmCell => ({
  kind: "title",
  text,
  ...(colSpan !== undefined ? { colSpan } : {}),
});
const form = (
  coords: { feature: string; value: string }[],
  add?: string,
  extra: Partial<Extract<ParadigmCell, { kind: "form" }>> = {},
): ParadigmCell => ({
  kind: "form",
  coords,
  ...(add !== undefined ? { rules: [{ add }] } : {}),
  ...extra,
});

/**
 * The table the reader draws: a heading row spanning two columns, the singular
 * cells beneath it, and one plural cell covering both genders — the settled
 * spelling of syncretism, drawn as one merged cell because the record says so.
 */
const table: ParadigmTable = {
  name: "Declension",
  rows: [
    [title("Number and gender", 2)],
    [form(fs, "-fs"), form(ms, "-ms")],
    [form(bothPlur, "-p", { colSpan: 2 })],
  ],
};

function main(): void {
  // ---- geometry: which grid a record's cells tile ------------------------
  const grid = paradigmGrid(table);
  check(
    "the authored spans tile a 2×3 rectangle with no holes",
    grid.width === 2 && grid.height === 3 && grid.holes === 0,
    `${grid.width}×${grid.height}, ${grid.holes} hole(s)`,
  );
  check(
    "and every cell knows where it starts",
    grid.cells.length === 4 &&
      grid.cells[1]?.left === 0 &&
      grid.cells[2]?.left === 1 &&
      grid.cells[3]?.colSpan === 2,
  );

  const ragged = paradigmGrid({ rows: [[title("a"), title("b")], [title("c")]] });
  check("a row one cell short leaves a hole", ragged.holes === 1, `${ragged.holes}`);
  check(
    "and that is what `ragged-table` reports",
    paradigmIssues({
      tables: [{ rows: [[title("a"), title("b")], [form(fs, "-x")]] }],
    }).some((issue) => issue.kind === "ragged-table"),
  );

  // A rowSpan from an earlier row pushes the cells below it along, exactly as
  // an HTML table does — the property that makes a row heading writable once.
  const spanned = paradigmGrid({
    rows: [[title("head", 1), form(fs, "-a")], [form(ms, "-b")]],
  });
  check(
    "a cell is placed at the first free column of its row",
    spanned.cells[2]?.left === 0,
    `${spanned.cells[2]?.left}`,
  );

  // ---- the coherence gate -------------------------------------------------
  check(
    "tables that address nothing are `no-cells`",
    paradigmIssues({ tables: [{ rows: [[title("only a heading")]] }] }).some(
      (i) => i.kind === "no-cells",
    ),
  );
  check(
    "two cells at one address are `duplicate-cell`",
    paradigmIssues({ tables: [{ rows: [[form(fs, "-a"), form(fs, "-b")]] }] }).some(
      (i) => i.kind === "duplicate-cell",
    ),
  );
  check(
    "a base grounding in nothing is `unknown-base`",
    paradigmIssues({
      tables: [{ rows: [[form(fs, undefined, { rules: [{ base: ms, add: "-x" }] })]] }],
    }).some((i) => i.kind === "unknown-base"),
  );
  check(
    "a base chain that loops is `base-cycle`",
    paradigmIssues({
      tables: [
        {
          rows: [
            [
              form(fs, undefined, { rules: [{ base: ms, add: "a" }] }),
              form(ms, undefined, { rules: [{ base: fs, add: "b" }] }),
            ],
          ],
        },
      ],
    }).some((i) => i.kind === "base-cycle"),
  );
  check(
    "a condition that does not compile is `invalid-match`",
    paradigmIssues({
      tables: [{ rows: [[form(fs, undefined, { rules: [{ match: "([a-", add: "x" }] })]] }],
    }).some((i) => i.kind === "invalid-match"),
  );
  check(
    "a blank requirement message is `empty-message`",
    paradigmIssues({
      tables: [{ rows: [[form(fs, "-a")]] }],
      requires: [{ coords: ms, message: "   " }],
    }).some((i) => i.kind === "empty-message"),
  );
  check("and the table above is clean", paradigmIssues({ tables: [table] }).length === 0);

  // A base an entry supplies grounds the chain just as another cell does.
  check(
    "a base met by a `requires` row grounds the chain",
    paradigmIssues({
      tables: [{ rows: [[form(fs, undefined, { rules: [{ base: ms, add: "-x" }] })]] }],
      requires: [{ coords: ms, message: "the masculine singular is missing" }],
    }).length === 0,
  );

  // ---- identity: sorted, deduplicated, order-blind -------------------------
  const a: Tag = { upos: { value: "NOUN" }, feats: [feat("Gender", "Fem")] };
  const b: Tag = { upos: { value: "NOUN" }, feats: [feat("Gender", "Masc")] };
  check(
    "the order selectors were written in does not change the identity",
    paradigmRkey({ languageID: "x-read", selectors: [a, b] }) ===
      paradigmRkey({ languageID: "x-read", selectors: [b, a] }),
  );
  check(
    "a repeated selector says what one selector says",
    paradigmIdentityKey([a, b, a]) === paradigmIdentityKey([a, b]),
  );
  check(
    "and two different sets are two identities",
    paradigmRkey({ languageID: "x-read", selectors: [a] }) !==
      paradigmRkey({ languageID: "x-read", selectors: [a, b] }),
  );

  // ---- resolution: a bare address gets its provenance back ----------------
  const minted: ParadigmTable = { rows: [[form([feat("Number", "Sgv")], "-sgv")]] };
  const resolved = resolveParadigmTables(grammar, [minted]);
  const cell = resolved[0]?.rows[0]?.[0];
  check(
    "a minted coordinate is re-qualified from the language's own row",
    cell?.kind === "form" && cell.address.tag.feats?.[0]?.scheme === "x-read",
    cell?.kind === "form" ? String(cell.address.tag.feats?.[0]?.scheme) : "not a form cell",
  );
  const bare = resolveParadigmTables(undefined, [minted])[0]?.rows[0]?.[0];
  check(
    "with no grammar it stays bare rather than guessing",
    bare?.kind === "form" && bare.address.tag.feats?.[0]?.scheme === undefined,
  );
  check(
    "and the join key is scheme-blind either way",
    cell?.kind === "form" && bare?.kind === "form" && cell.address.key === bare.address.key,
  );

  // ---- generation: reading order, first matching rule, chains -------------
  const generated = generateForms({ tables: [table] }, { lemma: "stem", forms: [] });
  check(
    "forms come out in the table's own reading order",
    generated.forms.map((f) => f.form).join(",") === "stem-fs,stem-ms,stem-p",
    generated.forms.map((f) => f.form).join(","),
  );

  const conditioned = generateForms(
    {
      tables: [
        {
          rows: [
            [
              form(fs, undefined, {
                rules: [
                  { match: "y", strip: "y", add: "ies" },
                  { add: "s" },
                ],
              }),
            ],
          ],
        },
      ],
    },
    { lemma: "cherry", forms: [] },
  );
  check(
    "the first rule of a cell whose condition matches wins it",
    conditioned.forms[0]?.form === "cherries" && conditioned.forms[0]?.rule === 0,
    conditioned.forms[0]?.form,
  );
  const fallback = generateForms(
    {
      tables: [
        {
          rows: [
            [form(fs, undefined, { rules: [{ match: "y", strip: "y", add: "ies" }, { add: "s" }] })],
          ],
        },
      ],
    },
    { lemma: "cat", forms: [] },
  );
  check(
    "and the next one takes it when the first declines",
    fallback.forms[0]?.form === "cats" && fallback.forms[0]?.rule === 1,
    fallback.forms[0]?.form,
  );

  const manual = generateForms(
    { tables: [{ rows: [[form(fs), form(ms, "-ms")]] }] },
    { lemma: "stem", forms: [] },
  );
  check(
    "a cell with no rules generates nothing — it is manual-only",
    manual.forms.length === 1 && manual.forms[0]?.form === "stem-ms",
    manual.forms.map((f) => f.form).join(","),
  );

  const chained = generateForms(
    {
      tables: [
        {
          rows: [
            [
              form(ms, "-stem"),
              form(fs, undefined, { rules: [{ base: ms, add: "-then" }] }),
            ],
          ],
        },
      ],
    },
    { lemma: "root", forms: [] },
  );
  check(
    "a rule starting from another cell generates that cell first",
    chained.forms.some((f) => f.form === "root-stem-then"),
    chained.forms.map((f) => f.form).join(","),
  );

  // A cycle is refused at ingest; the generator still has to be total when
  // handed a draft that has not been through the gate.
  const cyclic = generateForms(
    {
      tables: [
        {
          rows: [
            [
              form(fs, undefined, { rules: [{ base: ms, add: "a" }] }),
              form(ms, undefined, { rules: [{ base: fs, add: "b" }] }),
            ],
          ],
        },
      ],
    },
    { lemma: "root", forms: [] },
  );
  check("a cyclic draft yields nothing rather than recursing", cyclic.forms.length === 0);

  // ---- mergeParadigms: order and precedence ------------------------------
  const asserted = [{ tag: tag(...bothPlur), form: "ASSERTED" }];
  const one = mergeParadigms([{ id: "p", tables: [table] }], {
    lemma: "stem",
    forms: asserted,
  });
  check(
    "the entry's own forms come first, in its own order",
    one.forms[0]?.form === "ASSERTED" && one.forms[0]?.from === undefined,
  );
  check(
    "a generated form the entry did not assert is added",
    one.forms.some((f) => f.form === "stem-fs" && f.from === "p"),
  );
  check(
    "and a generated form at an asserted address is dropped",
    !one.forms.some((f) => f.form === "stem-p") && one.forms.length === 3,
    one.forms.map((f) => f.form).join(", "),
  );

  const missing = mergeParadigms(
    [
      {
        id: "needs",
        tables: [{ rows: [[form(fs, "-x")]] }],
        requires: [{ coords: [feat("Number", "Plur")], message: "the plural is missing" }],
      },
      { id: "plain", tables: [{ rows: [[form(ms, "-y")]] }] },
    ],
    { lemma: "stem", forms: [] },
  );
  check(
    "a paradigm missing a required base form contributes nothing",
    !missing.forms.some((f) => f.from === "needs"),
  );
  check("while the others still generate", missing.forms.some((f) => f.from === "plain"));
  check(
    "and the unmet requirement names its paradigm and its message",
    missing.missing.length === 1 &&
      missing.missing[0]?.from === "needs" &&
      missing.missing[0]?.message === "the plural is missing",
  );

  // ---- placeForms over the record's own cells -----------------------------
  const addresses = paradigmCellAddresses(resolveParadigmTables(grammar, [table]));
  check("the table offers three addresses", addresses.length === 3, `${addresses.length}`);

  const single = placeForms(addresses, [{ tag: tag(...fs), form: "fs" }]);
  check(
    "a single-valued form fills exactly one cell",
    single.placed.size === 1 && single.leftover.length === 0,
  );

  const syncretic = placeForms(addresses, [
    { tag: tag(feat("Gender", "Fem,Masc"), feat("Number", "Plur")), form: "both" },
  ]);
  check(
    "a form written the way the syncretic cell is written lands in it",
    syncretic.placed.size === 1 && syncretic.leftover.length === 0,
  );
  const halfSyncretic = placeForms(addresses, [
    { tag: tag(feat("Gender", "Fem"), feat("Number", "Plur")), form: "half" },
  ]);
  check(
    "and a form for one of the genders it covers still finds it by containment",
    halfSyncretic.placed.size === 1 && halfSyncretic.leftover.length === 0,
    `${halfSyncretic.leftover.length} leftover(s)`,
  );

  const vague = placeForms(addresses, [{ tag: tag(feat("Number", "Sing")), form: "vague" }]);
  check(
    "a form carrying less than any address matches nothing",
    vague.placed.size === 0 && vague.leftover.length === 1,
  );
  const foreign = placeForms(addresses, [{ tag: tag(feat("Case", "Gen")), form: "foreign" }]);
  check("a form addressing no cell stays a leftover", foreign.leftover.length === 1);

  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures > 0) process.exitCode = 1;
}

main();
