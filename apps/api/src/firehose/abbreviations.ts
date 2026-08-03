import { createHash } from "node:crypto";
import { aql, type Database } from "arangojs";
import { grammarRows, tagKey, type Grammar, type Tag } from "@leksis/types";

// Maintenance of the `abbreviations` read model: one doc per row of the
// front-matter "abbreviations" section of a printed dictionary. Each doc lists
// the entryKeys of the current versions using the row (its length is the
// counter, and a pointer back to the entries for maintenance) plus the _keys
// of same-language docs it conflicts with: same short with a different long,
// or same long with a different short — a row with no short form never
// conflicts. The model is derived and fully rebuildable (db:init), like
// `localLanguages`.
//
// **Every label has exactly one source: a binding on the language record.**
// Entries no longer carry labels of their own — they carry tags, and what a
// reader sees is whatever the language bound that tag to. So the two things
// this module joins are asymmetric: a *language* contributes the label, an
// *entry* contributes only usage, and the join is the canonical tag key.
//
// That leaves a row in one of two states, and both are the point of the model:
// a bound label, whose count may legitimately be zero because the language
// declared it before anyone used it; and a tag in use that nothing has named
// yet, which carries a count and no label at all. The second *is* the
// worklist item — "used here, still needs a name in this language" — and it is
// why `long` is nullable.

/** A homolingual label, as stored on a row of the read model. */
export interface AbbreviationPair {
  /** null = the label has no abbreviated form (allowed; never conflicts). */
  short: string | null;
  long: string;
}

/** A label a language bound to a grammatical atom, with what it names. */
export interface BindingPair extends AbbreviationPair {
  /** Canonical key of the bound atom (`tagKey`, or `featureKey` for a name). */
  bindingKey: string;
  /** The tag this label stands for; null on a feature *name*, which is not a tag. */
  tag: Tag | null;
}

export interface AbbreviationDoc {
  _key: string;
  languageID: string;
  short: string | null;
  /**
   * The full form. **Null when the row is a tag in use that no binding has
   * named yet** — the row exists precisely to say "this is used here and
   * still needs a name in this language".
   */
  long: string | null;
  /** entryKeys of the current entry versions using this row. */
  entries: string[];
  /**
   * Set when a language *binding* declares this row. A bound doc is never
   * deleted for being unused: the language declared it, so the entries do not
   * get to remove it.
   */
  bindingKey: string | null;
  /**
   * Canonical key of the tag this row is about — from a binding, or from a
   * tag entries use with nothing bound to it. It is what entry usage joins
   * on, and it is distinct from `bindingKey`: an unbound tag in use has a
   * `tagKey` and no `bindingKey`.
   */
  tagKey: string | null;
  /** The tag itself, so a viewer can resolve one without the language record. */
  tag: Tag | null;
  /** _keys of same-language docs whose forms clash with this one. */
  conflictsWith: string[];
  updatedAt: string;
}

/**
 * The labels a language's grammar declares. Keyed on the label itself, so the
 * reader's abbreviation list shows "an. anv-kadarn" once however many rows of
 * the grammar arrive at it. Two atoms bound to the *same* label therefore
 * collapse into one row (last declared wins); that is an authoring mistake —
 * two grammatical atoms a reader cannot tell apart — and it belongs to the
 * language to fix.
 */
export function grammarBindingPairs(grammar: Grammar): BindingPair[] {
  return grammarRows(grammar).map((row) => ({
    short: row.label.short ?? null,
    long: row.label.long,
    bindingKey: row.key,
    tag: row.tag ?? null,
  }));
}

/**
 * Deterministic doc key for a pair: `{lang}-{slug}-{hash12}`. The slug keeps
 * keys readable (ASCII-only — ArangoDB's _key charset); the 48-bit hash of
 * the whole pair is the identity, so the same pair always maps to the same
 * doc and upserts need no prior lookup.
 */
export function abbreviationKey(languageID: string, pair: AbbreviationPair): string {
  const slug = pair.long
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 8);
  const hash = createHash("sha256")
    .update(`${languageID}\u0000${pair.short ?? ""}\u0000${pair.long}`)
    .digest("hex")
    .slice(0, 12);
  return [languageID, slug, hash].filter(Boolean).join("-");
}

/**
 * Deterministic doc key for a row that has a tag but no label yet. Hashed
 * like a pair key, so a bracketed layered feature name (`Number[psor]`) can
 * never leak characters ArangoDB's _key charset forbids.
 */
export function tagRowKey(languageID: string, canonicalTagKey: string): string {
  const hash = createHash("sha256")
    .update(`${languageID}\u0000tag\u0000${canonicalTagKey}`)
    .digest("hex")
    .slice(0, 12);
  return [languageID, "tag", hash].filter(Boolean).join("-");
}

function conflictsBetween(
  a: { short: string | null; long: string | null },
  b: { short: string | null; long: string | null },
): boolean {
  if (a.short === null || b.short === null) return false;
  if (a.long === null || b.long === null) return false;
  return (a.short === b.short && a.long !== b.long) || (a.long === b.long && a.short !== b.short);
}

