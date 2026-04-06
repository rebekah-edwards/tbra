"use server";

import { db } from "@/db";
import { buddyReads, buddyReadMembers, buddyReadMessages, userNotifications, users, userBookState, books } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";

const INVITE_CODE_CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const INVITE_CODE_LENGTH = 8;

function generateInviteCode(): string {
  let code = "";
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    code += INVITE_CODE_CHARSET[Math.floor(Math.random() * INVITE_CODE_CHARSET.length)];
  }
  return code;
}

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

// ─── Create buddy read ───

export async function createBuddyRead(
  bookId: string,
  description?: string,
  isPublic?: boolean,
  startDate?: string,
  endDate?: string,
): Promise<{ success: boolean; slug?: string; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not logged in" };

  // Look up book title to auto-name the buddy read
  const book = await db.select({ title: books.title }).from(books).where(eq(books.id, bookId)).get();
  if (!book) return { success: false, error: "Book not found" };
  const trimmed = book.title.slice(0, 100);

  // Generate unique slug from book title
  const baseSlug = generateSlug(trimmed);
  let slug = baseSlug;
  let suffix = 2;
  while (true) {
    const dup = await db
      .select({ id: buddyReads.id })
      .from(buddyReads)
      .where(eq(buddyReads.slug, slug))
      .get();
    if (!dup) break;
    slug = `${baseSlug}-${suffix}`;
    suffix++;
  }

  // Generate unique invite code
  let inviteCode = generateInviteCode();
  while (true) {
    const dup = await db
      .select({ id: buddyReads.id })
      .from(buddyReads)
      .where(eq(buddyReads.inviteCode, inviteCode))
      .get();
    if (!dup) break;
    inviteCode = generateInviteCode();
  }

  const buddyReadId = crypto.randomUUID();

  await db.insert(buddyReads).values({
    id: buddyReadId,
    bookId,
    createdBy: user.userId,
    name: trimmed,
    slug,
    description: description?.trim() || null,
    isPublic: isPublic ?? false,
    inviteCode,
    startDate: startDate || null,
    endDate: endDate || null,
  });

  await db.insert(buddyReadMembers).values({
    buddyReadId,
    userId: user.userId,
    role: "host",
    status: "active",
    joinedAt: new Date().toISOString(),
  });

  revalidatePath("/buddy-reads");
  return { success: true, slug };
}

// ─── Invite to buddy read ───

export async function inviteToBuddyRead(
  buddyReadId: string,
  targetUserId: string,
): Promise<{ success: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not logged in" };

  // Check caller is host or active member
  const membership = await db
    .select({ role: buddyReadMembers.role, status: buddyReadMembers.status })
    .from(buddyReadMembers)
    .where(and(eq(buddyReadMembers.buddyReadId, buddyReadId), eq(buddyReadMembers.userId, user.userId)))
    .get();

  if (!membership || membership.status !== "active") {
    return { success: false, error: "You are not an active member of this buddy read" };
  }

  // Check target not already member
  const existing = await db
    .select({ id: buddyReadMembers.id })
    .from(buddyReadMembers)
    .where(and(eq(buddyReadMembers.buddyReadId, buddyReadId), eq(buddyReadMembers.userId, targetUserId)))
    .get();

  if (existing) {
    return { success: false, error: "User is already a member" };
  }

  // Check member count < maxMembers
  const buddyRead = await db
    .select({ maxMembers: buddyReads.maxMembers, slug: buddyReads.slug })
    .from(buddyReads)
    .where(eq(buddyReads.id, buddyReadId))
    .get();

  if (!buddyRead) return { success: false, error: "Buddy read not found" };

  const memberCount = await db.all(sql`
    SELECT COUNT(*) as c FROM buddy_read_members
    WHERE buddy_read_id = ${buddyReadId} AND status IN ('active', 'invited')
  `) as { c: number }[];

  if (memberCount[0].c >= buddyRead.maxMembers) {
    return { success: false, error: "Buddy read is full" };
  }

  await db.insert(buddyReadMembers).values({
    buddyReadId,
    userId: targetUserId,
    role: "member",
    status: "invited",
  });

  // Notify the invited user
  try {
    const inviter = await db
      .select({ displayName: users.displayName, username: users.username })
      .from(users)
      .where(eq(users.id, user.userId))
      .get();

    const inviterName = inviter?.displayName || (inviter?.username ? `@${inviter.username}` : "Someone");

    await db.insert(userNotifications).values({
      userId: targetUserId,
      type: "buddy_read_invite",
      title: "Buddy read invitation",
      message: `${inviterName} invited you to a buddy read`,
      linkUrl: `/buddy-reads/${buddyRead.slug}`,
    });
  } catch (err) {
    console.error("[buddy-reads] Failed to create invite notification:", err);
  }

  revalidatePath("/buddy-reads");
  revalidatePath(`/buddy-reads/${buddyRead.slug}`);
  return { success: true };
}

