import * as dotenv from "dotenv";
dotenv.config({ path: ".env.vercel.local" });
import { createClient } from "@libsql/client";

const ids = process.argv.slice(2);
const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

async function main() {
  if (ids.length === 0) { console.log("Usage: check-ids-exist.ts <id1> [id2...]"); process.exit(0); }
  const placeholders = ids.map(() => "?").join(",");
  const r = await client.execute({
    sql: `SELECT id, title, slug FROM books WHERE id IN (${placeholders})`,
    args: ids,
  });
  console.log(`Turso: ${r.rows.length}/${ids.length} found`);
  for (const row of r.rows) console.log(`  ${row.id}  "${row.title}"  slug=${JSON.stringify(row.slug)}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
