/**
 * Phase 2 of docs/edition-variant-backfill-plan.md — capture each decorated
 * row's printing as an `editions` row on the CANON book, then emit a flat pair
 * manifest for `replay-dedup-both.ts` to merge.
 *
 * This is the step that makes the backfill a *merge into a selectable edition*
 * rather than a plain deduplication. Every decorated row carries an ISBN,
 * cover, page count and publisher that OpenLibrary often does not list;
 * deleting the row without capturing them first is an unrecoverable loss of
 * fidelity — the merge doc's "case 2".
 *
 * ORDER MATTERS. This must run BEFORE replay-dedup-both.ts. That script has
 * `editions` in its JOIN_TABLES and does `DELETE FROM editions WHERE book_id =
 * <dupe>`, so the rows written here deliberately hang off the CANONICAL id and
 * survive the merge.
 *
 * Writes to local AND Turso directly rather than relying on sync-push step 5g,
 * so the two sides are consistent the moment the merge runs.
 *
 *   npx tsx scripts/apply-edition-variant-merges.ts --scan=reports/<scan>.json
 *   npx tsx scripts/apply-edition-variant-merges.ts --scan=reports/<scan>.json --apply
 *
 * Flags:
 *   --include-clean-supervised   also take supervised pairs whose dupe carries
 *                                user rows but has NO same-user collision (the
 *                                rows move safely with UPDATE book_id). Pairs
 *                                that DO collide are always held back.
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env.vercel.local" });

import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { createGuardedTurso } from "./lib/turso-guard";
import { findUserOverlap, localRunner, tursoRunner } from "./lib/dupe-overlap";

const APPLY = process.argv.includes("--apply");
const INCLUDE_CLEAN_SUPERVISED = process.argv.includes("--include-clean-supervised");
const SCAN = process.argv.find((a) => a.startsWith("--scan="))?.split("=")[1];
if (!SCAN) {
  console.error("--scan=<path to find-edition-variant-dupes output> is required");
  process.exit(1);
}

interface Pair {
  dupe_id: string;
  dupe_title: string;
  canonical_id: string;
  canonical_title: string;
  dupe_users?: number;
  edition: {
    label: string | null;
    isbn13: string | null;
    isbn10: string | null;
    coverUrl: string | null;
    pages: number | null;
    publisher: string | null;
    year: number | null;
  };
}

const EDITION_COLS =
  "id, open_library_key, book_id, title, publish_date, publishers, isbn_13, isbn_10, pages, cover_id, source, cover_url, format, edition_label, merged_from_book_id";
const EDITION_PLACEHOLDERS = "?,?,?,?,?,?,?,?,?,?,?,?,?,?,?";

(async () => {
  const scan = JSON.parse(fs.readFileSync(SCAN, "utf8")) as {
    autoMerge: Pair[];
    supervised: Pair[];
  };

  const local = new Database("data/tbra.db");
  const { remote } = await createGuardedTurso({
    name: "apply-edition-variant-merges",
    maxRuntimeMs: 45 * 60 * 1000,
    queryTimeoutMs: 30_000,
    longRunning: false,
  });

  const lr = localRunner(local);
  const tr = tursoRunner(remote);

  // ── Select the pairs to act on ───────────────────────────────────────────
  const selected: Pair[] = [];
  const held: { pair: Pair; reason: string }[] = [];

  for (const p of scan.autoMerge) {
    // Re-verify the zero-user contract at APPLY time, not scan time: a tester
    // can shelve either book in between, and that is exactly the window that
    // turns a safe merge into silent data loss.
    const liveUsers = Number(
      (
        await remote.execute({
          sql: "SELECT COUNT(*) c FROM user_book_state WHERE book_id = ?",
          args: [p.dupe_id],
        })
      ).rows[0].c,
    );
    const localUsers = Number(
      (local.prepare("SELECT COUNT(*) c FROM user_book_state WHERE book_id = ?").get(p.dupe_id) as any).c,
    );
    if (liveUsers > 0 || localUsers > 0) {
      held.push({ pair: p, reason: `acquired user rows since scan (local ${localUsers}, live ${liveUsers})` });
      continue;
    }
    selected.push(p);
  }

  if (INCLUDE_CLEAN_SUPERVISED) {
    for (const p of scan.supervised) {
      const L = await findUserOverlap(lr, p.canonical_id, p.dupe_id);
      const T = await findUserOverlap(tr, p.canonical_id, p.dupe_id);
      if (L.length || T.length) {
        held.push({ pair: p, reason: `same-user collision — local[${L.join(",")}] turso[${T.join(",")}]` });
        continue;
      }
      selected.push(p);
    }
  } else {
    for (const p of scan.supervised) held.push({ pair: p, reason: "supervised (not requested)" });
  }

  console.log(`[apply-editions] mode=${APPLY ? "APPLY" : "DRY RUN"}`);
  console.log(`  selected for merge: ${selected.length}`);
  console.log(`  held back:          ${held.length}`);

  // ── Phase 2: capture the printing on the CANON book ──────────────────────
  let created = 0;
  let skippedExisting = 0;
  let nothingToRecord = 0;

  for (const p of selected) {
    const { isbn13, isbn10 } = p.edition;
    // A printing with no ISBN and no label carries nothing the canon book does
    // not already have — recording it would just add a nameless picker entry.
    if (!isbn13 && !isbn10 && !p.edition.label) {
      nothingToRecord++;
      continue;
    }

    const dupCheck = isbn13
      ? { sql: "SELECT id FROM editions WHERE book_id = ? AND isbn_13 = ?", args: [p.canonical_id, isbn13] }
      : isbn10
        ? { sql: "SELECT id FROM editions WHERE book_id = ? AND isbn_10 = ?", args: [p.canonical_id, isbn10] }
        : {
            sql: "SELECT id FROM editions WHERE book_id = ? AND edition_label = ? AND merged_from_book_id = ?",
            args: [p.canonical_id, p.edition.label, p.dupe_id],
          };

    const existsLocal = local.prepare(dupCheck.sql).get(...(dupCheck.args as any[]));
    if (existsLocal) {
      skippedExisting++;
      continue;
    }

    const id = crypto.randomUUID();
    const values = [
      id,
      `local:${id}`,
      p.canonical_id,
      p.dupe_title,
      p.edition.year ? String(p.edition.year) : null,
      p.edition.publisher ? JSON.stringify([p.edition.publisher]) : null,
      isbn13,
      isbn10,
      p.edition.pages,
      null, // cover_id — OpenLibrary only
      "merge",
      p.edition.coverUrl,
      null, // format — unknown from the title alone; null shows in every format list
      p.edition.label,
      p.dupe_id,
    ];

    if (!APPLY) {
      created++;
      continue;
    }

    // Local first, then Turso — same ordering discipline as the merge itself.
    local
      .prepare(`INSERT INTO editions (${EDITION_COLS}) VALUES (${EDITION_PLACEHOLDERS})`)
      .run(...(values as any[]));
    await remote.execute({
      sql: `INSERT INTO editions (${EDITION_COLS}) VALUES (${EDITION_PLACEHOLDERS})`,
      args: values as any[],
    });
    created++;
  }

  console.log(`\n  editions recorded on canon: ${created}`);
  console.log(`  already recorded (idempotent skip): ${skippedExisting}`);
  console.log(`  nothing worth recording (no ISBN, no label): ${nothingToRecord}`);

  // ── Emit the flat manifest replay-dedup-both.ts expects ──────────────────
  const outPath = path.join(
    "reports",
    `dedup-manifest-edition-variants-${new Date().toISOString().slice(0, 10)}.json`,
  );
  const flat = selected.map((p) => ({
    dupe_id: p.dupe_id,
    dupe_title: p.dupe_title,
    canonical_id: p.canonical_id,
    canonical_title: p.canonical_title,
  }));
  if (APPLY) {
    fs.writeFileSync(outPath, JSON.stringify(flat, null, 2));
    console.log(`\n  merge manifest: ${outPath} (${flat.length} pairs)`);
    console.log(`  next: npx tsx scripts/replay-dedup-both.ts --manifest=${outPath} --apply`);
  } else {
    console.log(`\n  would write merge manifest: ${outPath} (${flat.length} pairs)`);
  }

  if (held.length) {
    console.log(`\n  HELD BACK (not merged):`);
    for (const h of held) console.log(`    "${h.pair.dupe_title}" -> "${h.pair.canonical_title}"  [${h.reason}]`);
  }

  process.exit(0);
})();
