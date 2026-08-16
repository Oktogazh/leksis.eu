// Validate every fixture record against the SAME validators the AppView runs
// before anything is published.
//
// This exists because publishing is not reversible in the way a code change is:
// a language version archives forever, and a `qtl` version whose grammar is
// incoherent is refused at ingest and leaves the language silently on its
// previous version. So the run is gated on the real functions from
// `@leksis/types` rather than on care.

import {
  grammarIssues,
  isValidGrammar,
  isValidParadigmRecord,
  isValidTag,
  normalizeOclc,
  paradigmIssues,
  paradigmRkey,
  validateDefinitions,
  validateSource,
  type GrammarIssue,
} from "@leksis/types";
import { languageFixtures } from "./languages.ts";
import { sourceFixtures } from "./sources.ts";
import { entryFixtures } from "./entries.ts";
import { paradigmFixtures } from "./paradigms.ts";

export interface CheckResult {
  failures: string[];
  notes: string[];
}

/** Every kind `grammarIssues` can report — what `qto`'s rewrite must hit. */
const ALL_ISSUE_KINDS: GrammarIssue["kind"][] = [
  "unbound-feature",
  "duplicate",
  "unbound-atom",
  "ungrounded-combination",
  "single-item-binding",
  "inherent-axis-conflict",
  "empty-axis",
  "layout-unknown-axis",
  "layout-repeated-axis",
  "layout-foreign-coordinate",
  "empty-layout-block",
  "layout-too-large",
  "lexicographic-in-grammar",
  "duplicate-abbreviation",
];

export function checkFixtures(): CheckResult {
  const failures: string[] = [];
  const notes: string[] = [];

  // --- languages ---------------------------------------------------------
  for (const fixture of languageFixtures) {
    const { tag, grammar } = fixture.record;
    if (grammar !== undefined) {
      if (!isValidGrammar(grammar)) failures.push(`${tag}: grammar fails isValidGrammar`);
      const issues = grammarIssues(grammar);
      if (issues.length > 0) {
        failures.push(
          `${tag}: the version meant to INDEX has ${issues.length} defect(s): ${issues
            .map((i) => `${i.kind}(${i.key})`)
            .join(", ")}`,
        );
      }
    }
    if (!fixture.record.translations.some((t) => t.languageID === tag)) {
      failures.push(`${tag}: no endonym`);
    }

    if (fixture.rewrite?.grammar !== undefined) {
      // The rewrite must be well-FORMED (so it reaches the coherence gate at
      // all, rather than being dropped as shape) and INCOHERENT in every kind.
      if (!isValidGrammar(fixture.rewrite.grammar)) {
        failures.push(`${tag}: the defective rewrite fails isValidGrammar — it must fail the COHERENCE gate, not the shape one`);
      }
      const kinds = new Set(grammarIssues(fixture.rewrite.grammar).map((i) => i.kind));
      const absent = ALL_ISSUE_KINDS.filter((kind) => !kinds.has(kind));
      if (absent.length > 0) failures.push(`${tag}: rewrite never triggers ${absent.join(", ")}`);
      else notes.push(`${tag}: the rewrite triggers all ${ALL_ISSUE_KINDS.length} issue kinds`);
    }
  }

  // --- sources -----------------------------------------------------------
  for (const fixture of sourceFixtures) {
    const verdict = validateSource(fixture.record);
    if (verdict !== "ok") failures.push(`source ${fixture.record.oclc}: ${verdict}`);
    const normalized = normalizeOclc(fixture.record.oclc);
    if (normalized !== fixture.record.oclc) {
      failures.push(`source ${fixture.record.oclc}: not in normal form (the record key must be exact)`);
    }
    if (fixture.record.oclc.length !== 16) {
      failures.push(`source ${fixture.record.oclc}: fixture numbers must be 16 digits (the quarantine)`);
    }
  }

  // --- entries -----------------------------------------------------------
  const handles = new Set<string>();
  let entryCount = 0;
  for (const fixture of entryFixtures) {
    const versions = [fixture.record, ...(fixture.versions ?? [])];
    entryCount += 1;
    if (handles.has(fixture.handle)) failures.push(`entry ${fixture.handle}: duplicate handle`);
    handles.add(fixture.handle);

    for (const [index, record] of versions.entries()) {
      const where = `entry ${fixture.handle} v${index + 1}`;
      if (!record.orthography.includes(fixture.handle)) {
        failures.push(`${where}: the handle is not among its orthographies — search could not find it`);
      }
      if (record.orthography.length === 0 || record.orthography[0] === "") {
        failures.push(`${where}: no canonical orthography`);
      }
      const verdict = validateDefinitions(record.definitions);
      if (verdict !== "ok") failures.push(`${where}: definitions ${verdict}`);
      for (const tag of record.categories) {
        if (!isValidTag(tag)) failures.push(`${where}: malformed category`);
      }
      for (const form of record.otherForms ?? []) {
        if (!isValidTag(form.tag)) failures.push(`${where}: malformed otherForms tag`);
        if (form.form === "") failures.push(`${where}: empty otherForms spelling`);
      }
      for (const definition of record.definitions) {
        for (const example of definition.examples ?? []) {
          const oclc = example.source?.oclc;
          if (oclc !== undefined && normalizeOclc(oclc) !== oclc) {
            failures.push(`${where}: example cites a non-normalized OCLC number ${oclc}`);
          }
        }
      }
      if (record.deleted === true && (record.deletionReason ?? "") === "") {
        failures.push(`${where}: deleted without a reason`);
      }
    }
  }
  if (entryCount > 40) failures.push(`${entryCount} entries — the ceiling is 40`);
  notes.push(`${entryCount} entries (ceiling 40)`);

  // --- paradigms ---------------------------------------------------------
  const rkeys = new Set<string>();
  for (const fixture of paradigmFixtures) {
    const record = { $type: "eu.leksis.paradigm" as const, ...fixture.record, createdAt: new Date().toISOString() };
    if (!isValidParadigmRecord(record)) failures.push(`paradigm ${fixture.handle}: fails isValidParadigmRecord`);
    const issues = paradigmIssues(fixture.record);
    if (issues.length > 0) {
      failures.push(
        `paradigm ${fixture.handle}: ${issues.map((i) => `${i.kind}(${i.key})`).join(", ")}`,
      );
    }
    const rkey = paradigmRkey(fixture.record);
    if (rkeys.has(rkey)) {
      failures.push(`paradigm ${fixture.handle}: rkey ${rkey} collides — two paradigms cannot share a selector`);
    }
    rkeys.add(rkey);
  }

  return { failures, notes };
}
