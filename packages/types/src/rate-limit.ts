// Contract for the AppView's search rate limit.
//
// The limit exists to keep one VPS answerable when the search surface is open
// to visitors who have not logged in (ADR-0017). It is deliberately generous:
// the point is to make an automated crawl uninteresting, not to ration reading.
//
// **It applies to every caller, not only to logged-out ones**, and that is
// forced rather than chosen: authentication in this app is browser-only AT
// Proto OAuth (ADR-0002), so the API is never in the auth path and has no
// session to inspect. A window this wide is what makes that acceptable — a
// human reading a dictionary never meets it, and the one client that polls
// (waiting for its own record to be indexed) paces itself against the constant
// below rather than being throttled by it.

/**
 * Minimum interval between two searches from one client, in milliseconds.
 *
 * Shared so the browser can pace its own polling against the server's window
 * instead of guessing at it, and so a 429 the client cannot avoid is a bug in
 * one place rather than a drift between two.
 */
export const SEARCH_RATE_LIMIT_MS = 5_000;

/**
 * How long an idle client is remembered, in milliseconds. Anything longer than
 * the window itself is pure memory: an entry older than the window can only
 * ever allow the next request.
 *
 * The cache is swept on this period rather than expired on read, because an IP
 * that never comes back is never read again — and on a public endpoint the
 * ones that never come back are most of them.
 */
export const SEARCH_RATE_LIMIT_SWEEP_MS = 60_000;

/** Body of a 429 from a search endpoint. */
export interface RateLimitedResponse {
  error: "rate limited";
  /**
   * Milliseconds until this client's next search is allowed. Sent as a number
   * of ms as well as in the `Retry-After` header, which is whole seconds only
   * and would round a 400 ms wait up to a full one.
   */
  retryAfterMs: number;
}
