/**
 * replay-dedup-both.ts — Apply a dedup manifest (pairs of dupe_id → canonical_id)
 * to BOTH local SQLite and production Turso.
 *
 * Why "both": sync-push uses INSERT OR IGNORE. If we delete a dupe from Turso but it
 * still exists on local, the next sync-push re-inserts it to Turso. So we must delete
 * from local first (or both together) to make the deletion durable.
 *
 * Per pair:
 *   1. MOVE user-unique rows (INSERT OR IGNORE on canonical, DELETE on dupe)
 *   2. MOVE append-OK rows (plain UPDATE)
 *   3. DELETE join-table rows on dupe
 *   4. DELETE the dupe book row
 *   5. Verify on both sides
 *
 * All steps run on LOCAL first, then TURSO, so a Turso failure leaves local in a
 * clean state and we can retry without risk of re-insert.
 *
 * Pass --apply to mutate. Default is dry-run. Pass --manifest=<path> to pick a file.
 * Pacing knobs (recommend gentle defaults to avoid the 2026-04-20 Turso throughput hit):
 *   --chunk=5           (pairs per chunk)
 *   --pause=200         (ms between operations inside a pair)
 *   --cooldown=60       (seconds between chunks)
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.vercel.local" });
import { type Client } from "@libsql/client";
import { createGuardedTurso } from "./lib/turso-guard";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const APPLY = process.argv.includes("--apply");
const MANIFEST_ARG = process.argv.find((a) => a.startsWith("--manifest="))?.split("=")[1];
const CHUNK = Number(process.argv.find((a) => a.startsWith("--chunk="))?.split("=")[1] ?? "5");
const PAUSE_MS = Number(process.argv.find((a) => a.startsWith("--pause="))?.split("=")[1] ?? "200");
const COOLDOWN_SEC = Number(process.argv.find((a) => a.startsWith("--cooldown="))?.split("=")[1] ?? "60");

function resolveManifest(): string {
  if (MANIFEST_ARG) return MANIFEST_ARG;
  const dir = path.join(process.cwd(), "reports");
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^title-author-dupe-manifest-.*\.json$/.test(f) || /^dedup-manifest-.*\.json$/.test(f));
  if (files.length === 0) throw new Error("No manifest files found");
  files.sort();
  return path.join(dir, files[files.length - 1]);
}

const manifestPath = resolveManifest();
const pairs: { dupe_id: string; canonical_id: string; dupe_title: string; canonical_title: string }[] =
  JSON.parse(fs.readFileSync(manifestPath, "utf8"));

const MOVE_UNIQUE = [
  "user_book_state",
  "user_book_ratings",
  "user_book_reviews",
  "user_favorite_books",
  "user_hidden_books",
  "user_owned_editions",
  "up_next",
  "tbr_notes",
  "shelf_books",
];
const MOVE_APPEND = [
  "reading_notes",
  "reading_sessions",
  "buddy_reads",
  "reported_issues",
  "report_corrections",
];
const JOIN_TABLES = [
  "book_authors",
  "book_genres",
  "book_series",
  "book_category_ratings",
  "book_narrators",
  "editions",
  "enrichment_log",
  "links",
];

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

// ─── Column caches so we build the correct INSERT SELECT lists for uniqueness-constrained moves ───
const tursoCols = new Map<string, string[] | null>();
const localCols = new Map<string, string[] | null>();

async function getTursoCols(client: Client, table: string): Promise<string[] | null> {
  if (tursoCols.has(table)) return tursoCols.get(table)!;
  try {
    const r = await client.execute({ sql: `SELECT * FROM ${table} LIMIT 0`, args: [] });
    tursoCols.set(table, r.columns);
    return r.columns;
  } catch {
    tursoCols.set(table, null);
    return null;
  }
}

function getLocalCols(db: Database.Database, table: string): string[] | null {
  if (localCols.has(table)) return localCols.get(table)!;
  try {
    const stmt = db.prepare(`SELECT * FROM ${table} LIMIT 0`);
    const cols = stmt.columns().map((c) => c.name);
    localCols.set(table, cols);
    return cols;
  } catch {
    localCols.set(table, null);
    return null;
  }
}

// ─── Local processing (synchronous, fast) ───
function processLocal(
  db: Database.Database,
  p: { dupe_id: string; canonical_id: string },
): { activityMoved: number; rowsDeleted: number; exists: boolean } {
  const exists = db.prepare(`SELECT 1 FROM books WHERE id = ?`).get(p.dupe_id);
  if (!exists) return { activityMoved: 0, rowsDeleted: 0, exists: false };
  let activityMoved = 0, rowsDeleted = 0;

  for (const t of MOVE_UNIQUE) {
    const cols = getLocalCols(db, t);
    if (!cols || !cols.includes("book_id")) continue;
    const selectList = cols.map((c) => (c === "book_id" ? `'${p.canonical_id}' AS book_id` : c)).join(", ");
    try {
      const r1 = db
        .prepare(`INSERT OR IGNORE INTO ${t} (${cols.join(", ")}) SELECT ${selectList} FROM ${t} WHERE book_id = ?`)
        .run(p.dupe_id);
      const r2 = db.prepare(`DELETE FROM ${t} WHERE book_id = ?`).run(p.dupe_id);
      activityMoved += r1.changes;
      rowsDeleted += r2.changes;
    } catch (e: any) {
      if (!/no such table/i.test(String(e?.message))) throw e;
    }
  }
  for (const t of MOVE_APPEND) {
    const cols = getLocalCols(db, t);
    if (!cols || !cols.includes("book_id")) continue;
    try {
      const r = db.prepare(`UPDATE ${t} SET book_id = ? WHERE book_id = ?`).run(p.canonical_id, p.dupe_id);
      activityMoved += r.changes;
    } catch (e: any) {
      if (!/no such table/i.test(String(e?.message))) throw e;
    }
  }
  for (const t of JOIN_TABLES) {
    const cols = getLocalCols(db, t);
    if (!cols || !cols.includes("book_id")) continue;
    try {
      const r = db.prepare(`DELETE FROM ${t} WHERE book_id = ?`).run(p.dupe_id);
      rowsDeleted += r.changes;
    } catch (e: any) {
      if (!/no such table/i.test(String(e?.message))) throw e;
    }
  }
  const r = db.prepare(`DELETE FROM books WHERE id = ?`).run(p.dupe_id);
  rowsDeleted += r.changes;
  // Verify
  const v = db.prepare(`SELECT 1 FROM books WHERE id = ?`).get(p.dupe_id);
  if (v) throw new Error(`LOCAL verify failed: ${p.dupe_id} still present`);
  return { activityMoved, rowsDeleted, exists: true };
}

// ─── Turso processing (async, slower) ───
async function processTurso(
  client: Client,
  p: { dupe_id: string; canonical_id: string },
  pauseMs: number,
): Promise<{ activityMoved: number; rowsDeleted: number; exists: boolean }> {
  const exists = await client.execute({ sql: `SELECT 1 FROM books WHERE id = ?`, args: [p.dupe_id] });
  if (exists.rows.length === 0) return { activityMoved: 0, rowsDeleted: 0, exists: false };
  let activityMoved = 0, rowsDeleted = 0;

  for (const t of MOVE_UNIQUE) {
    const cols = await getTursoCols(client, t);
    if (!cols || !cols.includes("book_id")) continue;
    const selectList = cols.map((c) => (c === "book_id" ? `'${p.canonical_id}' AS book_id` : c)).join(", ");
    try {
      const r1 = await client.execute({
        sql: `INSERT OR IGNORE INTO ${t} (${cols.join(", ")}) SELECT ${selectList} FROM ${t} WHERE book_id = ?`,
        args: [p.dupe_id],
      });
      const r2 = await client.execute({ sql: `DELETE FROM ${t} WHERE book_id = ?`, args: [p.dupe_id] });
      activityMoved += Number(r1.rowsAffected);
      rowsDeleted += Number(r2.rowsAffected);
    } catch (e: any) {
      if (!/no such table/i.test(String(e?.message))) throw e;
    }
    if (pauseMs) await sleep(pauseMs);
  }
  for (const t of MOVE_APPEND) {
    const cols = await getTursoCols(client, t);
    if (!cols || !cols.includes("book_id")) continue;
    try {
      const r = await client.execute({
        sql: `UPDATE ${t} SET book_id = ? WHERE book_id = ?`,
        args: [p.canonical_id, p.dupe_id],
      });
      activityMoved += Number(r.rowsAffected);
    } catch (e: any) {
      if (!/no such table/i.test(String(e?.message))) throw e;
    }
  }
  for (const t of JOIN_TABLES) {
    const cols = await getTursoCols(client, t);
    if (!cols || !cols.includes("book_id")) continue;
    try {
      const r = await client.execute({ sql: `DELETE FROM ${t} WHERE book_id = ?`, args: [p.dupe_id] });
      rowsDeleted += Number(r.rowsAffected);
    } catch (e: any) {
      if (!/no such table/i.test(String(e?.message))) throw e;
    }
  }
  const r = await client.execute({ sql: `DELETE FROM books WHERE id = ?`, args: [p.dupe_id] });
  rowsDeleted += Number(r.rowsAffected);
  const v = await client.execute({ sql: `SELECT 1 FROM books WHERE id = ?`, args: [p.dupe_id] });
  if (v.rows.length !== 0) throw new Error(`TURSO verify failed: ${p.dupe_id} still present`);
  return { activityMoved, rowsDeleted, exists: true };
}

async function main() {
  // Ceiling: 497 pairs × ~15s/pair = ~2h realistic, add 50% buffer = 3h. longRunning=true
  // so the launchd watchdog (60-min default kill) leaves us alone.
  const { remote: client, heartbeat } = await createGuardedTurso({
    name: "replay-dedup-both",
    maxRuntimeMs: 3 * 60 * 60 * 1000,
    queryTimeoutMs: 30_000,
    longRunning: true,
  });
  const db = new Database(path.join(process.cwd(), "data", "tbra.db"));
  // Wait up to 30s for local SQLite locks held by other scripts / dev server before failing.
  db.pragma("busy_timeout = 30000");

  console.log(`=== replay-dedup-both ===`);
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN"}`);
  console.log(`Manifest: ${manifestPath}  (${pairs.length} pairs)`);
  console.log(`Pacing: chunk=${CHUNK} pause=${PAUSE_MS}ms cooldown=${COOLDOWN_SEC}s`);
  console.log();

  let ok = 0, skippedLocal = 0, skippedTurso = 0, errors = 0;
  let totalMoved = 0, totalDeleted = 0;
  const started = Date.now();
  const errorList: { pair: any; err: string }[] = [];

  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    try {
      // LOCAL first (fast, <5ms).
      const localR = APPLY ? processLocal(db, p) : { activityMoved: 0, rowsDeleted: 0, exists: true };
      if (!localR.exists) skippedLocal++;

      // TURSO second.
      const tursoR = APPLY
        ? await processTurso(client, p, PAUSE_MS)
        : { activityMoved: 0, rowsDeleted: 0, exists: true };
      if (!tursoR.exists) skippedTurso++;

      if (localR.exists || tursoR.exists) {
        ok++;
        totalMoved += localR.activityMoved + tursoR.activityMoved;
        totalDeleted += localR.rowsDeleted + tursoR.rowsDeleted;
      }
    } catch (e: any) {
      errors++;
      errorList.push({ pair: p, err: e?.message ?? String(e) });
      console.warn(`  [${i + 1}] ERROR ${p.dupe_id}: ${e?.message}`);
    }

    // Progress (every pair for first 5, then every 5)
    if (i < 5 || (i + 1) % 5 === 0 || i === pairs.length - 1) {
      const elapsed = (Date.now() - started) / 1000;
      const rate = (i + 1) / elapsed;
      const eta = Math.round((pairs.length - (i + 1)) / rate);
      console.log(
        `  [${i + 1}/${pairs.length}] ok=${ok} skip-local=${skippedLocal} skip-turso=${skippedTurso} err=${errors}  (${rate.toFixed(2)}/s, ETA ${eta}s)`,
      );
    }

    // Chunk cooldown
    if (APPLY && (i + 1) % CHUNK === 0 && i < pairs.length - 1) {
      heartbeat(`chunk ${Math.ceil((i + 1) / CHUNK)} — cooldown ${COOLDOWN_SEC}s  (ok=${ok}, err=${errors})`);
      await sleep(COOLDOWN_SEC * 1000);
    }
  }

  db.close();
  // Guard cleans up lockfile + deadline timer on process exit; no client.close() needed.

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = path.join(process.cwd(), "reports", `dedup-both-run-${stamp}.md`);
  let md = `# replay-dedup-both run — ${new Date().toISOString()}\n\n`;
  md += `- Manifest: \`${manifestPath}\`\n`;
  md += `- Pairs: ${pairs.length}\n`;
  md += `- Mode: ${APPLY ? "APPLY" : "DRY-RUN"}\n`;
  md += `- Pacing: chunk=${CHUNK} pause=${PAUSE_MS} cooldown=${COOLDOWN_SEC}\n`;
  md += `- OK: ${ok}\n`;
  md += `- Skipped (dupe not on local): ${skippedLocal}\n`;
  md += `- Skipped (dupe not on Turso): ${skippedTurso}\n`;
  md += `- Errors: ${errors}\n`;
  md += `- Activity rows moved: ${totalMoved}\n`;
  md += `- Rows deleted: ${totalDeleted}\n`;
  md += `- Elapsed: ${elapsed}s\n\n`;
  if (errorList.length > 0) {
    md += `## Errors\n\n`;
    for (const e of errorList) md += `- \`${e.pair.dupe_id}\` "${e.pair.dupe_title}": ${e.err}\n`;
  }
  fs.writeFileSync(reportPath, md);

  console.log();
  console.log("=== SUMMARY ===");
  console.log(`  processed:     ${ok}`);
  console.log(`  skip (local):  ${skippedLocal}`);
  console.log(`  skip (turso):  ${skippedTurso}`);
  console.log(`  errors:        ${errors}`);
  console.log(`  moved:         ${totalMoved}`);
  console.log(`  deleted:       ${totalDeleted}`);
  console.log(`  elapsed:       ${elapsed}s`);
  console.log(`  report:        ${reportPath}`);

  if (!APPLY) console.log("\nDRY-RUN. Re-run with --apply.");
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
