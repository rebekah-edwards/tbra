/**
 * dupe-overlap.ts — shared collision detection for the title+author dedup tools.
 *
 * WHY THIS EXISTS
 * ---------------
 * `replay-dedup-both.ts` migrates a dupe's user rows onto the canonical with
 * `INSERT OR IGNORE ... SELECT`, then unconditionally DELETEs the dupe's rows.
 * That is a clean re-point ONLY when no user holds rows on BOTH books. If a user
 * has, say, "read + 5★ + a review" on the dupe and "want to read" on the canonical,
 * the OR IGNORE drops the dupe's row on the PK clash and the DELETE removes it —
 * the rating and review are gone. That is silent user-visible data loss.
 *
 * `find-title-author-dupes.ts` used to avoid this with a blunt proxy: only
 * auto-merge when every non-canonical row has ZERO users. That blocked every
 * multi-user group even though the overwhelming majority have no overlapping
 * user at all. This module replaces the proxy with the real check, so groups
 * with user data on both rows can auto-merge when nobody is on both sides.
 *
 * Both the scanner (decides what goes in the manifest) and the applier (guards
 * against activity added between scan and apply) import from here — the table
 * list must never drift between them, or a silent drop reappears.
 */
import type { Client } from "@libsql/client";
import type Database from "better-sqlite3";

/**
 * Tables whose rows are UNIQUE per (owner, book) — these are the ones moved with
 * INSERT OR IGNORE, and therefore the only ones that can silently lose a row.
 * MUST stay identical to MOVE_UNIQUE in replay-dedup-both.ts (which imports it).
 *
 * MOVE_APPEND tables (reading_sessions, reading_notes, …) are moved with a plain
 * UPDATE of book_id and have no per-book uniqueness, so they cannot collide.
 */
export const MOVE_UNIQUE = [
  "user_book_state",
  "user_book_ratings",
  "user_book_reviews",
  "user_favorite_books",
  "user_hidden_books",
  "user_owned_editions",
  "up_next",
  "tbr_notes",
  "shelf_books",
];

/** Uniform read interface over better-sqlite3 (sync) and libsql (async). */
export type OverlapRunner = {
  label: string;
  cols: (table: string) => Promise<string[] | null>;
  query: (sql: string, args: unknown[]) => Promise<Record<string, unknown>[]>;
};

export function tursoRunner(client: Client): OverlapRunner {
  const cache = new Map<string, string[] | null>();
  return {
    label: "turso",
    async cols(table) {
      if (cache.has(table)) return cache.get(table)!;
      try {
        const r = await client.execute({ sql: `SELECT * FROM ${table} LIMIT 0`, args: [] });
        cache.set(table, r.columns);
        return r.columns;
      } catch {
        cache.set(table, null);
        return null;
      }
    },
    async query(sql, args) {
      const r = await client.execute({ sql, args: args as never[] });
      return r.rows as unknown as Record<string, unknown>[];
    },
  };
}

export function localRunner(db: Database.Database): OverlapRunner {
  const cache = new Map<string, string[] | null>();
  return {
    label: "local",
    async cols(table) {
      if (cache.has(table)) return cache.get(table)!;
      try {
        const c = db.prepare(`SELECT * FROM ${table} LIMIT 0`).columns().map((x) => x.name);
        cache.set(table, c);
        return c;
      } catch {
        cache.set(table, null);
        return null;
      }
    },
    async query(sql, args) {
      return db.prepare(sql).all(...(args as never[])) as Record<string, unknown>[];
    },
  };
}

/**
 * Returns a list of "table:count" strings describing every place the SAME owner
 * holds a row on both books. Empty array === safe to merge with INSERT OR IGNORE.
 *
 * "Owner" is user_id where present, else shelf_id (shelf_books is keyed by shelf,
 * so the collision there is "one shelf already contains both books").
 */
export async function findUserOverlap(
  run: OverlapRunner,
  canonicalId: string,
  dupeId: string,
): Promise<string[]> {
  const hits: string[] = [];
  for (const t of MOVE_UNIQUE) {
    const cols = await run.cols(t);
    if (!cols || !cols.includes("book_id")) continue;
    const owner = cols.includes("user_id") ? "user_id" : cols.includes("shelf_id") ? "shelf_id" : null;
    if (!owner) continue; // no per-owner uniqueness to collide on
    const rows = await run.query(
      `SELECT COUNT(*) AS n FROM (
         SELECT ${owner} FROM ${t} WHERE book_id = ?
         INTERSECT
         SELECT ${owner} FROM ${t} WHERE book_id = ?
       )`,
      [dupeId, canonicalId],
    );
    const n = Number(rows[0]?.n ?? 0);
    if (n > 0) hits.push(`${t}:${n}`);
  }
  return hits;
}
