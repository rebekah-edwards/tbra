import { config } from "dotenv";
config({ path: ".env.local" });

import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "data", "tbra.db");
const db = new Database(DB_PATH);

// Get all books needing enrichment
const pending = db.prepare(`
  SELECT b.id, b.title FROM books b
  JOIN enrichment_log el ON el.book_id = b.id
  WHERE el.status = 'pending'
  AND b.visibility = 'public'
  ORDER BY b.title
`).all() as any[];

console.log(`Found ${pending.length} books to enrich`);

// Process via the enrichment API endpoint
async function enrichBatch() {
  let success = 0, fail = 0, skipped = 0;
  
  for (let i = 0; i < pending.length; i++) {
    const book = pending[i];
    if (i % 50 === 0) console.log(`\nProgress: ${i}/${pending.length} (${success} enriched, ${fail} failed, ${skipped} skipped)`);
    
    try {
      const res = await fetch("http://localhost:3000/api/enrichment/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookId: book.id }),
      });
      
      if (res.ok) {
        success++;
      } else {
        const text = await res.text();
        if (text.includes("already enriched") || text.includes("recently")) {
          skipped++;
        } else {
          fail++;
          if (fail <= 5) console.log(`  ✗ ${book.title}: ${text.slice(0, 100)}`);
        }
      }
    } catch (err: any) {
      fail++;
      if (fail <= 5) console.log(`  ✗ ${book.title}: ${err.message}`);
    }
    
    // Small delay to not overwhelm the server
    await new Promise(r => setTimeout(r, 200));
  }
  
  console.log(`\nDone! Enriched: ${success}, Failed: ${fail}, Skipped: ${skipped}`);
}

enrichBatch().catch(console.error);
