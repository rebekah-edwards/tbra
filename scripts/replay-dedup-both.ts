/**
 * replay-dedup-both.ts — Apply a dedup manifest (pairs of dupe_id → canonical_id)
 * to BOTH local SQLite and production Turso.
 *
 * Why "both": sync-push uses INSERT OR IGNORE. If we delete a dupe from Turso but it
 * still exists on local, the next sync-push re-inserts it to Turso. So we must delete
 * from local first (or both together) to make the deletion durable.
 *
 * Per pair:
 *   1. MOVE user-unique rows (UPDATE book_id → canonical; collision-free by precheck)
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

// Imported from lib so the applier and the scanner can never disagree about which
// tables can silently drop a row on INSERT OR IGNORE.
import { MOVE_UNIQUE, findUserOverlap, localRunner, tursoRunner } from "./lib/dupe-overlap";
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

/**
 * Retry a Turso statement through transient slowness.
 *
 * Why: on 2026-07-30 Turso got slow mid-run and two statements blew the guard's 30s query
 * timeout. Because processLocal() runs BEFORE processTurso(), the failure always lands as
 * "dupe deleted locally, still alive on Turso" — the exact direction sync-pull resurrects,
 * which then needs hand repair. One retry pass removes most of that class.
 *
 * Only retries timeout/network shapes. Constraint violations and verify failures are real
 * errors and must surface immediately — never retry those.
 */
