/**
 * Check if a book is pre-publication based on its publication date or year.
 * Handles multiple date formats: "2026-04-01", "05/12/2026", "2025-12", "April 2026", etc.
 * Returns true if the book hasn't been published yet.
 */
export function isBookPrePublication(
  publicationDate: string | null | undefined,
  publicationYear: number | null | undefined
): boolean {
  const now = new Date();

  // Try full date first
  if (publicationDate) {
    const parsed = parsePubDate(publicationDate);
    if (parsed && parsed > now) return true;
    if (parsed) return false; // Has a valid date in the past
  }

  // Fall back to year comparison
  if (publicationYear && publicationYear > now.getFullYear()) {
    return true;
  }

  return false;
}

function parsePubDate(dateStr: string): Date | null {
  // Try ISO format: "2026-04-01" or "2026-04"
  if (/^\d{4}-\d{2}(-\d{2})?$/.test(dateStr)) {
    const d = new Date(dateStr + (dateStr.length === 7 ? "-01" : ""));
    return isNaN(d.getTime()) ? null : d;
  }

  // Try US format: "05/12/2026" or "5/12/2026"
  const usMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (usMatch) {
    const d = new Date(+usMatch[3], +usMatch[1] - 1, +usMatch[2]);
    return isNaN(d.getTime()) ? null : d;
  }

  // Try "Month YYYY" or "Month DD, YYYY"
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Format the publication date for display.
 * Returns a human-readable string like "May 12, 2026".
 */
export function formatPubDate(
  publicationDate: string | null | undefined,
  publicationYear: number | null | undefined
): string | null {
  if (publicationDate) {
    const parsed = parsePubDate(publicationDate);
    if (parsed) {
      return parsed.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      });
    }
  }
  if (publicationYear) return `${publicationYear}`;
  return null;
}
