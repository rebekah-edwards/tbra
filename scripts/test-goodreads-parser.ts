/**
 * Quick test of the Goodreads CSV parser.
 */
import { readFileSync } from "fs";
import { parseGoodreadsCSV } from "../src/lib/import/parse-goodreads";

const csvText = readFileSync("/Users/clankeredwards/Desktop/goodreads_library_export.csv", "utf-8");
const rows = parseGoodreadsCSV(csvText);

console.log(`Total rows: ${rows.length}`);
console.log();

// Show first 5 rows as a sanity check
for (const row of rows.slice(0, 5)) {
  console.log(`Title: "${row.title}"`);
  console.log(`  Author: ${row.author}`);
  console.log(`  Series: ${row.seriesName ?? "none"} #${row.seriesPosition ?? "-"}`);
  console.log(`  ISBN10: ${row.isbn10 ?? "none"} | ISBN13: ${row.isbn13 ?? "none"}`);
  console.log(`  Rating: ${row.rating ?? "unrated"}`);
  console.log(`  Status: ${row.readStatus ?? "none"}`);
  console.log(`  Date Read: ${row.dateRead ?? "none"}`);
  console.log(`  Format: ${row.format ?? "unknown"}`);
  console.log(`  Review: ${row.review ? row.review.slice(0, 60) + "..." : "none"}`);
  console.log(`  Spoiler: ${row.isSpoiler}`);
  console.log(`  Read Count: ${row.readCount}`);
  console.log(`  Owned: ${row.ownedCopies}`);
  console.log(`  Custom shelves: ${row.customShelves.join(", ") || "none"}`);
  console.log();
}

// Stats
console.log("--- Stats ---");
console.log(`With ISBN: ${rows.filter((r) => r.isbn13 || r.isbn10).length}`);
console.log(`Without ISBN: ${rows.filter((r) => !r.isbn13 && !r.isbn10).length}`);
console.log(`With series: ${rows.filter((r) => r.seriesName).length}`);
console.log(`Rated: ${rows.filter((r) => r.rating).length}`);
console.log(`Reviewed: ${rows.filter((r) => r.review).length}`);
console.log(`Spoilers: ${rows.filter((r) => r.isSpoiler).length}`);
console.log(`Re-reads: ${rows.filter((r) => r.readCount > 1).length}`);
console.log(`Favorites: ${rows.filter((r) => r.customShelves.some((s) => s.includes("favorite"))).length}`);
console.log(`Owned: ${rows.filter((r) => r.ownedCopies > 0).length}`);

// Show unique formats
const formats = new Set(rows.map((r) => r.format).filter(Boolean));
console.log(`Formats: ${[...formats].join(", ")}`);

// Show unique statuses
const statuses = new Map<string, number>();
for (const row of rows) {
  const s = row.readStatus ?? "none";
  statuses.set(s, (statuses.get(s) ?? 0) + 1);
}
console.log("Statuses:", Object.fromEntries(statuses));

// Show unique custom shelves
const shelves = new Set<string>();
for (const row of rows) {
  for (const s of row.customShelves) shelves.add(s);
}
console.log(`Custom shelves: ${[...shelves].join(", ")}`);

// Show books with no ISBN
console.log("\nBooks without ISBN:");
for (const row of rows.filter((r) => !r.isbn13 && !r.isbn10).slice(0, 10)) {
  console.log(`  "${row.title}" by ${row.author}`);
}
