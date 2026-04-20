/**
 * ARC review notifications.
 *   - notifyAdminsOfArcSubmission: ping every super_admin when a reader files
 *     a new ARC review awaiting approval.
 *   - notifyReviewerOfArcDecision: ping the reviewer when an admin approves
 *     or rejects their pre-release review.
 *
 * Failures are logged but never thrown — a notification hiccup should not
 * fail the underlying review save / admin action.
 */
import { db } from "@/db";
import { users, userNotifications } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function notifyAdminsOfArcSubmission(params: {
  reviewerId: string;
  reviewerDisplayName: string | null;
  reviewerUsername: string | null;
  bookTitle: string;
  arcSource: string;
}) {
  try {
    const admins = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.accountType, "super_admin"))
      .all();
    if (admins.length === 0) return;

    const who = params.reviewerDisplayName || params.reviewerUsername || "A reader";
    const rows = admins.map((a) => ({
      userId: a.id,
      type: "arc_submitted",
      title: "New ARC review awaiting approval",
      message: `${who} submitted a ${params.arcSource} review for "${params.bookTitle}".`,
      linkUrl: "/admin/arc-reviews?status=pending",
    }));
    await db.insert(userNotifications).values(rows);
  } catch (err) {
    console.error("[notifications/arc] notifyAdminsOfArcSubmission failed", err);
  }
}

export async function notifyReviewerOfArcDecision(params: {
  reviewerId: string;
  bookTitle: string;
  bookSlug: string | null;
  bookId: string;
  approved: boolean;
}) {
  try {
    const link = `/book/${params.bookSlug ?? params.bookId}`;
    const row = {
      userId: params.reviewerId,
      type: params.approved ? "arc_approved" : "arc_rejected",
      title: params.approved
        ? "Your ARC review was approved"
        : "Your ARC review wasn't approved",
      message: params.approved
        ? `Your pre-release review of "${params.bookTitle}" is now visible to everyone.`
        : `Your pre-release review of "${params.bookTitle}" wasn't approved. Reach out if you have questions.`,
      linkUrl: link,
    };
    await db.insert(userNotifications).values(row);
  } catch (err) {
    console.error("[notifications/arc] notifyReviewerOfArcDecision failed", err);
  }
}