// ─── Join buddy read (accept in-app invite or join public) ───

export async function joinBuddyRead(
  buddyReadId: string,
): Promise<{ success: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not logged in" };

  const buddyRead = await db
    .select({ slug: buddyReads.slug, bookId: buddyReads.bookId, isPublic: buddyReads.isPublic, maxMembers: buddyReads.maxMembers, createdBy: buddyReads.createdBy, status: buddyReads.status })
    .from(buddyReads)
    .where(eq(buddyReads.id, buddyReadId))
    .get();

  if (!buddyRead) return { success: false, error: "Buddy read not found" };
  if (buddyRead.status !== "active") return { success: false, error: "Buddy read is no longer active" };

  // Check for existing membership
  const existing = await db
    .select({ id: buddyReadMembers.id, status: buddyReadMembers.status })
    .from(buddyReadMembers)
    .where(and(eq(buddyReadMembers.buddyReadId, buddyReadId), eq(buddyReadMembers.userId, user.userId)))
    .get();

  if (existing) {
    if (existing.status === "invited") {
      // Accept invite
      await db.update(buddyReadMembers)
        .set({ status: "active", joinedAt: new Date().toISOString() })
        .where(eq(buddyReadMembers.id, existing.id));
    } else if (existing.status === "active") {
      return { success: true }; // Already active
    } else {
      return { success: false, error: "Cannot rejoin this buddy read" };
    }
  } else if (buddyRead.isPublic) {
    // Check capacity
    const memberCount = await db.all(sql`
      SELECT COUNT(*) as c FROM buddy_read_members
      WHERE buddy_read_id = ${buddyReadId} AND status IN ('active', 'invited')
    `) as { c: number }[];

    if (memberCount[0].c >= buddyRead.maxMembers) {
      return { success: false, error: "Buddy read is full" };
    }

    await db.insert(buddyReadMembers).values({
      buddyReadId,
      userId: user.userId,
      role: "member",
      status: "active",
      joinedAt: new Date().toISOString(),
    });
  } else {
    return { success: false, error: "This buddy read requires an invitation" };
  }

  // Notify host
  try {
    const joiner = await db
      .select({ displayName: users.displayName, username: users.username })
      .from(users)
      .where(eq(users.id, user.userId))
      .get();

    const joinerName = joiner?.displayName || (joiner?.username ? `@${joiner.username}` : "Someone");

    await db.insert(userNotifications).values({
      userId: buddyRead.createdBy,
      type: "buddy_read_joined",
      title: "New buddy read member",
      message: `${joinerName} joined your buddy read`,
      linkUrl: `/buddy-reads/${buddyRead.slug}`,
    });
  } catch (err) {
    console.error("[buddy-reads] Failed to create join notification:", err);
  }

  // Auto-add book to TBR if user doesn't have it
  try {
    const bookState = await db
      .select({ state: userBookState.state })
      .from(userBookState)
      .where(and(eq(userBookState.userId, user.userId), eq(userBookState.bookId, buddyRead.bookId)))
      .get();

    if (!bookState) {
      await db.insert(userBookState).values({
        userId: user.userId,
        bookId: buddyRead.bookId,
        state: "tbr",
      });
    }
  } catch (err) {
    console.error("[buddy-reads] Failed to auto-add book to TBR:", err);
  }

  revalidatePath("/buddy-reads");
  revalidatePath(`/buddy-reads/${buddyRead.slug}`);
  return { success: true };
}

