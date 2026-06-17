/**
 * apply-description-cleanup.ts
 *
 * Applies the tiered cleanup from scan-description-junk.ts:
 *   Tier A (null + stale): lowercase_review, academic_thesis, issue_list
 *   Tier B (stale only):   footer_junk, mid_word_truncation, under_100_chars
 *   Tier C (stale only):   empty_or_null (existing empties — queue for re-enrich)
 *
 * Dry-run by default. Pass --apply to mutate. Intended to be invoked via the
 * pull → run → push pattern: ./scripts/sync-incremental.sh pull && npx tsx
 * scripts/apply-description-cleanup.ts --apply && ./scripts/sync-incremental.sh push
 *
 * Detectors must stay in sync with scan-description-junk.ts.
 */
import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "data", "tbra.db");
const APPLY = process.argv.includes("--apply");

type Tier = "A" | "B" | "C";
type PatternKey =
  | "empty_or_null"
  | "under_100_chars"
  | "lowercase_review"
  | "academic_thesis"
  | "issue_list"
  | "mid_word_truncation"
  | "footer_junk";

const TIER_OF: Record<PatternKey, Tier> = {
  lowercase_review: "A",
  academic_thesis: "A",
  issue_list: "A",
  footer_junk: "B",
  mid_word_truncation: "B",
  under_100_chars: "B",
  empty_or_null: "C",
};

// ─── Detectors (must match scan-description-junk.ts) ───

