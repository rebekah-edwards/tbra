import { db } from "@/db";
import { sql } from "drizzle-orm";
import { getYearReads } from "./year-reads";
import { getActivityDays } from "./reading-streak";
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
             ual.minutes AS own_minutes
      FROM books b
      LEFT JOIN user_audio_lengths ual ON ual.book_id = b.id AND ual.user_id = ${userId}
      WHERE b.id IN (${sql.join(bookIds.map((id) => sql`${id}`), sql`, `)})
    `)) as {
      id: string; title: string; slug: string | null; cover_image_url: string | null;
      pages: number | null; audio_length_minutes: number | null; own_minutes: number | null;
    }[];
    for (const r of rows) {
      books.set(r.id, {
        title: r.title,
        slug: r.slug,
        cover: r.cover_image_url,
        pages: r.pages,
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

  const days = kinds.has("days")
    ? (await getActivityDays(userId)).filter((d) => d.startsWith(`${year}-`)).length
    : 0;

  return goals.map((g) => {
    const kind = g.kind as CustomGoalKind;
    let current = 0;
    let missingAudio: MissingAudioLength[] | undefined;

    if (kind === "pages") {
      for (const r of reads) {
        if (isAudioOnly(r.activeFormats)) continue;
        current += books.get(r.bookId)?.pages ?? 0;
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
      current = Math.round((minutes / 60) * 10) / 10;
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
