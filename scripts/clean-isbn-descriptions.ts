/**
 * clean-isbn-descriptions.ts
 *
 * Clears or flags-for-refresh descriptions that contain "ISBN" and match
 * known junk patterns. Built 2026-04-17 after seeing Amazon reseller
 * dispatch boilerplate, metadata dumps, and copyright-page excerpts
 * leaking into description text.
 *
 * Tier 1 (HIGH CONFIDENCE — clear description outright):
 *   - "As Per Original ISBN" / "dispatched as per the original"
 *     / "shall be Dispatched Collectively" (box-set dispatch boilerplate)
 *   - " · ISBN-10 ·" / " · ISBN-13 ·" (Amazon bullet metadata dumps)
 *   - Starts with "Copyright ©" (copyright page excerpt)
 *   - "Please check the ISBN that your instructor" (textbook access)
 *   - "All rights reserved. ISBN:" (copyright footer with TOC)
 *
 * Tier 2 (AMBIGUOUS — flag description_stale=1 for refresh):
 *   - Contains "ISBN" but no tier-1 pattern match. The nightly
 *     description-refresh task will attempt to re-enrich over time.
 *
 * Run: npx tsx scripts/clean-isbn-descriptions.ts [--dry-run]
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "data", "tbra.db");
const db = new Database(DB_PATH);

const DRY_RUN = process.argv.includes("--dry-run");

// Tier 1 — clear outright. Each pattern is a SQLite LIKE expression.
const TIER_1_PATTERNS: string[] = [
  "%As Per Original ISBN%",
  "%dispatched as per the original%",
  "%shall be Dispatched Collectively%",
  "% · ISBN-10 ·%",
  "% · ISBN-13 ·%",
  "Copyright ©%",
  "%Please check the ISBN that your instructor%",
  "%All rights reserved. ISBN:%",
];

function selectCandidates() {
  return db
    .prepare(
      `SELECT id, title, slug, description
       FROM books
       WHERE description IS NOT NULL
         AND description LIKE '%ISBN%'`,
    )
    .all() as { id: string; title: string; slug: string | null; description: string }[];
}

function matchesTier1(desc: string): string | null {
  // Return the matched pattern (for logging) or null.
  for (const pat of TIER_1_PATTERNS) {
    const re = patternToRegex(pat);
    if (re.test(desc)) return pat;
  }
  return null;
}

function patternToRegex(like: string): RegExp {
  // Naive LIKE → regex. Escape regex specials except our wildcard %.
  const escaped = like.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*");
  return new RegExp(`^${escaped}$`, "si"); // dotAll + case-insensitive
}

function main() {
  const rows = selectCandidates();
  console.log(`[clean-isbn] Scanning ${rows.length} candidates (dry-run=${DRY_RUN})`);

  let tier1 = 0;
  let tier2 = 0;
  const tier1ByPattern = new Map<string, number>();

  const clearStmt = db.prepare(
    `UPDATE books
     SET description = NULL,
         description_stale = 1,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  );
  // Tier 1 sets stale=1 so nightly-description-refresh picks the book up
  // on a future run and re-fetches a clean description. Without this
  // flag, the book would sit with NULL description indefinitely.
  const flagStaleStmt = db.prepare(
    `UPDATE books
     SET description_stale = 1,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  );

  for (const r of rows) {
    const t1 = matchesTier1(r.description);
    if (t1) {
      tier1++;
      tier1ByPattern.set(t1, (tier1ByPattern.get(t1) ?? 0) + 1);
      if (!DRY_RUN) clearStmt.run(r.id);
    } else {
      tier2++;
      if (!DRY_RUN) flagStaleStmt.run(r.id);
    }
  }

  console.log(`\n=== RESULT ===`);
  console.log(`Tier 1 (cleared description):  ${tier1}`);
  for (const [pat, n] of [...tier1ByPattern.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${n.toString().padStart(4)}  ${pat}`);
  }
  console.log(`Tier 2 (flagged stale for refresh): ${tier2}`);
  console.log(
    DRY_RUN
      ? `\n[DRY RUN — no DB writes performed]`
      : `\n[WROTE to local DB. Follow-up: push-book-updates-only.ts to land on Turso]`,
  );
  db.close();
}

main();
