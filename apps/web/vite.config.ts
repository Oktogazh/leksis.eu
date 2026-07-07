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
  },
});
