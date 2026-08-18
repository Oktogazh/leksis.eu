// The language dashboard's label shelf: a language's declared front matter,
// arranged the way the binding editor arranges it, with each row's usage joined
// in.
//
// **The declaration is the structure; the entries supply only usage.** That is
// ADR-0010's own asymmetry, and it is what decides where each half comes from
// here: the shelf's shape is read from the language record's `grammar` — which
// features exist, which of them this language minted, which are lexicographic
// label sets — because none of that survives into the read model, where a row
// knows only that it is *a* feature. The `labels` response then contributes what
// the record cannot know: how many entries use each row, and which rows a reader
// could not tell apart. The two meet on the canonical key they already share, so
// this needs nothing added to the API.
//
// A row the read model holds and the record does not explain is left out. It can
// only be an unnamed tag in use — the naming worklist, which the dashboard shows
// separately — or a declaration the AppView has not caught up with yet, and in
// that second case the record is the newer truth.

import {
  abbreviationKey,
  posTag,
  tagKey,
  valueTag,
  type Grammar,
  type GrammarFeature,
  type GrammarLabel,
  type LabelRef,
  type LabelView,
  type Tag,
} from "@leksis/types";
import {
  abbreviationRows,
  classRows,
  combinationRows,
  grammaticalFeatureRows,
  lexicalRows,
  posRows,
  valueRows,
} from "./grammar-draft";

/**
 * One shelf of the front matter. The five that hold declarations are the
 * binding editor's own doors, so a contributor finds a row where they declared
 * it; `combinations` is layer 2's, and sits between them.
 *
 * An inflection class appears under both `features` and `classes`, exactly as
 * it does in the editor — it is a minted feature and nothing more, so it is
 * genuinely both, and the alternative is a row that vanishes from where its
 * contributor last saw it.
 */
export type ShelfTabID =
  | "pos"
  | "features"
  | "classes"
  | "lexical"
  | "combinations"
  | "abbreviations";

/** One labelled row, joined to what the entries did with it. */
export interface ShelfRow {
  /** Canonical key — React's identity here, and the join's above. */
  key: string;
  short?: string;
  long: string;
  /** The tag it binds; absent on a feature name and on a plain abbreviation. */
  tag?: Tag;
  /** Current entries using it. Zero is ordinary: the count is usage, not existence. */
  count: number;
  /** Same-language rows a reader could not tell apart. */
  conflictsWith: LabelRef[];
  /**
   * The row's free-prose note, when its declaration carries one. Read off the
   * **record**, like the rest of the shelf's shape and for the same reason: a
   * note is content and the read model has never held any. Only a feature and a
   * value can have one, so the flat tabs never set it.
   */
  note?: string;
}

/** A feature and the values it declares — the shelf's second layer. */
export interface ShelfGroup {
  /** The identifier, e.g. `Gender`. */
  feature: string;
  /** The feature name's own row: what this language calls the axis header. */
  row: ShelfRow;
  /** True when this language declared the name itself rather than taking UD's. */
  minted: boolean;
  values: ShelfRow[];
  /** Usage summed over the values — a feature name is never itself on an entry. */
  uses: number;
}

/** One tab: flat rows, or features to pick from. */
export interface ShelfTab {
  id: ShelfTabID;
  /** Flat rows — parts of speech, combinations, abbreviations. */
  rows: ShelfRow[];
  /** Feature groups — features, inflection classes, lexicographic labels. */
  groups: ShelfGroup[];
  /** Rows on this tab, a group counting as its name plus its values. */
  count: number;
}

/** How a table is ordered. Both columns the dashboard offers sort both ways. */
export interface ShelfSort {
  by: "label" | "count";
  dir: "asc" | "desc";
}

/**
 * A feature name's key for the join. Not `featureKey`: the read model does not
 * serve a row's feature name, so the label pair is all the two sides share —
 * and two rows sharing it are precisely what `conflictsWith` already reports.
 */
function featureLabelKey(label: GrammarLabel): string {
  return `feat#${label.short ?? ""}#${label.long}`;
}

/** Canonical key of a served row, or none where it has no counterpart here. */
function usageKey(row: LabelView): string | null {
  if (row.tag !== undefined) return tagKey(row.tag);
  if (row.kind === "abbreviation" && row.short !== undefined) {
    return abbreviationKey({ short: row.short });
  }
  if (row.kind === "feature" && row.long !== undefined) {
    return featureLabelKey({ long: row.long, ...(row.short !== undefined ? { short: row.short } : {}) });
  }
  return null;
}

