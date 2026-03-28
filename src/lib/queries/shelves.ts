import { db } from "@/db";
import { sql } from "drizzle-orm";

// ─── Types ───

export interface ShelfSummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  color: string | null;
  coverImageUrl: string | null;
  isPublic: boolean;
  position: number;
  bookCount: number;
  /** First 4 book covers for mosaic display */
  coverUrls: string[];
  createdAt: string;
}

export interface ShelfBook {
  bookId: string;
  slug: string | null;
  title: string;
  coverImageUrl: string | null;
  authors: string[];
  position: number;
  note: string | null;
  state: string | null;
  addedAt: string;
}

export interface ShelfDetail {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  color: string | null;
  coverImageUrl: string | null;
  isPublic: boolean;
  position: number;
  createdAt: string;
  userId: string;
  books: ShelfBook[];
}

export interface BookShelfMembership {
  shelfId: string;
  shelfName: string;
}

// ─── Queries ───

/**
 * Get all shelves for a user with book counts and cover URLs for mosaics.
 */
export async function getUserShelves(userId: string): Promise<ShelfSummary[]> {
  const rows = await db.all(sql`
    SELECT
      s.id,
      s.name,
      s.slug,
      s.description,
      s.color,
      s.cover_image_url,
      s.is_public,
      s.position,
      s.created_at,
      (SELECT COUNT(*) FROM shelf_books sb WHERE sb.shelf_id = s.id) as book_count
    FROM shelves s
    WHERE s.user_id = ${userId}
    ORDER BY s.position ASC
  `) as {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    color: string | null;
    cover_image_url: string | null;
    is_public: number;
    position: number;
    created_at: string;
    book_count: number;
  }[];

  const result: ShelfSummary[] = [];

  for (const row of rows) {
    // Fetch first 4 covers for mosaic
    const covers = await db.all(sql`
      SELECT b.cover_image_url
      FROM shelf_books sb
      JOIN books b ON sb.book_id = b.id
      WHERE sb.shelf_id = ${row.id} AND b.cover_image_url IS NOT NULL
      ORDER BY sb.position ASC
      LIMIT 12
    `) as { cover_image_url: string }[];

    result.push({
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      color: row.color,
      coverImageUrl: row.cover_image_url,
      isPublic: !!row.is_public,
      position: row.position,
      bookCount: row.book_count,
      coverUrls: covers.map((c) => c.cover_image_url),
      createdAt: row.created_at,
    });
  }

  return result;
}

/**
 * Get a shelf with all its books, fully hydrated.
 */
export async function getShelfWithBooks(shelfId: string): Promise<ShelfDetail | null> {
  const shelf = await db.all(sql`
    SELECT id, name, slug, description, color, cover_image_url, is_public, position, created_at, user_id
    FROM shelves WHERE id = ${shelfId}
  `) as {
    id: string; name: string; slug: string; description: string | null;
    color: string | null; cover_image_url: string | null; is_public: number;
    position: number; created_at: string; user_id: string;
  }[];

  if (shelf.length === 0) return null;
  const s = shelf[0];

  const bookRows = await db.all(sql`
    SELECT
      sb.book_id,
      sb.position,
      sb.note,
      sb.added_at,
      b.title,
      b.slug,
      b.cover_image_url,
      (SELECT ubs.state FROM user_book_state ubs WHERE ubs.user_id = ${s.user_id} AND ubs.book_id = sb.book_id) as state
    FROM shelf_books sb
    JOIN books b ON sb.book_id = b.id
    WHERE sb.shelf_id = ${shelfId}
    ORDER BY sb.position ASC
  `) as {
    book_id: string; position: number; note: string | null; added_at: string;
    title: string; slug: string | null; cover_image_url: string | null; state: string | null;
  }[];

  const books: ShelfBook[] = [];
  for (const row of bookRows) {
    const authorRows = await db.all(sql`
      SELECT a.name FROM book_authors ba JOIN authors a ON ba.author_id = a.id WHERE ba.book_id = ${row.book_id}
    `) as { name: string }[];

    books.push({
      bookId: row.book_id,
      slug: row.slug,
      title: row.title,
      coverImageUrl: row.cover_image_url,
      authors: authorRows.map((a) => a.name),
      position: row.position,
      note: row.note,
      state: row.state,
      addedAt: row.added_at,
    });
  }

  return {
    id: s.id,
    name: s.name,
    slug: s.slug,
    description: s.description,
    color: s.color,
    coverImageUrl: s.cover_image_url,
    isPublic: !!s.is_public,
    position: s.position,
    createdAt: s.created_at,
    userId: s.user_id,
    books,
  };
}

