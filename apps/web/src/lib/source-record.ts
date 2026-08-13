import type { CurrentSourceRecordResponse, LeksisSourceRecord } from "@leksis/types";
import { fetchCurrentSourceRecord } from "./api";
import { fetchSourceRecord } from "./atproto-record";

// A described work, resolved by OCLC number: the AppView serves the pointer,
// the author's PDS serves the prose. The same two hops `language-grammar.ts`
// makes, and for the same reason — the index carries what a list row needs
// (the citation forms) and the record carries the rest.
//
// This exists as a module rather than as page state because a single page can
// need one work several times over: an entry with a dozen example sentences
// quoting the same dictionary would otherwise resolve it a dozen times. That is
// slice 3's shape, and it is why the cache is keyed on the number rather than
// living in the source page.

/**
 * What a lookup found. `record: null` with a `reference` present is a real
 * state, not a failure to hide: somebody described this work, but their PDS
 * would not hand the record over (offline, migrated, withdrawn between the two
 * hops). The pointer is still true, so the caller can say so instead of
 * claiming nobody has described it.
 */
export interface ResolvedSource {
  reference: CurrentSourceRecordResponse;
  record: LeksisSourceRecord | null;
}

/** One in-flight or settled resolution per number, for the session. */
const cache = new Map<string, Promise<ResolvedSource | null>>();

/**
 * Resolve one OCLC number, or null when nobody has described it.
 *
 * **Null is the ordinary answer, and it is not an error** — citing a number no
 * record describes yet is the whole point of citing numbers. A genuine failure
 * (the AppView unreachable) *does* reject, because a caller that cannot tell
 * the two apart would tell a reader "nobody has described this work" whenever
 * the API is down, which is a false statement about other people's
 * contributions. Rejections are evicted, so a transient failure does not
 * poison the number for the rest of the session.
 *
 * The `oclc` must already be normalized (`normalizeOclc`): the number is the
 * identity, and a cache keyed on unnormalized input would hold two entries for
 * one work.
 */
export function fetchSource(oclc: string): Promise<ResolvedSource | null> {
  const cached = cache.get(oclc);
  if (cached !== undefined) return cached;

  const pending = (async (): Promise<ResolvedSource | null> => {
    const reference = await fetchCurrentSourceRecord(oclc);
    if (reference === null) return null;
    // The PDS half degrades on its own: the pointer is already worth having.
    const record = await fetchSourceRecord(reference.recordURI).catch((error: unknown) => {
      console.warn(`could not read the source record for OCLC ${oclc}:`, error);
      return null;
    });
    return { reference, record };
  })().catch((error: unknown) => {
    cache.delete(oclc);
    throw error;
  });

  cache.set(oclc, pending);
  return pending;
}

/** Forget a cached source — after this reader publishes a new version of it. */
export function forgetSource(oclc: string): void {
  cache.delete(oclc);
}
