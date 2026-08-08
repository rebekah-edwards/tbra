/**
 * Manual follow-up triage for reports process-reports.ts punted to "needs input"
 * on 2026-07-19. Only the unambiguous, sanctioned-autonomous cases are handled
 * here; enrichment / "Rebekah to fix" / Brave-re-enrich reports are left 'new'.
 *
 * Dual-writes every mutation to BOTH local (data/tbra.db) and prod Turso, and
 * purges deleted book ids from Meilisearch — same parity contract as
 * process-reports.ts. Turso writes go through createGuardedTurso.
 */
require("dotenv").config({ path: ".env.local" });
require("dotenv").config({ path: ".env.vercel.local" });
import { createClient, type Client } from "@libsql/client";
import { createGuardedTurso } from "./lib/turso-guard";
import { Meilisearch } from "meilisearch";
import { classifyGenres } from "../src/lib/genre-taxonomy";

const CANON_FRANK = "a6745cee-a91f-4a43-a23d-0ed2234c1ed7"; // frankenstein-mary-shelley (3 users)
const DUPE_1818 = "68db31b0-84bd-4168-8d65-7a6fbf39395d"; // Frankenstein: The 1818 Text (2 users)
// 0-user plain "Frankenstein" by Mary Shelley duplicates (verified authors + descriptions)
const FRANK_ZERO_DUPES = [
  "079c071b-5dd1-499e-86eb-51061ecd8e56", // mary-shelley-2
  "3b2daf4f-7059-4cb8-8e6c-523bc6bd59a7", // -3
  "4107daea-2a31-433f-b3ae-1681855e9132", // -4
  "552848e5-fa85-4c3f-ad59-2bb925ef725a", // -5
  "5d86b024-2eba-40af-ac49-23e8970e638b", // -6
  "62170868-81ef-458f-81ee-bfc3151e6148", // -7
  "627ef6f7-20aa-4400-8687-4e2d61e3fd74", // -8
  "915ad6a6-d288-4c60-8a29-7f4ffe674476", // -9
  "9449040a-7125-4559-9cf6-7f1607dff554", // "Frankenstein Mary Shelley"
  "6097a973-63a4-4b81-b1e3-443dec21a7d7", // "Frankenstein b1.2"
];
const DUHIGG = "e567c973-cee0-463d-9fae-ca8a42a93dbb"; // Conversations on the Power of Habit (junk, 0 users)
const WAYFARERS = "db12d2c7-6cd2-484c-a8ea-7117151ef4ba";
const BTF = "9fd105e7-9d05-4b27-a783-e6bf52d23b57"; // Between Two Fires

const GENRE_HORROR = "894d3d9d-a487-43e6-b84d-feebd1e1854f";
const GENRE_HIST_FIC = "43132973-3bf0-4823-b566-149d113dde56";
const GENRE_FANTASY_BTF = "ac02fec8-e835-43fc-b659-9f931c2dbcec"; // resolved below at runtime

const REPORTS = {
  frank: "d1964d18-e134-434b-a056-46541b9f0b3d",
  duhigg: "278b7335-6aff-4710-9a88-cc2cbd04d706",
  wayfarers: "4e187f23-a0ec-4892-8262-93fe79996571",
  btf: "721b5b71-eb94-4497-bd79-ab19a38c7e08",
};

const deletedBookIds: string[] = [];

