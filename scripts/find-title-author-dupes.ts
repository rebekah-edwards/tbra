/**
 * find-title-author-dupes.ts — Scan LOCAL sqlite for books that exist twice with the same
 * title + author. For each dupe group, cross-check user_count on Turso to designate a canonical.
 *
 * Read-only. Writes reports/title-author-dupe-candidates-<ts>.json in the format expected by
 * scripts/replay-dedup-on-turso.ts (so we can feed auto-mergeable groups into that script).
 *
 * Why local first: running the whole scan on Turso requires a correlated subquery across
 * 20K+ books + authors + book_authors, which is painfully slow over the network. Local SQLite
 * finishes in under a second. After grouping, we only hit Turso for the ~dupe groups we want
 * to confirm user_count on.
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.vercel.local" });
import Database from "better-sqlite3";
import { createClient } from "@libsql/client";
import fs from "fs";
import path from "path";
import { findUserOverlap, localRunner, tursoRunner, type OverlapRunner } from "./lib/dupe-overlap";

const VERIFY_ON_TURSO = process.argv.includes("--verify-turso");

type LocalRow = {
  id: string;
  title: string;
  slug: string;
  cover_source: string | null;
  cover_image_url: string | null;
  publication_year: number | null;
  created_at: string;
  updated_at: string;
  author_name: string | null;
  local_user_count: number;
};

function normTitle(t: string): string {
  return t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
  const dbPath = path.join(process.cwd(), "data", "tbra.db");
  const db = new Database(dbPath, { readonly: true });

  console.log("Reading local books + authors...");
  const t0 = Date.now();
  const rows = db
    .prepare(
      `
      SELECT
        b.id, b.title, b.slug, b.cover_source, b.cover_image_url, b.publication_year,
        b.created_at, b.updated_at,
        (SELECT a.name FROM authors a
           JOIN book_authors ba ON ba.author_id = a.id
           WHERE ba.book_id = b.id ORDER BY a.name LIMIT 1) as author_name,
        (SELECT COUNT(*) FROM user_book_state WHERE book_id = b.id) as local_user_count
      FROM books b
      WHERE b.visibility = 'public'
    `,
    )
    .all() as LocalRow[];
  console.log(`Loaded ${rows.length} public books in ${Date.now() - t0}ms`);
  db.close();

  const groups = new Map<string, LocalRow[]>();
  for (const r of rows) {
    if (!r.author_name) continue;
    const key = `${normTitle(r.title)}|${normTitle(r.author_name)}`;
    const arr = groups.get(key) ?? [];
    arr.push(r);
    groups.set(key, arr);
  }

  type DupeGroup = {
    key: string;
    title: string;
    author: string;
    count: number;
    slug_prefix_pair: boolean;
    rows: (LocalRow & { turso_user_count?: number })[];
  };

  const dupeGroups: DupeGroup[] = [];
  for (const [key, rs] of groups) {
    if (rs.length < 2) continue;
    const slug_prefix_pair = rs.some((a) =>
      rs.some((b) => a.id !== b.id && a.slug && b.slug && b.slug.startsWith(a.slug + "-")),
    );
    dupeGroups.push({
      key,
      title: rs[0].title,
      author: rs[0].author_name!,
      count: rs.length,
      slug_prefix_pair,
      rows: rs,
    });
  }
  console.log(`\nDupe groups found: ${dupeGroups.length}`);

  // Runners for the same-user overlap check during scoring (below). BOTH databases must
  // be checked: replay-dedup-both merges local AND Turso, and the two can disagree — a
  // user row can exist locally but not yet on Turso (or vice versa). Checking only Turso
  // let 4 local-only collisions into the manifest on the 2026-07-30 run.
  const overlapRuns: OverlapRunner[] = [];

  if (VERIFY_ON_TURSO && dupeGroups.length > 0) {
    console.log(`Verifying user_count on Turso for ${dupeGroups.length} groups...`);
    const client = createClient({
      url: process.env.TURSO_DATABASE_URL!,
      authToken: process.env.TURSO_AUTH_TOKEN!,
    });
    overlapRuns.push(tursoRunner(client));

    // Batch: collect all dupe book IDs, query user_counts in chunks
    const allIds: string[] = [];
    for (const g of dupeGroups) for (const r of g.rows) allIds.push(r.id);
    const userCountMap = new Map<string, number>();
    const CHUNK = 200;
    for (let i = 0; i < allIds.length; i += CHUNK) {
      const chunk = allIds.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => "?").join(",");
      const r = await client.execute({
        sql: `SELECT book_id, COUNT(*) c FROM user_book_state WHERE book_id IN (${placeholders}) GROUP BY book_id`,
        args: chunk,
      });
      for (const row of r.rows) {
        userCountMap.set(row.book_id as string, Number(row.c));
      }
      process.stdout.write(`  ${Math.min(i + CHUNK, allIds.length)}/${allIds.length}\r`);
    }
    console.log();

    // Also confirm each book still exists on Turso
    const existIdsSet = new Set<string>();
    for (let i = 0; i < allIds.length; i += CHUNK) {
      const chunk = allIds.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => "?").join(",");
      const r = await client.execute({
        sql: `SELECT id FROM books WHERE id IN (${placeholders})`,
        args: chunk,
      });
      for (const row of r.rows) existIdsSet.add(row.id as string);
    }

    for (const g of dupeGroups) {
      g.rows = g.rows
        .map((r) => ({ ...r, turso_user_count: userCountMap.get(r.id) ?? 0 }))
        .filter((r) => existIdsSet.has(r.id));
      g.count = g.rows.length;
    }
    // Re-filter groups that no longer have 2+ after Turso-existence check
    const before = dupeGroups.length;
    const filtered = dupeGroups.filter((g) => g.rows.length >= 2);
    console.log(`Groups after Turso existence check: ${filtered.length} (was ${before})`);
    dupeGroups.length = 0;
    dupeGroups.push(...filtered);
  }

  // Score + classify each group
  type Scored = DupeGroup & {
    suggested_canonical_id: string;
    auto_mergeable: boolean;
    /** "clean" = no user rows to move; "user-data-move" = rows move but nobody is on both sides. */
    merge_kind: "clean" | "user-data-move" | null;
    /** Populated when a real same-user collision blocks the merge. */
    overlap: string[];
  };

  // Local is always checked (and is the only source when --verify-turso is absent).
  overlapRuns.push(localRunner(new Database(dbPath, { readonly: true })));

  const scored: Scored[] = [];
  for (const g of dupeGroups) {
    const rankKey = (r: any): number => {
      const uc = VERIFY_ON_TURSO ? (r.turso_user_count ?? 0) : r.local_user_count;
      const slugValid = r.slug && r.slug !== "null" && r.slug.length > 0;
      const authorSlugSuffix =
        slugValid &&
        r.slug.includes("-") &&
        normTitle(r.author_name ?? "").replace(/ /g, "-") &&
        r.slug.endsWith(normTitle(r.author_name ?? "").replace(/ /g, "-"))
          ? 3
          : 0;
      // Prefer slugs without numeric "-2"/"-3"/… suffixes (those were assigned to resolve collisions).
      const hasNumericSuffix = slugValid && /-\d+$/.test(r.slug);
      return (
        uc * 1000 +
        // Heavily penalize null/empty slug so it can never be canonical if any valid-slug sibling exists
        (slugValid ? 100 : -100000) +
        (hasNumericSuffix ? -50 : 0) +
        (r.cover_image_url ? 20 : 0) +
        (r.cover_source && !r.cover_source.includes("placeholder") && r.cover_source !== "none-found"
          ? 10
          : 0) +
        (r.publication_year ? 2 : 0) +
        authorSlugSuffix
      );
    };
    const ranked = [...g.rows].sort((a, b) => rankKey(b) - rankKey(a));
    const canonical = ranked[0];
    const others = ranked.slice(1);
    const otherCount = (r: any) =>
      VERIFY_ON_TURSO ? (r.turso_user_count ?? 0) : r.local_user_count;
    const canonicalSlugValid =
      canonical.slug && canonical.slug !== "null" && canonical.slug.length > 0;
    // Require a clear winner: canonical's score should exceed the runner-up by at least 10 points
    // (cover quality diff) so we don't auto-merge when the top two are near-ties.
    const clearWinner =
      ranked.length === 1 || rankKey(canonical) - rankKey(ranked[1]) >= 10;

    // A group is safe to auto-merge when the canonical is unambiguous AND moving the
    // losers' user rows onto it cannot silently drop anything. Historically the second
    // condition was approximated as "the losers have zero users", which blocked every
    // multi-user group. The real hazard is a SAME-USER collision: replay-dedup-both moves
    // rows with INSERT OR IGNORE and then deletes the source, so a user holding rows on
    // both books loses the dupe's copy (see scripts/lib/dupe-overlap.ts). Zero-user losers
    // are trivially collision-free; anything else is checked for real.
    // NOTE: zeroUserLosers is computed from ONE database's counts, so it is not by itself
    // proof of safety — a loser with 0 users on Turso can still hold local rows. Check
    // every candidate group on both DBs rather than trusting the count shortcut.
    const zeroUserLosers = others.every((o) => otherCount(o) === 0);
    const overlap: string[] = [];
    if (canonicalSlugValid && clearWinner) {
      for (const o of others) {
        for (const run of overlapRuns) {
          const hits = await findUserOverlap(run, canonical.id, o.id);
          if (hits.length) overlap.push(...hits.map((h) => `${o.slug}→${run.label}/${h}`));
        }
      }
    }
    const auto_mergeable = canonicalSlugValid && clearWinner && overlap.length === 0;

    scored.push({
      ...g,
      suggested_canonical_id: canonical.id,
      auto_mergeable,
      merge_kind: !auto_mergeable ? null : zeroUserLosers ? "clean" : "user-data-move",
      overlap,
    });
  }

  scored.sort((a, b) => {
    // slug-prefix pairs first, then auto-mergeable, then by group size
    if (a.slug_prefix_pair !== b.slug_prefix_pair) return a.slug_prefix_pair ? -1 : 1;
    if (a.auto_mergeable !== b.auto_mergeable) return a.auto_mergeable ? -1 : 1;
    return b.count - a.count;
  });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(process.cwd(), "reports");
  const outPath = path.join(dir, `title-author-dupe-candidates-${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify(scored, null, 2));

  // Also emit a dedup-manifest compatible file that replay-dedup-on-turso.ts can read
  const manifestPath = path.join(dir, `title-author-dupe-manifest-${stamp}.json`);
  const manifest: { dupe_id: string; canonical_id: string; dupe_title: string; canonical_title: string }[] = [];
  for (const g of scored) {
    if (!g.auto_mergeable) continue;
    for (const r of g.rows) {
      if (r.id === g.suggested_canonical_id) continue;
      manifest.push({
        dupe_id: r.id,
        canonical_id: g.suggested_canonical_id,
        dupe_title: r.title,
        canonical_title: g.title,
      });
    }
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  const slugPrefixCount = scored.filter((g) => g.slug_prefix_pair).length;
  const autoMergeCount = scored.filter((g) => g.auto_mergeable).length;
  const cleanCount = scored.filter((g) => g.merge_kind === "clean").length;
  const userMoveCount = scored.filter((g) => g.merge_kind === "user-data-move").length;
  const collisionGroups = scored.filter((g) => g.overlap.length > 0);

  console.log(`\n=== SUMMARY ===`);
  console.log(`Total dupe groups:                ${scored.length}`);
  console.log(`Slug-prefix (Parade) pattern:     ${slugPrefixCount}`);
  console.log(`Auto-mergeable (total):           ${autoMergeCount}`);
  console.log(`  … clean (no user rows to move): ${cleanCount}`);
  console.log(`  … user-data move (no overlap):  ${userMoveCount}`);
  console.log(`Held — same-user collision:       ${collisionGroups.length}`);

  if (collisionGroups.length > 0) {
    console.log(`\n=== HELD FOR MANUAL MERGE (same user on both books) ===`);
    for (const g of collisionGroups.slice(0, 20)) {
      console.log(`  ${g.title} — ${g.author}: ${g.overlap.join(", ")}`);
    }
    if (collisionGroups.length > 20) console.log(`  … and ${collisionGroups.length - 20} more`);
  }
  console.log(`Candidates report:   ${outPath}`);
  console.log(`Dedup manifest:      ${manifestPath}  (${manifest.length} pairs)`);

  console.log(`\n=== TOP 20 SLUG-PREFIX DUPES ===`);
  for (const g of scored.filter((x) => x.slug_prefix_pair).slice(0, 20)) {
    const tag = g.auto_mergeable
      ? g.merge_kind === "user-data-move"
        ? "[auto-merge: moves user data]"
        : "[auto-merge]"
      : g.overlap.length
        ? "[held: same-user collision]"
        : "[needs review]";
    console.log(`\n${g.title}  —  ${g.author}  ${tag}`);
    for (const r of g.rows) {
      const uc = VERIFY_ON_TURSO ? r.turso_user_count ?? 0 : r.local_user_count;
      const tag = r.id === g.suggested_canonical_id ? " ★" : "";
      console.log(
        `  /book/${r.slug}  [users=${uc}, cover=${r.cover_source ?? "—"}, year=${r.publication_year ?? "—"}]${tag}`,
      );
    }
  }

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
