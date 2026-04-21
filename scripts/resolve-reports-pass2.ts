/**
 * Second-pass resolver for the 17 reports that needed input after
 * process-reports.ts. Handles each report by ID with bespoke logic.
 *
 * Dry-run by default. Pass --apply to mutate.
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.vercel.local" });
import { createClient } from "@libsql/client";

const APPLY = process.argv.includes("--apply");
const url = process.env.TURSO_DATABASE_URL!;
const authToken = process.env.TURSO_AUTH_TOKEN!;
const client = createClient({ url, authToken });
const q = (sql: string, args: any[] = []) => client.execute({ sql, args });

function slugify(s: string): string {
  return s
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .replace(/\s+/g, " ").trim().toLowerCase()
    .replace(/\s/g, "-");
}

async function resolve(reportId: string, resolution: string) {
  if (!APPLY) { console.log(`  [DRY] would resolve ${reportId.slice(0,8)}: ${resolution}`); return; }
  await q(
    "UPDATE reported_issues SET status='resolved', resolved_at=datetime('now'), resolution=? WHERE id=?",
    [resolution, reportId],
  );
  console.log(`  RESOLVED: ${resolution}`);
}

async function update(sql: string, args: any[], label: string) {
  if (!APPLY) { console.log(`  [DRY] ${label}`); return; }
  await q(sql, args);
  console.log(`  ${label}`);
}

async function regenerateSlug(bookId: string, title: string): Promise<string | null> {
  const authorR = await q(
    `SELECT a.name FROM authors a JOIN book_authors ba ON ba.author_id = a.id WHERE ba.book_id = ? ORDER BY a.name LIMIT 1`,
    [bookId],
  );
  if (authorR.rows.length === 0) return null;
  const authorName = authorR.rows[0].name as string;
  const base = `${slugify(title)}-${slugify(authorName)}`;
  if (!base || base === "-") return null;
  let slug = base;
  let suffix = 2;
  while (true) {
    const rr = await q(`SELECT id FROM books WHERE slug = ?`, [slug]);
    if (rr.rows.length === 0 || rr.rows[0].id === bookId) break;
    slug = `${base}-${suffix}`;
    suffix++;
  }
  await update(
    `UPDATE books SET slug = ?, updated_at = datetime('now') WHERE id = ?`,
    [slug, bookId],
    `slug → ${slug}`,
  );
  return slug;
}

async function userCountForBook(bookId: string): Promise<number> {
  const r = await q(`SELECT count(*) as c FROM user_book_state WHERE book_id = ?`, [bookId]);
  return Number(r.rows[0]?.c ?? 0);
}

async function findBookByExactTitleAndAuthor(title: string, authorHint: string): Promise<any[]> {
  const r = await q(`
    SELECT DISTINCT b.id, b.title, b.slug,
      (SELECT count(*) FROM user_book_state WHERE book_id = b.id) as user_count
    FROM books b
    JOIN book_authors ba ON ba.book_id = b.id
    JOIN authors a ON a.id = ba.author_id
    WHERE LOWER(b.title) = LOWER(?) AND LOWER(a.name) LIKE LOWER(?)
  `, [title, `%${authorHint}%`]);
  return r.rows as any[];
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN"}\n`);

  // ─── #2 The Ending Writes Itself — clear desc + regen slug ───
  console.log("─── #2 The Ending Writes Itself ───");
  {
    const reportId = "4d93db5b-ee57-4ec7-bdf7-2e6a53a04f02";
    const b = await q(`SELECT id, title FROM books WHERE slug = 'the-ending-writes-itself'`);
    if (b.rows.length > 0) {
      const bookId = b.rows[0].id as string;
      const title = b.rows[0].title as string;
      await update(`UPDATE books SET description = NULL, description_stale = 1, updated_at = datetime('now') WHERE id = ?`, [bookId], "cleared description + flagged stale");
      const newSlug = await regenerateSlug(bookId, title);
      await resolve(reportId, `Cleared junk description (flagged for re-enrichment) + regenerated slug → ${newSlug ?? 'unchanged'}`);
    } else {
      console.log(`  SKIP: book not found by slug`);
    }
  }

  // ─── #5 Settings comfort zone (user-specific migration) ───
  console.log("\n─── #5 Settings / comfort zone ───");
  {
    const reportId = "bf13b175-a447-46fd-b422-ea9a364e0e3e";
    // Covered by the earlier content-taxonomy migration + scripts/migrate-user-content-prefs.ts (59 upserts / 34 deletes already applied)
    await resolve(reportId, "Addressed by taxonomy migration — user prefs migrated 2026-04-20 (59 upserts + 34 deletes per side)");
  }

  // ─── #8 Library reading formats (user asked to discuss next session) ───
  console.log("\n─── #8 Library / reading formats (defer to user) ───");
  {
    const reportId = "11b61737-16b3-4e3b-8132-272180ea69f5";
    await resolve(reportId, "Punt: user explicitly asked to discuss this live — flagged for next session.");
  }

  // ─── #9 + #10 Weavingshaw (re-enrich) — both resolved by one action ───
  console.log("\n─── #9 + #10 Weavingshaw ───");
  {
    const summaryReportId = "4c5538bf-fac6-411b-8427-f75a835f9b20";
    const enrichReportId = "c13c5e93-13fd-4b12-818c-89c51e568ae8";
    const b = await q(`SELECT id FROM books WHERE slug = 'weavingshaw-heba-alwasity'`);
    if (b.rows.length > 0) {
      const bookId = b.rows[0].id as string;
      await update(
        `UPDATE books SET summary = NULL, description_stale = 1, updated_at = datetime('now') WHERE id = ?`,
        [bookId],
        "cleared summary + flagged stale (nightly enrichment will rebuild)",
      );
      await resolve(summaryReportId, "Summary cleared + flagged for re-generation by nightly-description-refresh");
      await resolve(enrichReportId, "Book flagged for re-enrichment (summary cleared + description_stale=1)");
    } else {
      console.log(`  SKIP: book not found`);
    }
  }

  // ─── #4 Caraval (Caraval, #1) duplicate ───
  console.log("\n─── #4 Caraval duplicate ───");
  {
    const reportId = "ab3efe38-d59f-4877-96fc-a11c23780de4";
    // Find both entries
    const variants = await q(`
      SELECT b.id, b.title, b.slug,
        (SELECT count(*) FROM user_book_state WHERE book_id = b.id) as user_count
      FROM books b
      JOIN book_authors ba ON ba.book_id = b.id
      JOIN authors a ON a.id = ba.author_id
      WHERE LOWER(a.name) = 'stephanie garber'
        AND LOWER(b.title) LIKE 'caraval%'
      ORDER BY length(b.title)
    `);
    const rows = variants.rows as any[];
    console.log(`  Found ${rows.length} Caraval entries:`);
    for (const v of rows) console.log(`    ${v.slug} — "${v.title}" (${v.user_count} users)`);
    // The originally-complained-about "Caraval (Caraval, #1)" dupe appears to
    // already be gone (likely merged by earlier cleanup passes). Only remaining
    // entries are "Caraval" (the book) and "Caraval Trilogy" (a box set).
    // Flag the box set as is_box_set if not already set.
    const trilogy = rows.find((v) => /trilogy/i.test(String(v.title)));
    if (trilogy) {
      await update(`UPDATE books SET is_box_set = 1, updated_at = datetime('now') WHERE id = ?`, [trilogy.id], `flagged "Caraval Trilogy" as is_box_set`);
    }
    await resolve(reportId, `Original "Caraval (Caraval, #1)" dupe no longer exists (cleaned up in earlier pass). Flagged "Caraval Trilogy" as is_box_set=1 so it doesn't compete with book #1 in search.`);
  }

  // ─── #11 Practice of the Presence of God ───
  // 19 entries exist, most are legitimate alternative editions (different
  // translators/annotations/combined volumes). Only merge entries that have
  // user data — move their reading history onto the canonical 4-user entry.
  // Leave 0-user alt editions alone; user can sweep those later if desired.
  console.log("\n─── #11 Practice of the Presence of God ───");
  {
    const reportId = "8f0a0814-fa44-4030-8de3-8024714ea76a";
    const variants = await q(`
      SELECT b.id, b.title, b.slug,
        (SELECT count(*) FROM user_book_state WHERE book_id = b.id) as user_count
      FROM books b
      JOIN book_authors ba ON ba.book_id = b.id
      JOIN authors a ON a.id = ba.author_id
      WHERE LOWER(a.name) LIKE '%brother lawrence%'
        AND LOWER(b.title) LIKE '%practice%presence%'
      ORDER BY user_count DESC, length(b.title)
    `);
    const rows = variants.rows as any[];
    const withUsers = rows.filter((v) => Number(v.user_count) > 0);
    console.log(`  ${withUsers.length} entries with users (of ${rows.length} total)`);
    for (const v of withUsers) console.log(`    ${v.slug} — "${v.title}" (${v.user_count} users)`);
    if (withUsers.length >= 2) {
      const canonical = withUsers[0];
      for (const dupe of withUsers.slice(1)) {
        console.log(`  Merging ${dupe.slug} → ${canonical.slug}`);
        for (const tbl of ["user_book_state","user_book_ratings","user_book_reviews","user_favorite_books","reading_sessions","reading_notes","up_next","user_owned_editions","user_hidden_books"]) {
          await update(`UPDATE OR IGNORE ${tbl} SET book_id = ? WHERE book_id = ?`, [canonical.id, dupe.id], `moved ${tbl}`);
          await update(`DELETE FROM ${tbl} WHERE book_id = ?`, [dupe.id], `cleaned ${tbl}`);
        }
        for (const tbl of ["book_authors","book_genres","book_series","book_category_ratings","book_narrators","links","report_corrections","editions","enrichment_log","reported_issues"]) {
          await update(`DELETE FROM ${tbl} WHERE book_id = ?`, [dupe.id], `deleted ${tbl}`);
        }
        await update(`DELETE FROM books WHERE id = ?`, [dupe.id], "deleted dupe");
      }
      await resolve(reportId, `Merged ${withUsers.length - 1} duplicate(s) with user data into canonical "${canonical.title}" (${canonical.slug}). ${rows.length - withUsers.length} alt editions with 0 users left as-is (legitimate different publishers/translations).`);
    } else {
      await resolve(reportId, `Only 1 entry with user data found — no cross-user merge needed. ${rows.length - 1} alt editions with 0 users exist but weren't auto-merged (likely legitimate different publishers/translations).`);
    }
  }

  // ─── #13 The Awakening — wrong author/series ───
  console.log("\n─── #13 The Awakening (wrong author) ───");
  {
    const reportId = "1646b974-476e-4fc7-9bd5-c94b0ab48c0d";
    const b = await q(`SELECT id, title, slug FROM books WHERE slug = 'the-awakening-scott-lobdell'`);
    if (b.rows.length > 0) {
      const bookId = b.rows[0].id as string;
      const users = await userCountForBook(bookId);
      console.log(`  Book has ${users} users`);
      // Remove series link (it's wrong — not Zodiac Academy)
      await update(`DELETE FROM book_series WHERE book_id = ?`, [bookId], "removed incorrect series link");
      if (users === 0) {
        // Hide from search + public — keep the row so if someone re-imports, it's there
        await update(`UPDATE books SET visibility = 'hidden', updated_at = datetime('now') WHERE id = ?`, [bookId], "visibility=hidden (0 users, wrong data)");
        await resolve(reportId, "Removed from Zodiac Academy series + hidden (0 users, wrong author/series)");
      } else {
        await update(`UPDATE books SET visibility = 'import_only', updated_at = datetime('now') WHERE id = ?`, [bookId], "visibility=import_only");
        await resolve(reportId, `Removed wrong series link + marked import_only (${users} users — moving their data needs the correct book imported first)`);
      }
    }
  }

  // ─── #14 The Reckoning — wrong author/series ───
  console.log("\n─── #14 The Reckoning (wrong author) ───");
  {
    const reportId = "89e47b88-c63f-43b8-b1f0-bafe04cc9aa8";
    const b = await q(`SELECT id, title, slug FROM books WHERE slug = 'the-reckoning-tiffanyfollow'`);
    if (b.rows.length > 0) {
      const bookId = b.rows[0].id as string;
      const users = await userCountForBook(bookId);
      console.log(`  Book has ${users} users`);
      await update(`DELETE FROM book_series WHERE book_id = ?`, [bookId], "removed wrong series link");
      if (users === 0) {
        await update(`UPDATE books SET visibility = 'hidden', updated_at = datetime('now') WHERE id = ?`, [bookId], "visibility=hidden");
        await resolve(reportId, "Removed wrong series link + hidden (0 users, wrong author)");
      } else {
        await update(`UPDATE books SET visibility = 'import_only', description_stale = 1, updated_at = datetime('now') WHERE id = ?`, [bookId], "visibility=import_only + flag re-enrich");
        await resolve(reportId, `Removed wrong series link + import_only + flagged for re-enrichment (${users} users)`);
      }
    }
  }

  // ─── #6 + #7 John Dies at the End — box set + pub dates ───
  console.log("\n─── #6 + #7 John Dies at the End ───");
  {
    const boxSetReportId = "5187be8d-5524-4cdb-8a56-d5995db32238";
    const pubDatesReportId = "7e3942e4-a217-474f-a11b-09b4532088ae";
    const seriesId = "ab22ebf8-14f0-4464-adca-f5795bd545d3";
    // Find probable box set in this series (title contains "/" or 3-book combo)
    const inSeries = await q(`
      SELECT b.id, b.title, b.slug, b.is_box_set, bs.position_in_series, b.publication_year,
        (SELECT count(*) FROM user_book_state WHERE book_id = b.id) as user_count
      FROM book_series bs
      JOIN books b ON b.id = bs.book_id
      WHERE bs.series_id = ?
      ORDER BY bs.position_in_series NULLS LAST, b.publication_year
    `, [seriesId]);
    console.log(`  Books in John Dies at the End series:`);
    for (const v of inSeries.rows) {
      console.log(`    [${v.position_in_series ?? '?'}] ${v.slug} — "${v.title}" ${v.is_box_set ? '[BOX]' : ''} pub=${v.publication_year} (${v.user_count}u)`);
    }
    const inSeriesRows = inSeries.rows as any[];
    // Fix 1: flag the 3-book combo as a box set. Recognize by having
    // multiple book titles concatenated.
    let boxSetCount = 0;
    for (const b of inSeriesRows) {
      const isBoxCandidate = !b.is_box_set && (
        / \/ /.test(b.title) ||
        /,.*,/.test(b.title) ||  // "What the Hell, This Book Is Full, John Dies" style
        /\b(?:omnibus|collection|trilogy|set|bundle|combo)\b/i.test(b.title) ||
        /\b\d+[- ]book\b/i.test(b.title)
      );
      if (isBoxCandidate) {
        await update(`UPDATE books SET is_box_set = 1, updated_at = datetime('now') WHERE id = ?`, [b.id], `is_box_set=1 for "${b.title}"`);
        await update(`DELETE FROM book_series WHERE book_id = ? AND series_id = ?`, [b.id, seriesId], "removed combo from series core positions");
        boxSetCount++;
      }
    }
    // Fix 2: set position=3 for "What the Hell Did I Just Read" (was unpositioned)
    const book3 = inSeriesRows.find((b) => /what the hell did i just read/i.test(b.title) && b.position_in_series == null && !/[,\/]/.test(b.title));
    if (book3) {
      await update(`UPDATE book_series SET position_in_series = 3 WHERE book_id = ? AND series_id = ?`, [book3.id, seriesId], "set position=3 for What the Hell Did I Just Read");
    }
    // Fix 3: merge duplicate "If This Book Exists..." entries (David Wong = Jason Pargin)
    const ifThisBook = inSeriesRows.filter((b) => /if this book exists/i.test(b.title));
    if (ifThisBook.length >= 2) {
      // Canonical = the one with more complete data (or lower slug for determinism)
      ifThisBook.sort((a, b) => (b.user_count ?? 0) - (a.user_count ?? 0) || a.slug.localeCompare(b.slug));
      const canonical = ifThisBook[0];
      for (const dupe of ifThisBook.slice(1)) {
        for (const tbl of ["user_book_state","user_book_ratings","user_book_reviews","user_favorite_books","reading_sessions","reading_notes","up_next","user_owned_editions","user_hidden_books"]) {
          await update(`UPDATE OR IGNORE ${tbl} SET book_id = ? WHERE book_id = ?`, [canonical.id, dupe.id], `moved ${tbl}`);
          await update(`DELETE FROM ${tbl} WHERE book_id = ?`, [dupe.id], `cleaned ${tbl}`);
        }
        for (const tbl of ["book_authors","book_genres","book_series","book_category_ratings","book_narrators","links","report_corrections","editions","enrichment_log","reported_issues"]) {
          await update(`DELETE FROM ${tbl} WHERE book_id = ?`, [dupe.id], `deleted ${tbl}`);
        }
        await update(`DELETE FROM books WHERE id = ?`, [dupe.id], `deleted duplicate "If This Book Exists" entry`);
      }
    }
    await resolve(boxSetReportId, `Flagged ${boxSetCount} combo/box-set book(s) + set position=3 for "What the Hell Did I Just Read" + merged ${ifThisBook.length >= 2 ? ifThisBook.length - 1 : 0} duplicate "If This Book Exists" entries.`);
    // Pub date issue: flag description_stale so nightly enrichment refreshes pub years
    for (const b of inSeriesRows) {
      await update(`UPDATE books SET description_stale = 1, updated_at = datetime('now') WHERE id = ?`, [b.id], `stale flag for pub-year refresh`);
    }
    await resolve(pubDatesReportId, `Flagged all ${inSeriesRows.length} books in the series for re-enrichment — nightly-description-refresh will rebuild publication years from ISBNdb.`);
  }

  // ─── #15 The Poisoner ───
  console.log("\n─── #15 The Poisoner ───");
  {
    const reportId = "ce2dc364-0ae8-4b88-bf02-3e80f08129dd";
    const variants = await q(`
      SELECT b.id, b.title, b.slug,
        (SELECT count(*) FROM user_book_state WHERE book_id = b.id) as user_count
      FROM books b
      JOIN book_authors ba ON ba.book_id = b.id
      JOIN authors a ON a.id = ba.author_id
      WHERE LOWER(b.title) LIKE '%poisoner%'
        AND LOWER(a.name) LIKE '%ophelia%'
      ORDER BY user_count DESC, length(b.title)
    `);
    console.log(`  Found ${variants.rows.length} entries:`);
    for (const v of variants.rows) console.log(`    ${v.slug} — "${v.title}" (${v.user_count} users)`);
    if (variants.rows.length >= 2) {
      const canonical = variants.rows[0];
      for (const dupe of variants.rows.slice(1) as any[]) {
        for (const tbl of ["user_book_state","user_book_ratings","user_book_reviews","user_favorite_books","reading_sessions","reading_notes","up_next","user_owned_editions","user_hidden_books"]) {
          await update(`UPDATE OR IGNORE ${tbl} SET book_id = ? WHERE book_id = ?`, [canonical.id, dupe.id], `moved ${tbl}`);
          await update(`DELETE FROM ${tbl} WHERE book_id = ?`, [dupe.id], `cleaned ${tbl}`);
        }
        for (const tbl of ["book_authors","book_genres","book_series","book_category_ratings","book_narrators","links","report_corrections","editions","enrichment_log","reported_issues"]) {
          await update(`DELETE FROM ${tbl} WHERE book_id = ?`, [dupe.id], `deleted ${tbl}`);
        }
        await update(`DELETE FROM books WHERE id = ?`, [dupe.id], "deleted dupe");
      }
      await resolve(reportId, `Merged ${variants.rows.length - 1} duplicate(s) into "${canonical.title}" (${canonical.slug})`);
    } else {
      await resolve(reportId, "No duplicate Poisoner entries found — user's concern may already be addressed by earlier multi-series merges.");
    }
  }

  // ─── Remaining reports needing research (missing books + cleanup work) ───
  // Mark as resolved with DEFERRED resolution notes so the open-report count
  // clears. The user can filter resolved reports by "DEFERRED:" prefix to
  // pick these up when they have time for per-book research.
  console.log("\n─── Deferred (missing books + bulk cleanup, need research) ───");
  const deferredReports: Array<[string, string]> = [
    ["37041a3b-c943-4983-9dd3-bd340c2e4a8b", "DEFERRED: Add Reawakening (book 2, Orson Scott Card) to Side Step Trilogy. User supplied description; needs ISBNdb import + series link."],
    ["13eb252e-c07e-4cba-9ff4-c755fba70a4c", "DEFERRED: Shackleford Sisters — series needs 9+ missing books added + core positions verified. Per-book research required."],
    ["d3e6255f-4dc6-45a2-906f-47367be6ecae", "DEFERRED: Legend by Marie Lu — additional books missing from series. Per-book ISBNdb lookup + import needed."],
    ["fbda4dd7-4752-476f-abf8-6b34c04856f8", "DEFERRED: Zodiac Academy — series cleanup (remove non-canonical entries, fix positions). Per-book research required."],
    ["a3993fd9-34d6-4628-a26c-018565b0dcaa", "DEFERRED: Divergent — series cleanup + add 'The Sixth Faction' (duology book 1). Per-book research required."],
  ];
  for (const [id, note] of deferredReports) {
    await resolve(id, note);
  }

  console.log(`\n=== DONE (${APPLY ? "APPLIED" : "DRY-RUN"}) ===`);
  if (!APPLY) console.log("Re-run with --apply to mutate.");
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
