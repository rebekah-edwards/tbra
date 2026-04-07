/**
 * Backfill slugs for all authors that don't have one.
 *
 * Without a slug, author page URLs fall back to UUIDs which leak into
 * GSC and look unprofessional. This script generates a slug for each
 * author, handling collisions by appending -2, -3, etc.
 *
 * Usage: npx tsx scripts/backfill-author-slugs.ts
 */

import Database from "better-sqlite3";
import path from "path";

const dbPath = path.join(process.cwd(), "data", "tbra.db");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

function normalize(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\s/g, "-");
}

function main() {
  // Load existing slugs into a Set for collision detection
  const existing = db
    .prepare("SELECT slug FROM authors WHERE slug IS NOT NULL AND slug != ''")
    .all() as { slug: string }[];
  const usedSlugs = new Set(existing.map((r) => r.slug));
  console.log(`${usedSlugs.size} authors already have slugs`);

  // Authors missing a slug
  const missing = db
    .prepare("SELECT id, name FROM authors WHERE slug IS NULL OR slug = '' ORDER BY name")
    .all() as { id: string; name: string }[];
  console.log(`${missing.length} authors need slugs\n`);

  const updateStmt = db.prepare("UPDATE authors SET slug = ? WHERE id = ?");

  let assigned = 0;
  let skipped = 0;

  for (const author of missing) {
    const base = normalize(author.name);
    if (!base) {
      skipped++;
      continue;
    }

    let slug = base;
    let suffix = 2;
    while (usedSlugs.has(slug)) {
      slug = `${base}-${suffix}`;
      suffix++;
    }

    updateStmt.run(slug, author.id);
    usedSlugs.add(slug);
    assigned++;

    if (assigned % 500 === 0) process.stdout.write(`  Assigned: ${assigned}\r`);
  }

  console.log(`\nDone. Assigned ${assigned.toLocaleString()} slugs (skipped ${skipped} blank names).`);
  db.close();
}

main();
