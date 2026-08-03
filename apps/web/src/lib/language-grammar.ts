import type { Grammar } from "@leksis/types";
import { fetchCurrentLanguageRecord } from "./api";
import { fetchLanguageRecord } from "./atproto-record";

// A language's declared grammar, for hydrating an entry with it.
//
// Two hops: the AppView serves the *pointer* to the current record, and the
// record itself comes from its author's PDS, which is the source of truth for
// content. That is the same path the entry's own content takes, and it is why
// this layer costs the API nothing.
//
// It is deliberately **not** how labels are resolved. Those come from the
// labels read model, which is indexed and cheap; only the layout needs
// the record, because a layout is content and was never indexed. If that ever
// becomes too expensive, the escape hatch is to index `grammar` into a read
// model — a decision of its own, not something to slip in here.

/**
 * One in-flight or settled fetch per language tag, for the session. A language
 * record is *hot* — many people rewrite it — so this cache can go stale, and a
 * layout that is minutes old is a price worth paying to keep a page load from
 * fetching the same record for every entry a reader opens. `forgetLanguageGrammar`
 * covers the one case where staleness would be confusing: the reader edited it.
 */
const cache = new Map<string, Promise<Grammar | undefined>>();

/**
 * The current grammar declared for a language, or `undefined` when there is
 * none, the record cannot be read, or anything at all goes wrong.
 *
 * **It never rejects.** Every caller renders a paradigm, and a paradigm has a
 * total fallback — no grammar means the flat list, which is what an entry showed
 * before this layer existed. A failure is therefore not an error to surface but
 * an absence to degrade to. Failures are not cached, so a transient one does not
 * flatten every entry for the rest of the session.
 */
export function fetchLanguageGrammar(tag: string): Promise<Grammar | undefined> {
  const cached = cache.get(tag);
  if (cached !== undefined) return cached;
  const pending = (async () => {
    const reference = await fetchCurrentLanguageRecord(tag);
    if (reference === null) return undefined;
    const record = await fetchLanguageRecord(reference.recordURI);
    return record?.grammar;
  })().catch((error: unknown) => {
    console.warn(`could not load the declared grammar of "${tag}":`, error);
    cache.delete(tag);
    return undefined;
  });
  cache.set(tag, pending);
  return pending;
}

/** Forget a cached grammar — after this reader publishes a new version of it. */
export function forgetLanguageGrammar(tag: string): void {
  cache.delete(tag);
}
