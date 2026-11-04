#!/usr/bin/env tsx
/**
 * Nightly triage 2026-11-04 — two "this is the wrong book" reports from
 * readingwithrach (5f7d3b1a), both verified against primary sources:
 *
 *  1) report 42bf8131 — /book/the-fear  "Should be The Fear by Natasha Preston"
 *     The catalog row e2e8c2ac is titled "The Fear" but its ISBN 9780141337814
 *     resolves (OpenLibrary) to "The Squad: White Fear" by Tom Palmer, and its
 *     own description opens "White Fear is the second ... title in Tom Palmer's
 *     ... series The Squad". So the TITLE is wrong, and the generic slug
 *     "the-fear" is what makes readers land on it. Fix the title; create the
 *     real Natasha Preston book (2022, Delacorte, 9780593125014); move the
 *     reporter's rows onto it.
 *  2) report f7c012ed — /book/remember-me-sophie-kinsella  "should be remember
 *     me by chelsea bobulski". That book already exists (8d9cc62b,
 *     remember-me-chelsea-bobulski) — just move the reporter's shelf row.
 *
 * User rows move with UPDATE book_id (never INSERT OR IGNORE + DELETE), and
 * only the REPORTER's rows move — the other reader on e2e8c2ac is left alone.
 * Local first, then Turso, so sync-push cannot resurrect anything.
 *
 * Usage: npx tsx scripts/fix-wrong-book-reports-2026-11-04.ts [--apply]
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env.vercel.local" });

import Database from "better-sqlite3";
import crypto from "crypto";
import { createGuardedTurso } from "./lib/turso-guard";

const APPLY = process.argv.includes("--apply");
const REPORTER = "5f7d3b1a-3f66-4a48-b9e9-d35ec27d433f";
const PALMER = "e2e8c2ac-5092-4a01-bc3b-145f1b1a75f1";
const KINSELLA = "41ebe4ef-908f-4a71-a68d-39bd7d74726c";
const BOBULSKI = "8d9cc62b-2ae4-4374-8aa8-6e16d86004a5";
const PRESTON_AUTHOR = "45864d47-0bda-42b8-b5aa-84b005c3d842";
const NEW_SLUG = "the-fear-natasha-preston";
const MOVE_TABLES = ["user_book_state", "user_book_ratings", "user_book_reviews", "reading_sessions"];

(async () => {
  const local = new Database("data/tbra.db");
  const { remote } = await createGuardedTurso({
    name: "fix-wrong-book-reports-2026-11-04",
    maxRuntimeMs: 15 * 60 * 1000,
    queryTimeoutMs: 30_000,
  });
  const now = new Date().toISOString();

  // ---- resolve / create the Natasha Preston book id (idempotent by slug) ----
  const existing = local.prepare(`SELECT id FROM books WHERE slug = ?`).get(NEW_SLUG) as { id: string } | undefined;
  const prestonId = existing?.id ?? crypto.randomUUID();
  console.log(`Preston "The Fear" id: ${prestonId}${existing ? " (already present)" : " (new)"}`);

  if (!APPLY) {
    console.log("DRY RUN — would:");
    console.log(`  books.title  ${PALMER}  "The Fear" -> "White Fear"  (local + Turso)`);
    console.log(`  INSERT books ${prestonId}  "The Fear" / ${NEW_SLUG}  (local + Turso) + book_authors -> Natasha Preston`);
    for (const t of MOVE_TABLES) {
      const n = (local.prepare(`SELECT count(*) c FROM ${t} WHERE book_id=? AND user_id=?`).get(PALMER, REPORTER) as any).c;
      console.log(`  ${t}: move ${n} reporter row(s) ${PALMER} -> ${prestonId}`);
    }
    const k = (local.prepare(`SELECT count(*) c FROM user_book_state WHERE book_id=? AND user_id=?`).get(KINSELLA, REPORTER) as any).c;
    console.log(`  user_book_state: move ${k} reporter row(s) ${KINSELLA} -> ${BOBULSKI}`);
    process.exit(0);
  }

  // ---- 1. title fix on the Tom Palmer row ----
  local.prepare(`UPDATE books SET title='White Fear', updated_at=? WHERE id=?`).run(now, PALMER);
  await remote.execute({ sql: `UPDATE books SET title='White Fear', updated_at=? WHERE id=?`, args: [now, PALMER] });
  console.log("✓ title fixed: The Fear -> White Fear (both DBs)");

  // ---- 2. create the Preston book ----
  if (!existing) {
    const cols = `(id,title,publication_year,isbn_13,pages,open_library_key,language,publisher,is_fiction,is_box_set,slug,cover_verified,needs_review,visibility,created_at,updated_at,description_stale)`;
    const vals = [prestonId, "The Fear", 2022, "9780593125014", 368, "OL34985818M", "English", "Delacorte Press", 1, 0, NEW_SLUG, 0, 0, "public", now, now, 1];
    local.prepare(`INSERT INTO books ${cols} VALUES (${vals.map(() => "?").join(",")})`).run(...vals);
    local.prepare(`INSERT OR IGNORE INTO book_authors (book_id,author_id) VALUES (?,?)`).run(prestonId, PRESTON_AUTHOR);
    await remote.execute({ sql: `INSERT INTO books ${cols} VALUES (${vals.map(() => "?").join(",")})`, args: vals as any });
    await remote.execute({ sql: `INSERT OR IGNORE INTO book_authors (book_id,author_id) VALUES (?,?)`, args: [prestonId, PRESTON_AUTHOR] });
    console.log(`✓ created "The Fear" by Natasha Preston (${prestonId}) on both DBs`);
  }

  // ---- 3. move the reporter's rows ----
  for (const t of MOVE_TABLES) {
    const r = local.prepare(`UPDATE ${t} SET book_id=? WHERE book_id=? AND user_id=?`).run(prestonId, PALMER, REPORTER);
    const rr = await remote.execute({ sql: `UPDATE ${t} SET book_id=? WHERE book_id=? AND user_id=?`, args: [prestonId, PALMER, REPORTER] });
    console.log(`✓ ${t}: local ${r.changes} / turso ${rr.rowsAffected} row(s) -> Preston`);
  }
  const kl = local.prepare(`UPDATE user_book_state SET book_id=? WHERE book_id=? AND user_id=?`).run(BOBULSKI, KINSELLA, REPORTER);
  const kr = await remote.execute({ sql: `UPDATE user_book_state SET book_id=? WHERE book_id=? AND user_id=?`, args: [BOBULSKI, KINSELLA, REPORTER] });
  console.log(`✓ user_book_state: local ${kl.changes} / turso ${kr.rowsAffected} row(s) -> Bobulski`);

  console.log(`\nPRESTON_BOOK_ID=${prestonId}`);
  process.exit(0);
})();
