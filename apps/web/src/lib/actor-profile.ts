import { fetchRepoRecord, resolvePds } from "./atproto-record";

// The identity behind a DID, read straight from that DID's own PDS: the handle
// from com.atproto.repo.describeRepo, and the display name, bio and avatar from
// the `app.bsky.actor.profile` record.
//
// **This is the one place Leksis reads a lexicon it does not own.** It is a
// deliberate use of the protocol rather than a Bluesky dependency: the record
// lives in the user's own repo and the blob is served by their own PDS
// (com.atproto.sync.getBlob), so a user on any PDS gets their picture, and a
// user with no such record simply has none — every field here is optional and
// the callers render an initials avatar instead.

const BSKY_ACTOR_PROFILE_COLLECTION = "app.bsky.actor.profile";
const BSKY_ACTOR_PROFILE_RKEY = "self";

export interface ActorProfile {
  did: string;
  /** The repo's handle, or null when it does not currently resolve. */
  handle: string | null;
  displayName: string | null;
  description: string | null;
  /** Ready-to-use image URL served by the actor's own PDS, or null. */
  avatarUrl: string | null;
  bannerUrl: string | null;
}

interface DescribeRepoResponse {
  handle?: string;
  did?: string;
  collections?: string[];
}

/**
 * The CID of a blob reference, tolerating both encodings: the current
 * `{$type:"blob", ref:{$link}}` and the legacy `{cid}` form that predates it.
 */
function blobCid(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const blob = value as { ref?: { $link?: unknown }; cid?: unknown };
  if (typeof blob.ref?.$link === "string") return blob.ref.$link;
  if (typeof blob.cid === "string") return blob.cid;
  return null;
}

/** The PDS URL that serves one of a repo's blobs. */
function blobUrl(pds: string, did: string, cid: string): string {
  const params = new URLSearchParams({ did, cid });
  return `${pds}/xrpc/com.atproto.sync.getBlob?${params.toString()}`;
}

/** A non-empty trimmed string, or null — so "" never reaches the UI as a name. */
function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

async function fetchHandle(pds: string, did: string): Promise<string | null> {
  try {
    const res = await fetch(
      `${pds}/xrpc/com.atproto.repo.describeRepo?${new URLSearchParams({ repo: did })}`,
    );
    if (!res.ok) return null;
    const body = (await res.json()) as DescribeRepoResponse;
    // "handle.invalid" is what a PDS returns when the handle no longer verifies;
    // it is not a name to show anyone.
    return body.handle && body.handle !== "handle.invalid" ? body.handle : null;
  } catch {
    return null;
  }
}

async function fetchActorProfileUncached(did: string): Promise<ActorProfile> {
  // Resolving the DID document is the identity check, and the one failure that
  // propagates: a DID with no PDS behind it is not an actor whose page can be
  // shown. Everything after this degrades to null instead.
  const pds = await resolvePds(did);

  const [handle, record] = await Promise.all([
    fetchHandle(pds, did),
    // No profile record is the normal case for an account that has never
    // touched Bluesky.
    fetchRepoRecord(did, BSKY_ACTOR_PROFILE_COLLECTION, BSKY_ACTOR_PROFILE_RKEY).catch(
      () => null,
    ),
  ]);

  const value = (typeof record === "object" && record !== null ? record : {}) as Record<
    string,
    unknown
  >;
  const avatar = blobCid(value.avatar);
  const banner = blobCid(value.banner);

  return {
    did,
    handle,
    displayName: text(value.displayName),
    description: text(value.description),
    avatarUrl: avatar !== null ? blobUrl(pds, did, avatar) : null,
    bannerUrl: banner !== null ? blobUrl(pds, did, banner) : null,
  };
}

const profileCache = new Map<string, Promise<ActorProfile>>();

/**
 * The actor's identity and picture, memoized for the session. A missing profile
 * record resolves to an ActorProfile whose fields are null — "this user has no
 * Bluesky profile" is an ordinary state, not an error. It rejects only when the
 * DID itself does not resolve to a PDS.
 */
export function fetchActorProfile(did: string): Promise<ActorProfile> {
  const cached = profileCache.get(did);
  if (cached) return cached;
  const pending = fetchActorProfileUncached(did).catch((err: unknown) => {
    profileCache.delete(did);
    throw err;
  });
  profileCache.set(did, pending);
  return pending;
}
