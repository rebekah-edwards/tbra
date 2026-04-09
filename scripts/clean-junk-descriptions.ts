/**
 * Scan all book descriptions for review-like or junk content and clear them.
 *
 * The nightly backfill-metadata.ts script was writing raw ISBNdb `synopsis`
 * fields to the `description` column with only a length check — no junk
 * filtering. ISBNdb's synopsis field frequently contains:
 *   - User reviews from Amazon/Goodreads ("I loved this book", "5 stars")
 *   - Amazon product page scrapes ("by Author (Author), ...")
 *   - Goodreads sidebar dumps (CamelCase genre blobs)
 *   - Author bios ("She is the bestselling author of...")
 *   - Shipping/product text ("FREE shipping on qualifying offers")
 *
 * This script detects these patterns and NULLs the description so
 * enrichment can replace them with clean content on the next pass.
 *
 * Run on both local and Turso.
 */

import { createClient, type Client } from "@libsql/client";
import Database from "better-sqlite3";
import path from "path";

const DRY_RUN = process.argv.includes("--dry-run");

// Patterns that indicate the description is a review, not a publisher blurb
const REVIEW_PATTERNS = [
  /\bI (?:really )?(?:enjoy|loved|hated|liked|couldn'?t put|was (?:blown|hooked|disappointed|intrigued))/i,
  /\bI (?:would |highly )?recommend/i,
  /\bmy favou?rite?\b/i,
  /\bone of my\b/i,
  /\b(?:great|good|excellent|amazing|wonderful|fantastic|terrible|awful|boring|mediocre) (?:book|read|story|novel)\b/i,
  /\b\d(?:\/5|\/10|\s*(?:out of|stars?))\b/i,
  /\b(?:5|4|3|2|1) stars?\b/i,
  /\bpage[- ]?turner\b/i,
  /\bcouldn'?t (?:stop|put (?:it|this) down)\b/i,
  /\bif you (?:like|enjoy|love|haven'?t read)\b/i,
  /\bhighly recommend(?:ed)?\b/i,
  /\bworth (?:the |a )?read\b/i,
  /\bmust[- ]?read\b/i,
  /\bcan'?t wait (?:for|to read)\b/i,
  /\bDNF(?:'d|ed)?\b/,
  /\bwhat'?s not to (?:love|like)\b/i,
  /\bno brainer\b/i,
  /\bI know that several of my friends\b/i,
  /\bcheck(?:ing)? (?:this|it) (?:one )?out\b/i,
];

// Amazon product page junk
const AMAZON_PATTERNS = [
  /\*FREE\* shipping/i,
  /qualifying offers/i,
  /\bon Amazon\.com\b/i,
  /\bAmazon\.com:/i,
  /\bby .+?\(Author\)/i,
  /\bKindle edition\b/i,
  /\bAdd to Cart\b/i,
  /\bCustomers who bought\b/i,
  /\bFrequently bought together\b/i,
  /\bPrevious slide of product details\b/i,
  /\bCurrently Unavailable\b/i,
  /\bImage not available\b/i,
  /\bwith this product or seller\b/i,
  /\bBooks\s*›\s*/,
  /\bScience Fiction &amp; Fantasy\b/,
];

// Goodreads sidebar / metadata dumps
const GOODREADS_PATTERNS = [
  /(?:[A-Z][a-z]{2,}){5,}/, // CamelCase blobs like "FantasyDarkRomanceSteamyAdult"
  /\bGenres\s*(?:[A-Z][a-z]+\s*){3,}/,
  /\bFirst [Pp]ublished\b/,
  /\b\d+ pages\b.*\bFirst published\b/i,
];

// Author bio as description
const AUTHOR_BIO_PATTERNS = [
  /^[A-Z][\w\s.]{2,40} is (?:the )?(?:[\w\s#]+?)?(?:bestselling|award-winning|New York Times) author/i,
  /^[A-Z][\w\s.]{2,40} is the author of\b/i,
  /^(?:Born|He|She) (?:in \d{4}|was born|has written|is a (?:New York|bestselling|renowned))/i,
  /^(?:Dr\.|Professor) [A-Z]/,
];

// Other junk
const OTHER_JUNK_PATTERNS = [
  /^This work has been selected by scholars/i,
  /SparkNotes/i,
  /^Excerpt from\b/i,
  /^A Stepping Stone Book/i,
  /^\d{10,13}:/,  // ISBN as description start
  /^(?:Hardcover|Paperback|Mass Market|Board Book)/i,
];

interface DbLike {
  label: string;
  exec(sql: string, args?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

function wrapLocal(db: Database.Database): DbLike {
  return {
    label: "local",
    async exec(sql: string, args: unknown[] = []) {
      if (sql.trim().toUpperCase().startsWith("SELECT")) {
        return { rows: db.prepare(sql).all(...(args as never[])) as Record<string, unknown>[] };
      }
      db.prepare(sql).run(...(args as never[]));
      return { rows: [] };
    },
  };
}

function wrapRemote(client: Client): DbLike {
  return {
    label: "turso",
    async exec(sql: string, args: unknown[] = []) {
      const res = await client.execute({ sql, args: args as (string | number | null)[] });
      return { rows: res.rows.map((r) => ({ ...r } as unknown as Record<string, unknown>)) };
    },
  };
}

function isJunkDescription(desc: string): { junk: boolean; reason: string } {
  for (const p of REVIEW_PATTERNS) {
    if (p.test(desc)) return { junk: true, reason: `review: ${p.source.slice(0, 40)}` };
  }
  for (const p of AMAZON_PATTERNS) {
    if (p.test(desc)) return { junk: true, reason: `amazon: ${p.source.slice(0, 40)}` };
  }
  for (const p of GOODREADS_PATTERNS) {
    if (p.test(desc)) return { junk: true, reason: `goodreads: ${p.source.slice(0, 40)}` };
  }
  for (const p of AUTHOR_BIO_PATTERNS) {
    if (p.test(desc)) return { junk: true, reason: `bio: ${p.source.slice(0, 40)}` };
  }
  for (const p of OTHER_JUNK_PATTERNS) {
    if (p.test(desc)) return { junk: true, reason: `junk: ${p.source.slice(0, 40)}` };
  }
  return { junk: false, reason: "" };
}

async function clean(db: DbLike) {
  console.log(`\n╭─ Scanning descriptions on ${db.label}`);

  const rows = await db.exec(
    `SELECT id, title, description FROM books WHERE description IS NOT NULL AND description != ''`,
  );
  console.log(`│  ${rows.rows.length} books with descriptions`);

  const junkBooks: { id: string; title: string; reason: string; sample: string }[] = [];

  for (const row of rows.rows) {
    const desc = row.description as string;
    const check = isJunkDescription(desc);
    if (check.junk) {
      junkBooks.push({
        id: row.id as string,
        title: row.title as string,
        reason: check.reason,
        sample: desc.slice(0, 80),
      });
    }
  }

  console.log(`│  ${junkBooks.length} junk descriptions found`);

  // Show breakdown by category
  const byCategory = new Map<string, number>();
  for (const b of junkBooks) {
    const cat = b.reason.split(":")[0];
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + 1);
  }
  for (const [cat, count] of [...byCategory.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`│    ${cat.padEnd(12)} ${count}`);
  }

  // Show samples
  if (junkBooks.length > 0 && junkBooks.length <= 30) {
    console.log(`│  Samples:`);
    for (const b of junkBooks.slice(0, 30)) {
      console.log(`│    "${b.title}" — ${b.reason} — "${b.sample}..."`);
    }
  }

  if (DRY_RUN) {
    console.log(`│  [dry run] no changes made`);
    console.log(`╰─ ${db.label} done\n`);
    return;
  }

  // NULL out junk descriptions (and summary if it matches)
  let cleaned = 0;
  for (const b of junkBooks) {
    await db.exec(
      `UPDATE books SET description = NULL, summary = CASE WHEN summary = description THEN NULL ELSE summary END WHERE id = ?`,
      [b.id],
    );
    cleaned++;
  }

  console.log(`│  ✓ Cleared ${cleaned} junk descriptions`);
  console.log(`╰─ ${db.label} done\n`);
}

async function main() {
  const localDbPath = path.resolve(
    process.cwd(),
    process.cwd().endsWith("tbra") ? "data/tbra.db" : "claude/tbra/data/tbra.db",
  );
  const localRaw = new Database(localDbPath);
  await clean(wrapLocal(localRaw));

  const tursoUrl = process.env.TURSO_DATABASE_URL;
  const tursoToken = process.env.TURSO_AUTH_TOKEN;
  if (tursoUrl && tursoToken) {
    await clean(wrapRemote(createClient({ url: tursoUrl, authToken: tursoToken })));
  }
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