// ─── Join by invite code ───

export async function joinBuddyReadByCode(
  inviteCode: string,
): Promise<{ success: boolean; slug?: string; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not logged in" };

  const buddyRead = await db
    .select({
      id: buddyReads.id, slug: buddyReads.slug, bookId: buddyReads.bookId,
      status: buddyReads.status, maxMembers: buddyReads.maxMembers, createdBy: buddyReads.createdBy,
    })
    .from(buddyReads)
    .where(eq(buddyReads.inviteCode, inviteCode.toUpperCase().trim()))
    .get();

  if (!buddyRead) return { success: false, error: "Invalid invite code" };
  if (buddyRead.status !== "active") return { success: false, error: "Buddy read is no longer active" };

  // Check if already a member
  const existing = await db
    .select({ id: buddyReadMembers.id, status: buddyReadMembers.status })
    .from(buddyReadMembers)
    .where(and(eq(buddyReadMembers.buddyReadId, buddyRead.id), eq(buddyReadMembers.userId, user.userId)))
    .get();

  if (existing) {
    if (existing.status === "active") return { success: true, slug: buddyRead.slug };
    if (existing.status === "invited") {
      await db.update(buddyReadMembers)
        .set({ status: "active", joinedAt: new Date().toISOString() })
        .where(eq(buddyReadMembers.id, existing.id));
      revalidatePath("/buddy-reads");
      revalidatePath(`/buddy-reads/${buddyRead.slug}`);
      return { success: true, slug: buddyRead.slug };
    }
    return { success: false, error: "Cannot rejoin this buddy read" };
  }

  // Check capacity
  const memberCount = await db.all(sql`
    SELECT COUNT(*) as c FROM buddy_read_members
    WHERE buddy_read_id = ${buddyRead.id} AND status IN ('active', 'invited')
  `) as { c: number }[];

  if (memberCount[0].c >= buddyRead.maxMembers) {
    return { success: false, error: "Buddy read is full" };
  }

  await db.insert(buddyReadMembers).values({
    buddyReadId: buddyRead.id,
    userId: user.userId,
    role: "member",
    status: "active",
    joinedAt: new Date().toISOString(),
  });

  // Notify host
  try {
    const joiner = await db
      .select({ displayName: users.displayName, username: users.username })
      .from(users)
      .where(eq(users.id, user.userId))
      .get();

    const joinerName = joiner?.displayName || (joiner?.username ? `@${joiner.username}` : "Someone");

    await db.insert(userNotifications).values({
      userId: buddyRead.createdBy,
      type: "buddy_read_joined",
      title: "New buddy read member",
      message: `${joinerName} joined your buddy read`,
      linkUrl: `/buddy-reads/${buddyRead.slug}`,
    });
  } catch (err) {
    console.error("[buddy-reads] Failed to create join notification:", err);
  }

  // Auto-add book to TBR if user doesn't have it
  try {
    const bookState = await db
      .select({ state: userBookState.state })
      .from(userBookState)
      .where(and(eq(userBookState.userId, user.userId), eq(userBookState.bookId, buddyRead.bookId)))
      .get();

    if (!bookState) {
      await db.insert(userBookState).values({
        userId: user.userId,
        bookId: buddyRead.bookId,
        state: "tbr",
      });
    }
  } catch (err) {
    console.error("[buddy-reads] Failed to auto-add book to TBR:", err);
  }

  revalidatePath("/buddy-reads");
  revalidatePath(`/buddy-reads/${buddyRead.slug}`);
  return { success: true, slug: buddyRead.slug };
}

// ─── Leave buddy read ───

export async function leaveBuddyRead(
  buddyReadId: string,
): Promise<{ success: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not logged in" };

  const membership = await db
    .select({ id: buddyReadMembers.id, role: buddyReadMembers.role, status: buddyReadMembers.status })
    .from(buddyReadMembers)
    .where(and(eq(buddyReadMembers.buddyReadId, buddyReadId), eq(buddyReadMembers.userId, user.userId)))
    .get();

  if (!membership) return { success: false, error: "Not a member" };
  if (membership.role === "host") return { success: false, error: "Host cannot leave the buddy read" };
  if (membership.status !== "active") return { success: false, error: "Not an active member" };

  await db.update(buddyReadMembers)
    .set({ status: "left" })
    .where(eq(buddyReadMembers.id, membership.id));

  const buddyRead = await db
    .select({ slug: buddyReads.slug })
    .from(buddyReads)
    .where(eq(buddyReads.id, buddyReadId))
    .get();

  revalidatePath("/buddy-reads");
  if (buddyRead) revalidatePath(`/buddy-reads/${buddyRead.slug}`);
  return { success: true };
}

