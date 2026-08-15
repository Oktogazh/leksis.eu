import { aql } from "arangojs";
import type {
  DashboardActivityDay,
  DashboardFeedItem,
  DashboardLanguage,
  DashboardMissingFormEntry,
  DashboardTodoEntry,
  LanguageDashboardResponse,
} from "@leksis/types";
import { db } from "./db";
import { getParkedRelations, getRelationCounts, getUntranslatedSenseCount } from "./relations";

// Per-language dashboard read path. Everything here is answerable from the
// version docs alone (entries + languages): counts, the todo review queue,
// the recent-activity feed and the per-day activity series. Entry listings
// stay unexposed except for the todo queue, which is the review inbox.

/** Cap of the to-be-completed queue served in one response. */
const TODO_LIMIT = 100;
/**
 * Cap of the missing-base-forms queue. The same number as the todo queue, and
 * for the same reason: both are review inboxes a contributor works through, and
 * a hundred is already more than a sitting.
 */
const MISSING_FORMS_LIMIT = 100;
/** The feed always shows at least this many items, however old. */
const FEED_MIN = 10;
/** And never more than this many. */
const FEED_MAX = 50;
/** Activity window in days (one GitHub-style year). */
const ACTIVITY_DAYS = 365;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The dashboard of one language, or null when no current language record
 * exists for the tag.
 */
export async function getLanguageDashboard(
  tag: string,
): Promise<LanguageDashboardResponse | null> {
  const languageCursor = await db.query<DashboardLanguage>(aql`
    FOR l IN languages
      FILTER l.tag == ${tag} AND l.current == true
      LIMIT 1
      RETURN {
        tag: l.tag,
        recordURI: l.recordURI,
        authorDID: l.authorDID
      }
  `);
  const language = await languageCursor.next();
  if (!language) return null;

  // Withdrawn (deleted) entries don't count toward totals or the todo
  // queue — a deletion-marker version can still carry `todo == true` from
  // before withdrawal.
  const countsCursor = await db.query<{ entriesCount: number; todoCount: number }>(aql`
    RETURN {
      entriesCount: LENGTH(
        FOR e IN entries
          FILTER e.languageID == ${tag} AND e.current == true AND e.deleted != true
          RETURN 1
      ),
      todoCount: LENGTH(
        FOR e IN entries
          FILTER e.languageID == ${tag} AND e.current == true AND e.todo == true AND e.deleted != true
          RETURN 1
      )
    }
  `);
  const counts = (await countsCursor.next()) ?? { entriesCount: 0, todoCount: 0 };

  // The morphology worklist: entries a paradigm skipped because they have not
  // supplied a base form its rules require. Counted and listed off the same
  // filter as the todo queue and with no index of its own, for the same reason
  // that one has none — the language's current entries are already the working
  // set of every counter on this dashboard.
  //
  // The messages are the rule authors' own, deduped per entry: two paradigms
  // reaching one word often want the same principal part, and telling a
  // contributor twice that the preterite is missing is noise, not emphasis.
  const missingFormsCursor = await db.query<DashboardMissingFormEntry>(aql`
    FOR e IN entries
      FILTER e.languageID == ${tag}
        AND e.current == true
        AND e.deleted != true
        AND LENGTH(NOT_NULL(e.formIssues, [])) > 0
      SORT e.indexedAt DESC
      LIMIT ${MISSING_FORMS_LIMIT}
      RETURN {
        key: e.entryKey,
        orthography: e.orthography,
        messages: UNIQUE(e.formIssues[*].message),
        indexedAt: e.indexedAt
      }
  `);
  const missingFormEntries = await missingFormsCursor.all();
  const missingFormsCountCursor = await db.query<number>(aql`
    RETURN LENGTH(
      FOR e IN entries
        FILTER e.languageID == ${tag}
          AND e.current == true
          AND e.deleted != true
          AND LENGTH(NOT_NULL(e.formIssues, [])) > 0
        RETURN 1
    )
  `);
  const missingFormsCount = (await missingFormsCountCursor.next()) ?? 0;

  const todoCursor = await db.query<DashboardTodoEntry>(aql`
    FOR e IN entries
      FILTER e.languageID == ${tag} AND e.current == true AND e.todo == true AND e.deleted != true
      SORT e.indexedAt DESC
      LIMIT ${TODO_LIMIT}
      RETURN { key: e.entryKey, orthography: e.orthography, indexedAt: e.indexedAt }
  `);

  // Every indexed version is one activity item; "created" = the oldest
  // version of its entry (or of the tag, for the language record).
  const feedCursor = await db.query<DashboardFeedItem>(aql`
    LET entryItems = (
      FOR e IN entries
        FILTER e.languageID == ${tag}
        SORT e.indexedAt DESC
        LIMIT ${FEED_MAX}
        LET isFirst = LENGTH(
          FOR p IN entries
            FILTER p.entryKey == e.entryKey AND p.indexedAt < e.indexedAt
            LIMIT 1
            RETURN 1
        ) == 0
        RETURN {
          type: "entry",
          action: isFirst ? "created" : "edited",
          entryKey: e.entryKey,
          label: e.orthography[0],
          authorDID: e.authorDID,
          at: e.indexedAt
        }
    )
    LET languageItems = (
      FOR l IN languages
        FILTER l.tag == ${tag}
        SORT l.indexedAt DESC
        LIMIT ${FEED_MAX}
        LET isFirst = LENGTH(
          FOR p IN languages
            FILTER p.tag == l.tag AND p.indexedAt < l.indexedAt
            LIMIT 1
            RETURN 1
        ) == 0
        RETURN {
          type: "language",
          action: isFirst ? "created" : "edited",
          label: l.tag,
          authorDID: l.authorDID,
          at: l.indexedAt
        }
    )
    FOR item IN APPEND(entryItems, languageItems)
      SORT item.at DESC
      LIMIT ${FEED_MAX}
      RETURN item
  `);
  const recent = await feedCursor.all();
  const windowStart = new Date(Date.now() - DAY_MS).toISOString();
  const inWindow = recent.filter((item) => item.at >= windowStart);
  const feed = inWindow.length >= FEED_MIN ? inWindow : recent.slice(0, FEED_MIN);

  const activityCutoff = new Date(Date.now() - ACTIVITY_DAYS * DAY_MS).toISOString();
  const activityCursor = await db.query<DashboardActivityDay>(aql`
    LET stamps = APPEND(
      (FOR e IN entries
        FILTER e.languageID == ${tag} AND e.indexedAt >= ${activityCutoff}
        RETURN e.indexedAt),
      (FOR l IN languages
        FILTER l.tag == ${tag} AND l.indexedAt >= ${activityCutoff}
        RETURN l.indexedAt)
    )
    FOR stamp IN stamps
      COLLECT date = LEFT(stamp, 10) WITH COUNT INTO count
      SORT date ASC
      RETURN { date, count }
  `);

  return {
    language,
    entriesCount: counts.entriesCount,
    todoCount: counts.todoCount,
    todoEntries: await todoCursor.all(),
    feed,
    activity: await activityCursor.all(),
    // The semantic network's side of the dashboard: what this language has
    // translated, and the drift waiting to be repaired.
    relationCounts: await getRelationCounts(tag),
    untranslatedSenses: await getUntranslatedSenseCount(tag),
    parkedRelations: await getParkedRelations(tag),
    // The morphology arc's side: entries whose paradigm could not run for want
    // of a principal part. Zero when a language has no paradigms at all, which
    // is the same number and deliberately not a different message.
    missingFormsCount,
    missingFormEntries,
  };
}
