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
