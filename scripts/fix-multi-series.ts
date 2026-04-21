/**
 * fix-multi-series.ts — options A+B from the audit.
 *
 * A. Wrong-sibling pattern (307 pairs): book author matches exactly one of
 *    the two linked series' primary authors. Delete the book_series row
 *    for the non-matching series. Same pattern as the Legend→Drenai Saga
 *    fix, scaled.
 *
 * B. Series dedup (373 exact-name + 36 near-dupe = 409 pairs): when a book
 *    is linked to two series whose names normalize to the same thing,
 *    merge them. Canonical wins; dupe's rows move over; dupe series row
 *    deleted. Canonical chosen by: has slug → more books → lowest id.
 *
 * Local + Turso in one pass. Dry-run by default.
 *
 * Usage: npx tsx scripts/fix-multi-series.ts [--apply]
 */
import Database from "better-sqlite3";
import path from "path";
import { createClient } from "@libsql/client";
import { config } from "dotenv";

config({ path: ".env.vercel.local" });
const APPLY = process.argv.includes("--apply");

const localDb = new Database(path.join(process.cwd(), "data", "tbra.db"));
const turso = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** Unifies &/and/+/plus, strips "the/a/an", strips trailing plural (s/es) from tokens > 3 chars. */
function aggressiveNormalize(s: string): string {
  let r = s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  r = r.replace(/\s*&\s*/g, " and ").replace(/\s*\+\s*/g, " and ").replace(/\bplus\b/g, "and").replace(/\ben\b/g, "and");
  r = r.replace(/\b(the|a|an)\b/g, "");
  const tokens = r.split(/[^a-z0-9]+/).filter(Boolean).map((t) => {
    if (t.length > 3 && t.endsWith("es")) return t.slice(0, -2);
    if (t.length > 3 && t.endsWith("s")) return t.slice(0, -1);
    return t;
  });
  return tokens.join("");
}

// Curated judgment-call merges — author-confirmed near-dupes that the aggressive
// normalizer doesn't catch (word reorder, synonyms, possessives, verbose subtitles).
// Format: canonical name | dupe name | author (for verification at runtime).
const CURATED_MERGES: { keep: string; drop: string; author: string }[] = [
  { keep: "Essays of Elia", drop: "Elia Essays", author: "Charles Lamb" },
  { keep: "Amish Brides of Birch Creek", drop: "Amish of Birch Creek", author: "Kathleen Fuller" },
  { keep: "Hello Reader! Math Level 2", drop: "Hello Math Reader", author: "Sheila Keenan" },
  { keep: "Ignatius Catholic Study Bible", drop: "Ignatius Study Bible", author: "Curtis Mitch" },
  { keep: "DreamWorks Voltron: Legendary Defender", drop: "Voltron Legendary Defender", author: "Cala Spinner" },
  { keep: "Faye Longchamp Mysteries", drop: "Faye Longchamp Mystery", author: "Mary Anna Evans" },
  { keep: "Christine Bennett Mysteries", drop: "Christine Bennett Mystery", author: "Lee Harris" },
  { keep: "Miss Peregrine's Peculiar Children", drop: "Miss Peregrine's Home for Peculiar Children", author: "Ransom Riggs" },
  { keep: "The Circle Series", drop: "The Circle Trilogy", author: "Ted Dekker" },
  { keep: "The Kindred\u2019s Curse Saga", drop: "Kindred's Curse", author: "Penn Cole" },
  { keep: "John Wayne Cleaver", drop: "John Cleaver", author: "Dan Wells" },
  { keep: "Rich Dad's Advisors", drop: "Rich Dad Advisors", author: "Garrett Sutton" },
  { keep: "Overstreet Comic Book Price Guide", drop: "The Comic Book Price Guide", author: "Robert M. Overstreet" },
];

// ─── Part A: Wrong-sibling detection ───

type WrongSiblingHit = {
  bookId: string;
  bookTitle: string;
  seriesIdToDelete: string;
  seriesNameToDelete: string;
  seriesIdToKeep: string;
};

