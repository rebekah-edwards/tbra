/**
 * Purge ClassicNotes / GradeSaver / Sneak Peek / academic-edition junk
 * that's already in our DB. The updated isJunkTitle pattern will prevent
 * NEW junk from surfacing in search, but this script cleans up existing rows.
 *
 * Dry-run by default. --apply to mutate.
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env.vercel.local" });
import { createClient } from "@libsql/client";

const APPLY = process.argv.includes("--apply");
const c = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN! });
const q = (sql: string, args: any[] = []) => c.execute({ sql, args });

async function run(sql: string, args: any[], label: string) {
  if (!APPLY) { console.log(`    [DRY] ${label}`); return; }
  await q(sql, args);
}

async function hardDelete(bookId: string, label: string) {
  const tables = [
    "book_authors", "book_genres", "book_series", "book_category_ratings",
    "book_narrators", "links", "report_corrections", "editions",
    "user_owned_editions", "enrichment_log", "reported_issues",
    "user_hidden_books", "reading_notes", "up_next", "user_favorite_books",
    "user_book_reviews", "user_book_ratings", "reading_sessions",
    "user_book_state",
  ];
  for (const tbl of tables) await run(`DELETE FROM ${tbl} WHERE book_id = ?`, [bookId], `del ${tbl}`);
  await run(`DELETE FROM books WHERE id = ?`, [bookId], `deleted ${label}`);
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN"}\n`);

  // Match the junk patterns we just added — done via SQL directly because
  // we need to query on title LIKE in SQLite. Also catch Sparknotes, Cliffs
  // etc. already in DB (they may have snuck in via imports).
  const hits = await q(`
    SELECT b.id, b.title, b.slug, b.visibility,
      (SELECT count(*) FROM user_book_state WHERE book_id = b.id) as users
    FROM books b
    WHERE LOWER(b.title) LIKE '%classicnotes%'
       OR LOWER(b.title) LIKE '%gradesaver%'
       OR LOWER(b.title) LIKE '%sneak peek%'
       OR LOWER(b.title) LIKE '%edited with an introduction%'
       OR LOWER(b.title) LIKE '%edited with a introduction%'
    ORDER BY b.title
  `);

  console.log(`Found ${hits.rows.length} junk entries:`);
  let deleted = 0;
  let hidden = 0;
  let kept = 0;
  for (const r of hits.rows as any[]) {
    const users = Number(r.users);
    console.log(`  ${r.slug ?? r.id.slice(0,8)} [${users}u] "${(r.title as string).slice(0, 80)}"`);
    if (users === 0) {
      await hardDelete(r.id as string, r.slug ?? r.id.slice(0, 8));
      deleted++;
    } else if (r.visibility === "public") {
      // Has users — hide from search but keep the row so their library isn't broken
      await run(`UPDATE books SET visibility = 'import_only', updated_at = datetime('now') WHERE id = ?`, [r.id], `hid (has ${users} users)`);
      hidden++;
    } else {
      kept++;
    }
  }
  console.log(`\n=== ${APPLY ? "APPLIED" : "DRY-RUN"} ===`);
  console.log(`Deleted: ${deleted} / Hidden: ${hidden} / Kept (already hidden): ${kept}`);
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
