import { db } from "@/db";
import { sql, type SQL } from "drizzle-orm";

export interface BrowseBook {
  id: string;
  slug: string | null;
  title: string;
  coverImageUrl: string | null;
  authors: string[];
  publicationYear: number | null;
  pages: number | null;
  isFiction: boolean | null;
  aggregateRating: number | null;
  ratingCount: number;
}

export interface BrowseFilters {
  genre?: string;
  fiction?: "fiction" | "nonfiction" | null;
  audience?: "adult" | "ya" | "teen" | "mg" | null;
  length?: "short" | "medium" | "long" | null;
  owned?: "owned" | "unowned" | null;
  social?: "friends_read" | "friends_tbr" | null;
  query?: string;
  sort?: string;
}

export interface BrowseResult {
  books: BrowseBook[];
  total: number;
  hasMore: boolean;
}

/**
 * Browse the full book catalog with filters, sorting, and pagination.
 *
 * All user-derived values are parameterized via drizzle's `sql` tag; the
 * only raw fragments are fixed whitelist strings (ORDER BY, hardcoded IN
 * lists for the audience filter). See audit 2026-04-24.
 */
export async function getBrowseBooks(
  filters: BrowseFilters,
  userId: string | null,
  followedIds: string[],
  offset: number,
  limit: number,
): Promise<BrowseResult> {
  const conditions: SQL[] = [
    sql`b.visibility = 'public'`,
    sql`b.cover_image_url IS NOT NULL`,
  ];

  if (filters.genre) {
    conditions.push(sql`b.id IN (SELECT bg.book_id FROM book_genres bg JOIN genres g ON bg.genre_id = g.id WHERE g.name = ${filters.genre})`);
  }

  if (filters.fiction === "fiction") {
    conditions.push(sql`b.is_fiction = 1`);
  } else if (filters.fiction === "nonfiction") {
    conditions.push(sql`b.is_fiction = 0`);
  }

  if (filters.audience === "ya") {
    conditions.push(sql`b.id IN (SELECT bg.book_id FROM book_genres bg JOIN genres g ON bg.genre_id = g.id WHERE g.name IN ('Young Adult', 'YA Fiction', 'YA Fantasy', 'YA Romance', 'YA Sci-Fi'))`);
  } else if (filters.audience === "mg") {
    conditions.push(sql`b.id IN (SELECT bg.book_id FROM book_genres bg JOIN genres g ON bg.genre_id = g.id WHERE g.name IN ('Middle Grade', 'Children''s'))`);
  } else if (filters.audience === "adult") {
    conditions.push(sql`b.id NOT IN (SELECT bg.book_id FROM book_genres bg JOIN genres g ON bg.genre_id = g.id WHERE g.name IN ('Young Adult', 'YA Fiction', 'YA Fantasy', 'YA Romance', 'YA Sci-Fi', 'Middle Grade', 'Children''s', 'Teen'))`);
  }

  if (filters.length === "short") {
    conditions.push(sql`b.pages IS NOT NULL AND b.pages < 250`);
  } else if (filters.length === "medium") {
    conditions.push(sql`b.pages IS NOT NULL AND b.pages BETWEEN 250 AND 400`);
  } else if (filters.length === "long") {
    conditions.push(sql`b.pages IS NOT NULL AND b.pages > 400`);
  }

  if (userId && filters.owned === "owned") {
    conditions.push(sql`b.id IN (SELECT ubs.book_id FROM user_book_state ubs WHERE ubs.user_id = ${userId} AND ubs.owned_formats IS NOT NULL AND ubs.owned_formats != '[]')`);
  } else if (userId && filters.owned === "unowned") {
    conditions.push(sql`b.id NOT IN (SELECT ubs.book_id FROM user_book_state ubs WHERE ubs.user_id = ${userId} AND ubs.owned_formats IS NOT NULL AND ubs.owned_formats != '[]')`);
  }

  if (followedIds.length > 0 && (filters.social === "friends_read" || filters.social === "friends_tbr")) {
    const idList = sql.join(followedIds.map((id) => sql`${id}`), sql`, `);
    const state = filters.social === "friends_read" ? "completed" : "tbr";
    conditions.push(sql`b.id IN (SELECT ubs.book_id FROM user_book_state ubs WHERE ubs.user_id IN (${idList}) AND ubs.state = ${state})`);
  }

  if (filters.query && filters.query.trim().length >= 2) {
    // Escape LIKE metacharacters so user input can't broaden the match
    // or trigger pathological scans. `\` is declared as the escape char.
    const q = filters.query
      .trim()
      .toLowerCase()
      .replace(/\\/g, "\\\\")
      .replace(/%/g, "\\%")
      .replace(/_/g, "\\_");
    const pattern = `%${q}%`;
    conditions.push(sql`(LOWER(b.title) LIKE ${pattern} ESCAPE '\\' OR b.id IN (SELECT ba.book_id FROM book_authors ba JOIN authors a ON ba.author_id = a.id WHERE LOWER(a.name) LIKE ${pattern} ESCAPE '\\'))`);
  }

  const whereClause = sql.join(conditions, sql` AND `);

  // ORDER BY is a fixed whitelist — user-facing value is mapped to a
  // known-safe SQL fragment, never interpolated.
  let orderByFragment: SQL;
  switch (filters.sort) {
    case "highest_rated":
      orderByFragment = sql`avg_rating DESC, rating_count DESC`;
      break;
    case "newest":
      orderByFragment = sql`CASE WHEN b.publication_year IS NULL THEN 0 ELSE b.publication_year END DESC, b.title ASC`;
      break;
    case "recently_added":
      orderByFragment = sql`b.created_at DESC`;
      break;
    case "title":
      orderByFragment = sql`b.title ASC`;
      break;
    case "pages":
      orderByFragment = sql`CASE WHEN b.pages IS NULL THEN 99999 ELSE b.pages END ASC`;
      break;
    default:
      orderByFragment = sql`rating_count DESC, avg_rating DESC`;
  }

  const countResult = (await db.all(
    sql`SELECT COUNT(*) as total FROM books b WHERE ${whereClause}`,
  )) as { total: number }[];
  const total = countResult[0]?.total ?? 0;

  // Determine whether we need rating data in the ORDER BY.
  // If not, we can skip the LEFT JOIN on the main query entirely and
  // batch-fetch ratings for the visible slice (same approach as authors).
  const needsRatingsForSort =
    !filters.sort || filters.sort === "highest_rated" || filters.sort === "popular";

  type Row = {
    id: string; slug: string | null; title: string; cover_image_url: string | null;
    publication_year: number | null; pages: number | null; is_fiction: number | null;
    avg_rating: number; rating_count: number;
  };

  const rows: Row[] = needsRatingsForSort
    ? (await db.all(sql`
        SELECT
          b.id, b.slug, b.title, b.cover_image_url, b.publication_year, b.pages, b.is_fiction,
          COALESCE(r.avg_rating, 0) AS avg_rating,
          COALESCE(r.rating_count, 0) AS rating_count
        FROM books b
        LEFT JOIN (
          SELECT book_id, AVG(rating) AS avg_rating, COUNT(*) AS rating_count
          FROM user_book_ratings
          GROUP BY book_id
        ) r ON r.book_id = b.id
        WHERE ${whereClause}
        ORDER BY ${orderByFragment}
        LIMIT ${limit} OFFSET ${offset}
      `)) as Row[]
    : (await db.all(sql`
        SELECT
          b.id, b.slug, b.title, b.cover_image_url, b.publication_year, b.pages, b.is_fiction,
          0 AS avg_rating, 0 AS rating_count
        FROM books b
        WHERE ${whereClause}
        ORDER BY ${orderByFragment}
        LIMIT ${limit} OFFSET ${offset}
      `)) as Row[];

  if (rows.length === 0) {
    return { books: [], total, hasMore: false };
  }

  const bookIds = rows.map((r) => r.id);
  const inList = sql.join(bookIds.map((id) => sql`${id}`), sql`, `);

  const authorRows = (await db.all(
    sql`SELECT ba.book_id, a.name FROM book_authors ba JOIN authors a ON ba.author_id = a.id WHERE ba.book_id IN (${inList})`,
  )) as { book_id: string; name: string }[];

  const authorsByBook = new Map<string, string[]>();
  for (const a of authorRows) {
    const arr = authorsByBook.get(a.book_id) ?? [];
    arr.push(a.name);
    authorsByBook.set(a.book_id, arr);
  }

  const ratingsByBook = new Map<string, { avg: number; count: number }>();
  if (!needsRatingsForSort) {
    const ratingRows = (await db.all(sql`
      SELECT book_id, AVG(rating) AS avg_rating, COUNT(*) AS rating_count
      FROM user_book_ratings
      WHERE book_id IN (${inList})
      GROUP BY book_id
    `)) as { book_id: string; avg_rating: number; rating_count: number }[];
    for (const r of ratingRows) {
      ratingsByBook.set(r.book_id, { avg: r.avg_rating, count: r.rating_count });
    }
  }

  const books: BrowseBook[] = rows.map((r) => {
    const ratings = needsRatingsForSort
      ? { avg: r.avg_rating, count: r.rating_count }
      : ratingsByBook.get(r.id) ?? { avg: 0, count: 0 };
    return {
      id: r.id,
      slug: r.slug,
      title: r.title,
      coverImageUrl: r.cover_image_url,
      authors: authorsByBook.get(r.id) ?? [],
      publicationYear: r.publication_year,
      pages: r.pages,
      isFiction: r.is_fiction === null ? null : !!r.is_fiction,
      aggregateRating: ratings.avg > 0 ? Math.round(ratings.avg * 100) / 100 : null,
      ratingCount: ratings.count,
    };
  });

  return { books, total, hasMore: offset + limit < total };
}
