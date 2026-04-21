/**
 * audit-multi-series.ts — READ-ONLY scope report.
 *
 * Classifies every book linked to 2+ series into one of:
 *   - legit_parent_sub    — one series name contains the other, same primary
 *                           author on both. e.g. Star Wars: Thrawn + Star Wars.
 *   - exact_name_dupe     — series names match case-insensitively, different
 *                           series_ids. e.g. Circuit | Circuit.
 *   - near_dupe           — punctuation/whitespace/case variants normalize to
 *                           the same string. e.g. Waylon | Waylon!
 *   - cross_author_wrong  — the book's primary author doesn't match ANY of
 *                           the linked series' primary authors. Likely a
 *                           fuzzy-title auto-link bug (like Legend → Drenai).
 *   - unclassified        — no heuristic fired. Needs manual review.
 *
 * Writes reports/multi-series-audit-<timestamp>.json with full detail +
 * prints a summary table to stdout.
 */
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const db = new Database(path.join(process.cwd(), "data", "tbra.db"), { readonly: true });

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** Unifies &/and/+/plus/en, strips "the/a/an", strips trailing plural (s/es). */
function aggressiveNormalize(s: string): string {
  let r = s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  r = r.replace(/\s*&\s*/g, " and ").replace(/\s*\+\s*/g, " and ").replace(/\bplus\b/g, "and").replace(/\ben\b/g, "and");
  r = r.replace(/\b(the|a|an)\b/g, "");
  const tokens = r.split(/[^a-z0-9]+/).filter(Boolean).map((t) => {
    if (t.length > 3 && t.endsWith("es")) return t.slice(0, -2);
    if (t.length > 3 && t.endsWith("s")) return t.slice(0, -1);
    return t;
  });
  return tokens.join("");
}

type Category =
  | "legit_parent_sub"
  | "exact_name_dupe"
  | "near_dupe"
  | "wrong_sibling_series"  // book author matches ONE series but not the other → the other is the bad link
  | "cross_author_wrong"    // book author matches neither series — ambiguous
  | "unclassified";

type Row = {
  book_id: string;
  book_slug: string | null;
  book_title: string;
  book_primary_author: string | null;
  series_a_id: string;
  series_a_name: string;
  series_a_primary_author: string | null;
  series_b_id: string;
  series_b_name: string;
  series_b_primary_author: string | null;
};

console.log("=== audit-multi-series.ts ===\n");

// Pull every book with 2+ series linked, with series + author context.
// Windowed so each (book, seriesA, seriesB) pair shows up once.
const rows = db
  .prepare(
    `
    WITH multi_books AS (
      SELECT book_id FROM book_series GROUP BY book_id HAVING COUNT(*) > 1
    ),
    book_primary_author AS (
      SELECT ba.book_id, a.name
      FROM book_authors ba
      JOIN authors a ON a.id = ba.author_id
      WHERE ba.book_id IN (SELECT book_id FROM multi_books)
      GROUP BY ba.book_id
      HAVING ba.rowid = MIN(ba.rowid)
    ),
    series_primary_author AS (
      SELECT s.id AS series_id,
             (SELECT a2.name FROM authors a2
              JOIN book_authors ba2 ON ba2.author_id = a2.id
              JOIN book_series bs2 ON bs2.book_id = ba2.book_id
              WHERE bs2.series_id = s.id
              GROUP BY a2.id
              ORDER BY COUNT(*) DESC
              LIMIT 1) AS author_name
      FROM series s
      WHERE s.id IN (SELECT series_id FROM book_series WHERE book_id IN (SELECT book_id FROM multi_books))
    )
    SELECT
      b.id AS book_id, b.slug AS book_slug, b.title AS book_title,
      bpa.name AS book_primary_author,
      bs_a.series_id AS series_a_id, s_a.name AS series_a_name,
      spa_a.author_name AS series_a_primary_author,
      bs_b.series_id AS series_b_id, s_b.name AS series_b_name,
      spa_b.author_name AS series_b_primary_author
    FROM multi_books mb
    JOIN books b ON b.id = mb.book_id
    LEFT JOIN book_primary_author bpa ON bpa.book_id = b.id
    JOIN book_series bs_a ON bs_a.book_id = b.id
    JOIN series s_a ON s_a.id = bs_a.series_id
    LEFT JOIN series_primary_author spa_a ON spa_a.series_id = s_a.id
    JOIN book_series bs_b ON bs_b.book_id = b.id AND bs_b.series_id > bs_a.series_id
    JOIN series s_b ON s_b.id = bs_b.series_id
    LEFT JOIN series_primary_author spa_b ON spa_b.series_id = s_b.id
  `,
  )
  .all() as Row[];

