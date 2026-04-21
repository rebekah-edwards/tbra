/**
 * Fix 3 of the 4 overnight reports (2026-04-21):
 *   - Legend series: add Champion (#3); my earlier import failed silently
 *   - Legend series: flag all books stale for pub-year refresh
 *   - On the Edge of Gone: fix title capitalization + flag description stale
 *
 * The 4th report ("A Safe Place to Die — remind me to update details") is
 * explicitly left OPEN per user instruction — never resolve a "remind me"
 * report until the user has actually handled it.
 *
 * Dry-run by default. --apply to mutate.
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env.vercel.local" });
import { createClient } from "@libsql/client";
import { searchISBNdbMulti } from "../src/lib/enrichment/isbndb";
import { randomUUID } from "crypto";

const APPLY = process.argv.includes("--apply");
const c = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN! });
const q = (sql: string, args: any[] = []) => c.execute({ sql, args });

function slugify(s: string): string {
  return s
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .replace(/\s+/g, " ").trim().toLowerCase()
    .replace(/\s/g, "-");
}

async function run(sql: string, args: any[], label: string) {
  if (!APPLY) { console.log(`  [DRY] ${label}`); return; }
  await q(sql, args);
  console.log(`  ${label}`);
}

async function resolve(reportId: string, resolution: string) {
  if (!APPLY) { console.log(`  [DRY] resolve ${reportId.slice(0,8)}: ${resolution}`); return; }
  await q("UPDATE reported_issues SET status='resolved', resolved_at=datetime('now'), resolution=? WHERE id=?", [resolution, reportId]);
  console.log(`  RESOLVED ${reportId.slice(0,8)}: ${resolution}`);
}

async function findOrCreateAuthor(name: string): Promise<string> {
  const r = await q(`SELECT id FROM authors WHERE LOWER(name) = LOWER(?) LIMIT 1`, [name]);
  if (r.rows.length > 0) return r.rows[0].id as string;
  const id = randomUUID();
  await run(`INSERT INTO authors (id, name, slug) VALUES (?, ?, ?)`, [id, name, slugify(name)], `new author "${name}"`);
  return id;
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN"}\n`);

  // ─── Look up all 4 open reports to grab IDs ───
  const open = await q(`SELECT id, description, page_url, book_id FROM reported_issues WHERE status='new' ORDER BY created_at`);
  console.log(`Open reports: ${open.rows.length}`);

  const legendAdd = (open.rows as any[]).find((r) => /legend-marie-lu/.test(r.page_url) && /book 3/i.test(r.description));
  const legendPub = (open.rows as any[]).find((r) => /legend-marie-lu/.test(r.page_url) && /publish\s+dates/i.test(r.description));
  const edgeReport = (open.rows as any[]).find((r) => /on-the-edge-of-gone/.test(r.page_url));
  const safePlace = (open.rows as any[]).find((r) => /safe-place-to-die/.test(r.page_url));

  // ─── 1) Legend — add Champion (#3) ───
  console.log("\n━━━ Legend: add Champion (#3) ━━━");
  {
    const seriesId = "d1cd6ce1-25e4-408d-a0f7-3c44cd562409";

    // Check existing first
    const existing = await q(`
      SELECT b.id FROM books b
      JOIN book_authors ba ON ba.book_id = b.id
      JOIN authors a ON a.id = ba.author_id
      WHERE LOWER(a.name) LIKE '%marie%lu%' AND LOWER(b.title) LIKE 'champion%'
      LIMIT 1`);
    let championId: string | null = existing.rows[0]?.id as string ?? null;

    if (!championId) {
      console.log("  searching ISBNdb for Champion (Legend #3)...");
      const results = await searchISBNdbMulti("champion a legend novel marie lu", 10);
      const match = results.find((b) =>
        /^champion\b/i.test(b.title) &&
        (b.authors ?? []).some((a) => /marie\s+lu/i.test(a)) &&
        b.language === "en",
      );
      if (match) {
        console.log(`    found: "${match.title}" (${match.isbn13 ?? match.isbn10}, ${match.pages}p)`);

        // Check by ISBN one more time (in case it's in DB under a diff slug)
        const byIsbn = await q(`SELECT id FROM books WHERE isbn_13 = ? OR isbn_10 = ? LIMIT 1`,
          [match.isbn13 ?? match.isbn10, match.isbn10 ?? match.isbn13]);
        if (byIsbn.rows.length > 0) {
          championId = byIsbn.rows[0].id as string;
          console.log(`    found existing by ISBN: ${championId}`);
        } else {
          championId = randomUUID();
          const slug = `champion-marie-lu`;
          const year = match.date_published ? parseInt(match.date_published.slice(0, 4), 10) : 2013;
          await run(
            `INSERT INTO books (id, title, slug, isbn_13, isbn_10, pages, publisher, publication_year, publication_date, language, cover_image_url, cover_source, cover_verified, description, description_stale, visibility, is_box_set, created_at, updated_at)
             VALUES (?, 'Champion', ?, ?, ?, ?, ?, ?, ?, 'English', ?, 'isbndb', 0, NULL, 1, 'public', 0, datetime('now'), datetime('now'))`,
            [championId, slug, match.isbn13 ?? null, match.isbn10 ?? null, match.pages ?? null, match.publisher ?? null, year, match.date_published ?? null, match.image ?? null],
            `created Champion → ${slug}`,
          );
          const authorId = await findOrCreateAuthor("Marie Lu");
          await run(`INSERT OR IGNORE INTO book_authors (book_id, author_id, role) VALUES (?, ?, 'author')`, [championId, authorId], `link Marie Lu`);
        }
      }
    }

    if (championId) {
      await run(`INSERT OR IGNORE INTO book_series (book_id, series_id, position_in_series) VALUES (?, ?, 3)`, [championId, seriesId], `link Champion at position 3`);
      if (legendAdd) await resolve(legendAdd.id as string, `Champion added at position 3 (imported from ISBNdb).`);
    } else {
      console.log("  Champion not found cleanly on ISBNdb — leaving report open");
    }
  }

  // ─── 2) Legend pub dates — flag all stale ───
  console.log("\n━━━ Legend: flag all books stale for pub-year refresh ━━━");
  {
    const seriesId = "d1cd6ce1-25e4-408d-a0f7-3c44cd562409";
    const books = await q(`SELECT b.id, b.title FROM book_series bs JOIN books b ON b.id = bs.book_id WHERE bs.series_id = ?`, [seriesId]);
    for (const b of books.rows as any[]) {
      await run(`UPDATE books SET description_stale = 1, updated_at = datetime('now') WHERE id = ?`, [b.id], `stale flag: "${b.title}"`);
    }
    if (legendPub) await resolve(legendPub.id as string, `Flagged ${books.rows.length} Legend books for re-enrichment. Nightly-description-refresh will rebuild publication years from ISBNdb.`);
  }

  // ─── 3) On the Edge of Gone — title caps + description stale ───
  console.log("\n━━━ On the Edge of Gone: fix title + flag stale ━━━");
  {
    const b = await q(`SELECT id, title FROM books WHERE slug = 'on-the-edge-of-gone-corinne-duyvis'`);
    if (b.rows.length > 0) {
      const bookId = b.rows[0].id as string;
      await run(`UPDATE books SET title = 'On the Edge of Gone', description = NULL, description_stale = 1, updated_at = datetime('now') WHERE id = ?`, [bookId], `fixed title + cleared description + flagged stale`);
      if (edgeReport) await resolve(edgeReport.id as string, `Title capitalization fixed ("on the edge of gone" → "On the Edge of Gone"). Description cleared + flagged stale for re-enrichment.`);
    } else {
      console.log("  book not found by slug");
    }
  }

  // ─── 4) A Safe Place to Die — LEAVE OPEN per user instruction ───
  if (safePlace) {
    console.log("\n━━━ A Safe Place to Die — LEFT OPEN (user will handle) ━━━");
    console.log(`  ${safePlace.id} stays in queue per instruction: never resolve 'remind me' reports until user handles them`);
  }

  console.log(`\n=== DONE (${APPLY ? "APPLIED" : "DRY-RUN"}) ===`);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
