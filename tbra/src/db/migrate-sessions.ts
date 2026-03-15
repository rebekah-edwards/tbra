/**
 * One-time migration: create reading_sessions from existing user_book_state rows.
 * Run with: npx tsx src/db/migrate-sessions.ts
 */
import { db } from "./index";
import { userBookState, readingSessions } from "./schema";
import { isNotNull } from "drizzle-orm";

async function migrate() {
  // Get all user_book_state rows that have a state set
  const rows = await db
    .select()
    .from(userBookState)
    .where(isNotNull(userBookState.state))
    .all();

  let created = 0;
  let skipped = 0;

  for (const row of rows) {
    if (!row.state || row.state === "tbr") {
      // TBR doesn't get a session — it's just a wishlist state
      skipped++;
      continue;
    }

    // Check if a session already exists
    const existing = await db
      .select()
      .from(readingSessions)
      .where(
        (await import("drizzle-orm")).and(
          (await import("drizzle-orm")).eq(readingSessions.userId, row.userId),
          (await import("drizzle-orm")).eq(readingSessions.bookId, row.bookId),
        )
      )
      .get();

    if (existing) {
      skipped++;
      continue;
    }

    await db.insert(readingSessions).values({
      userId: row.userId,
      bookId: row.bookId,
      readNumber: 1,
      state: row.state,
      startedAt: row.updatedAt, // best approximation we have
      activeFormats: row.activeFormats,
    });
    created++;
  }

  console.log(`Migration complete: ${created} sessions created, ${skipped} skipped`);
}

migrate().catch(console.error);
