"use server";

import { db } from "@/db";
import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { sendContentReportEmail } from "@/lib/email";

type Result = { success: boolean; error?: string };

/** Web: block a reader as the signed-in user. */
export async function blockUser(targetUserId: string): Promise<Result> {
  const session = await getCurrentUser();
  if (!session) return { success: false, error: "Not logged in" };
  return blockUserFor(session.userId, targetUserId);
}

/** Web: unblock a reader as the signed-in user. */
export async function unblockUser(targetUserId: string): Promise<Result> {
  const session = await getCurrentUser();
  if (!session) return { success: false, error: "Not logged in" };
  return unblockUserFor(session.userId, targetUserId);
}

/**
 * Core block, callable with an explicit user id (used by /api/v1).
 * Blocking also ends any follow between the two, in both directions —
 * otherwise the blocked reader's activity would keep arriving in the
 * blocker's feed, and vice versa.
 */
export async function blockUserFor(userId: string, targetUserId: string): Promise<Result> {
  if (userId === targetUserId) return { success: false, error: "You can't block yourself" };
  try {
    await db.run(sql`
      INSERT OR IGNORE INTO user_blocks (blocker_id, blocked_id) VALUES (${userId}, ${targetUserId})
    `);
    await db.run(sql`
      DELETE FROM user_follows
      WHERE (follower_id = ${userId} AND followed_id = ${targetUserId})
         OR (follower_id = ${targetUserId} AND followed_id = ${userId})
    `);
  } catch (err) {
    console.error("[blocks] blockUserFor failed:", err);
    return { success: false, error: "Couldn't block this reader. Try again." };
  }
  revalidatePath("/");
  revalidatePath("/u/[username]", "page");
  revalidatePath("/book/[id]", "page");
  return { success: true };
}

/** Core unblock. Does not restore the follows the block removed. */
export async function unblockUserFor(userId: string, targetUserId: string): Promise<Result> {
  try {
    await db.run(sql`
      DELETE FROM user_blocks WHERE blocker_id = ${userId} AND blocked_id = ${targetUserId}
    `);
  } catch (err) {
    console.error("[blocks] unblockUserFor failed:", err);
    return { success: false, error: "Couldn't unblock this reader. Try again." };
  }
  revalidatePath("/");
  revalidatePath("/u/[username]", "page");
  revalidatePath("/book/[id]", "page");
  return { success: true };
}

// ─── Reporting objectionable content ───────────────────────────────────────

/** The reasons offered in the report sheet, on web and iOS alike. */
const REPORT_REASONS: Record<string, string> = {
  spam: "Spam or advertising",
  harassment: "Harassment or bullying",
  hate: "Hate speech",
  sexual: "Sexual or explicit content",
  spoilers: "Spoilers without a warning",
  other: "Something else",
};

export interface ContentReportInput {
  /** What is being reported. */
  kind: "review" | "profile";
  /** The reader who wrote the review / owns the profile. */
  targetUserId: string;
  /** For a review: its id and the book it is on. */
  reviewId?: string | null;
  bookId?: string | null;
  reason: string;
  details?: string | null;
  pageUrl?: string | null;
}

/** Web: report a review or profile as the signed-in user. */
export async function reportContent(input: ContentReportInput): Promise<Result> {
  const session = await getCurrentUser();
  if (!session) return { success: false, error: "Not logged in" };
  return reportContentFor(session.userId, input);
}

/**
 * Core report, callable with an explicit user id (used by /api/v1).
 * Lands in `reported_issues` with a `[UGC report …]` prefix so it stands out
 * in /admin/issues, and emails the admin: Apple expects objectionable-content
 * reports to be acted on within 24 hours, which a queue nobody is told about
 * cannot promise.
 */
export async function reportContentFor(userId: string, input: ContentReportInput): Promise<Result> {
  const reasonLabel = REPORT_REASONS[input.reason];
  if (!reasonLabel) return { success: false, error: "Pick a reason." };
  if (input.kind !== "review" && input.kind !== "profile") return { success: false, error: "Nothing to report." };

  try {
    const rows = (await db.all(sql`
      SELECT id, username, display_name AS displayName FROM users
      WHERE id IN (${userId}, ${input.targetUserId})
    `)) as { id: string; username: string | null; displayName: string | null }[];
    const target = rows.find((r) => r.id === input.targetUserId);
    const reporter = rows.find((r) => r.id === userId);
    if (!target) return { success: false, error: "That reader no longer exists." };

    const handle = target.username ? `@${target.username}` : target.displayName ?? target.id;
    const subject =
      input.kind === "review" ? `review ${input.reviewId ?? "?"} by ${handle}` : `profile ${handle}`;
    const details = (input.details ?? "").trim().slice(0, 1000);
    const description = `[UGC report: ${subject}] ${reasonLabel}${details ? ` — ${details}` : ""}`;
    const pageUrl = (input.pageUrl ?? (target.username ? `/u/${target.username}` : "")).slice(0, 500) || null;

    await db.run(sql`
      INSERT INTO reported_issues (id, user_id, book_id, page_url, description)
      VALUES (${crypto.randomUUID()}, ${userId}, ${input.bookId ?? null}, ${pageUrl}, ${description})
    `);

    // Best-effort: the report is saved either way.
    await sendContentReportEmail({
      subject,
      reason: reasonLabel,
      details,
      reporter: reporter?.username ? `@${reporter.username}` : reporter?.displayName ?? userId,
      pageUrl,
    });
    return { success: true };
  } catch (err) {
    console.error("[blocks] reportContentFor failed:", err);
    return { success: false, error: "Couldn't send the report. Try again." };
  }
}
