/**
 * nightly-cover-rescue
 *
 * Scans books whose cover_image_url points at images.isbndb.com and hash-checks
 * each response. If the image matches the known ISBNdb "no cover" placeholder,
 * clears the cover so the enrichment cascade (OL → Google Books → Amazon CDN)
 * can refill on the next nightly-enrichment pass.
 *
 * Writes LOCAL tbra.db. A follow-up `sync-incremental.sh push` is required to
 * land changes on Turso (included in the scheduled-task command chain).
 *
 * Placeholder fingerprint (see memory/reference_isbndb_placeholder_fingerprint.md):
 *   SHA256: 56c3e12f87260f78db39b9deeb0d04194e110c99702e6483963f2ab009bfea15
 *   Size:   3736 bytes
 *
 * Strategy: content-length is a cheap pre-filter (HEAD request). Only fetch the
 * body when length matches. Prevents fetching 500KB covers just to hash them.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import Database from "better-sqlite3";
import path from "path";
import { createHash } from "crypto";

const DB_PATH = path.join(process.cwd(), "data", "tbra.db");
const db = new Database(DB_PATH);

const PLACEHOLDER_HASH =
  "56c3e12f87260f78db39b9deeb0d04194e110c99702e6483963f2ab009bfea15";
const PLACEHOLDER_SIZE = 3736;
const BATCH_SIZE = 1000; // books per night
const CONCURRENCY = 8;
const FETCH_TIMEOUT_MS = 10_000;

type Row = { id: string; title: string; cover_image_url: string };

function selectBatch(): Row[] {
  // Prefer books most recently touched (latest isbndb fetches first) — the
  // placeholder is more likely on newer imports. Skip already-rescued books
  // (we set cover_source to 'isbndb-placeholder-cleared' after clearing).
  return db
    .prepare(
      `SELECT id, title, cover_image_url
       FROM books
       WHERE cover_image_url LIKE 'https://images.isbndb.com/covers/%'
         AND (cover_source IS NULL OR cover_source = 'isbndb')
       ORDER BY updated_at DESC
       LIMIT ?`,
    )
    .all(BATCH_SIZE) as Row[];
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function checkIsPlaceholder(url: string): Promise<boolean> {
  try {
    // Step 1: HEAD — cheap size check
    const head = await withTimeout(fetch(url, { method: "HEAD" }), FETCH_TIMEOUT_MS);
    if (!head.ok) return false;
    const len = Number(head.headers.get("content-length"));
    if (Number.isFinite(len) && len !== PLACEHOLDER_SIZE) return false;

    // Step 2: full fetch + hash (only if size matched)
    const res = await withTimeout(fetch(url), FETCH_TIMEOUT_MS);
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length !== PLACEHOLDER_SIZE) return false;
    const hash = createHash("sha256").update(buf).digest("hex");
    return hash === PLACEHOLDER_HASH;
  } catch {
    return false;
  }
}

function clearCover(bookId: string) {
  db.prepare(
    `UPDATE books
     SET cover_image_url = NULL,
         cover_verified = 0,
         cover_source = 'isbndb-placeholder-cleared',
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  ).run(bookId);
}

async function runBatch(rows: Row[]) {
  let cleared = 0;
  let checked = 0;
  // Simple concurrency pool
  let idx = 0;
  async function worker() {
    while (idx < rows.length) {
      const r = rows[idx++];
      checked++;
      if (checked % 100 === 0) {
        console.log(`  checked ${checked}/${rows.length}, cleared ${cleared}`);
      }
      const isPlaceholder = await checkIsPlaceholder(r.cover_image_url);
      if (isPlaceholder) {
        clearCover(r.id);
        cleared++;
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  return { cleared, checked };
}

async function main() {
  console.log(`[cover-rescue] Starting — batch size ${BATCH_SIZE}, concurrency ${CONCURRENCY}`);
  const rows = selectBatch();
  console.log(`[cover-rescue] Selected ${rows.length} ISBNdb-sourced books to check`);

  if (rows.length === 0) {
    console.log("[cover-rescue] Nothing to do. Exiting.");
    db.close();
    return;
  }

  const started = Date.now();
  const { cleared, checked } = await runBatch(rows);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`[cover-rescue] Done in ${elapsed}s — checked ${checked}, cleared ${cleared} placeholder covers`);
  console.log(`[cover-rescue] Follow-up: run sync-incremental.sh push to propagate to Turso`);
  db.close();
}

main().catch((e) => {
  console.error("[cover-rescue] FATAL", e);
  db.close();
  process.exit(1);
});
