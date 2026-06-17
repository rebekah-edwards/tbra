/**
 * Fix the two classes of shelf books broken by the Brave outage:
 *
 *   Group A — import_only books on a user's shelf with NO ratings. These were
 *     added via Search but the public backfill (visibility='public' only) never
 *     touched them. We enrich them and promote to public.
 *
 *   Group B — shelf books whose ratings were written during the June Brave
 *     outage (since 2026-06-01) and have a thin/missing description. We re-enrich
 *     so their ratings + description get real Brave web research.
 *
 * Each book is gated through the classifier — junk/box-set/non-English titles
 * are never enriched (no wasted Brave calls). Group A titles that duplicate an
 * already-enriched public book are skipped + flagged for manual merge.
 *
 * Calls enrichBook() directly (no dev server) with skipBrave:false and
 * skipAuthorDiscovery:true (so we fix these books without re-importing authors'
 * backlists). Bounded by the Brave budget guard in braveSearch.
 *
 * Usage: npx tsx scripts/fix-shelf-enrichment.ts [--dry-run]
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import * as fs from "fs";
import * as path from "path";
import { db } from "../src/db";
import { books } from "../src/db/schema";
import { eq, sql } from "drizzle-orm";
import { enrichBook } from "../src/lib/enrichment/enrich-book";
import { classifyBook } from "../src/lib/enrichment/enrichable";

const DRY = process.argv.includes("--dry-run");

type Row = {
  id: string; title: string; isbn13: string | null; isbn10: string | null;
  asin: string | null; description: string | null; summary: string | null;
  pubyear: number | null; language: string | null; boxset: number | null;
};

function norm(t: string) { return t.toLowerCase().trim().replace(/\s+/g, " "); }

(async () => {
  const groupA = await db.all(sql`
    SELECT DISTINCT b.id, b.title, b.isbn_13 AS isbn13, b.isbn_10 AS isbn10, b.asin,
      b.description, b.summary, b.publication_year AS pubyear, b.language, b.is_box_set AS boxset
    FROM books b JOIN user_book_state ubs ON ubs.book_id = b.id
    WHERE b.visibility = 'import_only'
      AND b.id NOT IN (SELECT DISTINCT book_id FROM book_category_ratings)
  `) as Row[];

  const groupB = await db.all(sql`
    SELECT DISTINCT b.id, b.title, b.isbn_13 AS isbn13, b.isbn_10 AS isbn10, b.asin,
      b.description, b.summary, b.publication_year AS pubyear, b.language, b.is_box_set AS boxset
    FROM books b JOIN book_category_ratings bcr ON bcr.book_id = b.id
    WHERE b.id IN (SELECT DISTINCT book_id FROM user_book_state)
      AND bcr.updated_at >= '2026-06-01'
      AND (b.description IS NULL OR length(b.description) < 120)
  `) as Row[];

  // Public enriched titles → for group-A duplicate detection.
  const enrichedPublicTitles = new Set<string>(
    (await db.all(sql`
      SELECT DISTINCT lower(trim(b.title)) AS t FROM books b
      WHERE b.visibility = 'public' AND b.id IN (SELECT DISTINCT book_id FROM book_category_ratings)
    `) as { t: string }[]).map((r) => norm(r.t)),
  );

  console.log(`Group A (import_only shelf, no ratings): ${groupA.length}`);
  console.log(`Group B (thin-desc shelf, outage-era ratings): ${groupB.length}`);

  const processed: string[] = [];
  const promoted: string[] = [];
  const skipped: { title: string; reason: string }[] = [];
  let ok = 0, fail = 0;

  async function handle(row: Row, group: "A" | "B") {
    // Deliberately ignore the `language` DB column here: it's unreliable for
    // user-shelved books (real English titles tagged "non-English"/"Japanese"
    // from the original work's record). The title script heuristic still catches
    // genuinely non-English titles (e.g. CJK/Hebrew), which is what we want.
    const c = classifyBook({
      title: row.title, isbn13: row.isbn13, isbn10: row.isbn10, asin: row.asin,
      description: row.description, summary: row.summary, publicationYear: row.pubyear,
      language: null, isBoxSet: !!row.boxset,
    });
    if (c.clearlyUnwanted) { skipped.push({ title: row.title, reason: c.reason }); return; }
    if (group === "A" && enrichedPublicTitles.has(norm(row.title))) {
      skipped.push({ title: row.title, reason: "duplicate-of-enriched (needs merge, not enrich)" }); return;
    }
    if (DRY) { console.log(`  [dry] would enrich (${group}): ${row.title}`); processed.push(row.id); return; }

    try {
      await enrichBook(row.id, { skipBrave: false, skipAuthorDiscovery: true });
      if (group === "A") {
        await db.update(books).set({ visibility: "public", updatedAt: sql`datetime('now')` }).where(eq(books.id, row.id));
        promoted.push(row.id);
      }
      processed.push(row.id);
      ok++;
      console.log(`  ✓ (${group}) ${row.title}`);
    } catch (err) {
      const code = (err as Error & { code?: string }).code;
      const msg = err instanceof Error ? err.message : String(err);
      if (code === "API_EXHAUSTED") {
        console.error(`  ⛔ Brave budget/exhaustion hit at "${row.title}" — stopping. (${msg})`);
        throw err;
      }
      fail++;
      console.error(`  ✗ (${group}) ${row.title}: ${msg}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  try {
    for (const row of groupA) await handle(row, "A");
    for (const row of groupB) await handle(row, "B");
  } catch { /* API_EXHAUSTED — stop early, report what we did */ }

  console.log(`\n=== shelf-fix ${DRY ? "(DRY RUN)" : "done"} ===`);
  console.log(`Enriched OK: ${ok}  Failed: ${fail}  Promoted A→public: ${promoted.length}  Skipped: ${skipped.length}`);
  if (skipped.length) {
    console.log(`Skipped detail:`);
    for (const s of skipped) console.log(`   [${s.reason}] ${s.title}`);
  }

  if (!DRY && processed.length) {
    const outPath = path.join(process.cwd(), "data", "shelf-fix-ids.json");
    fs.writeFileSync(outPath, JSON.stringify(processed, null, 2));
    console.log(`\n✓ Wrote ${processed.length} processed ids → ${outPath} (for Turso push).`);
  }
  process.exit(0);
})();
