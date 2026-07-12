// The user's language shortlist: tags they have previously selected, most
// recent first. Stored in localStorage for the smallest Loop-1 slice; moving
// it to the user's PDS is a deferred decision (trigger: multi-device use).

const STORAGE_KEY = "leksis.languageShortlist";
const MAX_ITEMS = 8;

export function getShortlist(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

/** Add or move a tag to the front of the shortlist and persist it. */
export function promoteInShortlist(tag: string): string[] {
  const next = [tag, ...getShortlist().filter((t) => t !== tag)].slice(0, MAX_ITEMS);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private-mode/quota failures just lose the convenience, not the feature.
  }
  return next;
}
