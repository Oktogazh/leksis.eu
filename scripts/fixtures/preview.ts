// Run the shared generator and the shared placement over the fixture entries
// exactly as the reader does, and print what each page will show — before
// anything is published.
//
// Its whole reason for existing is that the manifest's `expect` lines are
// assertions a later session will trust. Writing them from the rules by eye and
// publishing on that basis is how a fixture set starts lying; this closes the
// loop by deriving them from the same functions the browser calls.
//
//   npx tsx scripts/fixtures/preview.ts

import {
  formatTagVerbatim,
  headwordKeys,
  headwordMatchKey,
  mergeParadigms,
  paradigmCellAddresses,
  placeForms,
  resolveParadigmTables,
  type Grammar,
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

  // Exactly the test the AppView's expansion job runs (ADR-0019): the entry's
  // headword keys against the paradigm's selectors, by equality.
  const keys = new Set(headwordKeys(grammar, record.categories));
  const reaching = paradigmFixtures.filter(
    (paradigm) =>
      paradigm.record.languageID === record.languageID &&
      paradigm.record.selectors.some((selector) => keys.has(headwordMatchKey(selector))),
  );

  const merged = mergeParadigms(
    reaching.map((paradigm) => ({
      id: paradigm.handle,
      tables: paradigm.record.tables,
      requires: paradigm.record.requires,
    })),
    { lemma: record.orthography[0]!, forms: record.otherForms ?? [] },
  );

  console.log(`\n=== ${fixture.handle}  ${record.orthography[0]}  (${record.languageID}) ===`);
  console.log(`    headword keys:  ${[...keys].join("  ·  ") || "none"}`);
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

  // The reader's own ladder: the stored tables of every reaching paradigm,
  // re-qualified against the language, then the entry's forms placed in them.
  const tables = reaching.flatMap((paradigm) =>
    resolveParadigmTables(grammar, paradigm.record.tables),
  );
  if (tables.length === 0) {
    if (display.length === 0) {
      console.log("    (no tables and no forms — the reader draws nothing)");
      continue;
    }
    console.log("    FLAT LIST (no paradigm reaches it):");
    for (const item of display) {
      console.log(`      ${item.generated ? "gen" : "own"}  ${formatTagVerbatim(item.tag)} = ${item.form}`);
    }
    continue;
  }

  /** Paradigms that contributed nothing because a principal part was missing. */
  const skipped = new Set(merged.missing.map((row) => row.from));
  const { placed, leftover } = placeForms(paradigmCellAddresses(tables), display);
  tables.forEach((table, index) => {
    const from = reaching[index >= reaching.length ? reaching.length - 1 : 0];
    const note = from !== undefined && skipped.has(from.handle) ? "  (paradigm SKIPPED — a required base form is missing, so no cell generates)" : "";
    console.log(`    table ${index}${table.name === undefined ? "" : ` "${table.name}"`}  ${table.width}×${table.height}${note}`);
    table.rows.forEach((line, row) => {
      const drawn = line.map((cell) => {
        const size = cell.rowSpan > 1 || cell.colSpan > 1 ? `⟨${cell.rowSpan}×${cell.colSpan}⟩` : "";
        if (cell.kind === "title") return `[T ${cell.text}]${size}`;
        if (cell.kind === "empty") return `[— filler]${size}`;
        const held = placed.get(cell.address.key) ?? [];
        const address = formatTagVerbatim(cell.address.tag);
        if (held.length > 0) {
          return `[${held.map((h) => `${h.generated ? "gen" : "own"} ${h.form}`).join(" / ")} @ ${address}]${size}`;
        }
        return `[${cell.rules.length === 0 ? "manual-only" : "rule declined"} @ ${address}]${size}`;
      });
      console.log(`      row ${row}: ${drawn.join(" ")}`);
    });
  });
  for (const item of leftover) {
    console.log(`    leftover: ${item.generated ? "gen" : "own"}  ${formatTagVerbatim(item.tag)} = ${item.form}`);
  }
}
