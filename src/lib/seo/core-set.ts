/**
 * The SEO "core set": the only book pages we ask Google to index.
 *
 * Why this exists (2026-11-16): Google dropped the whole site to one indexed
 * page after we submitted ~104K templated URLs on a brand-new domain. Only
 * pages a real reader has touched AND that render as a complete page are
 * indexable; everything else is `noindex, follow` and stays out of the
 * sitemaps until it qualifies.
 *
 * The set is materialised in the `seo_index_books` table (book_id PK) by
 * `recomputeCoreSet()` — nightly via /api/cron/seo-index, or by hand with
 * scripts/seo-index-recompute.ts. Pages and sitemaps only ever READ that
 * table, so they stay one indexed lookup regardless of how expensive the
 * gate is (computing it live on Turso took 30-60s).
 *
 * This module must stay free of `@/db` imports: the standalone script feeds
 * it a raw Turso client, the cron route feeds it the app's Drizzle handle.
 */

/** Tunable gate. Loosen these to grow the indexed set once Google accepts it. */
export const CORE_GATE = {
  /** Minimum trimmed description length. */
  minDescriptionChars: 200,
  /** Minimum content-rating rows that say something (not a placeholder). */
  minRealRatings: 6,
  /** A cover is required. */
  requireCover: true,
  /** A series/author page is indexable once it lists this many core books. */
  minCoreBooksForListPage: 2,
} as const;

/** SQL predicate (alias `r`) for a content-rating row that carries information. */
export const REAL_RATING_SQL = `(r.notes IS NOT NULL AND TRIM(r.notes) <> '' AND r.notes NOT LIKE 'No evidence found%' AND r.notes NOT LIKE 'No information found%')`;

export const SEO_INDEX_TABLE_DDL = `CREATE TABLE IF NOT EXISTS seo_index_books (
  book_id TEXT PRIMARY KEY NOT NULL,
  added_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

/** Refuse to shrink an established set by more than this in one run. */
const MAX_SHRINK_RATIO = 0.3;
/** ...once the set is at least this big (lets the first runs through). */
const SHRINK_GUARD_MIN_SIZE = 1000;

export type SqlExec = (sql: string, args?: (string | number)[]) => Promise<Record<string, unknown>[]>;

export interface CoreSetReport {
  touchedBooks: number;
  evaluated: number;
  passing: number;
  /** How many touched books fail each criterion (a book can fail several). */
  failures: Record<string, number>;
  previousSize: number;
  added: number;
  removed: number;
  applied: boolean;
  aborted?: string;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const placeholders = (n: number) => Array(n).fill("?").join(",");

export function isValidSlug(slug: unknown): slug is string {
  return typeof slug === "string" && slug.length > 0 && !slug.startsWith("-") && !slug.includes("--");
}

/**
 * Recompute the core set and (unless dryRun) bring `seo_index_books` in line
 * with it. Only changed rows are written.
 */
export async function recomputeCoreSet(
  exec: SqlExec,
  opts: { dryRun?: boolean; force?: boolean } = {},
): Promise<CoreSetReport> {
  // 1. Books a real reader has touched: on a shelf (soft-deleted rows have
  //    state NULL) or reviewed.
  const touchedRows = await exec(
    `SELECT book_id FROM user_book_state WHERE state IS NOT NULL
     UNION
     SELECT book_id FROM user_book_reviews`,
  );
  const touched = touchedRows.map((r) => String(r.book_id));

  const failures: Record<string, number> = {
    not_public: 0,
    bad_slug: 0,
    no_title: 0,
    non_english: 0,
    no_cover: 0,
    short_description: 0,
    few_real_ratings: 0,
  };

  // 2. Page-completeness checks that live on the books row. Filtering happens
  //    in JS: `id IN (...) AND <other column>` sends Turso's planner down a
  //    non-PK index and turns a 65ms query into a scan.
  const metaPassing: string[] = [];
  let evaluated = 0;
  for (const ids of chunk(touched, 400)) {
    const rows = await exec(
      `SELECT id, slug, title, language, visibility,
              (cover_image_url IS NOT NULL AND TRIM(cover_image_url) <> '') AS has_cover,
              LENGTH(TRIM(COALESCE(description, ''))) AS dlen
       FROM books WHERE id IN (${placeholders(ids.length)})`,
      ids,
    );
    for (const b of rows) {
      evaluated++;
      let ok = true;
      if (b.visibility !== "public") { failures.not_public++; ok = false; }
      if (!isValidSlug(b.slug)) { failures.bad_slug++; ok = false; }
      if (!String(b.title ?? "").trim()) { failures.no_title++; ok = false; }
      // Non-English books are hidden site-wide; NULL language is treated as
      // English (2,900 sitemap books have no language set).
      if (b.language != null && b.language !== "English") { failures.non_english++; ok = false; }
      if (CORE_GATE.requireCover && !Number(b.has_cover)) { failures.no_cover++; ok = false; }
      if (Number(b.dlen) < CORE_GATE.minDescriptionChars) { failures.short_description++; ok = false; }
      if (ok) metaPassing.push(String(b.id));
    }
  }

  // 3. Enough content ratings that actually say something.
  const core = new Set<string>();
  for (const ids of chunk(metaPassing, 400)) {
    const rows = await exec(
      `SELECT r.book_id AS book_id, COUNT(*) AS n
       FROM book_category_ratings r
       WHERE r.book_id IN (${placeholders(ids.length)}) AND ${REAL_RATING_SQL}
       GROUP BY r.book_id`,
      ids,
    );
    const counts = new Map(rows.map((r) => [String(r.book_id), Number(r.n)]));
    for (const id of ids) {
      if ((counts.get(id) ?? 0) >= CORE_GATE.minRealRatings) core.add(id);
      else failures.few_real_ratings++;
    }
  }

  // 4. Diff against what is stored.
  const currentRows = await exec(`SELECT book_id FROM seo_index_books`);
  const current = new Set(currentRows.map((r) => String(r.book_id)));
  const toAdd = [...core].filter((id) => !current.has(id));
  const toRemove = [...current].filter((id) => !core.has(id));

  const report: CoreSetReport = {
    touchedBooks: touched.length,
    evaluated,
    passing: core.size,
    failures,
    previousSize: current.size,
    added: toAdd.length,
    removed: toRemove.length,
    applied: false,
  };

  // A collapse here would noindex pages Google has already accepted, so a
  // big drop is treated as a bug in the inputs, not as the new truth.
  if (
    !opts.force &&
    current.size >= SHRINK_GUARD_MIN_SIZE &&
    core.size < current.size * (1 - MAX_SHRINK_RATIO)
  ) {
    report.aborted = `core set would shrink ${current.size} -> ${core.size} (more than ${MAX_SHRINK_RATIO * 100}%); rerun with force if intended`;
    return report;
  }
  if (opts.dryRun) return report;

  for (const ids of chunk(toAdd, 200)) {
    await exec(
      `INSERT OR IGNORE INTO seo_index_books (book_id) VALUES ${ids.map(() => "(?)").join(",")}`,
      ids,
    );
  }
  for (const ids of chunk(toRemove, 200)) {
    await exec(`DELETE FROM seo_index_books WHERE book_id IN (${placeholders(ids.length)})`, ids);
  }
  report.applied = true;
  return report;
}
