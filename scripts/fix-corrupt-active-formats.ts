/**
 * One-off repair: fix reading_sessions rows whose `active_formats` was stored
 * as a bare format string (e.g. `paperback`) instead of a JSON array
 * (`["paperback"]`). A bare string is not valid JSON, so JSON.parse() throws
 * during the book page's server render → "Something went wrong" for any book
 * the user finished while one of these rows existed.
 *
 * Wraps each bad value with json_array() and bumps updated_at. Idempotent:
 * re-running finds nothing because fixed rows now start with '['.
 *
 * Guarded per the mandatory Turso-script safety rule (CLAUDE.md).
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.vercel.local") });

import { createGuardedTurso } from "./lib/turso-guard";

(async () => {
  const { remote } = await createGuardedTurso({
    name: "fix-corrupt-active-formats",
    maxRuntimeMs: 5 * 60 * 1000,
    queryTimeoutMs: 30_000,
    longRunning: false,
  });

  const BAD = `active_formats IS NOT NULL AND active_formats != '' AND active_formats NOT LIKE '[%'`;

  const before = await remote.execute(
    `SELECT id, user_id, book_id, state, active_formats FROM reading_sessions WHERE ${BAD}`
  );
  console.log(`Found ${before.rows.length} corrupt reading_sessions row(s) on Turso:`);
  for (const r of before.rows) {
    console.log(`  ${r.id}  state=${r.state}  active_formats=${JSON.stringify(r.active_formats)}`);
  }

  if (before.rows.length === 0) {
    console.log("Nothing to fix.");
    process.exit(0);
  }

  const res = await remote.execute(
    `UPDATE reading_sessions
       SET active_formats = json_array(active_formats),
           updated_at = '2026-06-04T08:30:00.000Z'
     WHERE ${BAD}`
  );
  console.log(`Updated ${res.rowsAffected} row(s).`);

  // Verify
  const after = await remote.execute(
    `SELECT COUNT(*) AS bad FROM reading_sessions WHERE ${BAD}`
  );
  console.log(`Remaining corrupt rows: ${after.rows[0].bad}`);
  console.log(after.rows[0].bad === 0 ? "✅ Turso clean." : "⚠️ Some rows still corrupt!");
  process.exit(0);
})();
