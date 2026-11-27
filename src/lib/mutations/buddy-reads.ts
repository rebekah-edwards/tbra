import { db } from "@/db";
import { buddyReads, buddyReadMembers, buddyReadMessages, userNotifications, users } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

// User-scoped buddy-read writes shared by the web actions
// (lib/actions/buddy-reads.ts) and /api/v1. Deliberately NOT a "use server"
// module: these take a user id, so they must never be callable from a client.

export type BuddyReadLifecycle = "completed" | "archived" | "active";

/**
 * Core lifecycle change, callable with an explicit user id (web actions and
 * /api/v1). Host only. Cancelling never deletes anything — the row, members
 * and discussion stay, the buddy read just leaves everyone's lists (sync
 * never deletes, so a hard delete would come back anyway).
 */
export async function setBuddyReadStatusFor(
  userId: string,
  buddyReadId: string,
  status: BuddyReadLifecycle,
): Promise<{ success: boolean; error?: string }> {
  const membership = await db
    .select({ role: buddyReadMembers.role })
    .from(buddyReadMembers)
    .where(and(eq(buddyReadMembers.buddyReadId, buddyReadId), eq(buddyReadMembers.userId, userId)))
    .get();

  if (!membership || membership.role !== "host") {
    return { success: false, error: "Only the host can change this buddy read" };
  }

  const current = await db
    .select({ slug: buddyReads.slug, name: buddyReads.name, status: buddyReads.status })
    .from(buddyReads)
    .where(eq(buddyReads.id, buddyReadId))
    .get();
  if (!current) return { success: false, error: "Buddy read not found" };
  if (current.status === status) return { success: true };
  if (status === "active" && current.status === "archived") {
    return { success: false, error: "A cancelled buddy read can't be reopened" };
  }

  await db.update(buddyReads)
    .set({ status, updatedAt: new Date().toISOString() })
    .where(eq(buddyReads.id, buddyReadId));

  const host = await db.select({ displayName: users.displayName, username: users.username })
    .from(users).where(eq(users.id, userId)).get();
  const hostName = host?.displayName || host?.username || "The host";
  const eventText =
    status === "completed" ? `${hostName} marked the buddy read finished`
    : status === "archived" ? `${hostName} cancelled the buddy read`
    : `${hostName} reopened the buddy read`;
  try {
    await db.insert(buddyReadMessages).values({ buddyReadId, userId, message: eventText, kind: "status" });
  } catch (err) {
    console.error("[buddy-reads] Failed to post status event:", err);
  }

  // Tell the other active members (not for a reopen).
  if (status !== "active") {
    try {
      const activeMembers = await db.all(sql`
        SELECT user_id FROM buddy_read_members
        WHERE buddy_read_id = ${buddyReadId} AND status = 'active' AND user_id != ${userId}
      `) as { user_id: string }[];

      for (const member of activeMembers) {
        await db.insert(userNotifications).values({
          userId: member.user_id,
          type: status === "completed" ? "buddy_read_completed" : "buddy_read_cancelled",
          title: status === "completed" ? "Buddy read finished" : "Buddy read cancelled",
          message: status === "completed"
            ? `"${current.name}" has been marked as finished`
            : `"${current.name}" was cancelled by the host`,
          linkUrl: status === "completed" ? `/buddy-reads/${current.slug}` : "/buddy-reads",
        });
      }
    } catch (err) {
      console.error("[buddy-reads] Failed to create lifecycle notifications:", err);
    }
  }

  revalidatePath("/buddy-reads");
  revalidatePath(`/buddy-reads/${current.slug}`);
  return { success: true };
}

// ─── Reading activity → discussion events ───

const STATE_EVENT: Record<string, string> = {
  currently_reading: "started reading",
  completed: "finished the book",
  dnf: "stopped reading (DNF)",
  paused: "paused reading",
};

/**
 * Post an automatic event to every ACTIVE buddy read for this book that the
 * reader is an active member of, when their reading state changes. Never
 * throws — a failed event must not fail the state change.
 */
export async function postReadingStateToBuddyReads(
  userId: string,
  bookId: string,
  newState: string | null,
  previousState: string | null,
): Promise<void> {
  try {
    if (!newState || newState === previousState) return;
    const verb = STATE_EVENT[newState];
    if (!verb) return;
    const rows = await db.all(sql`
      SELECT br.id, br.slug FROM buddy_reads br
      JOIN buddy_read_members brm ON brm.buddy_read_id = br.id
      WHERE br.book_id = ${bookId} AND br.status = 'active'
        AND brm.user_id = ${userId} AND brm.status = 'active'
    `) as { id: string; slug: string }[];
    if (rows.length === 0) return;
    const u = await db.select({ displayName: users.displayName, username: users.username })
      .from(users).where(eq(users.id, userId)).get();
    const name = u?.displayName || u?.username || "A reader";
    for (const r of rows) {
      await db.insert(buddyReadMessages).values({
        buddyReadId: r.id,
        userId,
        message: `${name} ${verb}`,
        kind: "status",
      });
      revalidatePath(`/buddy-reads/${r.slug}`);
    }
  } catch (err) {
    console.error("[buddy-reads] Failed to post reading-state event:", err);
  }
}

