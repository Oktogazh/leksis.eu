/**
 * "2 hours ago" in the UI locale, from an ISO timestamp. Shared by the two
 * surfaces that show a stream of dated changes: a language's recent-changes
 * feed and a contributor's activity feed.
 *
 * Days are the coarsest unit on purpose — beyond that the exact date matters
 * more than the distance, and callers pair this with the timestamp itself.
 */
export function relativeTime(iso: string, locale: string): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 60) return rtf.format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return rtf.format(-hours, "hour");
  return rtf.format(-Math.round(hours / 24), "day");
}
