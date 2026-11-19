import { db } from "@/db";
import { sql } from "drizzle-orm";

/**
 * A reader's distinct READS finished in a year — re-reads included.
 *
 * Why not `count(DISTINCT book_id)`: that threw away genuine re-reads, so a
 * book finished in March and again in June counted once toward the yearly
 * goal (tester report 2026-11-19: "re-reads aren't calculated in my reading
 * goal").
 *
 * Why not one per session row: imports leave near-duplicate sessions for one
 * read — a month-only Goodreads date beside an exact StoryGraph date days
 * apart, or the same month row imported several times. Measured on prod
 * 2026-11-19: most multi-session books in a year were these duplicates.
 *
 * Rule: walk each book's finishes in date order; a finish starts a NEW read
 * only when it is clearly separate from the last counted one — more than
 * EXACT_GAP_DAYS apart when both dates are exact, more than MONTH_GAP_DAYS
 * when either is month-only (a month date stands for "sometime that month").
 * Only real completion dates count (precision NOT NULL), as before.
 */
const EXACT_GAP_DAYS = 14;
const MONTH_GAP_DAYS = 31;

export interface YearRead {
  bookId: string;
  completionDate: string;
  completionPrecision: string;
  activeFormats: string | null;
}

interface Row {
  book_id: string;
  completion_date: string;
  completion_precision: string;
  active_formats: string | null;
}

function dayNumber(date: string): number {
  // completion_date is 'YYYY-MM-DD' (month-precision rows use day 01).
  const t = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(t) ? 0 : Math.floor(t / 86_400_000);
}

/** Pure dedupe step, exported for tests and for callers that already hold rows. */
export function distinctReads(rows: YearRead[]): YearRead[] {
  const byBook = new Map<string, YearRead[]>();
  for (const r of rows) {
    const list = byBook.get(r.bookId);
    if (list) list.push(r);
    else byBook.set(r.bookId, [r]);
  }

  const out: YearRead[] = [];
  for (const list of byBook.values()) {
    list.sort((a, b) => a.completionDate.localeCompare(b.completionDate));
    let anchor: YearRead | null = null;
    for (const r of list) {
      if (!anchor) {
        anchor = r;
        out.push(r);
        continue;
      }
      const monthOnly = anchor.completionPrecision === "month" || r.completionPrecision === "month";
      const gap = dayNumber(r.completionDate) - dayNumber(anchor.completionDate);
      if (gap > (monthOnly ? MONTH_GAP_DAYS : EXACT_GAP_DAYS)) {
        anchor = r;
        out.push(r);
      } else if (anchor.completionPrecision === "month" && r.completionPrecision !== "month") {
        // Same read, better date: keep the exact one as the representative.
        out[out.length - 1] = r;
        anchor = r;
      }
    }
  }
  return out;
}

export async function getYearReads(userId: string, year: number): Promise<YearRead[]> {
  const rows = (await db.all(sql`
    SELECT book_id, completion_date, completion_precision, active_formats
    FROM reading_sessions
    WHERE user_id = ${userId}
      AND state = 'completed'
      AND completion_date LIKE ${`${year}-%`}
      AND completion_precision IS NOT NULL
  `)) as Row[];

  return distinctReads(
    rows.map((r) => ({
      bookId: r.book_id,
      completionDate: r.completion_date,
      completionPrecision: r.completion_precision,
      activeFormats: r.active_formats,
    })),
  );
}
