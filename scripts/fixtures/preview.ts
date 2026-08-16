// Run the shared generator over the fixture entries exactly as the reader does,
// and print what each page will show — before anything is published.
//
// Its whole reason for existing is that the manifest's `expect` lines are
// assertions a later session will trust. Writing them from the rules by eye and
// publishing on that basis is how a fixture set starts lying; this closes the
// loop by deriving them from the same functions the browser calls.
//
//   npx tsx scripts/fixtures/preview.ts

import {

  formatTagVerbatim,

  inherentAtomKeys,
  layoutView,
  mergeParadigms,
  tagAtomKeys,
  type Grammar,
  type Tag,
} from "@leksis/types";
import { entryFixtures } from "./entries.ts";
import { languageFixtures } from "./languages.ts";
import { paradigmFixtures } from "./paradigms.ts";

const grammars = new Map<string, Grammar>(
  languageFixtures.map((fixture) => [fixture.record.tag, fixture.record.grammar ?? {}]),
);

for (const fixture of entryFixtures) {
  const versions = [...(fixture.versions ?? []), fixture.record];
  const record = versions[versions.length - 1]!;
  const grammar = grammars.get(record.languageID) ?? {};

  // The same containment test the AppView's expansion job and (since this
  // slice) the reader both run.
  const held = new Set(inherentAtomKeys(grammar.inherent ?? [], record.categories));
  const reaching = paradigmFixtures.filter(
    (paradigm) =>
      paradigm.record.languageID === record.languageID &&
      tagAtomKeys(paradigm.record.selector).every((atom) => held.has(atom)),
  );
  // Most specific selector first, which is the precedence the endpoint serves.
  reaching.sort(
    (a, b) => tagAtomKeys(b.record.selector).length - tagAtomKeys(a.record.selector).length,
  );

  const merged = mergeParadigms(
    reaching.map((paradigm) => ({
      id: paradigm.handle,
      rules: paradigm.record.rules,
      requires: paradigm.record.requires,
    })),
    { lemma: record.orthography[0]!, forms: record.otherForms ?? [] },
  );

  console.log(`\n=== ${fixture.handle}  ${record.orthography[0]}  (${record.languageID}) ===`);
  console.log(`    paradigms reaching it: ${reaching.map((p) => p.handle).join(", ") || "none"}`);
  for (const row of merged.missing) {
    console.log(`    MISSING ${row.address} — "${row.message.slice(0, 60)}…"`);
  }

  const display = merged.forms.map((form, id) => ({
    tag: form.tag,
    form: form.form,
    generated: form.from !== undefined,
    id,
  }));
  if (display.length === 0) {
    console.log("    (no forms at all — the reader draws nothing)");
    continue;
  }

  const view = layoutView(grammar, record.categories, display);
  if (view.blocks.length === 0 || !view.filled) {
    console.log("    FLAT LIST (no layout, or nothing filled a block):");
    for (const item of display) {
      console.log(`      ${item.generated ? "gen" : "own"}  ${formatTagVerbatim(item.tag)} = ${item.form}`);
    }
    continue;
  }

  view.blocks.forEach((block, index) => {
    const caption =
      block.caption.length === 0
        ? ""
        : ` [caption ${block.caption.length} chip(s): ${block.caption
            .map((part) => part.label?.long ?? part.verbatim ?? "?")
            .join(" + ")}]`;
    const summary = block.summary ? " (summary)" : "";
    const geometry =
      block.kind === "table"
        ? ` rows=${block.rowAxes.map((a) => a.feature.feature).join("/")} cols=${block.columnAxes
            .map((a) => a.feature.feature)
            .join("/")}`
        : "";
    console.log(`    block ${index} ${block.kind}${caption}${summary}${geometry}`);
    // A table's `cells` is line × column with `undefined` where the paradigm
    // has no such cell — which is exactly the excluded state, and the one a
    // reader must never confuse with "nobody filled it in".
    if (block.kind === "table") {
      block.cells.forEach((line, row) => {
        line.forEach((cell, column) => {
          if (cell === undefined) {
            console.log(`      —    [${row},${column}] EXCLUDED`);
            return;
          }
          report(cell);
        });
      });
      return;
    }
    for (const item of block.items) report(item);
  });
  for (const leftover of view.leftover) {
    console.log(`    leftover: ${formatTagVerbatim(leftover.tag)} = ${leftover.form}`);
  }

  function report(address: { tag: Tag; key: string }): void {
    const held = view.placed.get(address.key) ?? [];
    const printed = formatTagVerbatim(address.tag);
    if (held.length === 0) {
      console.log(`      ·    ${printed}   empty`);
      return;
    }
    for (const item of held) {
      console.log(`      ${item.generated ? "gen" : "own"}  ${printed} = ${item.form}`);
    }
  }
}
