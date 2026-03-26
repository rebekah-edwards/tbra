/**
 * Run Goodreads import for a user directly from CLI.
 * Usage: npx tsx scripts/run-goodreads-import.ts <userId> <csvPath>
 */
import { readFileSync } from "fs";
import { parseGoodreadsCSV } from "../src/lib/import/parse-goodreads";
import { importGoodreadsRows } from "../src/lib/import/import-goodreads";

async function main() {
  const userId = process.argv[2];
  const csvPath = process.argv[3];

  if (!userId || !csvPath) {
    console.error("Usage: npx tsx scripts/run-goodreads-import.ts <userId> <csvPath>");
    process.exit(1);
  }

  console.log(`Reading CSV from ${csvPath}...`);
  const csvText = readFileSync(csvPath, "utf-8");

  console.log("Parsing CSV...");
  const rows = parseGoodreadsCSV(csvText);
  console.log(`Parsed ${rows.length} rows`);

  // Log some stats
  const withISBN = rows.filter((r) => r.isbn13 || r.isbn10).length;
  const withSeries = rows.filter((r) => r.seriesName).length;
  const withReview = rows.filter((r) => r.review).length;
  const withRating = rows.filter((r) => r.rating).length;
  const withDateRead = rows.filter((r) => r.dateRead).length;
  const spoilers = rows.filter((r) => r.isSpoiler).length;
  const reReads = rows.filter((r) => r.readCount > 1).length;
  const favorites = rows.filter((r) => r.customShelves.some((s) => s.includes("favorite"))).length;

  console.log(`  With ISBN: ${withISBN}`);
  console.log(`  With series: ${withSeries}`);
  console.log(`  With review: ${withReview}`);
  console.log(`  With rating: ${withRating}`);
  console.log(`  With date read: ${withDateRead}`);
  console.log(`  Spoiler reviews: ${spoilers}`);
  console.log(`  Re-reads: ${reReads}`);
  console.log(`  Favorites: ${favorites}`);

  console.log("\nStarting import...\n");

  let lastStatus = "";
  for await (const event of importGoodreadsRows(rows, userId)) {
    if (event.type === "progress") {
      const pct = Math.round((event.current / event.total) * 100);
      const statusIcon =
        event.status === "imported" ? "+" :
        event.status === "existing" ? "=" :
        event.status === "error" ? "!" : "-";
      lastStatus = `[${statusIcon}] ${event.current}/${event.total} (${pct}%) ${event.title}`;
      process.stdout.write(`\r${lastStatus.padEnd(100)}`);
      if (event.status === "error") {
        process.stdout.write(`\n  ERROR: ${event.error}\n`);
      }
    } else if (event.type === "done") {
      process.stdout.write("\n\n");
      console.log("=== Import Complete ===");
      console.log(`  Imported: ${event.imported}`);
      console.log(`  Already had: ${event.existing}`);
      console.log(`  Skipped: ${event.skipped}`);
      console.log(`  Errors: ${event.errors.length}`);
      if (event.errors.length > 0) {
        console.log("\nErrors:");
        for (const err of event.errors) {
          console.log(`  - ${err.title}: ${err.error}`);
        }
      }
    }
  }
}

main().catch(console.error);
