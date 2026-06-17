import * as dotenv from "dotenv";
dotenv.config({ path: ".env.vercel.local" });
import { createClient } from "@libsql/client";

async function main() {
  const url = process.env.TURSO_DATABASE_URL!;
  const authToken = process.env.TURSO_AUTH_TOKEN!;
  const client = createClient({ url, authToken });
  const q = (sql: string, args: any[] = []) => client.execute({ sql, args });

  const open = await q(`
    SELECT ri.id, ri.description, ri.book_id, ri.series_id, ri.page_url,
           b.title as book_title, b.slug as book_slug
    FROM reported_issues ri
    LEFT JOIN books b ON b.id = ri.book_id
    WHERE ri.status = 'new'
    ORDER BY ri.created_at
  `);
  console.log(`Open reports: ${open.rows.length}\n`);
  for (const r of open.rows) {
    console.log(`[${r.id}]`);
    console.log(`  book: ${r.book_title ?? '-'} (${r.book_slug ?? r.book_id ?? '-'})`);
    console.log(`  series_id: ${r.series_id ?? '-'}`);
    console.log(`  page: ${r.page_url}`);
    console.log(`  desc: ${(r.description as string).slice(0, 200)}`);
    console.log();
  }
}
main().catch(e => { console.error(e); process.exit(1); });
