/**
 * nightly-junk-sweep
 *
 * Detects probable junk on recently-imported books and writes entries into
 * `reported_issues` (status='new') for admin review at /admin/issues. Does NOT
 * auto-delete — user wants conservative.
 *
 * Current rules (start narrow, widen only after observed false-positive rate):
 *   - Box-set: title contains " / " AND book isn't linked to a series
 *   - Study-guide prefixes: "SparkNotes:", "CliffsNotes:", "Study Guide for ",
 *     "Summary of ", "Analysis of "
 *   - Ancillary suffixes: " Coloring Book", " Activity Book", " Workbook",
 *     " Study Guide", " Cliffs Notes"
 *
 * Attribution: reports are filed under the system admin account
 * (clankerinfrastructure@gmail.com) with a prefix "[AUTO-FLAG: junk-sweep]"
 * so they're distinguishable from real user reports.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import Database from "better-sqlite3";
import path from "path";
import crypto from "crypto";

const DB_PATH = path.join(process.cwd(), "data", "tbra.db");
const db = new Database(DB_PATH);

const SYSTEM_USER_EMAIL = "clankerinfrastructure@gmail.com";
const BATCH_SIZE = 2000;
const FLAG_PREFIX = "[AUTO-FLAG: junk-sweep]";

type Row = { id: string; title: string; slug: string | null; created_at: string };

function getSystemUserId(): string {
  const r = db
    .prepare(`SELECT id FROM users WHERE email = ? LIMIT 1`)
    .get(SYSTEM_USER_EMAIL) as { id: string } | undefined;
  if (!r) throw new Error(`System user (${SYSTEM_USER_EMAIL}) not found`);
  return r.id;
}

function selectRecent(): Row[] {
  return db
    .prepare(
      `SELECT id, title, slug, created_at
       FROM books
       WHERE visibility = 'public'
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(BATCH_SIZE) as Row[];
}

function isSeriesVolume(bookId: string): boolean {
  return !!db
    .prepare(`SELECT 1 FROM book_series WHERE book_id = ? LIMIT 1`)
    .get(bookId);
}

function alreadyFlagged(bookId: string): boolean {
  return !!db
    .prepare(
      `SELECT 1 FROM reported_issues
       WHERE book_id = ?
         AND description LIKE ?
         AND status IN ('new', 'in_progress')
       LIMIT 1`,
    )
    .get(bookId, `${FLAG_PREFIX}%`);
}

function flag(userId: string, bookId: string, description: string) {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO reported_issues (id, user_id, book_id, description, status, created_at)
     VALUES (?, ?, ?, ?, 'new', datetime('now'))`,
  ).run(id, userId, bookId, description);
}

function looksLikeBoxSet(title: string): boolean {
  return title.includes(" / ");
}

const STUDY_GUIDE_PREFIXES = [
  "sparknotes:",
  "cliffsnotes:",
  "study guide for ",
  "summary of ",
  "summary & analysis of ",
  "analysis of ",
];
function looksLikeStudyGuide(title: string): boolean {
  const t = title.toLowerCase().trim();
  return STUDY_GUIDE_PREFIXES.some((p) => t.startsWith(p));
}

const JUNK_SUFFIXES = [
  " coloring book",
  " activity book",
  " workbook",
  " study guide",
  " cliffs notes",
];
function looksLikeAncillary(title: string): boolean {
  const t = title.toLowerCase().trim();
  return JUNK_SUFFIXES.some((s) => t.endsWith(s));
}

function main() {
  console.log(`[junk-sweep] Starting — scanning ${BATCH_SIZE} most-recent books`);
  const userId = getSystemUserId();
  const rows = selectRecent();

  let boxSets = 0;
  let studyGuides = 0;
  let ancillaries = 0;
  let skippedFlagged = 0;
  let skippedSeries = 0;

  for (const r of rows) {
    if (!r.title) continue;

    if (looksLikeBoxSet(r.title)) {
      if (isSeriesVolume(r.id)) {
        skippedSeries++;
        continue;
      }
      if (alreadyFlagged(r.id)) {
        skippedFlagged++;
        continue;
      }
      flag(userId, r.id, `${FLAG_PREFIX} Probable box set (title has " / "): "${r.title}"`);
      boxSets++;
      continue;
    }

    if (looksLikeStudyGuide(r.title)) {
      if (alreadyFlagged(r.id)) {
        skippedFlagged++;
        continue;
      }
      flag(userId, r.id, `${FLAG_PREFIX} Study guide / summary pattern: "${r.title}"`);
      studyGuides++;
      continue;
    }

    if (looksLikeAncillary(r.title)) {
      if (alreadyFlagged(r.id)) {
        skippedFlagged++;
        continue;
      }
      flag(userId, r.id, `${FLAG_PREFIX} Ancillary product pattern: "${r.title}"`);
      ancillaries++;
    }
  }

  console.log(
    `[junk-sweep] Done — flagged ${boxSets} box-sets, ${studyGuides} study-guides, ${ancillaries} ancillary`,
  );
  console.log(
    `[junk-sweep] Skipped ${skippedSeries} legit series volumes, ${skippedFlagged} already-flagged`,
  );
  console.log(`[junk-sweep] Review at /admin/issues (filter: description starts with "${FLAG_PREFIX}")`);
  console.log(`[junk-sweep] Follow-up: sync-incremental.sh push (to land on Turso)`);
  db.close();
}

try {
  main();
} catch (e) {
  console.error("[junk-sweep] FATAL", e);
  db.close();
  process.exit(1);
}
