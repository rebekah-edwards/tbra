import { config } from "dotenv";
config({ path: ".env.local" });

import Database from "better-sqlite3";
import path from "path";
import { enrichBook } from "../src/lib/enrichment/enrich-book";

const DB_PATH = path.join(process.cwd(), "data", "tbra.db");
const localDb = new Database(DB_PATH);

const pending = localDb.prepare(`
  SELECT el.book_id, b.title FROM enrichment_log el
  JOIN books b ON b.id = el.book_id
  WHERE el.status = 'pending' AND b.visibility = 'public'
  ORDER BY b.title LIMIT 752
`).all() as any[];

console.log(\`Found \${pending.length} books to enrich\`);
localDb.close();

async function run() {
  let success = 0, fail = 0;
  for (let i = 0; i < pending.length; i++) {
    const { book_id, title } = pending[i];
    if (i % 25 === 0) console.log(\`Progress: \${i}/\${pending.length} (\${success} ok, \${fail} fail)\`);
    try {
      await enrichBook(book_id);
      success++;
    } catch (err: any) {
      fail++;
      if (fail <= 10) console.log(\`  ✗ \${title}: \${err.message?.slice(0, 80)}\`);
    }
  }
  console.log(\`\nDone! Enriched: \${success}, Failed: \${fail}\`);
}

run().catch(console.error);
