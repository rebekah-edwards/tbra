/**
 * One-time cleanup: remove duplicate series entries.
 *
 * For each series, groups books by position. When multiple books share
 * the same position, keeps the one with a cover image (or the first one)
 * and removes the duplicate book_series links. Also removes box sets.
 *
 * Does NOT delete the book records themselves — only unlinks them from the series.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "../src/db";
import { books, bookSeries, series } from "../src/db/schema";
import { eq, and, sql } from "drizzle-orm";

const BOX_SET_PATTERNS = [
  /\bbox\s*set\b/i,
  /\bcollection\s+(set|of)\b/i,
  /\b(books?\s+\d+\s*[-–—]\s*\d+)\b/i,
  /\b(volumes?\s+\d+\s*[-–—]\s*\d+)\b/i,
  /\b(omnibus|anthology|compendium|complete\s+series)\b/i,
  /\b\d+\s*-?\s*book\s+(set|bundle|pack)\b/i,
];

function isBoxSet(title: string): boolean {
  return BOX_SET_PATTERNS.some((p) => p.test(title));
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[:;]\s*.*/g, "")
    .replace(/\(.*?\)/g, "")
    .replace(/^(the|a|an|la|le|les|el|los|las|die|der|das)\s+/i, "")
    .replace(/[''"`\-–—,!?.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
  console.log("=== CLEANING UP SERIES DUPLICATES ===\n");

  // Get all series
  const allSeries = await db.select().from(series).all();
  let totalRemoved = 0;

  for (const s of allSeries) {
    const seriesBooks = await db
      .select({
        bookId: bookSeries.bookId,
        position: bookSeries.positionInSeries,
        title: books.title,
        coverImageUrl: books.coverImageUrl,
      })
      .from(bookSeries)
      .innerJoin(books, eq(bookSeries.bookId, books.id))
      .where(eq(bookSeries.seriesId, s.id));

    if (seriesBooks.length <= 1) continue;

    const toRemove: string[] = []; // bookIds to unlink

    // 1. Remove box sets
    for (const book of seriesBooks) {
      if (isBoxSet(book.title)) {
        toRemove.push(book.bookId);
        console.log(`  [${s.name}] Removing box set: "${book.title}"`);
      }
    }

    // 2. Remove position-based duplicates
    const remaining = seriesBooks.filter((b) => !toRemove.includes(b.bookId));
    const byPosition = new Map<number, typeof remaining>();
    const noPosition: typeof remaining = [];

    for (const book of remaining) {
      if (book.position != null) {
        const group = byPosition.get(book.position) ?? [];
        group.push(book);
        byPosition.set(book.position, group);
      } else {
        noPosition.push(book);
      }
    }

    for (const [pos, group] of byPosition) {
      if (group.length <= 1) continue;
      // Keep the one with a cover, remove rest
      const sorted = [...group].sort((a, b) => {
        if (a.coverImageUrl && !b.coverImageUrl) return -1;
        if (!a.coverImageUrl && b.coverImageUrl) return 1;
        return 0;
      });
      for (let i = 1; i < sorted.length; i++) {
        toRemove.push(sorted[i].bookId);
        console.log(`  [${s.name}] Position ${pos} duplicate: "${sorted[i].title}" (keeping "${sorted[0].title}")`);
      }
    }

    // 3. Remove title-based duplicates among unpositioned books
    const keptTitles = new Set<string>();
    // Add positioned books' titles
    for (const [, group] of byPosition) {
      const kept = group.find((b) => !toRemove.includes(b.bookId));
      if (kept) keptTitles.add(normalizeTitle(kept.title));
    }
    for (const book of noPosition) {
      if (toRemove.includes(book.bookId)) continue;
      const norm = normalizeTitle(book.title);
      if (keptTitles.has(norm)) {
        toRemove.push(book.bookId);
        console.log(`  [${s.name}] Title duplicate: "${book.title}"`);
      } else {
        keptTitles.add(norm);
      }
    }

    // Execute removals
    for (const bookId of toRemove) {
      await db
        .delete(bookSeries)
        .where(and(eq(bookSeries.bookId, bookId), eq(bookSeries.seriesId, s.id)));
    }

    if (toRemove.length > 0) {
      const afterCount = seriesBooks.length - toRemove.length;
      console.log(`  [${s.name}] Removed ${toRemove.length} dupes (${seriesBooks.length} → ${afterCount})\n`);
      totalRemoved += toRemove.length;
    }
  }

  console.log(`\n=== DONE: Removed ${totalRemoved} duplicate series links ===`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
