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
 *   GOOGLE_PACE_MS  delay between author queries       (default 1100)
 *   GOOGLE_RETRIES  retries per author on a 429/503    (default 2)
 *   UPCOMING_DATE_LOOKUP_MAX  books/run given one Brave call to recover an
 *                   exact release date Google gave only to year/month
 *                   precision; 0 disables it entirely (default 10)
 *   CURSOR_FILE     rotation cursor path               (default data/upcoming-authors-cursor.json)
 *   DRY_RUN=1       fetch + filter + log, write nothing
 *
 * PACING (2026-08-08): the 429/503 storm this lane suffered was Google's
 * PER-MINUTE rate limit, not the daily Queries-per-day quota — a probe issued
 * immediately after a run that had "exhausted" its quota returned HTTP 200. At
 * the old 150ms pacing the run issued ~400 queries/min against a limit far
 * below that, so a third of every night's authors bounced and landed in the
 * deferred queue (52/150 failed on 2026-08-08). GOOGLE_PACE_MS now defaults to
 * 1100 (~55 queries/min) and each author gets GOOGLE_RETRIES extra attempts
 * behind exponential backoff before being deferred. A 150-author run therefore
 * spends ~3min in Google calls instead of ~25s; it runs at 3:09 AM, so nobody
 * is waiting on it. NOTE: a 503 here is genuinely ambiguous — it is returned
 * for BOTH per-minute throttling and daily exhaustion — so the retry ladder is
 * what distinguishes them: throttling clears within a few seconds, real
 * exhaustion keeps failing and trips QUOTA_ABORT_STREAK.
 *
 * DATE PRECISION (2026-08-14): Google often returns only a YEAR for a volume
 * that has not shipped yet ("publishedDate": "2027"). normalizePubDate refuses
 * to fabricate a day for that, so such books used to land with
 * `publication_date = NULL` while still being counted as `added` — invisible in
 * the run report. That is survivable for a future year (isBookPrePublication
 * falls back to `publicationYear > currentYear`) but NOT for a title releasing
 * later in the CURRENT year, which then reads as already published. So a
 * year/month-precision volume now gets ONE corroborated Brave search
 * (findReleaseDateViaBrave) to recover the exact date, capped at
 * UPCOMING_DATE_LOOKUP_MAX per run and switched off for the remainder of the
 * run the moment Brave reports the shared budget is gone. This makes the lane
 * *nearly* Brave-free rather than strictly Brave-free — worst case 10 calls of
 * the shared 8,000/day. Anything still dateless after the lookup and enrichment
 * is flagged needs_review ("missing: exact release date") instead of being
 * given a fabricated January 1st. Set UPCOMING_DATE_LOOKUP_MAX=0 to restore the
 * strictly-zero-Brave behaviour.
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
import { findReleaseDateViaBrave } from "../src/lib/enrichment/release-date";

