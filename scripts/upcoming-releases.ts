/**
 * Upcoming-releases lane — imports FORTHCOMING titles from buzz authors.
 *
 * Runs with: npx tsx scripts/upcoming-releases.ts
 *
 * WHY a separate lane: no metadata source lets us query "books published in the
 * future" directly. But Google Books supports `inauthor:"…"` + `orderBy=newest`,
 * and we already maintain a corpus of buzz authors — NYT bestseller authors plus
 * the authors our own readers actively favorite/shelve. So the design is
 * author-driven: for each buzz author, pull their newest/forthcoming volumes and
 * keep only the ones dated today … today+HORIZON_MONTHS. Those get inserted with
 * `publication_date` set, so `isBookPrePublication()` lights them up as preorders.
 *
 * The buzz-author pool is rotated through a persisted cursor (MAX_AUTHORS/night),
 * so every author is re-checked for a new announcement every few weeks. At the
 * default 150 authors/night this touches Google Books ~150× (well under the
 * 1,000/day free quota) and never hits Brave or OpenLibrary.
 *
 * This script writes LOCAL only (like nightly-import.ts). The scheduled task
 * wraps it in pull → run → push so the new books reach Turso.
 *
 * Env knobs:
 *   MAX_AUTHORS     authors to process this run        (default 150)
 *   MAX_BOOKS       net new books to insert, then stop (default 60)
 *   HORIZON_MONTHS  how far ahead counts as "upcoming" (default 18)
 *   GOOGLE_MAX      hard cap on Google Books calls     (default 800)
 *   CURSOR_FILE     rotation cursor path               (default data/upcoming-authors-cursor.json)
 *   DRY_RUN=1       fetch + filter + log, write nothing
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { existsSync, readFileSync, writeFileSync } from "fs";

import { db } from "../src/db";
import { books, authors, bookAuthors, nytBestsellers, userFavoriteBooks, userBookState } from "../src/db/schema";
import { eq, and, gte, lte, isNotNull, sql } from "drizzle-orm";
import {
  searchGoogleBooksByAuthorNewestDetailed,
  getGoogleBooksIsbns,
  getGoogleBooksCoverUrl,
} from "../src/lib/google-books";
import { normalizePubDate } from "../src/lib/publication-date";
import { classifyBook } from "../src/lib/enrichment/enrichable";
import { validateBookTitle } from "../src/lib/book-validation";
import { isBoxSetTitle } from "../src/lib/queries/books";
import { assignBookSlug, findBookBySlugCollision } from "../src/lib/utils/slugify";
import { updateSearchIndex } from "../src/lib/search/search-index";
import { enrichBook } from "../src/lib/enrichment/enrich-book";

const MAX_AUTHORS = Number(process.env.MAX_AUTHORS ?? 150);
const MAX_BOOKS = Number(process.env.MAX_BOOKS ?? 60);
const HORIZON_MONTHS = Number(process.env.HORIZON_MONTHS ?? 18);
const GOOGLE_MAX = Number(process.env.GOOGLE_MAX ?? 800);
const CURSOR_FILE = process.env.CURSOR_FILE || "data/upcoming-authors-cursor.json";
const DRY_RUN = process.env.DRY_RUN === "1";
// Ceiling on the re-check queue (see selectAuthors) so a long Google outage
// can't grow it without bound.
const DEFERRED_MAX = Number(process.env.DEFERRED_MAX ?? 3000);
// Consecutive quota failures before we stop burning the remaining pacing delay
// on calls that cannot succeed; everything unqueried is deferred to next run.
const QUOTA_ABORT_STREAK = Number(process.env.QUOTA_ABORT_STREAK ?? 12);

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Buzz-author seed pool: NYT bestseller authors ∪ authors our readers favorite
// or shelve. All as plain name strings (the Google query is by author NAME).
// ---------------------------------------------------------------------------
async function buildAuthorPool(): Promise<string[]> {
  const names = new Set<string>();

  // 1. NYT bestseller authors (curated buzz signal).
  const nyt = await db
    .select({ author: nytBestsellers.author })
    .from(nytBestsellers)
    .where(isNotNull(nytBestsellers.author));
  for (const row of nyt) {
    if (row.author?.trim()) names.add(row.author.trim());
  }

  // 2. Authors of books our users have FAVORITED.
  const faved = await db
    .selectDistinct({ name: authors.name })
    .from(userFavoriteBooks)
    .innerJoin(bookAuthors, eq(bookAuthors.bookId, userFavoriteBooks.bookId))
    .innerJoin(authors, eq(authors.id, bookAuthors.authorId));
  for (const row of faved) {
    if (row.name?.trim()) names.add(row.name.trim());
  }

  // 3. Authors of books our users have SHELVED (any reading state).
  const shelved = await db
    .selectDistinct({ name: authors.name })
    .from(userBookState)
    .innerJoin(bookAuthors, eq(bookAuthors.bookId, userBookState.bookId))
    .innerJoin(authors, eq(authors.id, bookAuthors.authorId));
  for (const row of shelved) {
    if (row.name?.trim()) names.add(row.name.trim());
  }

  // Stable sort so the rotation cursor stays meaningful across runs.
  return [...names].sort((a, b) => a.localeCompare(b));
}

type Cursor = { index: number; updatedAt?: string; deferred?: string[] };

function readCursor(): Cursor {
  if (!existsSync(CURSOR_FILE)) return { index: 0, deferred: [] };
  try {
    const raw = JSON.parse(readFileSync(CURSOR_FILE, "utf-8"));
    return {
      index: typeof raw.index === "number" ? raw.index : 0,
      deferred: Array.isArray(raw.deferred) ? raw.deferred.filter((a: unknown) => typeof a === "string") : [],
    };
  } catch {
    return { index: 0, deferred: [] };
  }
}

/**
 * Rotate through the pool, but drain the DEFERRED queue first.
 *
 * Authors land in `deferred` when a previous run selected them and never got a
 * real answer from Google — quota exhaustion, a network failure, or the run
 * hitting MAX_BOOKS/GOOGLE_MAX before reaching them. Without this they were
 * simply skipped: the cursor advanced by MAX_AUTHORS regardless of how many
 * queries actually landed, so a quota-starved night silently cost those authors
 * a full trip around the ~7.7k pool (weeks) before they'd be looked at again.
 *
 * Deferred authors take at most half the run so the pool keeps rotating even if
 * the queue is persistently backed up.
 */
