/**
 * Targeted Turso → local pull for specific books (book row + genres/authors
 * junctions + content ratings). For when a book was enriched on PROD (trigger
 * route) and local needs it now, without running a full sync-pull — e.g. while
 * another local-writing job is in flight. Local writes only; Turso is read.
 *
 * Usage: BOOK_IDS=<uuid,uuid,…> npx tsx scripts/pull-books-from-turso.ts
 */
import { config } from "dotenv";
config({ path: ".env.vercel.local" });
import { createClient } from "@libsql/client";
import { createGuardedTurso } from "./lib/turso-guard";

const IDS = (process.env.BOOK_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);

(async () => {
  if (!IDS.length) throw new Error("BOOK_IDS env var required");
  const local = createClient({ url: "file:data/tbra.db" });
  await local.execute("PRAGMA busy_timeout = 15000");
  const { remote } = await createGuardedTurso({ name: "pull-books-from-turso", maxRuntimeMs: 5 * 60 * 1000, queryTimeoutMs: 30_000 });
  const cols = async (t: string) => (await local.execute(`PRAGMA table_info(${t})`)).rows.map((r: any) => r.name as string);

  async function upsert(table: string, row: any, mode: "IGNORE" | "REPLACE") {
    const lc = new Set(await cols(table));
    const names = Object.keys(row).filter((n) => lc.has(n));
    await local.execute({
      sql: `INSERT OR ${mode} INTO ${table} (${names.join(",")}) VALUES (${names.map(() => "?").join(",")})`,
      args: names.map((n) => row[n]),
    });
  }

  for (const id of IDS) {
    const book = (await remote.execute({ sql: "SELECT * FROM books WHERE id=?", args: [id] })).rows[0] as any;
    if (!book) { console.log(`✗ ${id} not on Turso`); continue; }
    const lc = new Set(await cols("books"));
    const names = Object.keys(book).filter((n) => n !== "id" && lc.has(n));
    const r = await local.execute({
      sql: `UPDATE books SET ${names.map((n) => `${n}=?`).join(",")} WHERE id=?`,
      args: [...names.map((n) => book[n]), id],
    });
    if (r.rowsAffected === 0) await upsert("books", book, "IGNORE");

    const counts: Record<string, number> = {};
    for (const [parent, junction, fk] of [["authors", "book_authors", "author_id"], ["genres", "book_genres", "genre_id"]] as const) {
      const jr = (await remote.execute({ sql: `SELECT * FROM ${junction} WHERE book_id=?`, args: [id] })).rows as any[];
      for (const j of jr) {
        const p = (await remote.execute({ sql: `SELECT * FROM ${parent} WHERE id=?`, args: [j[fk]] })).rows[0];
        if (p) await upsert(parent, p, "IGNORE");
      }
      await local.execute({ sql: `DELETE FROM ${junction} WHERE book_id=?`, args: [id] });
      for (const j of jr) await upsert(junction, j, "IGNORE");
      counts[junction] = jr.length;
    }
    const ratings = (await remote.execute({ sql: "SELECT * FROM book_category_ratings WHERE book_id=?", args: [id] })).rows as any[];
    await local.execute({ sql: "DELETE FROM book_category_ratings WHERE book_id=?", args: [id] });
    for (const x of ratings) await upsert("book_category_ratings", x, "REPLACE");
    console.log(`✓ ${book.title} — authors ${counts.book_authors}, genres ${counts.book_genres}, ratings ${ratings.length}`);
  }
  process.exit(0);
})();
