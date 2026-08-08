import type { Agent } from "@atproto/api";
import { LEKSIS_PROFILE_COLLECTION, type DashboardActivityDay } from "@leksis/types";
import { resolvePds } from "./atproto-record";

// Everything a contributor has published to Leksis, read from their own repo.
//
// **The AppView is not in this path.** The index knows what it needs for its
// read surfaces (search, dashboards) and deliberately not who wrote what over
// time; the repo, on the other hand, *is* the record of that, and it is public.
// So a contributor's activity is listed by asking their PDS directly:
// describeRepo for the collections they actually have, then listRecords through
// each. The consequence worth keeping in mind — a record shows up here the
// instant it is written, with no firehose latency, and it disappears the
// instant it is deleted, whatever the index still believes.

/** Every Leksis lexicon shares this NSID prefix — which is how they are found. */
const LEKSIS_NSID_PREFIX = "eu.leksis.";

const PAGE_SIZE = 100;
/**
 * Pages per collection. A human contributor is nowhere near this; a bot repo
 * blows straight through it, which is why `truncated` exists rather than a
 * silent stop — a half-drawn year of activity that claims to be a whole one is
 * worse than one that says it is partial.
 */
const MAX_PAGES = 20;

export interface RepoRecord {
  uri: string;
  cid: string;
  /** NSID of the collection this record lives in, e.g. "eu.leksis.entry". */
  collection: string;
  rkey: string;
  value: Record<string, unknown>;
  /**
   * The record's own `createdAt`, ISO — every eu.leksis.* lexicon declares one,
   * and a full-rewrite version restates it, so it reads as "when this version
   * was written". Null when absent or unparseable; such a record still lists,
   * it just cannot be placed on a day.
   */
  createdAt: string | null;
}

export interface RepoRecords {
  /** Newest first, across all collections. */
  records: RepoRecord[];
  /** The eu.leksis.* collections the repo actually has. */
  collections: string[];
  /** True when MAX_PAGES stopped a listing: what is here is not all there is. */
  truncated: boolean;
}

interface ListRecordsResponse {
  cursor?: string;
  records?: { uri: string; cid: string; value: unknown }[];
}

interface DescribeRepoResponse {
  collections?: string[];
}

/** The rkey is the last at:// segment; "" when the URI is malformed. */
function rkeyOf(uri: string): string {
  return uri.slice(uri.lastIndexOf("/") + 1);
}

/** An ISO timestamp the browser can actually place on a calendar, or null. */
function timestamp(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  return Number.isNaN(new Date(value).getTime()) ? null : value;
}

/** Page through one collection, newest first. */
async function listCollection(
  pds: string,
  did: string,
  collection: string,
): Promise<{ records: RepoRecord[]; truncated: boolean }> {
  const records: RepoRecord[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({ repo: did, collection, limit: String(PAGE_SIZE) });
    if (cursor !== undefined) params.set("cursor", cursor);
    const res = await fetch(`${pds}/xrpc/com.atproto.repo.listRecords?${params.toString()}`);
    if (!res.ok) throw new Error(`listRecords ${collection} failed: ${res.status}`);
    const body = (await res.json()) as ListRecordsResponse;
    const page_ = body.records ?? [];

    for (const record of page_) {
      const value = (
        typeof record.value === "object" && record.value !== null ? record.value : {}
      ) as Record<string, unknown>;
      records.push({
        uri: record.uri,
        cid: record.cid,
        collection,
        rkey: rkeyOf(record.uri),
        value,
        createdAt: timestamp(value.createdAt),
      });
    }

    // A PDS hands back a cursor even on the last page, so following it blindly
    // costs one empty round trip per collection; a short page is the end.
    cursor = body.cursor;
    if (cursor === undefined || page_.length < PAGE_SIZE) {
      return { records, truncated: false };
    }
  }
  return { records, truncated: true };
}

/**
 * Every eu.leksis.* record in one repo, newest first. Throws when the repo
 * cannot be reached at all; a single collection failing takes the whole listing
 * with it, because a page that silently omitted someone's entries would read as
 * "they wrote none".
 */
