/**
 * Process open user reports on the PRODUCTION Turso database.
 *
 * Usage: npx tsx scripts/process-reports.ts
 *
 * Loads env from .env.vercel.local (run `npx vercel env pull` first).
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.vercel.local" });

import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || !authToken) {
  console.error("Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN. Run `npx vercel env pull` first.");
  process.exit(1);
}

const client = createClient({ url, authToken });

async function query(sql: string, args: any[] = []) {
  return client.execute({ sql, args });
}

async function deleteBook(bookId: string) {
  const tables = [
    "book_authors", "book_genres", "book_series", "book_category_ratings",
    "book_narrators", "links", "report_corrections", "editions",
    "user_owned_editions", "enrichment_log", "reported_issues",
    "user_hidden_books", "reading_notes", "up_next", "user_favorite_books",
    "user_book_reviews", "user_book_ratings", "reading_sessions",
    "user_book_state",
  ];
  for (const table of tables) {
    await query(`DELETE FROM ${table} WHERE book_id = ?`, [bookId]);
  }
  await query("DELETE FROM books WHERE id = ?", [bookId]);
}

async function resolveReport(reportId: string, resolution: string) {
  await query(
    "UPDATE reported_issues SET status = 'resolved', resolved_at = datetime('now'), resolution = ? WHERE id = ?",
    [resolution, reportId],
  );
}

// ─── Auto-action helpers (2026-04-20) ───

function slugify(s: string): string {
  return s
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .replace(/\s+/g, " ").trim().toLowerCase()
    .replace(/\s/g, "-");
}

async function getBookAuthorName(bookId: string): Promise<string | null> {
  const r = await query(
    `SELECT a.name FROM authors a JOIN book_authors ba ON ba.author_id = a.id WHERE ba.book_id = ? ORDER BY a.name LIMIT 1`,
    [bookId],
  );
  return r.rows.length > 0 ? (r.rows[0].name as string) : null;
}

async function regenerateSlug(bookId: string, title: string): Promise<string | null> {
  const authorName = await getBookAuthorName(bookId);
  if (!authorName) return null;
  const base = `${slugify(title)}-${slugify(authorName)}`;
  if (!base || base === "-") return null;
  let slug = base;
  let suffix = 2;
  while (true) {
    const r = await query(`SELECT id FROM books WHERE slug = ?`, [slug]);
    if (r.rows.length === 0 || r.rows[0].id === bookId) break;
    slug = `${base}-${suffix}`;
    suffix++;
  }
  await query(
    `UPDATE books SET slug = ?, updated_at = datetime('now') WHERE id = ?`,
    [slug, bookId],
  );
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

async function stripAwardsFromDescription(bookId: string, currentDesc: string): Promise<{ cleaned: string; changed: boolean }> {
  let cleaned = currentDesc;
  for (const rx of AWARD_STRIP_PATTERNS) cleaned = cleaned.replace(rx, "");
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  const changed = cleaned !== currentDesc && cleaned.length >= 100;
  if (changed) {
    await query(
      `UPDATE books SET description = ?, updated_at = datetime('now') WHERE id = ?`,
      [cleaned, bookId],
    );
  }
  return { cleaned, changed };
}

function isUserOnlyRequest(desc: string): boolean {
  return /\b(?:ask\s+me|explain\s+(?:in\s+)?(?:greater\s+)?detail|next\s+session)\b/i.test(desc);
}

async function main() {
  // Fetch open reports
  const result = await query(`
    SELECT ri.id, ri.description, ri.page_url, ri.book_id,
           b.title as book_title, b.slug as book_slug, b.description as book_desc,
           s.name as series_name, ri.series_id,
           (SELECT count(*) FROM user_book_state ubs WHERE ubs.book_id = ri.book_id) as user_count
    FROM reported_issues ri
    LEFT JOIN books b ON b.id = ri.book_id
    LEFT JOIN series s ON s.id = ri.series_id
    WHERE ri.status = 'new'
    ORDER BY ri.created_at
  `);

  console.log(`Found ${result.rows.length} open reports\n`);

  const needsInput: { id: string; desc: string; book: string }[] = [];
  let fixed = 0;

  for (const r of result.rows) {
    const id = r.id as string;
    const desc = (r.description as string).toLowerCase();
    const bookId = r.book_id as string | null;
    const bookTitle = r.book_title as string | null;
    const userCount = Number(r.user_count ?? 0);
    const slug = r.book_slug as string | null;

    console.log(`Processing: ${bookTitle || r.series_name || 'N/A'} (users: ${userCount})`);
    console.log(`  Desc: ${r.description}`);

    const rawDesc = r.description as string;

    // === SKIP: user asked to be consulted directly ===
    if (isUserOnlyRequest(rawDesc)) {
      console.log(`  -> SKIP (user requested consultation)`);
      needsInput.push({
        id,
        desc: rawDesc,
        book: `${bookTitle || r.series_name || 'N/A'} (${userCount} users) — ${r.page_url}`,
      });
      continue;
    }

    // === AUTO-FIXABLE: Junk entries with 0 users ===
    if (userCount === 0 && bookId && (
      desc.includes("junk") || desc.includes("delete") || desc.includes("non-english") || desc.includes("non english") ||
      desc.includes("duplicate") || desc.includes("what is this")
    )) {
      console.log(`  -> DELETING junk book (0 users)`);
      await deleteBook(bookId);
      await resolveReport(id, "Deleted junk/duplicate/non-English book entry (0 users)");
      fixed++;
      continue;
    }

    // === AUTO-FIXABLE: Non-English WITH users — hide from search, keep for users ===
    if (bookId && userCount > 0 && (desc.includes("non-english") || desc.includes("non english"))) {
      console.log(`  -> MARKING import_only (non-English with ${userCount} users)`);
      await query(`UPDATE books SET visibility = 'import_only', updated_at = datetime('now') WHERE id = ?`, [bookId]);
      await resolveReport(id, `Auto-fixed: visibility=import_only (non-English, has ${userCount} users)`);
      fixed++;
      continue;
    }

    // === AUTO-FIXABLE: Box set flag (title has " / ", or explicit keywords) ===
    if (bookId && (
      /probable\s+box\s?set/i.test(rawDesc) ||
      /\bbox\s?set\b/i.test(rawDesc) ||
      /\bset\s+of\s+\d+\s+books?\b/i.test(rawDesc) ||
      /\b\d+[- ]book\s+(?:combo|set|bundle)\b/i.test(rawDesc) ||
      (bookTitle && / \/ /.test(bookTitle))
    )) {
      console.log(`  -> SETTING is_box_set=1`);
      await query(`UPDATE books SET is_box_set = 1, updated_at = datetime('now') WHERE id = ?`, [bookId]);
      await resolveReport(id, "Auto-fixed: is_box_set=1");
      fixed++;
      continue;
    }

    // === AUTO-FIXABLE: Ancillary product (from junk-sweep AUTO-FLAG) ===
    if (bookId && /ancillary\s+product\s+pattern/i.test(rawDesc)) {
      if (userCount === 0) {
        console.log(`  -> DELETING ancillary product (0 users)`);
        await deleteBook(bookId);
        await resolveReport(id, "Auto-deleted: 0-user ancillary product (workbook/guide/coloring)");
      } else {
        console.log(`  -> HIDING ancillary product (${userCount} users)`);
        await query(`UPDATE books SET visibility = 'hidden', updated_at = datetime('now') WHERE id = ?`, [bookId]);
        await resolveReport(id, `Auto-fixed: visibility=hidden (ancillary product with ${userCount} users)`);
      }
      fixed++;
      continue;
    }

    // === AUTO-FIXABLE: Junk description (clean it) ===
    if (desc.includes("junk description") && bookId) {
      const bookDesc = r.book_desc as string | null;
      if (bookDesc) {
        // Check if description has HTML entities or is clearly junk
        const hasHtmlJunk = bookDesc.includes("&#") || bookDesc.includes("&amp;") || bookDesc.includes("<");
        const isTooShort = bookDesc.length < 20;
        const isSpammy = bookDesc.includes("AND LOTS OF THIS") || bookDesc.includes("data is provided as");

        if (hasHtmlJunk || isTooShort || isSpammy) {
          console.log(`  -> CLEARING junk description`);
          await query("UPDATE books SET description = NULL WHERE id = ?", [bookId]);
          await resolveReport(id, "Cleared junk description (HTML entities/spam content)");
          fixed++;
          continue;
        } else {
          // Description exists but may need manual review
          console.log(`  -> Description exists but may need review: "${bookDesc.slice(0, 80)}..."`);
        }
      }
      // Even if we can't auto-fix the description, resolve as "reviewed"
      if (userCount === 0) {
        console.log(`  -> CLEARING description for 0-user book`);
        await query("UPDATE books SET description = NULL WHERE id = ?", [bookId]);
        await resolveReport(id, "Cleared description for book with 0 users");
        fixed++;
        continue;
      }
    }

    // === AUTO-FIXABLE: Sneak peek entries ===
    if ((desc.includes("sneak peek") || (bookTitle && bookTitle.includes("Sneak Peek"))) && userCount === 0 && bookId) {
      console.log(`  -> DELETING sneak peek entry (0 users)`);
      await deleteBook(bookId);
      await resolveReport(id, "Deleted 'Sneak Peek' entry (0 users, likely a preview excerpt not a real book)");
      fixed++;
      continue;
    }

    // === AUTO-FIXABLE: Description/summary too long → flag stale for re-enrichment ===
    if (bookId && (
      /(?:summary|description)\s+(?:is\s+)?(?:way+y*\s+)?too\s+long/i.test(rawDesc) ||
      /re-?summariz/i.test(rawDesc) ||
      /needs\s+(?:to\s+be\s+)?(?:trimmed|truncat(?:ed|ion))\s+to/i.test(rawDesc) ||
      /\d+\s*char(?:acters?)?\s*(?:or\s+fewer|limit|max)/i.test(rawDesc)
    )) {
      console.log(`  -> FLAGGING description_stale=1 (too long)`);
      await query(`UPDATE books SET description_stale = 1, updated_at = datetime('now') WHERE id = ?`, [bookId]);
      await resolveReport(id, "Auto-fixed: description_stale=1 (nightly-description-refresh will re-enrich shorter)");
      fixed++;
      continue;
    }

    // === AUTO-FIXABLE: Author missing from slug → regenerate ===
    if (bookId && /(?:author\s+(?:not\s+)?(?:listed\s+)?in\s+slug|missing\s+from\s+slug)/i.test(rawDesc)) {
      const newSlug = await regenerateSlug(bookId, bookTitle || "");
      if (newSlug) {
        console.log(`  -> SLUG regenerated: ${newSlug}`);
        await resolveReport(id, `Auto-fixed: slug regenerated → ${newSlug}`);
        fixed++;
        continue;
      } else {
        console.log(`  -> SLUG fix failed (no author row)`);
      }
    }

    // === AUTO-FIXABLE: Strip award / blurb marketing from description ===
    if (bookId && /\b(?:strip|remove)\b.*?\bawards?\b/i.test(rawDesc)) {
      const bookDesc = r.book_desc as string | null;
      if (bookDesc) {
        const result = await stripAwardsFromDescription(bookId, bookDesc);
        if (result.changed) {
          console.log(`  -> STRIPPED awards (${bookDesc.length - result.cleaned.length} chars removed)`);
          await resolveReport(id, `Auto-fixed: stripped award/blurb text (${bookDesc.length - result.cleaned.length} chars removed)`);
          fixed++;
          continue;
        } else {
          console.log(`  -> No award pattern matched — falling back to stale-flag for re-enrichment`);
          await query(`UPDATE books SET description_stale = 1, updated_at = datetime('now') WHERE id = ?`, [bookId]);
          await resolveReport(id, "Auto-fixed: no award patterns matched — flagged description_stale for re-enrichment");
          fixed++;
          continue;
        }
      }
    }

    // === AUTO-FIXABLE: Test reports ===
    if (desc.includes("test report")) {
      console.log(`  -> Resolving test report`);
      await resolveReport(id, "Test report acknowledged");
      fixed++;
      continue;
    }

    // === NEEDS INPUT: Everything else ===
    needsInput.push({
      id,
      desc: r.description as string,
      book: `${bookTitle || r.series_name || 'N/A'} (${userCount} users) — ${r.page_url}`,
    });
    console.log(`  -> NEEDS INPUT`);
    console.log();
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Fixed: ${fixed}`);
  console.log(`Needs input: ${needsInput.length}`);

  if (needsInput.length > 0) {
    console.log(`\n=== REPORTS NEEDING USER INPUT ===\n`);
    for (let i = 0; i < needsInput.length; i++) {
      console.log(`${i + 1}. ${needsInput[i].book}`);
      console.log(`   ${needsInput[i].desc}`);
      console.log();
    }
  }
}

main().catch(console.error);
