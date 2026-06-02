/**
 * Process open user reports on the PRODUCTION Turso database.
 *
 * Usage: npx tsx scripts/process-reports.ts
 *
 * Loads env from .env.vercel.local (run `npx vercel env pull` first).
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.vercel.local" });

import type { Client } from "@libsql/client";
import { createGuardedTurso } from "./lib/turso-guard";
import * as fs from "fs";
import * as path from "path";

let client: Client;

// Running log of every resolution applied this run, for the summary report file.
const fixedLog: string[] = [];

async function query(sql: string, args: any[] = []) {
  return client.execute({ sql, args });
}

async function deleteBook(bookId: string) {
  // FIRST: detach reported_issues for this book and auto-resolve any still
  // 'new' (preserves the audit trail). Without this step the cascade DELETEs
  // below would silently destroy the report row that triggered this delete,
  // and the caller's resolveReport() update afterward would have nothing to
  // update — losing the resolution text.
  await query(
    `UPDATE reported_issues
     SET book_id = NULL,
         status = CASE WHEN status = 'new' THEN 'resolved' ELSE status END,
         resolved_at = CASE WHEN status = 'new' THEN datetime('now') ELSE resolved_at END,
         resolution = CASE
           WHEN status = 'new' AND (resolution IS NULL OR resolution = '')
             THEN '[auto] book was deleted by process-reports.ts'
           ELSE resolution
         END
     WHERE book_id = ?`,
    [bookId],
  );

  // Then cascade-delete the junction + child rows. reported_issues is no
  // longer in this list because we already detached its book_id above.
  const tables = [
    "book_authors", "book_genres", "book_series", "book_category_ratings",
    "book_narrators", "links", "report_corrections", "editions",
    "user_owned_editions", "enrichment_log",
    "user_hidden_books", "reading_notes", "up_next", "user_favorite_books",
    "user_book_reviews", "user_book_ratings", "reading_sessions",
    "user_book_state", "tbr_notes", "shelf_books", "buddy_reads",
  ];
  const skippedTables: string[] = [];
  for (const table of tables) {
    try {
      await query(`DELETE FROM ${table} WHERE book_id = ?`, [bookId]);
    } catch (e: any) {
      // Unknown table on Turso — skip. Any other error bubbles up.
      if (!/no such table/i.test(String(e?.message ?? e))) throw e;
      skippedTables.push(table);
    }
  }
  if (skippedTables.length > 0) {
    console.log(`  deleteBook(${bookId}): skipped missing FK tables on Turso: ${skippedTables.join(", ")}`);
  }
  await query("DELETE FROM books WHERE id = ?", [bookId]);
  // Post-action verify — throw if the row survived.
  const v = await query("SELECT 1 FROM books WHERE id = ?", [bookId]);
  if (v.rows.length !== 0) {
    throw new Error(`deleteBook verification failed: ${bookId} still exists on Turso`);
  }
}

async function resolveReport(reportId: string, resolution: string) {
  await query(
    "UPDATE reported_issues SET status = 'resolved', resolved_at = datetime('now'), resolution = ? WHERE id = ?",
    [resolution, reportId],
  );
  fixedLog.push(resolution);
}

// ─── Auto-action helpers (2026-04-20) ───

function slugify(s: string): string {
  return s
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .replace(/\s+/g, " ").trim().toLowerCase()
    .replace(/\s/g, "-");
}

/** Heuristic: is this text likely non-English? (>10% non-ASCII-Latin letters, or
 *  common non-English stopwords.) Used to clear foreign-language descriptions. */
