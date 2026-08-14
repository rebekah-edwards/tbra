/**
 * resolve-report.ts — close a reported_issues row on BOTH databases, with verification.
 *
 * Every triage night ends with "these reports are now fixed". Doing that by hand
 * invites two recurring mistakes: resolving on Turso only (local still shows the
 * report open, and the next sync can disagree), and claiming a report resolved
 * without checking the write landed. feedback_triage_verification exists because
 * the second one actually happened.
 *
 * Usage:
 *   npx tsx scripts/resolve-report.ts --id=<uuid> [--id=<uuid> …] --note="what was done"
 *   npx tsx scripts/resolve-report.ts --id=<uuid> --status=wontfix --note="…"
 *
 * Exits non-zero if any row did not end up resolved on both sides.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env.vercel.local" });
import { createGuardedTurso } from "./lib/turso-guard";
import Database from "better-sqlite3";

const ids = process.argv.filter((a) => a.startsWith("--id=")).map((a) => a.slice(5));
const note = process.argv.find((a) => a.startsWith("--note="))?.slice(7);
const status = process.argv.find((a) => a.startsWith("--status="))?.slice(9) ?? "resolved";

if (ids.length === 0 || !note) {
  console.error('Usage: resolve-report.ts --id=<uuid> [--id=…] --note="what was done" [--status=resolved|wontfix]');
  process.exit(1);
}
if (!["resolved", "wontfix", "in_progress"].includes(status)) {
  console.error(`Invalid --status=${status}. Use resolved | wontfix | in_progress.`);
  process.exit(1);
}

(async () => {
  const local = new Database("data/tbra.db");
  const { remote } = await createGuardedTurso({
    name: "resolve-report",
    maxRuntimeMs: 10 * 60 * 1000,
    queryTimeoutMs: 30_000,
  });

  const now = new Date().toISOString();
  const resolvedAt = status === "in_progress" ? null : now;
  const sql = `UPDATE reported_issues SET status=?, resolution=?, resolved_at=? WHERE id=?`;

  for (const id of ids) {
    local.prepare(sql).run(status, note, resolvedAt, id);
    await remote.execute({ sql, args: [status, note, resolvedAt, id] });
  }

  // Verify on both sides — a silent no-op (bad id) must not read as success.
  let bad = 0;
  for (const id of ids) {
    const l = local.prepare(`SELECT status FROM reported_issues WHERE id=?`).get(id) as { status?: string } | undefined;
    const t = await remote.execute({ sql: `SELECT status FROM reported_issues WHERE id=?`, args: [id] });
    const ts = (t.rows[0] as { status?: string } | undefined)?.status;
    const ok = l?.status === status && ts === status;
    if (!ok) bad++;
    console.log(`${ok ? "✓" : "✗"} ${id}  local=${l?.status ?? "MISSING"}  turso=${ts ?? "MISSING"}`);
  }

  console.log(bad === 0 ? `\n${ids.length} report(s) → ${status}, verified on both databases.` : `\n${bad} FAILED`);
  try { local.close(); } catch { /* best effort */ }
  process.exit(bad === 0 ? 0 : 1);
})();
