import { db } from "@/db";
import { sql } from "drizzle-orm";
import { getYearReads } from "./year-reads";
import { getActivityDays } from "./reading-streak";
import { getReadingNow } from "./reading-now";
import { SPOILER_GENRE_NAMES_LOWER } from "@/lib/spoiler-genres";

/**
 * Premium custom goals (2026-11-19): pages read, hours listened, days read and
 * books in a genre, each per year, beside the free books goal. Progress is
 * computed from the same distinct-reads list as the books goal
 * (year-reads.ts), so re-reads count everywhere and duplicate import sessions
 * nowhere.
 */

export type CustomGoalKind = "pages" | "hours" | "days" | "genre";
export const CUSTOM_GOAL_KINDS: CustomGoalKind[] = ["pages", "hours", "days", "genre"];

/** Upper bounds for a target, per kind (the unit is the kind's own). */
export const CUSTOM_GOAL_MAX: Record<CustomGoalKind, number> = {
  pages: 200_000,
  hours: 5_000,
  days: 366,
  genre: 500,
};

export interface MissingAudioLength {
  bookId: string;
  title: string;
  slug: string | null;
  coverImageUrl: string | null;
}

export interface CustomGoalProgress {
  id: string;
  kind: CustomGoalKind;
  genreName: string | null;
  target: number;
  /** Pages, hours (one decimal), days or books — the kind's unit. */
  current: number;
  percentComplete: number;
  /** Pages / hours goals, current year: the part of `current` that comes
   *  from books still being read (their latest logged progress). */
  fromInProgress?: number;
  /** Hours goal only: finished listens with no known length, newest first. */
  missingAudio?: MissingAudioLength[];
}

interface GoalRow {
  id: string;
  kind: string;
  genre_name: string | null;
  target: number;
}

function isAudioOnly(formats: string | null): boolean {
  if (!formats) return false;
  return (
    formats.includes("audiobook") &&
    !formats.includes("hardcover") &&
    !formats.includes("paperback") &&
    !formats.includes("ebook")
  );
}

