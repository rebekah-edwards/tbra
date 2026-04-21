/**
 * Resolve the 39 remaining same-slug-on-Turso duplicate groups.
 *
 * Pick canonical per group (most users → most metadata), move user data
 * from dupes to canonical, then hard-delete dupes. Same pattern I used for
 * the Practice-of-Presence / Shadow Princess merges yesterday.
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

async function mergeUserData(dupeId: string, canonicalId: string) {
  for (const tbl of [
    "user_book_state","user_book_ratings","user_book_reviews","user_favorite_books",
    "reading_sessions","reading_notes","up_next","user_owned_editions","user_hidden_books",
  ]) {
    await run(`UPDATE OR IGNORE ${tbl} SET book_id = ? WHERE book_id = ?`, [canonicalId, dupeId], `move ${tbl}`);
    await run(`DELETE FROM ${tbl} WHERE book_id = ?`, [dupeId], `clean ${tbl}`);
  }
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN"}\n`);

  const dupes = await q(`
    WITH dupes AS (
      SELECT slug FROM books WHERE slug IS NOT NULL AND slug != '' GROUP BY slug HAVING count(*) > 1
    )
    SELECT b.id, b.slug, b.title, b.isbn_13, b.open_library_key, b.cover_image_url, b.description, b.visibility,
      (SELECT count(*) FROM user_book_state WHERE book_id = b.id) as users
    FROM books b
    WHERE b.slug IN (SELECT slug FROM dupes)
    ORDER BY b.slug
  `);

  // Group by slug
  const bySlug = new Map<string, any[]>();
  for (const r of dupes.rows as any[]) {
    const list = bySlug.get(r.slug) ?? [];
    list.push(r);
    bySlug.set(r.slug, list);
  }

  let groupsProcessed = 0;
  let dupesDeleted = 0;
  let userMerges = 0;

  for (const [slug, books] of bySlug) {
    console.log(`\n━ ${slug} (${books.length} books) ━`);
    // Rank: prefer users desc, then has cover, then has description, then has isbn, then has ol_key
    books.sort((a, b) => {
      const scoreA = Number(a.users) * 1000 + (a.cover_image_url ? 100 : 0) + (a.description ? 50 : 0) + (a.isbn_13 ? 10 : 0) + (a.open_library_key ? 5 : 0);
      const scoreB = Number(b.users) * 1000 + (b.cover_image_url ? 100 : 0) + (b.description ? 50 : 0) + (b.isbn_13 ? 10 : 0) + (b.open_library_key ? 5 : 0);
      return scoreB - scoreA;
    });
    const canonical = books[0];
    console.log(`  canonical: ${canonical.id.slice(0,8)} (${canonical.users}u) "${canonical.title}"`);

    for (const dupe of books.slice(1)) {
      console.log(`  merging → deleting: ${dupe.id.slice(0,8)} (${dupe.users}u) "${dupe.title}"`);
      if (Number(dupe.users) > 0) {
        await mergeUserData(dupe.id, canonical.id);
        userMerges++;
      }
      await hardDelete(dupe.id, `dupe-slug "${slug}"`);
      dupesDeleted++;
    }
    groupsProcessed++;
  }

  console.log(`\n=== ${APPLY ? "APPLIED" : "DRY-RUN"} ===`);
  console.log(`Groups processed: ${groupsProcessed}`);
  console.log(`Dupes deleted: ${dupesDeleted}`);
  console.log(`User-data merges: ${userMerges}`);
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
