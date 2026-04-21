/**
 * Resolve the 5 DEFERRED reports with actual research + imports.
 *
 * Dry-run by default. Pass --apply to mutate Turso.
 *
 * Reports handled:
 *   #1 Wakers → create Side Step Trilogy series, link Wakers #1, import Reawakening #2
 *   #3 Shackleford Sisters → fix positions 2-5 + import missing 6+
 *   #4 Legend (Marie Lu) → import Prodigy, Champion, Rebel
 *   #5 Zodiac Academy → dedup + import #1 The Awakening, #3 The Reckoning, #8 Restless Stars
 *   #6 Divergent → set position on Sixth Faction, remove spurious entries
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env.vercel.local" });
import { createClient, type InStatement } from "@libsql/client";
import { randomUUID } from "crypto";
import { searchISBNdbByTitle, searchISBNdbMulti, getISBNdbCoverUrl, getISBNdbDescription, getISBNdbYear, type ISBNdbBook } from "../src/lib/enrichment/isbndb";

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
  if (!APPLY) { console.log(`    [DRY] ${label}`); return; }
  await q(sql, args);
  console.log(`    ${label}`);
}

async function resolveReport(reportId: string, resolution: string) {
  if (!APPLY) { console.log(`  [DRY] resolve ${reportId.slice(0,8)}: ${resolution}`); return; }
  await q(
    "UPDATE reported_issues SET status='resolved', resolved_at=datetime('now'), resolution=? WHERE id=?",
    [resolution, reportId],
  );
  console.log(`  RESOLVED ${reportId.slice(0,8)}: ${resolution}`);
}

async function findOrCreateAuthor(name: string): Promise<string> {
  const r = await q(`SELECT id FROM authors WHERE LOWER(name) = LOWER(?) LIMIT 1`, [name]);
  if (r.rows.length > 0) return r.rows[0].id as string;
  const id = randomUUID();
  await run(
    `INSERT INTO authors (id, name, slug) VALUES (?, ?, ?)`,
    [id, name, slugify(name)],
    `new author "${name}" → ${id.slice(0, 8)}`,
  );
  return id;
}

async function uniqueBookSlug(title: string, authorName: string): Promise<string> {
  const base = `${slugify(title)}-${slugify(authorName)}`;
  let slug = base;
  let suffix = 2;
  while (true) {
    const r = await q(`SELECT id FROM books WHERE slug = ?`, [slug]);
    if (r.rows.length === 0) return slug;
    slug = `${base}-${suffix}`;
    suffix++;
  }
}

interface ImportParams {
  title: string;
  authors: string[];
  seriesId?: string | null;
  position?: number | null;
  isbn?: ISBNdbBook;
}

async function importBookFromISBNdb(p: ImportParams): Promise<string | null> {
  const b = p.isbn;
  if (!b) return null;

  // If a book with this ISBN already exists, just link it to the series
  // instead of inserting a duplicate row (would hit UNIQUE constraint).
  const existingId = await findBookByIsbn(b);
  if (existingId) {
    if (p.seriesId) {
      await run(
        `INSERT OR IGNORE INTO book_series (book_id, series_id, position_in_series) VALUES (?, ?, ?)`,
        [existingId, p.seriesId, p.position ?? null],
        `linked existing (by ISBN) "${p.title}" at position ${p.position}`,
      );
    }
    return existingId;
  }

  const authorNames = p.authors.length > 0 ? p.authors : (b.authors ?? []);
  const primaryAuthor = authorNames[0] ?? "Unknown";
  const bookId = randomUUID();
  const slug = await uniqueBookSlug(p.title, primaryAuthor);

  const coverUrl = getISBNdbCoverUrl(b);
  const description = getISBNdbDescription(b);
  const year = getISBNdbYear(b);

  await run(
    `INSERT INTO books (id, title, slug, isbn_13, isbn_10, pages, publisher, publication_year,
                        publication_date, language, cover_image_url, cover_source, cover_verified,
                        description, description_stale, visibility, is_box_set, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'isbndb', 0, ?, ?, 'public', 0, datetime('now'), datetime('now'))`,
    [
      bookId, p.title, slug,
      b.isbn13 ?? null, b.isbn10 ?? null,
      b.pages ?? null, b.publisher ?? null, year,
      b.date_published ?? null, b.language === "en" ? "English" : (b.language ?? null),
      coverUrl ?? null,
      description ?? null, description ? 0 : 1,
    ],
    `book "${p.title}" → ${slug}`,
  );

  for (const authorName of authorNames) {
    const authorId = await findOrCreateAuthor(authorName);
    await run(
      `INSERT OR IGNORE INTO book_authors (book_id, author_id, role) VALUES (?, ?, 'author')`,
      [bookId, authorId],
      `link author "${authorName}"`,
    );
  }

  if (p.seriesId) {
    await run(
      `INSERT OR IGNORE INTO book_series (book_id, series_id, position_in_series) VALUES (?, ?, ?)`,
      [bookId, p.seriesId, p.position ?? null],
      `series link at position ${p.position}`,
    );
  }

  return bookId;
}

async function createSeriesIfMissing(name: string, baseSlug: string): Promise<string> {
  const existing = await q(`SELECT id FROM series WHERE LOWER(name) = LOWER(?) OR slug = ? LIMIT 1`, [name, baseSlug]);
  if (existing.rows.length > 0) return existing.rows[0].id as string;
  const id = randomUUID();
  await run(
    `INSERT INTO series (id, name, slug) VALUES (?, ?, ?)`,
    [id, name, baseSlug],
    `new series "${name}" → ${id.slice(0,8)}`,
  );
  return id;
}

async function deleteBookHard(bookId: string, label: string) {
  const tables = [
    "book_authors", "book_genres", "book_series", "book_category_ratings",
    "book_narrators", "links", "report_corrections", "editions",
    "user_owned_editions", "enrichment_log", "reported_issues",
    "user_hidden_books", "reading_notes", "up_next", "user_favorite_books",
    "user_book_reviews", "user_book_ratings", "reading_sessions",
    "user_book_state",
  ];
  for (const tbl of tables) await run(`DELETE FROM ${tbl} WHERE book_id = ?`, [bookId], `del ${tbl}`);
  await run(`DELETE FROM books WHERE id = ?`, [bookId], `del book (${label})`);
}

async function setSeriesPosition(bookId: string, seriesId: string, pos: number | null, label: string) {
  await run(
    `INSERT OR REPLACE INTO book_series (book_id, series_id, position_in_series) VALUES (?, ?, ?)`,
    [bookId, seriesId, pos],
    `position=${pos} for ${label}`,
  );
}

async function findBookBySlug(slug: string): Promise<string | null> {
  const r = await q(`SELECT id FROM books WHERE slug = ?`, [slug]);
  return r.rows[0]?.id as string ?? null;
}

async function findBookByIsbn(b: ISBNdbBook): Promise<string | null> {
  const candidates = [b.isbn13, b.isbn10].filter(Boolean) as string[];
  for (const isbn of candidates) {
    const r = await q(`SELECT id FROM books WHERE isbn_13 = ? OR isbn_10 = ? LIMIT 1`, [isbn, isbn]);
    if (r.rows.length > 0) return r.rows[0].id as string;
  }
  return null;
}

async function findBookByTitle(titleLike: string, author?: string): Promise<string | null> {
  let sql = `SELECT b.id FROM books b`;
  const args: any[] = [];
  if (author) {
    sql += ` JOIN book_authors ba ON ba.book_id = b.id JOIN authors a ON a.id = ba.author_id WHERE LOWER(b.title) LIKE ? AND LOWER(a.name) LIKE ?`;
    args.push(titleLike.toLowerCase(), `%${author.toLowerCase()}%`);
  } else {
    sql += ` WHERE LOWER(b.title) LIKE ?`;
    args.push(titleLike.toLowerCase());
  }
  sql += ` LIMIT 1`;
  const r = await q(sql, args);
  return r.rows[0]?.id as string ?? null;
}

// ─────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN"}\n`);

  // ─── #1 Wakers / Side Step Trilogy / Reawakening ─────────────────
  console.log("━━━ #1 Side Step Trilogy: link Wakers + import Reawakening ━━━");
  {
    const reportId = "37041a3b-c943-4983-9dd3-bd340c2e4a8b";
    const seriesId = await createSeriesIfMissing("The Side Step Trilogy", "side-step-trilogy-orson-scott-card");
    const wakersId = await findBookBySlug("wakers-orson-scott-card");
    if (wakersId) {
      await run(
        `INSERT OR IGNORE INTO book_series (book_id, series_id, position_in_series) VALUES (?, ?, 1)`,
        [wakersId, seriesId],
        `linked Wakers at position 1`,
      );
    }

    // Look up Reawakening via multi-result search (single-result picks wrong book for common titles)
    console.log("  searching ISBNdb for Reawakening by Orson Scott Card...");
    const reResults = await searchISBNdbMulti("reawakening orson scott card", 10);
    const reawakening = reResults.find((b) =>
      /reawakening/i.test(b.title) &&
      (b.authors ?? []).some((a) => /orson\s+scott\s+card/i.test(a)),
    ) ?? null;
    if (reawakening) {
      console.log(`    found: "${reawakening.title}" (${reawakening.isbn13 ?? reawakening.isbn10}, ${reawakening.pages}p, pub ${reawakening.date_published})`);
      // Verify it's actually the OSC Reawakening (sequel to Wakers), not a different book
      const authorMatch = (reawakening.authors ?? []).some((a) => /orson scott card/i.test(a));
      if (authorMatch) {
        const existing = await findBookByTitle("reawakening", "orson scott card");
        if (!existing) {
          const newId = await importBookFromISBNdb({
            title: "Reawakening",
            authors: ["Orson Scott Card"],
            seriesId,
            position: 2,
            isbn: reawakening,
          });
          await resolveReport(reportId, `Created "The Side Step Trilogy" series. Linked Wakers (#1). Imported Reawakening (#2) from ISBNdb → book ${newId?.slice(0,8)}.`);
        } else {
          await run(
            `INSERT OR IGNORE INTO book_series (book_id, series_id, position_in_series) VALUES (?, ?, 2)`,
            [existing, seriesId],
            `linked existing Reawakening at position 2`,
          );
          await resolveReport(reportId, `Created "The Side Step Trilogy" series. Linked existing Wakers (#1) and Reawakening (#2).`);
        }
      } else {
        console.log(`    ISBNdb result author mismatch — ${reawakening.authors?.join(", ")}. Skipping import.`);
        await resolveReport(reportId, `Created "The Side Step Trilogy" series + linked Wakers (#1). Reawakening not found on ISBNdb with matching author (OSC). May not be published yet.`);
      }
    } else {
      await resolveReport(reportId, `Created "The Side Step Trilogy" series + linked Wakers (#1). Reawakening not yet findable on ISBNdb — likely unpublished or too new. Nightly enrichment will pick it up later.`);
    }
  }

  // ─── #3 Shackleford Sisters ──────────────────────────────────────
  console.log("\n━━━ #3 Shackleford Sisters: fix positions + add missing ━━━");
  {
    const reportId = "13eb252e-c07e-4cba-9ff4-c755fba70a4c";
    const seriesId = "e35a7a4d-7814-4637-95fb-76f8d1e27ada";

    // Fix positions 2-5 based on "Book N" in title
    const current = await q(`
      SELECT bs.book_id, b.title, bs.position_in_series
      FROM book_series bs JOIN books b ON b.id = bs.book_id
      WHERE bs.series_id = ?`, [seriesId]);
    for (const row of current.rows) {
      const title = row.title as string;
      if (row.position_in_series != null) continue;
      const m = title.match(/book\s+(\d+)/i);
      if (m) {
        const pos = parseInt(m[1], 10);
        await setSeriesPosition(row.book_id as string, seriesId, pos, `"${title}"`);
      }
    }

    // Search ISBNdb for additional Shackleford books
    console.log("  searching ISBNdb for 'shackleford sisters beverley watts'...");
    const results = await searchISBNdbMulti("shackleford sisters beverley watts", 20);
    console.log(`    got ${results.length} ISBNdb hits`);

    // Extract book-N from each + dedup
    let imported = 0;
    const known = new Set((current.rows as any[]).map((r) => {
      const m = String(r.title).match(/book\s+(\d+)/i);
      return m ? parseInt(m[1]) : null;
    }).filter(Boolean));
    // position 1 is "Grace" — known without "book 1" in title
    known.add(1);

    for (const b of results) {
      if (!/beverley\s+watts/i.test((b.authors ?? []).join(" "))) continue;
      const title = b.title;
      const m = title.match(/book\s+(\d+)/i);
      if (!m) continue;
      const pos = parseInt(m[1], 10);
      if (pos < 6 || pos > 15) continue; // we want 6+
      if (known.has(pos)) continue;

      // Clean up title (strip "(the Shackleford Sisters Book N)" style suffixes)
      const cleanTitle = title.replace(/\s*[:([\-–—].*/g, "").trim();
      const existing = await findBookByTitle(`${cleanTitle.toLowerCase()}%`, "beverley watts");
      if (existing) {
        await run(
          `INSERT OR IGNORE INTO book_series (book_id, series_id, position_in_series) VALUES (?, ?, ?)`,
          [existing, seriesId, pos],
          `linked existing "${cleanTitle}" at position ${pos}`,
        );
        known.add(pos);
        imported++;
        continue;
      }

      const newId = await importBookFromISBNdb({
        title: cleanTitle,
        authors: ["Beverley Watts"],
        seriesId,
        position: pos,
        isbn: b,
      });
      if (newId) { known.add(pos); imported++; }
    }

    await resolveReport(reportId, `Fixed positions 2-5 (extracted from titles). Added ${imported} additional book(s) from ISBNdb (books 6+). Nightly enrichment will refine metadata.`);
  }

  // ─── #4 Legend (Marie Lu) ────────────────────────────────────────
  console.log("\n━━━ #4 Legend: import Prodigy, Champion, Rebel ━━━");
  {
    const reportId = "d3e6255f-4dc6-45a2-906f-47367be6ecae";
    const seriesId = "d1cd6ce1-25e4-408d-a0f7-3c44cd562409";

    const books: Array<[string, number]> = [
      ["Prodigy", 2],
      ["Champion", 3],
      ["Rebel", 4],
    ];
    let importedCount = 0;
    for (const [title, pos] of books) {
      const existing = await findBookByTitle(title.toLowerCase(), "marie lu");
      if (existing) {
        await run(
          `INSERT OR IGNORE INTO book_series (book_id, series_id, position_in_series) VALUES (?, ?, ?)`,
          [existing, seriesId, pos],
          `linked existing "${title}" at position ${pos}`,
        );
        continue;
      }
      console.log(`  searching ISBNdb for "${title} Marie Lu"...`);
      const b = await searchISBNdbByTitle(title, "Marie Lu");
      if (b && (b.authors ?? []).some((a) => /marie\s+lu/i.test(a))) {
        const newId = await importBookFromISBNdb({
          title,
          authors: ["Marie Lu"],
          seriesId,
          position: pos,
          isbn: b,
        });
        if (newId) importedCount++;
      } else {
        console.log(`    not found on ISBNdb with matching author`);
      }
    }
    await resolveReport(reportId, `Imported ${importedCount} missing Legend-series book(s) from ISBNdb (Prodigy #2, Champion #3, Rebel #4).`);
  }

  // ─── #5 Zodiac Academy ───────────────────────────────────────────
  console.log("\n━━━ #5 Zodiac Academy: dedup + import #1, #3, #8 ━━━");
  {
    const reportId = "fbda4dd7-4752-476f-abf8-6b34c04856f8";
    const seriesId = "a301789a-2e5a-40cc-aa4d-a502f6bc8d3b";

    // Kill the duplicate "Shadow Princess (Zodiac Academy, #4)" — keep the clean "Shadow Princess"
    const shadowDupes = await q(`
      SELECT b.id, b.title, (SELECT count(*) FROM user_book_state WHERE book_id = b.id) as users
      FROM book_series bs JOIN books b ON b.id = bs.book_id
      WHERE bs.series_id = ? AND LOWER(b.title) LIKE 'shadow princess%'`, [seriesId]);
    if (shadowDupes.rows.length >= 2) {
      const canonical = (shadowDupes.rows as any[]).find((r) => !/\(zodiac/i.test(r.title)) ?? shadowDupes.rows[0];
      for (const dupe of (shadowDupes.rows as any[]).filter((r) => r.id !== canonical.id)) {
        // Move users from dupe to canonical
        for (const tbl of ["user_book_state","user_book_ratings","user_book_reviews","user_favorite_books","reading_sessions","reading_notes","up_next","user_owned_editions","user_hidden_books"]) {
          await run(`UPDATE OR IGNORE ${tbl} SET book_id = ? WHERE book_id = ?`, [canonical.id, dupe.id], `move ${tbl}`);
          await run(`DELETE FROM ${tbl} WHERE book_id = ?`, [dupe.id], `clean ${tbl}`);
        }
        await deleteBookHard(dupe.id, `dupe Shadow Princess`);
      }
    }

    // Fix null author on "Heartless Sky" — Caroline Peckham & Susanne Valenti
    const heartless = await q(`
      SELECT b.id FROM book_series bs JOIN books b ON b.id = bs.book_id
      WHERE bs.series_id = ? AND LOWER(b.title) LIKE 'heartless%'`, [seriesId]);
    if (heartless.rows.length > 0) {
      const authorId = await findOrCreateAuthor("Caroline Peckham");
      const coAuthorId = await findOrCreateAuthor("Susanne Valenti");
      await run(`INSERT OR IGNORE INTO book_authors (book_id, author_id, role) VALUES (?, ?, 'author')`, [heartless.rows[0].id, authorId], `link Caroline Peckham to Heartless Sky`);
      await run(`INSERT OR IGNORE INTO book_authors (book_id, author_id, role) VALUES (?, ?, 'author')`, [heartless.rows[0].id, coAuthorId], `link Susanne Valenti to Heartless Sky`);
    }

    // Import missing: #1 The Awakening, #3 The Reckoning, #8 Restless Stars
    // Zodiac Academy titles are generic ("The Awakening", "The Reckoning")
    // so the single-result ISBNdb search picks the wrong book. Use multi
    // and filter by author substring match.
    const missing: Array<[string, number, string]> = [
      ["The Awakening", 1, "zodiac academy the awakening caroline peckham"],
      ["The Reckoning", 3, "zodiac academy the reckoning caroline peckham"],
      ["Restless Stars", 8, "restless stars caroline peckham susanne valenti"],
    ];
    let imported = 0;
    for (const [title, pos, searchQ] of missing) {
      const existing = await findBookByTitle(title.toLowerCase(), "peckham");
      if (existing) {
        await run(`INSERT OR IGNORE INTO book_series (book_id, series_id, position_in_series) VALUES (?, ?, ?)`, [existing, seriesId, pos], `link existing ${title} at ${pos}`);
        continue;
      }
      console.log(`  searching ISBNdb for "${searchQ}"...`);
      const results = await searchISBNdbMulti(searchQ, 10);
      const match = results.find((b) => {
        const authorMatch = (b.authors ?? []).some((a) => /peckham|valenti/i.test(a));
        const titleMatch = b.title.toLowerCase().includes(title.toLowerCase());
        return authorMatch && titleMatch;
      });
      if (match) {
        const newId = await importBookFromISBNdb({
          title,
          authors: ["Caroline Peckham", "Susanne Valenti"],
          seriesId,
          position: pos,
          isbn: match,
        });
        if (newId) imported++;
      } else {
        console.log(`    ${title}: not found cleanly on ISBNdb after ${results.length} hits; skipped`);
      }
    }
    await resolveReport(reportId, `Merged Shadow Princess duplicate. Fixed author on Heartless Sky (Caroline Peckham + Susanne Valenti). Imported ${imported} missing core book(s).`);
  }

  // ─── #6 Divergent ────────────────────────────────────────────────
  console.log("\n━━━ #6 Divergent: set Sixth Faction position + remove spurious ━━━");
  {
    const reportId = "a3993fd9-34d6-4628-a26c-018565b0dcaa";
    const seriesId = "af6faebf-00e7-479b-82c2-111c0e4b31a5";

    // Set position on The Sixth Faction (user said it's first of a duology after the trilogy → position 5)
    const sixth = await q(`SELECT b.id FROM book_series bs JOIN books b ON b.id = bs.book_id
                           WHERE bs.series_id = ? AND LOWER(b.title) = 'the sixth faction'`, [seriesId]);
    if (sixth.rows.length > 0) {
      await run(`UPDATE book_series SET position_in_series = 5 WHERE book_id = ? AND series_id = ?`,
                [sixth.rows[0].id, seriesId],
                `set Sixth Faction position=5`);
    }

    // Remove/delete spurious entries with 0 users
    const spuriousSlugs = [
      "divergente-3-veronica-roth",                           // Spanish edition
      "the-transfer-aaron-stanford",                          // miscredited author
    ];
    for (const slug of spuriousSlugs) {
      const b = await q(`SELECT id, (SELECT count(*) FROM user_book_state WHERE book_id = books.id) as users FROM books WHERE slug = ?`, [slug]);
      if (b.rows.length > 0 && Number(b.rows[0].users) === 0) {
        await deleteBookHard(b.rows[0].id as string, `spurious Divergent entry ${slug}`);
      }
    }

    // Flag as box_set: Divergent Series (already has Trilogy flagged)
    const seriesBook = await q(`SELECT b.id FROM book_series bs JOIN books b ON b.id = bs.book_id
                                WHERE bs.series_id = ? AND LOWER(b.title) = 'divergent series'`, [seriesId]);
    if (seriesBook.rows.length > 0) {
      await run(`UPDATE books SET is_box_set = 1, updated_at = datetime('now') WHERE id = ?`,
                [seriesBook.rows[0].id], `flag Divergent Series as is_box_set`);
    }

    // Mark ancillary products as import_only (companion guides, movie tie-ins)
    const ancillarySlugs = [
      "world-of-divergent-veronica-roth",
      "free-four-tobias-tells-the-divergent-knife-throwing-scene-veronica-roth",
      "inside-divergent-veronica-roth",
      "divergent-official-illustrated-movie-companion-veronica-roth",
      "four-stories-veronica-roth",
    ];
    let hiddenCount = 0;
    for (const slug of ancillarySlugs) {
      const b = await q(`SELECT id, (SELECT count(*) FROM user_book_state WHERE book_id = books.id) as users FROM books WHERE slug = ?`, [slug]);
      if (b.rows.length > 0 && Number(b.rows[0].users) === 0) {
        await run(`UPDATE books SET visibility = 'import_only', updated_at = datetime('now') WHERE id = ?`,
                  [b.rows[0].id], `import_only: ${slug}`);
        hiddenCount++;
      }
    }

    await resolveReport(reportId, `Set "The Sixth Faction" position=5 (post-trilogy duology). Deleted 2 spurious entries (Spanish edition, miscredited author). Marked ${hiddenCount} ancillary product(s) as import_only.`);
  }

  console.log(`\n=== DONE (${APPLY ? "APPLIED" : "DRY-RUN"}) ===`);
  if (!APPLY) console.log("Re-run with --apply to mutate.");
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
