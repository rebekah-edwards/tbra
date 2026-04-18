import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

// Load .env.vercel.local
const envPath = join(projectRoot, '.env.vercel.local');
const envContent = readFileSync(envPath, 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const match = line.match(/^([^=]+)="?([^"]*)"?$/);
  if (match) env[match[1]] = match[2];
}

const client = createClient({
  url: env.TURSO_DATABASE_URL,
  authToken: env.TURSO_AUTH_TOKEN,
});

async function fetchOpenReports() {
  const result = await client.execute(`
    SELECT r.*, b.title, b.author, b.year, b.slug,
      (SELECT COUNT(*) FROM user_book_state ubs WHERE ubs.book_id = r.book_id) as user_count
    FROM reported_issues r
    LEFT JOIN books b ON b.id = r.book_id
    WHERE r.status = 'new'
    ORDER BY r.created_at ASC
  `);
  return result.rows;
}

async function getBookDetails(bookId) {
  const result = await client.execute({
    sql: `SELECT b.*,
      (SELECT COUNT(*) FROM user_book_state ubs WHERE ubs.book_id = b.id) as user_count,
      (SELECT COUNT(*) FROM user_book_reviews ubr WHERE ubr.book_id = b.id) as review_count,
      (SELECT COUNT(*) FROM reading_sessions rs WHERE rs.book_id = b.id) as session_count
    FROM books b WHERE b.id = ?`,
    args: [bookId]
  });
  return result.rows[0];
}

async function deleteBook(bookId) {
  const tables = [
    'book_authors', 'book_genres', 'book_series', 'book_category_ratings',
    'book_narrators', 'links', 'report_corrections', 'editions',
    'user_owned_editions', 'enrichment_log', 'reported_issues',
    'user_hidden_books', 'reading_notes', 'up_next', 'user_favorite_books',
    'user_book_reviews', 'user_book_ratings', 'reading_sessions',
    'user_book_state'
  ];
  for (const table of tables) {
    await client.execute({ sql: `DELETE FROM ${table} WHERE book_id = ?`, args: [bookId] });
  }
  await client.execute({ sql: `DELETE FROM books WHERE id = ?`, args: [bookId] });
}

async function resolveReport(reportId, resolution) {
  await client.execute({
    sql: `UPDATE reported_issues SET status = 'resolved', resolution_note = ?, resolved_at = datetime('now') WHERE id = ?`,
    args: [resolution, reportId]
  });
}

async function fixBookField(bookId, field, value) {
  await client.execute({
    sql: `UPDATE books SET ${field} = ? WHERE id = ?`,
    args: [value, bookId]
  });
}

async function cleanDescription(bookId, rawDesc) {
  // Clean HTML entities and junk
  let cleaned = rawDesc
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, '') // strip HTML tags
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned !== rawDesc) {
    await fixBookField(bookId, 'description', cleaned);
    return cleaned;
  }
  return null;
}

function isNonEnglish(text) {
  if (!text) return false;
  // Check for non-Latin characters (CJK, Arabic, Cyrillic, etc.)
  const nonLatinPattern = /[\u0400-\u04FF\u0600-\u06FF\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF]/;
  return nonLatinPattern.test(text);
}

