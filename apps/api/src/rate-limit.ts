import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context, MiddlewareHandler } from "hono";
import {
  SEARCH_RATE_LIMIT_MS,
  SEARCH_RATE_LIMIT_SWEEP_MS,
  type RateLimitedResponse,
} from "@leksis/types";

/*
 * Per-IP rate limiting for the search endpoints (ADR-0017).
 *
 * In-process and in-memory on purpose. The AppView is one Hono process on one
 * VPS, so a Map in that process is the whole coordination problem; Redis, a
 * token bucket and a rate-limiting dependency would each add an operational
 * surface to enforce a rule that is one comparison. The properties that come
 * with that choice are stated rather than discovered: state is lost on restart
 * (a deploy briefly forgives everyone, which is harmless), and it does not
 * survive horizontal scaling (there is no second instance; the day there is,
 * this moves to a shared store and the shape of the middleware does not
 * change).
 */

/** Last *allowed* search per client, as epoch ms. */
const lastAllowed = new Map<string, number>();

/**
 * Drop clients that could no longer be refused anyway. Without this the map is
 * a slow leak keyed by the internet — every crawler that ever hit the search
 * endpoint would be remembered until the process restarted.
 *
 * `unref()` so a sweep timer never keeps the process alive on shutdown.
 */
const sweeper = setInterval(() => {
  const cutoff = Date.now() - SEARCH_RATE_LIMIT_MS;
  for (const [key, at] of lastAllowed) {
    if (at <= cutoff) lastAllowed.delete(key);
  }
}, SEARCH_RATE_LIMIT_SWEEP_MS);
sweeper.unref();

/**
 * The address to key on.
 *
 * **The rightmost `X-Forwarded-For` entry, not the leftmost.** Caddy *appends*
 * the connecting peer to whatever the client sent, so the last element is the
 * only one Caddy wrote and the only one a client cannot forge; reading the
 * conventional leftmost entry would let any caller mint a fresh identity per
 * request by sending its own header, which is a rate limiter that rate-limits
 * nobody. Nothing but Caddy can reach this process — the container is never
 * published to a host port — so there is exactly one hop to trust.
 *
 * With no header at all (direct access in dev) it falls back to the socket
 * address, and to a single shared bucket if even that is unavailable: an
 * unidentifiable client is limited *with* the others rather than exempted.
 */
function clientKey(c: Context): string {
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded !== undefined) {
    const hops = forwarded.split(",");
    const peer = hops[hops.length - 1]?.trim();
    if (peer !== undefined && peer !== "") return peer;
  }
  return getConnInfo(c).remote.address ?? "unknown";
}

/**
 * Refuse a second search from the same address inside the window.
 *
 * **One bucket for the whole search family, not one per route.** The three
 * search endpoints are alternatives for answering one question, so a per-route
 * limit would hand a caller three times the allowance for alternating between
 * them — and `/translate`, the graph traversal, is the expensive one it would
 * be cheapest to reach that way.
 *
 * The refusal carries how long to wait, in both the standard header and the
 * body, so a client never has to hardcode the window to behave well.
 */
export const searchRateLimit: MiddlewareHandler = async (c, next) => {
  const key = clientKey(c);
  const now = Date.now();
  const previous = lastAllowed.get(key);

  if (previous !== undefined && now - previous < SEARCH_RATE_LIMIT_MS) {
    const retryAfterMs = SEARCH_RATE_LIMIT_MS - (now - previous);
    const body: RateLimitedResponse = { error: "rate limited", retryAfterMs };
    // Whole seconds, rounded UP: a Retry-After of 0 invites an immediate retry
    // that can only be refused again.
    c.header("Retry-After", String(Math.ceil(retryAfterMs / 1000)));
    return c.json(body, 429);
  }

  // Stamped before the handler, not after: the window is between the *arrivals*
  // of two searches. Stamping on the way out would start the clock when the
  // slowest query finished, which is precisely when it should already be
  // running — a heavy traversal would buy the next request a longer allowance
  // than a cheap one.
  lastAllowed.set(key, now);
  await next();
};

/** Test/maintenance hook: forget every remembered client. */
export function resetSearchRateLimit(): void {
  lastAllowed.clear();
}
