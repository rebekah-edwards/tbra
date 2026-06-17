import * as dotenv from "dotenv";
dotenv.config({ path: ".env.vercel.local" });

import { createGuardedTurso } from "./lib/turso-guard";

const PATTERNS = [
  `(lower(title) LIKE '%prayer journal%' OR lower(title) LIKE '%devotional journal%' OR lower(title) LIKE '%devotional%planner%' OR lower(title) LIKE '%scripture journal%' OR lower(title) LIKE '%bible journal%' OR lower(title) LIKE '%gratitude journal%')`,
  `(lower(title) LIKE '%study guide%' OR lower(title) LIKE '%summary and analysis%' OR lower(title) LIKE '%summary & analysis%' OR lower(title) LIKE 'summary of %' OR lower(title) LIKE '%sparknotes%' OR lower(title) LIKE '%cliffsnotes%' OR lower(title) LIKE '%cliff notes%' OR lower(title) LIKE '%in 30 minutes%' OR lower(title) LIKE '%: a summary%' OR lower(title) LIKE '%book summary%')`,
  `(lower(title) LIKE '%workbook%' OR lower(title) LIKE '%activity book%' OR lower(title) LIKE '%coloring book%' OR lower(title) LIKE '%colouring book%' OR lower(title) LIKE '%sticker book%' OR lower(title) LIKE '%puzzle book%')`,
  `(lower(title) LIKE '%planner%' AND lower(title) NOT LIKE '%the planner%novel%')`,
  `(lower(title) LIKE '%journal%' OR lower(title) LIKE '%notebook%' OR lower(title) LIKE '%diary%')`,
  `(lower(title) LIKE '%companion guide%' OR lower(title) LIKE '%official companion%' OR lower(title) LIKE '%unofficial guide%' OR lower(title) LIKE '%unauthorized%')`,
];

const FK_TABLES = [
  'book_authors', 'book_genres', 'book_series', 'book_category_ratings', 'book_narrators',
  'links', 'report_corrections', 'editions', 'user_owned_editions', 'enrichment_log',
  'reported_issues', 'user_hidden_books', 'reading_notes', 'up_next', 'user_favorite_books',
  'user_book_reviews', 'user_book_ratings', 'reading_sessions', 'user_book_state',
];

(async () => {
  const { remote: c } = await createGuardedTurso({
    name: 'delete-journal-sweep',
    maxRuntimeMs: 30 * 60 * 1000,
    queryTimeoutMs: 30_000,
  });

  const where = PATTERNS.map((p) => `(${p})`).join(' OR ');
  const r = await c.execute(`
    SELECT b.id, b.title,
      (SELECT count(*) FROM user_book_state WHERE book_id = b.id) as users
    FROM books b
    WHERE ${where}
  `);

  const all = r.rows as any[];
  const toDelete = all.filter((x: any) => Number(x.users) === 0);
  const kept = all.filter((x: any) => Number(x.users) > 0);

  console.log(`Matched: ${all.length}`);
  console.log(`Keeping (has users): ${kept.length}`);
  kept.forEach((k: any) => console.log(`  KEEP: ${k.title}`));
  console.log(`Deleting: ${toDelete.length}`);

  let deleted = 0;
  let errors = 0;
  for (const b of toDelete) {
    try {
      for (const tbl of FK_TABLES) {
        await c.execute({ sql: `DELETE FROM ${tbl} WHERE book_id = ?`, args: [b.id] });
      }
      await c.execute({ sql: `DELETE FROM books WHERE id = ?`, args: [b.id] });
      deleted++;
      if (deleted % 25 === 0) console.log(`  Progress: ${deleted}/${toDelete.length}`);
    } catch (e: any) {
      errors++;
      console.log(`  ERR deleting ${b.title}: ${e.message}`);
    }
  }

  console.log(`\nDone. Deleted ${deleted}, errors ${errors}.`);

  const total = await c.execute('SELECT count(*) as n FROM books');
  console.log(`Total books now: ${Number((total.rows[0] as any).n).toLocaleString()}`);
  process.exit(0);
})();
