/**
 * flag-junk-descriptions
 *
 * Finds public books whose stored description is present but WRONG — not
 * missing, which `description-refresh` already handles, but actively junk:
 * Amazon UI scrape artifacts, print-on-demand facsimile boilerplate, seller
 * condition notes, or a blurb copy-pasted across dozens of unrelated books.
 *
 * Why this exists (2026-08-08): the refresh lane keys off `description_stale`,
 * and nothing was ever setting that flag for junk written BEFORE
 * `sanitizeDescription` learned to reject it. An audit of the live catalog found
 * ~1,500 such books plus 2,364 sharing a description with at least one other
 * book — all of them invisible to every existing job, which is why testers kept
 * seeing descriptions that don't match the book.
 *
 * Detection strategy
 * ──────────────────
 * The primary rule is simply: run the stored description back through
 * `sanitizeDescription()`. That is the exact gate every new description must
 * pass today, so anything it rejects is text the pipeline would refuse to write
 * now — a definitionally stale row. This keeps one source of truth for "what
 * counts as junk" instead of a second pattern list that drifts from the first.
 *
 * Two rules the sanitizer can't express are added on top:
 *   - SHARED: the same description on N+ different books. Individually each
 *     copy looks like fine prose, so the sanitizer passes it; it's only wrong
 *     in aggregate (series box-set blurbs, publisher series boilerplate).
 *   - TITLE_ECHO: the "description" is just the title padded out.
 *
 * Actions
 * ───────
 *   HARD  → clear the description AND set description_stale=1.
 *           For text that is definitely not about this book, blank beats wrong:
 *           a missing description reads as "not filled in yet", while a
 *           confidently-wrong one reads as a broken product.
 *   SOFT  → set description_stale=1 and KEEP the text.
 *           For shared blurbs, which are usually at least series-adjacent. The
 *           refresh lane treats stale as "replace me", so the junk is swapped
 *           out the moment a real description is found, and nothing is lost if
 *           one never is.
 *
 * Either way the row lands in `description-refresh`'s widened selector on its
 * next run, so this script only ever marks work — it never enriches.
 *
 * Usage:
 *   npx tsx scripts/flag-junk-descriptions.ts              # dry run, report only
 *   npx tsx scripts/flag-junk-descriptions.ts --apply      # write flags
 *   npx tsx scripts/flag-junk-descriptions.ts --apply --limit=500
 *   npx tsx scripts/flag-junk-descriptions.ts --soft-only  # skip clearing text
 *
 * Local-only. Follow with `./scripts/sync-incremental.sh push` — sync-push 5b
 * carries both `description` and `description_stale`, so cleared text and the
 * flag reach Turso together.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import Database from "better-sqlite3";
import path from "path";
import { sanitizeDescription } from "../src/lib/enrichment/sanitize";

const DB_PATH = path.join(process.cwd(), "data", "tbra.db");
const db = new Database(DB_PATH);

const APPLY = process.argv.includes("--apply");
const SOFT_ONLY = process.argv.includes("--soft-only");
const LIMIT = Number(
  process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 0,
);

/** A description shared by at least this many books is boilerplate, not a blurb. */
const SHARED_THRESHOLD = 3;

type Row = {
  id: string;
  title: string;
  description: string;
  shelved: number;
};

type Verdict = {
  rule: string;
  action: "HARD" | "SOFT";
};

/**
 * Is this "description" just the title (plus author/edition padding)?
 *
 * Kept deliberately tight — a legitimate description often opens with the
 * title, so this only fires when there's essentially nothing else there.
 */
function isTitleEcho(desc: string, title: string): boolean {
  const d = desc.toLowerCase().replace(/\s+/g, " ").trim();
  const t = title.toLowerCase().replace(/\s+/g, " ").trim();
  if (!t || t.length < 4) return false;
  return d.includes(t) && d.length < t.length + 40;
}

/**
 * Strip the markup the sanitizer strips, so we can tell WHY it rejected a row.
 *
 * `sanitizeDescription` returns a bare null, but its reasons are not equally
 * damning: `text.length < 60` fires on short-but-perfectly-real descriptions
 * ("A retelling of the story about a miser whose life is changed by
 * Christmas."), while the pattern rules fire on genuine scrape junk. Clearing
 * the former would replace real text with nothing — a regression, not a fix.
 *
 * So we reproduce just the cheap normalization and use the resulting length as
 * the discriminator: still ≥60 chars after cleanup means the sanitizer must
 * have rejected it on a JUNK rule, not on length.
 */
