"use server";

import { db } from "@/db";
import { shelves, shelfBooks, shelfFollows, userNotifications, users } from "@/db/schema";
import { eq, and, asc, sql, desc } from "drizzle-orm";
import { getCurrentUser, hasPremiumAccess } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { generateShelfSlug } from "@/lib/utils/slugify";

const MAX_SHELVES = 50;
const MAX_BOOKS_PER_SHELF = 500;

// ─── Create shelf ───

export async function createShelf(
  name: string,
  description?: string,
  isPublic?: boolean,
  color?: string,
): Promise<{ success: boolean; shelfId?: string; slug?: string; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not logged in" };
  if (!hasPremiumAccess({ accountType: user.accountType })) {
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
    .where(eq(shelves.userId, user.userId))
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
      .where(and(eq(shelves.userId, user.userId), eq(shelves.slug, slug)))
      .get();
    if (!dup) break;
    slug = `${baseSlug}-${suffix}`;
    suffix++;
  }

  const nextPosition = existing.length + 1;
  const id = crypto.randomUUID();

  await db.insert(shelves).values({
    id,
    userId: user.userId,
    name: trimmed,
    slug,
    description: description?.trim() || null,
    color: color || null,
    isPublic: isPublic ?? false,
    position: nextPosition,
  });

  revalidatePath("/library/shelves");
  revalidatePath("/profile");
  return { success: true, shelfId: id, slug };
}

// ─── Update shelf ───

