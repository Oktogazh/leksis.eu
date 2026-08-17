import { AtpAgent, type AtpSessionData } from "@atproto/api";

// Dev-only scripted login, so an agentic browser session can drive the
// authenticated surfaces without a human typing a password (the "session wall"
// in the verify skill). The whole module is inert unless the build is a dev
// build AND all three VITE_DEV_* vars are present in apps/web/.env.local
// (gitignored): `import.meta.env.DEV` is statically false in production
// builds, so this path is compiled out of the shipped bundle.
//
// This is a legacy credential session (com.atproto.server.createSession), not
// an OAuth/DPoP one — fine for dev, because AtpAgent extends Agent, which is
// all SessionProvider needs. The session is persisted in localStorage and
// resumed on reload, so in-app navigation and reloads keep it.

const STORAGE_KEY = "leksis-dev-session";
/** Sticky opt-out of the scripted session — see `anonymousRequested`. */
const ANON_KEY = "leksis-dev-anonymous";

/**
 * Whether this dev browser has asked to stay logged out.
 *
 * Needed since search opened to visitors without accounts (ADR-0017): the
 * scripted session logs in on *every* load, so before this there was no way to
 * look at the logged-out app at all — the half of the product this dev
 * convenience exists to help build was the one half it hid.
 *
 * Toggled by `?anon=1` / `?anon=0` and remembered, so it survives the
 * navigation that follows. Dev-only, like everything else in this module.
 */
function anonymousRequested(): boolean {
  const requested = new URLSearchParams(window.location.search).get("anon");
  try {
    if (requested === "1") localStorage.setItem(ANON_KEY, "1");
    if (requested === "0") localStorage.removeItem(ANON_KEY);
    return localStorage.getItem(ANON_KEY) === "1";
  } catch {
    return requested === "1";
  }
}

export async function initDevSession(): Promise<AtpAgent | null> {
  if (!import.meta.env.DEV) return null;
  if (anonymousRequested()) return null;
  const service = import.meta.env.VITE_DEV_PDS as string | undefined;
  const identifier = import.meta.env.VITE_DEV_HANDLE as string | undefined;
  const password = import.meta.env.VITE_DEV_PASSWORD as string | undefined || import.meta.env.VITE_DEV_HANDLE as string | undefined;
  if (!service || !identifier || !password) return null;

  const agent = new AtpAgent({
    service,
    persistSession: (_evt, session) => {
      if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
      else localStorage.removeItem(STORAGE_KEY);
    },
  });

  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      await agent.resumeSession(JSON.parse(stored) as AtpSessionData);
      return agent;
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  await agent.login({ identifier, password });
  return agent;
}

export function clearDevSession(): void {
  if (!import.meta.env.DEV) return;
  localStorage.removeItem(STORAGE_KEY);
}
