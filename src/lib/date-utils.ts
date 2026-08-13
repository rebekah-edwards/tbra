/**
 * Parse a timestamp as stored in the database.
 *
 * Timestamps arrive in TWO shapes: columns written by JS carry a proper ISO
 * string with a trailing Z ("2026-08-13T04:44:43.961Z"), while columns using
 * the SQL `datetime('now')` default are naive UTC ("2026-08-12 03:48:00") —
 * reading_notes.created_at, reading_sessions.created_at and
 * user_book_reviews.created_at are all the naive kind.
 *
 * `new Date("2026-08-12 03:48:00")` parses the naive form as LOCAL time, so
 * anything logged late in the evening displayed a day LATE: a note written at
 * 11:48pm Eastern on Aug 11 rendered as "Aug 12". That made the reading
 * journal disagree with the reading streak, which has always normalised to
 * UTC — and sent a reader hunting for a streak bug that wasn't there.
 *
 * Marking the naive form as UTC makes every surface agree.
 */
export function parseDbDate(raw: string | Date): Date {
  if (raw instanceof Date) return raw;
  let s = String(raw).trim().replace(" ", "T");
  if (!/[Zz]|[+-]\d{2}:?\d{2}$/.test(s)) s += "Z";
  return new Date(s);
}

/**
 * Returns a human-readable relative time string like "2d ago", "3w ago", "2mo ago".
 * Years: 365+ days = 1y ago, 730+ = 2y ago, etc.
 */
export function timeAgo(dateString: string): string {
  const now = Date.now();
  const then = parseDbDate(dateString).getTime();
  const seconds = Math.floor((now - then) / 1000);

  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  // 365+ days → years (365 = 1y, 730 = 2y, etc.)
  if (days >= 365) {
    const years = Math.floor(days / 365);
    return `${years}y ago`;
  }

  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;

  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}