function selectAuthors(pool: string[]): {
  selected: string[];
  nextIndex: number;
  retried: number;
  /** Queue entries this run had no room for — must be written back or they're lost. */
  carryOver: string[];
} {
  if (pool.length === 0) return { selected: [], nextIndex: 0, retried: 0, carryOver: [] };

  const cursor = readCursor();
  const index = ((cursor.index % pool.length) + pool.length) % pool.length;
  const take = Math.min(MAX_AUTHORS, pool.length);

  // Only retry authors still in the pool (a name can drop out if the shelving
  // or favorite that put it there went away).
  const inPool = new Set(pool);
  const queue = (cursor.deferred ?? []).filter((a) => inPool.has(a));

  const retryBudget = Math.min(queue.length, Math.floor(take / 2));
  const selected = queue.slice(0, retryBudget);
  const chosen = new Set(selected);

  // Fill the rest from the rotation, advancing the cursor only by what we take.
  let advanced = 0;
  while (selected.length < take && advanced < pool.length) {
    const name = pool[(index + advanced) % pool.length];
    advanced++;
    if (chosen.has(name)) continue; // already queued as a retry this run
    selected.push(name);
    chosen.add(name);
  }

  return {
    selected,
    nextIndex: (index + advanced) % pool.length,
    retried: retryBudget,
    carryOver: queue.slice(retryBudget),
  };
}

