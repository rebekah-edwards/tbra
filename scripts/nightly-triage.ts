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

// ─── New auto-action helpers (added 2026-04-20) ────────────────────────────

function slugify(s: string): string {
  return s
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim().toLowerCase()
    .replace(/\s/g, "-");
}

async function getBookAuthorName(bookId: string): Promise<string | null> {
  const r = await client.execute({
    sql: `SELECT a.name FROM authors a
          JOIN book_authors ba ON ba.author_id = a.id
          WHERE ba.book_id = ? ORDER BY a.name LIMIT 1`,
    args: [bookId],
  });
  return r.rows.length > 0 ? (r.rows[0].name as string) : null;
}

async function setBoxSetFlag(bookId: string): Promise<void> {
  await client.execute({
    sql: `UPDATE books SET is_box_set = 1, updated_at = datetime('now') WHERE id = ?`,
    args: [bookId],
  });
}

async function hideBook(bookId: string): Promise<void> {
  await client.execute({
    sql: `UPDATE books SET visibility = 'hidden', updated_at = datetime('now') WHERE id = ?`,
    args: [bookId],
  });
}

async function markImportOnly(bookId: string): Promise<void> {
  await client.execute({
    sql: `UPDATE books SET visibility = 'import_only', updated_at = datetime('now') WHERE id = ?`,
    args: [bookId],
  });
}

async function flagDescriptionStale(bookId: string): Promise<void> {
  await client.execute({
    sql: `UPDATE books SET description_stale = 1, updated_at = datetime('now') WHERE id = ?`,
    args: [bookId],
  });
}

async function nullDescription(bookId: string): Promise<void> {
  await client.execute({
    sql: `UPDATE books SET description = NULL, description_stale = 1, updated_at = datetime('now') WHERE id = ?`,
    args: [bookId],
  });
}

async function regenerateSlug(bookId: string, title: string): Promise<string | null> {
  const authorName = await getBookAuthorName(bookId);
  if (!authorName) return null;
  const base = `${slugify(title)}-${slugify(authorName)}`;
  if (!base || base === "-") return null;

  // Collision check — avoid clobbering another book's slug
  let slug = base;
  let suffix = 2;
  while (true) {
    const r = await client.execute({
      sql: `SELECT id FROM books WHERE slug = ?`,
      args: [slug],
    });
    if (r.rows.length === 0 || r.rows[0].id === bookId) break;
    slug = `${base}-${suffix}`;
    suffix++;
  }
  await client.execute({
    sql: `UPDATE books SET slug = ?, updated_at = datetime('now') WHERE id = ?`,
    args: [slug, bookId],
  });
  return slug;
}

