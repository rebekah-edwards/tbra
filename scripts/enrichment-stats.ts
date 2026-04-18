require('dotenv').config({ path: '.env.vercel.local' });
const { createClient } = require('@libsql/client');

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function main() {
  const total = await client.execute('SELECT count(*) as n FROM books');
  const noCover = await client.execute(`SELECT count(*) as n FROM books WHERE cover_image_url IS NULL OR cover_image_url = ''`);
  const noDesc = await client.execute(`SELECT count(*) as n FROM books WHERE description IS NULL OR description = ''`);
  const noYear = await client.execute(`SELECT count(*) as n FROM books WHERE publication_year IS NULL`);
  const noPages = await client.execute(`SELECT count(*) as n FROM books WHERE pages IS NULL OR pages = 0`);
  const noIsbn = await client.execute(`SELECT count(*) as n FROM books WHERE (isbn_10 IS NULL OR isbn_10 = '') AND (isbn_13 IS NULL OR isbn_13 = '')`);
  const noSummary = await client.execute(`SELECT count(*) as n FROM books WHERE summary IS NULL OR summary = ''`);
  const noRatings = await client.execute(`SELECT count(*) as n FROM books WHERE id NOT IN (SELECT DISTINCT book_id FROM book_category_ratings)`);

  // Any journals?
  let journalCount = 0;
  let journalWithUsers = 0;
  try {
    const j = await client.execute(`SELECT count(*) as n FROM books WHERE lower(title) LIKE '%journal%' OR lower(title) LIKE '%notebook%' OR lower(title) LIKE '%planner%'`);
    journalCount = Number(j.rows[0].n);
    const ju = await client.execute(`SELECT count(DISTINCT b.id) as n FROM books b JOIN user_book_state s ON s.book_id = b.id WHERE lower(b.title) LIKE '%journal%' OR lower(b.title) LIKE '%notebook%' OR lower(b.title) LIKE '%planner%'`);
    journalWithUsers = Number(ju.rows[0].n);
  } catch (e) { }

  const fmt = (r: any) => Number(r.rows[0].n).toLocaleString();
  const pct = (r: any, t: any) => ((Number(r.rows[0].n) / Number(t.rows[0].n)) * 100).toFixed(1);

  console.log('=== Turso catalog stats ===');
  console.log(`Total books:          ${fmt(total)}`);
  console.log(`Missing cover:        ${fmt(noCover)} (${pct(noCover, total)}%)`);
  console.log(`Missing description:  ${fmt(noDesc)} (${pct(noDesc, total)}%)`);
  console.log(`Missing pub year:     ${fmt(noYear)} (${pct(noYear, total)}%)`);
  console.log(`Missing page count:   ${fmt(noPages)} (${pct(noPages, total)}%)`);
  console.log(`Missing ISBN:         ${fmt(noIsbn)} (${pct(noIsbn, total)}%)`);
  console.log(`Missing AI summary:   ${fmt(noSummary)} (${pct(noSummary, total)}%)`);
  console.log(`No content ratings:   ${fmt(noRatings)} (${pct(noRatings, total)}%)`);
  console.log('');
  console.log('=== Journals / notebooks / planners ===');
  console.log(`Total matching:       ${journalCount.toLocaleString()}`);
  console.log(`With users attached:  ${journalWithUsers.toLocaleString()}`);
  console.log(`Safely deletable:     ${(journalCount - journalWithUsers).toLocaleString()}`);

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
