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
// Single source of truth for placeholder fingerprints — shared with the
// enrichment pipeline's reject-at-write-time check. Add new placeholders there.
import {
  PLACEHOLDERS,
  type PlaceholderFingerprint,
  parseJpegDimensions,
  MICRO_IMAGE_BYTE_THRESHOLD,
  MICRO_IMAGE_DIMENSION_THRESHOLD,
} from "../src/lib/cover-placeholders";

type Placeholder = PlaceholderFingerprint;

/**
 * Dimension-based detection: scans covers from known hosts for "microimage"
 * placeholders that aren't in the fingerprint list (e.g. 60×40 graphics).
 * Runs as a final pass after the fingerprint loop and only fetches the body
 * when HEAD content-length is below MICRO_IMAGE_BYTE_THRESHOLD (3000 bytes).
 */
const MICRO_IMAGE_HOSTS: { label: string; urlPatternLike: string; sourceField: string }[] = [
  { label: "isbndb-microimage", urlPatternLike: "https://images.isbndb.com/covers/%", sourceField: "isbndb-placeholder-cleared" },
  { label: "gbooks-microimage", urlPatternLike: "https://books.google.com/books/content%", sourceField: "gbooks-placeholder-cleared" },
  { label: "openlibrary-microimage", urlPatternLike: "https://covers.openlibrary.org/%", sourceField: "openlibrary-placeholder-cleared" },
];

const DB_PATH = path.join(process.cwd(), "data", "tbra.db");
const db = new Database(DB_PATH);

const CONCURRENCY = 8;
const FETCH_TIMEOUT_MS = 10_000;

type Row = { id: string; title: string; cover_image_url: string };

function selectBatchFor(placeholder: Placeholder): Row[] {
  // No LIMIT: scan EVERY candidate every night. The previous LIMIT 5000 +
  // ORDER BY updated_at ASC churned on the same window of oldest books each
  // night because non-cleared books don't get updated_at bumped — they stay
  // pinned at the top of the queue and crowd out new arrivals. Removing the
  // limit gives every candidate a fair check daily. Scan time at 8 concurrent
  // workers is ~6 min for ~18K ISBNdb-pattern books, which is fine for a
  // 3:15 AM PT job.
  return db
    .prepare(
      `SELECT id, title, cover_image_url
       FROM books
       WHERE cover_image_url LIKE ?
         AND (cover_source IS NULL
              OR cover_source = 'isbndb'
              OR cover_source = 'google_books'
              OR cover_source = 'openlibrary')`,
    )
    .all(placeholder.urlPatternLike) as Row[];
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

// ── Dimension-based microimage check (added 2026-05-04) ──
//
// Catches placeholders that aren't in the fingerprint list — specifically
// 60×40 "no image available" microimages from ISBNdb / Google Books /
// OpenLibrary. Pre-filters via HEAD content-length to avoid full-fetching
// every cover. Only ~3 KB or smaller bodies get parsed for dimensions.

type MicroHost = (typeof MICRO_IMAGE_HOSTS)[number];

function selectCandidatesForHost(host: MicroHost): Row[] {
  return db
    .prepare(
      `SELECT id, title, cover_image_url
       FROM books
       WHERE cover_image_url LIKE ?
         AND (cover_source IS NULL
              OR cover_source = 'isbndb'
              OR cover_source = 'google_books'
              OR cover_source = 'openlibrary')`,
    )
    .all(host.urlPatternLike) as Row[];
}

async function checkIsMicroImage(url: string): Promise<boolean> {
  try {
    const head = await withTimeout(fetch(url, { method: "HEAD" }), FETCH_TIMEOUT_MS);
    if (!head.ok) return false;
    const len = Number(head.headers.get("content-length"));
    // Pre-filter: only fetch the body for files small enough to plausibly be
    // microimage placeholders. Real ~100×150 thumbnails are ≥4 KB.
    if (!Number.isFinite(len) || len <= 0 || len > MICRO_IMAGE_BYTE_THRESHOLD) return false;

    const res = await withTimeout(fetch(url), FETCH_TIMEOUT_MS);
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    const dims = parseJpegDimensions(buf);
    if (!dims) return false;
    return (
      dims.width < MICRO_IMAGE_DIMENSION_THRESHOLD ||
      dims.height < MICRO_IMAGE_DIMENSION_THRESHOLD
    );
  } catch {
    return false;
  }
}

async function runMicroImageBatch(rows: Row[], host: MicroHost) {
  let cleared = 0;
  let checked = 0;
  let idx = 0;
  async function worker() {
    while (idx < rows.length) {
      const r = rows[idx++];
      checked++;
      if (checked % 100 === 0) {
        console.log(`  [${host.label}] checked ${checked}/${rows.length}, cleared ${cleared}`);
      }
      // Skip rows that have already been cleared in the fingerprint pass
      // (cover_image_url would now be NULL).
      const live = db
        .prepare("SELECT cover_image_url FROM books WHERE id = ?")
        .get(r.id) as { cover_image_url: string | null } | undefined;
      if (!live?.cover_image_url) continue;

      const isMicro = await checkIsMicroImage(r.cover_image_url);
      if (isMicro) {
        clearCover(r.id, host.sourceField);
        cleared++;
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  return { cleared, checked };
}

async function main() {
  console.log(`[cover-rescue] Starting — concurrency ${CONCURRENCY}, scanning all candidates per source`);
  const started = Date.now();
  let totalChecked = 0;
  let totalCleared = 0;

  // Pass 1: known fingerprint sweep
  for (const placeholder of PLACEHOLDERS) {
    const rows = selectBatchFor(placeholder);
    console.log(`[cover-rescue] [${placeholder.label}] selected ${rows.length} candidates`);
    if (rows.length === 0) continue;

    const { cleared, checked } = await runBatch(rows, placeholder);
    console.log(`[cover-rescue] [${placeholder.label}] done — cleared ${cleared}/${checked}`);
    totalChecked += checked;
    totalCleared += cleared;
  }

  // Pass 2: dimension-based microimage sweep (catches non-fingerprinted placeholders)
  console.log(`[cover-rescue] Starting microimage pass (dimension-based)`);
  for (const host of MICRO_IMAGE_HOSTS) {
    const rows = selectCandidatesForHost(host);
    console.log(`[cover-rescue] [${host.label}] selected ${rows.length} candidates`);
    if (rows.length === 0) continue;

    const { cleared, checked } = await runMicroImageBatch(rows, host);
    console.log(`[cover-rescue] [${host.label}] done — cleared ${cleared}/${checked}`);
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
