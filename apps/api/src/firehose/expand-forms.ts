import { aql, type Database } from "arangojs";
import { mergeParadigms } from "@leksis/types";
import type { IndexedForm } from "./ingest-entry";
import type { ParadigmDoc } from "./ingest-paradigm";

// Ingest-time form generation — the morphology arc's layer 5 running inside the
// AppView.
//
// Every inflected form the index holds is either **asserted** (a row of the
// entry record's own `otherForms`, written by ingest-entry) or **generated**
// (produced here by running a paradigm's rules over the entry's lemma). Both
// feed search, which is the whole reason this runs at ingest rather than in the
// reader's browser: Hunspell-shaped affix rules are not cheaply invertible, so
// finding an entry by one of its inflected forms means the forms have to be in
// the index before anyone searches for them. That cost was accepted at layer 3
// and is paid here — one rule edit re-expands the slice of a language its
// selector reaches.
//
// Three properties this module must keep:
//
// **It never touches a record** (morphology invariant 5). It rewrites two
// derived fields of an entry doc — the generated half of `otherForms`, and
// `formIssues` — and nothing else. What an author asserted is read-only to it.
//
// **It never declares usage to the labels model.** A generated form's cell
// address comes from a paradigm's coordinates, which select from what the
// language has already declared; counting it as usage would put a language's
// own declarations on its own worklist, multiplied by every entry.
//
// **It shares one generator with the reader and the exporters**
// (invariant 6): `generateForms` in packages/types. What search indexes and
// what an entry page draws cannot disagree, because they are the same function.

/**
 * Entries reshaped per round trip. A paradigm transition can reach every entry
 * of a language, so the pass is chunked rather than read whole — this runs
 * inside the firehose consumer, which must stay responsive to the next event.
 */
const EXPAND_BATCH = 500;

/**
 * A base form a paradigm needs and an entry has not supplied, recorded on the
 * entry doc so the language dashboard can list the entries a contributor needs
 * to complete.
 *
 * Derived and DB-only: no record is marked, and no reader-facing page shows it.
 * A dictionary reader has no use for the news that a table is empty because a
 * principal part is missing — that is a note between contributors, and it is
 * written in the rule author's own language precisely so the queue needs no
 * translation layer.
 */
export interface EntryFormIssue {
  paradigmKey: string;
  /** Canonical key of the required cell address (`coordsMatchKey`). */
  requiresKey: string;
  /** The rule author's own words, copied verbatim — shown as-is. */
  message: string;
}

/** What generation needs to know about one entry doc, and where to write back. */
interface ExpandableEntry {
  docKey: string;
  entryKey: string;
  languageID: string;
  orthography: string[];
  otherForms: IndexedForm[];
  inherentAtoms: string[];
}

/** The projection above, as AQL — one definition, so the queries cannot drift. */
const ENTRY_FACTS = aql`{
  docKey: e._key,
  entryKey: e.entryKey,
  languageID: e.languageID,
  orthography: NOT_NULL(e.orthography, []),
  otherForms: NOT_NULL(e.otherForms, []),
  inherentAtoms: NOT_NULL(e.inherentAtoms, [])
}`;

/**
 * The current paradigms of a language, memoised for the duration of a run of
 * ingests.
 *
 * A bot importing a dictionary delivers thousands of consecutive entries in one
 * language, and each one would otherwise re-read every rule of every paradigm
 * that language has. The memo is safe because the consumer is the only writer
 * and is strictly sequential: the sole thing that can invalidate it is a
 * paradigm write, and both paths that make one call `forgetParadigms` before
 * expanding. Cleared wholesale rather than per language, because a cache that
 * is only ever emptied cannot go stale in a way anybody has to reason about.
 */
const paradigmCache = new Map<string, ParadigmDoc[]>();

/** Drop the memo. Called by every path that writes to `paradigms`. */
export function forgetParadigms(): void {
  paradigmCache.clear();
}