export async function getCustomGoals(userId: string, year: number): Promise<CustomGoalProgress[]> {
  const goals = (await db.all(sql`
    SELECT id, kind, genre_name, target
    FROM custom_goals
    WHERE user_id = ${userId} AND year = ${year} AND active = 1
    ORDER BY CASE kind WHEN 'pages' THEN 0 WHEN 'hours' THEN 1 WHEN 'days' THEN 2 ELSE 3 END, created_at
  `)) as GoalRow[];
  if (goals.length === 0) return [];

  const kinds = new Set(goals.map((g) => g.kind));
  const reads = kinds.has("pages") || kinds.has("hours") || kinds.has("genre")
    ? await getYearReads(userId, year)
    : [];
  const bookIds = [...new Set(reads.map((r) => r.bookId))];

  // One lookup for every book the year's reads touch.
  const books = new Map<string, { title: string; slug: string | null; cover: string | null; pages: number | null; audio: number | null }>();
  if (bookIds.length > 0) {
    const rows = (await db.all(sql`
      SELECT b.id, b.title, b.slug, b.cover_image_url, b.pages, b.audio_length_minutes,
             ual.minutes AS own_minutes, upc.pages AS own_pages
      FROM books b
      LEFT JOIN user_audio_lengths ual ON ual.book_id = b.id AND ual.user_id = ${userId}
      LEFT JOIN user_page_counts upc ON upc.book_id = b.id AND upc.user_id = ${userId}
      WHERE b.id IN (${sql.join(bookIds.map((id) => sql`${id}`), sql`, `)})
    `)) as {
      id: string; title: string; slug: string | null; cover_image_url: string | null;
      pages: number | null; audio_length_minutes: number | null; own_minutes: number | null; own_pages: number | null;
    }[];
    for (const r of rows) {
      books.set(r.id, {
        title: r.title,
        slug: r.slug,
        cover: r.cover_image_url,
        // Catalog first; the reader's own entry fills a missing count.
        pages: r.pages && r.pages > 0 ? r.pages : r.own_pages,
        // The reader's own entry wins over the catalog value.
        audio: r.own_minutes ?? r.audio_length_minutes,
      });
    }
  }

  // Genre membership, rolled up to the parent genre exactly like Stats' Top
  // Genres, for only the genres these goals ask about.
  const genreNames = goals.filter((g) => g.kind === "genre" && g.genre_name).map((g) => g.genre_name!.toLowerCase());
  const booksByGenre = new Map<string, Set<string>>();
  if (genreNames.length > 0 && bookIds.length > 0) {
    const rows = (await db.all(sql`
      SELECT DISTINCT bg.book_id, LOWER(COALESCE(parent.name, g.name)) AS genre
      FROM book_genres bg
      JOIN genres g ON g.id = bg.genre_id
      LEFT JOIN genres parent ON parent.id = g.parent_genre_id
      WHERE bg.book_id IN (${sql.join(bookIds.map((id) => sql`${id}`), sql`, `)})
        AND LOWER(COALESCE(parent.name, g.name)) IN (${sql.join(genreNames.map((n) => sql`${n}`), sql`, `)})
    `)) as { book_id: string; genre: string }[];
    for (const r of rows) {
      const set = booksByGenre.get(r.genre) ?? new Set<string>();
      set.add(r.book_id);
      booksByGenre.set(r.genre, set);
    }
  }

  // Books being read right now count their logged progress toward the
  // current year's pages / hours goals (Rebekah 2026-11-19: "count
  // progress"). Same progress Reading Now shows; once the book is finished,
  // the full book counts instead (it leaves currently_reading).
  const isCurrentYear = year === new Date().getFullYear();
  const inProgress =
    isCurrentYear && (kinds.has("pages") || kinds.has("hours"))
      ? (await getReadingNow(userId)).filter((b) => (b.progress ?? 0) > 0)
      : [];
  const ownMinutes = new Map<string, number>();
  const ownPages = new Map<string, number>();
  if (inProgress.length > 0) {
    const ids = sql.join(inProgress.map((b) => sql`${b.id}`), sql`, `);
    const [mins, pgs] = await Promise.all([
      db.all(sql`SELECT book_id, minutes AS v FROM user_audio_lengths WHERE user_id = ${userId} AND book_id IN (${ids})`),
      db.all(sql`SELECT book_id, pages AS v FROM user_page_counts WHERE user_id = ${userId} AND book_id IN (${ids})`),
    ]) as [{ book_id: string; v: number }[], { book_id: string; v: number }[]];
    for (const r of mins) ownMinutes.set(r.book_id, r.v);
    for (const r of pgs) ownPages.set(r.book_id, r.v);
  }

  const days = kinds.has("days")
    ? (await getActivityDays(userId)).filter((d) => d.startsWith(`${year}-`)).length
    : 0;

  return goals.map((g) => {
    const kind = g.kind as CustomGoalKind;
    let current = 0;
    let missingAudio: MissingAudioLength[] | undefined;

    let fromInProgress: number | undefined;

    if (kind === "pages") {
      for (const r of reads) {
        if (isAudioOnly(r.activeFormats)) continue;
        current += books.get(r.bookId)?.pages ?? 0;
      }
      if (isCurrentYear) {
        let partial = 0;
        for (const b of inProgress) {
          const pages = b.pages && b.pages > 0 ? b.pages : ownPages.get(b.id);
          if (isAudioOnly(JSON.stringify(b.activeFormats)) || !pages) continue;
          partial += Math.round((pages * (b.progress ?? 0)) / 100);
        }
        current += partial;
        fromInProgress = partial;
      }
    } else if (kind === "hours") {
      let minutes = 0;
      const missing = new Map<string, MissingAudioLength>();
      const listens = reads
        .filter((r) => r.activeFormats?.includes("audiobook"))
        .sort((a, b) => b.completionDate.localeCompare(a.completionDate));
      for (const r of listens) {
        const b = books.get(r.bookId);
        if (b?.audio) minutes += b.audio;
        else if (b && !missing.has(r.bookId)) {
          missing.set(r.bookId, { bookId: r.bookId, title: b.title, slug: b.slug, coverImageUrl: b.cover });
        }
      }
      let partialMinutes = 0;
      for (const b of inProgress) {
        if (!b.activeFormats.includes("audiobook")) continue;
        const length = ownMinutes.get(b.id) ?? b.audioLengthMinutes;
        if (length) partialMinutes += (length * (b.progress ?? 0)) / 100;
        else if (!missing.has(b.id)) {
          missing.set(b.id, { bookId: b.id, title: b.title, slug: b.slug, coverImageUrl: b.coverImageUrl });
        }
      }
      minutes += partialMinutes;
      current = Math.round((minutes / 60) * 10) / 10;
      if (isCurrentYear) fromInProgress = Math.round((partialMinutes / 60) * 10) / 10;
      missingAudio = [...missing.values()];
    } else if (kind === "days") {
      current = days;
    } else if (kind === "genre") {
      const set = booksByGenre.get((g.genre_name ?? "").toLowerCase());
      current = set ? reads.filter((r) => set.has(r.bookId)).length : 0;
    }

    return {
      id: g.id,
      kind,
      genreName: g.genre_name,
      target: g.target,
      current,
      percentComplete: g.target > 0 ? Math.min(100, Math.round((current / g.target) * 100)) : 0,
      ...(fromInProgress ? { fromInProgress } : {}),
      ...(missingAudio ? { missingAudio } : {}),
    };
  });
}

/** Rolled-up genres across the reader's library, most-shelved first — the
 *  choices for a "Books in a genre" goal. */
export async function getLibraryGenres(userId: string, limit = 40): Promise<string[]> {
  const rows = (await db.all(sql`
    SELECT COALESCE(parent.name, g.name) AS genre, COUNT(DISTINCT ubs.book_id) AS n
    FROM user_book_state ubs
    JOIN book_genres bg ON bg.book_id = ubs.book_id
    JOIN genres g ON g.id = bg.genre_id
    LEFT JOIN genres parent ON parent.id = g.parent_genre_id
    WHERE ubs.user_id = ${userId} AND ubs.state IS NOT NULL
      AND COALESCE(parent.name, g.name) != 'Own Voices'
      AND LOWER(g.name) NOT IN (${sql.join(SPOILER_GENRE_NAMES_LOWER.map((n) => sql`${n}`), sql`, `)})
    GROUP BY COALESCE(parent.name, g.name)
    ORDER BY n DESC
    LIMIT ${limit}
  `)) as { genre: string; n: number }[];
  return rows.map((r) => r.genre);
}