console.log(`Found ${rows.length.toLocaleString()} multi-series pairs across ${new Set(rows.map(r => r.book_id)).size.toLocaleString()} distinct books.\n`);

const buckets: Record<Category, Row[]> = {
  legit_parent_sub: [],
  exact_name_dupe: [],
  near_dupe: [],
  wrong_sibling_series: [],
  cross_author_wrong: [],
  unclassified: [],
};

function classify(r: Row): Category {
  const nameA = r.series_a_name;
  const nameB = r.series_b_name;
  const authorA = r.series_a_primary_author;
  const authorB = r.series_b_primary_author;
  const bookAuthor = r.book_primary_author;

  // 1. Exact name match (case-insensitive)
  if (nameA.toLowerCase() === nameB.toLowerCase()) return "exact_name_dupe";

  // 2. Near-dupe (normalized name match — strips punct/case)
  if (normalize(nameA) === normalize(nameB)) return "near_dupe";

  // 2b. Aggressive near-dupe (&/and/+/plural/"the") — require same primary author
  if (aggressiveNormalize(nameA) === aggressiveNormalize(nameB) && authorA && authorB && normalize(authorA) === normalize(authorB)) {
    return "near_dupe";
  }

  // 3. Parent/sub — one name contains the other AND they share primary author
  const aContainsB = nameA.toLowerCase().includes(nameB.toLowerCase());
  const bContainsA = nameB.toLowerCase().includes(nameA.toLowerCase());
  if ((aContainsB || bContainsA) && authorA && authorB && normalize(authorA) === normalize(authorB)) {
    return "legit_parent_sub";
  }

  // 4. Wrong-sibling — book author matches exactly ONE series. The other is
  //    the bad link (same pattern as the Legend → Drenai Saga bug).
  if (bookAuthor && authorA && authorB) {
    const bn = normalize(bookAuthor);
    const matchesA = normalize(authorA) === bn;
    const matchesB = normalize(authorB) === bn;
    if (matchesA !== matchesB) return "wrong_sibling_series";
    if (!matchesA && !matchesB) return "cross_author_wrong";
  }

  return "unclassified";
}

/** For wrong_sibling_series rows: which series_id is the spurious link we'd delete? */
function wrongSeriesId(r: Row): string | null {
  if (!r.book_primary_author) return null;
  const bn = normalize(r.book_primary_author);
  const matchesA = r.series_a_primary_author && normalize(r.series_a_primary_author) === bn;
  const matchesB = r.series_b_primary_author && normalize(r.series_b_primary_author) === bn;
  if (matchesA && !matchesB) return r.series_b_id;
  if (matchesB && !matchesA) return r.series_a_id;
  return null;
}

for (const r of rows) {
  buckets[classify(r)].push(r);
}

// Summary
console.log("=== CATEGORIES ===");
const LABELS: Record<Category, string> = {
  legit_parent_sub: "Legit parent/sub-series (same author, nested names)",
  exact_name_dupe: "Exact-name duplicate series",
  near_dupe: "Near-duplicate (punct/case variant)",
  wrong_sibling_series: "Wrong sibling (book author matches one, not other)",
  cross_author_wrong: "Cross-author wrong link (matches neither)",
  unclassified: "Unclassified (needs manual review)",
};
const total = rows.length;
for (const cat of Object.keys(buckets) as Category[]) {
  const n = buckets[cat].length;
  const pct = total ? ((n / total) * 100).toFixed(1) : "0.0";
  console.log(`  ${LABELS[cat].padEnd(55)} ${n.toLocaleString().padStart(5)} (${pct}%)`);
}
console.log();

// Samples per category
for (const cat of Object.keys(buckets) as Category[]) {
  const items = buckets[cat];
  if (items.length === 0) continue;
  console.log(`\n── Sample: ${LABELS[cat]} (top 5 of ${items.length.toLocaleString()}) ──`);
  for (const r of items.slice(0, 5)) {
    console.log(`  "${r.book_title}" (${r.book_slug ?? r.book_id.slice(0, 8)}) — author: ${r.book_primary_author ?? "?"}`);
    console.log(`     series A: "${r.series_a_name}" (author: ${r.series_a_primary_author ?? "?"})`);
    console.log(`     series B: "${r.series_b_name}" (author: ${r.series_b_primary_author ?? "?"})`);
  }
}

// Write manifest
const reportDir = path.join(process.cwd(), "reports");
fs.mkdirSync(reportDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const jsonPath = path.join(reportDir, `multi-series-audit-${stamp}.json`);
fs.writeFileSync(jsonPath, JSON.stringify({
  totalPairs: rows.length,
  counts: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length])),
  pairs: rows.map((r, i) => ({ category: classify(r), ...r })),
}, null, 2));
console.log(`\nFull manifest: ${jsonPath}`);
db.close();