const MAX_AUTHORS = Number(process.env.MAX_AUTHORS ?? 150);
const MAX_BOOKS = Number(process.env.MAX_BOOKS ?? 60);
const HORIZON_MONTHS = Number(process.env.HORIZON_MONTHS ?? 18);
// Halved from 800 on 2026-08-08. Google Books allows 1,000 queries/day and the
// limit is NOT raisable — the Cloud Console offers no increase beyond 1K, so
// the only way to fund the description tier is to split the fixed allowance.
// Rebekah's call: 500/500. This lane runs at 3:09 AM ET, before
// nightly-description-refresh, so stopping at 500 leaves the rest for it under
// the shared `google_books` counter rather than racing it to exhaustion.
const GOOGLE_MAX = Number(process.env.GOOGLE_MAX ?? 500);
const CURSOR_FILE = process.env.CURSOR_FILE || "data/upcoming-authors-cursor.json";
const DRY_RUN = process.env.DRY_RUN === "1";
// Ceiling on the re-check queue (see selectAuthors) so a long Google outage
// can't grow it without bound.
const DEFERRED_MAX = Number(process.env.DEFERRED_MAX ?? 3000);
// Consecutive quota failures before we stop burning the remaining pacing delay
// on calls that cannot succeed; everything unqueried is deferred to next run.
const QUOTA_ABORT_STREAK = Number(process.env.QUOTA_ABORT_STREAK ?? 12);
// Gap between author queries. ~1100ms ≈ 55/min, under Google's per-minute
// ceiling; see the PACING note in the header before lowering this.
const GOOGLE_PACE_MS = Number(process.env.GOOGLE_PACE_MS ?? 1100);
// Extra attempts for one author after a 429/503, behind exponential backoff.
const GOOGLE_RETRIES = Number(process.env.GOOGLE_RETRIES ?? 2);
// Books per run allowed ONE Brave call to recover an exact release date that
// Google only gave to year/month precision (see the DATE PRECISION note in the
// header). 0 disables the lookup entirely and restores the strictly-zero-Brave
// behaviour. 10/night is ~0.1% of the shared 8,000/day cap.
const DATE_LOOKUP_MAX = Number(process.env.UPCOMING_DATE_LOOKUP_MAX ?? 10);

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
  let dateRecovered = 0;
  let dateUnresolved = 0;
  let dateLookups = 0;
  // Flipped once Brave reports the shared budget is gone (or the key is bad):
  // the remaining books skip the lookup instead of re-throwing per book.
  let dateLookupOff = DATE_LOOKUP_MAX <= 0;

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

    await delay(GOOGLE_PACE_MS); // pacing against Google's per-minute limit
    let volumes;
    try {
      // Retry ladder: a 429/503 is ambiguous between per-minute throttling
      // (clears in seconds) and daily exhaustion (never clears this run). Back
      // off and re-ask; if it still fails the author is deferred and the
      // quotaStreak counter escalates toward the whole-run abort.
      let res = null;
      for (let attempt = 0; attempt <= GOOGLE_RETRIES; attempt++) {
        if (attempt > 0) {
          const backoffMs = GOOGLE_PACE_MS * 2 ** attempt; // 2.2s, 4.4s
          console.log(
            `[upcoming] retry ${attempt}/${GOOGLE_RETRIES} for "${authorName}" after ${backoffMs}ms`,
          );
          await delay(backoffMs);
        }
        if (googleCalls >= GOOGLE_MAX) break;
        googleCalls++;
        const r = await searchGoogleBooksByAuthorNewestDetailed(authorName, 12);
        if (r.ok || !r.quotaExhausted) {
          res = r;
          break;
        }
        res = r; // keep the last failure for the diagnostics below
      }

      if (!res || !res.ok) {
        // The call never landed, so this author was NOT checked — re-queue.
        deferred.push(authorName);
        if (res?.quotaExhausted) {
          quotaStreak++;
          if (quotaStreak >= QUOTA_ABORT_STREAK) {
            console.warn(
              `[upcoming] ${quotaStreak} consecutive Google quota failures (status ${res.status}) ` +
                `that survived ${GOOGLE_RETRIES} backoff retries each — this is the DAILY ` +
                `Queries-per-day limit, not per-minute throttling. Deferring the rest of this run.`,
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

      // DATE PRECISION RECOVERY. Google routinely gives a forthcoming volume
      // only a year ("2027"), and normalizePubDate rightly refuses to invent a
      // day for it — so `norm.date` is null and the book would land with no
      // publication_date at all. One corroborated web search usually recovers
      // the exact date from a retailer/publisher listing. Bounded by
      // DATE_LOOKUP_MAX per run and disabled for the rest of the run the moment
      // Brave reports the shared budget is gone, so this can never become the
      // thing that starves the priority lanes.
      // Runs in DRY_RUN too (bounded by the same cap) so a dry run previews the
      // date the real run would store, and so this path is testable at all.
      let exactDate: string | null = norm.precision === "day" ? norm.date : null;
      if (!exactDate && !dateLookupOff) {
        if (dateLookups >= DATE_LOOKUP_MAX) {
          dateLookupOff = true;
        } else {
          dateLookups++;
          const expectYear = norm.year ?? Number(cmp.slice(0, 4));
          try {
            exactDate = await findReleaseDateViaBrave(
              finalTitle, primaryAuthor, isbn13, isbn10, expectYear,
            );
            if (exactDate) {
              dateRecovered++;
              console.log(`  [date-recovered] "${finalTitle}" — ${norm.precision}-only → ${exactDate}`);
            }
          } catch (err) {
            // API_EXHAUSTED / API_KEY_INVALID — stop asking for this run rather
            // than failing the book; the year-only fallback below still applies.
            const code = (err as Error & { code?: string }).code ?? "";
            console.warn(`  [date-lookup] disabled for this run (${code || (err as Error).message})`);
            dateLookupOff = true;
          }
        }
      }
      // Month precision ("2026-09") is still better than nothing, so keep it
      // when no exact date was recovered.
      const storedDate = exactDate ?? norm.date;
      if (!storedDate) dateUnresolved++;
      const displayDate = storedDate ?? cmp;

      if (DRY_RUN) {
        console.log(
          `  [would-add] "${finalTitle}" — ${primaryAuthor} — ${displayDate} ` +
            `(isbn13=${isbn13 ?? "—"}, precision=${norm.precision})`,
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
            publicationDate: storedDate, // recovered exact date, else month precision, else null
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
        columns: { publicationYear: true, publicationDate: true, reviewReason: true },
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

      // Still no date after both the lookup and enrichment (which may have
      // filled it from ISBNdb). The book is only visibly "coming soon" while
      // its year is still in the future — a year-only title releasing later
      // THIS year reads as already published — so flag it for /admin rather
      // than fabricating a January 1st date nobody can distinguish from a real one.
      if (!fresh?.publicationDate) {
        const reason = fresh?.reviewReason?.trim();
        await db
          .update(books)
          .set({
            needsReview: true,
            reviewReason: reason ? `${reason}; missing: exact release date` : "missing: exact release date",
          })
          .where(eq(books.id, book.id));
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
      `dateLookups=${dateLookups} dateRecovered=${dateRecovered} dateUnresolved=${dateUnresolved} ` +
      `retried=${retried} deferred=${new Set(deferred).size}`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("[upcoming] fatal:", err);
  process.exit(1);
});
