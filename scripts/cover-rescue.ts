/**
 * nightly-cover-rescue
 *
 * Scans books whose cover_image_url comes from known placeholder-prone
 * sources (ISBNdb, Google Books) and hash-checks each response. If the
 * image matches a known "no cover" placeholder, clears the cover so the
 * book surfaces on /admin/covers for manual replacement.
 *
 * Writes LOCAL tbra.db. A follow-up `sync-incremental.sh push` is required
 * to land changes on Turso (included in the scheduled-task command chain).
 *
 * Known placeholders (see memory/reference_isbndb_placeholder_fingerprint.md):
 *   ISBNdb:        size=3736   sha256=56c3e12f87260f78db39b9deeb0d04194e110c99702e6483963f2ab009bfea15
 *   Google Books:  size=15567  sha256=12557f8948b8bdc6af436e3a8b3adddd45f7f7d2b67c5832e799cdf4686f72bb
 *
 * Strategy: content-length is a cheap pre-filter via HEAD. Only full-fetch +
 * hash when length matches a known placeholder size.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import Database from "better-sqlite3";
import path from "path";
import { createHash } from "crypto";

const DB_PATH = path.join(process.cwd(), "data", "tbra.db");
const db = new Database(DB_PATH);

type Placeholder = {
  label: string;
  size: number;
  hash: string;
  urlPattern: string; // LIKE pattern
  sourceField: string | null; // value to set cover_source to when cleared
};

const PLACEHOLDERS: Placeholder[] = [
  {
    label: "isbndb",
    size: 3736,
    hash: "56c3e12f87260f78db39b9deeb0d04194e110c99702e6483963f2ab009bfea15",
    urlPattern: "https://images.isbndb.com/covers/%",
    sourceField: "isbndb-placeholder-cleared",
  },
  {
    label: "google-books",
    size: 15567,
    hash: "12557f8948b8bdc6af436e3a8b3adddd45f7f7d2b67c5832e799cdf4686f72bb",
    urlPattern: "https://books.google.com/books/content%",
    sourceField: "gbooks-placeholder-cleared",
  },
];

const BATCH_SIZE = 1000;
const CONCURRENCY = 8;
const FETCH_TIMEOUT_MS = 10_000;

type Row = { id: string; title: string; cover_image_url: string };

function selectBatchFor(placeholder: Placeholder): Row[] {
  return db
    .prepare(
      `SELECT id, title, cover_image_url
       FROM books
       WHERE cover_image_url LIKE ?
         AND (cover_source IS NULL
              OR cover_source = 'isbndb'
              OR cover_source = 'google_books'
              OR cover_source = 'openlibrary')
       ORDER BY updated_at DESC
       LIMIT ?`,
    )
    .all(placeholder.urlPattern, BATCH_SIZE) as Row[];
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

async function checkIsPlaceholder(
  url: string,
  placeholder: Placeholder,
): Promise<boolean> {
  try {
    const head = await withTimeout(fetch(url, { method: "HEAD" }), FETCH_TIMEOUT_MS);
    if (!head.ok) return false;
    const len = Number(head.headers.get("content-length"));
    if (Number.isFinite(len) && len !== placeholder.size) return false;

    const res = await withTimeout(fetch(url), FETCH_TIMEOUT_MS);
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length !== placeholder.size) return false;
    const hash = createHash("sha256").update(buf).digest("hex");
    return hash === placeholder.hash;
  } catch {
    return false;
  }
}

function clearCover(bookId: string, newSource: string | null) {
  db.prepare(
    `UPDATE books
     SET cover_image_url = NULL,
         cover_verified = 0,
         cover_source = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  ).run(newSource, bookId);
}

async function runBatch(rows: Row[], placeholder: Placeholder) {
  let cleared = 0;
  let checked = 0;
  let idx = 0;
  async function worker() {
    while (idx < rows.length) {
      const r = rows[idx++];
      checked++;
      if (checked % 100 === 0) {
        console.log(`  [${placeholder.label}] checked ${checked}/${rows.length}, cleared ${cleared}`);
      }
      const isPlaceholder = await checkIsPlaceholder(r.cover_image_url, placeholder);
      if (isPlaceholder) {
        clearCover(r.id, placeholder.sourceField);
        cleared++;
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  return { cleared, checked };
}

async function main() {
  console.log(`[cover-rescue] Starting — batch ${BATCH_SIZE}/source, concurrency ${CONCURRENCY}`);
  const started = Date.now();
  let totalChecked = 0;
  let totalCleared = 0;

  for (const placeholder of PLACEHOLDERS) {
    const rows = selectBatchFor(placeholder);
    console.log(`[cover-rescue] [${placeholder.label}] selected ${rows.length} candidates`);
    if (rows.length === 0) continue;

    const { cleared, checked } = await runBatch(rows, placeholder);
    console.log(`[cover-rescue] [${placeholder.label}] done — cleared ${cleared}/${checked}`);
    totalChecked += checked;
    totalCleared += cleared;
  }

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`[cover-rescue] All sources done in ${elapsed}s — total: cleared ${totalCleared}/${totalChecked}`);
  console.log(`[cover-rescue] Follow-up: sync-incremental.sh push to propagate to Turso`);
  db.close();
}

main().catch((e) => {
  console.error("[cover-rescue] FATAL", e);
  db.close();
  process.exit(1);
});