function roughCleanLength(raw: string): number {
  return raw
    .replace(/<[^>]+>/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/[^\s)<]+/g, "")
    .replace(/&(?:amp|lt|gt|quot|nbsp|#39|#x27);/g, " ")
    .replace(/\s+/g, " ")
    .trim().length;
}

/**
 * Positive evidence that a description is scraped chrome rather than book copy.
 *
 * Clearing text is the one irreversible thing this script does, so it demands
 * an affirmative signal — never merely "the sanitizer said no". That gate is
 * tuned for the WRITE path, where rejecting a borderline string just means
 * trying another source; here the same verdict would destroy the only
 * description a book has. It also has real false positives: `sanitize.ts:251`
 * rejects any punctuation-free line ending in "by <Capitalized word>", which
 * swallows ordinary prose like "A retelling of the story about a miser whose
 * life is changed by Christmas."
 *
 * So: a sanitizer rejection alone only earns a SOFT flag (replace it if you can
 * find something better, but keep what's there). These markers earn a clear.
 */
const JUNK_MARKERS: { name: string; re: RegExp }[] = [
  { name: "goodreads-ui", re: /Read\s+(?:\d[\d,]*\s+)?reviews?\s+from the world['’]?s largest community/i },
  { name: "goodreads-ui", re: /\bbooks? on Goodreads\b/i },
  { name: "goodreads-ui", re: /Return to Book Page|Let us know what['’]?s wrong with this preview/i },
  { name: "goodreads-ui", re: /\d+\s+Ratings?\s*·\s*\d+\s+Reviews?|published\s+\d{4}\s*·\s*\d+\s+editions?/i },
  { name: "goodreads-ui", re: /^Books shelved as\b/i },
  { name: "amazon-ui", re: /double tap to read|Brief content visible/i },
  { name: "amazon-listing", re: /^Amazon\.com\s*:/i },
  { name: "amazon-listing", re: /\bFREE\W{0,3}shipping on qualifying offers/i },
  { name: "amazon-listing", re: /:\s*(?:Kindle Store|Kindle eBooks)\s*$/i },
  { name: "facsimile-boilerplate", re: /facsimile reprint|scarce antiquarian|reproduction of (?:a book published|the original artefact)/i },
  { name: "scan-boilerplate", re: /may contain imperfections|missing or blurred pages|has been selected by scholars as being culturally important/i },
  { name: "seller-boilerplate", re: /\bEx-library\b|may show signs of wear|satisfaction guaranteed/i },
  { name: "study-guide", re: /Created by Harvard students for students everywhere, SparkNotes/i },
  { name: "star-scrape", re: /★{2,}/ },
  { name: "camelcase-dump", re: /(?:[A-Z][a-z]{2,}){4,}/ },
];

function junkMarker(desc: string): string | null {
  for (const m of JUNK_MARKERS) if (m.re.test(desc)) return m.name;
  return null;
}

function classify(row: Row, sharedKeys: Set<string>): Verdict | null {
  const desc = row.description.trim();
  if (!desc) return null;

  // Rule 1 — affirmative scrape evidence. The only class we clear.
  const marker = junkMarker(desc);
  if (marker) return { rule: marker, action: "HARD" };

  // Rule 2 — the pipeline's own gate says it wouldn't write this today, but we
  // have no positive proof it's junk. Flag for replacement, keep the text.
  if (sanitizeDescription(desc) === null) {
    return roughCleanLength(desc) >= 60
      ? { rule: "sanitizer-reject", action: "SOFT" }
      : { rule: "too-thin", action: "SOFT" };
  }

  // Rule 3 — the title wearing a trench coat. Nothing to preserve.
  if (isTitleEcho(desc, row.title)) {
    return { rule: "title-echo", action: "HARD" };
  }

  // Rule 4 — same text on many books. Passes the sanitizer in isolation; only
  // detectable across the corpus. Soft, because it's often series-adjacent.
  if (sharedKeys.has(desc)) {
    return { rule: "shared-across-books", action: "SOFT" };
  }

  return null;
}

function main() {
  console.log(
    `[junk-descriptions] ${APPLY ? "APPLY" : "DRY RUN"}${SOFT_ONLY ? " (soft-only)" : ""}` +
      `${LIMIT ? ` limit=${LIMIT}` : ""}`,
  );

  // Descriptions appearing on SHARED_THRESHOLD+ distinct books. Computed once
  // over the whole catalog — this is the rule that needs corpus context.
  const sharedRows = db
    .prepare(
      `SELECT TRIM(description) AS d
       FROM books
       WHERE visibility = 'public'
         AND description IS NOT NULL
         AND LENGTH(TRIM(description)) > 40
       GROUP BY TRIM(description)
       HAVING COUNT(*) >= ?`,
    )
    .all(SHARED_THRESHOLD) as { d: string }[];
  const sharedKeys = new Set(sharedRows.map((r) => r.d));
  console.log(
    `[junk-descriptions] ${sharedKeys.size} distinct descriptions are shared by ${SHARED_THRESHOLD}+ books`,
  );

  const rows = db
    .prepare(
      `SELECT b.id, b.title, b.description,
              (SELECT COUNT(*) FROM user_book_state s WHERE s.book_id = b.id) AS shelved
       FROM books b
       WHERE b.visibility = 'public'
         AND b.description IS NOT NULL
         AND TRIM(b.description) <> ''
         AND b.description_stale = 0`,
    )
    .all() as Row[];
  console.log(`[junk-descriptions] scanning ${rows.length.toLocaleString()} descriptions`);

  const byRule = new Map<string, number>();
  const hits: (Row & Verdict)[] = [];

  for (const row of rows) {
    const v = classify(row, sharedKeys);
    if (!v) continue;
    byRule.set(v.rule, (byRule.get(v.rule) ?? 0) + 1);
    hits.push({ ...row, ...v });
  }

  // Shelved books first: same reasoning as the refresh lane — fix what people
  // are actually looking at before the long tail.
  hits.sort((a, b) => b.shelved - a.shelved);
  const selected = LIMIT ? hits.slice(0, LIMIT) : hits;

  console.log(`\n[junk-descriptions] ${hits.length} junk descriptions found:`);
  for (const [rule, n] of [...byRule.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${rule.padEnd(22)} ${n}`);
  }
  const hard = selected.filter((h) => h.action === "HARD").length;
  const soft = selected.length - hard;
  const shelvedHits = selected.filter((h) => h.shelved > 0).length;
  console.log(
    `   ${"→ selected".padEnd(22)} ${selected.length} (${hard} clear+flag, ${soft} flag-only, ${shelvedHits} on a user's shelf)`,
  );

  console.log(`\n[junk-descriptions] sample:`);
  for (const h of selected.slice(0, 8)) {
    console.log(`   [${h.action}/${h.rule}] "${h.title}"`);
    console.log(`      ${h.description.replace(/\s+/g, " ").slice(0, 110)}…`);
  }

  if (!APPLY) {
    console.log(
      `\n[junk-descriptions] Dry run — nothing written. Re-run with --apply to flag these.`,
    );
    db.close();
    return;
  }

  const clearStmt = db.prepare(
    `UPDATE books SET description = NULL, description_stale = 1, updated_at = ? WHERE id = ?`,
  );
  const flagStmt = db.prepare(
    `UPDATE books SET description_stale = 1, updated_at = ? WHERE id = ?`,
  );

  let cleared = 0;
  let flagged = 0;
  const run = db.transaction((items: (Row & Verdict)[]) => {
    for (const h of items) {
      // Fresh updated_at is what makes sync-push carry this to Turso (5b picks
      // rows where local is newer) — without it the change would stay local.
      const now = new Date().toISOString();
      if (h.action === "HARD" && !SOFT_ONLY) {
        clearStmt.run(now, h.id);
        cleared++;
      } else {
        flagStmt.run(now, h.id);
        flagged++;
      }
    }
  });
  run(selected);

  console.log(
    `\n[junk-descriptions] Done — ${cleared} cleared+flagged, ${flagged} flagged (text kept).`,
  );
  console.log(`[junk-descriptions] Follow-up: ./scripts/sync-incremental.sh push`);
  db.close();
}

main();
