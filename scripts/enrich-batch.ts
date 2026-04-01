import { config } from "dotenv";
config({ path: ".env.local" });

import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "data", "tbra.db");
const db = new Database(DB_PATH);

const pending = db.prepare(`
  SELECT el.book_id, b.title FROM enrichment_log el
  JOIN books b ON b.id = el.book_id
  WHERE el.status = 'pending' AND b.visibility = 'public'
  ORDER BY b.title
`).all() as any[];

console.log("Found " + pending.length + " books to enrich");
db.close();

async function run() {
  let success = 0, fail = 0, skipped = 0;

  for (let i = 0; i < pending.length; i++) {
    const book = pending[i];
    if (i % 25 === 0) {
      console.log("Progress: " + i + "/" + pending.length + " (" + success + " ok, " + fail + " fail, " + skipped + " skip)");
    }

    try {
      const res = await fetch("http://localhost:3000/api/enrichment/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookId: book.book_id }),
      });

      if (res.ok) {
        success++;
      } else {
        const text = await res.text();
        if (text.includes("already") || text.includes("recently")) {
          skipped++;
        } else {
          fail++;
          if (fail <= 10) console.log("  FAIL " + book.title + ": " + text.slice(0, 80));
        }
      }
    } catch (err: any) {
      fail++;
      if (fail <= 10) console.log("  ERR " + book.title + ": " + err.message);
    }

    // Delay to not overwhelm the server
    await new Promise(r => setTimeout(r, 500));
  }

  console.log("\nDone! Enriched: " + success + ", Failed: " + fail + ", Skipped: " + skipped);
}

run().catch(console.error);
