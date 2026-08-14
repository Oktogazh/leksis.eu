// Contract for the per-language dashboard endpoint
// (GET /languages/:tag/dashboard). The dashboard aggregates what the
// database can answer without exposing entry listings: counts, the
// to-be-completed queue (todo entries are deliberately reachable — they are
// the review inbox), a recent-activity feed and a per-day activity series.
// The labels section reuses GET /languages/:tag/labels, and the "named in this
// language" review list reuses GET /languages?locale=.

import type { RelationState, RelationView } from "./relation.js";

/** The dashboard's language: the current eu.leksis.language record ref. */
export interface DashboardLanguage {
  tag: string;
  /** at:// URI of the current language record (resolved client-side). */
  recordURI: string;
  authorDID: string;
}

/** One entry of the to-be-completed queue (current version has todo=true). */
export interface DashboardTodoEntry {
  key: string;
  orthography: string[];
  indexedAt: string;
}

/**
 * One activity item: a version of an entry (or of the language record)
 * indexed by the AppView. "created" = the oldest indexed version of its
 * entry / tag, otherwise "edited". Deleted entry records leave the feed —
 * the index mirrors the network.
 */
export interface DashboardFeedItem {
  type: "entry" | "language";
  action: "created" | "edited";
  /** Present on entry items — links the item to its entry page. */
  entryKey?: string;
  /** Canonical orthography for entries; the tag for language items. */
  label: string;
  authorDID: string;
  /** When the AppView indexed the version (ISO). */
  at: string;
}

/** Aggregated versions indexed on one UTC day (sparse — countless days are omitted). */
export interface DashboardActivityDay {
  /** ISO date, e.g. "2026-07-19". */
  date: string;
  count: number;
}

/** Response shape of GET /languages/:tag/dashboard. */
export interface LanguageDashboardResponse {
  language: DashboardLanguage;
  /** Current entries in the language (count only — no listing). */
  entriesCount: number;
  /** Current entries flagged todo, and the capped queue itself. */
  todoCount: number;
  todoEntries: DashboardTodoEntry[];
  /**
   * Versions indexed in the last 24 hours, padded to at least the ten most
   * recent so quiet languages still show life, newest first.
   */
  feed: DashboardFeedItem[];
  /** Per-day version counts over the last year, oldest first. */
  activity: DashboardActivityDay[];
  /**
   * Current relations with a side in this language, by lifecycle state. Only
   * `live` ones are in the graph; the rest are the repair worklist's size.
   */
  relationCounts: Record<RelationState, number>;
  /**
   * Senses of this language's current entries that no live equivalence
   * assertion reaches — what is left to translate. Antonyms do not count: an
   * antonym is not a translation.
   */
  untranslatedSenses: number;
  /**
   * The parked queue, capped. A parked relation lists on **both** sides'
   * languages, since either side's editor may be the one who can repair it;
   * `sides[0]` is always this language's side.
   */
  parkedRelations: RelationView[];
}
