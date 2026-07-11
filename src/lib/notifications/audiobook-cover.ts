/**
 * Audiobook-cover-needed admin notifications.
 *
 * Fired whenever a user marks a book's AUDIOBOOK format — as their active
 * "reading now" format or as an owned format — and the book has no square
 * audiobook image uploaded (books.audiobook_cover_url IS NULL). The admin
 * uploads these manually (saves Brave API spend), so she wants to know the
 * moment demand appears. The /admin/covers?tab=audiobook queue is the
 * always-current list; this notification is the proactive ping.
 *
 * Deduped per book: skip when an UNREAD notification for the same book is
 * already sitting in an admin's bell. (Once she reads it, a later re-mark
 * may ping again — acceptable, and the queue tab is the source of truth.)
 *
 * Failures are logged but never thrown — a notification hiccup should not
 * fail the underlying format save.
 */
import { db } from "@/db";
import { books, users, userNotifications } from "@/db/schema";
import { and, eq, like } from "drizzle-orm";

const NOTIFICATION_TYPE = "audiobook_cover_needed";

export async function notifyAdminsIfAudiobookCoverMissing(params: {
  bookId: string;
  /** The formats the user just saved (owned or active). */
  formats: string[];
}) {
  try {
    if (!params.formats.includes("audiobook")) return;

    const book = await db
      .select({
        title: books.title,
        audiobookCoverUrl: books.audiobookCoverUrl,
      })
      .from(books)
      .where(eq(books.id, params.bookId))
      .get();
    if (!book || book.audiobookCoverUrl) return;

    // Dedupe: an unread ping for this book already exists.
    const linkUrl = `/admin/covers?tab=audiobook&book=${params.bookId}`;
    const existing = await db
      .select({ id: userNotifications.id })
      .from(userNotifications)
      .where(
        and(
          eq(userNotifications.type, NOTIFICATION_TYPE),
          eq(userNotifications.read, false),
          like(userNotifications.linkUrl, `%book=${params.bookId}%`)
        )
      )
      .get();
    if (existing) return;

    const admins = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.accountType, "super_admin"))
      .all();
    if (admins.length === 0) return;

    await db.insert(userNotifications).values(
      admins.map((a) => ({
        userId: a.id,
        type: NOTIFICATION_TYPE,
        title: "Audiobook cover needed",
        message: `A reader marked the audiobook format for "${book.title}", but it has no square audiobook image yet.`,
        linkUrl,
      }))
    );
  } catch (err) {
    console.error(
      "[notifications/audiobook-cover] notifyAdminsIfAudiobookCoverMissing failed",
      err
    );
  }
}
