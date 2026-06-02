/**
 * Auto-fill empty covers from the NYT bestseller cache.
 *
 * Targets ONLY books with no usable cover (the same set as the /admin/covers
 * queue) and fills them from `nyt_bestsellers.book_image` — but exclusively on an
 * EXACT ISBN-13 match (highest confidence; can't mismatch a different edition).
 * Never touches a book that already has a cover, and never overrides a 'manual'
 * or existing 'nyt' cover. The title|author fallback is intentionally reserved for
 * the admin one-click picker, where a human eyeballs the thumbnail first.
 *
 * Writes LOCAL only; the nightly sync-push mirrors cover_image_url/cover_source up
 * to Turso. Hotlinks the NYT CDN URL (static01.nyt.com is whitelisted in
 * next.config.ts), consistent with how OL/ISBNdb/Amazon covers are stored.
 */
require("dotenv").config({ path: ".env.local" });

import { db } from "../src/db";
import { books } from "../src/db/schema";
import { sql, eq } from "drizzle-orm";

(async () => {
  const candidates = await db.all<{ id: string; cover: string }>(sql.raw(`
    SELECT b.id AS id, n.book_image AS cover
    FROM books b
    JOIN nyt_bestsellers n ON n.isbn_13 = b.isbn_13
    WHERE b.visibility = 'public'
      AND (b.cover_image_url IS NULL OR b.cover_image_url = '')
      AND (b.cover_source IS NULL OR b.cover_source NOT IN ('manual', 'nyt'))
      AND n.book_image IS NOT NULL AND n.book_image != ''
  `));

  console.log(`[nyt-cover-fill] ${candidates.length} empty-cover books have an exact-ISBN NYT cover`);

  let filled = 0;
  const now = new Date().toISOString();
  for (const c of candidates) {
    await db
      .update(books)
      .set({
        coverImageUrl: c.cover,
        coverVerified: true,
        coverSource: "nyt",
        updatedAt: now,
      })
      .where(eq(books.id, c.id));
    filled++;
  }

  console.log(`[nyt-cover-fill] filled ${filled} covers from NYT (cover_source='nyt')`);
  process.exit(0);
})().catch((err) => {
  console.error("[nyt-cover-fill] failed:", err);
  process.exit(1);
});
