/**
 * notify-author-followers.ts — Send notifications to users who follow authors
 * when new books by those authors are added to the catalog.
 *
 * Called by the nightly enrichment task after enrichment + before sync push.
 * Looks at books created in the last 25 hours (slight overlap to avoid misses).
 * De-duplicates to prevent repeat notifications on re-runs.
 *
 * Usage: npx tsx scripts/notify-author-followers.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@libsql/client";
import crypto from "crypto";

const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;

const db = TURSO_URL
  ? createClient({ url: TURSO_URL, authToken: TURSO_TOKEN })
  : createClient({ url: "file:data/tbra.db" });

async function main() {
  console.log("\n📚 Checking for new books by followed authors...\n");

  // 1. Find books created in the last 25 hours with their authors
  const newBooks = await db.execute(
    `SELECT b.id as book_id, b.title, b.slug as book_slug,
            ba.author_id, a.name as author_name
     FROM books b
     JOIN book_authors ba ON ba.book_id = b.id
     JOIN authors a ON a.id = ba.author_id
     WHERE b.created_at >= datetime('now', '-25 hours')
       AND b.visibility = 'public'`
  );

  if (newBooks.rows.length === 0) {
    console.log("  No new books in the last 25 hours. Done.");
    process.exit(0);
  }

  // 2. Collect distinct author IDs from new books
  const authorIds = [...new Set(newBooks.rows.map((r) => r.author_id as string))];
  console.log(`  Found ${newBooks.rows.length} new book-author pairs across ${authorIds.length} authors.`);

  // 3. Find all followers of those authors
  const placeholders = authorIds.map(() => "?").join(", ");
  const followers = await db.execute({
    sql: `SELECT user_id, author_id FROM author_follows WHERE author_id IN (${placeholders})`,
    args: authorIds,
  });

  if (followers.rows.length === 0) {
    console.log("  No followers for these authors. Done.");
    process.exit(0);
  }

  console.log(`  Found ${followers.rows.length} author-follow relationships to notify.`);

  // 4. Build a map of author_id -> follower user_ids
  const authorFollowerMap = new Map<string, string[]>();
  for (const row of followers.rows) {
    const authorId = row.author_id as string;
    const userId = row.user_id as string;
    if (!authorFollowerMap.has(authorId)) {
      authorFollowerMap.set(authorId, []);
    }
    authorFollowerMap.get(authorId)!.push(userId);
  }

  // 5. Create notifications, de-duping by checking existing
  let created = 0;
  let skipped = 0;

  for (const bookRow of newBooks.rows) {
    const authorId = bookRow.author_id as string;
    const authorName = bookRow.author_name as string;
    const bookTitle = bookRow.title as string;
    const followerIds = authorFollowerMap.get(authorId);

    if (!followerIds || followerIds.length === 0) continue;

    const message = `${bookTitle} by ${authorName} was just added to the catalog`;

    for (const userId of followerIds) {
      // De-dup: check if this exact notification already exists
      const existing = await db.execute({
        sql: `SELECT id FROM user_notifications
              WHERE user_id = ? AND type = 'followed_author_new_book' AND message = ?
              LIMIT 1`,
        args: [userId, message],
      });

      if (existing.rows.length > 0) {
        skipped++;
        continue;
      }

      await db.execute({
        sql: `INSERT INTO user_notifications (id, user_id, type, title, message, read, created_at)
              VALUES (?, ?, 'followed_author_new_book', ?, ?, 0, datetime('now'))`,
        args: [crypto.randomUUID(), userId, `New book by ${authorName}`, message],
      });
      created++;
    }
  }

  console.log(`  ✓ Created ${created} notifications (${skipped} duplicates skipped).`);
  console.log("  Done.\n");
}

main().catch((err) => {
  console.error("Error in notify-author-followers:", err);
  process.exit(1);
});
