import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env.vercel.local' });
import { createClient } from '@libsql/client';

async function main() {
  const c = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN! });
  const q = (sql: string, args: any[] = []) => c.execute({ sql, args });

  for (const slug of ["shackleford-sisters","legend-marie-lu","zodiac-academy","divergent-veronica-roth","side-step-trilogy"]) {
    const r = await q(`SELECT id, name, slug FROM series WHERE slug = ?`, [slug]);
    console.log(`\n${slug}: ${r.rows.length > 0 ? `FOUND "${r.rows[0].name}" (${r.rows[0].id})` : "NOT FOUND by slug"}`);
    if (r.rows.length === 0) {
      const fuzzy = await q(`SELECT id, name, slug FROM series WHERE LOWER(name) LIKE ? LIMIT 5`, [`%${slug.split("-")[0]}%`]);
      console.log(`  fuzzy matches on "${slug.split("-")[0]}":`);
      for (const x of fuzzy.rows) console.log(`    ${x.slug} — "${x.name}" (${x.id})`);
    } else {
      const books = await q(`
        SELECT b.title, b.slug, bs.position_in_series, b.is_box_set, b.publication_year,
          (SELECT a.name FROM authors a JOIN book_authors ba ON ba.author_id = a.id WHERE ba.book_id = b.id LIMIT 1) as author,
          (SELECT count(*) FROM user_book_state WHERE book_id = b.id) as users
        FROM book_series bs JOIN books b ON b.id = bs.book_id
        WHERE bs.series_id = ? ORDER BY bs.position_in_series NULLS LAST, b.publication_year`, [r.rows[0].id]);
      console.log(`  ${books.rows.length} books:`);
      for (const b of books.rows) console.log(`    [${b.position_in_series ?? "?"}] "${b.title}" (${b.author}, ${b.publication_year ?? "?"}) ${b.is_box_set ? "BOX" : ""} ${b.users}u`);
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
