/**
 * assign-franchises.ts — One-time script to assign known franchises
 *
 * Identifies large series that are actually franchises and assigns
 * child series to them based on name prefix matching.
 *
 * Usage: npx tsx scripts/assign-franchises.ts [--dry-run]
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "data", "tbra.db");
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

const dryRun = process.argv.includes("--dry-run");

// Known franchises and their name patterns for matching child series
const FRANCHISE_PATTERNS: { franchiseName: string; patterns: string[] }[] = [
  { franchiseName: "Batman", patterns: ["Batman"] },
  { franchiseName: "Superman", patterns: ["Superman"] },
  { franchiseName: "Spider-Man", patterns: ["Spider-Man", "Amazing Spider-Man", "Spider-Verse"] },
  { franchiseName: "X-Men", patterns: ["X-Men", "Uncanny X-Men", "All New X-Men", "New X-Men"] },
  { franchiseName: "Avengers", patterns: ["Avengers", "New Avengers"] },
  { franchiseName: "Star Wars", patterns: ["Star Wars"] },
  { franchiseName: "Daredevil", patterns: ["Daredevil"] },
  { franchiseName: "Deadpool", patterns: ["Deadpool"] },
  { franchiseName: "Teenage Mutant Ninja Turtles", patterns: ["Teenage Mutant Ninja Turtles", "TMNT"] },
];

for (const franchise of FRANCHISE_PATTERNS) {
  // Find or identify the franchise parent series
  // Look for exact name match first, then the one with most books
  let parentRow = db.prepare(
    "SELECT id, name FROM series WHERE name = ? AND parent_series_id IS NULL"
  ).get(franchise.franchiseName) as any;

  if (!parentRow) {
    // No exact match — find the series with this name that has the most books
    parentRow = db.prepare(`
      SELECT s.id, s.name, COUNT(bs.book_id) as cnt FROM series s
      LEFT JOIN book_series bs ON bs.series_id = s.id
      WHERE s.name LIKE ? AND s.parent_series_id IS NULL
      GROUP BY s.id
      ORDER BY cnt DESC
      LIMIT 1
    `).get(franchise.franchiseName + "%") as any;
  }

  if (!parentRow) {
    console.log(`No franchise series found for: ${franchise.franchiseName}`);
    continue;
  }

  console.log(`\nFranchise: ${parentRow.name} (${parentRow.id})`);

  // Find child series matching any pattern
  const children: any[] = [];
  for (const pattern of franchise.patterns) {
    const matches = db.prepare(`
      SELECT s.id, s.name, COUNT(bs.book_id) as books FROM series s
      LEFT JOIN book_series bs ON bs.series_id = s.id
      WHERE s.name LIKE ? AND s.id != ? AND s.parent_series_id IS NULL
      GROUP BY s.id
      ORDER BY s.name
    `).all(`${pattern}%`, parentRow.id) as any[];

    for (const match of matches) {
      if (!children.some((c) => c.id === match.id)) {
        children.push(match);
      }
    }
  }

  if (children.length === 0) {
    console.log("  No child series found");
    continue;
  }

  for (const child of children) {
    console.log(`  ${dryRun ? "[DRY RUN] " : ""}→ ${child.name} (${child.books} books)`);
    if (!dryRun) {
      db.prepare("UPDATE series SET parent_series_id = ? WHERE id = ?").run(parentRow.id, child.id);
    }
  }
}

if (!dryRun) {
  console.log("\nDone! Franchise assignments saved.");
} else {
  console.log("\nDry run complete — no changes made.");
}
