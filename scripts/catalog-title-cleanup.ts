/**
 * catalog-title-cleanup.ts
 *
 * Two independent catalog-quality sweeps over PUBLIC books, both dry-run by
 * default. The existing junk-title patterns in src/lib/openlibrary.ts are
 * applied at IMPORT time only, so books imported before a pattern was added
 * were never re-swept — that backlog is what this cleans up.
 *
 * MODE 1 — --flag-box-sets
 *   Box sets, collection sets, gift sets and omnibus editions are LEGITIMATE
 *   catalog entries: readers who bought a boxed set need to be able to shelve
 *   it. They are not hidden or deleted. They are marked is_box_set = 1 so the
 *   UI can label them as sets, and so they stop reading as if they were a
 *   single novel.
 *
 * MODE 2 — --clean-titles
 *   Real single books carrying retail format cruft in the title
 *   ("Down Cemetery Road Deluxe Edition", "Saga, Vol. 1 (Turtleback School &
 *   Library Binding Edition)"). The book is fine; the title is dirty. Strips
 *   the format marker only.
 *
 *   Deliberately does NOT touch `slug`. Public book URLs are slug-based, so
 *   regenerating slugs here would break live links and SEO. Title and slug are
 *   allowed to drift — the slug is an identifier, not a display string.
 *
 *   Because stripping can make two rows share a title, the dry run reports
 *   every resulting duplicate-title group rather than silently creating them.
 *
 * Writes BOTH local and Turso. Local matters because sync-push step 5b pushes
 * local-newer metadata over live — a Turso-only write would be reverted on the
 * next nightly push.
 *
 * Usage:
 *   npx tsx scripts/catalog-title-cleanup.ts --flag-box-sets
 *   npx tsx scripts/catalog-title-cleanup.ts --clean-titles
 *   ...add --apply to write.
 */
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { config } from "dotenv";
import { createGuardedTurso } from "./lib/turso-guard";

config({ path: ".env.vercel.local" });

const APPLY = process.argv.includes("--apply");
const DO_BOX = process.argv.includes("--flag-box-sets");
const DO_TITLES = process.argv.includes("--clean-titles");
const ALLOW_DUPES = process.argv.includes("--allow-dupes");
if (!DO_BOX && !DO_TITLES) {
  console.error("Pick a mode: --flag-box-sets and/or --clean-titles (add --apply to write).");
  process.exit(1);
}
const PAUSE_MS = 60;
const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

const localDb = new Database(path.join(process.cwd(), "data", "tbra.db"));

/** Titles that denote a MULTI-BOOK PRODUCT — kept public, flagged as a set. */
const BOX_SET_PATTERNS: RegExp[] = [
  /\b(box|boxed)\s*set\b/i,
  /\bgift\s+set\b/i,
  /\bcollection\s+set\b/i,
  /\bbooks?\s+collection\s+set\b/i,
  /\bseries\s+collection\b/i,
  /\bcomplete\s+collection\b/i,
  /\bsaga\s+collection\b/i,
  /\bcomplete\s+series\b/i,
  /\b\d+\s*-?\s*books?\s+(set|bundle|pack|collection)\b/i,
  /\b(books?\s+\d+\s*[-–—]\s*\d+)\b/i,
  /\b(volumes?\s+\d+\s*[-–—]\s*\d+)\b/i,
  /\b(omnibus|compendium)\b/i,
  /\bbind[\s-]*up\b/i,
];

/**
 * Retail format cruft to strip. Ordered: bracketed/parenthetical wrappers
 * first (they carry their own delimiters), bare trailing markers second.
 * Every pattern is anchored to a format word so ordinary titles are untouched.
 */
