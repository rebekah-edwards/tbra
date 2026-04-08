/**
 * Fix the Green Lantern: Sleepers series end-to-end.
 *
 * Current state (as diagnosed):
 *   - 2 series rows on Turso with slug 'green-lantern-sleepers' (one
 *     with ':', one with ' - ')
 *   - 3 rows locally (one empty orphan on top of those 2)
 *   - Book 1 ('ae681d7f') titled just "Green Lantern", wrong author
 *     (Mike Baron, should be Christopher J. Priest), garbage Amazon-
 *     scrape description
 *   - Book 2 ('8bb5f351') titled "Green Lantern - Sleepers", wrong
 *     author, wrong year (2011 vs 2005), garbage description
 *   - Book 3 doesn't exist at all
 *
 * Target state:
 *   - ONE canonical series row: '295c4a44...' (colon form), name
 *     "Green Lantern: Sleepers", slug "green-lantern-sleepers" preserved
 *     exactly (already being discovered in search per user)
 *   - Book 1 ('ae681d7f') — fix title, author, description; keep slug,
 *     ISBN, year, id unchanged
 *   - Book 2 ('8bb5f351') — fix title, author, description, year (to
 *     2005); keep slug, ISBN, id unchanged
 *   - Book 3 — NEW row, position 3, Christopher J. Priest, year 2005,
 *     ISBN 9781599507828, full description
 *   - Duplicate series row deleted (and empty local orphan too)
 *
 * Runs against BOTH local and Turso so they stay in sync. Idempotent —
 * rerunning should be a no-op or a safe re-apply. Uses COALESCE-style
 * guards where appropriate but also force-updates fields we know are
 * wrong (the garbage descriptions, the wrong year, etc).
 */

import { createClient, type Client } from "@libsql/client";
import Database from "better-sqlite3";
import path from "path";

// ─── Constants from the diagnosis ───

const CANONICAL_SERIES_ID = "295c4a44-2df7-4d66-a5d6-6498eee7e312";
const DUP_SERIES_IDS = [
  "3b73b53b-8b84-482b-be4c-748f9c95a2de",
  "de583f70-90eb-4ca5-ac18-b31a8038dc0a", // local-only orphan
];

const PRIEST_AUTHOR_ID = "52e465d1-6181-4c05-b737-24258e554933";

const BOOK_1_ID = "ae681d7f-d56d-4845-b2be-1e0e8ebb53a3";
const BOOK_2_ID = "8bb5f351-f022-4847-8fc5-463e3d00fa73";

// Deterministic UUID for book 3 so reruns don't create duplicates.
// Generated via `uuidgen | tr '[:upper:]' '[:lower:]'` once and hardcoded.
const BOOK_3_ID = "9c7f1e4a-3d6b-4c12-8f2a-7b9e5d6c8a11";

const BOOK_1_TITLE = "Green Lantern: Sleepers, Book 1";
const BOOK_1_DESC =
  "Earth's powerful superhero Kyle Rayner, the Green Lantern, must somehow bring together enough heroes from the planet's past and present to stop an alien threat to the continuity of space and time, in the first volume in an epic trilogy.";

const BOOK_2_TITLE = "Green Lantern: Sleepers, Book 2";
const BOOK_2_DESC =
  "Alan Scott, a new Green Lantern, battles the forces of evil during World War II as both an enlisted man and as a costumed superhero, matching wits with a seventeenth-century supervillain called Malvolio, who makes a pact with Adolf Hitler that could destroy the entire Allied campaign and eliminate forever the Green Lantern corps.";

const BOOK_3_TITLE = "Green Lantern: Sleepers, Book 3";
const BOOK_3_DESC =
  "Stripped of his Green Lantern powers, Hal Jordan must use all his wits to battle the archvillain Sinestro and his army of clones, only to discover that he may be forced to sacrifice his own life by taking the Sinestro power rings on a one-way odyssey into the anti-matter universe.";
const BOOK_3_SLUG = "green-lantern-sleepers-book-3";
const BOOK_3_ISBN = "9781599507828";

// ─── Abstraction so we can run the same migration against libsql + sqlite ───

