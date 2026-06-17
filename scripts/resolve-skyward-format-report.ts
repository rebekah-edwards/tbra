/**
 * One-off: resolve the open beta report about reading-format / owned-editions
 * on "Skyward" (slug skyward-brandon-sanderson) now that the Hardcover-default
 * display bug is fixed + deployed (commit c375e5f).
 *
 * Loads env from .env.vercel.local. Guarded per the Turso script safety rule.
 *
 * Run:  npx tsx scripts/resolve-skyward-format-report.ts          (dry-run: prints reports)
 *       npx tsx scripts/resolve-skyward-format-report.ts --apply  (resolves them)
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.vercel.local" });

import { createGuardedTurso } from "./lib/turso-guard";

const SLUG = "skyward-brandon-sanderson";
const RESOLUTION =
  "Fixed: reading-format display no longer defaults to Hardcover. Reading " +
  "History and the book-page Format button now show the actual selected " +
  "format (e.g. Audiobook), inferring from owned editions when none is set " +
  "instead of assuming Hardcover. Deployed in c375e5f.";

(async () => {
  const apply = process.argv.includes("--apply");
  const { remote } = await createGuardedTurso({
    name: "resolve-skyward-format-report",
    maxRuntimeMs: 5 * 60 * 1000,
    queryTimeoutMs: 30_000,
    longRunning: false,
  });

  // Resolve book id(s) for the slug.
  const books = await remote.execute({
    sql: "SELECT id, title, slug FROM books WHERE slug = ?",
    args: [SLUG],
  });
  if (books.rows.length === 0) {
    console.error(`No book found on Turso with slug '${SLUG}'.`);
    process.exit(1);
  }
  const bookIds = books.rows.map((r) => String(r.id));
  console.log(`Book(s) for slug '${SLUG}':`);
  for (const r of books.rows) console.log(`  ${r.id}  ${r.title}`);

  // Find open reports for these books.
  const placeholders = bookIds.map(() => "?").join(",");
  const open = await remote.execute({
    sql: `SELECT id, user_id, status, description, created_at, resolution
            FROM reported_issues
           WHERE book_id IN (${placeholders}) AND status = 'new'`,
    args: bookIds,
  });

  console.log(`\nOpen (status='new') reports: ${open.rows.length}`);
  for (const r of open.rows) {
    console.log(`  id=${r.id}  created=${r.created_at}`);
    console.log(`    "${r.description}"`);
  }

  if (open.rows.length === 0) {
    console.log("\nNothing to resolve.");
    process.exit(0);
  }

  if (!apply) {
    console.log("\nDry-run. Re-run with --apply to resolve the above.");
    process.exit(0);
  }

  // Resolve each open report, then verify.
  for (const r of open.rows) {
    await remote.execute({
      sql: `UPDATE reported_issues
               SET status = 'resolved',
                   resolved_at = datetime('now'),
                   resolution = ?
             WHERE id = ? AND status = 'new'`,
      args: [RESOLUTION, String(r.id)],
    });
  }

  const verify = await remote.execute({
    sql: `SELECT id, status, resolved_at FROM reported_issues
           WHERE book_id IN (${placeholders})`,
    args: bookIds,
  });
  console.log("\nPost-update report states:");
  for (const r of verify.rows) {
    console.log(`  id=${r.id}  status=${r.status}  resolved_at=${r.resolved_at}`);
  }
  const stillNew = verify.rows.filter((r) => r.status === "new").length;
  if (stillNew > 0) {
    console.error(`\nWARNING: ${stillNew} report(s) still 'new' — resolve failed.`);
    process.exit(2);
  }
  console.log("\nDone — all targeted reports resolved.");
  process.exit(0);
})();