/**
 * Most specific selector first, then most recently indexed.
 *
 * Specificity is the atom count: a paradigm selecting `{VERB, Conjugation=2}`
 * beats one selecting `{VERB}` for the cells they both fill, which is the same
 * most-specific-first instinct `placeForms` already has when a form and a cell
 * address meet. The `indexedAt` tiebreak is v1's answer to two equally specific
 * selectors both matching (design note §7.5) — a rule of order, not of merit,
 * until voting makes it a principled one.
 */
function bySpecificity(a: ParadigmDoc, b: ParadigmDoc): number {
  if (a.selectorAtoms.length !== b.selectorAtoms.length) {
    return b.selectorAtoms.length - a.selectorAtoms.length;
  }
  return b.indexedAt.localeCompare(a.indexedAt);
}

async function currentParadigms(
  database: Database,
  languageID: string,
): Promise<ParadigmDoc[]> {
  const cached = paradigmCache.get(languageID);
  if (cached !== undefined) return cached;
  const cursor = await database.query<ParadigmDoc>(aql`
    FOR p IN paradigms
      FILTER p.languageID == ${languageID} AND p.current == true
      RETURN p
  `);
  const paradigms = (await cursor.all()).sort(bySpecificity);
  paradigmCache.set(languageID, paradigms);
  return paradigms;
}

/** What one entry's derived fields become. */
interface Expansion {
  otherForms: IndexedForm[];
  formIssues: EntryFormIssue[];
}

/**
 * Run every paradigm that reaches one entry, and return the two derived fields
 * it produces. Pure — the caller writes.
 *
 * All matching paradigms are re-run together, rather than one paradigm's rows
 * being replaced in isolation, because **precedence is a property of the set**:
 * which paradigm wins a cell cannot be decided without knowing the others that
 * fill it, so a version transition on one of them can change what another
 * contributes. The `paradigmKey` on each row is what makes the *result*
 * attributable, not what makes the computation surgical.
 *
 * A cell the entry's author asserted is **not generated over**. The reader
 * resolves that collision properly at display time (exact, then containment —
 * `placeForms`), but the index can settle the exact case here and should: two
 * rows for one cell would report the same form twice in a search hit and say
 * nothing a reader wants to know.
 */
function expandOne(entry: ExpandableEntry, paradigms: readonly ParadigmDoc[]): Expansion {
  // What the author asserted, in the record's own order. Rows with no `origin`
  // predate the field and are asserted by the same token: nothing but this
  // module has ever written a generated one.
  const asserted = entry.otherForms.filter((form) => form.origin !== "rule");
  const lemma = entry.orthography[0];
  if (lemma === undefined || lemma === "") return { otherForms: asserted, formIssues: [] };

  const held = new Set(entry.inherentAtoms);
  const matching = paradigms.filter((paradigm) =>
    paradigm.selectorAtoms.every((atom) => held.has(atom)),
  );
  if (matching.length === 0) return { otherForms: asserted, formIssues: [] };

  // The merge itself is shared with the reader (`mergeParadigms`), so what this
  // indexes and what an entry page draws cannot disagree about which of two
  // paradigms fills a cell. All that is left here is the index's own shape.
  const merged = mergeParadigms(
    matching.map((paradigm) => ({
      id: paradigm.paradigmKey,
      rules: paradigm.rules,
      requires: paradigm.requires,
    })),
    {
      lemma,
      forms: asserted.map((form) => ({ tag: form.tag, form: form.form })),
    },
  );

  const otherForms: IndexedForm[] = merged.forms.map((form, index) =>
    form.from === undefined
      ? // An asserted row keeps the doc's own row, not a rebuilt one: its
        // `search` and `feats` were computed at ingest and nothing here improves
        // on them. `mergeParadigms` emits the asserted forms first and in order,
        // so the index is the row's.
        (asserted[index] as IndexedForm)
      : {
          form: form.form,
          search: form.form.toLowerCase(),
          feats: form.key,
          tag: form.tag,
          origin: "rule",
          paradigmKey: form.from,
        },
  );

  const formIssues: EntryFormIssue[] = merged.missing.map((row) => ({
    paradigmKey: row.from,
    requiresKey: row.key,
    message: row.message,
  }));

  return { otherForms, formIssues };
}