/**
 * Recompute every doc's `conflictsWith` inside one language. Conflicts only
 * change when a row appears or disappears, so callers invoke this per
 * affected language after such a change. Whole-language recompute keeps the
 * logic obviously correct; per-language pair counts stay small.
 */
async function recomputeConflicts(db: Database, languageID: string): Promise<void> {
  const cursor = await db.query<AbbreviationDoc>(aql`
    FOR a IN abbreviations FILTER a.languageID == ${languageID} RETURN a
  `);
  const docs = await cursor.all();
  for (const doc of docs) {
    const conflictsWith = docs
      .filter((other) => other._key !== doc._key && conflictsBetween(doc, other))
      .map((other) => other._key)
      .sort();
    const previous = [...doc.conflictsWith].sort();
    if (conflictsWith.join("\u0000") !== previous.join("\u0000")) {
      await db.query(aql`
        UPDATE ${doc._key} WITH { conflictsWith: ${conflictsWith} } IN abbreviations
      `);
    }
  }
}

/**
 * Declare the full set of tags one entry's current version uses (empty = the
 * entry is gone, or carries none). Membership is tracked by entryKey, so a new
 * version, a promotion after deletion and a full removal all reduce to this
 * same declaration. Callers are sequential single writers (firehose consumer,
 * db:init backfill), so read-then-write is race-free.
 *
 * An entry contributes **usage and nothing else**. It has no label to give:
 * the language record owns every label, and this only decides which row each
 * tag's usage lands on.
 */
export async function syncEntryTags(
  db: Database,
  entryKey: string,
  languageID: string | null,
  tags: Tag[],
): Promise<void> {
  const now = new Date().toISOString();

  /** Every row this version should belong to: _key → what to insert if absent. */
  const keep = new Map<string, { tagKey: string; tag: Tag }>();

  if (languageID !== null) {
    // A tag joins the row that already carries it — normally the row a
    // language binding created — so usage counts land on the bound label
    // rather than beside it. A tag nothing has bound has no row to join, so
    // it gets one with no label: that row *is* the worklist item, "used here,
    // still needs a name in this language".
    const wanted = new Map<string, Tag>();
    for (const tag of tags) wanted.set(tagKey(tag), tag);
    const existingCursor = await db.query<{ key: string; tagKey: string }>(aql`
      FOR a IN abbreviations
        FILTER a.languageID == ${languageID} AND a.tagKey IN ${[...wanted.keys()]}
        RETURN { key: a._key, tagKey: a.tagKey }
    `);
    const existingByTag = new Map((await existingCursor.all()).map((r) => [r.tagKey, r.key]));
    for (const [canonical, tag] of wanted) {
      keep.set(existingByTag.get(canonical) ?? tagRowKey(languageID, canonical), {
        tagKey: canonical,
        tag,
      });
    }
  }
  const keepKeys = [...keep.keys()];

  // Drop the entry from rows it no longer uses (any language — the tag can
  // change between versions), deleting docs left with nothing behind them.
  // A doc carrying a binding survives at zero entries: the language declared
  // that label, so it is not the entries' to remove.
  const staleCursor = await db.query<{ key: string; languageID: string; empty: boolean }>(aql`
    FOR a IN abbreviations
      FILTER ${entryKey} IN a.entries AND a._key NOT IN ${keepKeys}
      LET entries = REMOVE_VALUE(a.entries, ${entryKey})
      UPDATE a WITH { entries, updatedAt: ${now} } IN abbreviations
      RETURN {
        key: a._key,
        languageID: a.languageID,
        empty: LENGTH(entries) == 0 AND a.bindingKey == null
      }
  `);
  const stale = await staleCursor.all();
  const emptied = stale.filter((s) => s.empty);
  if (emptied.length > 0) {
    await db.query(aql`
      FOR key IN ${emptied.map((e) => e.key)} REMOVE key IN abbreviations
    `);
  }

  // Ensure a doc exists for every row now in use, and the entry is listed.
  // A row created here is label-less by construction: an entry has no label to
  // give, so it stays a worklist item until the language binds one.
  const createdLanguages = new Set<string>();
  for (const [key, row] of keep) {
    const upsertCursor = await db.query<boolean>(aql`
      UPSERT { _key: ${key} }
      INSERT {
        _key: ${key},
        languageID: ${languageID},
        short: null,
        long: null,
        entries: [${entryKey}],
        bindingKey: null,
        tagKey: ${row.tagKey},
        tag: ${row.tag},
        conflictsWith: [],
        updatedAt: ${now}
      }
      UPDATE {
        entries: ${entryKey} IN OLD.entries ? OLD.entries : APPEND(OLD.entries, ${entryKey}),
        updatedAt: ${now}
      }
      IN abbreviations
      RETURN OLD == null
    `);
    if ((await upsertCursor.next()) === true && languageID !== null) {
      createdLanguages.add(languageID);
    }
  }

  // Conflicts only move when a row was created or deleted.
  const affected = new Set<string>([
    ...emptied.map((e) => e.languageID),
    ...createdLanguages,
  ]);
  for (const language of affected) {
    await recomputeConflicts(db, language);
  }
}

