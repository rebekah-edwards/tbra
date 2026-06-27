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

/**
 * Normalize a raw publication-date string from any source (OpenLibrary,
 * ISBNdb, Google Books, NYT) into a canonical, sortable form plus an
 * extracted year.
 *
 * The `publication_date` column has historically held a mess of formats
 * ("22 March 2018", "25.07.2023", "2016", "April 2026", "2026-09-15"),
 * which made the lexical `publication_date > today` comparison the
 * upcoming-releases lane relies on unreliable. This is the single choke
 * point that converts everything to ISO before it's written.
 *
 * Returns:
 *   - `date`: ISO `YYYY-MM-DD` when day precision is known, `YYYY-MM` when
 *     only month precision is known, else `null` (year-only / unparseable).
 *   - `year`: the 4-digit year when recoverable, else `null`.
 *
 * Implausible years (< 1000 or > currentYear + 3) are treated as junk and
 * yield `{ date: null, year: null }` — these are almost always scrape leaks
 * (e.g. "2075", "2098") rather than real far-future preorders.
 *
 * `precision` distinguishes how much of the date we actually trust, so
 * callers can avoid fabricating a day/month that a source never supplied.
 */
export function normalizePubDate(
  raw: string | null | undefined
): { date: string | null; year: number | null; precision: "day" | "month" | "year" | "none" } {
  if (raw == null) return { date: null, year: null, precision: "none" };
  const str = String(raw).trim();
  if (!str) return { date: null, year: null, precision: "none" };

  const maxYear = new Date().getFullYear() + 3;
  const plausible = (y: number) => y >= 1000 && y <= maxYear;

  // Year-only — handle explicitly so we don't let `new Date("2016")` coerce
  // it to a UTC-midnight timestamp that can drift across the year boundary.
  const yearOnly = str.match(/^(\d{4})$/);
  if (yearOnly) {
    const y = +yearOnly[1];
    return plausible(y) ? { date: null, year: y, precision: "year" } : { date: null, year: null, precision: "none" };
  }

  // ISO year-month — "2026-09" (keep month precision, don't fake a day).
  const isoYm = str.match(/^(\d{4})-(\d{2})$/);
  if (isoYm) {
    const y = +isoYm[1], m = +isoYm[2];
    if (plausible(y) && m >= 1 && m <= 12) {
      return { date: `${isoYm[1]}-${isoYm[2]}`, year: y, precision: "month" };
    }
    return { date: null, year: null, precision: "none" };
  }

  // Everything else (ISO full date, US slashes, European dots, prose) goes
  // through parsePubDate, which already understands those shapes. We then
  // re-emit a canonical ISO string at day precision.
  const parsed = parsePubDate(str);
  if (parsed && !isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    if (!plausible(y)) return { date: null, year: null, precision: "none" };
    const iso = `${y}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
    return { date: iso, year: y, precision: "day" };
  }

  // Last resort — pull a 4-digit year out of free text ("Released Fall 2026").
  const loose = str.match(/(?:^|\D)(\d{4})(?:\D|$)/);
  if (loose) {
    const y = +loose[1];
    if (plausible(y)) return { date: null, year: y, precision: "year" };
  }

  return { date: null, year: null, precision: "none" };
}

function parsePubDate(dateStr: string): Date | null {
  // Try ISO format: "2026-04-01" or "2026-04"
  if (/^\d{4}-\d{2}(-\d{2})?$/.test(dateStr)) {
    // Build from explicit local components — `new Date("2026-09-15")` parses as
    // UTC midnight, which then reads back as the 14th in any timezone behind
    // UTC. Constructing with numeric args keeps it local and off-by-one-free.
    const [y, m, day] = dateStr.split("-").map(Number);
    if (m < 1 || m > 12 || (day !== undefined && (day < 1 || day > 31))) return null;
    const d = new Date(y, m - 1, day ?? 1);
    return isNaN(d.getTime()) ? null : d;
  }

  // Try slash format: "05/12/2026" or "5/12/2026". Default to US MM/DD/YYYY,
  // but if the first field is > 12 it can't be a month, so treat it as
  // European DD/MM/YYYY ("25/08/2026" → 25 Aug, not month 25).
  const slashMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    let month = +slashMatch[1], day = +slashMatch[2];
    if (month > 12 && day <= 12) {
      [month, day] = [day, month];
    }
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const d = new Date(+slashMatch[3], month - 1, day);
      return isNaN(d.getTime()) ? null : d;
    }
    return null;
  }

  // Try European dotted format: "25.07.2023" or "26.7.2012" (DD.MM.YYYY)
  const euMatch = dateStr.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (euMatch) {
    const day = +euMatch[1], month = +euMatch[2];
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const d = new Date(+euMatch[3], month - 1, day);
      return isNaN(d.getTime()) ? null : d;
    }
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
