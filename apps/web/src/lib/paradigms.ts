import {
  headwordKeys,
  headwordMatchKey,
  type Grammar,
  type LeksisParadigmRecord,
  type Tag,
} from "@leksis/types";
import { fetchLanguageParadigms } from "./api";
import { fetchParadigmRecord } from "./atproto-record";

// A language's inflection rules, resolved for the reader.
//
// The same two hops `language-grammar.ts` and `source-record.ts` make, and for
// the same reason: the AppView serves the pointers, the authors' PDSs serve the
// content. Here the split has a second edge to it — the AppView *does* hold a
// copy of the rules, because its expansion job has to generate forms for search
// without an HTTP round trip per entry, and it deliberately does not serve that
// copy. What a reader is shown comes from the record, so a language's morphology
// has exactly one source of truth and the index is not it.
//
// The cost is one request per paradigm on top of the list, which is why this is
// a module-level cache rather than page state: a reader opening ten verbs of one
// language resolves its conjugations once.

/** One resolved paradigm: the pointer the AppView served, and the rules behind it. */
export interface ResolvedParadigm {
  paradigmKey: string;
  record: LeksisParadigmRecord;
}

/**
 * One in-flight or settled resolution per language, for the session.
 *
 * A paradigm is *hot* in the same way a language record is — anyone may rewrite
 * one, and one rewrite changes every entry of a category — so this can go stale,
 * and minutes-old rules are worth a page load that does not re-resolve them for
 * every entry a reader opens. `forgetParadigms` covers the case where staleness
 * would be confusing: this reader edited them.
 */
const cache = new Map<string, Promise<ResolvedParadigm[]>>();

/**
 * The current paradigms of a language, in the order the AppView served them,
 * with the ones that could not be resolved left out.
 *
 * **It never rejects, and an empty list is an ordinary answer.** Every caller
 * renders a paradigm, and a paradigm has a total fallback: no rules simply means
 * an entry shows the forms its author wrote, which is exactly what entries did
 * before this layer existed. A failure here is therefore an absence to degrade
 * to, never an error to put in front of a reader. Failures are not cached, so a
 * transient one does not flatten a language for the rest of the session.
 *
 * A paradigm whose record is missing or unreadable is dropped rather than
 * failing the language: one author's PDS being down is not a reason to withhold
 * another author's conjugation.
 */
export function fetchParadigms(tag: string): Promise<ResolvedParadigm[]> {
  const cached = cache.get(tag);
  if (cached !== undefined) return cached;

  const pending = (async (): Promise<ResolvedParadigm[]> => {
    const pointers = await fetchLanguageParadigms(tag);
    if (pointers.length === 0) return [];
    const resolved = await Promise.all(
      pointers.map(async (pointer) => {
        const record = await fetchParadigmRecord(pointer.recordURI).catch((error: unknown) => {
          console.warn(`could not read the paradigm record ${pointer.recordURI}:`, error);
          return null;
        });
        return record === null ? null : { paradigmKey: pointer.paradigmKey, record };
      }),
    );
    // `Promise.all` preserves the order the AppView sorted them in. Since
    // ADR-0019 that order carries no precedence — a selector matches exactly, so
    // at most one paradigm reaches a headword bundle — and it is kept only so a
    // list of them does not shuffle between loads.
    return resolved.filter((item): item is ResolvedParadigm => item !== null);
  })().catch((error: unknown) => {
    console.warn(`could not load the paradigms of "${tag}":`, error);
    cache.delete(tag);
    return [];
  });

  cache.set(tag, pending);
  return pending;
}

/** Forget a language's cached paradigms — after this reader publishes one. */
export function forgetParadigms(tag: string): void {
  cache.delete(tag);
}

/**
 * The paradigms that actually reach one entry.
 *
 * **A paradigm matches an entry exactly** (ADR-0019): one of the entry's
 * headword keys *is* the selector's key. It was containment until the merge —
 * the entry's inherent bundle containing the selector — and the change is not
 * cosmetic: the bundle now carries the default axis value the entry was created
 * through, so `{NOUN}` and `{NOUN, Number=Plur}` are two kinds of headword with
 * two paradigms rather than a general rule and a refinement of it.
 *
 * Without this filter a language's verb conjugation runs over its nouns, and —
 * worse than untidy — the reader shows a different set of forms from the one the
 * AppView expanded into the search index, which is the single thing one shared
 * generator exists to prevent. It uses `headwordKeys`, the same function the
 * firehose consumer computes an entry's stored `selectorKeys` with, so the two
 * sides cannot drift.
 *
 * It lives here rather than inside `EntryParadigm` because only a caller holding
 * an *entry* can answer the question.
 *
 * With no grammar loaded it yields the part of speech alone, which is the right
 * answer for a language that has declared nothing: a paradigm keyed on the bare
 * part of speech still reaches, one keyed on an inflection class does not until
 * the language says that class is something a word *is*.
 */
export function paradigmsReaching(
  grammar: Grammar | undefined,
  categories: readonly Tag[],
  paradigms: readonly ResolvedParadigm[],
): ResolvedParadigm[] {
  const held = new Set(headwordKeys(grammar ?? {}, categories));
  return paradigms.filter((paradigm) => held.has(headwordMatchKey(paradigm.record.selector)));
}
