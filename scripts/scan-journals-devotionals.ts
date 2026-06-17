require('dotenv').config({ path: '.env.vercel.local' });
const { createClient } = require('@libsql/client');
const fs = require('fs');
const c = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

// Broader, categorized — each pattern gets evaluated independently
const PATTERNS: Array<{ label: string; sql: string }> = [
  { label: 'Prayer journals / devotionals (by title)', sql: `(lower(title) LIKE '%prayer journal%' OR lower(title) LIKE '%devotional journal%' OR lower(title) LIKE '%devotional%planner%' OR lower(title) LIKE '%scripture journal%' OR lower(title) LIKE '%bible journal%' OR lower(title) LIKE '%gratitude journal%')` },
  { label: 'Study guides / summaries / analysis', sql: `(lower(title) LIKE '%study guide%' OR lower(title) LIKE '%summary and analysis%' OR lower(title) LIKE '%summary & analysis%' OR lower(title) LIKE 'summary of %' OR lower(title) LIKE '%sparknotes%' OR lower(title) LIKE '%cliffsnotes%' OR lower(title) LIKE '%cliff notes%' OR lower(title) LIKE '%in 30 minutes%' OR lower(title) LIKE '%: a summary%' OR lower(title) LIKE '%book summary%')` },
  { label: 'Workbooks / activity books / coloring books', sql: `(lower(title) LIKE '%workbook%' OR lower(title) LIKE '%activity book%' OR lower(title) LIKE '%coloring book%' OR lower(title) LIKE '%colouring book%' OR lower(title) LIKE '%sticker book%' OR lower(title) LIKE '%puzzle book%')` },
  { label: 'Planners', sql: `(lower(title) LIKE '%planner%' AND lower(title) NOT LIKE '%the planner%novel%')` },
  { label: 'Generic journals / notebooks / diaries (title-match)', sql: `(lower(title) LIKE '%journal%' OR lower(title) LIKE '%notebook%' OR lower(title) LIKE '%diary%')` },
  { label: 'Companion / tie-in products', sql: `(lower(title) LIKE '%companion guide%' OR lower(title) LIKE '%official companion%' OR lower(title) LIKE '%unofficial guide%' OR lower(title) LIKE '%unauthorized%')` },
];

(async () => {
  const seen = new Set<string>();
  const buckets: Array<{ label: string; books: any[] }> = [];

  for (const p of PATTERNS) {
    const r = await c.execute(`
      SELECT b.id, b.title, b.publication_year, b.is_box_set, b.visibility,
        (SELECT group_concat(a.name, ', ') FROM book_authors ba JOIN authors a ON a.id = ba.author_id WHERE ba.book_id = b.id) as authors,
        (SELECT count(*) FROM user_book_state WHERE book_id = b.id) as users,
        (SELECT count(*) FROM book_series WHERE book_id = b.id) as series_links,
        (SELECT group_concat(s.name, '; ') FROM book_series bs JOIN series s ON s.id = bs.series_id WHERE bs.book_id = b.id) as series
      FROM books b
      WHERE ${p.sql}
      ORDER BY users DESC, b.title
    `);
    const fresh = r.rows.filter((b: any) => !seen.has(String(b.id)));
    fresh.forEach((b: any) => seen.add(String(b.id)));
    buckets.push({ label: p.label, books: fresh });
  }

  // Summary counts
  let totalAll = 0;
  let totalDeletable = 0;
  const out: string[] = [];
  out.push(`# Journal/Devotional/Guide Sweep — ${new Date().toISOString().slice(0,10)}`);
  out.push('');
  out.push(`Each bucket is evaluated in order; books already matched by an earlier bucket are NOT repeated below.`);
  out.push(`"users" = number of user_book_state rows. "series" = series the book is already linked to.`);
  out.push('');

  for (const b of buckets) {
    const withUsers = b.books.filter((x: any) => Number(x.users) > 0);
    const noUsers = b.books.filter((x: any) => Number(x.users) === 0);
    totalAll += b.books.length;
    totalDeletable += noUsers.length;
    out.push(`## ${b.label} — ${b.books.length} total (${noUsers.length} deletable, ${withUsers.length} have users)`);
    out.push('');
    if (b.books.length === 0) { out.push('_(none)_'); out.push(''); continue; }

    if (withUsers.length > 0) {
      out.push(`### Has users (KEEP unless confirmed junk)`);
      withUsers.forEach((r: any) => {
        out.push(`- **${r.title}** — ${r.authors || '(no author)'} (${r.publication_year || '?'}) — users=${r.users}, series=${r.series || '-'}`);
      });
      out.push('');
    }
    if (noUsers.length > 0) {
      out.push(`### No users (candidate for deletion)`);
      noUsers.forEach((r: any) => {
        out.push(`- ${r.title} — ${r.authors || '(no author)'} (${r.publication_year || '?'})${r.series ? ` [series: ${r.series}]` : ''}`);
      });
      out.push('');
    }
  }

  out.unshift('');
  out.unshift(`**Totals: ${totalAll} matched. ${totalDeletable} have no users and are candidates for deletion. ${totalAll - totalDeletable} have user activity.**`);
  out.unshift('');

  const outPath = 'reports/journal-devotional-sweep.md';
  fs.writeFileSync(outPath, out.join('\n'));
  console.log(`Wrote ${outPath}`);
  console.log(`Totals: ${totalAll} matched. ${totalDeletable} deletable, ${totalAll - totalDeletable} have users.`);
})();
