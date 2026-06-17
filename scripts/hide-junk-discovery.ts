/**
 * Hide the OpenLibrary discovery flood from the public catalog.
 *
 * Targets ONLY books that are:
 *   - visibility='public'
 *   - un-enriched (no book_category_ratings)
 *   - NOT on any user's shelf (zero demand)
 *   - AND classified as unwanted: non-English / junk-or-box-set / bare skeleton,
 *     OR an exact-title duplicate of an already-enriched book.
 *
 * Sets visibility='hidden'. We HIDE rather than delete so the OpenLibrary-key
 * row survives — nightly-import.ts dedups on open_library_key, so a hidden row
 * blocks the same work from being re-imported tomorrow. (Deleting would let it
 * flood right back in.)
 *
 * Default is DRY RUN. Pass --apply to write. Local DB only; a companion guarded
 * script pushes the visibility change to Turso (sync-push never touches it).
 *
 * Usage:
 *   npx tsx scripts/hide-junk-discovery.ts            # dry run
 *   npx tsx scripts/hide-junk-discovery.ts --apply    # apply locally
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import Database from "better-sqlite3";
import path from "path";
import { classifyBook } from "../src/lib/enrichment/enrichable";

const APPLY = process.argv.includes("--apply");
const DB_PATH = path.join(process.cwd(), "data", "tbra.db");
const db = new Database(DB_PATH);

function normTitle(t: string): string {
  return t.toLowerCase().trim().replace(/\s+/g, " ");
}

// Titles of already-enriched books → any un-enriched public book that exactly
// matches one is a duplicate we should hide, not re-enrich.
const enrichedTitles = new Set<string>(
  (db.prepare(`
    SELECT DISTINCT lower(trim(b.title)) AS t
    FROM books b
    WHERE b.id IN (SELECT DISTINCT book_id FROM book_category_ratings)
  `).all() as { t: string }[]).map((r) => normTitle(r.t)),
);

// Books on any shelf are protected — never auto-hide demand.
const shelved = new Set<string>(
  (db.prepare(`SELECT DISTINCT book_id AS id FROM user_book_state`).all() as { id: string }[]).map((r) => r.id),
);

const candidates = db.prepare(`
  SELECT b.id, b.title, b.isbn_13 AS isbn13, b.isbn_10 AS isbn10, b.asin,
         b.description, b.summary, b.publication_year AS publicationYear,
         b.language, b.is_box_set AS isBoxSet
  FROM books b
  WHERE b.visibility = 'public'
  AND b.id NOT IN (SELECT DISTINCT book_id FROM book_category_ratings)
`).all() as any[];

const toHide: { id: string; title: string; reason: string }[] = [];
const counts: Record<string, number> = {};
let keptReal = 0;
let protectedShelf = 0;

for (const b of candidates) {
  if (shelved.has(b.id)) { protectedShelf++; continue; }

  const c = classifyBook({
    title: b.title,
    isbn13: b.isbn13, isbn10: b.isbn10, asin: b.asin,
    description: b.description, summary: b.summary,
    publicationYear: b.publicationYear, language: b.language,
    isBoxSet: !!b.isBoxSet,
  });

  const isDup = enrichedTitles.has(normTitle(b.title));
  let reason: string | null = null;
  if (c.nonEnglish) reason = "non-english";
  else if (c.junkOrBoxSet) reason = "junk/box-set";
  else if (isDup) reason = "duplicate-of-enriched";
  else if (c.skeleton) reason = "skeleton";

  if (reason) {
    toHide.push({ id: b.id, title: b.title, reason });
    counts[reason] = (counts[reason] ?? 0) + 1;
  } else {
    keptReal++;
  }
}

console.log(`\n=== hide-junk-discovery (${APPLY ? "APPLY" : "DRY RUN"}) ===`);
console.log(`Candidate pool (public, un-enriched): ${candidates.length}`);
console.log(`Protected (on a shelf): ${protectedShelf}`);
console.log(`Would KEEP as real/enrichable: ${keptReal}`);
console.log(`Would HIDE: ${toHide.length}`);
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log(`   ${k.padEnd(24)} ${v}`);
}

console.log(`\n--- sample KEPT (these stay public, will be enriched later) ---`);
const kept = candidates.filter((b) => !shelved.has(b.id) && !toHide.find((h) => h.id === b.id)).slice(0, 20);
for (const b of kept) console.log(`   ${JSON.stringify(b.title).slice(0, 60)}  isbn:${b.isbn13 || "-"} yr:${b.publicationYear || "-"}`);

console.log(`\n--- sample HIDE ---`);
for (const h of toHide.slice(0, 20)) console.log(`   [${h.reason}] ${JSON.stringify(h.title).slice(0, 60)}`);

if (APPLY && toHide.length > 0) {
  const upd = db.prepare(`UPDATE books SET visibility='hidden', updated_at=datetime('now') WHERE id=?`);
  const tx = db.transaction((rows: { id: string }[]) => {
    for (const r of rows) upd.run(r.id);
  });
  tx(toHide);
  console.log(`\n✓ Applied: set visibility='hidden' on ${toHide.length} books (local).`);
  // Persist the hidden id list so the Turso push knows exactly what to mirror.
  const fs = require("fs");
  const outPath = path.join(process.cwd(), "data", "hidden-discovery-ids.json");
  fs.writeFileSync(outPath, JSON.stringify(toHide.map((h) => h.id), null, 2));
  console.log(`✓ Wrote ${toHide.length} ids → ${outPath} (for Turso push).`);
} else if (!APPLY) {
  console.log(`\n(dry run — re-run with --apply to write)`);
}

db.close();