function findWrongSiblingHits(): WrongSiblingHit[] {
  const rows = localDb
    .prepare(
      `
      WITH multi_books AS (
        SELECT book_id FROM book_series GROUP BY book_id HAVING COUNT(*) > 1
      ),
      book_primary_author AS (
        SELECT ba.book_id, a.name
        FROM book_authors ba
        JOIN authors a ON a.id = ba.author_id
        WHERE ba.book_id IN (SELECT book_id FROM multi_books)
        GROUP BY ba.book_id
        HAVING ba.rowid = MIN(ba.rowid)
      ),
      series_primary_author AS (
        SELECT s.id AS series_id,
               (SELECT a2.name FROM authors a2
                JOIN book_authors ba2 ON ba2.author_id = a2.id
                JOIN book_series bs2 ON bs2.book_id = ba2.book_id
                WHERE bs2.series_id = s.id
                GROUP BY a2.id
                ORDER BY COUNT(*) DESC
                LIMIT 1) AS author_name
        FROM series s
        WHERE s.id IN (SELECT series_id FROM book_series WHERE book_id IN (SELECT book_id FROM multi_books))
      )
      SELECT
        b.id AS book_id, b.title AS book_title, bpa.name AS book_primary_author,
        bs_a.series_id AS series_a_id, s_a.name AS series_a_name, spa_a.author_name AS series_a_primary_author,
        bs_b.series_id AS series_b_id, s_b.name AS series_b_name, spa_b.author_name AS series_b_primary_author
      FROM multi_books mb
      JOIN books b ON b.id = mb.book_id
      LEFT JOIN book_primary_author bpa ON bpa.book_id = b.id
      JOIN book_series bs_a ON bs_a.book_id = b.id
      JOIN series s_a ON s_a.id = bs_a.series_id
      LEFT JOIN series_primary_author spa_a ON spa_a.series_id = s_a.id
      JOIN book_series bs_b ON bs_b.book_id = b.id AND bs_b.series_id > bs_a.series_id
      JOIN series s_b ON s_b.id = bs_b.series_id
      LEFT JOIN series_primary_author spa_b ON spa_b.series_id = s_b.id
    `,
    )
    .all() as any[];

  const hits: WrongSiblingHit[] = [];
  for (const r of rows) {
    if (!r.book_primary_author || !r.series_a_primary_author || !r.series_b_primary_author) continue;
    const bn = normalize(r.book_primary_author);
    const matchesA = normalize(r.series_a_primary_author) === bn;
    const matchesB = normalize(r.series_b_primary_author) === bn;
    if (matchesA === matchesB) continue; // both match or neither → not this bucket
    if (matchesA && !matchesB) {
      hits.push({
        bookId: r.book_id,
        bookTitle: r.book_title,
        seriesIdToDelete: r.series_b_id,
        seriesNameToDelete: r.series_b_name,
        seriesIdToKeep: r.series_a_id,
      });
    } else {
      hits.push({
        bookId: r.book_id,
        bookTitle: r.book_title,
        seriesIdToDelete: r.series_a_id,
        seriesNameToDelete: r.series_a_name,
        seriesIdToKeep: r.series_b_id,
      });
    }
  }
  return hits;
}

// ─── Part B: Series dedup (exact + near) ───

type DedupGroup = {
  canonicalId: string;
  canonicalName: string;
  dupeIds: { id: string; name: string }[];
  bookCount: number;  // total books across canonical + dupes
};

