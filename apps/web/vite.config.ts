import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Where the dev server sends /api/*.
//
// **The production AppView by default.** Working on the web app then needs no
// local API and no local ArangoDB, and what you see is the real index rather
// than whatever a local database happens to hold. Override with LEKSIS_API —
// `LEKSIS_API=http://127.0.0.1:8080 npm run dev -w @leksis/web` runs against a
// local Hono (see apps/api/.env.example).
//
// ⚠ Reads are the safe half. The app's *writes* never go through this proxy at
// all — they go from the browser to the user's own PDS — so an entry created in
// local dev is published for real, and production's firehose indexes it into
// the live dictionary. That is true whatever this points at; it is only worth
// remembering because pointing here at production makes the round trip visible.
//
// The base may carry a path: Caddy serves the API under /api and strips the
// prefix itself, while a local Hono serves it at the root. Rewriting to the
// base's own pathname covers both with no special case.
const API_BASE = process.env.LEKSIS_API ?? "https://leksis.eu/api";
const apiUrl = new URL(API_BASE);
const apiPrefix = apiUrl.pathname.replace(/\/$/, ""); // "/api" for Caddy, "" for a bare Hono

export default defineConfig({
  plugins: [react()],
  server: {
    // Bind the IPv4 loopback explicitly. AT Proto's loopback OAuth callback
    // always targets http://127.0.0.1, but Vite's default `localhost` resolves
    // to ::1 on macOS — leaving 127.0.0.1:5173 unbound and the callback
    // refused. Pinning the host makes the dev server answer on the exact origin
    // the OAuth redirect comes back to.
    host: "127.0.0.1",
    port: 5173,
    // Same-origin /api in dev, exactly as Caddy serves it in production.
    //
    // Without this, local verification is impossible: the API deliberately
    // emits no CORS headers (Caddy is the single Access-Control-Allow-Origin
    // authority — see the Caddyfile), so a direct call from :5173 to the API is
    // cross-origin and the browser blocks every one of it. Proxying here means
    // the browser only ever talks to its own origin, so no CORS applies at all.
    //
    // `changeOrigin` is what lets the production target work: Caddy routes by
    // Host, so the request must arrive claiming to be for leksis.eu, not for
    // 127.0.0.1:5173.
    proxy: {
      "/api": {
        target: apiUrl.origin,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, apiPrefix),
      },
    },
  },
});
