/**
 * One-time backfill — normalize the existing publication_date mess to ISO.
 *
 *   npx tsx scripts/normalize-pub-dates.ts            # DRY RUN (default)
 *   npx tsx scripts/normalize-pub-dates.ts --apply    # write local + Turso
 *
 * The publication_date column has accumulated mixed formats over time
 * ("22 March 2018", "25.07.2023", "April 2026", "2026-09-15", "2016"), which
 * makes the lexical `publication_date > today` comparison the upcoming-releases
 * lane relies on unreliable. normalizePubDate() (src/lib/publication-date.ts) is
 * now the single choke point for NEW writes; this script retro-cleans the rows
 * that predate it.
 *
 * IMPORTANT: sync-push.ts does NOT propagate publication_date, so a local-only
 * fix would never reach production. This script therefore dual-writes — local
 * SQLite AND Turso (guarded) — for every changed row.
 *
 * Conservative policy: a row is rewritten only when normalizePubDate returns a
 * CONFIDENT date (day or month precision) that DIFFERS from what's stored.
 * Year-only and unparseable/implausible values are LEFT UNTOUCHED and reported,
 * so we never destroy information we can't confidently re-encode.
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env.vercel.local" });

import { db } from "../src/db";
import { books } from "../src/db/schema";
import { eq, isNotNull } from "drizzle-orm";
import { normalizePubDate } from "../src/lib/publication-date";
import { createGuardedTurso } from "./lib/turso-guard";

const APPLY = process.argv.includes("--apply");
const SAMPLE = 50;

async function main() {
  const rows = await db
    .select({ id: books.id, title: books.title, pubDate: books.publicationDate })
    .from(books)
    .where(isNotNull(books.publicationDate));

  console.log(`[normalize] scanning ${rows.length} books with a publication_date`);

  const changes: { id: string; title: string; from: string; to: string }[] = [];
  let alreadyIso = 0;
  let yearOnly = 0;
  let unparseable = 0;

  for (const row of rows) {
    const raw = row.pubDate;
    if (!raw) continue;
    const norm = normalizePubDate(raw);

    // Only act on confident (day/month) normalizations.
    if (norm.precision === "day" || norm.precision === "month") {
      if (norm.date && norm.date !== raw) {
        changes.push({ id: row.id, title: row.title, from: raw, to: norm.date });
      } else {
        alreadyIso++;
      }
    } else if (norm.precision === "year") {
      yearOnly++;
    } else {
      unparseable++;
    }
  }

  console.log(
    `[normalize] to-change=${changes.length} alreadyIso=${alreadyIso} ` +
      `yearOnly(left)=${yearOnly} unparseable(left)=${unparseable}`,
  );

  // Show a sample of the rewrites for review.
  console.log(`\n[normalize] sample of changes (up to ${SAMPLE}):`);
  for (const c of changes.slice(0, SAMPLE)) {
    console.log(`  "${c.from}"  ->  "${c.to}"   (${c.title.slice(0, 50)})`);
  }
  if (unparseable > 0) {
    console.log(`\n[normalize] sample of UNPARSEABLE (left untouched):`);
    let shown = 0;
    for (const row of rows) {
      if (shown >= 15) break;
      if (!row.pubDate) continue;
      const n = normalizePubDate(row.pubDate);
      if (n.precision === "none") {
        console.log(`  "${row.pubDate}"   (${row.title.slice(0, 50)})`);
        shown++;
      }
    }
  }

  if (!APPLY) {
    console.log(`\n[normalize] DRY RUN — no writes. Re-run with --apply to commit ${changes.length} changes.`);
    process.exit(0);
  }

  if (changes.length === 0) {
    console.log(`\n[normalize] nothing to apply.`);
    process.exit(0);
  }

  // --- APPLY: local first (blocks sync-push re-introducing old values), then Turso. ---
  const { remote, shutdown } = await createGuardedTurso({
    name: "normalize-pub-dates",
    maxRuntimeMs: 45 * 60 * 1000,
    queryTimeoutMs: 30_000,
    longRunning: true,
  });

  let done = 0;
  for (const c of changes) {
    await db.update(books).set({ publicationDate: c.to }).where(eq(books.id, c.id));
    await remote.execute({
      sql: "UPDATE books SET publication_date = ? WHERE id = ?",
      args: [c.to, c.id],
    });
    done++;
    if (done % 200 === 0) console.log(`[normalize] applied ${done}/${changes.length}`);
  }

  console.log(`[normalize] applied ${done}/${changes.length} (local + Turso).`);
  shutdown();
  process.exit(0);
}

main().catch((err) => {
  console.error("[normalize] fatal:", err);
  process.exit(1);
});
