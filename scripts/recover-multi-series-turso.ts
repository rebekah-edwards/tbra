/**
 * recover-multi-series-turso.ts — Resume fix-multi-series Part B on Turso.
 *
 * Local already completed the 832-group merge. Turso stalled at ~125/832 due
 * to FK constraint failures — some book_series rows on Turso pointed at books
 * that no longer exist there (earlier dedup side-effect), and in some cases
 * the canonical series itself didn't exist on Turso (local-only).
 *
 * This script re-derives the merge groups by name-normalization on Turso's
 * current series table, pre-fetches the live book/series ID sets, and only
 * touches rows that won't FK-fail. Same INSERT OR IGNORE + DELETE + DELETE
 * sequence, but defensive.
 *
 * Dry-run by default. Pass --apply to mutate.
 */
import { createClient } from "@libsql/client";
import { config } from "dotenv";

config({ path: ".env.vercel.local" });
const APPLY = process.argv.includes("--apply");

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

interface SeriesRow { id: string; name: string; slug: string | null; book_count: number }

async function main() {
  console.log(`=== recover-multi-series-turso.ts ===`);
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN"}\n`);

  // 1. Pull Turso series + book counts
  console.log("Fetching Turso series...");
  const allSeries: SeriesRow[] = [];
  const PAGE = 5000;
  let offset = 0;
  while (true) {
    const res = await turso.execute({
      sql: `SELECT s.id, s.name, s.slug,
                   (SELECT COUNT(*) FROM book_series WHERE series_id = s.id) AS book_count
            FROM series s LIMIT ? OFFSET ?`,
      args: [PAGE, offset],
    });
    if (res.rows.length === 0) break;
    for (const r of res.rows) {
      allSeries.push({ id: String(r.id), name: String(r.name), slug: r.slug ? String(r.slug) : null, book_count: Number(r.book_count) });
    }
    if (res.rows.length < PAGE) break;
    offset += PAGE;
  }
  console.log(`  ${allSeries.length.toLocaleString()} series on Turso`);

  // 2. Group by normalized name
  const byNorm = new Map<string, SeriesRow[]>();
  for (const s of allSeries) {
    const key = normalize(s.name);
    if (!key) continue;
    const arr = byNorm.get(key) ?? [];
    arr.push(s);
    byNorm.set(key, arr);
  }

  // 3. Build merge groups (pick canonical: has slug → more books → lowest id)
  const groups: { canonical: SeriesRow; dupes: SeriesRow[] }[] = [];
  for (const arr of byNorm.values()) {
    if (arr.length < 2) continue;
    arr.sort((a, b) => {
      const slugRank = Number(!!b.slug) - Number(!!a.slug);
      if (slugRank !== 0) return slugRank;
      const countRank = b.book_count - a.book_count;
      if (countRank !== 0) return countRank;
      return a.id.localeCompare(b.id);
    });
    const [canonical, ...dupes] = arr;
    groups.push({ canonical, dupes });
  }
  const totalDupes = groups.reduce((n, g) => n + g.dupes.length, 0);
  console.log(`  ${groups.length.toLocaleString()} merge groups remaining (${totalDupes.toLocaleString()} dupe series to absorb)\n`);

  if (groups.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  // 4. Pull Turso's book ID set so we can pre-filter FK-unsafe rows
  console.log("Fetching Turso book ID set...");
  const liveBookIds = new Set<string>();
  offset = 0;
  while (true) {
    const res = await turso.execute({ sql: `SELECT id FROM books LIMIT ? OFFSET ?`, args: [PAGE, offset] });
    if (res.rows.length === 0) break;
    for (const r of res.rows) liveBookIds.add(String(r.id));
    if (res.rows.length < PAGE) break;
    offset += PAGE;
  }
  console.log(`  ${liveBookIds.size.toLocaleString()} books on Turso\n`);

  console.log("Sample groups:");
  for (const g of groups.slice(0, 5)) {
    console.log(`  "${g.canonical.name}" (${g.canonical.id.slice(0, 8)}) ← ${g.dupes.length} dupe(s)`);
  }
  console.log();

  if (!APPLY) {
    console.log("DRY-RUN complete. Re-run with --apply.");
    return;
  }

  // 5. Apply: for each dupe, migrate book_series rows (filtered by existing
  //    books) then delete dupe's remaining book_series + the dupe series row.
  let processed = 0, skipped = 0, errors = 0;
  const start = Date.now();
  for (const { canonical, dupes } of groups) {
    for (const dupe of dupes) {
      try {
        // Fetch this dupe's book_series rows
        const r = await turso.execute({
          sql: `SELECT book_id, position_in_series FROM book_series WHERE series_id = ?`,
          args: [dupe.id],
        });
        for (const row of r.rows) {
          const bookId = String(row.book_id);
          const pos = row.position_in_series;
          if (!liveBookIds.has(bookId)) continue; // orphan book_series row — skip
          await turso.execute({
            sql: `INSERT OR IGNORE INTO book_series (book_id, series_id, position_in_series) VALUES (?, ?, ?)`,
            args: [bookId, canonical.id, pos],
          });
        }
        await turso.execute({ sql: `DELETE FROM book_series WHERE series_id = ?`, args: [dupe.id] });
        await turso.execute({ sql: `DELETE FROM series WHERE id = ?`, args: [dupe.id] });
        processed++;
        if (processed % 25 === 0) {
          const elapsed = ((Date.now() - start) / 1000).toFixed(0);
          console.log(`  progress: ${processed}/${totalDupes} (errors=${errors}, skipped=${skipped}, ${elapsed}s elapsed)`);
        }
      } catch (e: any) {
        errors++;
        console.warn(`  ERROR ${dupe.id.slice(0, 8)} → ${canonical.id.slice(0, 8)}: ${e?.message?.slice(0, 120)}`);
      }
    }
  }
  const elapsed = ((Date.now() - start) / 1000).toFixed(0);
  console.log(`\nDone: ${processed} dupes absorbed, ${errors} errors, ${elapsed}s elapsed.`);

  turso.close();
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
