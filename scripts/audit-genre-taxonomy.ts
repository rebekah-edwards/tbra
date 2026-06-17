/**
 * READ-ONLY audit of the genres table for the Option-A hierarchy backfill.
 *
 * Buckets all genre rows by how confidently we can assign a parent:
 *   ROOT       — name (or DISPLAY_NAME) is a canonical top-level genre → parent = NULL
 *   MAPPED     — name is in GENRE_TO_TOP_LEVEL → parent = that canonical root
 *   HEURISTIC  — name contains a canonical genre word (e.g. "...Horror") → tentative parent
 *   REVIEW     — none of the above → needs a human decision
 *
 * Reports both row counts AND book-weighted counts (how many book_genres links
 * each bucket covers) so we can judge real impact, not just tag sprawl.
 *
 * Writes NOTHING. Local read only.
 */
import { createClient } from "@libsql/client";
import {
  FICTION_GENRES,
  NONFICTION_GENRES,
  CHILDRENS_AGE_CATEGORIES,
  TOP_LEVEL_WHITELIST,
  GENRE_TO_TOP_LEVEL,
  DISPLAY_NAME,
} from "../src/lib/genre-taxonomy";

const db = createClient({ url: "file:data/tbra.db" });

// Canonical roots = the curated whitelist + children's age categories.
const CANON = new Set<string>([...TOP_LEVEL_WHITELIST, ...CHILDRENS_AGE_CATEGORIES]);

// Heuristic: if a tag contains one of these words, tentatively parent it there.
// Ordered — earlier wins. Conservative on purpose; everything else → REVIEW.
const HEURISTIC_WORDS: [RegExp, string][] = [
  [/litrpg|gamelit/i, "LitRPG"],
  [/sci-?fi|science fiction|space|cyberpunk|dystopian?|apocalyp/i, "Sci-Fi"],
  [/fantasy|grimdark|sword|magic/i, "Fantasy"],
  [/horror|gothic|slasher/i, "Horror"],
  [/thriller|suspense/i, "Thriller"],
  [/mystery|detective|whodunit/i, "Mystery"],
  [/crime/i, "Crime"],
  [/romance|romantic/i, "Romance"],
  [/historical/i, "Historical Fiction"],
  [/memoir|autobiograph/i, "Memoir"],
  [/biograph/i, "Biography"],
  [/history|century|war\b/i, "History"],
  [/christian|biblical|devotional/i, "Christian Fiction"],
  [/cookbook|recipe|culinary/i, "Cookbooks"],
  [/poetry|poem/i, "Poetry"],
  [/graphic novel|comics?|manga/i, "Graphic Novel"],
  [/self-?help|personal development/i, "Self-Help"],
  [/business|leadership|management/i, "Business"],
  [/philosoph/i, "Philosophy"],
  [/psycholog/i, "Psychology"],
];

type Bucket = "ROOT" | "MAPPED" | "HEURISTIC" | "REVIEW";

function classify(name: string): { bucket: Bucket; parent: string | null } {
  const display = DISPLAY_NAME[name] || name;
  if (CANON.has(name) || CANON.has(display)) return { bucket: "ROOT", parent: null };
  const mapped = GENRE_TO_TOP_LEVEL[name];
  if (mapped) return { bucket: "MAPPED", parent: DISPLAY_NAME[mapped] || mapped };
  for (const [re, root] of HEURISTIC_WORDS) {
    if (re.test(name)) return { bucket: "HEURISTIC", parent: root };
  }
  return { bucket: "REVIEW", parent: null };
}

(async () => {
  const genres = await db.execute(
    `SELECT g.id, g.name, g.parent_genre_id,
            (SELECT COUNT(*) FROM book_genres bg WHERE bg.genre_id = g.id) AS books
     FROM genres g`
  );

  const counts: Record<Bucket, { rows: number; books: number }> = {
    ROOT: { rows: 0, books: 0 },
    MAPPED: { rows: 0, books: 0 },
    HEURISTIC: { rows: 0, books: 0 },
    REVIEW: { rows: 0, books: 0 },
  };
  let alreadyParented = 0;
  const reviewSamples: { name: string; books: number }[] = [];

  for (const row of genres.rows) {
    const name = row.name as string;
    const books = Number(row.books);
    if (row.parent_genre_id) alreadyParented++;
    const { bucket } = classify(name);
    counts[bucket].rows++;
    counts[bucket].books += books;
    if (bucket === "REVIEW") reviewSamples.push({ name, books });
  }

  const total = genres.rows.length;
  const totalLinks = (Object.values(counts) as { books: number }[]).reduce((a, c) => a + c.books, 0);

  console.log(`\n=== GENRE TAXONOMY AUDIT ===`);
  console.log(`Total genre rows: ${total}`);
  console.log(`Already have a parent_genre_id: ${alreadyParented}`);
  console.log(`Total book_genres links: ${totalLinks}\n`);

  const pct = (n: number, d: number) => `${((n / d) * 100).toFixed(1)}%`;
  for (const b of ["ROOT", "MAPPED", "HEURISTIC", "REVIEW"] as Bucket[]) {
    const c = counts[b];
    console.log(
      `${b.padEnd(10)} rows=${String(c.rows).padStart(5)} (${pct(c.rows, total).padStart(6)})   ` +
        `book-links=${String(c.books).padStart(6)} (${pct(c.books, totalLinks).padStart(6)})`
    );
  }

  // The long tail of REVIEW, sorted by impact — show the heaviest first.
  reviewSamples.sort((a, b) => b.books - a.books);
  const reviewWithBooks = reviewSamples.filter((r) => r.books > 0);
  const reviewOrphans = reviewSamples.filter((r) => r.books === 0);
  console.log(`\nREVIEW breakdown: ${reviewWithBooks.length} tags attached to ≥1 book, ${reviewOrphans.length} orphan tags (0 books)`);
  console.log(`\nTop 40 REVIEW tags by book count (these are where human input matters most):`);
  for (const r of reviewSamples.slice(0, 40)) {
    console.log(`  ${String(r.books).padStart(4)}  ${r.name}`);
  }

  // Duplicate-root detection: canonical names that exist as MULTIPLE rows.
  const byDisplay = new Map<string, number>();
  for (const row of genres.rows) {
    const name = row.name as string;
    if (CANON.has(name) || CANON.has(DISPLAY_NAME[name] || name)) {
      const d = DISPLAY_NAME[name] || name;
      byDisplay.set(d, (byDisplay.get(d) ?? 0) + 1);
    }
  }
  const dupes = [...byDisplay.entries()].filter(([, n]) => n > 1);
  console.log(`\nCanonical roots that exist as duplicate rows (need merge into one root): ${dupes.length}`);
  for (const [name, n] of dupes.sort((a, b) => b[1] - a[1])) console.log(`  ${name} ×${n}`);
})();