function findDedupGroups(): DedupGroup[] {
  // Every series row, with book count + primary author
  const all = localDb
    .prepare(
      `SELECT s.id, s.name, s.slug,
              (SELECT COUNT(*) FROM book_series WHERE series_id = s.id) AS book_count,
              (SELECT a2.name FROM authors a2
                JOIN book_authors ba2 ON ba2.author_id = a2.id
                JOIN book_series bs2 ON bs2.book_id = ba2.book_id
                WHERE bs2.series_id = s.id
                GROUP BY a2.id
                ORDER BY COUNT(*) DESC
                LIMIT 1) AS primary_author
       FROM series s`,
    )
    .all() as { id: string; name: string; slug: string | null; book_count: number; primary_author: string | null }[];

  type Seed = { id: string; name: string; slug: string | null; book_count: number; primary_author: string | null };

  // Pass 1: basic-normalize groups (author-agnostic — pure string dupes).
  const basicByNorm = new Map<string, Seed[]>();
  for (const s of all) {
    const key = normalize(s.name);
    if (!key) continue;
    const arr = basicByNorm.get(key) ?? [];
    arr.push(s);
    basicByNorm.set(key, arr);
  }

  const claimed = new Set<string>(); // series ids already in a basic-group
  const groups: DedupGroup[] = [];

  for (const [, arr] of basicByNorm) {
    if (arr.length < 2) continue;
    for (const s of arr) claimed.add(s.id);
    groups.push(buildGroup(arr));
  }

  // Pass 2: aggressive-normalize groups — only for series not already claimed,
  // and ONLY if ALL members share the same primary author (safety).
  const aggByNorm = new Map<string, Seed[]>();
  for (const s of all) {
    if (claimed.has(s.id)) continue;
    const basic = normalize(s.name);
    const agg = aggressiveNormalize(s.name);
    if (!agg || agg === basic) continue;
    const arr = aggByNorm.get(agg) ?? [];
    arr.push(s);
    aggByNorm.set(agg, arr);
  }

  for (const [, arr] of aggByNorm) {
    if (arr.length < 2) continue;
    const authors = new Set(arr.map((s) => (s.primary_author ? normalize(s.primary_author) : "")).filter(Boolean));
    if (authors.size !== 1) continue; // mixed authors → bail, not our bucket
    if (arr.some((s) => !s.primary_author)) continue; // author unknown → bail
    for (const s of arr) claimed.add(s.id);
    groups.push(buildGroup(arr));
  }

  // Pass 3: curated hand-picked merges.
  const byName = new Map<string, Seed[]>();
  for (const s of all) {
    const key = s.name.toLowerCase();
    const arr = byName.get(key) ?? [];
    arr.push(s);
    byName.set(key, arr);
  }
  for (const c of CURATED_MERGES) {
    const keepRows = byName.get(c.keep.toLowerCase()) ?? [];
    const dropRows = byName.get(c.drop.toLowerCase()) ?? [];
    if (keepRows.length === 0 || dropRows.length === 0) {
      console.warn(`  curated-merge: name not found — keep="${c.keep}" drop="${c.drop}"`);
      continue;
    }
    // Verify author matches on at least one side
    const authorOk = [...keepRows, ...dropRows].some(
      (s) => s.primary_author && normalize(s.primary_author) === normalize(c.author),
    );
    if (!authorOk) {
      console.warn(`  curated-merge: author mismatch for "${c.keep}" vs "${c.drop}" (expected ${c.author})`);
      continue;
    }
    const all1 = [...keepRows, ...dropRows].filter((s) => !claimed.has(s.id));
    if (all1.length < 2) continue;
    for (const s of all1) claimed.add(s.id);
    // Force canonical = the "keep" name
    all1.sort((a, b) => {
      const aIsKeep = a.name.toLowerCase() === c.keep.toLowerCase() ? 1 : 0;
      const bIsKeep = b.name.toLowerCase() === c.keep.toLowerCase() ? 1 : 0;
      if (aIsKeep !== bIsKeep) return bIsKeep - aIsKeep;
      return (b.book_count ?? 0) - (a.book_count ?? 0);
    });
    const [canonical, ...dupes] = all1;
    groups.push({
      canonicalId: canonical.id,
      canonicalName: canonical.name,
      dupeIds: dupes.map((d) => ({ id: d.id, name: d.name })),
      bookCount: all1.reduce((n, s) => n + s.book_count, 0),
    });
  }

  return groups;
}

function buildGroup(arr: { id: string; name: string; slug: string | null; book_count: number }[]): DedupGroup {
  arr.sort((a, b) => {
    const slugRank = Number(!!b.slug) - Number(!!a.slug);
    if (slugRank !== 0) return slugRank;
    const countRank = b.book_count - a.book_count;
    if (countRank !== 0) return countRank;
    return a.id.localeCompare(b.id);
  });
  const [canonical, ...dupes] = arr;
  return {
    canonicalId: canonical.id,
    canonicalName: canonical.name,
    dupeIds: dupes.map((d) => ({ id: d.id, name: d.name })),
    bookCount: arr.reduce((n, s) => n + s.book_count, 0),
  };
}

// ─── Main ───

