import * as dotenv from "dotenv";
dotenv.config({ path: ".env.vercel.local" });
import { createClient } from "@libsql/client";

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

const IDS = ["3876e75b-f884-4792-ab98-4897303b134e", "c7898c25-5a9d-402a-bd78-61f1e413ac1e"];

function norm(t: string): string {
  return t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

async function main() {
  for (const id of IDS) {
    const me = await client.execute({
      sql: `SELECT b.id, b.title, b.slug, b.cover_image_url, b.cover_source, b.description, b.publication_year,
              (SELECT a.name FROM authors a JOIN book_authors ba ON ba.author_id = a.id WHERE ba.book_id = b.id LIMIT 1) as author
            FROM books b WHERE b.id = ?`,
      args: [id],
    });
    const r = me.rows[0] as any;
    console.log(`\n=== ${id} ===`);
    console.log(`  title: ${r.title}`);
    console.log(`  author: ${r.author}`);
    console.log(`  slug: ${JSON.stringify(r.slug)}`);
    console.log(`  cover: ${r.cover_source} (${r.cover_image_url?.slice(0, 60)})`);
    console.log(`  year: ${r.publication_year}`);

    // Find canonical siblings by title + author
    const title = r.title as string;
    const author = r.author as string | null;
    if (!title || !author) { console.log("  no author on this row, can't find sibling"); continue; }

    const sib = await client.execute({
      sql: `SELECT b.id, b.title, b.slug, b.cover_image_url, b.cover_source, b.publication_year,
              (SELECT a.name FROM authors a JOIN book_authors ba ON ba.author_id = a.id WHERE ba.book_id = b.id LIMIT 1) as author,
              (SELECT COUNT(*) FROM user_book_state WHERE book_id = b.id) as users
            FROM books b
            WHERE b.visibility='public' AND b.id != ? AND b.title LIKE ?`,
      args: [id, `${title.slice(0, 20).replace(/[%_]/g, "")}%`],
    });
    const normT = norm(title);
    const normA = norm(author);
    const siblings = (sib.rows as any[]).filter(s => norm(s.title ?? "") === normT && norm(s.author ?? "") === normA);

    console.log(`  siblings matching normalized title+author: ${siblings.length}`);
    for (const s of siblings) {
      console.log(`    ${s.id}  slug=${JSON.stringify(s.slug)}  users=${s.users}  cover=${s.cover_source}  year=${s.publication_year}`);
    }

    // Also show user(s) on this book
    const users = await client.execute({
      sql: `SELECT user_id, state FROM user_book_state WHERE book_id = ?`,
      args: [id],
    });
    console.log(`  users on this book:`);
    for (const u of users.rows as any[]) console.log(`    user=${u.user_id} state=${u.state}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
