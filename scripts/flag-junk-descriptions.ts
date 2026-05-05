/**
 * Scans the Turso production catalog for descriptions matching the new junk
 * patterns added to sanitize.ts on 2026-05-04 (Goodreads-UI scrapes, star
 * burst promos, review-quote walls). Writes a per-pattern report for review.
 *
 * Two modes:
 *   --dry-run (default): just count + sample, don't modify anything
 *   --apply              : clear description (set to NULL) and set
 *                          description_stale=1 so the nightly description-
 *                          refresh task tries to write a clean replacement.
 *
 * Why clear-then-flag instead of just flag-stale?
 *   If we kept the old junk and only flagged stale, re-enrichment might
 *   re-write the same junk because the source returns the same text. With
 *   the OL/ISBNdb/Brave write paths now wrapped in sanitizeDescription
 *   (also added 2026-05-04), the cleared books get a clean replacement OR
 *   stay empty — never a re-insert of junk. Empty is strictly better than
 *   junk for end users.
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.vercel.local" });

import { createGuardedTurso } from "./lib/turso-guard";

const APPLY = process.argv.includes("--apply");
const SAMPLE_SIZE = 5;

// --skip=name1,name2  → exclude these pattern names
// --only=name1,name2  → run ONLY these pattern names (overrides --skip)
function parseListFlag(name: string): string[] {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!arg) return [];
  return arg
    .slice(`--${name}=`.length)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
const SKIP_LIST = parseListFlag("skip");
const ONLY_LIST = parseListFlag("only");

// Each pattern has either a SQL LIKE pre-filter, a JS regex, or both.
// SQL LIKE is run first to narrow the scan. The JS regex (when present) is
// the authoritative match — descriptions that only match LIKE but not the
// regex are filtered out.
interface Pattern {
  name: string;
  description: string;
  // SQL LIKE clauses applied with OR. If empty, the regex must be supplied
  // and we'll scan the whole catalog (slower).
  likePatterns: string[];
  // Optional regex applied as a final filter in JS.
  regex?: RegExp;
}

const PATTERNS: Pattern[] = [
  {
    name: "goodreads-reviews-community",
    description: "Goodreads boilerplate: 'Read reviews from the world's largest community...'",
    likePatterns: ["%Read reviews from the world%largest community%"],
  },
  {
    name: "goodreads-preview-error",
    description: "Goodreads error UI: 'Let us know what's wrong with this preview'",
    likePatterns: [
      "%Let us know what's wrong with this preview%",
      "%Let us know what%s wrong with this preview%",
    ],
  },
  {
    name: "goodreads-book-page-ui",
    description: "Goodreads UI button: 'Return to Book Page'",
    likePatterns: ["%Return to Book Page%"],
  },
  {
    name: "goodreads-reviews-from-book",
    description: "Goodreads scrape prefix: 'Reviews from the book:'",
    likePatterns: ["%Reviews from the book:%"],
  },
  {
    name: "goodreads-ratings-metadata",
    description: "Goodreads metadata: 'N Ratings · N Reviews'",
    likePatterns: ["%Ratings%·%Reviews%"],
    regex: /\d+\s+Ratings?\s*·\s*\d+\s+Reviews?/i,
  },
  {
    name: "goodreads-published-editions",
    description: "Goodreads metadata: 'published 2020 · 3 editions'",
    likePatterns: ["%published%·%edition%"],
    regex: /published\s+\d{4}\s*·\s*\d+\s+editions?/i,
  },
  {
    name: "multi-star-promo",
    description: "Multiple-star burst (★★+) — promo bullet or scraped rating widget",
    likePatterns: ["%★★%"],
  },
  {
    name: "review-quote-wall",
    description: "3+ blurb-attribution patterns ('quote'—Source) — review-only description",
    // Pre-filter: must have at least one em-dash variant. Final answer comes from regex count.
    likePatterns: ["%—%", "%―%", "%–%"],
    regex: /"[^"]{15,}"\s*[―—–]\s*[A-Z][\w\s.,&]+/g,
  },
];

async function main() {
  const guard = await createGuardedTurso({
    name: "flag-junk-descriptions",
    maxRuntimeMs: 30 * 60 * 1000,
    queryTimeoutMs: 30_000,
  });
  const remote = guard.remote;

  // Filter patterns by --only / --skip flags
  const activePatterns = PATTERNS.filter((p) => {
    if (ONLY_LIST.length > 0) return ONLY_LIST.includes(p.name);
    if (SKIP_LIST.includes(p.name)) return false;
    return true;
  });

  console.log(`[flag-junk-descriptions] mode=${APPLY ? "APPLY" : "DRY-RUN"}`);
  if (ONLY_LIST.length > 0) console.log(`  --only=${ONLY_LIST.join(",")}`);
  if (SKIP_LIST.length > 0) console.log(`  --skip=${SKIP_LIST.join(",")}`);
  console.log(`  active patterns: ${activePatterns.map((p) => p.name).join(", ")}`);
  console.log("");

  // Track all flagged book IDs across patterns to avoid double-counting.
  const flaggedIds = new Set<string>();
  const perPatternCounts: Record<string, number> = {};
  const perPatternSamples: Record<string, { id: string; title: string; snippet: string }[]> = {};

  for (const pattern of activePatterns) {
    perPatternCounts[pattern.name] = 0;
    perPatternSamples[pattern.name] = [];

    // Build a SQL query that filters by description NOT NULL and visibility=public,
    // plus an OR of all LIKE patterns. We do COLLATE NOCASE for case-insensitive matching.
    const likeClauses = pattern.likePatterns
      .map(() => "description LIKE ? COLLATE NOCASE")
      .join(" OR ");
    const sql = `
      SELECT id, title, description
      FROM books
      WHERE visibility = 'public'
        AND description IS NOT NULL
        AND description <> ''
        AND (${likeClauses})
    `;

    const rows = await remote.execute({ sql, args: pattern.likePatterns });

    for (const row of rows.rows) {
      const desc = String(row.description ?? "");
      const id = String(row.id ?? "");
      const title = String(row.title ?? "");

      // Apply regex filter if present
      let matches = true;
      if (pattern.regex) {
        if (pattern.name === "review-quote-wall") {
          // Special case: count attribution patterns; require ≥3
          const count = (desc.match(pattern.regex) ?? []).length;
          matches = count >= 3;
        } else {
          matches = pattern.regex.test(desc);
        }
      }
      if (!matches) continue;

      perPatternCounts[pattern.name]++;
      flaggedIds.add(id);

      if (perPatternSamples[pattern.name].length < SAMPLE_SIZE) {
        perPatternSamples[pattern.name].push({
          id,
          title,
          snippet: desc.slice(0, 220).replace(/\s+/g, " "),
        });
      }
    }
  }

  // ── Report ──
  console.log("===== PATTERN MATCH COUNTS =====");
  for (const pattern of activePatterns) {
    const count = perPatternCounts[pattern.name];
    console.log(`  ${pattern.name}: ${count}`);
    console.log(`    ${pattern.description}`);
    if (count > 0 && perPatternSamples[pattern.name].length > 0) {
      console.log(`    Samples (up to ${SAMPLE_SIZE}):`);
      for (const s of perPatternSamples[pattern.name]) {
        console.log(`      • "${s.title}" (${s.id})`);
        console.log(`        "${s.snippet}..."`);
      }
    }
    console.log("");
  }

  console.log(`===== TOTAL UNIQUE BOOKS FLAGGED: ${flaggedIds.size} =====`);
  console.log("");

  if (!APPLY) {
    console.log("DRY-RUN — no changes made.");
    console.log("Re-run with --apply to clear description (set NULL) and mark description_stale=1.");
    process.exit(0);
  }

  // ── APPLY ──
  console.log(`Applying clear-and-flag to ${flaggedIds.size} books on Turso...`);
  let applied = 0;
  let failed = 0;
  const ids = [...flaggedIds];
  // Update one at a time. Each query is fast (single PK update); the per-query
  // 30s guard is plenty.
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (i % 100 === 0) console.log(`  ${i}/${ids.length} (applied=${applied}, failed=${failed})`);
    try {
      await remote.execute({
        sql: `UPDATE books
              SET description = NULL,
                  description_stale = 1,
                  updated_at = datetime('now')
              WHERE id = ? AND description IS NOT NULL`,
        args: [id],
      });
      applied++;
    } catch (e: any) {
      console.error(`  FAIL ${id}: ${e?.message ?? e}`);
      failed++;
    }
  }

  console.log("");
  console.log(`===== APPLY DONE =====`);
  console.log(`  applied: ${applied}`);
  console.log(`  failed:  ${failed}`);
  console.log("");
  console.log("Next steps:");
  console.log("  - Tonight's nightly-description-refresh will retry enrichment on these books.");
  console.log("  - With sanitizeDescription now wired into the OL/ISBNdb/Brave write paths,");
  console.log("    the worst case is 'stays empty' rather than 'junk re-written'.");
  process.exit(0);
}

main().catch((e) => {
  console.error("[flag-junk-descriptions] FATAL", e);
  process.exit(1);
});