/** Write one batch of expansions back. `formIssues` disappears when clean. */
async function writeExpansions(
  database: Database,
  updates: readonly { docKey: string; expansion: Expansion }[],
): Promise<void> {
  if (updates.length === 0) return;
  const rows = updates.map((update) => ({
    _key: update.docKey,
    otherForms: update.expansion.otherForms,
    formIssues: update.expansion.formIssues.length > 0 ? update.expansion.formIssues : null,
  }));
  await database.query(aql`
    FOR row IN ${rows}
      UPDATE row._key WITH { otherForms: row.otherForms, formIssues: row.formIssues }
      IN entries OPTIONS { keepNull: false }
  `);
}

/** Expand a list of entry docs in bounded batches. Returns how many were written. */
async function expandEntries(
  database: Database,
  entries: readonly ExpandableEntry[],
): Promise<number> {
  let written = 0;
  for (let i = 0; i < entries.length; i += EXPAND_BATCH) {
    const batch = entries.slice(i, i + EXPAND_BATCH);
    const updates: { docKey: string; expansion: Expansion }[] = [];
    for (const entry of batch) {
      const paradigms = await currentParadigms(database, entry.languageID);
      updates.push({ docKey: entry.docKey, expansion: expandOne(entry, paradigms) });
    }
    await writeExpansions(database, updates);
    written += updates.length;
  }
  return written;
}

/**
 * Path 2 — an entry version became current (a new entry, a rewrite, or a
 * promotion after a deletion): generate its forms against every paradigm the
 * language currently has.
 *
 * Called with the doc as it was just written, so the common case costs no read
 * at all beyond the language's memoised paradigms. This is also what covers
 * "an entry gains an inherent feature and established rules start applying to
 * it" — nothing about that case is special, because matching is recomputed from
 * the version's own bundle every time.
 *
 * A withdrawn version is skipped: ingest strips its search halves and its
 * inherent bundle, and generating forms for an entry its author says should not
 * be offered would put them back into search.
 */
export async function expandEntry(
  database: Database,
  docKey: string,
  entry: {
    entryKey: string;
    languageID: string;
    orthography: string[];
    otherForms: IndexedForm[];
    inherentAtoms: string[];
    deleted: boolean;
    /**
     * Whether the stored doc already carries unmet-requirement rows. Freshly
     * ingested versions never do (ingest writes the asserted half and nothing
     * else); a **promoted** one can, from when it was last current, and those
     * have to be swept whether or not generation produces anything now.
     */
    hadIssues?: boolean;
  },
): Promise<void> {
  if (entry.deleted) return;

  // What the doc already carries that this module owns. It decides whether a
  // write is needed at all, and it is why neither shortcut below may be taken
  // on the strength of "this language has no paradigms": a version promoted
  // after its successor was deleted can be holding the output of rules that no
  // longer exist, and leaving it would keep forms in search that nothing
  // supports.
  const assertedCount = entry.otherForms.filter((form) => form.origin !== "rule").length;
  const hadDerived = assertedCount !== entry.otherForms.length || entry.hadIssues === true;

  const paradigms = await currentParadigms(database, entry.languageID);
  if (paradigms.length === 0 && !hadDerived) return;

  const expansion = expandOne({ docKey, ...entry }, paradigms);
  if (
    !hadDerived &&
    expansion.otherForms.length === assertedCount &&
    expansion.formIssues.length === 0
  ) {
    // Nothing was generated, nothing is missing, and there was nothing to
    // sweep: the doc as ingest wrote it is already right, and a no-op write
    // would still be a write on every entry of every language whose paradigms
    // do not reach it.
    return;
  }
  await writeExpansions(database, [{ docKey, expansion }]);
}

/**
 * Path 1 — a paradigm version became current, or was withdrawn: re-run
 * generation over every entry it could have reached.
 *
 * Two disjoint sets, queried separately so each can be served the way it is
 * best served:
 *
 * 1. **The entries the selector reaches now** — an indexed intersection on
 *    `inherentAtoms`, which is what that index exists for. Narrowed by the first
 *    atom (which the index can serve) and then filtered exactly.
 * 2. **The entries still carrying this paradigm's output** — its generated rows
 *    or its unmet requirements. This is the sweep, and it is why a withdrawal
 *    cleans up after itself: those entries no longer match anything, so set 1
 *    cannot find them, and their stale rows would otherwise stay in search
 *    forever.
 *
 * Passing the *archived* doc after a deletion is deliberate and correct: its
 * selector still names the slice, and its key still names the rows to sweep.
 */
