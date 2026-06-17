import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env.vercel.local' });
import { createClient } from '@libsql/client';

async function main() {
  const c = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN! });
  const q = (sql: string, args: any[] = []) => c.execute({ sql, args });
  const since = '2026-04-21 00:00:00';

  const triaged = await q(`SELECT count(*) c, resolution FROM reported_issues WHERE resolved_at >= ? GROUP BY resolution ORDER BY c DESC LIMIT 20`, [since]);
  console.log('=== Nightly report-triage (resolved ≥ 2026-04-21 00:00 UTC) ===');
  const total = (triaged.rows as any[]).reduce((a, r) => a + Number(r.c), 0);
  console.log(`Total: ${total}`);
  for (const r of triaged.rows as any[]) console.log(`  [${r.c}] ${(r.resolution as string || '').slice(0, 110)}`);

  const newReports = await q(`SELECT count(*) c FROM reported_issues WHERE created_at >= ? AND status='new'`, [since]);
  console.log(`New open reports since midnight: ${newReports.rows[0].c}`);

  const newBooks = await q(`SELECT count(*) c FROM books WHERE created_at >= ?`, [since]);
  console.log(`\n=== Nightly discovery ===`);
  console.log(`New books since midnight UTC: ${newBooks.rows[0].c}`);

  const cleared = await q(`SELECT count(*) c FROM books WHERE cover_source = 'isbndb-placeholder-cleared' AND updated_at >= ?`, [since]);
  console.log(`\n=== Nightly placeholder clear ===`);
  console.log(`Cleared last run: ${cleared.rows[0].c}`);

  const descRefresh = await q(`SELECT count(*) c FROM books WHERE description_stale = 0 AND updated_at >= ? AND description IS NOT NULL`, [since]);
  console.log(`\n=== Nightly description refresh ===`);
  console.log(`Refreshed descriptions: ${descRefresh.rows[0].c}`);

  const ratings = await q(`SELECT count(DISTINCT book_id) c FROM book_category_ratings WHERE updated_at >= ?`, [since]);
  console.log(`\n=== Nightly content ratings backfill ===`);
  console.log(`Books with content-rating updates: ${ratings.rows[0].c}`);

  const dupSlugs = await q(`
    WITH dup_slugs AS (
      SELECT slug, count(*) c FROM books WHERE slug IS NOT NULL AND slug != '' GROUP BY slug HAVING c > 1
    )
    SELECT count(*) as dupe_slug_count, IFNULL(SUM(c), 0) as total_books_involved FROM dup_slugs
  `);
  console.log(`\n=== Slug-collision state ===`);
  console.log(`Duplicate-slug groups remaining: ${dupSlugs.rows[0].dupe_slug_count} (${dupSlugs.rows[0].total_books_involved} books involved)`);

  const junkSwept = await q(`SELECT count(*) c FROM reported_issues WHERE created_at >= ? AND (description LIKE '%ancillary product pattern%' OR description LIKE '%probable box%')`, [since]);
  console.log(`\n=== Nightly junk sweep ===`);
  console.log(`New auto-flags created: ${junkSwept.rows[0].c}`);
}
main().catch(e => { console.error(e); process.exit(1); });