const CRUFT_PATTERNS: RegExp[] = [
  /\s*\((?:turtleback\s+)?school\s*&?\s*library\s+binding(?:\s+edition)?\)/gi,
  /\s*\(\s*(?:true\s+)?large\s+print(?:\s+edition)?\s*\)/gi,
  /\s*\[\s*(?:trade\s+|mass\s+market\s+)?(?:paperback|hardcover|hardback|large\s+print)(?:\s+edition)?\s*\]/gi,
  /\s*\(\s*\d+\s*book\s*series\s*\)/gi,
  /\s*[-–—,:]?\s*\bkindle\s+edition\b/gi,
  /\s*[-–—,:]?\s*\bmass\s+market\s+paperback\b/gi,
  /\s*[-–—,:]?\s*\blibrary\s+binding(?:\s+edition)?\b/gi,
  // "10th Anniversary Edition" must be consumed AS A UNIT — matching only
  // "Anniversary Edition" leaves the orphan ordinal behind
  // ("…Miracle - Tenth Anniversary Edition" → "…Miracle - Tenth").
  /\s*[-–—,:(]?\s*\b(?:\d+(?:st|nd|rd|th)|first|second|third|fourth|fifth|tenth|twentieth|twenty-fifth|fiftieth)\s+anniversary\s+(?:hardcover|edition)\b\)?/gi,
  /\s*[-–—,:]?\s*\b(?:deluxe|premiere|collector'?s?|limited)\s+(?:hardcover|edition)\b/gi,
  /\s*[-–—,:]?\s*\b(?:hardcover|paperback|hardback)\s+edition\b/gi,
  /\s*[-–—,:]?\s*\b(?:true\s+)?large\s+print(?:\s+edition)?\b/gi,
  // Bare trailing format word left dangling after a dash ("Avatar - Hardcover").
  /\s*[-–—]\s*(?:hardcover|paperback|hardback)\s*$/gi,
  // A qualifier stranded once its "Edition" partner was removed above
  // ("…Castle Deluxe Limited Edition" → "…Castle Deluxe" → "…Castle").
  /\s*[-–—,:]?\s*\b(?:deluxe|premiere|collector'?s)\s*$/gi,
];

/**
 * Returns the cleaned title, or null when this title carries no format cruft.
 *
 * The null gate matters: the tidy-up below (whitespace, orphaned punctuation)
 * would otherwise rewrite thousands of untouched titles for purely cosmetic
 * reasons — "Star Wars : Empire" → "Star Wars: Empire" across the whole
 * catalog. We only tidy damage we ourselves caused by removing cruft.
 */
function cleanTitle(title: string): string | null {
  if (!CRUFT_PATTERNS.some((re) => { re.lastIndex = 0; return re.test(title); })) return null;
  let out = title;
  for (const re of CRUFT_PATTERNS) { re.lastIndex = 0; out = out.replace(re, ""); }
  out = out
    .replace(/\(\s*\)/g, "")          // emptied parens
    .replace(/\[\s*\]/g, "")
    .replace(/\s*,\s*,+/g, ",")       // commas orphaned by a removal
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,;:])/g, "$1")
    // Trailing separators only. NOT '.', which is load-bearing in
    // abbreviations ("33 D.c." must not become "33 D.c").
    .replace(/[\s,;:\-–—]+$/g, "")
    .replace(/^[\s,;:\-–—]+/g, "")
    .trim();
  return out;
}

interface Row { id: string; title: string; is_box_set: number | null; slug: string | null }

/** Renames withheld because they would collide with an existing public title. */
let heldBackDupes: { row: Row; next: string }[] = [];

