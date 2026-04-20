/**
 * Proposed-edits notifications.
 *
 * Fires once per review-submit when any proposedCorrections or
 * userAddedWarnings were included — pings every super_admin so they know
 * there's something in /admin/corrections to verify. Bundled (not per-
 * correction) so admins don't get a notification flood when a user submits
 * a review touching multiple categories.
 *
 * Failures are logged but never thrown.
 */
import { db } from "@/db";
import { users, userNotifications } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function notifyAdminsOfProposedEdits(params: {
  reviewerId: string;
  reviewerDisplayName: string | null;
  reviewerUsername: string | null;
  bookTitle: string;
  bookSlug: string | null;
  bookId: string;
  proposalCount: number;
  userAddedWarningCount: number;
}) {
  try {
    const admins = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.accountType, "super_admin"))
      .all();
    if (admins.length === 0) return;

    const who = params.reviewerDisplayName || params.reviewerUsername || "A reader";
    const parts: string[] = [];
    if (params.proposalCount > 0) {
      parts.push(`${params.proposalCount} intensity proposal${params.proposalCount === 1 ? "" : "s"}`);
    }
    if (params.userAddedWarningCount > 0) {
      parts.push(`${params.userAddedWarningCount} user-added warning${params.userAddedWarningCount === 1 ? "" : "s"}`);
    }
    const summary = parts.join(" + ");

    const rows = admins.map((a) => ({
      userId: a.id,
      type: "proposed_edit_submitted",
      title: "New proposed edits to verify",
      message: `${who} submitted ${summary} for "${params.bookTitle}".`,
      linkUrl: "/admin/corrections",
    }));
    await db.insert(userNotifications).values(rows);
  } catch (err) {
    console.error("[notifications/proposed-edits] notifyAdminsOfProposedEdits failed", err);
  }
}