export async function listLeksisRecords(did: string): Promise<RepoRecords> {
  const pds = await resolvePds(did);

  // Discovered, not hardcoded: the lexicon family is designed to keep growing,
  // and a page listing "everything you published" should not need editing each
  // time it does.
  const describeParams = new URLSearchParams({ repo: did });
  const describe = await fetch(
    `${pds}/xrpc/com.atproto.repo.describeRepo?${describeParams.toString()}`,
  );
  if (!describe.ok) throw new Error(`describeRepo failed: ${describe.status}`);
  const collections = ((await describe.json()) as DescribeRepoResponse).collections ?? [];
  const leksis = collections.filter((nsid) => nsid.startsWith(LEKSIS_NSID_PREFIX));

  const pages = await Promise.all(leksis.map((nsid) => listCollection(pds, did, nsid)));

  // Sorted by the record's own timestamp rather than by rkey: rkeys are TIDs
  // for entries and relations, but a language record is keyed by its tag and
  // the profile by the literal "self", so rkey order is only chronological
  // within some collections and meaningless across them.
  const records = pages
    .flatMap((page) => page.records)
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

  return {
    records,
    collections: leksis,
    truncated: pages.some((page) => page.truncated),
  };
}

/**
 * Per-day counts for the activity grid, in the same shape the language
 * dashboard's endpoint returns — which is what lets one grid component render
 * an indexed series and this un-indexed one without knowing the difference.
 *
 * Bucketed by UTC day, like the AppView's own aggregation, so a contributor's
 * grid and a language's grid line up on the same calendar. Records with no
 * usable timestamp are left out of the series (they have no day) while staying
 * in the listing.
 */
export function activityFromRecords(records: RepoRecord[]): DashboardActivityDay[] {
  const byDate = new Map<string, number>();
  for (const record of records) {
    if (record.createdAt === null) continue;
    const date = new Date(record.createdAt).toISOString().slice(0, 10);
    byDate.set(date, (byDate.get(date) ?? 0) + 1);
  }
  return [...byDate.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ── Deletion ────────────────────────────────────────────────────────────────
//
// **This is a real delete, and the only one in the app.** Everywhere else a
// record is "removed" by publishing another one — an entry is withdrawn with a
// `deleted: true` version carrying a reason, which keeps the entry resolvable
// and contestable (DeleteEntryDialog). Here the record ceases to exist on the
// PDS, the firehose emits a delete, and the AppView drops it: an `entries`
// version is removed outright and the previous one promoted back to current,
// while a `languages` version is archived (the current language record, with
// its names and its whole grammar declaration, stops being served).
//
// So these two acts must never be presented as the same thing. Withdrawing an
// entry says "the dictionary should not have this"; deleting a record says
// "I withdraw *my* contribution" — and only the author can do the second.

/** Writes per applyWrites call. Well under any PDS's cap, and small enough that a failure loses little. */
const DELETE_BATCH = 50;

export interface DeleteProgress {
  /** Records deleted so far. */
  done: number;
  total: number;
}

/**
 * Delete records from the signed-in user's own repo, oldest batch first, with
 * progress. Returns the URIs that were deleted — which on a partial failure is
 * fewer than asked for, so the caller can re-list rather than assume.
 *
 * Batched through applyWrites so a hundred records are a couple of requests
 * rather than a hundred; a batch that throws stops the run, because continuing
 * past a rate limit or a revoked token would just produce a longer failure.
 */
export async function deleteRecords(
  agent: Agent,
  did: string,
  records: readonly RepoRecord[],
  onProgress?: (progress: DeleteProgress) => void,
): Promise<string[]> {
  const deleted: string[] = [];
  for (let i = 0; i < records.length; i += DELETE_BATCH) {
    const batch = records.slice(i, i + DELETE_BATCH);
    await agent.com.atproto.repo.applyWrites({
      repo: did,
      writes: batch.map((record) => ({
        $type: "com.atproto.repo.applyWrites#delete",
        collection: record.collection,
        rkey: record.rkey,
      })),
    });
    deleted.push(...batch.map((record) => record.uri));
    onProgress?.({ done: deleted.length, total: records.length });
  }
  return deleted;
}

/**
 * What "delete everything" means: every eu.leksis.* record **except the
 * profile**. The profile is preferences, not a contribution — deleting it
 * would drop the user back into onboarding as a side effect of withdrawing
 * their dictionary work, which is a different decision and theirs to make
 * separately.
 */
export function deletableRecords(records: readonly RepoRecord[]): RepoRecord[] {
  return records.filter((record) => record.collection !== LEKSIS_PROFILE_COLLECTION);
}
