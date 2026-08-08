/**
 * check-local-only-user-activity.ts — detect user data stranded on this Mac.
 *
 * THE FAILURE THIS CATCHES (2026-07-30):
 * Anything that writes user rows to LOCAL sqlite on behalf of a real user — the CLI
 * importer, or a CSV uploaded through the local dev server's /api/import/* endpoints —
 * produces rows that can NEVER reach production, because sync-user-activity's
 * `pushable()` guard only pushes owners in APP_USERS (rebekah_creates, clanker_test).
 * myerschar9 sat with 1,169 books here and an EMPTY library on thebasedreader.app for
 * 11 days, and nothing surfaced it. This is the missing alarm.
 *
 * Read-only. Compares local vs prod per user and files a deduped /admin/issues alert
 * when a non-APP_USERS account has meaningful activity here that prod lacks.
 *
 * Usage: npx tsx scripts/check-local-only-user-activity.ts [--threshold=25] [--quiet]
 * Intended to run from launchd via scripts/lib/cron-run.sh, like the other mechanical jobs.
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.vercel.local" });
import Database from "better-sqlite3";
import { createClient } from "@libsql/client";
import path from "path";

/** Owners whose local rows are expected and legitimately pushable.
    Single source of truth, shared with sync-user-activity.ts and the /import
    route guard — see src/lib/sync/app-users.ts. */
import { SYNCABLE_USER_IDS as APP_USERS } from "../src/lib/sync/app-users";

const THRESHOLD = Number(process.argv.find((a) => a.startsWith("--threshold="))?.split("=")[1] ?? 25);
const QUIET = process.argv.includes("--quiet");
const TABLES = ["user_book_state", "user_book_ratings", "user_book_reviews"];

(async () => {
  const local = new Database(path.join(process.cwd(), "data", "tbra.db"), { readonly: true });
  const remote = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  });

  const users = local.prepare("SELECT id, email FROM users").all() as { id: string; email: string }[];
  const stranded: { email: string; id: string; gaps: string[]; total: number }[] = [];

  for (const u of users) {
    if (APP_USERS.has(u.id)) continue;
    const gaps: string[] = [];
    let total = 0;
    for (const t of TABLES) {
      const ln = (local.prepare(`SELECT COUNT(*) n FROM ${t} WHERE user_id = ?`).get(u.id) as { n: number }).n;
      if (ln === 0) continue;
      const r = await remote.execute({ sql: `SELECT COUNT(*) n FROM ${t} WHERE user_id = ?`, args: [u.id] });
      const rn = Number((r.rows[0] as { n: number }).n);
      if (ln - rn > 0) {
        gaps.push(`${t.replace("user_book_", "")}: ${ln} local / ${rn} prod`);
        total += ln - rn;
      }
    }
    if (total >= THRESHOLD) stranded.push({ email: u.email, id: u.id, gaps, total });
  }

  stranded.sort((a, b) => b.total - a.total);

  if (!QUIET) {
    console.log(`Checked ${users.length} users (threshold ${THRESHOLD} rows)`);
    console.log(`Accounts with activity stranded on local: ${stranded.length}`);
    for (const s of stranded) console.log(`  ${s.email.padEnd(32)} +${s.total}  (${s.gaps.join(" | ")})`);
  }

  if (stranded.length > 0) {
    const worst = stranded[0];
    const body =
      `${stranded.length} account(s) have user activity on the local Mac that production is missing ` +
      `(${stranded.reduce((n, s) => n + s.total, 0)} rows total). Worst: ${worst.email} +${worst.total}. ` +
      `These CANNOT self-heal — sync-user-activity only pushes APP_USERS. Backfill with:\n` +
      `  PUSH_USERS=<id,...> PUSH_ERA=2000-01-01 SYNC_MAX_MINUTES=45 npx tsx scripts/sync-user-activity.ts\n` +
      `Accounts: ${stranded.map((s) => `${s.email} (+${s.total})`).join(", ")}`;
    const { fileAdminAlert } = await import("./lib/admin-alert");
    const filed = await fileAdminAlert(remote, {
      tag: "local-only-user-activity",
      key: "stranded imports",
      description: body,
    });
    if (!QUIET) console.log(filed ? "\nFiled /admin/issues alert." : "\nAlert already open — not duplicated.");
  } else {
    const { resolveAdminAlert } = await import("./lib/admin-alert");
    const closed = await resolveAdminAlert(remote, {
      tag: "local-only-user-activity",
      key: "stranded imports",
      resolution: "No local-only user activity above threshold.",
    });
    if (!QUIET && closed > 0) console.log(`Resolved ${closed} open alert(s).`);
  }

  local.close();
  process.exit(0);
})();
