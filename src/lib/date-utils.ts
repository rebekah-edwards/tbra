/**
 * Returns a human-readable relative time string like "2d ago", "3w ago", "2mo ago".
 * Years: 365+ days = 1y ago, 730+ = 2y ago, etc.
 */
export function timeAgo(dateString: string): string {
  const now = Date.now();
  const then = new Date(dateString).getTime();
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