type Usage = Pick<ShelfRow, "count" | "conflictsWith">;

function usageIndex(labels: readonly LabelView[]): Map<string, Usage> {
  const index = new Map<string, Usage>();
  for (const row of labels) {
    const key = usageKey(row);
    if (key === null) continue;
    index.set(key, { count: row.count, conflictsWith: row.conflictsWith });
  }
  return index;
}

function shelfRow(
  usage: ReadonlyMap<string, Usage>,
  key: string,
  label: GrammarLabel,
  tag?: Tag,
  note?: string,
): ShelfRow {
  const found = usage.get(key);
  return {
    key,
    ...(label.short !== undefined ? { short: label.short } : {}),
    long: label.long,
    ...(tag !== undefined ? { tag } : {}),
    count: found?.count ?? 0,
    conflictsWith: found?.conflictsWith ?? [],
    ...(note !== undefined ? { note } : {}),
  };
}

function groupsOf(
  grammar: Grammar,
  usage: ReadonlyMap<string, Usage>,
  features: readonly GrammarFeature[],
): ShelfGroup[] {
  return features.map((feature) => {
    const values = valueRows(grammar, feature.feature).map((row) => {
      const tag = valueTag(row);
      return shelfRow(usage, tagKey(tag), row.label, tag, row.note);
    });
    return {
      feature: feature.feature,
      row: shelfRow(usage, featureLabelKey(feature.label), feature.label, undefined, feature.note),
      minted: feature.scheme !== undefined,
      values,
      uses: values.reduce((total, value) => total + value.count, 0),
    };
  });
}

function flatTab(id: ShelfTabID, rows: ShelfRow[]): ShelfTab {
  return { id, rows, groups: [], count: rows.length };
}

function groupTab(id: ShelfTabID, groups: ShelfGroup[]): ShelfTab {
  return {
    id,
    rows: [],
    groups,
    count: groups.reduce((total, group) => total + 1 + group.values.length, 0),
  };
}

/**
 * The whole shelf, in tab order. Tabs are returned even when empty — filtering
 * them is the caller's business, since what an empty tab should do differs
 * between reading and editing.
 */
export function labelShelf(grammar: Grammar, labels: readonly LabelView[]): ShelfTab[] {
  const usage = usageIndex(labels);
  return [
    flatTab(
      "pos",
      posRows(grammar).map((row) => {
        const tag = posTag(row);
        return shelfRow(usage, tagKey(tag), row.label, tag);
      }),
    ),
    groupTab("features", groupsOf(grammar, usage, grammaticalFeatureRows(grammar))),
    groupTab("classes", groupsOf(grammar, usage, classRows(grammar))),
    groupTab("lexical", groupsOf(grammar, usage, lexicalRows(grammar))),
    flatTab(
      "combinations",
      combinationRows(grammar).map((row) => shelfRow(usage, tagKey(row.tag), row.label, row.tag)),
    ),
    flatTab(
      "abbreviations",
      abbreviationRows(grammar).map((row) =>
        shelfRow(usage, abbreviationKey(row), { long: row.long, short: row.short }),
      ),
    ),
  ];
}

/**
 * A collator for this language's own labels. They are homolingual — written in
 * the language being described, for a reader of it — so its collation is the
 * right one, and the interface locale's is merely the one that happens to be
 * loaded. A tag `Intl` will not take (a private-use fixture, a malformed
 * record) falls back rather than throwing: a dashboard does not fail to list a
 * language's labels because that language's tag is unusual.
 */
export function labelCollator(languageTag: string): Intl.Collator {
  try {
    return new Intl.Collator(languageTag, { sensitivity: "base" });
  } catch {
    return new Intl.Collator(undefined, { sensitivity: "base" });
  }
}

/**
 * Order a table. The full form breaks a tie on usage, so equal counts — which
 * is most of a young dictionary, all of them zero — still read alphabetically
 * rather than in whatever order the record was written.
 */
export function sortShelfRows(
  rows: readonly ShelfRow[],
  sort: ShelfSort,
  collator: Intl.Collator,
): ShelfRow[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    // The tie-break is alphabetical whichever way the counts run: reversing it
    // with them would put the rows nobody uses — most of a young dictionary, all
    // of them at zero — in backwards alphabetical order.
    if (sort.by === "count") {
      return a.count === b.count
        ? collator.compare(a.long, b.long)
        : sign * (a.count - b.count);
    }
    return sign * collator.compare(a.long, b.long);
  });
}
