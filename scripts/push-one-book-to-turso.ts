// Targeted single-book push to prod Turso: book row + authors/genres/series
// junctions + content ratings. For freshly enriched local books that can't
// wait for the nightly sync (mirrors sync-push's new-book steps, scoped).
// Usage: BOOK_ID=<uuid> npx tsx scripts/push-one-book-to-turso.ts
import { config } from "dotenv";
config({ path: ".env.vercel.local" });

import { createClient } from "@libsql/client";
import { createGuardedTurso } from "./lib/turso-guard";

const BOOK_ID = process.env.BOOK_ID;

(async () => {
  if (!BOOK_ID) throw new Error("BOOK_ID env var required");
  const local = createClient({ url: "file:data/tbra.db" });
  const { remote } = await createGuardedTurso({
    name: "push-one-book",
    maxRuntimeMs: 5 * 60 * 1000,
    queryTimeoutMs: 30_000,
  });

  const rowOf = async (sql: string, args: any[]) =>
    (await local.execute({ sql, args })).rows;
  const cols = async (table: string) =>
    (await local.execute(`PRAGMA table_info(${table})`)).rows.map((r: any) => r.name as string);

  async function pushRow(table: string, row: any) {
    const names = Object.keys(row);
    await remote.execute({
      sql: `INSERT OR IGNORE INTO ${table} (${names.join(",")}) VALUES (${names.map(() => "?").join(",")})`,
      args: names.map((n) => row[n]),
    });
  }

  const bookCols = await cols("books");
  const [book] = await rowOf(`SELECT ${bookCols.join(",")} FROM books WHERE id=?`, [BOOK_ID]);
  if (!book) throw new Error("book not found locally");
  await pushRow("books", book);

  const authors = await rowOf("SELECT a.* FROM authors a JOIN book_authors ba ON ba.author_id=a.id WHERE ba.book_id=?", [BOOK_ID]);
  for (const a of authors) await pushRow("authors", a);
  for (const ba of await rowOf("SELECT * FROM book_authors WHERE book_id=?", [BOOK_ID])) await pushRow("book_authors", ba);

  const genres = await rowOf("SELECT g.* FROM genres g JOIN book_genres bg ON bg.genre_id=g.id WHERE bg.book_id=?", [BOOK_ID]);
  for (const g of genres) await pushRow("genres", g);
  for (const bg of await rowOf("SELECT * FROM book_genres WHERE book_id=?", [BOOK_ID])) await pushRow("book_genres", bg);

  const series = await rowOf("SELECT s.* FROM series s JOIN book_series bs ON bs.series_id=s.id WHERE bs.book_id=?", [BOOK_ID]);
  for (const s of series) await pushRow("series", s);
  for (const bs of await rowOf("SELECT * FROM book_series WHERE book_id=?", [BOOK_ID])) await pushRow("book_series", bs);

  await remote.execute({ sql: "DELETE FROM book_category_ratings WHERE book_id=?", args: [BOOK_ID] });
  for (const r of await rowOf("SELECT * FROM book_category_ratings WHERE book_id=?", [BOOK_ID])) await pushRow("book_category_ratings", r);

  const check = await remote.execute({
    sql: "SELECT (SELECT COUNT(*) FROM books WHERE id=?) b, (SELECT COUNT(*) FROM book_category_ratings WHERE book_id=?) r",
    args: [BOOK_ID, BOOK_ID],
  });
  console.log("TURSO VERIFY:", JSON.stringify(check.rows[0]));
  process.exit(0);
})().catch((e) => {
  console.error("FAILED:", e?.message ?? e);
  process.exit(1);
});
