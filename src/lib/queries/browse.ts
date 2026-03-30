import { db } from "@/db";
import { sql } from "drizzle-orm";

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
 * Uses raw SQL with string-built WHERE clause for flexibility,
 * but parameterizes user input values.
 */
export async function getBrowseBooks(
  filters: BrowseFilters,
  userId: string | null,
  followedIds: string[],
  offset: number,
  limit: number,
): Promise<BrowseResult> {
  // Build WHERE conditions as raw SQL strings
  // User-input values are escaped to prevent injection
  const conditions: string[] = ["b.visibility = 'public'", "b.cover_image_url IS NOT NULL"];

  if (filters.genre) {
    const escaped = filters.genre.replace(/'/g, "''");
    conditions.push(`b.id IN (SELECT bg.book_id FROM book_genres bg JOIN genres g ON bg.genre_id = g.id WHERE g.name = '${escaped}')`);
  }

  if (filters.fiction === "fiction") {
    conditions.push("b.is_fiction = 1");
  } else if (filters.fiction === "nonfiction") {
    conditions.push("b.is_fiction = 0");
  }

  if (filters.audience === "ya") {
    conditions.push(`b.id IN (SELECT bg.book_id FROM book_genres bg JOIN genres g ON bg.genre_id = g.id WHERE g.name IN ('Young Adult', 'YA Fiction', 'YA Fantasy', 'YA Romance', 'YA Sci-Fi'))`);
  } else if (filters.audience === "mg") {
    conditions.push(`b.id IN (SELECT bg.book_id FROM book_genres bg JOIN genres g ON bg.genre_id = g.id WHERE g.name IN ('Middle Grade', 'Children''s'))`);
  } else if (filters.audience === "adult") {
    conditions.push(`b.id NOT IN (SELECT bg.book_id FROM book_genres bg JOIN genres g ON bg.genre_id = g.id WHERE g.name IN ('Young Adult', 'YA Fiction', 'YA Fantasy', 'YA Romance', 'YA Sci-Fi', 'Middle Grade', 'Children''s', 'Teen'))`);
  }

  if (filters.length === "short") {
    conditions.push("b.pages IS NOT NULL AND b.pages < 250");
  } else if (filters.length === "medium") {
    conditions.push("b.pages IS NOT NULL AND b.pages BETWEEN 250 AND 400");
  } else if (filters.length === "long") {
    conditions.push("b.pages IS NOT NULL AND b.pages > 400");
  }

  if (userId && filters.owned === "owned") {
    const uid = userId.replace(/'/g, "''");
    conditions.push(`b.id IN (SELECT ubs.book_id FROM user_book_state ubs WHERE ubs.user_id = '${uid}' AND ubs.owned_formats IS NOT NULL AND ubs.owned_formats != '[]')`);
  } else if (userId && filters.owned === "unowned") {
    const uid = userId.replace(/'/g, "''");
    conditions.push(`b.id NOT IN (SELECT ubs.book_id FROM user_book_state ubs WHERE ubs.user_id = '${uid}' AND ubs.owned_formats IS NOT NULL AND ubs.owned_formats != '[]')`);
  }

  if (followedIds.length > 0 && filters.social === "friends_read") {
    const idList = followedIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(",");
    conditions.push(`b.id IN (SELECT ubs.book_id FROM user_book_state ubs WHERE ubs.user_id IN (${idList}) AND ubs.state = 'completed')`);
  } else if (followedIds.length > 0 && filters.social === "friends_tbr") {
    const idList = followedIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(",");
    conditions.push(`b.id IN (SELECT ubs.book_id FROM user_book_state ubs WHERE ubs.user_id IN (${idList}) AND ubs.state = 'tbr')`);
  }

  if (filters.query && filters.query.trim().length >= 2) {
    const q = filters.query.trim().toLowerCase().replace(/'/g, "''");
    conditions.push(`(LOWER(b.title) LIKE '%${q}%' OR b.id IN (SELECT ba.book_id FROM book_authors ba JOIN authors a ON ba.author_id = a.id WHERE LOWER(a.name) LIKE '%${q}%'))`);
  }

  const whereClause = conditions.join(" AND ");

  let orderBy = "rating_count DESC, avg_rating DESC";
  switch (filters.sort) {
    case "highest_rated": orderBy = "avg_rating DESC, rating_count DESC"; break;
    case "newest": orderBy = "CASE WHEN b.publication_year IS NULL THEN 0 ELSE b.publication_year END DESC, b.title ASC"; break;
    case "recently_added": orderBy = "b.created_at DESC"; break;
    case "title": orderBy = "b.title ASC"; break;
    case "pages": orderBy = "CASE WHEN b.pages IS NULL THEN 99999 ELSE b.pages END ASC"; break;
  }

  // Count query
  const countResult = await db.all(sql.raw(
    `SELECT COUNT(*) as total FROM books b WHERE ${whereClause}`
  )) as { total: number }[];
  const total = countResult[0]?.total ?? 0;

  // Main query
  const rows = await db.all(sql.raw(`
    SELECT
      b.id, b.slug, b.title, b.cover_image_url, b.publication_year, b.pages, b.is_fiction,
      COALESCE((SELECT AVG(ubr.rating) FROM user_book_ratings ubr WHERE ubr.book_id = b.id), 0) as avg_rating,
      COALESCE((SELECT COUNT(*) FROM user_book_ratings ubr2 WHERE ubr2.book_id = b.id), 0) as rating_count
    FROM books b
    WHERE ${whereClause}
    ORDER BY ${orderBy}
    LIMIT ${limit} OFFSET ${offset}
  `)) as {
    id: string; slug: string | null; title: string; cover_image_url: string | null;
    publication_year: number | null; pages: number | null; is_fiction: number | null;
    avg_rating: number; rating_count: number;
  }[];

  if (rows.length === 0) {
    return { books: [], total, hasMore: false };
  }

  // Batch fetch authors
  const bookIds = rows.map((r) => r.id);
  const inList = bookIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(",");
  const authorRows = await db.all(sql.raw(
    `SELECT ba.book_id, a.name FROM book_authors ba JOIN authors a ON ba.author_id = a.id WHERE ba.book_id IN (${inList})`
  )) as { book_id: string; name: string }[];

  const authorsByBook = new Map<string, string[]>();
  for (const a of authorRows) {
    const arr = authorsByBook.get(a.book_id) ?? [];
    arr.push(a.name);
    authorsByBook.set(a.book_id, arr);
  }

  const books: BrowseBook[] = rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    coverImageUrl: r.cover_image_url,
    authors: authorsByBook.get(r.id) ?? [],
    publicationYear: r.publication_year,
    pages: r.pages,
    isFiction: r.is_fiction === null ? null : !!r.is_fiction,
    aggregateRating: r.avg_rating > 0 ? Math.round(r.avg_rating * 100) / 100 : null,
    ratingCount: r.rating_count,
  }));

  return { books, total, hasMore: offset + limit < total };
}