/**
 * Persist the cursor plus whatever this run failed to actually check.
 * Capped so a long outage can't grow the queue without bound.
 */
function writeCursor(nextIndex: number, deferred: string[]) {
  if (DRY_RUN) return;
  const unique = [...new Set(deferred)].slice(0, DEFERRED_MAX);
  writeFileSync(
    CURSOR_FILE,
    JSON.stringify({ index: nextIndex, updatedAt: new Date().toISOString(), deferred: unique }),
  );
}

// ISO date strings for today and the horizon (local components, no UTC drift).
function bounds(): { todayIso: string; horizonIso: string } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const horizon = new Date(now.getFullYear(), now.getMonth() + HORIZON_MONTHS, now.getDate());
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { todayIso: iso(today), horizonIso: iso(horizon) };
}

// Turn a normalized pub-date into a single comparable ISO date at the EARLIEST
// plausible day for its precision (so "2026" → 2026-01-01, "2026-09" → 2026-09-01).
function comparableDate(norm: ReturnType<typeof normalizePubDate>): string | null {
  if (norm.precision === "day" && norm.date) return norm.date;
  if (norm.precision === "month" && norm.date) return `${norm.date}-01`;
  if (norm.precision === "year" && norm.year) return `${norm.year}-01-01`;
  return null;
}

async function alreadyHave(
  isbn13: string | null,
  isbn10: string | null,
  title: string,
  author: string | null,
): Promise<boolean> {
  if (isbn13) {
    const e = await db.query.books.findFirst({ where: eq(books.isbn13, isbn13) });
    if (e) return true;
  }
  if (isbn10) {
    const e = await db.query.books.findFirst({ where: eq(books.isbn10, isbn10) });
    if (e) return true;
  }
  // Title+author equivalence via the would-be slug (catches reprints/format
  // variants that arrive with a different ISBN).
  const collision = await findBookBySlugCollision(title, author);
  return collision != null;
}

async function findOrCreateAuthor(name: string): Promise<string> {
  const existing = await db.query.authors.findFirst({ where: eq(authors.name, name) });
  if (existing) return existing.id;
  const [created] = await db.insert(authors).values({ name }).returning();
  return created.id;
}

