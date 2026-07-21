import { Agent, XRPCError } from "@atproto/api";
import {
  isValidLanguageTag,
  normalizeLanguageTag,
  LEKSIS_PROFILE_COLLECTION,
  LEKSIS_PROFILE_RKEY,
  type LeksisProfileRecord,
} from "@leksis/types";

// Read/write of the user's own eu.leksis.profile record. This record is
// client-side configuration, not dictionary content: the AppView never indexes
// it, so the browser goes straight to the user's PDS through their
// authenticated agent — getRecord to load it, putRecord to save it.

/**
 * Narrow an unknown PDS payload to the profile contract. Lenient: unknown or
 * malformed language tags are dropped rather than failing the whole record, so
 * an older or partially-written profile still loads. A missing/blank
 * interfaceLanguage yields "" (the caller falls back to its default).
 */
function parseProfileRecord(value: unknown): LeksisProfileRecord | null {
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
 * Fetch the user's profile from their own PDS. Returns null when no profile
 * record exists yet (→ onboarding). Throws on unexpected network failure so
 * the caller can distinguish "no profile" from "couldn't reach the PDS".
 */
export async function fetchProfile(agent: Agent, did: string): Promise<LeksisProfileRecord | null> {
  try {
    const res = await agent.com.atproto.repo.getRecord({
      repo: did,
      collection: LEKSIS_PROFILE_COLLECTION,
      rkey: LEKSIS_PROFILE_RKEY,
    });
    return parseProfileRecord(res.data.value);
  } catch (err) {
    // A missing record surfaces as XRPC error "RecordNotFound" — that's the
    // onboarding signal, not a failure. Anything else is a real error.
    if (err instanceof XRPCError && err.error === "RecordNotFound") {
      return null;
    }
    throw err;
  }
}

/**
 * Write (create or overwrite) the user's profile record on their own PDS.
 * putRecord on the singleton rkey "self" makes every save a natural update.
 */
export async function putProfile(
  agent: Agent,
  did: string,
  record: LeksisProfileRecord,
): Promise<void> {
  await agent.com.atproto.repo.putRecord({
    repo: did,
    collection: LEKSIS_PROFILE_COLLECTION,
    rkey: LEKSIS_PROFILE_RKEY,
    // putRecord wants an index signature our interface doesn't declare.
    record: { ...record },
  });
}
