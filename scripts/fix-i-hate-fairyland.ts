/**
 * I Hate Fairyland series cleanup.
 *
 * Current state: 21 entries across individual comic issues, trade
 * paperback volumes (Vol. 1-6), omnibus "Book" editions (with duplicates),
 * an all-caps junk entry, "Untold Tales" spinoffs, and two separate
 * series rows. The user wants:
 *   1. Hide individual comic issues (#5, #10, #11, #12, #14, #15, #18)
 *   2. Hide duplicate Book editions (keep "Book One", "Book Two", "Book Three")
 *   3. Hide the all-caps "I HATE FAIRYLAND" junk entry
 *   4. Consolidate to one series row
 *   5. Fix the 1956 pub year on #11
 *   6. Keep: Vol 1-6, Book One/Two/Three, Untold Tales
 */

import { createClient, type Client } from "@libsql/client";
import Database from "better-sqlite3";
import path from "path";

interface DbLike {
  label: string;
  exec(sql: string, args?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

function wrapLocal(db: Database.Database): DbLike {
  return {
    label: "local",
    async exec(sql: string, args: unknown[] = []) {
      if (sql.trim().toUpperCase().startsWith("SELECT")) {
        return { rows: db.prepare(sql).all(...(args as never[])) as Record<string, unknown>[] };
      }
      db.prepare(sql).run(...(args as never[]));
      return { rows: [] };
    },
  };
}

function wrapRemote(client: Client): DbLike {
  return {
    label: "turso",
    async exec(sql: string, args: unknown[] = []) {
      const res = await client.execute({ sql, args: args as (string | number | null)[] });
      return { rows: res.rows.map((r) => ({ ...r } as unknown as Record<string, unknown>)) };
    },
  };
}

async function migrate(db: DbLike) {
  console.log(`\n╭─ I Hate Fairyland cleanup on ${db.label}`);

  // 1. Identify all I Hate Fairyland books
  const allBooks = await db.exec(
    `SELECT id, title, slug, publication_year FROM books WHERE title LIKE '%Hate Fairyland%' OR title LIKE '%HATE FAIRYLAND%' ORDER BY title`,
  );
  console.log(`│  Found ${allBooks.rows.length} I Hate Fairyland entries`);

  // 2. Classify and hide individual issues + junk + duplicates
  const hidePatterns = [
    // Individual comic issues (single floppies)
    /I Hate Fairyland (#\d+|#\d+$)/,
    /I Hate Fairyland \(2022\) #\d+/,
    // All-caps junk entry
    /^I HATE FAIRYLAND$/,
    // "Unbelievable Unfortunately..." spin-off issues
    /Unbelievable Unfortunately/,
  ];

  // Keep CANONICAL versions, hide duplicates of the same edition
  // Canonical: "I Hate Fairyland, Book One" (with comma), "I Hate Fairyland, Book Two" (with comma)
  // Duplicates: "I Hate Fairyland Book 1" (no comma, uses "1" not "One")
  const dupSlugs = new Set([
    "i-hate-fairyland-book-1-skottie-young", // dup of "I Hate Fairyland, Book One"
  ]);

  let hidden = 0;
  for (const book of allBooks.rows) {
    const title = book.title as string;
    const slug = book.slug as string;
    const shouldHide =
      hidePatterns.some((p) => p.test(title)) || dupSlugs.has(slug);

    if (shouldHide) {
      await db.exec(`UPDATE books SET visibility = 'import_only' WHERE id = ?`, [book.id]);
      hidden++;
      console.log(`│  ✗ Hidden: "${title}"`);
    }
  }
  console.log(`│  Hidden ${hidden} entries`);

  // 3. Fix the 1956 pub year on #11
  await db.exec(
    `UPDATE books SET publication_year = 2023 WHERE slug = 'i-hate-fairyland-2022-11-skottie-young' AND publication_year = 1956`,
  );
  console.log(`│  ✓ Fixed #11 pub year (1956 → 2023)`);

  // 4. Consolidate series rows — keep the main "I Hate Fairyland" row
  const seriesRows = await db.exec(
    `SELECT id, name, slug FROM series WHERE slug LIKE 'i-hate-fairyland%' ORDER BY name`,
  );
  console.log(`│  Found ${seriesRows.rows.length} series rows`);

  if (seriesRows.rows.length > 1) {
    // Pick the one named "I Hate Fairyland" (not "(2022)") as canonical
    const canonical = seriesRows.rows.find(
      (r) => (r.name as string) === "I Hate Fairyland",
    );
    if (canonical) {
      for (const row of seriesRows.rows) {
        if (row.id === canonical.id) continue;
        // Move book links from dup to canonical
        const links = await db.exec(
          `SELECT book_id, position_in_series FROM book_series WHERE series_id = ?`,
          [row.id],
        );
        for (const link of links.rows) {
          const existing = await db.exec(
            `SELECT 1 FROM book_series WHERE series_id = ? AND book_id = ?`,
            [canonical.id, link.book_id],
          );
          if (existing.rows.length === 0) {
            await db.exec(
              `INSERT INTO book_series (book_id, series_id, position_in_series) VALUES (?, ?, ?)`,
              [link.book_id, canonical.id, link.position_in_series],
            );
          }
          await db.exec(
            `DELETE FROM book_series WHERE series_id = ? AND book_id = ?`,
            [row.id, link.book_id],
          );
        }
        await db.exec(`DELETE FROM series WHERE id = ?`, [row.id]);
        console.log(`│  ✓ Merged series "${row.name}" into canonical`);
      }
    }
  }

  // 5. Ensure Vol 1-6 and Book One/Two/Three are linked to the canonical series
  // with reasonable positions
  const canonicalSeries = await db.exec(
    `SELECT id FROM series WHERE name = 'I Hate Fairyland' AND slug = 'i-hate-fairyland'`,
  );
  if (canonicalSeries.rows.length > 0) {
    const seriesId = canonicalSeries.rows[0].id as string;

    // Map of slug → desired position for the collected editions
    const positionMap: Record<string, number> = {
      "i-hate-fairyland-vol-1-skottie-young": 1,
      "i-hate-fairyland-vol-2-skottie-young": 2,
      "i-hate-fairyland-vol-3-skottie-young": 3,
      "i-hate-fairyland-vol-4-skottie-young": 4,
      "i-hate-fairyland-vol-5-skottie-young": 5,
      "i-hate-fairyland-vol-6-skottie-young": 6,
    };

    for (const [slug, pos] of Object.entries(positionMap)) {
      const book = await db.exec(`SELECT id FROM books WHERE slug = ?`, [slug]);
      if (book.rows.length > 0) {
        const bookId = book.rows[0].id as string;
        await db.exec(`DELETE FROM book_series WHERE book_id = ? AND series_id = ?`, [bookId, seriesId]);
        await db.exec(
          `INSERT INTO book_series (book_id, series_id, position_in_series) VALUES (?, ?, ?)`,
          [bookId, seriesId, pos],
        );
      }
    }
    console.log(`│  ✓ Vol 1-6 positions set`);
  }

  // 6. Mark the I Hate Fairyland report as resolved
  await db.exec(
    `UPDATE reported_issues SET status = 'resolved', resolved_at = datetime('now') WHERE page_url = '/series/i-hate-fairyland' AND status = 'new'`,
  );
  console.log(`│  ✓ Report marked resolved`);

  console.log(`╰─ ${db.label} done\n`);
}

async function main() {
  const localDbPath = path.resolve(
    process.cwd(),
    process.cwd().endsWith("tbra") ? "data/tbra.db" : "claude/tbra/data/tbra.db",
  );
  const localRaw = new Database(localDbPath);
  const local = wrapLocal(localRaw);
  await migrate(local);

  const tursoUrl = process.env.TURSO_DATABASE_URL;
  const tursoToken = process.env.TURSO_AUTH_TOKEN;
  if (tursoUrl && tursoToken) {
    const tursoClient = createClient({ url: tursoUrl, authToken: tursoToken });
    const turso = wrapRemote(tursoClient);
    await migrate(turso);
  }
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
