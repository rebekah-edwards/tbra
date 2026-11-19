import { db } from "@/db";
import { sql } from "drizzle-orm";
import { CUSTOM_GOAL_KINDS, CUSTOM_GOAL_MAX, type CustomGoalKind } from "@/lib/queries/custom-goals";

/**
 * User-scoped writes for premium custom goals, shared by the web actions and
 * /api/v1/goals/*. Callers enforce the premium gate.
 *
 * Removal is a SOFT delete (active=0 + fresh updated_at): the two-way
 * local/prod sync never deletes, so a hard delete would be resurrected by the
 * next tick (the 2026-07 TBR-resurrection incident).
 */

type Result = { success: boolean; error?: string; id?: string };

const UNIT: Record<CustomGoalKind, string> = {
  pages: "pages",
  hours: "hours",
  days: "days",
  genre: "books",
};

export async function setCustomGoalFor(
  userId: string,
  input: { kind: string; target: number; genreName?: string | null; year?: number },
): Promise<Result> {
  const kind = input.kind as CustomGoalKind;
  if (!CUSTOM_GOAL_KINDS.includes(kind)) return { success: false, error: "Unknown goal type." };

  const target = Math.trunc(input.target);
  const max = CUSTOM_GOAL_MAX[kind];
  if (!Number.isFinite(target) || target < 1 || target > max) {
    return { success: false, error: `Goal must be between 1 and ${max.toLocaleString("en-US")} ${UNIT[kind]}.` };
  }

  const genreName = kind === "genre" ? (input.genreName ?? "").trim() : null;
  if (kind === "genre" && (!genreName || genreName.length > 80)) {
    return { success: false, error: "Pick a genre for this goal." };
  }

  const year = input.year ?? new Date().getFullYear();
  const goalKey = kind === "genre" ? `genre:${genreName!.toLowerCase()}` : kind;
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  // Upsert on (user, year, goal_key): re-adding a removed goal revives it.
  await db.run(sql`
    INSERT INTO custom_goals (id, user_id, year, kind, genre_name, goal_key, target, active, created_at, updated_at)
    VALUES (${id}, ${userId}, ${year}, ${kind}, ${genreName}, ${goalKey}, ${target}, 1, ${now}, ${now})
    ON CONFLICT (user_id, year, goal_key) DO UPDATE SET
      target = excluded.target,
      genre_name = excluded.genre_name,
      active = 1,
      updated_at = excluded.updated_at
  `);
  const row = (await db.all(sql`
    SELECT id FROM custom_goals WHERE user_id = ${userId} AND year = ${year} AND goal_key = ${goalKey}
  `)) as { id: string }[];
  return { success: true, id: row[0]?.id };
}

export async function removeCustomGoalFor(userId: string, goalId: string): Promise<Result> {
  await db.run(sql`
    UPDATE custom_goals SET active = 0, updated_at = ${new Date().toISOString()}
    WHERE id = ${goalId} AND user_id = ${userId}
  `);
  return { success: true };
}

/** A reader's own audiobook length for a book (minutes, 1 min to 200 h). */
export async function setAudioLengthFor(userId: string, bookId: string, minutes: number): Promise<Result> {
  const m = Math.round(minutes);
  if (!Number.isFinite(m) || m < 1 || m > 200 * 60) {
    return { success: false, error: "Length must be between 1 minute and 200 hours." };
  }
  const exists = (await db.all(sql`SELECT 1 AS ok FROM books WHERE id = ${bookId}`)) as { ok: number }[];
  if (exists.length === 0) return { success: false, error: "Book not found." };

  await db.run(sql`
    INSERT INTO user_audio_lengths (user_id, book_id, minutes, updated_at)
    VALUES (${userId}, ${bookId}, ${m}, ${new Date().toISOString()})
    ON CONFLICT (user_id, book_id) DO UPDATE SET minutes = excluded.minutes, updated_at = excluded.updated_at
  `);
  return { success: true };
}

/** A reader's own page count for a book whose catalog count is missing
 *  (counts for their Pages goal; admins see it as a suggestion). */
export async function setPageCountFor(userId: string, bookId: string, pages: number): Promise<Result> {
  const p = Math.round(pages);
  if (!Number.isFinite(p) || p < 1 || p > 20000) {
    return { success: false, error: "Pages must be between 1 and 20,000." };
  }
  const exists = (await db.all(sql`SELECT 1 AS ok FROM books WHERE id = ${bookId}`)) as { ok: number }[];
  if (exists.length === 0) return { success: false, error: "Book not found." };

  await db.run(sql`
    INSERT INTO user_page_counts (user_id, book_id, pages, updated_at)
    VALUES (${userId}, ${bookId}, ${p}, ${new Date().toISOString()})
    ON CONFLICT (user_id, book_id) DO UPDATE SET pages = excluded.pages, updated_at = excluded.updated_at
  `);
  return { success: true };
}
