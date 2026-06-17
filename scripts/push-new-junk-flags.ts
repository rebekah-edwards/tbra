/**
 * Push new [AUTO-FLAG: junk-sweep] reported_issues rows to Turso.
 *
 * Why this exists: sync-push.ts deliberately excludes reported_issues, so the
 * nightly junk-sweep's "push" step silently drops its flags (see Claude memory
 * project_junk_sweep_push_gap). Until sync-push grows a reported_issues INSERT
 * step, this script lands the new flags. Idempotent: skips ids already on Turso,
 * FK-checks book_id exists on live first.
 */
require("dotenv").config({ path: ".env.vercel.local" });
import Database from "better-sqlite3";
import path from "path";
import { createGuardedTurso } from "./lib/turso-guard";

type Row = {
  id: string;
  user_id: string;
  book_id: string | null;
  series_id: string | null;
  page_url: string | null;
  description: string;
  status: string;
  resolution: string | null;
  created_at: string;
  resolved_at: string | null;
};

(async () => {
  const db = new Database(path.join(process.cwd(), "data", "tbra.db"));
  db.pragma("journal_mode = WAL");

  const local = db
    .prepare(
      `SELECT id, user_id, book_id, series_id, page_url, description, status, resolution, created_at, resolved_at
       FROM reported_issues
       WHERE description LIKE '[AUTO-FLAG: junk-sweep]%'`,
    )
    .all() as Row[];

  console.log(`[push-junk-flags] ${local.length} junk-sweep rows in local DB`);

  const { remote } = await createGuardedTurso({
    name: "push-new-junk-flags",
    maxRuntimeMs: 10 * 60 * 1000,
    queryTimeoutMs: 30_000,
    longRunning: false,
  });

  // Existing report ids on live
  const liveIds = new Set<string>();
  const liveRows = await remote.execute(
    "SELECT id FROM reported_issues WHERE description LIKE '[AUTO-FLAG: junk-sweep]%'",
  );
  for (const r of liveRows.rows) liveIds.add(String(r.id));
  console.log(`[push-junk-flags] ${liveIds.size} junk-sweep rows already on Turso`);

  const missing = local.filter((r) => !liveIds.has(r.id));
  console.log(`[push-junk-flags] ${missing.length} missing on Turso`);

  let inserted = 0;
  let skippedFk = 0;
  for (const r of missing) {
    // FK-check: book_id must exist on live (if set)
    if (r.book_id) {
      const bk = await remote.execute({
        sql: "SELECT 1 FROM books WHERE id = ? LIMIT 1",
        args: [r.book_id],
      });
      if (bk.rows.length === 0) {
        console.log(`  ⚠ skip ${r.id} — book_id ${r.book_id} not on live`);
        skippedFk++;
        continue;
      }
    }
    await remote.execute({
      sql: `INSERT OR IGNORE INTO reported_issues
            (id, user_id, book_id, series_id, page_url, description, status, resolution, created_at, resolved_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        r.id,
        r.user_id,
        r.book_id,
        r.series_id,
        r.page_url,
        r.description,
        r.status,
        r.resolution,
        r.created_at,
        r.resolved_at,
      ],
    });
    inserted++;
  }

  console.log(`[push-junk-flags] Done — inserted ${inserted}, skipped (FK) ${skippedFk}`);
  db.close();
  process.exit(0);
})();
