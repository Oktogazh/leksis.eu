import { useState } from "react";
import { useSession } from "./lib/session";

export default function App() {
  const { session, connect, disconnect } = useSession();
  const [handle, setHandle] = useState("");

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-3xl px-6 py-4 flex items-center justify-between">
          <span className="font-semibold tracking-tight">Glosis</span>
          {session.state === "connected" ? (
            <div className="flex items-center gap-3 text-sm">
              <span className="text-slate-500">
                connected as <span className="font-medium text-slate-900">@{session.handle}</span>
              </span>
              <button
                onClick={disconnect}
                className="rounded-md border border-slate-300 px-3 py-1.5 font-medium hover:bg-slate-100"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <span className="text-sm text-slate-400">not connected</span>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
        {session.state === "disconnected" ? (
          <section className="mx-auto max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h1 className="text-lg font-semibold">Connect your PDS</h1>
            <p className="mt-1 text-sm text-slate-500">
              Enter your Bluesky / AT&nbsp;Proto handle to connect.
            </p>
            <form
              className="mt-4 flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                connect(handle);
              }}
            >
              <input
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                placeholder="alice.bsky.social"
                autoFocus
                className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
              />
              <button
                type="submit"
                className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
              >
                Connect
              </button>
            </form>
            <p className="mt-4 text-xs text-slate-400">
              Placeholder login — real AT&nbsp;Proto OAuth lands in week&nbsp;2.
            </p>
          </section>
        ) : (
          <section className="text-center text-slate-400">
            {/* Intentionally blank — the dictionary lands in week 3+. */}
            <p className="text-sm">You are connected. Nothing to see here yet.</p>
          </section>
        )}
      </main>
    </div>
  );
}
