import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

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
    // authority — see the Caddyfile), so a direct call from :5173 to :8080 is
    // cross-origin and the browser blocks every one of it. Proxying here means
    // the browser only ever talks to its own origin, so no CORS applies at all.
    //
    // `rewrite` mirrors Caddy's `handle_path /api/*`, which strips the prefix:
    // the browser's /api/health must reach Hono as /health, in dev and in
    // production alike.
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8080",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
