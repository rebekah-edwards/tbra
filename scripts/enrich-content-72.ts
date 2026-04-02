import { config } from "dotenv";
config({ path: ".env.local" });

import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "data", "tbra.db");
const db = new Database(DB_PATH);

const books = db.prepare(`
  SELECT b.id, b.title FROM books b
  JOIN user_book_state ubs ON ubs.book_id = b.id
  WHERE b.visibility = 'public'
  AND b.id NOT IN (SELECT DISTINCT book_id FROM book_category_ratings)
  GROUP BY b.id
  ORDER BY COUNT(DISTINCT ubs.user_id) DESC
`).all() as { id: string; title: string }[];

db.close();

console.log("Found " + books.length + " books to enrich for content details");

async function run() {
  let success = 0, fail = 0;
  
  for (let i = 0; i < books.length; i++) {
    const book = books[i];
    console.log("[" + (i+1) + "/" + books.length + "] " + book.title);
    
    try {
      const res = await fetch("http://localhost:3000/api/enrichment/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookId: book.id }),
      });
      
      if (res.ok) {
        success++;
        console.log("  OK");
      } else {
        const text = await res.text();
        fail++;
        console.log("  FAIL: " + text.slice(0, 100));
      }
    } catch (err: any) {
      fail++;
      console.log("  ERR: " + err.message);
    }
    
    // Wait for enrichment to complete before next (each does Brave + Grok)
    await new Promise(r => setTimeout(r, 2000));
  }
  
  console.log("\nDone! Success: " + success + ", Failed: " + fail);
  console.log("Estimated Brave calls: " + (success * 5) + " (5 searches per book)");
}

run().catch(console.error);
