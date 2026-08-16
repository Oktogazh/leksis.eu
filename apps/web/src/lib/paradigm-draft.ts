import {
  LEKSIS_PARADIGM_COLLECTION,
  PARADIGM_LIMITS,
  type GrammarReference,
  type LayoutCoord,
  type LeksisParadigmRecord,
  type ParadigmRule,
  type ParadigmRequirement,
  type Tag,
} from "@leksis/types";

// The rule editor's working copy, and the pure functions that move it.
//
// `grammar-draft.ts` at one layer up: the dialog holds a draft and calls these,
// so what an edit *means* is testable without a browser and the component is
// left with presentation. The difference from that file is what the draft is —
// a whole record rather than a sub-object of one, because a paradigm is its own
// record (settled at layer 2: rules are large, per-class, and written at a
// different cadence than the `grammar` object).

/** The editor's shape: every optional field present, empty rather than absent. */
export interface ParadigmDraft {
  /**
   * The category these rules fill cells for. **Carried, never edited** — the
   * record key hashes it, so changing it is publishing a different paradigm
   * (§1.2), exactly as a source's `languages[0]` is immutable.
   */
  selector: Tag;
  label: { long: string; short: string };
  requires: ParadigmRequirement[];
  rules: ParadigmRule[];
  notes: string[];
  references: GrammarReference[];
}

export function emptyDraft(selector: Tag): ParadigmDraft {
  return { selector, label: { long: "", short: "" }, requires: [], rules: [], notes: [], references: [] };
}

export function fromRecord(record: LeksisParadigmRecord): ParadigmDraft {
  return {
    selector: record.selector,
    label: { long: record.label?.long ?? "", short: record.label?.short ?? "" },
    requires: (record.requires ?? []).map((row) => ({ ...row, coords: [...row.coords] })),
    rules: (record.rules ?? []).map((row) => ({ ...row, coords: [...row.coords] })),
    notes: [...(record.notes ?? [])],
    references: (record.references ?? []).map((row) => ({ ...row })),
  };
}