function isEmpty(d: string | null): boolean {
  return !d || d.trim().length === 0;
}
function isUnder100(d: string): boolean {
  return d.trim().length > 0 && d.trim().length < 100;
}
function isLowercaseReview(d: string): boolean {
  const t = d.trim();
  if (t.length === 0) return false;
  if (!/[a-z]/.test(t[0])) return false;
  const hasPersonalVoice =
    /\b(i|my|me|loved|hated|good|bad|awesome|amazing|terrible|over and over|couldn'?t put|could not put|5 stars|five stars)\b/i.test(
      t,
    );
  const noTerminal = !/[.!?"'\)\]]$/.test(t);
  return t.length < 400 && (hasPersonalVoice || noTerminal);
}
function isAcademicThesis(d: string): boolean {
  if (/\bMy Thesis\b/i.test(d)) return true;
  if (/\bentitled:\s*[A-Z]/.test(d)) return true;
  const head = d.slice(0, 300);
  if (
    /\b(my (?:thesis|dissertation|paper|research|study|book))\b/i.test(head) &&
    /\b(I (?:wrote|completed|submitted|began|argued|explore|examined))\b/i.test(head)
  ) {
    return true;
  }
  const ocrTypos = /\b(reseach|Univeristy|thier|recieved|seperate|managment|occured)\b/;
  if (
    ocrTypos.test(d) &&
    /\b(thesis|dissertation|university|research|chapter)\b/i.test(d)
  ) {
    return true;
  }
  return false;
}
function isIssueList(d: string): boolean {
  const t = d.trim();
  if (t.length > 400) return false;
  const hashMatches = t.match(/#\d+(?:-\d+)?/g) ?? [];
  if (hashMatches.length === 0) return false;
  const hashChars = hashMatches.reduce((sum, m) => sum + m.length, 0);
  if (hashMatches.length >= 3) return true;
  if (hashChars / t.length >= 0.1 && hashMatches.length >= 1 && t.length < 200) return true;
  return false;
}
function isMidWordTruncation(d: string): boolean {
  const t = d.trim();
  if (t.length < 80) return false;
  if (/[.!?…"'\)\]]\s*$/.test(t)) return false;
  const last = t.slice(-50);
  if (/\b[A-Z]\.\s*$/.test(t)) return true;
  if (/\b[a-z]{2,}$/.test(t) && !/[,;:)]\s*$/.test(t)) return true;
  if (/[,;:]\s*$/.test(t)) return true;
  if (/\b(and|or|but|the|a|of|to|with|for|in|on|by|from)\s*$/i.test(last)) return true;
  return false;
}
const FOOTER_MARKERS: RegExp[] = [
  /\bBooks with Buzz\b/i,
  /\bDiscover the latest buzz[- ]worthy\b/i,
  /\bAbout the Author\s*:/i,
  /\bProduct Details\b/i,
  /\bCustomer Reviews\b/i,
  /\bEditorial Reviews\b/i,
  /\bFrom the Publisher\b/i,
  /\bFrom the Back Cover\b/i,
  /\bFrom the Inside Flap\b/i,
  /\bFrom School Library Journal\b/i,
  /\bFrom Booklist\b/i,
  /\bRead more\s*›/i,
  /\bClick to open expanded view\b/i,
  /\bSee all [\d,]+ customer reviews\b/i,
  /\bPublication date\s*:/i,
  /\bLanguage\s*:\s*English\b/i,
  /\bISBN-1[03]\s*:/i,
  /\bItem Weight\s*:/i,
  /\bDimensions\s*:/i,
  /\bBest Sellers Rank\s*:/i,
  /\bPaperback\s*:\s*\d+ pages\b/i,
  /\bHardcover\s*:\s*\d+ pages\b/i,
  /\bReport an issue with this product\b/i,
  /\bBrief content visible\b/i,
  /\bTo calculate the overall star rating\b/i,
];
function hasFooterJunk(d: string): boolean {
  return FOOTER_MARKERS.some((rx) => rx.test(d));
}

function classify(desc: string | null): Set<PatternKey> {
  const hits = new Set<PatternKey>();
  if (isEmpty(desc)) {
    hits.add("empty_or_null");
    return hits;
  }
  const d = desc!;
  if (isUnder100(d)) hits.add("under_100_chars");
  if (isLowercaseReview(d)) hits.add("lowercase_review");
  if (isAcademicThesis(d)) hits.add("academic_thesis");
  if (isIssueList(d)) hits.add("issue_list");
  if (isMidWordTruncation(d)) hits.add("mid_word_truncation");
  if (hasFooterJunk(d)) hits.add("footer_junk");
  return hits;
}

function resolveTier(hits: Set<PatternKey>): Tier | null {
  if (hits.size === 0) return null;
  // Tier A wins over B wins over C if a book hits multiple patterns
  for (const key of hits) {
    if (TIER_OF[key] === "A") return "A";
  }
  for (const key of hits) {
    if (TIER_OF[key] === "B") return "B";
  }
  for (const key of hits) {
    if (TIER_OF[key] === "C") return "C";
  }
  return null;
}

// ─── Main ───

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

console.log(`=== apply-description-cleanup.ts ===`);
console.log(`Mode: ${APPLY ? "APPLY (will mutate DB)" : "DRY-RUN (no changes)"}`);
console.log();

type Row = {
  id: string;
  description: string | null;
  description_stale: number;
};

const rows = db
  .prepare(
    `SELECT id, description, description_stale
     FROM books
     WHERE visibility = 'public'`,
  )
  .all() as Row[];

console.log(`Scanning ${rows.length.toLocaleString()} public books...\n`);

const buckets: Record<Tier, string[]> = { A: [], B: [], C: [] };
const patternCounts: Record<PatternKey, number> = {
  empty_or_null: 0,
  under_100_chars: 0,
  lowercase_review: 0,
  academic_thesis: 0,
  issue_list: 0,
  mid_word_truncation: 0,
  footer_junk: 0,
};
let alreadyStale = 0;

for (const r of rows) {
  const hits = classify(r.description);
  if (hits.size === 0) continue;
  for (const h of hits) patternCounts[h]++;
  const tier = resolveTier(hits);
  if (!tier) continue;
  if (r.description_stale === 1) alreadyStale++;
  buckets[tier].push(r.id);
}

console.log("=== CLASSIFICATION ===");
console.log(`Tier A (null + stale):       ${buckets.A.length.toLocaleString().padStart(6)} books`);
console.log(`Tier B (stale only):         ${buckets.B.length.toLocaleString().padStart(6)} books`);
console.log(`Tier C (stale, was empty):   ${buckets.C.length.toLocaleString().padStart(6)} books`);
console.log(`                       TOTAL ${(buckets.A.length + buckets.B.length + buckets.C.length)
  .toLocaleString()
  .padStart(6)} books`);
console.log(`  (${alreadyStale.toLocaleString()} were already description_stale=1)`);
console.log();

console.log("Pattern hit counts (non-exclusive — a book can hit multiple):");
for (const [k, v] of Object.entries(patternCounts)) {
  console.log(`  ${k.padEnd(24)} ${v.toLocaleString().padStart(6)}`);
}
console.log();

if (!APPLY) {
  console.log("Dry-run complete. Re-run with --apply to mutate.");
  db.close();
  process.exit(0);
}

// ─── Apply ───

console.log("=== APPLYING ===");
const now = new Date().toISOString();

const nullAndStale = db.prepare(
  `UPDATE books
     SET description = NULL,
         description_stale = 1,
         updated_at = ?
     WHERE id = ?`,
);
const staleOnly = db.prepare(
  `UPDATE books
     SET description_stale = 1,
         updated_at = ?
     WHERE id = ?
       AND description_stale = 0`,
);

const txA = db.transaction((ids: string[]) => {
  for (const id of ids) nullAndStale.run(now, id);
});
const txBC = db.transaction((ids: string[]) => {
  for (const id of ids) staleOnly.run(now, id);
});

console.log(`Tier A: nulling description + flagging stale on ${buckets.A.length.toLocaleString()} books...`);
txA(buckets.A);
console.log(`Tier B: flagging stale on ${buckets.B.length.toLocaleString()} books (skip rows already stale)...`);
txBC(buckets.B);
console.log(`Tier C: flagging stale on ${buckets.C.length.toLocaleString()} books (skip rows already stale)...`);
txBC(buckets.C);

// Post-verification
const postStale = db
  .prepare(
    `SELECT COUNT(*) AS c FROM books WHERE description_stale = 1 AND visibility = 'public'`,
  )
  .get() as { c: number };
console.log();
console.log(`Post-apply: ${postStale.c.toLocaleString()} books now flagged description_stale=1.`);
console.log(`Follow-up: ./scripts/sync-incremental.sh push  (required to propagate to Turso)`);

db.close();