async function main() {
  const reports = await fetchOpenReports();
  console.log(`Found ${reports.length} open reports`);

  const fixed = [];
  const skipped = [];
  const needsReview = [];

  for (const report of reports) {
    const bookId = report.book_id;
    const reportId = report.id;
    const issueType = report.issue_type;
    const notes = report.notes || '';
    const correctedData = report.corrected_data ? JSON.parse(report.corrected_data) : null;

    console.log(`\nProcessing report ${reportId}: ${issueType} for book "${report.title}" (id: ${bookId})`);

    if (!bookId) {
      // No book associated - just close as invalid
      await resolveReport(reportId, 'No book associated with report - closed as invalid');
      fixed.push({ reportId, action: 'Closed invalid report (no book_id)', title: 'N/A' });
      continue;
    }

    const book = await getBookDetails(bookId);
    if (!book) {
      await resolveReport(reportId, 'Book no longer exists - closed');
      fixed.push({ reportId, action: 'Closed report (book deleted)', title: report.title });
      continue;
    }

    const userCount = parseInt(book.user_count || 0);
    const reviewCount = parseInt(book.review_count || 0);
    const sessionCount = parseInt(book.session_count || 0);

    // Handle by issue type
    if (issueType === 'duplicate' || issueType === 'junk') {
      if (userCount === 0 && reviewCount === 0 && sessionCount === 0) {
        await deleteBook(bookId);
        fixed.push({ reportId, action: `Deleted ${issueType} book`, title: report.title });
        console.log(`  -> DELETED: ${report.title}`);
      } else {
        needsReview.push({ reportId, issueType, title: report.title, userCount, notes: `Users: ${userCount}, Reviews: ${reviewCount}` });
        console.log(`  -> SKIP: has ${userCount} users`);
      }
    } else if (issueType === 'non_english' || (issueType === 'wrong_book' && isNonEnglish(book.title))) {
      if (userCount === 0 && reviewCount === 0 && sessionCount === 0) {
        await deleteBook(bookId);
        fixed.push({ reportId, action: 'Deleted non-English book', title: report.title });
        console.log(`  -> DELETED non-English: ${report.title}`);
      } else {
        needsReview.push({ reportId, issueType, title: report.title, userCount, notes: `Non-English with users: ${userCount}` });
      }
    } else if (issueType === 'wrong_metadata' || issueType === 'wrong_title' || issueType === 'wrong_year' || issueType === 'wrong_pages') {
      if (correctedData) {
        const updates = [];
        if (correctedData.title && correctedData.title !== book.title) {
          await fixBookField(bookId, 'title', correctedData.title);
          updates.push(`title: "${correctedData.title}"`);
        }
        if (correctedData.year && correctedData.year !== book.year) {
          await fixBookField(bookId, 'year', correctedData.year);
          updates.push(`year: ${correctedData.year}`);
        }
        if (correctedData.pages && correctedData.pages !== book.pages) {
          await fixBookField(bookId, 'pages', correctedData.pages);
          updates.push(`pages: ${correctedData.pages}`);
        }
        if (correctedData.description) {
          await fixBookField(bookId, 'description', correctedData.description);
          updates.push('description updated');
        }
        if (updates.length > 0) {
          await resolveReport(reportId, `Fixed metadata: ${updates.join(', ')}`);
          fixed.push({ reportId, action: `Fixed metadata (${updates.join(', ')})`, title: report.title });
          console.log(`  -> FIXED: ${updates.join(', ')}`);
        } else {
          await resolveReport(reportId, 'Reviewed - no changes needed');
          fixed.push({ reportId, action: 'Reviewed - no changes needed', title: report.title });
        }
      } else {
        needsReview.push({ reportId, issueType, title: report.title, userCount, notes });
        console.log(`  -> NEEDS REVIEW: no corrected data provided`);
      }
    } else if (issueType === 'bad_description' || issueType === 'wrong_description') {
      if (correctedData && correctedData.description) {
        await fixBookField(bookId, 'description', correctedData.description);
        await resolveReport(reportId, 'Fixed description from user correction');
        fixed.push({ reportId, action: 'Fixed description', title: report.title });
        console.log(`  -> FIXED description`);
      } else if (book.description) {
        const cleaned = await cleanDescription(bookId, book.description);
        if (cleaned) {
          await resolveReport(reportId, 'Cleaned HTML entities from description');
          fixed.push({ reportId, action: 'Cleaned description HTML', title: report.title });
          console.log(`  -> CLEANED description`);
        } else {
          needsReview.push({ reportId, issueType, title: report.title, userCount, notes });
          console.log(`  -> NEEDS REVIEW: description issue unclear`);
        }
      } else {
        needsReview.push({ reportId, issueType, title: report.title, userCount, notes });
      }
    } else if (issueType === 'wrong_cover' || issueType === 'missing_cover') {
      if (correctedData && correctedData.cover_url) {
        await fixBookField(bookId, 'cover_url', correctedData.cover_url);
        await resolveReport(reportId, 'Updated cover from user correction');
        fixed.push({ reportId, action: 'Fixed cover URL', title: report.title });
        console.log(`  -> FIXED cover`);
      } else {
        needsReview.push({ reportId, issueType, title: report.title, userCount, notes: 'Missing cover - needs enrichment or manual fix' });
        console.log(`  -> NEEDS REVIEW: missing cover`);
      }
    } else if (issueType === 'wrong_series' || issueType === 'series_order') {
      if (correctedData && correctedData.position_in_series !== undefined) {
        await client.execute({
          sql: `UPDATE book_series SET position_in_series = ? WHERE book_id = ?`,
          args: [correctedData.position_in_series, bookId]
        });
        await resolveReport(reportId, `Fixed series position to ${correctedData.position_in_series}`);
        fixed.push({ reportId, action: `Fixed series position to ${correctedData.position_in_series}`, title: report.title });
        console.log(`  -> FIXED series position`);
      } else {
        needsReview.push({ reportId, issueType, title: report.title, userCount, notes });
        console.log(`  -> NEEDS REVIEW: series issue`);
      }
    } else if (issueType === 'needs_enrichment') {
      // Flag for enrichment but can't trigger directly from here
      needsReview.push({ reportId, issueType, title: report.title, userCount, notes: 'Needs enrichment trigger' });
      console.log(`  -> NEEDS REVIEW: needs enrichment`);
    } else {
      needsReview.push({ reportId, issueType, title: report.title, userCount, notes });
      console.log(`  -> NEEDS REVIEW: unknown type ${issueType}`);
    }
  }

  // Generate summary
  const date = new Date().toISOString().split('T')[0];
  const summary = `# Nightly Report Triage — ${date}

## Summary
- **Total open reports processed:** ${reports.length}
- **Fixed autonomously:** ${fixed.length}
- **Needs manual review:** ${needsReview.length}

## Fixed Reports (${fixed.length})
${fixed.length === 0 ? '_None_' : fixed.map(f => `- **[${f.reportId}]** "${f.title}" — ${f.action}`).join('\n')}

## Needs Manual Review (${needsReview.length})
${needsReview.length === 0 ? '_None_' : needsReview.map(r => `- **[${r.reportId}]** \`${r.issueType}\` — "${r.title}" (${r.userCount} users) — ${r.notes}`).join('\n')}
`;

  const summaryPath = join(projectRoot, 'reports', `nightly-triage-${date}.md`);

  // Make sure reports dir exists
  import('fs').then(({ mkdirSync, writeFileSync }) => {
    mkdirSync(join(projectRoot, 'reports'), { recursive: true });
    writeFileSync(summaryPath, summary);
    console.log(`\n\nSummary written to ${summaryPath}`);
    console.log('\n' + summary);
  });

  return { fixed, needsReview, total: reports.length };
}

main().catch(console.error).finally(() => process.exit(0));
