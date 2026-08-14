/**
 * Scan the catalog for edition-variant duplicates — "<Title> Deluxe Limited
 * Edition" rows that should be an EDITION of the canon book rather than their
 * own `books` entry.
 *
 * READ-ONLY. Emits a manifest for the supervised applier
 * (`scripts/replay-dedup-both.ts`), plus a triage breakdown so a human can see
 * what would happen before anything is touched.
 *
 * The scan runs on LOCAL and verifies each pair on Turso, because the two
 * databases disagree about user rows in practice and a Turso-only overlap
 * check would have merged pairs that collide locally (2026-07-30 incident).
 *
 *   npx tsx scripts/find-edition-variant-dupes.ts
 *   npx tsx scripts/find-edition-variant-dupes.ts --verify-turso
 *   npx tsx scripts/find-edition-variant-dupes.ts --verify-turso --out=reports/edition-dupes.json
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env.vercel.local" });

import { createClient } from "@libsql/client";
import { writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import {
  editionMatchKey,
  extractEditionLabel,
  isDecoratedTitle,
  normalizeAuthor,
} from "../src/lib/text/edition-title";
import { findUserOverlap, tursoRunner } from "./lib/dupe-overlap";

const VERIFY_TURSO = process.argv.includes("--verify-turso");
const OUT =
  process.argv.find((a) => a.startsWith("--out="))?.slice("--out=".length) ??
  `reports/edition-variant-dupes-${new Date().toISOString().slice(0, 10)}.json`;

interface Row {
  id: string;
  title: string;
  slug: string | null;
  visibility: string | null;
  author_name: string | null;
  users: number;
  isbn13: string | null;
  isbn10: string | null;
  cover: string | null;
  pages: number | null;
  publisher: string | null;
  year: number | null;
}

(async () => {
  const local = createClient({ url: "file:data/tbra.db" });

  const rows = (
    await local.execute(`
      SELECT b.id, b.title, b.slug, b.visibility, b.isbn_13 AS isbn13, b.isbn_10 AS isbn10,
             b.cover_image_url AS cover, b.pages, b.publisher, b.publication_year AS year,
             (SELECT a.name FROM authors a JOIN book_authors ba ON ba.author_id = a.id
               WHERE ba.book_id = b.id ORDER BY a.name LIMIT 1) AS author_name,
             (SELECT COUNT(*) FROM user_book_state WHERE book_id = b.id) AS users
      FROM books b
      WHERE b.is_box_set = 0
    `)
  ).rows as unknown as Row[];

  // Group by (edition-stripped title, author). Only groups that contain at
  // least one DECORATED row are edition-variant groups — a group of two plain
  // titles is an ordinary duplicate and belongs to find-title-author-dupes.ts.
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    if (!r.title || !r.author_name) continue;
    const key = `${editionMatchKey(r.title)}|||${normalizeAuthor(r.author_name)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const autoMerge: any[] = [];
  const supervised: any[] = [];
  const noCanon: any[] = [];

  for (const [, g] of groups) {
    if (g.length < 2) continue;
    const decorated = g.filter((r) => isDecoratedTitle(r.title));
    if (decorated.length === 0) continue; // plain dupe — not this script's job

    const undecorated = g.filter((r) => !isDecoratedTitle(r.title));
    if (undecorated.length === 0) {
      // Every row in the group is decorated: there is no canon to merge INTO.
      // Renaming one to the undecorated form is a judgement call, not a merge.
      noCanon.push({ titles: g.map((r) => r.title), author: g[0].author_name });
      continue;
    }

    // Canon: undecorated, prefer public, then most shelf activity.
    const canon = [...undecorated].sort(
      (a, b) =>
        (b.visibility === "public" ? 1 : 0) - (a.visibility === "public" ? 1 : 0) ||
        Number(b.users) - Number(a.users),
    )[0];

    for (const d of decorated) {
      const pair = {
        dupe_id: d.id,
        dupe_title: d.title,
        dupe_slug: d.slug,
        dupe_users: Number(d.users),
        canonical_id: canon.id,
        canonical_title: canon.title,
        canonical_slug: canon.slug,
        // Carried onto an `editions` row so the printing survives the merge.
        edition: {
          label: extractEditionLabel(d.title),
          isbn13: d.isbn13,
          isbn10: d.isbn10,
          coverUrl: d.cover,
          pages: d.pages,
          publisher: d.publisher,
          year: d.year,
        },
      };

      if (Number(d.users) === 0) {
        autoMerge.push(pair);
      } else {
        supervised.push(pair);
      }
    }
  }

  // Turso verification: a pair is only safe to auto-merge if the dupe carries
  // no user rows on EITHER database. Live is where testers actually shelve.
  let demoted = 0;
  if (VERIFY_TURSO) {
    const remoteUrl = process.env.TURSO_DATABASE_URL;
    const remoteToken = process.env.TURSO_AUTH_TOKEN;
    if (!remoteUrl) {
      console.error("[edition-dupes] TURSO_DATABASE_URL missing — cannot verify.");
      process.exit(1);
    }
    const remote = createClient({ url: remoteUrl, authToken: remoteToken });
    const run = tursoRunner(remote);
    for (let i = autoMerge.length - 1; i >= 0; i--) {
      const p = autoMerge[i];
      const overlap = await findUserOverlap(run, p.canonical_id, p.dupe_id);
      const live = (
        await remote.execute({
          sql: "SELECT COUNT(*) c FROM user_book_state WHERE book_id = ?",
          args: [p.dupe_id],
        })
      ).rows[0] as any;
      if (Number(live.c) > 0 || (overlap && overlap.length > 0)) {
        supervised.push({ ...p, demoted_reason: "user rows on Turso" });
        autoMerge.splice(i, 1);
        demoted++;
      }
    }
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ autoMerge, supervised, noCanon }, null, 2));

  console.log(`[edition-dupes] scanned ${rows.length.toLocaleString()} books`);
  console.log(`  auto-mergeable (0 user rows${VERIFY_TURSO ? ", verified on Turso" : ", LOCAL ONLY — rerun with --verify-turso"}): ${autoMerge.length}`);
  console.log(`  supervised (dupe carries user rows): ${supervised.length}${demoted ? ` (${demoted} demoted by Turso check)` : ""}`);
  console.log(`  groups with no undecorated canon (rename, don't merge): ${noCanon.length}`);
  console.log(`  manifest: ${OUT}`);

  console.log(`\n  sample of auto-mergeable pairs:`);
  for (const p of autoMerge.slice(0, 15)) {
    console.log(`    "${p.dupe_title}"  ->  "${p.canonical_title}"   [label: ${p.edition.label ?? "—"}, isbn: ${p.edition.isbn13 ?? p.edition.isbn10 ?? "—"}]`);
  }
  if (supervised.length) {
    console.log(`\n  supervised pairs (need a human — user data on the dupe):`);
    for (const p of supervised.slice(0, 20)) {
      console.log(`    "${p.dupe_title}" (${p.dupe_users}u)  ->  "${p.canonical_title}"${p.demoted_reason ? `  [${p.demoted_reason}]` : ""}`);
    }
  }
  process.exit(0);
})();
