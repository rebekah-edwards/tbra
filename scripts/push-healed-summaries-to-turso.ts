/**
 * Push locally-healed `summary` / `description` text to production Turso.
 *
 * `heal-truncated-summaries.ts` runs healBook, which writes to the LOCAL db
 * only, so a heal is invisible on thebasedreader.app until it is pushed.
 * sync-push step 5b would carry both fields, but it is an end-to-end run; this
 * is the targeted equivalent for a specific set of book ids.
 *
 * Only `summary` and `description` are touched — never id, slug, visibility,
 * needs_review or created_at, matching 5b's contract. `books.title` is
 * deliberately excluded (see reference_sync_push_title_drift).
 *
 * Usage:
 *   npx tsx scripts/push-healed-summaries-to-turso.ts --ids=<uuid>,<uuid>
 *   npx tsx scripts/push-healed-summaries-to-turso.ts --since-minutes=180
 *   ... add --dry-run to print the diff without writing
 */
import * as fs from "fs";
import * as path from "path";

// .env.local for the app config, .env.vercel.local for the Turso credentials —
// the guard needs TURSO_DATABASE_URL / TURSO_AUTH_TOKEN, which only live there.
for (const file of [".env.local", ".env.vercel.local"]) {
  const envPath = path.join(process.cwd(), file);
  if (!fs.existsSync(envPath)) continue;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx);
    let val = trimmed.slice(eqIdx + 1);
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    process.env[key] = val;
  }
}

const arg = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const dryRun = process.argv.includes("--dry-run");
const explicitIds = arg("ids")?.split(",").map((s) => s.trim()).filter(Boolean);
const sinceMinutes = Number(arg("since-minutes") ?? 0);

(async () => {
  const { createGuardedTurso } = await import("./lib/turso-guard");

  if (!explicitIds && !sinceMinutes) {
    console.error("Pass --ids=<uuid,...> or --since-minutes=<n>");
    process.exit(1);
  }

  // Read the local mirror through better-sqlite3 directly, NOT through
  // `src/db`: that module picks Turso whenever TURSO_DATABASE_URL is set, and
  // this script loads exactly those credentials a few lines above. Importing
  // it here would compare production against itself and report every row
  // "already identical" while pushing nothing (see
  // feedback_turso_script_db_import).
  const Database = require("better-sqlite3");
  const local = new Database(path.join(process.cwd(), "data", "tbra.db"), {
    readonly: true,
  });

  type LocalRow = {
    id: string;
    title: string;
    summary: string | null;
    description: string | null;
  };

  const rows: LocalRow[] = explicitIds
    ? (local
        .prepare(
          `SELECT id, title, summary, description FROM books
           WHERE id IN (${explicitIds.map(() => "?").join(",")})`
        )
        .all(...explicitIds) as LocalRow[])
    : (local
        .prepare(
          `SELECT id, title, summary, description FROM books
           WHERE updated_at >= datetime('now', ?)`
        )
        .all(`-${sinceMinutes} minutes`) as LocalRow[]);

  console.log(`Local candidates: ${rows.length}${dryRun ? "  [DRY RUN]" : ""}`);
  if (rows.length === 0) process.exit(0);

  const { remote } = await createGuardedTurso({
    name: "push-healed-summaries",
    maxRuntimeMs: 30 * 60 * 1000,
    queryTimeoutMs: 30_000,
    longRunning: false,
  });

  let updated = 0;
  let identical = 0;
  let missing = 0;

  for (const row of rows) {
    const live = await remote.execute({
      sql: "SELECT summary, description FROM books WHERE id = ?",
      args: [row.id],
    });
    if (live.rows.length === 0) {
      missing++;
      console.log(`  MISSING on Turso: ${row.title} (${row.id})`);
      continue;
    }
    const liveSummary = live.rows[0].summary as string | null;
    const liveDescription = live.rows[0].description as string | null;
    if (liveSummary === row.summary && liveDescription === row.description) {
      identical++;
      continue;
    }

    console.log(`\n— ${row.title} (${row.id})`);
    if (liveSummary !== row.summary) {
      console.log(`  summary  live[${liveSummary?.length ?? 0}] → local[${row.summary?.length ?? 0}]`);
      console.log(`    new: ${row.summary}`);
    }
    if (liveDescription !== row.description) {
      console.log(
        `  description  live[${liveDescription?.length ?? 0}] → local[${row.description?.length ?? 0}]`
      );
    }
    if (dryRun) continue;

    await remote.execute({
      sql: `UPDATE books
            SET summary = ?, description = ?, updated_at = datetime('now')
            WHERE id = ?`,
      args: [row.summary ?? null, row.description ?? null, row.id],
    });

    // Verified write — a silent no-op here is what makes "pushed" claims false.
    const after = await remote.execute({
      sql: "SELECT summary FROM books WHERE id = ?",
      args: [row.id],
    });
    if ((after.rows[0]?.summary as string | null) !== row.summary) {
      throw new Error(`Verify failed for ${row.id} — summary did not persist on Turso`);
    }
    updated++;
  }

  console.log(
    `\nDONE — updated ${updated}, already-identical ${identical}, missing-on-live ${missing}`
  );
  process.exit(0);
})();
