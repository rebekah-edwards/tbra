import { config } from "dotenv";
config({ path: ".env.local" });

import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "data", "tbra.db");
const db = new Database(DB_PATH);

// Get books without content details, prioritized by user activity
const books = db.prepare(`
  SELECT b.id, b.title, COUNT(DISTINCT ubs.user_id) as users
  FROM books b
  LEFT JOIN user_book_state ubs ON ubs.book_id = b.id
  WHERE b.visibility = 'public'
  AND b.id NOT IN (SELECT DISTINCT book_id FROM book_category_ratings)
  GROUP BY b.id
  ORDER BY users DESC, b.title
  LIMIT 500
`).all() as { id: string; title: string; users: number }[];

db.close();

console.log("Found " + books.length + " books to enrich for content details");
console.log("Estimated Brave calls: ~" + (books.length * 5));

async function run() {
  let success = 0, fail = 0, skip = 0;

  for (let i = 0; i < books.length; i++) {
    const book = books[i];
    if (i % 50 === 0) {
      console.log("Progress: " + i + "/" + books.length + " (" + success + " ok, " + fail + " fail, " + skip + " skip)");
    }

    try {
      const res = await fetch("http://localhost:3000/api/enrichment/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookId: book.id }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.skipped) {
          skip++;
        } else {
          success++;
        }
      } else {
        fail++;
        if (fail <= 5) {
          const text = await res.text();
          console.log("  FAIL " + book.title + ": " + text.slice(0, 80));
        }
      }
    } catch (err: any) {
      fail++;
      if (fail <= 5) console.log("  ERR " + book.title + ": " + err.message);
    }

    await new Promise(r => setTimeout(r, 2000));
  }

  console.log("\nDone! Success: " + success + ", Failed: " + fail + ", Skipped: " + skip);
  console.log("Estimated Brave calls used: ~" + (success * 5));
}

run().catch(console.error);
