/**
 * Push the shelf-fix results (scripts/fix-shelf-enrichment.ts) to Turso.
 *
 * For each processed book id (data/shelf-fix-ids.json) mirrors to production:
 *   - the full book row (INSERT OR IGNORE, so promoted import_only books that
 *     were local-only get created) + an UPDATE of every enrichment field
 *     INCLUDING visibility (sync-push never touches visibility, so the A→public
 *     promotion would otherwise never reach live),
 *   - book_category_ratings (DELETE + re-INSERT), and
 *   - book_genres / book_authors junctions (the content tags + authorship),
 *     ensuring the referenced genre/author rows exist first to avoid FK errors.
 *
 * Guarded per the mandatory Turso-write rule.
 *
 * Usage: npx tsx scripts/push-shelf-fix-to-turso.ts
 */
import { config } from "dotenv";
config({ path: ".env.vercel.local" });

import * as fs from "fs";
import * as path from "path";
import Database from "better-sqlite3";
import { createGuardedTurso } from "./lib/turso-guard";

(async () => {
  const idsPath = path.join(process.cwd(), "data", "shelf-fix-ids.json");
  if (!fs.existsSync(idsPath)) {
    console.error(`No id list at ${idsPath} — run fix-shelf-enrichment.ts first.`);
    process.exit(1);
  }
  const ids: string[] = JSON.parse(fs.readFileSync(idsPath, "utf8"));
  const local = new Database(path.join(process.cwd(), "data", "tbra.db"), { readonly: true });

  const { remote, heartbeat } = await createGuardedTurso({
    name: "push-shelf-fix",
    maxRuntimeMs: 20 * 60 * 1000,
    queryTimeoutMs: 30_000,
  });

  async function insertOrIgnoreRow(table: string, row: any) {
    const cols = Object.keys(row);
    await remote.execute({
      sql: `INSERT OR IGNORE INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
      args: cols.map((k) => row[k]),
    });
  }

  let booksDone = 0, ratings = 0, genres = 0, authorsLinked = 0, errs = 0;

  for (const id of ids) {
    try {
      const book = local.prepare(`SELECT * FROM books WHERE id = ?`).get(id) as any;
      if (!book) continue;

      // 1. Ensure the book exists on Turso, then update enrichment fields + visibility.
      await insertOrIgnoreRow("books", book);
      await remote.execute({
        sql: `UPDATE books SET
            description = COALESCE(?, description),
            summary = COALESCE(?, summary),
            cover_image_url = COALESCE(?, cover_image_url),
            is_fiction = COALESCE(?, is_fiction),
            pacing = COALESCE(?, pacing),
            language = COALESCE(?, language),
            publication_year = COALESCE(?, publication_year),
            pages = COALESCE(?, pages),
            publisher = COALESCE(?, publisher),
            cover_source = COALESCE(?, cover_source),
            visibility = ?,
            updated_at = ?
          WHERE id = ?`,
        args: [book.description, book.summary, book.cover_image_url, book.is_fiction,
          book.pacing, book.language, book.publication_year, book.pages, book.publisher,
          book.cover_source, book.visibility, book.updated_at, id],
      });
      booksDone++;

      // 2. Ratings: DELETE + re-INSERT.
      const rrows = local.prepare(`SELECT * FROM book_category_ratings WHERE book_id = ?`).all(id) as any[];
      await remote.execute({ sql: `DELETE FROM book_category_ratings WHERE book_id = ?`, args: [id] });
      for (const r of rrows) { await insertOrIgnoreRow("book_category_ratings", r); ratings++; }

      // 3. Genres (ensure genre rows exist, then link).
      const grows = local.prepare(`
        SELECT g.* FROM genres g JOIN book_genres bg ON bg.genre_id = g.id WHERE bg.book_id = ?
      `).all(id) as any[];
      for (const g of grows) {
        await insertOrIgnoreRow("genres", g);
        await insertOrIgnoreRow("book_genres", { book_id: id, genre_id: g.id });
        genres++;
      }

      // 4. Authors (ensure author rows exist, then link).
      const arows = local.prepare(`
        SELECT a.* FROM authors a JOIN book_authors ba ON ba.author_id = a.id WHERE ba.book_id = ?
      `).all(id) as any[];
      for (const a of arows) {
        await insertOrIgnoreRow("authors", a);
        await insertOrIgnoreRow("book_authors", { book_id: id, author_id: a.id });
        authorsLinked++;
      }

      if (booksDone % 25 === 0) heartbeat(`${booksDone}/${ids.length}`);
    } catch (e: any) {
      errs++;
      console.error(`  ✗ ${id}: ${e?.message ?? e}`);
    }
  }

  console.log(`\n✓ Turso shelf-fix push complete.`);
  console.log(`  books updated: ${booksDone}  ratings rows: ${ratings}  genre links: ${genres}  author links: ${authorsLinked}  errors: ${errs}`);
  process.exit(0);
})();