/**
 * Which shelves is a book on for a given user? (For "Add to Shelf" checkboxes)
 */
export async function getBookShelves(userId: string, bookId: string): Promise<BookShelfMembership[]> {
  const rows = await db.all(sql`
    SELECT s.id as shelf_id, s.name as shelf_name
    FROM shelves s
    JOIN shelf_books sb ON sb.shelf_id = s.id
    WHERE s.user_id = ${userId} AND sb.book_id = ${bookId}
    ORDER BY s.position ASC
  `) as { shelf_id: string; shelf_name: string }[];

  return rows.map((r) => ({ shelfId: r.shelf_id, shelfName: r.shelf_name }));
}

/**
 * Get only public shelves for a user (for profile display).
 */
export async function getPublicShelves(userId: string): Promise<ShelfSummary[]> {
  const all = await getUserShelves(userId);
  return all.filter((s) => s.isPublic);
}

/**
 * Resolve a shelf by user + slug.
 */
export async function getShelfBySlug(userId: string, slug: string): Promise<{ id: string; isPublic: boolean } | null> {
  const row = await db.all(sql`
    SELECT id, is_public FROM shelves WHERE user_id = ${userId} AND slug = ${slug}
  `) as { id: string; is_public: number }[];

  if (row.length === 0) return null;
  return { id: row[0].id, isPublic: !!row[0].is_public };
}

// ─── Follow queries ───

export interface FollowedShelf {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  color: string | null;
  bookCount: number;
  coverUrls: string[];
  /** The shelf owner's info */
  ownerUsername: string;
  ownerDisplayName: string | null;
  followedAt: string;
}

/**
 * Is the current user following this shelf?
 */
export async function isFollowingShelf(userId: string, shelfId: string): Promise<boolean> {
  const row = await db.all(sql`
    SELECT user_id FROM shelf_follows WHERE user_id = ${userId} AND shelf_id = ${shelfId}
  `);
  return row.length > 0;
}

/**
 * Get all shelves the user is following, with owner info.
 */
export async function getFollowedShelves(userId: string): Promise<FollowedShelf[]> {
  const rows = await db.all(sql`
    SELECT
      s.id,
      s.name,
      s.slug,
      s.description,
      s.color,
      sf.created_at as followed_at,
      u.username as owner_username,
      u.display_name as owner_display_name,
      (SELECT COUNT(*) FROM shelf_books sb WHERE sb.shelf_id = s.id) as book_count
    FROM shelf_follows sf
    JOIN shelves s ON sf.shelf_id = s.id
    JOIN users u ON s.user_id = u.id
    WHERE sf.user_id = ${userId} AND s.is_public = 1
    ORDER BY sf.created_at DESC
  `) as {
    id: string; name: string; slug: string; description: string | null;
    color: string | null; followed_at: string; owner_username: string;
    owner_display_name: string | null; book_count: number;
  }[];

  const result: FollowedShelf[] = [];
  for (const row of rows) {
    const covers = await db.all(sql`
      SELECT b.cover_image_url
      FROM shelf_books sb
      JOIN books b ON sb.book_id = b.id
      WHERE sb.shelf_id = ${row.id} AND b.cover_image_url IS NOT NULL
      ORDER BY sb.position ASC
      LIMIT 12
    `) as { cover_image_url: string }[];

    result.push({
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      color: row.color,
      bookCount: row.book_count,
      coverUrls: covers.map((c) => c.cover_image_url),
      ownerUsername: row.owner_username,
      ownerDisplayName: row.owner_display_name,
      followedAt: row.followed_at,
    });
  }

  return result;
}

/**
 * Get follower count for a shelf.
 */
export async function getShelfFollowerCount(shelfId: string): Promise<number> {
  const row = await db.all(sql`
    SELECT COUNT(*) as c FROM shelf_follows WHERE shelf_id = ${shelfId}
  `) as { c: number }[];
  return row[0]?.c ?? 0;
}
