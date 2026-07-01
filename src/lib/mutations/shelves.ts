/**
 * Shelf write logic — plain, userId-taking functions shared by the web server
 * actions (src/lib/actions/shelves.ts) and the native API
 * (src/app/api/v1/shelves). No auth (caller passes a verified userId) and no
 * revalidatePath (the action wrapper handles web cache invalidation).
 *
 * Ownership checks live here so both callers are protected. The two-phase
 * "negative positions first" renumbering in the reorder fns is preserved
 * verbatim — it's the guard against UNIQUE(position) collisions and broken
 * ordering.
 *
 * Scope note: only the operations the v1 native endpoints need are extracted
 * (create/update/delete/reorder shelves, add/remove/reorder books). Other
 * shelf actions (bulk remove, toggle, notes, follow/unfollow) remain inline in
 * the action file and get extracted when a later slice needs them.
 */
import { db } from "@/db";
import { shelves, shelfBooks, userNotifications } from "@/db/schema";
import { eq, and, asc, sql } from "drizzle-orm";
import { hasPremiumAccess } from "@/lib/auth";
import { generateShelfSlug } from "@/lib/utils/slugify";

export const MAX_SHELVES = 50;
export const MAX_BOOKS_PER_SHELF = 500;

// ─── Create shelf ───

export async function createShelfFor(
  userId: string,
  accountType: string,
  name: string,
  description?: string,
  isPublic?: boolean,
  color?: string,
): Promise<{ success: boolean; shelfId?: string; slug?: string; error?: string }> {
  if (!hasPremiumAccess({ accountType })) {
    return { success: false, error: "Premium required" };
  }

  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 100) {
    return { success: false, error: "Shelf name must be 1-100 characters" };
  }

  // Check count
  const existing = await db
    .select({ id: shelves.id })
    .from(shelves)
    .where(eq(shelves.userId, userId))
    .all();

  if (existing.length >= MAX_SHELVES) {
    return { success: false, error: `Maximum ${MAX_SHELVES} shelves` };
  }

  // Generate unique slug
  const baseSlug = generateShelfSlug(trimmed);
  let slug = baseSlug;
  let suffix = 2;
  while (true) {
    const dup = await db
      .select({ id: shelves.id })
      .from(shelves)
      .where(and(eq(shelves.userId, userId), eq(shelves.slug, slug)))
      .get();
    if (!dup) break;
    slug = `${baseSlug}-${suffix}`;
    suffix++;
  }

  const nextPosition = existing.length + 1;
  const id = crypto.randomUUID();

  await db.insert(shelves).values({
    id,
    userId,
    name: trimmed,
    slug,
    description: description?.trim() || null,
    color: color || null,
    isPublic: isPublic ?? false,
    position: nextPosition,
  });

  return { success: true, shelfId: id, slug };
}

// ─── Update shelf ───

export async function updateShelfFor(
  userId: string,
  shelfId: string,
  data: { name?: string; description?: string; isPublic?: boolean; color?: string | null; coverImageUrl?: string | null },
): Promise<{ success: boolean; slug?: string; error?: string }> {
  const shelf = await db.select().from(shelves).where(eq(shelves.id, shelfId)).get();
  if (!shelf || shelf.userId !== userId) {
    return { success: false, error: "Shelf not found" };
  }

  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  let newSlug = shelf.slug;

  if (data.name !== undefined) {
    const trimmed = data.name.trim();
    if (!trimmed || trimmed.length > 100) {
      return { success: false, error: "Shelf name must be 1-100 characters" };
    }
    updates.name = trimmed;

    // Re-slug if name changed
    const baseSlug = generateShelfSlug(trimmed);
    let slug = baseSlug;
    let suffix = 2;
    while (true) {
      const dup = await db
        .select({ id: shelves.id })
        .from(shelves)
        .where(and(eq(shelves.userId, userId), eq(shelves.slug, slug)))
        .get();
      if (!dup || dup.id === shelfId) break;
      slug = `${baseSlug}-${suffix}`;
      suffix++;
    }
    updates.slug = slug;
    newSlug = slug;
  }

  if (data.description !== undefined) updates.description = data.description?.trim() || null;
  if (data.isPublic !== undefined) updates.isPublic = data.isPublic;
  if (data.color !== undefined) updates.color = data.color;
  if (data.coverImageUrl !== undefined) updates.coverImageUrl = data.coverImageUrl;

  await db.update(shelves).set(updates).where(eq(shelves.id, shelfId));

  return { success: true, slug: newSlug };
}

// ─── Delete shelf ───

export async function deleteShelfFor(
  userId: string,
  shelfId: string,
): Promise<{ success: boolean; error?: string }> {
  const shelf = await db.select().from(shelves).where(eq(shelves.id, shelfId)).get();
  if (!shelf || shelf.userId !== userId) {
    return { success: false, error: "Shelf not found" };
  }

  // CASCADE deletes shelf_books
  await db.delete(shelves).where(eq(shelves.id, shelfId));

  // Reorder remaining shelves
  await db.run(sql`
    UPDATE shelves
    SET position = position - 1
    WHERE user_id = ${userId} AND position > ${shelf.position}
  `);

  return { success: true };
}

// ─── Reorder shelves ───

