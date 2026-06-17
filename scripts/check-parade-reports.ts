import * as dotenv from "dotenv";
dotenv.config({ path: ".env.vercel.local" });
import { createClient } from "@libsql/client";

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

async function main() {
  const bookIds = [
    "bd8400ed-2580-4762-be68-059bb5992606",
    "a2c6ceba-d702-4ea4-bf02-5369b96d4b78",
  ];

  for (const id of bookIds) {
    const r = await client.execute({
      sql: `SELECT id, status, description, resolution, resolved_at, created_at, book_id, page_url FROM reported_issues WHERE book_id = ? ORDER BY created_at DESC`,
      args: [id],
    });
    console.log(`\n=== Reports linked to book_id ${id} ===`);
    console.log(JSON.stringify(r.rows, null, 2));
  }

  const r2 = await client.execute({
    sql: `SELECT id, status, description, resolution, resolved_at, created_at, book_id, page_url FROM reported_issues WHERE description LIKE '%parade%' OR description LIKE '%Parade%' OR page_url LIKE '%parade%' ORDER BY created_at DESC`,
    args: [],
  });
  console.log(`\n=== Any reports with 'parade' in text ===`);
  console.log(JSON.stringify(r2.rows, null, 2));

  const r3 = await client.execute({
    sql: `SELECT id, title, slug, visibility, needs_review FROM books WHERE title LIKE '%Parade of Horribles%'`,
    args: [],
  });
  console.log(`\n=== Books ===`);
  console.log(JSON.stringify(r3.rows, null, 2));

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
