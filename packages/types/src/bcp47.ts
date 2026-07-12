// Syntax-only BCP 47 (RFC 5646) well-formedness check, shared by the web
// creation form and the API firehose ingestion so both sides accept exactly
// the same tags. No registry lookup: validity of the subtags themselves is a
// deliberate non-goal (wrong tags can be overwritten by later records — see
// docs/adr/0003-language-records-and-firehose.md).

// langtag  = language ["-" script] ["-" region] *("-" variant)
//            *("-" extension) ["-" privateuse]
// or a privateuse-only tag ("x-..."). Two deliberate deviations from the full
// grammar: grandfathered/irregular legacy tags are not accepted, and 4–8-letter
// primary language subtags (RFC-"reserved for future use", none registered)
// are rejected — they only ever show up when someone types a language *name*
// ("breton") instead of its tag.
const LANGTAG_RE = new RegExp(
  "^(?:" +
    "[a-z]{2,3}(?:-[a-z]{3}){0,3}" + // language (+extlang)
    "(?:-[a-z]{4})?" + // script
    "(?:-(?:[a-z]{2}|[0-9]{3}))?" + // region
    "(?:-(?:[a-z0-9]{5,8}|[0-9][a-z0-9]{3}))*" + // variants
    "(?:-[0-9a-wy-z](?:-[a-z0-9]{2,8})+)*" + // extensions
    "(?:-x(?:-[a-z0-9]{1,8})+)?" + // private use
    "|x(?:-[a-z0-9]{1,8})+" + // private-use-only tag
    ")$",
);

/**
 * Normalize a language tag to the project convention: trimmed, lowercase.
 * (BCP 47 tags are case-insensitive; Leksis stores and compares them in
 * lowercase everywhere — record rkeys, ArangoDB docs, UI state.)
 */
export function normalizeLanguageTag(tag: string): string {
  return tag.trim().toLowerCase();
}

/**
 * True when the (already normalized or not) tag is a well-formed BCP 47
 * language tag. Checks syntax only — not whether the subtags are registered.
 */
export function isValidLanguageTag(tag: string): boolean {
  return LANGTAG_RE.test(normalizeLanguageTag(tag));
}