async function main() {
  if (!process.env.GOOGLE_BOOKS_API_KEY) {
    console.error("[upcoming] GOOGLE_BOOKS_API_KEY not set — aborting.");
    process.exit(1);
  }

  const { todayIso, horizonIso } = bounds();
  console.log(
    `[upcoming] mode=${DRY_RUN ? "DRY_RUN" : "WRITE"} window=${todayIso}…${horizonIso} ` +
      `MAX_AUTHORS=${MAX_AUTHORS} MAX_BOOKS=${MAX_BOOKS} GOOGLE_MAX=${GOOGLE_MAX}`,
  );

  const pool = await buildAuthorPool();
  console.log(`[upcoming] buzz-author pool: ${pool.length} unique authors`);
  const { selected, nextIndex, retried, carryOver } = selectAuthors(pool);
  console.log(
    `[upcoming] processing ${selected.length} authors this run` +
      (retried ? ` (${retried} re-checks from the deferred queue)` : ""),
  );

  let googleCalls = 0;
  let inserted = 0;
  let reprintDemoted = 0;
  let candidatesSeen = 0;
  let skippedDupe = 0;
  let skippedJunk = 0;
  let quotaStreak = 0;

  // Authors this run selected but never got a real answer for. They are written
  // back to the cursor so the next run re-checks them instead of leaving them
  // unexamined until the pool rotates all the way around.
  // Seeded with the queue overflow this run had no room for, so those authors
  // survive the cursor write instead of being dropped.
  const deferred: string[] = [...carryOver];
  const deferRest = (fromIndex: number) => {
    for (let i = fromIndex; i < selected.length; i++) deferred.push(selected[i]);
  };

  for (const [i, authorName] of selected.entries()) {
    if (inserted >= MAX_BOOKS) {
      console.log(`[upcoming] reached MAX_BOOKS=${MAX_BOOKS}, stopping.`);
      deferRest(i);
      break;
    }
    if (googleCalls >= GOOGLE_MAX) {
      console.log(`[upcoming] reached GOOGLE_MAX=${GOOGLE_MAX}, stopping.`);
      deferRest(i);
      break;
    }

    await delay(150); // gentle pacing against Google Books
    googleCalls++;
    let volumes;
    try {
      const res = await searchGoogleBooksByAuthorNewestDetailed(authorName, 12);
      if (!res.ok) {
        // The call never landed, so this author was NOT checked — re-queue.
        deferred.push(authorName);
        if (res.quotaExhausted) {
          quotaStreak++;
          if (quotaStreak >= QUOTA_ABORT_STREAK) {
            console.warn(
              `[upcoming] ${quotaStreak} consecutive Google quota failures (status ${res.status}) — ` +
                `daily Queries-per-day limit is spent. Deferring the rest of this run's authors.`,
            );
            deferRest(i + 1);
            break;
          }
        }
        continue;
      }
      quotaStreak = 0;
      volumes = res.volumes;
    } catch (err) {
      console.warn(`[upcoming] Google query failed for "${authorName}":`, err);
      deferred.push(authorName);
      continue;
    }

    for (const vol of volumes) {
      if (inserted >= MAX_BOOKS) break;
      const info = vol.volumeInfo;
      if (!info?.title) continue;

      // Keep only volumes whose (earliest-plausible) date is in the future window.
      const norm = normalizePubDate(info.publishedDate);
      const cmp = comparableDate(norm);
      if (!cmp || cmp < todayIso || cmp > horizonIso) continue;
      candidatesSeen++;

      const { isbn13, isbn10 } = getGoogleBooksIsbns(vol);
      const volAuthors = (info.authors ?? []).filter((a) => a?.trim());
      const primaryAuthor = volAuthors[0] ?? authorName;

      // Dedup against the existing catalog.
      if (await alreadyHave(isbn13, isbn10, info.title, primaryAuthor)) {
        skippedDupe++;
        continue;
      }

      // Title validation + junk gate (same policy as the ISBNdb importer).
      const validation = validateBookTitle(info.title);
      if (!validation.ok) {
        skippedJunk++;
        continue;
      }
      const finalTitle = validation.title;
      const isBox = isBoxSetTitle(finalTitle);
      const isJunk =
        !isBox &&
        classifyBook({
          title: finalTitle,
          isbn13,
          isbn10,
          asin: null,
          description: info.description ?? null,
          summary: null,
          publicationYear: norm.year,
          language: null,
          isBoxSet: false,
        }).clearlyUnwanted;
      if (isJunk) {
        skippedJunk++;
        // import_only books are off the public catalog — for a discovery lane
        // there's no shelving user to attach them to, so we simply skip.
        continue;
      }

      const coverUrl = getGoogleBooksCoverUrl(vol);
      const displayDate = norm.date ?? cmp;

      if (DRY_RUN) {
        console.log(
          `  [would-add] "${finalTitle}" — ${primaryAuthor} — ${displayDate} ` +
            `(isbn13=${isbn13 ?? "—"})`,
        );
        inserted++;
        continue;
      }

      // Insert with publication_date set so isBookPrePublication() flags it.
      let book;
      try {
        [book] = await db
          .insert(books)
          .values({
            title: finalTitle,
            description: info.description ?? null,
            publicationDate: norm.date, // ISO day/month precision, or null
            // Leave year NULL so enrichment fills the ORIGINAL publication year
            // from OL/ISBNdb. The reprint guard below compares that against the
            // release date to catch backlist reprints masquerading as preorders.
            publicationYear: null,
            isbn13,
            isbn10,
            pages: info.pageCount ?? null,
            coverImageUrl: coverUrl ?? null,
            isBoxSet: isBox,
            visibility: "public",
          })
          .returning();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // ISBN UNIQUE collision missed by dedup (format drift) — treat as dupe.
        if (msg.includes("UNIQUE constraint failed")) {
          skippedDupe++;
          continue;
        }
        console.warn(`[upcoming] insert failed for "${finalTitle}":`, msg);
        continue;
      }

      // Link authors.
      for (const name of volAuthors.length ? volAuthors : [authorName]) {
        const authorId = await findOrCreateAuthor(name);
        await db.insert(bookAuthors).values({ bookId: book.id, authorId }).onConflictDoNothing();
      }

      // Slug + search index so it's linkable/searchable immediately.
      await assignBookSlug(book.id, finalTitle, primaryAuthor);
      await updateSearchIndex(book.id);

      // Enrich to fill metadata/genres/cover gaps from the FREE structured
      // sources (OL / ISBNdb / LoC / Google Books). skipAuthorDiscovery so we
      // don't balloon the catalog with backlists. skipContentSearch is what
      // actually keeps this lane off the Brave budget: skipBrave alone does NOT
      // (the content-analysis + audiobook searches ignore it), so without this
      // every preorder would spend ~6 Brave calls and — on a night the shared
      // daily cap is already spent by nightly-discovery — throw API_EXHAUSTED and
      // land as a bare shell. Content ratings are deferred to the nightly
      // content-ratings backfill, which picks these public books up on its own
      // Brave budget. enrichBook only fills EMPTY fields, so our Google date survives.
      try {
        await enrichBook(book.id, { skipAuthorDiscovery: true, skipBrave: true, skipContentSearch: true });
      } catch (err) {
        console.warn(`  enrichment failed for "${finalTitle}":`, err);
      }

      // REPRINT GUARD. Google's orderBy=newest surfaces new EDITIONS of old
      // works (a 2026 reprint of a 1980 classic). Enrichment has now filled the
      // original publication year from OL/ISBNdb; if it predates the release
      // date, this is a reprint, not a debut — the future date is an edition
      // date. Per the project's original-publication-year semantics, clear the
      // book-level preorder date so it isn't mislabeled as "coming soon". The
      // book stays in the catalog with its correct original year.
      const futureYear = Number(displayDate.slice(0, 4));
      const fresh = await db.query.books.findFirst({
        where: eq(books.id, book.id),
        columns: { publicationYear: true },
      });
      const py = fresh?.publicationYear ?? null;
      if (py != null && py < futureYear) {
        await db.update(books).set({ publicationDate: null }).where(eq(books.id, book.id));
        reprintDemoted++;
        console.log(`  [reprint-demoted] "${finalTitle}" — original year ${py} < release ${futureYear}`);
        continue;
      }

      // Genuine forthcoming release — keep the date; backfill year if enrichment
      // found none (a brand-new work's original year IS its release year).
      if (py == null) {
        await db.update(books).set({ publicationYear: futureYear }).where(eq(books.id, book.id));
      }
      inserted++;
      console.log(`  [added] "${finalTitle}" — ${primaryAuthor} — ${displayDate}`);
    }
  }

  // Advance the cursor and persist the re-check queue in one place, so an
  // author is only ever marked "checked" once Google actually answered for them.
  writeCursor(nextIndex, deferred);

  console.log(
    `[upcoming] Done. ${DRY_RUN ? "would-add" : "added"}=${inserted} ` +
      `reprintDemoted=${reprintDemoted} candidates=${candidatesSeen} ` +
      `skipped(dupe=${skippedDupe}, junk=${skippedJunk}) googleCalls=${googleCalls} ` +
      `retried=${retried} deferred=${new Set(deferred).size}`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("[upcoming] fatal:", err);
  process.exit(1);
});