/**
 * Declare the full set of label pairs one language's grammar binds (empty =
 * the language declares nothing). Mirrors `syncEntryAbbreviations`: a whole
 * desired set is declared, so a new record version, an added binding and a
 * removed one all reduce to the same call.
 *
 * A pair that stops being bound keeps its entries and simply loses its tag;
 * it is deleted only if no entry used it either.
 */
export async function syncLanguageBindings(
  db: Database,
  languageID: string,
  bindings: BindingPair[],
): Promise<void> {
  const now = new Date().toISOString();
  const keep = new Map<string, BindingPair>();
  for (const binding of bindings) keep.set(abbreviationKey(languageID, binding), binding);
  const keepKeys = [...keep.keys()];

  // Un-bind the labels this version no longer declares, dropping those no
  // entry keeps alive.
  const staleCursor = await db.query<{ key: string; empty: boolean }>(aql`
    FOR a IN abbreviations
      FILTER a.languageID == ${languageID} AND a.bindingKey != null
             AND a._key NOT IN ${keepKeys}
      UPDATE a WITH { bindingKey: null, tagKey: null, tag: null, updatedAt: ${now} } IN abbreviations
      RETURN { key: a._key, empty: LENGTH(a.entries) == 0 }
  `);
  const stale = await staleCursor.all();
  const emptied = stale.filter((s) => s.empty).map((s) => s.key);
  if (emptied.length > 0) {
    await db.query(aql`FOR key IN ${emptied} REMOVE key IN abbreviations`);
  }

  let created = false;
  for (const [key, binding] of keep) {
    const cursor = await db.query<boolean>(aql`
      UPSERT { _key: ${key} }
      INSERT {
        _key: ${key},
        languageID: ${languageID},
        short: ${binding.short},
        long: ${binding.long},
        entries: [],
        bindingKey: ${binding.bindingKey},
        tagKey: ${binding.tag === null ? null : tagKey(binding.tag)},
        tag: ${binding.tag},
        conflictsWith: [],
        updatedAt: ${now}
      }
      UPDATE {
        bindingKey: ${binding.bindingKey},
        tagKey: ${binding.tag === null ? null : tagKey(binding.tag)},
        tag: ${binding.tag},
        updatedAt: ${now}
      }
      IN abbreviations
      RETURN OLD == null
    `);
    if ((await cursor.next()) === true) created = true;
  }

  if (created || emptied.length > 0) await recomputeConflicts(db, languageID);
}

/**
 * Pure wholesale build of the read model — used by the db:init rebuild.
 * Returns the full desired collection content, conflicts included.
 *
 * **Bindings first, then entry usage**, and the order is load-bearing: a
 * binding is what creates a labelled row, so usage applied afterwards finds
 * that row by tag key and lands its count on the label instead of beside it.
 * Reverse the two and every bound label would acquire a label-less twin.
 */
export function buildAbbreviationDocs(
  rows: {
    entryKey: string;
    languageID: string;
    tags?: Tag[] | null;
  }[],
  bindingRows: { languageID: string; bindings: BindingPair[] }[] = [],
): AbbreviationDoc[] {
  const now = new Date().toISOString();
  const byKey = new Map<string, AbbreviationDoc>();

  for (const row of bindingRows) {
    for (const binding of row.bindings) {
      const key = abbreviationKey(row.languageID, binding);
      const doc = byKey.get(key);
      if (doc === undefined) {
        byKey.set(key, {
          _key: key,
          languageID: row.languageID,
          short: binding.short,
          long: binding.long,
          entries: [],
          bindingKey: binding.bindingKey,
          tagKey: binding.tag === null ? null : tagKey(binding.tag),
          tag: binding.tag,
          conflictsWith: [],
          updatedAt: now,
        });
      } else {
        doc.bindingKey = binding.bindingKey;
        doc.tagKey = binding.tag === null ? null : tagKey(binding.tag);
        doc.tag = binding.tag;
      }
    }
  }

  // Entry tag usage joins the row already carrying that tag — the one a
  // binding created — so counts land on the bound label. A tag nothing binds
  // gets a label-less row of its own: the worklist item.
  for (const row of rows) {
    for (const tag of row.tags ?? []) {
      const canonical = tagKey(tag);
      let doc = [...byKey.values()].find(
        (d) => d.languageID === row.languageID && d.tagKey === canonical,
      );
      if (doc === undefined) {
        const key = tagRowKey(row.languageID, canonical);
        doc = {
          _key: key,
          languageID: row.languageID,
          short: null,
          long: null,
          entries: [],
          bindingKey: null,
          tagKey: canonical,
          tag,
          conflictsWith: [],
          updatedAt: now,
        };
        byKey.set(key, doc);
      }
      if (!doc.entries.includes(row.entryKey)) doc.entries.push(row.entryKey);
    }
  }

  const docs = [...byKey.values()];
  for (const doc of docs) {
    doc.conflictsWith = docs
      .filter(
        (other) =>
          other._key !== doc._key &&
          other.languageID === doc.languageID &&
          conflictsBetween(doc, other),
      )
      .map((other) => other._key)
      .sort();
  }
  return docs;
}
