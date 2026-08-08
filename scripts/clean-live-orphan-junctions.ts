/**
 * clean-live-orphan-junctions.ts — delete junction rows on Turso whose book_id
 * no longer exists in live `books`.
 *
 * WHY
 * ---
 * sync-push has a local hygiene pre-pass that deletes orphaned junction rows
 * LOCALLY, but nothing ever cleaned the live side. So every night:
 *
 *   pull  → live orphans copy down into local (local FK is not enforced here)
 *   push  → hygiene deletes the local copies
 *   pull  → the live originals copy down again …
 *
 * ~1,100 rows of pure churn per night, and it also inflated the "orphaned rows
 * removed" line in every push log, which is what made the real 4,030-row
 * duplicate-book problem look routine.
 *
 * These rows are unreachable by the app — the book they describe is gone — so
 * removing them loses nothing. Books, authors, genres and series are NOT
 * touched; only the junction rows whose parent book is missing.
 *
 * Usage:
 *   npx tsx scripts/clean-live-orphan-junctions.ts            # report only
 *   npx tsx scripts/clean-live-orphan-junctions.ts --apply
 */
import { config } from 'dotenv';
config({ path: '.env.vercel.local' });

import { createGuardedTurso } from './lib/turso-guard';

const APPLY = process.argv.includes('--apply');
const ALL_TABLES = ['book_authors', 'book_genres', 'book_series', 'book_category_ratings', 'enrichment_log'];
const CHUNK = 200;

// `--tables=a,b` restricts the run. The default is a REPORT over everything;
// applying to book_category_ratings (~11k orphans) or enrichment_log (~1.1k)
// crosses the "confirm before deleting 1,000+ rows" bar in CLAUDE.md and needs
// Rebekah's explicit go-ahead. The three junction tables are what actually
// churn nightly and are each a couple hundred rows.
const only = process.argv.find((a) => a.startsWith('--tables='))?.split('=')[1];
const TABLES = only ? only.split(',').map((s) => s.trim()) : ALL_TABLES;

async function main() {
  const { remote } = await createGuardedTurso({
    name: 'clean-live-orphan-junctions',
    maxRuntimeMs: 30 * 60 * 1000,
    queryTimeoutMs: 30_000,
    longRunning: false,
  });

  let grandTotal = 0;

  for (const t of TABLES) {
    const ids = (
      await remote.execute(
        `SELECT j.rowid AS rid FROM ${t} j
          LEFT JOIN books b ON b.id = j.book_id
          WHERE b.id IS NULL`,
      )
    ).rows.map((r: any) => Number(r.rid));

    if (ids.length === 0) { console.log(`  · ${t.padEnd(24)} clean`); continue; }
    grandTotal += ids.length;

    if (!APPLY) { console.log(`  ⚠ ${t.padEnd(24)} ${ids.length} orphaned rows (dry run)`); continue; }

    // Chunked so no single DELETE gets large or long-running. Deleting by rowid
    // keeps each statement an index lookup rather than a re-scan of the join.
    let deleted = 0;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const batch = ids.slice(i, i + CHUNK);
      const r = await remote.execute({
        sql: `DELETE FROM ${t} WHERE rowid IN (${batch.map(() => '?').join(',')})`,
        args: batch,
      });
      deleted += Number(r.rowsAffected ?? 0);
    }

    const left = Number(
      (
        await remote.execute(
          `SELECT COUNT(*) n FROM ${t} j LEFT JOIN books b ON b.id = j.book_id WHERE b.id IS NULL`,
        )
      ).rows[0].n,
    );
    console.log(`  ✓ ${t.padEnd(24)} deleted ${deleted}, ${left} remaining`);
  }

  console.log(
    APPLY ? `\n[clean] done — ${grandTotal} orphaned rows removed from live`
          : `\n[clean] dry run — ${grandTotal} orphaned rows found. Re-run with --apply.`,
  );
  process.exit(0);
}

main();
