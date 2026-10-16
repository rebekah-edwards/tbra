/**
 * Clear scraped Goodreads review-page text out of `books.description`.
 *
 * The Goodreads book page's meta description is its signup prompt plus whichever
 * user review is on top — "Create a free account to discover what your friends
 * think of this book! ... <review text>". That is a reader's opinion, not a
 * description, and it leaks endings. A beta tester reported one on Night Shift
 * Dragons on 2026-10-16; 24 further books carried the same text.
 *
 * `sanitizeDescription` now rejects the pattern so it cannot be written again,
 * but that only guards NEW writes — these rows are already stored, so they need
 * clearing. Sets description = NULL and description_stale = 1 so
 * nightly-description-refresh (Sun/Tue/Thu) refills them from real sources;
 * blank is strictly better than a spoiler-laden review in the meantime, and
 * a non-empty description would keep the book invisible to that lane.
 *
 * Dual-writes: local mirror first (so sync-push cannot re-assert the junk),
 * then Turso, with a verified read-back on both.
 *
 * Usage:
 *   npx tsx scripts/clear-goodreads-review-descriptions.ts --dry-run
 *   npx tsx scripts/clear-goodreads-review-descriptions.ts --apply
 */
import * as fs from "fs";
import * as path from "path";

for (const file of [".env.local", ".env.vercel.local"]) {
  const p = path.join(process.cwd(), file);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let v = t.slice(i + 1);
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    process.env[t.slice(0, i)] = v;
  }
}

const apply = process.argv.includes("--apply");

// Matches the two rules added to sanitizeDescription for this pattern.
const PATTERNS = [
  "Create a free account to discover what your friends think%",
  "%what do your friends think of this book%",
  "%what did your friends think of this book%",
];

(async () => {
  const { createGuardedTurso } = await import("./lib/turso-guard");
  const Database = require("better-sqlite3");
  // Raw better-sqlite3, never `src/db`: that module switches to Turso whenever
  // TURSO_DATABASE_URL is set, which this script loads above.
  const local = new Database(path.join(process.cwd(), "data", "tbra.db"));

  const where = PATTERNS.map(() => "description LIKE ?").join(" OR ");
  const rows = local
    .prepare(
      `SELECT id, title, visibility, length(description) AS len
       FROM books WHERE ${where} ORDER BY title`
    )
    .all(...PATTERNS) as Array<{
    id: string;
    title: string;
    visibility: string;
    len: number;
  }>;

  console.log(`Local rows carrying Goodreads review text: ${rows.length}${apply ? "" : "  [DRY RUN — pass --apply]"}`);
  for (const r of rows) {
    console.log(`  ${r.visibility.padEnd(7)} ${String(r.len).padStart(4)} chars  ${r.title}  (${r.id})`);
  }
  if (!apply || rows.length === 0) {
    console.log(apply ? "Nothing to do." : "\nNo changes written.");
    process.exit(0);
  }

  const { remote } = await createGuardedTurso({
    name: "clear-goodreads-review-descriptions",
    maxRuntimeMs: 20 * 60 * 1000,
    queryTimeoutMs: 30_000,
  });

  let cleared = 0;
  let failed = 0;

  for (const r of rows) {
    try {
      // Local first.
      local
        .prepare(
          `UPDATE books
           SET description = NULL, description_stale = 1, updated_at = datetime('now')
           WHERE id = ?`
        )
        .run(r.id);
      await remote.execute({
        sql: `UPDATE books
              SET description = NULL, description_stale = 1, updated_at = datetime('now')
              WHERE id = ?`,
        args: [r.id],
      });

      const l = local
        .prepare("SELECT description FROM books WHERE id = ?")
        .get(r.id) as { description: string | null } | undefined;
      const liveRow = await remote.execute({
        sql: "SELECT description FROM books WHERE id = ?",
        args: [r.id],
      });
      const live = liveRow.rows[0]?.description as string | null | undefined;
      if (l?.description !== null || (live ?? null) !== null) {
        throw new Error(
          `verify failed — local=${l?.description === null ? "NULL" : "SET"} live=${live === null ? "NULL" : "SET"}`
        );
      }
      cleared++;
      console.log(`  cleared  ${r.title}`);
    } catch (e: unknown) {
      failed++;
      console.log(`  FAILED   ${r.title} — ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  console.log(`\nDONE — cleared ${cleared}, failed ${failed} (of ${rows.length})`);
  process.exit(failed > 0 ? 1 : 0);
})();