// Award / blurb phrases commonly scraped into descriptions from marketing
const AWARD_STRIP_PATTERNS: RegExp[] = [
  /\b(?:winner|shortlisted|longlisted|nominee|finalist)\s+(?:of|for)\s+(?:the\s+)?[^.]+?(?:award|prize|medal)[^.]*?\.\s*/gi,
  /\b(?:#1\s+)?(?:New York Times|NYT|USA Today|Sunday Times|Wall Street Journal)\s+(?:Bestselling|bestseller|No\.?\s*1)[^.]*?\.\s*/gi,
  /\b(?:Goodreads|Amazon)\s+(?:Choice\s+Award|Readers'\s+Choice|Best\s+Book)[^.]*?\.\s*/gi,
  /\b(?:Booker|Pulitzer|Hugo|Nebula|Locus|World Fantasy|Bram Stoker|Edgar|Newbery|Caldecott|National Book)\s+(?:Award|Prize)[^.]*?\.\s*/gi,
  /\b(?:instant|immediate)\s+(?:international\s+)?(?:#1\s+)?bestseller[^.]*?\.\s*/gi,
  /"[^"]+"\s*\u2014\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}\s*,\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s*\.\s*/g,
];

async function stripAwards(bookId: string, currentDesc: string): Promise<{ cleaned: string; changed: boolean }> {
  let cleaned = currentDesc;
  for (const rx of AWARD_STRIP_PATTERNS) {
    cleaned = cleaned.replace(rx, "");
  }
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  const changed = cleaned !== currentDesc && cleaned.length >= 100;
  if (changed) {
    await client.execute({
      sql: `UPDATE books SET description = ?, updated_at = datetime('now') WHERE id = ?`,
      args: [cleaned, bookId],
    });
  }
  return { cleaned, changed };
}

// Determine if the report is asking the user personally to handle it
function isUserOnlyRequest(desc: string): boolean {
  return /\b(?:ask\s+me|explain\s+(?:in\s+)?(?:greater\s+)?detail|next\s+session)\b/i.test(desc);
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
      const rawDesc = report.description || '';
      const desc = rawDesc.toLowerCase();
      const bookTitle = report.title || '(unknown)';
      let handled = false;

      console.log(`\nReport ${report.id}: book="${bookTitle}", users=${userCount}`);
      console.log(`  Description: ${rawDesc.slice(0, 120)}`);

      // Short-circuit for reports that explicitly ask the user
      if (isUserOnlyRequest(rawDesc)) {
        skipped.push(`[${report.id}] "${bookTitle}" — user asked to be consulted directly: ${rawDesc.slice(0, 100)}`);
        console.log(`  → Skipped (user requested consultation)`);
        continue;
      }

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

      // Non-English WITH users — hide from search, keep for the users who have it
      if (!handled && report.book_id && userCount > 0 && (desc.includes('non-english') || desc.includes('non english'))) {
        await markImportOnly(report.book_id);
        await resolveReport(report.id, `Auto-fixed: visibility → import_only (non-English, has ${userCount} users)`);
        fixed.push(`HIDDEN "${bookTitle}" (${report.book_id}) — non-English + ${userCount} users`);
        console.log(`  → Marked import_only (non-English)`);
        handled = true;
      }

      // Box set: title has " / " OR desc mentions box set / N-book combo / set of N / probable box set
      if (!handled && report.book_id && (
        /probable\s+box\s?set/i.test(rawDesc) ||
        /\bbox\s?set\b/i.test(rawDesc) ||
        /\bset\s+of\s+\d+\s+books?\b/i.test(rawDesc) ||
        /\b\d+[- ]book\s+(combo|set|bundle)\b/i.test(rawDesc) ||
        (report.title && / \/ /.test(report.title))
      )) {
        await setBoxSetFlag(report.book_id);
        await resolveReport(report.id, `Auto-fixed: is_box_set=1`);
        fixed.push(`FLAGGED box_set for "${bookTitle}" (${report.book_id})`);
        console.log(`  → Set is_box_set=1`);
        handled = true;
      }

      // Ancillary product (workbooks, coloring books, study guides) from AUTO-FLAG
      if (!handled && report.book_id && /ancillary\s+product\s+pattern/i.test(rawDesc)) {
        if (userCount === 0) {
          await deleteBook(report.book_id);
          await resolveReport(report.id, `Auto-deleted: 0-user ancillary product`);
          fixed.push(`DELETED ancillary "${bookTitle}" (${report.book_id})`);
          console.log(`  → Deleted ancillary (0 users)`);
        } else {
          await hideBook(report.book_id);
          await resolveReport(report.id, `Auto-fixed: visibility → hidden (ancillary product with ${userCount} users)`);
          fixed.push(`HIDDEN ancillary "${bookTitle}" (${report.book_id})`);
          console.log(`  → Marked hidden (ancillary with users)`);
        }
        handled = true;
      }

      // "Junk description" — null it so re-enrichment picks a real one
      if (!handled && report.book_id && /\bjunk\s+description\b/i.test(rawDesc)) {
        await nullDescription(report.book_id);
        await resolveReport(report.id, `Auto-fixed: nulled junk description + flagged stale for re-enrichment`);
        fixed.push(`NULLED description for "${bookTitle}" (${report.book_id})`);
        console.log(`  → Nulled description + stale=1`);
        handled = true;
      }

      // Description/summary too long — flag stale so re-enrichment trims
      if (!handled && report.book_id && (
        /(?:summary|description)\s+(?:is\s+)?(?:way+y*\s+)?too\s+long/i.test(rawDesc) ||
        /re-?summariz/i.test(rawDesc) ||
        /needs\s+(?:to\s+be\s+)?(?:trimmed|truncat(?:ed|ion))\s+to/i.test(rawDesc) ||
        /\d+\s*char(?:acters?)?\s*(?:or\s+fewer|limit|max)/i.test(rawDesc)
      )) {
        await flagDescriptionStale(report.book_id);
        await resolveReport(report.id, `Auto-fixed: flagged description_stale=1 for re-enrichment`);
        fixed.push(`STALE-FLAGGED description for "${bookTitle}" (${report.book_id})`);
        console.log(`  → description_stale=1`);
        handled = true;
      }

      // Author missing from slug — regenerate
      if (!handled && report.book_id && /(?:author\s+(?:not\s+)?(?:listed\s+)?in\s+slug|missing\s+from\s+slug)/i.test(rawDesc)) {
        const newSlug = await regenerateSlug(report.book_id, report.title || '');
        if (newSlug) {
          await resolveReport(report.id, `Auto-fixed: slug regenerated → ${newSlug}`);
          fixed.push(`SLUG fixed for "${bookTitle}" → ${newSlug}`);
          console.log(`  → Slug regenerated: ${newSlug}`);
        } else {
          skipped.push(`[${report.id}] "${bookTitle}" (${report.book_id}) — slug fix requested but could not find author row`);
          console.log(`  → Slug fix failed (no author row)`);
        }
        handled = true;
      }

      // Strip award / blurb marketing text from description
      if (!handled && report.book_id && /\b(?:strip|remove)\b.*?\bawards?\b/i.test(rawDesc) && report.book_description) {
        const result = await stripAwards(report.book_id, report.book_description);
        if (result.changed) {
          await resolveReport(report.id, `Auto-fixed: stripped award/blurb text from description (${report.book_description.length - result.cleaned.length} chars removed)`);
          fixed.push(`STRIPPED awards from "${bookTitle}" (${report.book_id})`);
          console.log(`  → Stripped awards (${report.book_description.length - result.cleaned.length} chars removed)`);
        } else {
          await flagDescriptionStale(report.book_id);
          await resolveReport(report.id, `Auto-fixed: no award patterns matched — flagged description_stale for re-enrichment instead`);
          fixed.push(`STALE-FLAGGED (awards fallback) for "${bookTitle}" (${report.book_id})`);
          console.log(`  → No award pattern matched, flagged stale for re-enrichment`);
        }
        handled = true;
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
