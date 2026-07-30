/**
 * Run Goodreads import for a user directly from CLI.
 *
 * Usage: npx tsx scripts/run-goodreads-import.ts <userId> <csvPath> --target=prod|local
 *
 * WHY THE --target FLAG IS MANDATORY (added 2026-07-30):
 * This script imports through `@/db`, which ALWAYS resolves to the LOCAL sqlite file.
 * Local user rows for anyone except rebekah_creates / clanker_test can never sync to
 * production, because sync-user-activity's `pushable()` ghost-resurrection guard filters
 * on APP_USERS. So running this for a tester silently produced a library that exists only
 * on this Mac. That is exactly how myerschar9 ended up with 1,169 books here and an EMPTY
 * library on thebasedreader.app for 11 days.
 *
 *   --target=prod   import locally, then immediately push THIS USER's rows to production
 *                   via sync-user-activity's supervised PUSH_USERS override. Use this
 *                   whenever the import is on behalf of a real user.
 *   --target=local  local only, deliberately (dev/testing). Prints a loud warning.
 */
import { readFileSync } from "fs";
import { execFileSync } from "child_process";
import { parseGoodreadsCSV } from "../src/lib/import/parse-goodreads";
import { importGoodreadsRows } from "../src/lib/import/import-goodreads";

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const userId = args[0];
  const csvPath = args[1];
  const target = process.argv.find((a) => a.startsWith("--target="))?.split("=")[1];

  if (!userId || !csvPath) {
    console.error("Usage: npx tsx scripts/run-goodreads-import.ts <userId> <csvPath> --target=prod|local");
    process.exit(1);
  }
  if (target !== "prod" && target !== "local") {
    console.error(
      "\nERROR: --target is required.\n\n" +
        "  --target=prod   import, then push this user's rows to production (use for real users)\n" +
        "  --target=local  local only, deliberately (dev/testing)\n\n" +
        "This script writes to LOCAL sqlite. Without a follow-up push, a real user's library\n" +
        "never reaches thebasedreader.app — they see an empty account. See\n" +
        "project_tester_libraries_stuck_local in memory.\n",
    );
    process.exit(1);
  }
  if (target === "local") {
    console.warn(
      "\n⚠️  --target=local: rows land ONLY in local sqlite and will NOT reach production.\n" +
        "   Do not use this for a real user's import.\n",
    );
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

  if (target === "prod") {
    // Close the loop in the same command. Doing this by hand is exactly the step that
    // got skipped before, leaving a tester's whole library stranded on this Mac.
    console.log("\n=== Pushing to production ===");
    console.log(`Running sync-user-activity with PUSH_USERS=${userId} …`);
    try {
      execFileSync(
        "npx",
        ["tsx", "scripts/sync-user-activity.ts"],
        {
          stdio: "inherit",
          env: {
            ...process.env,
            PUSH_USERS: userId,
            // Imported rows carry the source service's historical read dates, which are
            // far older than APP_ERA; without this the era gate silently drops them all.
            PUSH_ERA: "2000-01-01",
            SYNC_MAX_MINUTES: process.env.SYNC_MAX_MINUTES ?? "45",
          },
        },
      );
      console.log("\n✓ Push complete. Verify the user's library on thebasedreader.app.");
    } catch {
      console.error(
        "\n✗ PUSH FAILED — the import is in LOCAL ONLY and the user will see an empty library.\n" +
          `  Re-run manually once the cause is fixed:\n\n` +
          `  PUSH_USERS=${userId} PUSH_ERA=2000-01-01 SYNC_MAX_MINUTES=45 npx tsx scripts/sync-user-activity.ts\n`,
      );
      process.exit(1);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
