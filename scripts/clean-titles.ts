/**
 * clean-titles.ts — Scan all book titles and apply cleanTitle() patterns.
 *
 * Usage:
 *   npx tsx scripts/clean-titles.ts                # dry-run (default)
 *   npx tsx scripts/clean-titles.ts --apply        # apply to local DB
 *   npx tsx scripts/clean-titles.ts --apply --push # apply to local + push to Turso
 */

import Database from "better-sqlite3";
import { cleanTitle } from "../src/lib/book-validation";

const db = new Database("data/tbra.db");

const applyMode = process.argv.includes("--apply");
const pushMode = process.argv.includes("--push");

interface BookRow {
  id: string;
  title: string;
  slug: string;
}

const allBooks = db.prepare("SELECT id, title, slug FROM books").all() as BookRow[];

const changes: { id: string; oldTitle: string; newTitle: string; slug: string }[] = [];

for (const book of allBooks) {
  const cleaned = cleanTitle(book.title);
  if (cleaned !== book.title) {
    changes.push({
      id: book.id,
      oldTitle: book.title,
      newTitle: cleaned,
      slug: book.slug,
    });
  }
}

console.log(`\nScanned ${allBooks.length} books. Found ${changes.length} titles to clean.\n`);

if (changes.length === 0) {
  console.log("Nothing to do.");
  process.exit(0);
}

// Print changes grouped by pattern for review
console.log("=== PROPOSED CHANGES ===\n");
for (const c of changes) {
  console.log(`  "${c.oldTitle}"`);
  console.log(`→ "${c.newTitle}"`);
  console.log();
}

if (!applyMode) {
  console.log(`\nDry run complete. Pass --apply to write changes to local DB.`);
  process.exit(0);
}

// Apply to local DB
const updateStmt = db.prepare("UPDATE books SET title = ?, updated_at = datetime('now') WHERE id = ?");
const tx = db.transaction(() => {
  for (const c of changes) {
    updateStmt.run(c.newTitle, c.id);
  }
});
tx();
console.log(`\nApplied ${changes.length} title changes to local DB.`);

if (!pushMode) {
  console.log(`Pass --push to also push to Turso.`);
  process.exit(0);
}

// Push to Turso
(async () => {
  const dotenv = await import("dotenv");
  dotenv.config({ path: ".env.vercel.local" });
  const { createGuardedTurso } = await import("./lib/turso-guard");

  const { remote } = await createGuardedTurso({
    name: "clean-titles",
    maxRuntimeMs: 10 * 60 * 1000,
    queryTimeoutMs: 30_000,
    longRunning: false,
  });

  let pushed = 0;
  const BATCH = 50;
  for (let i = 0; i < changes.length; i += BATCH) {
    const batch = changes.slice(i, i + BATCH);
    for (const c of batch) {
      await remote.execute({
        sql: "UPDATE books SET title = ?, updated_at = datetime('now') WHERE id = ?",
        args: [c.newTitle, c.id],
      });
      pushed++;
    }
    console.log(`  Pushed ${pushed}/${changes.length} to Turso...`);
  }

  console.log(`\nPushed ${pushed} title changes to Turso.`);
  process.exit(0);
})();