export async function expandForParadigm(
  database: Database,
  paradigm: Pick<ParadigmDoc, "paradigmKey" | "languageID" | "selectorAtoms">,
): Promise<void> {
  const atoms = paradigm.selectorAtoms;
  // A selector with no atoms at all reaches every entry of the language; there
  // is no atom to narrow on, so the filter alone (vacuously true) does the work.
  const narrow = atoms.length > 0 ? aql`FILTER ${atoms[0]} IN e.inherentAtoms` : aql``;
  const reachedCursor = await database.query<ExpandableEntry>(aql`
    FOR e IN entries
      FILTER e.languageID == ${paradigm.languageID}
        AND e.current == true
        AND e.deleted != true
      ${narrow}
      FILTER LENGTH(INTERSECTION(NOT_NULL(e.inherentAtoms, []), ${atoms})) == ${atoms.length}
      RETURN ${ENTRY_FACTS}
  `);
  const entries = new Map<string, ExpandableEntry>();
  for (const entry of await reachedCursor.all()) entries.set(entry.docKey, entry);

  const carryingCursor = await database.query<ExpandableEntry>(aql`
    FOR e IN entries
      FILTER e.languageID == ${paradigm.languageID} AND e.current == true
      FILTER ${paradigm.paradigmKey} IN NOT_NULL(e.otherForms, [])[*].paradigmKey
        OR ${paradigm.paradigmKey} IN NOT_NULL(e.formIssues, [])[*].paradigmKey
      RETURN ${ENTRY_FACTS}
  `);
  for (const entry of await carryingCursor.all()) entries.set(entry.docKey, entry);

  if (entries.size === 0) return;
  const written = await expandEntries(database, [...entries.values()]);
  console.log(
    `firehose: re-expanded ${written} entry version(s) for paradigm ${paradigm.paradigmKey}`,
  );
}

/**
 * Path 3 — rebuild every generated form from scratch, for db:init.
 *
 * The standing exception archive-don't-delete has always had: generated forms
 * are derived, recomputed here in full, so there is nothing in them to lose.
 * Two steps, and the order matters — every generated row is cleared *first*, so
 * that a language whose last paradigm was deleted while this AppView was down
 * does not keep serving forms nothing supports.
 *
 * Only current versions are touched. An archived version's rows are stale, but
 * nothing reads them, and rewriting the whole version history of a dictionary
 * to tidy fields no query looks at is not what a deploy step is for.
 */
export async function rebuildGeneratedForms(database: Database): Promise<{
  cleared: number;
  expanded: number;
  languages: number;
}> {
  forgetParadigms();

  const clearedCursor = await database.query<number>(aql`
    RETURN LENGTH(
      FOR e IN entries
        FILTER e.current == true
        FILTER LENGTH(NOT_NULL(e.formIssues, [])) > 0
          OR "rule" IN NOT_NULL(e.otherForms, [])[*].origin
        UPDATE e WITH {
          otherForms: (FOR f IN NOT_NULL(e.otherForms, []) FILTER f.origin != "rule" RETURN f),
          formIssues: null
        } IN entries OPTIONS { keepNull: false }
        RETURN 1
    )
  `);
  const cleared = (await clearedCursor.next()) ?? 0;

  const languagesCursor = await database.query<string>(aql`
    FOR p IN paradigms
      FILTER p.current == true
      COLLECT languageID = p.languageID
      RETURN languageID
  `);
  const languages = await languagesCursor.all();

  let expanded = 0;
  for (const languageID of languages) {
    const cursor = await database.query<ExpandableEntry>(aql`
      FOR e IN entries
        FILTER e.languageID == ${languageID} AND e.current == true AND e.deleted != true
        RETURN ${ENTRY_FACTS}
    `);
    expanded += await expandEntries(database, await cursor.all());
  }

  return { cleared, expanded, languages: languages.length };
}
