import { Database } from "arangojs";

/**
 * Single shared ArangoDB connection for the AppView.
 *
 * Credentials come from environment variables (set as Fly.io secrets in
 * production, or a local .env — see .env.example). No defaults for the
 * password: failing loudly beats silently connecting to the wrong place.
 */
export const db = new Database({
  url: process.env.ARANGO_URL ?? "http://127.0.0.1:8529",
  databaseName: process.env.ARANGO_DB ?? "glosis",
  auth: {
    username: process.env.ARANGO_USER ?? "root",
    password: process.env.ARANGO_PASSWORD ?? "",
  },
});

/** Lightweight liveness check used by the /health endpoint. */
export async function pingDb(): Promise<boolean> {
  try {
    await db.version();
    return true;
  } catch {
    return false;
  }
}
