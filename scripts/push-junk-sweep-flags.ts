/**
 * Push new [AUTO-FLAG: junk-sweep] reported_issues rows to Turso.
 * sync-push.ts deliberately skips reported_issues, so the nightly junk-sweep
 * flags never reach Turso on their own. This closes that gap.
 * Idempotent: INSERT OR IGNORE by primary key.
 */
require("dotenv").config({ path: ".env.vercel.local" });
import Database from "better-sqlite3";
import path from "path";
import { createGuardedTurso } from "./lib/turso-guard";

(async () => {
  const db = new Database(path.join(process.cwd(), "data", "tbra.db"));
  const rows = db
    .prepare(
      `SELECT id, user_id, book_id, series_id, page_url, description, status, resolution, created_at, resolved_at
       FROM reported_issues
       WHERE description LIKE '[AUTO-FLAG: junk-sweep]%'`,
    )
    .all() as Record<string, string | null>[];

  console.log(`Local auto-flag rows: ${rows.length}`);

  const { remote } = await createGuardedTurso({
    name: "push-junk-sweep-flags",
    maxRuntimeMs: 10 * 60 * 1000,
    queryTimeoutMs: 30_000,
    longRunning: false,
  });

  // Which already exist on Turso?
  const liveIds = new Set<string>();
  const liveRes = await remote.execute({
    sql: `SELECT id FROM reported_issues WHERE description LIKE '[AUTO-FLAG: junk-sweep]%'`,
    args: [],
  });
  for (const r of liveRes.rows) liveIds.add(r.id as string);
  console.log(`Live auto-flag rows already present: ${liveIds.size}`);

  const missing = rows.filter((r) => !liveIds.has(r.id as string));
  console.log(`Missing on live, pushing: ${missing.length}`);

  let pushed = 0;
  for (const r of missing) {
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
    pushed++;
  }

  console.log(`✓ Pushed ${pushed} new auto-flag rows to Turso`);
  db.close();
  process.exit(0);
})();
