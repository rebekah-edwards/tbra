/**
 * Populate book_slug_history from a dedup scan/manifest so every slug that a
 * merge retired keeps resolving instead of 404-ing.
 *
 * Public book URLs are slugs (see CLAUDE.md), so deleting a duplicate silently
 * kills every link and indexed search result pointing at it. The merge tooling
 * has never recorded these, so this also serves as the backfill for merges that
 * already ran.
 *
 * Reads the SCAN file (find-edition-variant-dupes output), which carries
 * `dupe_slug` — the merge manifest does not.
 *
 *   npx tsx scripts/backfill-slug-history.ts --scan=reports/<scan>.json
 *   npx tsx scripts/backfill-slug-history.ts --scan=reports/<scan>.json --apply
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env.vercel.local" });

import Database from "better-sqlite3";
import fs from "fs";
import { createGuardedTurso } from "./lib/turso-guard";

const APPLY = process.argv.includes("--apply");
const SCAN = process.argv.find((a) => a.startsWith("--scan="))?.split("=")[1];
const REASON = process.argv.find((a) => a.startsWith("--reason="))?.split("=")[1] ?? "merge";
if (!SCAN) {
  console.error("--scan=<scan file with dupe_slug> is required");
  process.exit(1);
}

(async () => {
  const scan = JSON.parse(fs.readFileSync(SCAN, "utf8"));
  const pairs = [...(scan.autoMerge ?? []), ...(scan.supervised ?? [])];

  const local = new Database("data/tbra.db");
  const { remote } = await createGuardedTurso({
    name: "backfill-slug-history",
    maxRuntimeMs: 20 * 60 * 1000,
    queryTimeoutMs: 30_000,
  });

  let written = 0;
  let noSlug = 0;
  let stillAlive = 0;
  let targetGone = 0;

  for (const p of pairs) {
    if (!p.dupe_slug || p.dupe_slug === "null") {
      noSlug++;
      continue;
    }
    // If the dupe row still exists the merge did not run for this pair; its slug
    // is live and must NOT be shadowed by a history entry.
    const alive = local.prepare("SELECT 1 FROM books WHERE id = ?").get(p.dupe_id);
    if (alive) {
      stillAlive++;
      continue;
    }
    // Never point a redirect at a book that is itself gone.
    const target = local.prepare("SELECT 1 FROM books WHERE id = ?").get(p.canonical_id);
    if (!target) {
      targetGone++;
      continue;
    }

    if (APPLY) {
      const args = [p.dupe_slug, p.canonical_id, REASON];
      local
        .prepare("INSERT OR IGNORE INTO book_slug_history (old_slug, book_id, reason) VALUES (?,?,?)")
        .run(...args);
      await remote.execute({
        sql: "INSERT OR IGNORE INTO book_slug_history (old_slug, book_id, reason) VALUES (?,?,?)",
        args,
      });
    }
    written++;
  }

  console.log(`[slug-history] mode=${APPLY ? "APPLY" : "DRY RUN"}  reason=${REASON}`);
  console.log(`  redirects ${APPLY ? "written" : "to write"}: ${written}`);
  console.log(`  skipped — dupe had no slug:        ${noSlug}`);
  console.log(`  skipped — dupe still exists:       ${stillAlive}`);
  console.log(`  skipped — merge target is gone:    ${targetGone}`);
  process.exit(0);
})();
