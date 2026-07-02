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
import fs from "fs";
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

// Bounded, ROTATING scan. Each run checks a fixed window of PER_SOURCE_LIMIT
// candidates per source and persists a per-source offset cursor (in
// data/cover-rescue-offsets.json) so the next run picks up where this one left
// off, cycling through every candidate over several nights.
//
// This replaces the previous unbounded "scan EVERY candidate every night"
// approach. That version took ~2h across all ~120k+ candidates and was
// reliably SIGTERM'd by the 60-min launchd watchdog (com.tbra.watchdog), so
// later sources never ran and — worse — its long runtime overlapped the
// 4:04 AM description-refresh pull, which reverts same-night clears (live
// covers are authoritative). A bounded window finishes in minutes, well
// before any other pipeline's pull.
//
// The rotating cursor also resolves the churn problem that motivated removing
// the *original* LIMIT: that one used ORDER BY updated_at ASC, which pinned the
// same oldest window every night because non-cleared books never get
// updated_at bumped. By advancing a cursor over a stable ORDER BY id instead,
// every candidate gets a fair check across the cycle, and new arrivals are
// swept as the cursor passes them (or once it wraps).
const PER_SOURCE_LIMIT = Number(process.env.COVER_RESCUE_LIMIT ?? 2000);
const OFFSETS_PATH = path.join(process.cwd(), "data", "cover-rescue-offsets.json");

const CANDIDATE_WHERE = `cover_image_url LIKE ?
     AND (cover_source IS NULL
          OR cover_source = 'isbndb'
          OR cover_source = 'google_books'
          OR cover_source = 'openlibrary')`;

function loadOffsets(): Record<string, number> {
  try {
    return JSON.parse(fs.readFileSync(OFFSETS_PATH, "utf8")) as Record<string, number>;
  } catch {
    return {};
  }
}

function saveOffsets(offsets: Record<string, number>) {
  fs.writeFileSync(OFFSETS_PATH, JSON.stringify(offsets, null, 2));
}

function countCandidates(urlPatternLike: string): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM books WHERE ${CANDIDATE_WHERE}`)
    .get(urlPatternLike) as { n: number };
  return row.n;
}

// Stable ORDER BY id so OFFSET pagination is deterministic across nights.
function selectWindow(urlPatternLike: string, offset: number, limit: number): Row[] {
  return db
    .prepare(
      `SELECT id, title, cover_image_url
       FROM books
       WHERE ${CANDIDATE_WHERE}
       ORDER BY id
       LIMIT ? OFFSET ?`,
    )
    .all(urlPatternLike, limit, offset) as Row[];
}

// Resolve the next window for a source, advancing (and wrapping) its cursor.
function nextWindow(
  offsets: Record<string, number>,
  key: string,
  urlPatternLike: string,
): { rows: Row[]; total: number; start: number } {
  const total = countCandidates(urlPatternLike);
  if (total === 0) {
    offsets[key] = 0;
    return { rows: [], total: 0, start: 0 };
  }
  let start = offsets[key] ?? 0;
  if (start >= total) start = 0; // wrap to the beginning of the cycle
  const rows = selectWindow(urlPatternLike, start, PER_SOURCE_LIMIT);
  offsets[key] = start + rows.length;
  return { rows, total, start };
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
  console.log(
    `[cover-rescue] Starting — concurrency ${CONCURRENCY}, window ${PER_SOURCE_LIMIT}/source (rotating cursor in ${path.basename(OFFSETS_PATH)})`,
  );
  const started = Date.now();
  let totalChecked = 0;
  let totalCleared = 0;

  // Per-source rotating offset cursor. Persisted after EACH source so a
  // mid-run watchdog kill still advances the cursor for completed sources.
  const offsets = loadOffsets();

  // Pass 1: known fingerprint sweep
  for (const placeholder of PLACEHOLDERS) {
    const { rows, total, start } = nextWindow(offsets, placeholder.label, placeholder.urlPatternLike);
    console.log(
      `[cover-rescue] [${placeholder.label}] window ${start}–${start + rows.length} of ${total} candidates`,
    );
    if (rows.length > 0) {
      const { cleared, checked } = await runBatch(rows, placeholder);
      console.log(`[cover-rescue] [${placeholder.label}] done — cleared ${cleared}/${checked}`);
      totalChecked += checked;
      totalCleared += cleared;
    }
    saveOffsets(offsets);
  }

  // Pass 2: dimension-based microimage sweep (catches non-fingerprinted placeholders)
  console.log(`[cover-rescue] Starting microimage pass (dimension-based)`);
  for (const host of MICRO_IMAGE_HOSTS) {
    const { rows, total, start } = nextWindow(offsets, host.label, host.urlPatternLike);
    console.log(
      `[cover-rescue] [${host.label}] window ${start}–${start + rows.length} of ${total} candidates`,
    );
    if (rows.length > 0) {
      const { cleared, checked } = await runMicroImageBatch(rows, host);
      console.log(`[cover-rescue] [${host.label}] done — cleared ${cleared}/${checked}`);
      totalChecked += checked;
      totalCleared += cleared;
    }
    saveOffsets(offsets);
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