async function execRetry(
  client: Client,
  stmt: { sql: string; args: unknown[] },
  attempts = 3,
): Promise<{ rows: unknown[]; rowsAffected: number }> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await client.execute({ sql: stmt.sql, args: stmt.args as never[] });
      return { rows: r.rows as unknown[], rowsAffected: Number(r.rowsAffected) };
    } catch (e: unknown) {
      const msg = String((e as { message?: string })?.message ?? e);
      const transient = /timeout|timed out|ECONNRESET|ETIMEDOUT|socket|stream|unavailable|503|429/i.test(msg);
      if (!transient || i === attempts - 1) throw e;
      lastErr = e;
      const backoff = 1000 * Math.pow(2, i); // 1s, 2s
      console.warn(`    retry ${i + 1}/${attempts - 1} after ${backoff}ms: ${msg.slice(0, 80)}`);
      await sleep(backoff);
    }
  }
  throw lastErr;
}

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
    try {
      // Move with UPDATE, not INSERT OR IGNORE + DELETE.
      //
      // The old approach was silently destructive on any table with a surrogate `id`
      // primary key (user_book_ratings, user_book_reviews, user_favorite_books, up_next,
      // tbr_notes): the SELECT copied `id` verbatim and only rewrote book_id, so the
      // INSERT collided with the SOURCE ROW on the PK, OR IGNORE swallowed it, and the
      // following DELETE destroyed the original. Ratings and reviews were annihilated,
      // not migrated. Only PK-less tables (user_book_state, shelf_books, …) ever moved.
      //
      // UPDATE re-points the row wholesale, preserving id and every column. It is safe
      // here because callers pre-verify there is no same-user collision (dupe-overlap.ts);
      // if one somehow exists, the uniqueness constraint THROWS, which surfaces as an
      // error instead of silently eating user data.
      const r = db.prepare(`UPDATE ${t} SET book_id = ? WHERE book_id = ?`).run(p.canonical_id, p.dupe_id);
      activityMoved += r.changes;
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
  const exists = await execRetry(client, { sql: `SELECT 1 FROM books WHERE id = ?`, args: [p.dupe_id] });
  if (exists.rows.length === 0) return { activityMoved: 0, rowsDeleted: 0, exists: false };
  let activityMoved = 0, rowsDeleted = 0;

  for (const t of MOVE_UNIQUE) {
    const cols = await getTursoCols(client, t);
    if (!cols || !cols.includes("book_id")) continue;
    try {
      // UPDATE, not INSERT OR IGNORE + DELETE — see the matching comment in processLocal().
      // The old form silently destroyed rows in every table with a surrogate `id` PK.
      const r = await execRetry(client, {
        sql: `UPDATE ${t} SET book_id = ? WHERE book_id = ?`,
        args: [p.canonical_id, p.dupe_id],
      });
      activityMoved += r.rowsAffected;
    } catch (e: any) {
      if (!/no such table/i.test(String(e?.message))) throw e;
    }
    if (pauseMs) await sleep(pauseMs);
  }
  for (const t of MOVE_APPEND) {
    const cols = await getTursoCols(client, t);
    if (!cols || !cols.includes("book_id")) continue;
    try {
      const r = await execRetry(client, {
        sql: `UPDATE ${t} SET book_id = ? WHERE book_id = ?`,
        args: [p.canonical_id, p.dupe_id],
      });
      activityMoved += r.rowsAffected;
    } catch (e: any) {
      if (!/no such table/i.test(String(e?.message))) throw e;
    }
  }
  for (const t of JOIN_TABLES) {
    const cols = await getTursoCols(client, t);
    if (!cols || !cols.includes("book_id")) continue;
    try {
      const r = await execRetry(client, { sql: `DELETE FROM ${t} WHERE book_id = ?`, args: [p.dupe_id] });
      rowsDeleted += r.rowsAffected;
    } catch (e: any) {
      if (!/no such table/i.test(String(e?.message))) throw e;
    }
  }
  const r = await execRetry(client, { sql: `DELETE FROM books WHERE id = ?`, args: [p.dupe_id] });
  rowsDeleted += r.rowsAffected;
  const v = await execRetry(client, { sql: `SELECT 1 FROM books WHERE id = ?`, args: [p.dupe_id] });
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
  let skippedCollision = 0;
  let totalMoved = 0, totalDeleted = 0;
  let chunkDidWork = false; // real merges this chunk (skips are free)
  const started = Date.now();
  const errorList: { pair: any; err: string }[] = [];
  const collisionList: { pair: any; hits: string[] }[] = [];

  const runners = [tursoRunner(client), localRunner(db)];

  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    try {
      // TOCTOU guard. The manifest was built by an earlier scan; a beta tester can
      // shelve or rate either book between then and now. If the same user ends up on
      // both books, the INSERT OR IGNORE below would drop the dupe's row and the
      // DELETE would destroy it. Re-check immediately before touching anything, on
      // BOTH databases, and leave the pair for manual merge if it is no longer clean.
      const hits: string[] = [];
      for (const run of runners) {
        const h = await findUserOverlap(run, p.canonical_id, p.dupe_id);
        hits.push(...h.map((x) => `${run.label}/${x}`));
      }
      if (hits.length > 0) {
        skippedCollision++;
        collisionList.push({ pair: p, hits });
        console.warn(`  [${i + 1}] SKIP (collision) ${p.dupe_title}: ${hits.join(", ")}`);
        continue;
      }

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
        chunkDidWork = true;
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

    // Chunk cooldown — only after chunks that actually merged something.
    // All-skip chunks (resuming after an interrupted run) touch nothing on
    // Turso, and paying 60s per 5 skips slow-walked a resume for 45 minutes.
    if (APPLY && (i + 1) % CHUNK === 0 && i < pairs.length - 1) {
      if (chunkDidWork) {
        heartbeat(`chunk ${Math.ceil((i + 1) / CHUNK)} — cooldown ${COOLDOWN_SEC}s  (ok=${ok}, err=${errors})`);
        await sleep(COOLDOWN_SEC * 1000);
      }
      chunkDidWork = false;
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
  md += `- Skipped (same-user collision): ${skippedCollision}\n`;
  md += `- Errors: ${errors}\n`;
  md += `- Activity rows moved: ${totalMoved}\n`;
  md += `- Rows deleted: ${totalDeleted}\n`;
  md += `- Elapsed: ${elapsed}s\n\n`;
  if (collisionList.length > 0) {
    md += `## Held for manual merge (same user on both books)\n\n`;
    md += `These pairs were NOT merged. A user holds rows on both books, so the\n`;
    md += `INSERT OR IGNORE move would have dropped the dupe's copy. Resolve by hand.\n\n`;
    for (const c of collisionList) {
      md += `- \`${c.pair.dupe_id}\` "${c.pair.dupe_title}" → \`${c.pair.canonical_id}\`: ${c.hits.join(", ")}\n`;
    }
    md += `\n`;
  }
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
  console.log(`  skip (collide):${skippedCollision}`);
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
