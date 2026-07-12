import { aql } from "arangojs";
import { LEKSIS_LANGUAGE_COLLECTION } from "@leksis/types";
import { db } from "../db";
import { ingestLanguage, ingestLanguageDelete } from "./ingest-language";

// Jetstream consumer (ADR-0003): the AppView indexes eu.leksis.* records from
// Bluesky's JSON firehose instead of raw com.atproto.sync.subscribeRepos —
// server-side collection filtering keeps bandwidth negligible on one VPS.
// Runs inside the api process; a consumer failure must never take down HTTP,
// so every path here logs and retries rather than throwing.

const JETSTREAM_URL =
  process.env.JETSTREAM_URL ?? "wss://jetstream2.us-east.bsky.network/subscribe";

// Widened per loop (entries arrive in week 4).
const WANTED_COLLECTIONS = [LEKSIS_LANGUAGE_COLLECTION];

const CURSOR_KEY = "jetstream";
const CURSOR_SAVE_INTERVAL_MS = 10_000;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_CAP_MS = 60_000;

/** Shape of the Jetstream events we consume (subset). */
interface JetstreamCommitEvent {
  did: string;
  time_us: number;
  kind: "commit" | "identity" | "account";
  commit?: {
    operation: "create" | "update" | "delete";
    collection: string;
    rkey: string;
    record?: unknown;
    cid?: string;
  };
}

async function loadCursor(): Promise<number | null> {
  const cursor = await db.query<number>(aql`
    FOR s IN firehoseState FILTER s._key == ${CURSOR_KEY} RETURN s.cursor
  `);
  return (await cursor.next()) ?? null;
}

async function saveCursor(timeUs: number): Promise<void> {
  await db.query(aql`
    UPSERT { _key: ${CURSOR_KEY} }
      INSERT { _key: ${CURSOR_KEY}, cursor: ${timeUs}, updatedAt: DATE_ISO8601(DATE_NOW()) }
      UPDATE { cursor: ${timeUs}, updatedAt: DATE_ISO8601(DATE_NOW()) }
      IN firehoseState
  `);
}

async function handleEvent(event: JetstreamCommitEvent): Promise<void> {
  if (event.kind !== "commit" || !event.commit) return;
  const { operation, collection, rkey, record, cid } = event.commit;
  if (collection !== LEKSIS_LANGUAGE_COLLECTION) return;

  const recordURI = `at://${event.did}/${collection}/${rkey}`;
  if (operation === "delete") {
    await ingestLanguageDelete(recordURI);
  } else {
    await ingestLanguage(event.did, recordURI, cid ?? "", record);
  }
}

/**
 * Start the Jetstream consumer: resume from the persisted cursor, process
 * events sequentially, save the cursor periodically, reconnect forever with
 * capped exponential backoff + jitter. Replay overlap after a reconnect is
 * harmless — ingestion is idempotent.
 */
export async function startJetstream(): Promise<void> {
  let cursor: number | null = null;
  try {
    cursor = await loadCursor();
  } catch (err) {
    console.error("jetstream: could not load cursor, starting from now:", err);
  }

  let attempt = 0;
  let queue: Promise<void> = Promise.resolve();

  const connect = () => {
    const params = new URLSearchParams();
    for (const c of WANTED_COLLECTIONS) params.append("wantedCollections", c);
    if (cursor !== null) params.set("cursor", String(cursor));
    const url = `${JETSTREAM_URL}?${params.toString()}`;

    const ws = new WebSocket(url);
    let saveTimer: ReturnType<typeof setInterval> | undefined;

    ws.addEventListener("open", () => {
      attempt = 0;
      console.log(
        `jetstream: connected (${cursor !== null ? `cursor ${cursor}` : "live tail"})`,
      );
      saveTimer = setInterval(() => {
        if (cursor !== null) {
          saveCursor(cursor).catch((err) =>
            console.error("jetstream: cursor save failed:", err),
          );
        }
      }, CURSOR_SAVE_INTERVAL_MS);
    });

    ws.addEventListener("message", (msg) => {
      let event: JetstreamCommitEvent;
      try {
        event = JSON.parse(String(msg.data)) as JetstreamCommitEvent;
      } catch {
        return;
      }
      // Sequential processing: each event waits for the previous one, so
      // same-tag versions are archived in arrival order.
      queue = queue
        .then(() => handleEvent(event))
        .catch((err) => console.error("jetstream: event handling failed:", err))
        .then(() => {
          if (typeof event.time_us === "number") cursor = event.time_us;
        });
    });

    // Node's native WebSocket fires only "error" (no "close") when the
    // connection itself fails, so both events lead here; the flag keeps
    // one reconnect per socket.
    let reconnectScheduled = false;
    const scheduleReconnect = () => {
      if (reconnectScheduled) return;
      reconnectScheduled = true;
      if (saveTimer !== undefined) clearInterval(saveTimer);
      attempt += 1;
      const backoff = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (attempt - 1));
      const delay = backoff / 2 + Math.random() * (backoff / 2);
      console.warn(`jetstream: disconnected, reconnecting in ${Math.round(delay)}ms`);
      setTimeout(connect, delay);
    };

    ws.addEventListener("close", scheduleReconnect);
    ws.addEventListener("error", (event) => {
      const message = (event as { message?: string }).message ?? event.type;
      console.error("jetstream: socket error:", message);
      scheduleReconnect();
    });
  };

  connect();
}