// ─── Complete buddy read (host only) ───

export async function completeBuddyRead(
  buddyReadId: string,
): Promise<{ success: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not logged in" };

  // Verify host
  const membership = await db
    .select({ role: buddyReadMembers.role })
    .from(buddyReadMembers)
    .where(and(eq(buddyReadMembers.buddyReadId, buddyReadId), eq(buddyReadMembers.userId, user.userId)))
    .get();

  if (!membership || membership.role !== "host") {
    return { success: false, error: "Only the host can complete a buddy read" };
  }

  await db.update(buddyReads)
    .set({ status: "completed", updatedAt: new Date().toISOString() })
    .where(eq(buddyReads.id, buddyReadId));

  const buddyRead = await db
    .select({ slug: buddyReads.slug, name: buddyReads.name })
    .from(buddyReads)
    .where(eq(buddyReads.id, buddyReadId))
    .get();

  // Notify all active members
  try {
    const activeMembers = await db.all(sql`
      SELECT user_id FROM buddy_read_members
      WHERE buddy_read_id = ${buddyReadId} AND status = 'active' AND user_id != ${user.userId}
    `) as { user_id: string }[];

    for (const member of activeMembers) {
      await db.insert(userNotifications).values({
        userId: member.user_id,
        type: "buddy_read_completed",
        title: "Buddy read completed",
        message: `"${buddyRead?.name}" has been marked as completed`,
        linkUrl: buddyRead?.slug ? `/buddy-reads/${buddyRead.slug}` : undefined,
      });
    }
  } catch (err) {
    console.error("[buddy-reads] Failed to create completion notifications:", err);
  }

  revalidatePath("/buddy-reads");
  if (buddyRead) revalidatePath(`/buddy-reads/${buddyRead.slug}`);
  return { success: true };
}

// ─── Post message ───

export async function postBuddyReadMessage(
  buddyReadId: string,
  message: string,
): Promise<{ success: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not logged in" };

  // Validate active membership
  const membership = await db
    .select({ status: buddyReadMembers.status })
    .from(buddyReadMembers)
    .where(and(eq(buddyReadMembers.buddyReadId, buddyReadId), eq(buddyReadMembers.userId, user.userId)))
    .get();

  if (!membership || membership.status !== "active") {
    return { success: false, error: "Not an active member of this buddy read" };
  }

  const trimmed = message.trim();
  if (!trimmed || trimmed.length > 2000) {
    return { success: false, error: "Message must be 1-2000 characters" };
  }

  await db.insert(buddyReadMessages).values({
    buddyReadId,
    userId: user.userId,
    message: trimmed,
  });

  const buddyRead = await db
    .select({ slug: buddyReads.slug })
    .from(buddyReads)
    .where(eq(buddyReads.id, buddyReadId))
    .get();

  if (buddyRead) revalidatePath(`/buddy-reads/${buddyRead.slug}`);
  return { success: true };
}

// ─── Decline buddy read invitation ───

export async function declineBuddyRead(
  buddyReadId: string,
): Promise<{ success: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not logged in" };

  const membership = await db
    .select({ id: buddyReadMembers.id, status: buddyReadMembers.status })
    .from(buddyReadMembers)
    .where(and(eq(buddyReadMembers.buddyReadId, buddyReadId), eq(buddyReadMembers.userId, user.userId)))
    .get();

  if (!membership) return { success: false, error: "No invitation found" };
  if (membership.status !== "invited") return { success: false, error: "Not in invited status" };

  await db.update(buddyReadMembers)
    .set({ status: "declined" })
    .where(eq(buddyReadMembers.id, membership.id));

  revalidatePath("/buddy-reads");
  return { success: true };
}
