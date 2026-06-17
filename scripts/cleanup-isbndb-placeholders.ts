/**
 * cleanup-isbndb-placeholders.ts
 *
 * One-shot backlog cleanup. Scans every PUBLIC book on Turso whose
 * cover_image_url comes from images.isbndb.com and whose cover_source is
 * NOT 'manual'. Hash-checks each cover image against the three known
 * ISBNdb placeholder fingerprints.
 *
 * Action by variant (per user, 2026-04-24):
 *   - v1 (3736 bytes,  56c3e12f...) → CLEAR  (NULL cover_image_url)
 *   - v2 (12008 bytes, a5f722c8...) → CLEAR
 *   - v3 (4176 bytes,  32d36985...) → COUNT ONLY (await approval)
 *
 * Safety:
 *   - cover_source = 'manual' is skipped at SELECT time
 *   - Every clear requires a confirmed hash match (no URL-pattern-only writes)
 *   - createGuardedTurso enforces 30-min wall clock + 30s per-query timeout
 *     + PID lockfile (per CLAUDE.md "Turso script safety" section)
 *   - Updates LOCAL (data/tbra.db) and Turso in the same loop so the
 *     scheduled nightly-placeholder-clear is a true no-op tonight
 *
 * Usage:
 *   npx tsx scripts/cleanup-isbndb-placeholders.ts
 */
import { config } from "dotenv";
config({ path: ".env.vercel.local" });

import { createHash } from "crypto";
import Database from "better-sqlite3";
import path from "path";
import { createGuardedTurso } from "./lib/turso-guard";

const PLACEHOLDERS = [
  { label: "v1", size: 3736,  hash: "56c3e12f87260f78db39b9deeb0d04194e110c99702e6483963f2ab009bfea15", action: "clear" as const },
  { label: "v2", size: 12008, hash: "a5f722c897cdc916e8bde0dd045d56bc29e78400871c61479e6a6493f1fe0f49", action: "clear" as const },
  { label: "v3", size: 4176,  hash: "32d36985a98a6cb4b337ee2b3088d4bcd970a00251a32ac074d8f9a287b9958a", action: "clear" as const },
];

const KNOWN_SIZES = new Set(PLACEHOLDERS.map(p => p.size));

const CONCURRENCY = 8;
const FETCH_TIMEOUT_MS = 10_000;
const PROGRESS_EVERY = 500;
const UPDATE_BATCH_SIZE = 100;

type Row = { id: string; title: string; cover_image_url: string };

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

async function classify(url: string): Promise<{ label: string; action: "clear" | "count" } | null> {
  try {
    const head = await withTimeout(fetch(url, { method: "HEAD" }), FETCH_TIMEOUT_MS);
    if (!head.ok) return null;
    const len = Number(head.headers.get("content-length"));
    if (!Number.isFinite(len) || !KNOWN_SIZES.has(len)) return null;

    const res = await withTimeout(fetch(url), FETCH_TIMEOUT_MS);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length !== len) return null;
    const hash = createHash("sha256").update(buf).digest("hex");

    const match = PLACEHOLDERS.find(p => p.size === len && p.hash === hash);
    return match ? { label: match.label, action: match.action } : null;
  } catch {
    return null;
  }
}

(async () => {
  const { remote, heartbeat } = await createGuardedTurso({
    name: "cleanup-isbndb-placeholders",
    maxRuntimeMs: 50 * 60 * 1000,
    queryTimeoutMs: 120_000,
  });

  const localDb = new Database(path.join(process.cwd(), "data", "tbra.db"));

  console.log("[cleanup] Selecting candidates from Turso (paginated)…");
  const SELECT_PAGE = 1000;
  const rows: Row[] = [];
  let lastId = "";
  while (true) {
    const page = await remote.execute({
      sql: `SELECT id, title, cover_image_url
            FROM books
            WHERE visibility = 'public'
              AND cover_image_url LIKE 'https://images.isbndb.com/covers/%'
              AND (cover_source IS NULL OR cover_source <> 'manual')
              AND id > ?
            ORDER BY id
            LIMIT ?`,
      args: [lastId, SELECT_PAGE],
    });
    const pageRows = page.rows as unknown as Row[];
    if (pageRows.length === 0) break;
    rows.push(...pageRows);
    lastId = pageRows[pageRows.length - 1].id;
    heartbeat(`fetched ${rows.length} candidates so far…`);
  }
  console.log(`[cleanup] ${rows.length} candidates to scan`);

  const pending: string[] = [];
  const counts = { v1: 0, v2: 0, v3: 0, ok: 0 };
  let scanned = 0;
  let idx = 0;
  let written = 0;
  let scanDone = false;

  const localUpdate = localDb.prepare(
    `UPDATE books
     SET cover_image_url = NULL,
         cover_verified = 0,
         cover_source = 'isbndb-placeholder-cleared',
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  );

  async function flushBatch(batch: string[]): Promise<void> {
    const placeholders = batch.map(() => "?").join(",");
    await remote.execute({
      sql: `UPDATE books
            SET cover_image_url = NULL,
                cover_verified = 0,
                cover_source = 'isbndb-placeholder-cleared',
                updated_at = CURRENT_TIMESTAMP
            WHERE id IN (${placeholders})`,
      args: batch,
    });
    for (const id of batch) localUpdate.run(id);
    written += batch.length;
    heartbeat(`wrote ${written} (pending: ${pending.length})`);
  }

  async function flusher(): Promise<void> {
    while (!scanDone || pending.length > 0) {
      if (pending.length >= UPDATE_BATCH_SIZE || (scanDone && pending.length > 0)) {
        const batch = pending.splice(0, UPDATE_BATCH_SIZE);
        try {
          await flushBatch(batch);
        } catch (err) {
          console.error(`[flusher] batch write failed, re-queueing:`, err);
          pending.unshift(...batch);
          await new Promise((r) => setTimeout(r, 2000));
        }
      } else {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }

  async function worker() {
    while (idx < rows.length) {
      const row = rows[idx++];
      scanned++;
      if (scanned % PROGRESS_EVERY === 0) {
        heartbeat(`scanned ${scanned}/${rows.length} | cleared so far: ${written} | pending: ${pending.length} | v3: ${counts.v3}`);
      }
      const verdict = await classify(row.cover_image_url);
      if (!verdict) {
        counts.ok++;
        continue;
      }
      counts[verdict.label as "v1" | "v2" | "v3"]++;
      if (verdict.action === "clear") {
        pending.push(row.id);
      }
    }
  }

  console.log(`[cleanup] Starting ${CONCURRENCY} workers + 1 flusher…`);
  const startedScan = Date.now();
  const workersP = Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  const flusherP = flusher();
  await workersP;
  scanDone = true;
  console.log(`[cleanup] Scan complete in ${((Date.now() - startedScan) / 1000).toFixed(1)}s — draining remaining writes…`);
  await flusherP;

  console.log(`\n=== Done ===`);
  console.log(`  v1 (3736b)  hits: ${counts.v1}  → cleared`);
  console.log(`  v2 (12008b) hits: ${counts.v2}  → cleared`);
  console.log(`  v3 (4176b)  hits: ${counts.v3}  → COUNTED ONLY (awaiting user approval)`);
  console.log(`  Real covers / non-placeholder: ${counts.ok}`);
  console.log(`  Total cleared on Turso + local: ${written}`);
  localDb.close();
  process.exit(0);
})();
