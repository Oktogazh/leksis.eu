import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Agent } from "@atproto/api";
import type { BrowserOAuthClient } from "@atproto/oauth-client-browser";
import i18n from "../i18n";
import { getOAuthClient } from "./client";

// The live OAuth session type, derived from the client API so we don't depend
// on the name being re-exported.
type OAuthSession = NonNullable<Awaited<ReturnType<BrowserOAuthClient["init"]>>>["session"];

type Status = "loading" | "connected" | "disconnected";

interface SessionContextValue {
  /** `loading` until the client has restored/processed any existing session. */
  status: Status;
  did: string | null;
  handle: string | null;
  /** Authenticated AT Proto agent for XRPC calls; null while disconnected. */
  agent: Agent | null;
  /** Begin login: resolves the handle and redirects to the user's PDS. */
  signIn: (handle: string) => Promise<void>;
  /** Revoke the session and return to the disconnected state. */
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

async function resolveHandle(agent: Agent, did: string): Promise<string> {
  // describeRepo hits the user's own PDS — works for any AT Proto
  // provider, not just Bluesky.

  try {
    const repo = await agent.com.atproto.repo.describeRepo({ repo: did });
    if (repo.data.handle && repo.data.handle !== "handle.invalid") {
      return repo.data.handle;
    }
  } catch { /* fall through */ }

  return did;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [did, setDid] = useState<string | null>(null);
  const [handle, setHandle] = useState<string | null>(null);
  const [agent, setAgent] = useState<Agent | null>(null);
  const sessionRef = useRef<OAuthSession | null>(null);
  const didInit = useRef<boolean>(false);

  useEffect(() => {
    // Run exactly once, even under StrictMode's double-invoke — re-running
    // init() would try to reprocess (already-consumed) OAuth callback params.
    if (didInit.current) return;
    didInit.current = true;

    void (async () => {
      try {
        const client = await getOAuthClient();
        // Restores a stored session, or processes the OAuth callback if we just
        // came back from the PDS (and cleans the params out of the URL).
        const result = await client.init();
        if (result?.session) {
          const session = result.session;
          sessionRef.current = session;
          const authed = new Agent(session);
          setAgent(authed);
          setDid(session.did);
          setStatus("connected");
          setHandle(await resolveHandle(authed, session.did));
        } else {
          setStatus("disconnected");
        }
      } catch (err) {
        console.error("OAuth init failed", err);
        setStatus("disconnected");
      }
    })();
  }, []);

  const signIn = useCallback(async (input: string) => {
    const client = await getOAuthClient();
    const cleaned = input.trim().replace(/^@/, "");
    // Redirects the whole page to the user's PDS; on success nothing after this
    // line runs. It only returns/throws when the handle can't be resolved.
    await client.signIn(cleaned, { ui_locales: i18n.language });
  }, []);

  const signOut = useCallback(async () => {
    try {
      await sessionRef.current?.signOut();
    } catch (err) {
      console.error("Sign out failed", err);
    }
    sessionRef.current = null;
    setAgent(null);
    setDid(null);
    setHandle(null);
    setStatus("disconnected");
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({ status, did, handle, agent, signIn, signOut }),
    [status, did, handle, agent, signIn, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within <SessionProvider>");
  return ctx;
}
