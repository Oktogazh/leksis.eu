import {
  isValidLanguageTag,
  normalizeLanguageTag,
  LEKSIS_PROFILE_COLLECTION,
  type LeksisProfileRecord,
} from "@leksis/types";

/*
 * The preferences of a visitor who has no PDS (ADR-0017).
 *
 * Since search opened to people who are not logged in, the two settings the
 * profile record carries — interface language and languages of interest — are
 * wanted by readers who have nowhere to put them. They go in localStorage.
 *
 * **The stored value is a `LeksisProfileRecord`, deliberately.** Not a
 * convenience: it is what makes the rest of the app unaware that any of this
 * happened. `SessionProvider` serves this object under the same `profile` field
 * it serves the PDS record under, so the search bar's shortlist, the profile
 * dialog and the language dashboard were not touched — and logging in is a
 * *promotion* of an existing object rather than a translation between two
 * shapes that would need keeping in step.
 *
 * The line this must not cross: **preferences only, never contributions.** A
 * dictionary entry written to localStorage would be a contribution the network
 * never sees, owned by a browser profile rather than by its author — the exact
 * inversion of the project's premise that records live on their author's own
 * server. Anything a reader writes *about the dictionary* requires a PDS; this
 * file is for what they write about *their own view of it*.
 */

/** localStorage key holding the anonymous visitor's preferences. */
export const LOCAL_PREFS_KEY = "leksis.prefs";

/**
 * Narrow a parsed localStorage payload to the profile contract.
 *
 * As lenient as the PDS-side parser and for the same reason: a malformed tag
 * drops out rather than failing the whole object, so a preference file written
 * by an older build still loads. Storage is not a trust boundary here — it is
 * this origin's own data — but it *is* an unvalidated input, and a bad language
 * tag would otherwise reach the API as a scope it cannot parse.
 */
function parsePrefs(value: unknown): LeksisProfileRecord | null {
  if (typeof value !== "object" || value === null) return null;
  const r = value as Record<string, unknown>;

  const interfaceLanguage =
    typeof r.interfaceLanguage === "string" ? normalizeLanguageTag(r.interfaceLanguage) : "";

  const languages = Array.isArray(r.languages)
    ? Array.from(
        new Set(
          r.languages
            .filter((l): l is string => typeof l === "string")
            .map((l) => normalizeLanguageTag(l))
            .filter((l) => isValidLanguageTag(l)),
        ),
      )
    : [];

  return {
    $type: LEKSIS_PROFILE_COLLECTION,
    interfaceLanguage,
    languages,
    createdAt: typeof r.createdAt === "string" ? r.createdAt : "",
  };
}

/**
 * The visitor's stored preferences, or null when they have never set any.
 *
 * Null is the honest answer for a first visit, and it is *not* the onboarding
 * signal the PDS-side null is: a visitor with no preferences is a reader who
 * has not been asked anything, not an account waiting to be set up.
 */
export function readLocalPrefs(): LeksisProfileRecord | null {
  try {
    const raw = localStorage.getItem(LOCAL_PREFS_KEY);
    if (raw === null) return null;
    return parsePrefs(JSON.parse(raw));
  } catch {
    // Unavailable (private mode), or unparseable (hand-edited, half-written).
    // Either way the visitor simply has no preferences, which is a state the
    // whole app already handles.
    return null;
  }
}

/** Persist the visitor's preferences. Silently a no-op when storage is unavailable. */
export function writeLocalPrefs(record: LeksisProfileRecord): void {
  try {
    localStorage.setItem(LOCAL_PREFS_KEY, JSON.stringify(record));
  } catch {
    // Private mode or a full quota. The preference still applies for this
    // session — it is held in React state — it just will not outlive the tab.
  }
}

/**
 * Forget the visitor's preferences.
 *
 * **Not called on logout.** Someone logging out is still the same reader on the
 * same browser, and the languages they read in are exactly what they should get
 * back. This exists for an explicit "forget me", and its absence from the
 * logout path is the decision, not an omission.
 */
export function clearLocalPrefs(): void {
  try {
    localStorage.removeItem(LOCAL_PREFS_KEY);
  } catch {
    // Nothing to do: unavailable storage holds nothing to forget.
  }
}