async function main() {
  const pub = localDb
    .prepare(`SELECT id, title, is_box_set, slug FROM books WHERE visibility = 'public'`)
    .all() as Row[];
  console.log(`=== catalog-title-cleanup.ts ${APPLY ? "(APPLY)" : "(DRY RUN)"} ===`);
  console.log(`Public books: ${pub.length}\n`);

  const boxTargets = DO_BOX
    ? pub.filter((b) => b.title && BOX_SET_PATTERNS.some((re) => re.test(b.title)) && Number(b.is_box_set) !== 1)
    : [];

  const titleTargets = DO_TITLES
    ? pub
        .map((b) => ({ row: b, next: cleanTitle(b.title ?? "") }))
        .filter((x): x is { row: Row; next: string } => !!x.next)
        .filter(({ row, next }) => next !== row.title && next.length >= 3)
        // A book that IS a set keeps its descriptive title — stripping "Deluxe
        // Edition" off a boxed set would misrepresent a multi-book product as
        // a single novel.
        .filter(({ row }) => !BOX_SET_PATTERNS.some((re) => re.test(row.title)))
    : [];

  if (DO_BOX) {
    console.log(`--- MODE 1: flag box sets ---`);
    console.log(`Would flag is_box_set=1: ${boxTargets.length}`);
    boxTargets.slice(0, 15).forEach((b) => console.log(`  ${b.title}`));
    if (boxTargets.length > 15) console.log(`  … +${boxTargets.length - 15} more`);
    console.log();
  }

  if (DO_TITLES) {
    console.log(`--- MODE 2: clean titles ---`);
    console.log(`Would rename: ${titleTargets.length}`);
    // Duplicate-title detection: compare the post-clean title against every
    // OTHER public title (already-existing plus other renames in this batch).
    const finalTitles = new Map<string, string[]>();
    for (const b of pub) {
      const t = titleTargets.find((x) => x.row.id === b.id);
      const title = (t ? t.next : b.title ?? "").toLowerCase().trim();
      if (!title) continue;
      if (!finalTitles.has(title)) finalTitles.set(title, []);
      finalTitles.get(title)!.push(b.id);
    }
    // Renaming a book onto a title another public book already holds trades one
    // cosmetic problem for a worse one: two identical rows in search results.
    // Those are edition-duplicates and belong in the dedup pipeline
    // (scripts/dedup-books.ts), not here. Held back unless --allow-dupes.
    const dupeKey = (t: string) => t.toLowerCase().trim();
    const newDupes = titleTargets.filter(({ next }) => (finalTitles.get(dupeKey(next)) ?? []).length > 1);
    const dupeIds = new Set(newDupes.map((d) => d.row.id));
    if (!ALLOW_DUPES) {
      for (let i = titleTargets.length - 1; i >= 0; i--) {
        if (dupeIds.has(titleTargets[i].row.id)) titleTargets.splice(i, 1);
      }
    }
    console.log(`…would collide with an existing public title: ${newDupes.length}` +
      (ALLOW_DUPES ? " (INCLUDED via --allow-dupes)" : " → HELD BACK (dedup candidates)"));
    console.log(`…will actually rename: ${titleTargets.length}`);
    heldBackDupes = newDupes;
    console.log(`\n  sample renames:`);
    titleTargets.slice(0, 25).forEach(({ row, next }) => console.log(`   "${row.title}"\n     → "${next}"`));
    if (newDupes.length) {
      console.log(`\n  ⚠ held back — cleaning these reveals they duplicate an existing book (first 15):`);
      newDupes.slice(0, 15).forEach(({ row, next }) => console.log(`   "${row.title}"\n     → "${next}"  (already exists)`));
      console.log(`  These are edition-duplicates → feed to scripts/dedup-books.ts, not a rename.`);
    }
    console.log();
  }

  const outPath = path.join(
    process.cwd(),
    "reports",
    `title-cleanup-${APPLY ? "applied" : "dryrun"}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  );
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        apply: APPLY,
        boxSets: boxTargets.map((b) => ({ id: b.id, title: b.title })),
        renames: titleTargets.map(({ row, next }) => ({ id: row.id, from: row.title, to: next, slug: row.slug })),
        heldBackAsDuplicates: heldBackDupes.map(({ row, next }) => ({ id: row.id, from: row.title, wouldBe: next, slug: row.slug })),
      },
      null,
      2,
    ),
  );
  console.log(`Report: ${outPath}`);

  if (!APPLY) {
    console.log(`\nDry run only. Re-run with --apply to write.`);
    return;
  }

  const g = await createGuardedTurso({
    name: "catalog-title-cleanup",
    maxRuntimeMs: 2 * 60 * 60 * 1000,
    queryTimeoutMs: 30_000,
    longRunning: true,
  });
  const now = new Date().toISOString();
  let boxOk = 0, boxFail = 0, titleOk = 0, titleFail = 0;

  for (const b of boxTargets) {
    try {
      localDb.prepare(`UPDATE books SET is_box_set = 1, updated_at = ? WHERE id = ?`).run(now, b.id);
      await sleep(PAUSE_MS);
      await g.remote.execute({ sql: `UPDATE books SET is_box_set = 1, updated_at = ? WHERE id = ?`, args: [now, b.id] });
      boxOk++;
    } catch (e: any) {
      boxFail++;
      console.error(`  box-set flag failed ${b.id}: ${e?.message}`);
    }
    if (boxOk % 25 === 0) g.heartbeat(`box ${boxOk}/${boxTargets.length}`);
  }

  for (const { row, next } of titleTargets) {
    try {
      localDb.prepare(`UPDATE books SET title = ?, updated_at = ? WHERE id = ?`).run(next, now, row.id);
      await sleep(PAUSE_MS);
      await g.remote.execute({ sql: `UPDATE books SET title = ?, updated_at = ? WHERE id = ?`, args: [next, now, row.id] });
      titleOk++;
    } catch (e: any) {
      titleFail++;
      console.error(`  rename failed ${row.id}: ${e?.message}`);
    }
    if (titleOk % 25 === 0) g.heartbeat(`title ${titleOk}/${titleTargets.length}`);
  }

  console.log(`\n=== APPLIED ===`);
  if (DO_BOX) console.log(`Box sets flagged:  ${boxOk} (${boxFail} failed)`);
  if (DO_TITLES) console.log(`Titles cleaned:    ${titleOk} (${titleFail} failed)`);
  console.log(`\nNOTE: titles changed on both local and Turso; slugs deliberately unchanged.`);
  console.log(`Re-run scripts/sync-meilisearch.ts so search reflects the new titles.`);
  g.shutdown();
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
