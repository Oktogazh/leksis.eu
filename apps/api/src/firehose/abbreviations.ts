import { createHash } from "node:crypto";
import { aql, type Database } from "arangojs";

// Maintenance of the `abbreviations` read model: one doc per distinct
// (language, short, long) annotation pair used by current entry versions —
// grammatical categories and definition notes alike, i.e. the front-matter
// "abbreviations" section of a printed dictionary. Each doc lists the
// entryKeys of the current versions using the pair (its length is the
// counter, and a pointer back to the entries for maintenance) plus the
// _keys of same-language docs it conflicts with: same short with a
// different long, or same long with a different short — a pair with no
// short form never conflicts. A doc whose last entry stops using the pair
// is removed: the model is derived and fully rebuildable from `entries`
// (db:init), like `localLanguages`.

export interface AbbreviationPair {
  /** null = the pair has no abbreviated form (allowed; never conflicts). */
  short: string | null;
  long: string;
}

export interface AbbreviationDoc extends AbbreviationPair {
  _key: string;
  languageID: string;
  /** entryKeys of the current entry versions using this pair. */
  entries: string[];
  /** _keys of same-language docs whose forms clash with this one. */
  conflictsWith: string[];
  updatedAt: string;
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

function conflictsBetween(a: AbbreviationPair, b: AbbreviationPair): boolean {
  if (a.short === null || b.short === null) return false;
  return (a.short === b.short && a.long !== b.long) || (a.long === b.long && a.short !== b.short);
}

/**
 * Recompute every doc's `conflictsWith` inside one language. Conflicts only
 * change when a pair doc appears or disappears, so callers invoke this per
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
 * Declare the full set of pairs one entry's current version uses (empty =
 * the entry is gone, or pairless). Membership is tracked by entryKey, so a
 * new version, a promotion after deletion and a full removal all reduce to
 * this same declaration. Callers are sequential single writers (firehose
 * consumer, db:init backfill), so read-then-write is race-free.
 */
export async function syncEntryAbbreviations(
  db: Database,
  entryKey: string,
  languageID: string | null,
  pairs: AbbreviationPair[],
): Promise<void> {
  const now = new Date().toISOString();
  const keep = new Map<string, AbbreviationPair>();
  if (languageID !== null) {
    for (const pair of pairs) keep.set(abbreviationKey(languageID, pair), pair);
  }
  const keepKeys = [...keep.keys()];

  // Drop the entry from pairs it no longer uses (any language — the tag can
  // change between versions), deleting docs left without entries.
  const staleCursor = await db.query<{ key: string; languageID: string; empty: boolean }>(aql`
    FOR a IN abbreviations
      FILTER ${entryKey} IN a.entries AND a._key NOT IN ${keepKeys}
      LET entries = REMOVE_VALUE(a.entries, ${entryKey})
      UPDATE a WITH { entries, updatedAt: ${now} } IN abbreviations
      RETURN { key: a._key, languageID: a.languageID, empty: LENGTH(entries) == 0 }
  `);
  const stale = await staleCursor.all();
  const emptied = stale.filter((s) => s.empty);
  if (emptied.length > 0) {
    await db.query(aql`
      FOR key IN ${emptied.map((e) => e.key)} REMOVE key IN abbreviations
    `);
  }

  // Ensure a doc exists for every pair now in use, and the entry is listed.
  const createdLanguages = new Set<string>();
  for (const [key, pair] of keep) {
    const upsertCursor = await db.query<boolean>(aql`
      UPSERT { _key: ${key} }
      INSERT {
        _key: ${key},
        languageID: ${languageID},
        short: ${pair.short},
        long: ${pair.long},
        entries: [${entryKey}],
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

  // Conflicts only move when a pair doc was created or deleted.
  const affected = new Set<string>([
    ...emptied.map((e) => e.languageID),
    ...createdLanguages,
  ]);
  for (const language of affected) {
    await recomputeConflicts(db, language);
  }
}

/**
 * Pure wholesale build of the read model from (entryKey, languageID, pairs)
 * rows — used by the db:init rebuild. Returns the full desired collection
 * content, conflicts included.
 */
export function buildAbbreviationDocs(
  rows: { entryKey: string; languageID: string; abbreviations: AbbreviationPair[] }[],
): AbbreviationDoc[] {
  const now = new Date().toISOString();
  const byKey = new Map<string, AbbreviationDoc>();
  for (const row of rows) {
    for (const pair of row.abbreviations) {
      const key = abbreviationKey(row.languageID, pair);
      const doc = byKey.get(key);
      if (doc === undefined) {
        byKey.set(key, {
          _key: key,
          languageID: row.languageID,
          short: pair.short,
          long: pair.long,
          entries: [row.entryKey],
          conflictsWith: [],
          updatedAt: now,
        });
      } else if (!doc.entries.includes(row.entryKey)) {
        doc.entries.push(row.entryKey);
      }
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