/** Drop a field that is blank rather than writing an empty string into a record. */
function some(value: string | undefined): string | undefined {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * The record as it goes to the PDS.
 *
 * Every empty optional is **omitted**, not written blank. The record is what
 * ingest validates and what every reader resolves from a stranger's PDS; a
 * `strip: ""` there is a field that means nothing and that every consumer has to
 * decide about.
 */
export function toRecord(
  draft: ParadigmDraft,
  { languageID, createdAt, subject }: { languageID: string; createdAt: string; subject?: string },
): LeksisParadigmRecord {
  const long = draft.label.long.trim();
  const short = some(draft.label.short);
  const requires = draft.requires
    .filter((row) => row.coords.length > 0)
    .map((row) => ({ coords: row.coords, message: row.message.trim() }));
  const rules = draft.rules.map((row) => {
    const prefixStrip = some(row.prefix?.strip);
    const prefixAdd = some(row.prefix?.add);
    const prefix = prefixStrip === undefined && prefixAdd === undefined ? undefined : {
      ...(prefixStrip !== undefined ? { strip: prefixStrip } : {}),
      ...(prefixAdd !== undefined ? { add: prefixAdd } : {}),
    };
    return {
      coords: row.coords,
      ...(row.base !== undefined && row.base.length > 0 ? { base: row.base } : {}),
      ...(some(row.match) !== undefined ? { match: row.match!.trim() } : {}),
      ...(some(row.strip) !== undefined ? { strip: row.strip!.trim() } : {}),
      ...(some(row.add) !== undefined ? { add: row.add!.trim() } : {}),
      ...(prefix !== undefined ? { prefix } : {}),
    };
  });
  const notes = draft.notes.map((note) => note.trim()).filter((note) => note !== "");
  const references = draft.references
    .filter((row) => row.text.trim() !== "")
    .map((row) => {
      const url = some(row.url);
      return { text: row.text.trim(), ...(url !== undefined ? { url } : {}) };
    });

  return {
    $type: LEKSIS_PARADIGM_COLLECTION,
    languageID: languageID.toLowerCase(),
    selector: draft.selector,
    ...(long !== "" ? { label: { long, ...(short !== undefined ? { short } : {}) } } : {}),
    ...(requires.length > 0 ? { requires } : {}),
    rules,
    ...(notes.length > 0 ? { notes } : {}),
    ...(references.length > 0 ? { references } : {}),
    ...(subject !== undefined ? { subject } : {}),
    createdAt,
  };
}

/** Whether another row of this kind may be added at all — the cap as navigation. */
export function canAddRule(draft: ParadigmDraft): boolean {
  return draft.rules.length < PARADIGM_LIMITS.rules;
}

export function canAddRequirement(draft: ParadigmDraft): boolean {
  return draft.requires.length < PARADIGM_LIMITS.requires;
}

export function addRule(draft: ParadigmDraft, coords: LayoutCoord[]): ParadigmDraft {
  if (!canAddRule(draft)) return draft;
  return { ...draft, rules: [...draft.rules, { coords }] };
}

export function updateRule(
  draft: ParadigmDraft,
  index: number,
  patch: Partial<ParadigmRule>,
): ParadigmDraft {
  return {
    ...draft,
    rules: draft.rules.map((row, i) => (i === index ? { ...row, ...patch } : row)),
  };
}

export function removeRule(draft: ParadigmDraft, index: number): ParadigmDraft {
  return { ...draft, rules: draft.rules.filter((_, i) => i !== index) };
}

/**
 * Move a rule through the list.
 *
 * Order **is** the semantics here, not presentation: the first row whose `match`
 * the base satisfies wins the cell, which is how `-y → -ies` sits in front of
 * the plain `-s`. So this is the one control in the editor that changes what the
 * rules generate without changing a single character of any row.
 */
export function moveRule(draft: ParadigmDraft, index: number, by: -1 | 1): ParadigmDraft {
  const target = index + by;
  if (target < 0 || target >= draft.rules.length) return draft;
  const rules = [...draft.rules];
  const [row] = rules.splice(index, 1);
  rules.splice(target, 0, row!);
  return { ...draft, rules };
}

export function addRequirement(draft: ParadigmDraft, coords: LayoutCoord[]): ParadigmDraft {
  if (!canAddRequirement(draft)) return draft;
  return { ...draft, requires: [...draft.requires, { coords, message: "" }] };
}

export function updateRequirement(
  draft: ParadigmDraft,
  index: number,
  patch: Partial<ParadigmRequirement>,
): ParadigmDraft {
  return {
    ...draft,
    requires: draft.requires.map((row, i) => (i === index ? { ...row, ...patch } : row)),
  };
}

export function removeRequirement(draft: ParadigmDraft, index: number): ParadigmDraft {
  return { ...draft, requires: draft.requires.filter((_, i) => i !== index) };
}

export function addNote(draft: ParadigmDraft): ParadigmDraft {
  if (draft.notes.length >= PARADIGM_LIMITS.notes) return draft;
  return { ...draft, notes: [...draft.notes, ""] };
}

export function updateNote(draft: ParadigmDraft, index: number, text: string): ParadigmDraft {
  return { ...draft, notes: draft.notes.map((note, i) => (i === index ? text : note)) };
}

export function removeNote(draft: ParadigmDraft, index: number): ParadigmDraft {
  return { ...draft, notes: draft.notes.filter((_, i) => i !== index) };
}

export function addReference(draft: ParadigmDraft): ParadigmDraft {
  if (draft.references.length >= PARADIGM_LIMITS.references) return draft;
  return { ...draft, references: [...draft.references, { text: "" }] };
}

export function updateReference(
  draft: ParadigmDraft,
  index: number,
  patch: Partial<GrammarReference>,
): ParadigmDraft {
  return {
    ...draft,
    references: draft.references.map((row, i) => (i === index ? { ...row, ...patch } : row)),
  };
}

export function removeReference(draft: ParadigmDraft, index: number): ParadigmDraft {
  return { ...draft, references: draft.references.filter((_, i) => i !== index) };
}