function isLikelyNonEnglish(text: string): boolean {
  if (!text || text.length < 12) return false;
  const letters = text.replace(/[^a-zA-ZÀ-ÿğışöçĞİŞÖÇ]/g, "");
  if (letters.length === 0) return false;
  const nonAsciiLatin = (text.match(/[^\x00-\x7F]/g) || []).length;
  if (nonAsciiLatin / text.length > 0.1) return true;
  // Non-English function words that rarely appear in English book blurbs.
  return /\b(?:bir|ve|için|bu|ile|olan|den|ein|und|der|die|das|für|el|la|los|las|une|des|pour|avec|este|esta)\b/i.test(text)
    && (text.match(/\b(?:bir|ve|için|bu|ile|ein|und|der|die|el|la|los|une|des|este)\b/gi) || []).length >= 3;
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

function isMergeRequest(desc: string): boolean {
  // Only trigger on clearly merge-shaped reports. "duplicate" alone is already handled
  // by the 0-user junk delete path earlier; here we look for phrases that imply a SIBLING.
  return /(?:two\s+versions|both\s+of\s+which|please\s+merge|\bmerge\b|same\s+book\b|duplicate\s+(?:entry|of\s+this))/i.test(desc);
}

function normalizeTitle(t: string): string {
  return t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Try to find a sibling book (same normalized title + first author) so we can merge.
// Returns the dupe to delete + the canonical to keep, or null if ambiguous.
async function findMergePair(reportedBookId: string): Promise<
  | { canonicalId: string; dupeId: string; canonicalSlug: string; dupeSlug: string; groupSize: number }
  | { ambiguous: true; groupSize: number; siblings: Array<{ id: string; slug: string; users: number }> }
  | null
> {
  const reported = await query(
    `SELECT b.id, b.title, b.slug, b.cover_image_url, b.cover_source, b.publication_year,
            (SELECT a.name FROM authors a JOIN book_authors ba ON ba.author_id = a.id WHERE ba.book_id = b.id ORDER BY a.name LIMIT 1) AS author_name
     FROM books b WHERE b.id = ?`,
    [reportedBookId],
  );
  if (reported.rows.length === 0) return null;
  const r = reported.rows[0] as any;
  const title = r.title as string;
  const author = r.author_name as string | null;
  if (!title || !author) return null;

  // Fetch candidates with matching title prefix to reduce scan. LIKE is not case-sensitive for ASCII.
  // We filter precisely in JS using normalizeTitle.
  const likeTitle = title.slice(0, 20).replace(/[%_]/g, "");
  const candidates = await query(
    `SELECT b.id, b.title, b.slug, b.cover_image_url, b.cover_source, b.publication_year,
            (SELECT a.name FROM authors a JOIN book_authors ba ON ba.author_id = a.id WHERE ba.book_id = b.id ORDER BY a.name LIMIT 1) AS author_name,
            (SELECT COUNT(*) FROM user_book_state WHERE book_id = b.id) AS user_count
     FROM books b
     WHERE b.visibility = 'public' AND b.title LIKE ?`,
    [`${likeTitle}%`],
  );

  const normT = normalizeTitle(title);
  const normA = normalizeTitle(author);
  const group = (candidates.rows as any[]).filter(
    (c) =>
      normalizeTitle(c.title ?? "") === normT &&
      normalizeTitle(c.author_name ?? "") === normA,
  );
  if (group.length < 2) return null;

  // Score each: prefer user activity, then cover, then author-in-slug, then publication_year.
  const authorSlugFragment = normA.replace(/ /g, "-");
  const score = (c: any) =>
    Number(c.user_count) * 1000 +
    (c.cover_image_url ? 20 : 0) +
    (c.cover_source && !String(c.cover_source).includes("placeholder") && c.cover_source !== "none-found" ? 10 : 0) +
    (c.slug && authorSlugFragment && String(c.slug).endsWith(authorSlugFragment) ? 5 : 0) +
    (c.publication_year ? 2 : 0) +
    (c.slug && c.slug !== "null" ? 1 : 0);

  const sorted = [...group].sort((a, b) => score(b) - score(a));
  const canonical = sorted[0];
  const others = sorted.slice(1);

  // Safe auto-merge ONLY if every non-canonical has 0 users and there's exactly one sibling
  // (more than one dupe is still handled, but we want to be cautious)
  const allOthersClean = others.every((o) => Number(o.user_count) === 0);
  const canonicalHasSlug = canonical.slug && canonical.slug !== "null";

  if (!allOthersClean || !canonicalHasSlug) {
    return {
      ambiguous: true,
      groupSize: group.length,
      siblings: group.map((g) => ({ id: g.id as string, slug: g.slug as string, users: Number(g.user_count) })),
    };
  }

  // We only auto-merge the first dupe in this call. If multiple dupes exist, the next run picks up the rest.
  const dupe = others[0];
  return {
    canonicalId: canonical.id as string,
    dupeId: dupe.id as string,
    canonicalSlug: canonical.slug as string,
    dupeSlug: dupe.slug as string,
    groupSize: group.length,
  };
}

// Merge the dupe into canonical: move book_series links that canonical doesn't have,
// then run the full verified deleteBook.
async function mergeDupeIntoCanonical(canonicalId: string, dupeId: string): Promise<void> {
  const dupeSeries = await query(
    `SELECT series_id, position_in_series FROM book_series WHERE book_id = ?`,
    [dupeId],
  );
  for (const row of dupeSeries.rows as any[]) {
    const existing = await query(
      `SELECT 1 FROM book_series WHERE book_id = ? AND series_id = ?`,
      [canonicalId, row.series_id],
    );
    if (existing.rows.length === 0) {
      await query(
        `INSERT OR IGNORE INTO book_series (book_id, series_id, position_in_series) VALUES (?, ?, ?)`,
        [canonicalId, row.series_id, row.position_in_series],
      );
    }
  }
  // Dupe has 0 user activity by contract — deleteBook handles FK cleanup + verified delete.
  await deleteBook(dupeId);
}

// Per-report cap: a single report should never hold the loop hostage. If
// processing one report takes longer than this, we abandon that report (it
// stays open and surfaces as needs-input) and move on to the rest of the
// queue. Combined with the wall-clock ceiling below, this means a 30-report
// queue has at most 30 × 3 min = 90 min budget, but typical fast reports
// finish in seconds.
const PER_REPORT_TIMEOUT_MS = 3 * 60 * 1000;

type ReportOutcome =
  | { kind: "fixed" }
  | { kind: "needsInput"; item: { id: string; desc: string; book: string } };

async function main() {
  const guard = await createGuardedTurso({
    name: "process-reports",
    // 4 hours — fits a backlog of up to ~80 reports each taking the full
    // 3 min cap, with headroom. Realistic queue burns through in minutes,
    // not hours; this ceiling is the safety net, not the steady state.
    maxRuntimeMs: 4 * 60 * 60 * 1000,
    queryTimeoutMs: 120_000,
    longRunning: true,
  });
  client = guard.remote;

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
    const rawDesc = r.description as string;
    const bookLineWithSeriesName = `${bookTitle || r.series_name || 'N/A'} (${userCount} users) — ${r.page_url}`;
    const bookLineNoSeriesName = `${bookTitle || 'N/A'} (${userCount} users) — ${r.page_url}`;

    console.log(`Processing: ${bookTitle || r.series_name || 'N/A'} (users: ${userCount})`);
    console.log(`  Desc: ${r.description}`);

    // The body is wrapped in an IIFE so each report can be raced against a
    // 3-min per-report timeout below. A single hung report cannot stall the
    // rest of the queue — it gets pushed to needs-input and the loop moves on.
    const work = (async (): Promise<ReportOutcome> => {
      // === SKIP: user asked to be consulted directly ===
      if (isUserOnlyRequest(rawDesc)) {
        console.log(`  -> SKIP (user requested consultation)`);
        return { kind: "needsInput", item: { id, desc: rawDesc, book: bookLineWithSeriesName } };
      }

      // === AUTO-FIXABLE: Merge-duplicate reports ===
      // "There are two versions of this book... please merge" — the report is often filed
      // against the canonical (which has users), so the 0-user junk path won't fire. Look up
      // siblings by normalized title + author and merge the clean sibling into the canonical.
      if (bookId && isMergeRequest(rawDesc)) {
        const pair = await findMergePair(bookId);
        if (pair && "canonicalId" in pair) {
          console.log(`  -> MERGING dupe ${pair.dupeSlug} into canonical ${pair.canonicalSlug}`);
          try {
            await mergeDupeIntoCanonical(pair.canonicalId, pair.dupeId);
            await resolveReport(
              id,
              `Auto-merged: deleted dupe ${pair.dupeId} (slug: ${pair.dupeSlug}) into canonical ${pair.canonicalId} (slug: ${pair.canonicalSlug}). Dupe had 0 user activity. [${pair.groupSize}-book group]`,
            );
            return { kind: "fixed" };
          } catch (e: any) {
            console.log(`  -> MERGE FAILED: ${e.message} — leaving report open for manual review`);
            return {
              kind: "needsInput",
              item: { id, desc: `[merge attempt failed: ${e.message}] ${rawDesc}`, book: bookLineNoSeriesName },
            };
          }
        }
        if (pair && "ambiguous" in pair) {
          console.log(`  -> MERGE AMBIGUOUS (${pair.groupSize} siblings, not all zero-users) — needs manual review`);
          return {
            kind: "needsInput",
            item: {
              id,
              desc:
                `[merge-ambiguous: ${pair.groupSize} siblings ` +
                pair.siblings.map((s) => `${s.slug}(${s.users}u)`).join(" / ") +
                `] ${rawDesc}`,
              book: bookLineNoSeriesName,
            },
          };
        }
        // No sibling found — fall through so other handlers get a chance.
        console.log(`  -> MERGE: no sibling found, trying other patterns`);
      }

      // === AUTO-FIXABLE: Junk entries with 0 users ===
      if (userCount === 0 && bookId && (
        desc.includes("junk") || desc.includes("delete") || desc.includes("non-english") || desc.includes("non english") ||
        desc.includes("duplicate") || desc.includes("what is this")
      )) {
        console.log(`  -> DELETING junk book (0 users)`);
        await deleteBook(bookId);
        await resolveReport(id, "Deleted junk/duplicate/non-English book entry (0 users)");
        return { kind: "fixed" };
      }

      // === AUTO-FIXABLE: Non-English WITH users — hide from search, keep for users ===
      if (bookId && userCount > 0 && (desc.includes("non-english") || desc.includes("non english"))) {
        console.log(`  -> MARKING import_only (non-English with ${userCount} users)`);
        await query(`UPDATE books SET visibility = 'import_only', updated_at = datetime('now') WHERE id = ?`, [bookId]);
        await resolveReport(id, `Auto-fixed: visibility=import_only (non-English, has ${userCount} users)`);
        return { kind: "fixed" };
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
        return { kind: "fixed" };
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
        return { kind: "fixed" };
      }

      // === AUTO-FIXABLE: Junk description (clean it) ===
      if (desc.includes("junk description") && bookId) {
        const bookDesc = r.book_desc as string | null;
        if (bookDesc) {
          // Check if description has HTML entities or is clearly junk
          const hasHtmlJunk = bookDesc.includes("&#") || bookDesc.includes("&amp;") || bookDesc.includes("<");
          const isTooShort = bookDesc.length < 20;
          const isSpammy = bookDesc.includes("AND LOTS OF THIS") || bookDesc.includes("data is provided as");
          const isNonEnglish = isLikelyNonEnglish(bookDesc);

          if (hasHtmlJunk || isTooShort || isSpammy || isNonEnglish) {
            // Clear AND flag stale so nightly-description-refresh re-enriches a
            // clean English description (works even for books WITH users — we're
            // only removing a bad description, never user data).
            const reason = isNonEnglish ? "non-English text" : hasHtmlJunk ? "HTML entities" : isTooShort ? "too short" : "spam content";
            console.log(`  -> CLEARING junk description (${reason}) + flag stale`);
            await query("UPDATE books SET description = NULL, description_stale = 1, updated_at = datetime('now') WHERE id = ?", [bookId]);
            await resolveReport(id, `Cleared junk description (${reason}); flagged description_stale for re-enrichment`);
            return { kind: "fixed" };
          } else {
            // Description exists but may need manual review
            console.log(`  -> Description exists but may need review: "${bookDesc.slice(0, 80)}..."`);
          }
        }
        // Even if we can't auto-fix the description, resolve as "reviewed"
        if (userCount === 0) {
          console.log(`  -> CLEARING description for 0-user book`);
          await query("UPDATE books SET description = NULL, description_stale = 1, updated_at = datetime('now') WHERE id = ?", [bookId]);
          await resolveReport(id, "Cleared description for book with 0 users; flagged for re-enrichment");
          return { kind: "fixed" };
        }
      }

      // === AUTO-FIXABLE: improper "unknown series" labeling → unlink it ===
      // A book wrongly attached to a series literally named "Unknown"/"Unknown
      // Series". Only fires on REMOVAL intent — reassignment to a *named* series
      // (e.g. "this belongs in series X") still needs manual review.
      if (bookId && /unknown\s+series/i.test(rawDesc) &&
          /(?:get\s+rid|remove|improper|inappropriate|should\s+(?:never|not))/i.test(rawDesc) &&
          // Skip REASSIGNMENT requests (they name a target series to move TO) —
          // those need an owner to confirm/create the target series.
          !/in\s+(?:the\s+)?series\s+["“']/i.test(rawDesc) &&
          !/belongs?\s+in\b/i.test(rawDesc) &&
          !/,\s*not\s+["“']/i.test(rawDesc)) {
        const links = await query(
          `SELECT bs.series_id FROM book_series bs JOIN series s ON s.id = bs.series_id
           WHERE bs.book_id = ? AND lower(s.name) LIKE '%unknown%'`, [bookId]);
        if (links.rows.length > 0) {
          for (const row of links.rows as any[]) {
            await query(`DELETE FROM book_series WHERE book_id = ? AND series_id = ?`, [bookId, row.series_id]);
          }
          console.log(`  -> REMOVED ${links.rows.length} improper 'unknown series' link(s)`);
          await resolveReport(id, `Auto-fixed: removed ${links.rows.length} improper "unknown series" link(s)`);
          return { kind: "fixed" };
        }
      }

      // === AUTO-FIXABLE: binding/edition cruft in title (e.g. "(Turtleback
      // School & Library Binding Edition)") → strip + regenerate slug ===
      if (bookId && bookTitle && /\bbinding\s+edition\b|turtleback/i.test(rawDesc + " " + bookTitle)) {
        const cleaned = bookTitle
          .replace(/\s*\((?:[^()]*\b(?:binding\s+edition|turtleback)[^()]*)\)\s*/gi, " ")
          .replace(/\s{2,}/g, " ").trim();
        if (cleaned && cleaned !== bookTitle) {
          await query(`UPDATE books SET title = ?, updated_at = datetime('now') WHERE id = ?`, [cleaned, bookId]);
          const newSlug = await regenerateSlug(bookId, cleaned);
          console.log(`  -> STRIPPED binding-edition text: "${bookTitle}" → "${cleaned}"${newSlug ? ` (slug ${newSlug})` : ""}`);
          await resolveReport(id, `Auto-fixed: stripped binding-edition text from title → "${cleaned}"${newSlug ? `; slug → ${newSlug}` : ""}`);
          return { kind: "fixed" };
        }
      }

      // === AUTO-FIXABLE: Sneak peek entries ===
      if ((desc.includes("sneak peek") || (bookTitle && bookTitle.includes("Sneak Peek"))) && userCount === 0 && bookId) {
        console.log(`  -> DELETING sneak peek entry (0 users)`);
        await deleteBook(bookId);
        await resolveReport(id, "Deleted 'Sneak Peek' entry (0 users, likely a preview excerpt not a real book)");
        return { kind: "fixed" };
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
        return { kind: "fixed" };
      }

      // === AUTO-FIXABLE: Author missing from slug → regenerate ===
      if (bookId && /(?:author\s+(?:not\s+)?(?:listed\s+)?in\s+slug|missing\s+from\s+slug)/i.test(rawDesc)) {
        const newSlug = await regenerateSlug(bookId, bookTitle || "");
        if (newSlug) {
          console.log(`  -> SLUG regenerated: ${newSlug}`);
          await resolveReport(id, `Auto-fixed: slug regenerated → ${newSlug}`);
          return { kind: "fixed" };
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
            return { kind: "fixed" };
          } else {
            console.log(`  -> No award pattern matched — falling back to stale-flag for re-enrichment`);
            await query(`UPDATE books SET description_stale = 1, updated_at = datetime('now') WHERE id = ?`, [bookId]);
            await resolveReport(id, "Auto-fixed: no award patterns matched — flagged description_stale for re-enrichment");
            return { kind: "fixed" };
          }
        }
      }

      // === AUTO-FIXABLE: Test reports ===
      if (desc.includes("test report")) {
        console.log(`  -> Resolving test report`);
        await resolveReport(id, "Test report acknowledged");
        return { kind: "fixed" };
      }

      // === NEEDS INPUT: Everything else ===
      console.log(`  -> NEEDS INPUT`);
      return { kind: "needsInput", item: { id, desc: rawDesc, book: bookLineWithSeriesName } };
    })();

    // Race against per-report timeout. Note: when timeout wins, the work
    // promise keeps running in the background — its in-flight queries are
    // bounded by the Turso guard's 30s per-query timeout, so they will
    // eventually settle. The report stays open and surfaces as needs-input.
    let outcome: ReportOutcome;
    try {
      outcome = await Promise.race([
        work,
        new Promise<ReportOutcome>((_, reject) =>
          setTimeout(() => reject(new Error("PER_REPORT_TIMEOUT")), PER_REPORT_TIMEOUT_MS),
        ),
      ]);
    } catch (e: any) {
      if (e?.message === "PER_REPORT_TIMEOUT") {
        const minutes = (PER_REPORT_TIMEOUT_MS / 60_000).toFixed(0);
        console.log(`  -> TIMEOUT after ${minutes} min — leaving report open for manual review`);
        outcome = {
          kind: "needsInput",
          item: { id, desc: `[TIMED OUT after ${minutes} min] ${rawDesc}`, book: bookLineWithSeriesName },
        };
      } else {
        throw e;
      }
    }

    if (outcome.kind === "fixed") fixed++;
    else needsInput.push(outcome.item);
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

  // ── Write the summary report file (the SKILL.md promised this; it had been
  //    missing since 2026-04-24, which is why nightly triage looked "dead" —
  //    the needs-input queue was vanishing into console output nobody read). ──
  const today = new Date().toISOString().slice(0, 10);
  const reportPath = path.join(process.cwd(), "reports", `nightly-triage-${today}.md`);
  const out: string[] = [];
  out.push(`# Nightly triage — ${today}`, ``);
  out.push(`- Open reports processed: ${result.rows.length}`);
  out.push(`- Auto-fixed: ${fixed}`);
  out.push(`- Needs your decision: ${needsInput.length}`, ``);
  if (fixedLog.length > 0) {
    out.push(`## Auto-fixed`, ``);
    fixedLog.forEach((f, i) => out.push(`${i + 1}. ${f}`));
    out.push(``);
  }
  if (needsInput.length > 0) {
    out.push(`## Needs your decision`, ``);
    out.push(`These are outside the auto-fixer's safe scope (series restructuring, author disambiguation, merges, external/PDF data, ambiguous requests). Review them in /admin/issues.`, ``);
    needsInput.forEach((n, i) => {
      out.push(`${i + 1}. **${n.book}**`, `   ${n.desc}`, ``);
    });
  }
  try {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, out.join("\n"));
    console.log(`\nWrote summary → ${reportPath}`);
  } catch (e) {
    console.warn(`Failed to write triage summary:`, e);
  }
}

main().catch(console.error);