interface DbLike {
  label: string;
  exec(sql: string, args?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

function wrapLocal(db: Database.Database): DbLike {
  return {
    label: "local",
    async exec(sql: string, args: unknown[] = []) {
      const normalized = sql.trim().toUpperCase();
      const isSelect = normalized.startsWith("SELECT");
      const stmt = db.prepare(sql);
      if (isSelect) {
        return { rows: stmt.all(...(args as never[])) as Record<string, unknown>[] };
      }
      stmt.run(...(args as never[]));
      return { rows: [] };
    },
  };
}

function wrapRemote(client: Client): DbLike {
  return {
    label: "turso",
    async exec(sql: string, args: unknown[] = []) {
      const res = await client.execute({ sql, args: args as (string | number | null)[] });
      return {
        rows: res.rows.map((r) => ({ ...r } as unknown as Record<string, unknown>)),
      };
    },
  };
}

// ─── Migration logic (shared across both DBs) ───

async function migrate(db: DbLike) {
  console.log(`\n╭─ Running migration against ${db.label}`);

  // 1) Canonicalize the series row
  await db.exec(
    `UPDATE series SET name = ?, slug = ? WHERE id = ?`,
    ["Green Lantern: Sleepers", "green-lantern-sleepers", CANONICAL_SERIES_ID],
  );
  console.log(`│  ✓ canonical series row updated`);

  // 2) Move book links from dup series to canonical, then delete dup rows
  for (const dupId of DUP_SERIES_IDS) {
    // Re-point any book links from dup → canonical, but only if the book
    // isn't already linked to canonical (avoid UNIQUE violation).
    const dupLinks = await db.exec(
      `SELECT book_id, position_in_series FROM book_series WHERE series_id = ?`,
      [dupId],
    );
    for (const link of dupLinks.rows) {
      const bookId = link.book_id as string;
      const pos = link.position_in_series as number | null;
      const existing = await db.exec(
        `SELECT 1 FROM book_series WHERE series_id = ? AND book_id = ?`,
        [CANONICAL_SERIES_ID, bookId],
      );
      if (existing.rows.length === 0) {
        await db.exec(
          `INSERT INTO book_series (book_id, series_id, position_in_series) VALUES (?, ?, ?)`,
          [bookId, CANONICAL_SERIES_ID, pos],
        );
      }
      await db.exec(`DELETE FROM book_series WHERE series_id = ? AND book_id = ?`, [
        dupId,
        bookId,
      ]);
    }
    // Now the dup row has no links — safe to delete
    await db.exec(`DELETE FROM series WHERE id = ?`, [dupId]);
    console.log(`│  ✓ dup series ${dupId.slice(0, 8)}… merged + deleted`);
  }

  // 3) Fix book 1: title, description. Leave slug, year, isbn alone.
  await db.exec(
    `UPDATE books SET title = ?, description = ?, summary = ?, publication_year = COALESCE(publication_year, 2004), language = COALESCE(language, 'English'), is_fiction = 1 WHERE id = ?`,
    [BOOK_1_TITLE, BOOK_1_DESC, BOOK_1_DESC, BOOK_1_ID],
  );
  console.log(`│  ✓ book 1 updated`);

  // 4) Fix book 2: title, description, year (was 2011 on Turso, should be 2005).
  //    We force-update the year here because the dedup check in step 5 above doesn't cover it.
  await db.exec(
    `UPDATE books SET title = ?, description = ?, summary = ?, publication_year = 2005, language = COALESCE(language, 'English'), is_fiction = 1 WHERE id = ?`,
    [BOOK_2_TITLE, BOOK_2_DESC, BOOK_2_DESC, BOOK_2_ID],
  );
  console.log(`│  ✓ book 2 updated`);

  // 5) Replace authors on books 1 and 2 with ONLY Christopher J. Priest.
  //    Goodreads lists them as "by Christopher J. Priest" — Mike Baron was
  //    apparently linked to the wrong book and isn't the primary author.
  for (const bookId of [BOOK_1_ID, BOOK_2_ID]) {
    await db.exec(`DELETE FROM book_authors WHERE book_id = ?`, [bookId]);
    await db.exec(
      `INSERT INTO book_authors (book_id, author_id, role) VALUES (?, ?, 'author')`,
      [bookId, PRIEST_AUTHOR_ID],
    );
  }
  console.log(`│  ✓ authors corrected on books 1 and 2`);

  // 6) Create book 3 if it doesn't exist. Use a deterministic ID so reruns
  //    don't create duplicates. INSERT OR IGNORE so rerun is safe.
  const existingBook3 = await db.exec(
    `SELECT id FROM books WHERE id = ? OR isbn_13 = ?`,
    [BOOK_3_ID, BOOK_3_ISBN],
  );
  if (existingBook3.rows.length === 0) {
    await db.exec(
      `INSERT INTO books (id, title, slug, description, summary, isbn_13, publication_year, language, is_fiction) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        BOOK_3_ID,
        BOOK_3_TITLE,
        BOOK_3_SLUG,
        BOOK_3_DESC,
        BOOK_3_DESC,
        BOOK_3_ISBN,
        2005,
        "English",
        1,
      ],
    );
    console.log(`│  ✓ book 3 created`);
  } else {
    // Already exists (rerun or pre-existing). Update the authoritative fields.
    const existingId = existingBook3.rows[0].id as string;
    await db.exec(
      `UPDATE books SET title = ?, description = ?, summary = ?, publication_year = 2005, is_fiction = 1 WHERE id = ?`,
      [BOOK_3_TITLE, BOOK_3_DESC, BOOK_3_DESC, existingId],
    );
    console.log(`│  ✓ book 3 already existed (id ${existingId.slice(0, 8)}…); fields refreshed`);
  }

  // 7) Link book 3 to Priest + canonical series at position 3
  const book3Row = await db.exec(
    `SELECT id FROM books WHERE isbn_13 = ? OR id = ?`,
    [BOOK_3_ISBN, BOOK_3_ID],
  );
  const book3Id = book3Row.rows[0]?.id as string | undefined;
  if (book3Id) {
    // Authors (idempotent — replace)
    await db.exec(`DELETE FROM book_authors WHERE book_id = ?`, [book3Id]);
    await db.exec(
      `INSERT INTO book_authors (book_id, author_id, role) VALUES (?, ?, 'author')`,
      [book3Id, PRIEST_AUTHOR_ID],
    );

    // Series link (idempotent — delete-then-insert)
    await db.exec(`DELETE FROM book_series WHERE book_id = ? AND series_id = ?`, [
      book3Id,
      CANONICAL_SERIES_ID,
    ]);
    await db.exec(
      `INSERT INTO book_series (book_id, series_id, position_in_series) VALUES (?, ?, ?)`,
      [book3Id, CANONICAL_SERIES_ID, 3],
    );
    console.log(`│  ✓ book 3 linked to author + series`);
  }

  // 8) Make sure books 1 and 2 are linked to canonical series at correct positions
  for (const [bookId, pos] of [
    [BOOK_1_ID, 1],
    [BOOK_2_ID, 2],
  ] as const) {
    await db.exec(
      `DELETE FROM book_series WHERE book_id = ? AND series_id = ?`,
      [bookId, CANONICAL_SERIES_ID],
    );
    await db.exec(
      `INSERT INTO book_series (book_id, series_id, position_in_series) VALUES (?, ?, ?)`,
      [bookId, CANONICAL_SERIES_ID, pos],
    );
  }
  console.log(`│  ✓ books 1 + 2 linked to canonical series at positions 1, 2`);

  console.log(`╰─ ${db.label} done\n`);
}

// ─── Main ───

async function main() {
  const localDbPath = path.resolve(
    process.cwd(),
    process.cwd().endsWith("tbra") ? "data/tbra.db" : "claude/tbra/data/tbra.db",
  );
  const localRaw = new Database(localDbPath);
  const local = wrapLocal(localRaw);

  const tursoUrl = process.env.TURSO_DATABASE_URL;
  const tursoToken = process.env.TURSO_AUTH_TOKEN;
  if (!tursoUrl || !tursoToken) {
    console.warn("TURSO_* env vars not set — running against local only");
    await migrate(local);
    return;
  }
  const tursoClient = createClient({ url: tursoUrl, authToken: tursoToken });
  const turso = wrapRemote(tursoClient);

  // Run both sequentially — local first so we can verify, then Turso
  await migrate(local);
  await migrate(turso);

  console.log("All done. Visit /series/green-lantern-sleepers to verify.");
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