(async () => {
  const { remote } = await createGuardedTurso({
    name: "manual-triage-2026-07-19",
    maxRuntimeMs: 20 * 60 * 1000,
    queryTimeoutMs: 30_000,
    longRunning: false,
  });

  let local: Client | null = null;
  try {
    local = createClient({ url: "file:./data/tbra.db" });
    await local.execute("SELECT 1");
    console.log("Local mirror: data/tbra.db (dual-write enabled)");
  } catch (e: any) {
    local = null;
    console.warn(`Local mirror UNAVAILABLE (${String(e?.message ?? e)}) — production-only.`);
  }

  const q = async (sql: string, args: any[] = []) => {
    if (/^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql) && local) {
      try {
        await local.execute({ sql, args });
      } catch (e: any) {
        if (!/no such table/i.test(String(e?.message ?? e))) console.warn(`  [local skip] ${String(e?.message ?? e)}`);
      }
    }
    return remote.execute({ sql, args });
  };

  const resolveReport = async (id: string, text: string) => {
    await q(`UPDATE reported_issues SET status='resolved', resolved_at=datetime('now'), resolution=? WHERE id=?`, [text, id]);
    console.log(`  resolved report ${id}: ${text}`);
  };

  const deleteBook = async (bookId: string) => {
    await q(
      `UPDATE reported_issues SET book_id=NULL,
         status=CASE WHEN status='new' THEN 'resolved' ELSE status END,
         resolved_at=CASE WHEN status='new' THEN datetime('now') ELSE resolved_at END,
         resolution=CASE WHEN status='new' AND (resolution IS NULL OR resolution='') THEN '[auto] book deleted by manual-triage' ELSE resolution END
       WHERE book_id=?`,
      [bookId],
    );
    const tables = [
      "book_authors", "book_genres", "book_series", "book_category_ratings",
      "book_narrators", "links", "report_corrections", "editions",
      "user_owned_editions", "enrichment_log", "user_hidden_books", "reading_notes",
      "up_next", "user_favorite_books", "user_book_reviews", "user_book_ratings",
      "reading_sessions", "user_book_state", "tbr_notes", "shelf_books", "buddy_reads",
    ];
    for (const t of tables) {
      try {
        await q(`DELETE FROM ${t} WHERE book_id = ?`, [bookId]);
      } catch (e: any) {
        if (!/no such table/i.test(String(e?.message ?? e))) throw e;
      }
    }
    await q(`DELETE FROM books WHERE id = ?`, [bookId]);
    const v = await remote.execute({ sql: `SELECT 1 FROM books WHERE id = ?`, args: [bookId] });
    if (v.rows.length !== 0) throw new Error(`delete verification failed: ${bookId} survives on Turso`);
    deletedBookIds.push(bookId);
    console.log(`  deleted book ${bookId}`);
  };

  // Move user activity from dupe -> canonical. State-like tables: dedup (drop dupe
  // row if user already on canonical) then repoint. History tables: just repoint.
  const mergeUsers = async (dupe: string, canon: string) => {
    const dedupTables = ["user_book_state", "user_book_ratings", "user_book_reviews", "up_next", "user_favorite_books", "user_owned_editions", "user_hidden_books"];
    const repointOnly = ["reading_sessions", "reading_notes"];
    for (const t of dedupTables) {
      try {
        await q(`DELETE FROM ${t} WHERE book_id=? AND user_id IN (SELECT user_id FROM ${t} WHERE book_id=?)`, [dupe, canon]);
        await q(`UPDATE ${t} SET book_id=? WHERE book_id=?`, [canon, dupe]);
      } catch (e: any) {
        if (!/no such table/i.test(String(e?.message ?? e))) throw e;
      }
    }
    for (const t of repointOnly) {
      try {
        await q(`UPDATE ${t} SET book_id=? WHERE book_id=?`, [canon, dupe]);
      } catch (e: any) {
        if (!/no such table/i.test(String(e?.message ?? e))) throw e;
      }
    }
  };

  // ── 1. Frankenstein: merge 1818 Text (+ 10 zero-user dupes) into canonical ──
  console.log("\n[1] Frankenstein dedup → canonical frankenstein-mary-shelley");
  await resolveReport(
    REPORTS.frank,
    `[merged] "Frankenstein: The 1818 Text" and 10 zero-user duplicate "Frankenstein" (Mary Shelley) entries merged into canonical /book/frankenstein-mary-shelley; reader activity (2 users) moved. Translations, "Modern Prometheus" variants, adaptations, and study guides left untouched.`,
  );
  await mergeUsers(DUPE_1818, CANON_FRANK);
  await deleteBook(DUPE_1818);
  for (const id of FRANK_ZERO_DUPES) await deleteBook(id);

  // ── 2. Conversations on the Power of Habit (Daily Books) — junk book-about-a-book ──
  console.log("\n[2] Delete junk summary book (Conversations on the Power of Habit)");
  await resolveReport(REPORTS.duhigg, `[deleted] "Conversation Starters" companion/summary book about Duhigg's The Power of Habit (publisher: Daily Books), 0 users — removed as book-about-a-book per report.`);
  await deleteBook(DUHIGG);

  // ── 3. Wayfarers 4 Books Set — mark as boxed set ──
  console.log("\n[3] Mark Wayfarers 4 Books Set as boxed set");
  await q(`UPDATE books SET is_box_set=1, updated_at=datetime('now') WHERE id=?`, [WAYFARERS]);
  await resolveReport(REPORTS.wayfarers, `[fixed] Set is_box_set=1.`);

  // ── 4. Between Two Fires — make primary genre Horror (was Historical Fiction) ──
  // Primary = first direct-whitelist genre in rowid order. Reinsert Horror ahead
  // of the other direct-whitelist genres (Historical Fiction, Fantasy).
  console.log("\n[4] Between Two Fires primary genre → Horror");
  const btfGenres = await remote.execute({ sql: `SELECT genre_id FROM book_genres WHERE book_id=?`, args: [BTF] });
  const gids = new Set(btfGenres.rows.map((r: any) => r.genre_id));
  // Identify the Fantasy direct-whitelist row present on this book
  const fantasyRow = await remote.execute({ sql: `SELECT g.id FROM book_genres bg JOIN genres g ON g.id=bg.genre_id WHERE bg.book_id=? AND g.name='Fantasy'`, args: [BTF] });
  const fantasyId = (fantasyRow.rows[0] as any)?.id;
  const reorder: string[] = [GENRE_HORROR, GENRE_HIST_FIC];
  if (fantasyId) reorder.push(fantasyId);
  // Delete then reinsert in desired order (Horror first) so Horror wins as primary.
  for (const gid of reorder) {
    if (gids.has(gid)) await q(`DELETE FROM book_genres WHERE book_id=? AND genre_id=?`, [BTF, gid]);
  }
  for (const gid of reorder) {
    if (gids.has(gid)) await q(`INSERT INTO book_genres (book_id, genre_id) VALUES (?, ?)`, [BTF, gid]);
  }
  await q(`UPDATE books SET updated_at=datetime('now') WHERE id=?`, [BTF]);
  // Verify with the app's own classifier.
  const verifyRows = await remote.execute({
    sql: `SELECT g.id genreId, g.name, g.parent_genre_id parentGenreId FROM book_genres bg JOIN genres g ON g.id=bg.genre_id WHERE bg.book_id=? ORDER BY bg.rowid`,
    args: [BTF],
  });
  const cls = classifyGenres(
    verifyRows.rows.map((r: any) => ({ genreId: r.genreId, name: r.name, parentGenreId: r.parentGenreId })),
    true,
  );
  console.log(`  classifyGenres → primary="${cls.primaryGenre}" (expected Horror)`);
  if (cls.primaryGenre !== "Horror") throw new Error(`BTF primary genre is "${cls.primaryGenre}", not Horror — aborting so it can be reviewed`);
  await resolveReport(REPORTS.btf, `[fixed] Reordered genres so primary is Horror (was Historical Fiction); Historical Fiction and Fantasy kept as secondary.`);

  // ── Purge deleted books from Meilisearch ──
  if (deletedBookIds.length > 0) {
    const host = process.env.MEILISEARCH_HOST;
    const key = process.env.MEILISEARCH_ADMIN_KEY;
    if (host && key) {
      try {
        const meili = new Meilisearch({ host, apiKey: key });
        await meili.index("books").deleteDocuments(deletedBookIds);
        console.log(`\nMeilisearch: purged ${deletedBookIds.length} deleted book(s)`);
      } catch (e: any) {
        console.warn(`Meilisearch purge failed (non-fatal): ${String(e?.message ?? e)}`);
      }
    } else {
      console.warn(`\nMeilisearch keys absent — ${deletedBookIds.length} deleted book(s) NOT purged`);
    }
  }

  console.log(`\n=== DONE === books deleted: ${deletedBookIds.length}; local mirror: ${local ? "in sync" : "UNAVAILABLE"}`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
