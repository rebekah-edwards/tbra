import { createClient } from '@libsql/client';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.join(process.cwd(), '.env.vercel.local') });

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

async function getBookUserCount(bookId: string): Promise<number> {
  const r = await client.execute({
    sql: `SELECT COUNT(*) as cnt FROM user_book_state WHERE book_id = ?`,
    args: [bookId],
  });
  return Number(r.rows[0].cnt);
}

async function deleteBook(bookId: string): Promise<void> {
  const tables = [
    'book_authors', 'book_genres', 'book_series', 'book_category_ratings',
    'book_narrators', 'links', 'report_corrections', 'editions',
    'user_owned_editions', 'enrichment_log', 'reported_issues',
    'user_hidden_books', 'reading_notes', 'up_next', 'user_favorite_books',
    'user_book_reviews', 'user_book_ratings', 'reading_sessions',
    'user_book_state',
  ];
  for (const table of tables) {
    await client.execute({ sql: `DELETE FROM ${table} WHERE book_id = ?`, args: [bookId] });
  }
  await client.execute({ sql: `DELETE FROM books WHERE id = ?`, args: [bookId] });
}

async function resolveReport(reportId: string, resolution: string): Promise<void> {
  await client.execute({
    sql: `UPDATE reported_issues SET status = 'resolved', resolution = ?, resolved_at = datetime('now') WHERE id = ?`,
    args: [resolution, reportId],
  });
}

async function main() {
  const fixed: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  const reportsResult = await client.execute(`
    SELECT ri.id, ri.book_id, ri.description, ri.status, ri.created_at,
           b.title, b.publication_year, b.pages, b.description as book_description
    FROM reported_issues ri
    LEFT JOIN books b ON b.id = ri.book_id
    WHERE ri.status = 'new'
    ORDER BY ri.created_at ASC
  `);

  const reports = reportsResult.rows as unknown as Array<{
    id: string; book_id: string; description: string;
    status: string; created_at: string; title: string;
    publication_year: number; pages: number; book_description: string;
  }>;

  console.log(`Found ${reports.length} open reports`);

  for (const report of reports) {
    try {
      const userCount = report.book_id ? await getBookUserCount(report.book_id) : 0;
      const desc = (report.description || '').toLowerCase();
      const bookTitle = report.title || '(unknown)';
      let handled = false;

      console.log(`\nReport ${report.id}: book="${bookTitle}", users=${userCount}`);
      console.log(`  Description: ${report.description?.slice(0, 120)}`);

      // Junk/duplicate/non-English with 0 users — delete
      if (userCount === 0 && (
        desc.includes('duplicate') ||
        desc.includes('junk') ||
        desc.includes('non-english') ||
        desc.includes('non english') ||
        desc.includes('wrong book') ||
        desc.includes('does not exist')
      )) {
        if (report.book_id) {
          await deleteBook(report.book_id);
          await resolveReport(report.id, `Auto-deleted: 0-user book reported as junk/duplicate/non-English`);
          fixed.push(`DELETED "${bookTitle}" (${report.book_id}) — matched junk/duplicate/non-English pattern`);
          console.log(`  → Deleted book`);
          handled = true;
        }
      }

      // Bad description: HTML entities or markup in book_description field
      if (!handled && (desc.includes('description') || desc.includes('html') || desc.includes('markup'))) {
        const bookDesc = report.book_description || '';
        const hasHtml = /<[^>]+>/.test(bookDesc) || /&amp;|&lt;|&gt;|&quot;|&#\d+;/.test(bookDesc);
        if (hasHtml) {
          const cleaned = bookDesc
            .replace(/<[^>]+>/g, ' ')
            .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
            .replace(/&[a-z]+;/g, '').replace(/&#\d+;/g, '')
            .replace(/\s+/g, ' ').trim();
          await client.execute({ sql: `UPDATE books SET description = ? WHERE id = ?`, args: [cleaned, report.book_id] });
          await resolveReport(report.id, 'Auto-fixed: stripped HTML from description');
          fixed.push(`CLEANED description for "${bookTitle}" (${report.book_id})`);
          console.log(`  → Cleaned HTML description`);
          handled = true;
        }
      }

      // Wrong year — extract from description
      if (!handled && (desc.includes('year') || desc.includes('published'))) {
        const m = report.description?.match(/\b(19|20)\d{2}\b/);
        if (m) {
          await client.execute({ sql: `UPDATE books SET publication_year = ? WHERE id = ?`, args: [parseInt(m[0]), report.book_id] });
          await resolveReport(report.id, `Auto-fixed: publication_year set to ${m[0]}`);
          fixed.push(`FIXED year for "${bookTitle}" → ${m[0]}`);
          console.log(`  → Fixed year to ${m[0]}`);
          handled = true;
        }
      }

      // Series order — extract position
      if (!handled && desc.includes('series') && (desc.includes('order') || desc.includes('position') || desc.includes('book '))) {
        const posMatch = report.description?.match(/book\s+(\d+(?:\.\d+)?)\s+(?:in|of)/i) ||
                         report.description?.match(/position[:\s]+(\d+(?:\.\d+)?)/i);
        if (posMatch && report.book_id) {
          await client.execute({
            sql: `UPDATE book_series SET position_in_series = ? WHERE book_id = ?`,
            args: [parseFloat(posMatch[1]), report.book_id],
          });
          await resolveReport(report.id, `Auto-fixed: series position set to ${posMatch[1]}`);
          fixed.push(`FIXED series position for "${bookTitle}" → ${posMatch[1]}`);
          console.log(`  → Fixed series position to ${posMatch[1]}`);
          handled = true;
        }
      }

      if (!handled) {
        skipped.push(`[${report.id}] "${bookTitle}" (${report.book_id}) — ${report.description?.slice(0, 120) || 'no description'}`);
        console.log(`  → Skipped (needs manual review)`);
      }

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Report ${report.id}: ${msg}`);
      console.error(`  → Error: ${msg}`);
    }
  }

  const date = new Date().toISOString().split('T')[0];
  const summaryDir = path.join(process.cwd(), 'reports');
  if (!fs.existsSync(summaryDir)) fs.mkdirSync(summaryDir, { recursive: true });

  const summary = `# Nightly Report Triage — ${date}

## Summary
- Total open reports: ${reports.length}
- Fixed: ${fixed.length}
- Skipped (needs manual review): ${skipped.length}
- Errors: ${errors.length}

## Fixed
${fixed.length === 0 ? '_None_' : fixed.map(l => `- ${l}`).join('\n')}

## Skipped (needs manual review)
${skipped.length === 0 ? '_None_' : skipped.map(l => `- ${l}`).join('\n')}

## Errors
${errors.length === 0 ? '_None_' : errors.map(l => `- ${l}`).join('\n')}
`;

  const summaryPath = path.join(summaryDir, `nightly-triage-${date}.md`);
  fs.writeFileSync(summaryPath, summary);
  console.log(`\n---\n${summary}`);
  console.log(`Summary written to ${summaryPath}`);
}

main().catch(console.error).finally(() => client.close());