export async function updateShelf(
  shelfId: string,
  data: { name?: string; description?: string; isPublic?: boolean; color?: string | null; coverImageUrl?: string | null },
): Promise<{ success: boolean; slug?: string; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not logged in" };

  const shelf = await db.select().from(shelves).where(eq(shelves.id, shelfId)).get();
  if (!shelf || shelf.userId !== user.userId) {
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
        .where(and(eq(shelves.userId, user.userId), eq(shelves.slug, slug)))
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

  revalidatePath("/library/shelves");
  revalidatePath(`/library/shelves/${newSlug}`);
  revalidatePath("/profile");
  return { success: true, slug: newSlug };
}

// ─── Delete shelf ───

export async function deleteShelf(shelfId: string): Promise<{ success: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not logged in" };

  const shelf = await db.select().from(shelves).where(eq(shelves.id, shelfId)).get();
  if (!shelf || shelf.userId !== user.userId) {
    return { success: false, error: "Shelf not found" };
  }

  // CASCADE deletes shelf_books
  await db.delete(shelves).where(eq(shelves.id, shelfId));

  // Reorder remaining shelves
  await db.run(sql`
    UPDATE shelves
    SET position = position - 1
    WHERE user_id = ${user.userId} AND position > ${shelf.position}
  `);

  revalidatePath("/library/shelves");
  revalidatePath("/profile");
  return { success: true };
}

// ─── Reorder shelves ───

export async function reorderShelves(shelfIds: string[]): Promise<{ success: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { success: false };

  // Phase 1: negative positions to avoid UNIQUE conflicts
  for (let i = 0; i < shelfIds.length; i++) {
    await db.update(shelves).set({ position: -(i + 1) }).where(
      and(eq(shelves.id, shelfIds[i]), eq(shelves.userId, user.userId)),
    );
  }
  // Phase 2: final positions
  for (let i = 0; i < shelfIds.length; i++) {
    await db.update(shelves).set({ position: i + 1 }).where(
      and(eq(shelves.id, shelfIds[i]), eq(shelves.userId, user.userId)),
    );
  }

  revalidatePath("/library/shelves");
  return { success: true };
}

// ─── Add book to shelf ───

export async function addBookToShelf(
  shelfId: string,
  bookId: string,
  note?: string,
): Promise<{ success: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not logged in" };

  const shelf = await db.select().from(shelves).where(eq(shelves.id, shelfId)).get();
  if (!shelf || shelf.userId !== user.userId) {
    return { success: false, error: "Shelf not found" };
  }

  // Check if already on shelf
  const existing = await db
    .select()
    .from(shelfBooks)
    .where(and(eq(shelfBooks.shelfId, shelfId), eq(shelfBooks.bookId, bookId)))
    .get();
  if (existing) return { success: true }; // Already on shelf

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

  revalidatePath("/library/shelves");
  revalidatePath(`/library/shelves/${shelf.slug}`);
  revalidatePath(`/book/${bookId}`);

  // Notify followers of this shelf (if public)
  if (shelf.isPublic) {
    notifyShelfFollowers(shelfId, shelf.name, bookId).catch(() => {});
  }

  return { success: true };
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

export async function removeBookFromShelf(
  shelfId: string,
  bookId: string,
): Promise<{ success: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { success: false };

  const shelf = await db.select().from(shelves).where(eq(shelves.id, shelfId)).get();
  if (!shelf || shelf.userId !== user.userId) return { success: false };

  const row = await db
    .select({ position: shelfBooks.position })
    .from(shelfBooks)
    .where(and(eq(shelfBooks.shelfId, shelfId), eq(shelfBooks.bookId, bookId)))
    .get();
  if (!row) return { success: true };

  await db.delete(shelfBooks).where(
    and(eq(shelfBooks.shelfId, shelfId), eq(shelfBooks.bookId, bookId)),
  );

  // Reorder
  await db.run(sql`
    UPDATE shelf_books
    SET position = position - 1
    WHERE shelf_id = ${shelfId} AND position > ${row.position}
  `);

  revalidatePath("/library/shelves");
  revalidatePath(`/library/shelves/${shelf.slug}`);
  revalidatePath(`/book/${bookId}`);
  return { success: true };
}

// ─── Bulk remove books from shelf ───

export async function bulkRemoveFromShelf(
  shelfId: string,
  bookIds: string[],
): Promise<{ success: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { success: false };
  if (bookIds.length === 0) return { success: true };

  const shelf = await db.select().from(shelves).where(eq(shelves.id, shelfId)).get();
  if (!shelf || shelf.userId !== user.userId) return { success: false };

  const inClause = bookIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(",");
  await db.run(sql.raw(`DELETE FROM shelf_books WHERE shelf_id = '${shelfId.replace(/'/g, "''")}' AND book_id IN (${inClause})`));

  // Reorder remaining books sequentially
  const remaining = await db
    .select({ bookId: shelfBooks.bookId })
    .from(shelfBooks)
    .where(eq(shelfBooks.shelfId, shelfId))
    .orderBy(asc(shelfBooks.position))
    .all();

  for (let i = 0; i < remaining.length; i++) {
    await db.update(shelfBooks)
      .set({ position: i + 1 })
      .where(and(eq(shelfBooks.shelfId, shelfId), eq(shelfBooks.bookId, remaining[i].bookId)));
  }

  revalidatePath("/library/shelves");
  revalidatePath(`/library/shelves/${shelf.slug}`);
  return { success: true };
}

// ─── Toggle book on shelf ───

export async function toggleBookOnShelf(
  shelfId: string,
  bookId: string,
): Promise<{ success: boolean; isOnShelf: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { success: false, isOnShelf: false, error: "Not logged in" };

  const existing = await db
    .select()
    .from(shelfBooks)
    .where(and(eq(shelfBooks.shelfId, shelfId), eq(shelfBooks.bookId, bookId)))
    .get();

  if (existing) {
    await removeBookFromShelf(shelfId, bookId);
    return { success: true, isOnShelf: false };
  } else {
    const result = await addBookToShelf(shelfId, bookId);
    return { success: result.success, isOnShelf: result.success, error: result.error };
  }
}

// ─── Reorder books within shelf ───

export async function reorderShelfBooks(
  shelfId: string,
  bookIds: string[],
): Promise<{ success: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { success: false };

  const shelf = await db.select().from(shelves).where(eq(shelves.id, shelfId)).get();
  if (!shelf || shelf.userId !== user.userId) return { success: false };

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

  revalidatePath(`/library/shelves/${shelf.slug}`);
  return { success: true };
}

// ─── Update book note ───

export async function updateShelfBookNote(
  shelfId: string,
  bookId: string,
  note: string | null,
): Promise<{ success: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { success: false };

  const shelf = await db.select().from(shelves).where(eq(shelves.id, shelfId)).get();
  if (!shelf || shelf.userId !== user.userId) return { success: false };

  await db.run(sql`
    UPDATE shelf_books SET note = ${note?.trim() || null}
    WHERE shelf_id = ${shelfId} AND book_id = ${bookId}
  `);

  revalidatePath(`/library/shelves/${shelf.slug}`);
  return { success: true };
}

// ─── Follow / unfollow shelf ───

export async function followShelf(shelfId: string): Promise<{ success: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not logged in" };

  // Verify shelf exists and is public
  const shelf = await db.select().from(shelves).where(eq(shelves.id, shelfId)).get();
  if (!shelf) return { success: false, error: "Shelf not found" };
  if (!shelf.isPublic) return { success: false, error: "Shelf is private" };
  if (shelf.userId === user.userId) return { success: false, error: "Cannot follow your own shelf" };

  // Check if already following
  const existing = await db.all(sql`
    SELECT user_id FROM shelf_follows WHERE user_id = ${user.userId} AND shelf_id = ${shelfId}
  `);
  if (existing.length > 0) return { success: true };

  await db.run(sql`
    INSERT INTO shelf_follows (user_id, shelf_id) VALUES (${user.userId}, ${shelfId})
  `);

  // Notify shelf owner
  try {
    const follower = await db.select({ displayName: users.displayName, username: users.username })
      .from(users).where(eq(users.id, user.userId)).get();
    const followerName = follower?.displayName || follower?.username || "Someone";
    await db.insert(userNotifications).values({
      userId: shelf.userId,
      type: "shelf_followed",
      title: "New shelf follower",
      message: `${followerName} started following your shelf "${shelf.name}"`,
      linkUrl: `/library/shelves/${shelf.slug}`,
    });
  } catch {
    // Don't break the follow if notification fails
  }

  revalidatePath("/library/shelves");
  return { success: true };
}

export async function unfollowShelf(shelfId: string): Promise<{ success: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { success: false };

  await db.run(sql`
    DELETE FROM shelf_follows WHERE user_id = ${user.userId} AND shelf_id = ${shelfId}
  `);

  revalidatePath("/library/shelves");
  return { success: true };
}

export async function toggleFollowShelf(shelfId: string): Promise<{ success: boolean; isFollowing: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { success: false, isFollowing: false, error: "Not logged in" };

  const existing = await db.all(sql`
    SELECT user_id FROM shelf_follows WHERE user_id = ${user.userId} AND shelf_id = ${shelfId}
  `);

  if (existing.length > 0) {
    await unfollowShelf(shelfId);
    return { success: true, isFollowing: false };
  } else {
    const result = await followShelf(shelfId);
    return { success: result.success, isFollowing: result.success, error: result.error };
  }
}