export async function reorderShelvesFor(
  userId: string,
  shelfIds: string[],
): Promise<{ success: boolean }> {
  // Phase 1: negative positions to avoid UNIQUE conflicts
  for (let i = 0; i < shelfIds.length; i++) {
    await db.update(shelves).set({ position: -(i + 1) }).where(
      and(eq(shelves.id, shelfIds[i]), eq(shelves.userId, userId)),
    );
  }
  // Phase 2: final positions
  for (let i = 0; i < shelfIds.length; i++) {
    await db.update(shelves).set({ position: i + 1 }).where(
      and(eq(shelves.id, shelfIds[i]), eq(shelves.userId, userId)),
    );
  }

  return { success: true };
}

// ─── Add book to shelf ───

export async function addBookToShelfFor(
  userId: string,
  shelfId: string,
  bookId: string,
  note?: string,
): Promise<{ success: boolean; error?: string; added?: boolean; slug?: string }> {
  const shelf = await db.select().from(shelves).where(eq(shelves.id, shelfId)).get();
  if (!shelf || shelf.userId !== userId) {
    return { success: false, error: "Shelf not found" };
  }

  // Check if already on shelf
  const existing = await db
    .select()
    .from(shelfBooks)
    .where(and(eq(shelfBooks.shelfId, shelfId), eq(shelfBooks.bookId, bookId)))
    .get();
  if (existing) return { success: true, added: false, slug: shelf.slug }; // Already on shelf

  // Check book count
  const count = await db
    .select({ id: shelfBooks.bookId })
    .from(shelfBooks)
    .where(eq(shelfBooks.shelfId, shelfId))
    .all();
  if (count.length >= MAX_BOOKS_PER_SHELF) {
    return { success: false, error: `Maximum ${MAX_BOOKS_PER_SHELF} books per shelf` };
  }

  const nextPosition = count.length + 1;
  await db.insert(shelfBooks).values({
    shelfId,
    bookId,
    position: nextPosition,
    note: note?.trim() || null,
  });

  // Notify followers of this shelf (if public) — fire and forget.
  if (shelf.isPublic) {
    notifyShelfFollowers(shelfId, shelf.name, bookId).catch(() => {});
  }

  return { success: true, added: true, slug: shelf.slug };
}

async function notifyShelfFollowers(shelfId: string, shelfName: string, bookId: string) {
  // Get book title and shelf slug for the notification
  const bookRow = await db.all(sql`SELECT title FROM books WHERE id = ${bookId}`) as { title: string }[];
  const bookTitle = bookRow[0]?.title || "a book";
  const shelfRow = await db.all(sql`SELECT slug FROM shelves WHERE id = ${shelfId}`) as { slug: string }[];
  const shelfSlug = shelfRow[0]?.slug;

  // Get all followers of this shelf
  const followers = await db.all(sql`
    SELECT user_id FROM shelf_follows WHERE shelf_id = ${shelfId}
  `) as { user_id: string }[];

  for (const follower of followers) {
    await db.insert(userNotifications).values({
      userId: follower.user_id,
      type: "shelf_update",
      title: `New book on "${shelfName}"`,
      message: `"${bookTitle}" was added to a shelf you follow.`,
      linkUrl: `/library/shelves/${shelfSlug}`,
    });
  }
}

// ─── Remove book from shelf ───

export async function removeBookFromShelfFor(
  userId: string,
  shelfId: string,
  bookId: string,
): Promise<{ success: boolean; removed?: boolean; slug?: string }> {
  const shelf = await db.select().from(shelves).where(eq(shelves.id, shelfId)).get();
  if (!shelf || shelf.userId !== userId) return { success: false };

  const row = await db
    .select({ position: shelfBooks.position })
    .from(shelfBooks)
    .where(and(eq(shelfBooks.shelfId, shelfId), eq(shelfBooks.bookId, bookId)))
    .get();
  if (!row) return { success: true, removed: false, slug: shelf.slug };

  await db.delete(shelfBooks).where(
    and(eq(shelfBooks.shelfId, shelfId), eq(shelfBooks.bookId, bookId)),
  );

  // Reorder
  await db.run(sql`
    UPDATE shelf_books
    SET position = position - 1
    WHERE shelf_id = ${shelfId} AND position > ${row.position}
  `);

  return { success: true, removed: true, slug: shelf.slug };
}

// ─── Reorder books within shelf ───

export async function reorderShelfBooksFor(
  userId: string,
  shelfId: string,
  bookIds: string[],
): Promise<{ success: boolean; slug?: string }> {
  const shelf = await db.select().from(shelves).where(eq(shelves.id, shelfId)).get();
  if (!shelf || shelf.userId !== userId) return { success: false };

  // Phase 1: negative positions
  for (let i = 0; i < bookIds.length; i++) {
    await db.run(sql`
      UPDATE shelf_books SET position = ${-(i + 1)}
      WHERE shelf_id = ${shelfId} AND book_id = ${bookIds[i]}
    `);
  }
  // Phase 2: final positions
  for (let i = 0; i < bookIds.length; i++) {
    await db.run(sql`
      UPDATE shelf_books SET position = ${i + 1}
      WHERE shelf_id = ${shelfId} AND book_id = ${bookIds[i]}
    `);
  }

  return { success: true, slug: shelf.slug };
}