async function main() {
  console.log(`=== fix-multi-series.ts ===`);
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN"}\n`);

  // Part A
  const wrongSiblings = findWrongSiblingHits();
  console.log(`─── Part A: Wrong-sibling pairs ───`);
  console.log(`Found ${wrongSiblings.length} book_series rows to delete.\n`);
  console.log("Sample (top 10):");
  for (const h of wrongSiblings.slice(0, 10)) {
    console.log(`  ${h.bookTitle.padEnd(60)} → drop link to "${h.seriesNameToDelete}"`);
  }
  console.log();

  // Part B
  const groups = findDedupGroups();
  const totalDupeSeries = groups.reduce((n, g) => n + g.dupeIds.length, 0);
  console.log(`─── Part B: Series dedup groups ───`);
  console.log(`Found ${groups.length} merge groups (${totalDupeSeries} dupe series to absorb into canonicals).\n`);
  console.log("Sample (top 10):");
  for (const g of groups.slice(0, 10)) {
    console.log(`  "${g.canonicalName}" (${g.canonicalId.slice(0, 8)}) ← merge ${g.dupeIds.length} dupe(s)`);
    for (const d of g.dupeIds) {
      console.log(`     - "${d.name}" (${d.id.slice(0, 8)})`);
    }
  }
  console.log();

  if (!APPLY) {
    console.log("DRY-RUN complete. Re-run with --apply to mutate.");
    return;
  }

  // ── APPLY ──

  // Part A: delete wrong-sibling book_series rows (local + turso)
  console.log("Part A: deleting wrong-sibling rows...");
  const delA = localDb.prepare(`DELETE FROM book_series WHERE book_id = ? AND series_id = ?`);
  const txA = localDb.transaction((hits: WrongSiblingHit[]) => {
    for (const h of hits) delA.run(h.bookId, h.seriesIdToDelete);
  });
  txA(wrongSiblings);
  console.log(`  local: deleted ${wrongSiblings.length} rows`);

  let aPushed = 0, aErrors = 0;
  for (const h of wrongSiblings) {
    try {
      await turso.execute({ sql: `DELETE FROM book_series WHERE book_id = ? AND series_id = ?`, args: [h.bookId, h.seriesIdToDelete] });
      aPushed++;
      if (aPushed % 50 === 0) console.log(`  turso: ${aPushed}/${wrongSiblings.length}`);
    } catch (e: any) {
      aErrors++;
      console.warn(`  ERROR: book=${h.bookId} series=${h.seriesIdToDelete}: ${e?.message}`);
    }
  }
  console.log(`  turso: ${aPushed} deleted, ${aErrors} errors\n`);

  // Part B: merge dupes into canonicals.
  // FK references to series.id elsewhere: series.parent_series_id, reported_issues.series_id.
  // Repoint those from dupe → canonical before deleting the dupe row.
  console.log("Part B: merging dupe series into canonicals...");
  const moveBookSeries = localDb.prepare(
    `INSERT OR IGNORE INTO book_series (book_id, series_id, position_in_series)
     SELECT book_id, ?, position_in_series FROM book_series WHERE series_id = ?`,
  );
  const delDupeBookSeries = localDb.prepare(`DELETE FROM book_series WHERE series_id = ?`);
  const repointParent = localDb.prepare(`UPDATE series SET parent_series_id = ? WHERE parent_series_id = ?`);
  const repointReports = localDb.prepare(`UPDATE reported_issues SET series_id = ? WHERE series_id = ?`);
  const delDupeSeries = localDb.prepare(`DELETE FROM series WHERE id = ?`);

  let bLocalMerged = 0;
  const txB = localDb.transaction((gs: DedupGroup[]) => {
    for (const g of gs) {
      for (const d of g.dupeIds) {
        moveBookSeries.run(g.canonicalId, d.id);
        delDupeBookSeries.run(d.id);
        repointParent.run(g.canonicalId, d.id);
        repointReports.run(g.canonicalId, d.id);
        delDupeSeries.run(d.id);
        bLocalMerged++;
      }
    }
  });
  txB(groups);
  console.log(`  local: merged ${bLocalMerged} dupe series into canonicals`);

  let bPushed = 0, bErrors = 0;
  for (const g of groups) {
    for (const d of g.dupeIds) {
      try {
        await turso.execute({
          sql: `INSERT OR IGNORE INTO book_series (book_id, series_id, position_in_series)
                SELECT book_id, ?, position_in_series FROM book_series WHERE series_id = ?`,
          args: [g.canonicalId, d.id],
        });
        await turso.execute({ sql: `DELETE FROM book_series WHERE series_id = ?`, args: [d.id] });
        await turso.execute({ sql: `UPDATE series SET parent_series_id = ? WHERE parent_series_id = ?`, args: [g.canonicalId, d.id] });
        await turso.execute({ sql: `UPDATE reported_issues SET series_id = ? WHERE series_id = ?`, args: [g.canonicalId, d.id] });
        await turso.execute({ sql: `DELETE FROM series WHERE id = ?`, args: [d.id] });
        bPushed++;
        if (bPushed % 25 === 0) console.log(`  turso: ${bPushed}/${bLocalMerged}`);
      } catch (e: any) {
        bErrors++;
        console.warn(`  ERROR merging ${d.id} → ${g.canonicalId}: ${e?.message}`);
      }
    }
  }
  console.log(`  turso: ${bPushed} merged, ${bErrors} errors`);

  localDb.close();
  turso.close();
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
