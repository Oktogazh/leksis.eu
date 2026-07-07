import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./i18n"; // initialise i18next before any component calls t()
import "./index.css";
import App from "./App";
import { ThemeProvider } from "./theme/ThemeProvider";
import { SessionProvider } from "./auth/SessionProvider";
import { ensureLoopbackHost } from "./auth/client";

// In dev, canonicalise the host to 127.0.0.1 before rendering (and before any
// OAuth state is created); if a redirect is underway, don't mount.
if (!ensureLoopbackHost()) {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <ThemeProvider>
        <SessionProvider>
          <App />
        </SessionProvider>
      </ThemeProvider>
    </StrictMode>,
  );
}
