import { useEffect, useState } from "react";
import type { Session } from "@glosis/types";

// --- Week 1 placeholder session store -------------------------------------
//
// This is a LOCAL-ONLY stand-in for AT Proto OAuth. It persists a typed
// handle to localStorage so the connected/disconnected toggle survives a
// refresh. In week 2 the `connect`/`disconnect` bodies get swapped for real
// PDS OAuth (redirect to /auth/login, httpOnly cookie session) while this
// hook's shape — `{ session, connect, disconnect }` — stays the same.

const STORAGE_KEY = "glosis.session";

function load(): Session {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { state: "disconnected" };
    const parsed = JSON.parse(raw) as Session;
    if (parsed.state === "connected" && parsed.handle) return parsed;
  } catch {
    // ignore malformed storage
  }
  return { state: "disconnected" };
}

export function useSession() {
  const [session, setSession] = useState<Session>(load);

  useEffect(() => {
    if (session.state === "connected") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [session]);

  function connect(handle: string) {
    const trimmed = handle.trim().replace(/^@/, "");
    if (!trimmed) return;
    setSession({ state: "connected", handle: trimmed });
  }

  function disconnect() {
    setSession({ state: "disconnected" });
  }

  return { session, connect, disconnect };
}
