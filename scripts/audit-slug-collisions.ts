/**
 * audit-slug-collisions.ts — find books where the same slug exists on both
 * local and Turso but with different primary keys.
 *
 * These are the "Midnight Is the Darkest Hour" pattern: a book was created
 * independently on each side, sync-push matches by ID so neither side knows
 * the other's row exists. Most-enriched copy tends to be on local; the Turso
 * side is a shell added via the manual-add flow in production.
 *
 * READ-ONLY. Writes reports/slug-collision-audit-<ts>.json with the full list.
 */
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { createClient } from "@libsql/client";
import { config } from "dotenv";

config({ path: ".env.vercel.local" });

const localDb = new Database(path.join(process.cwd(), "data", "tbra.db"), { readonly: true });
const turso = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

interface LocalRow {
  slug: string;
  id: string;
  title: string;
  coverImageUrl: string | null;
  coverSource: string | null;
  hasDescription: number;
  hasSummary: number;
  ratingCount: number;
}

async function main() {
  console.log("=== audit-slug-collisions.ts ===\n");

  const localRows = localDb
    .prepare(
      `SELECT b.slug, b.id, b.title,
              b.cover_image_url AS coverImageUrl, b.cover_source AS coverSource,
              (b.description IS NOT NULL AND length(b.description) > 0) AS hasDescription,
              (b.summary IS NOT NULL AND length(b.summary) > 0) AS hasSummary,
              (SELECT COUNT(*) FROM book_category_ratings r WHERE r.book_id = b.id) AS ratingCount
       FROM books b
       WHERE b.slug IS NOT NULL AND b.slug != ''`,
    )
    .all() as LocalRow[];

  console.log(`Local books with slugs: ${localRows.length.toLocaleString()}`);

  console.log("Fetching Turso slug index...");
  const tursoSlugMap = new Map<string, { id: string; title: string }>();
  const PAGE = 5000;
  let offset = 0;
  while (true) {
    const res = await turso.execute({
      sql: `SELECT id, title, slug FROM books WHERE slug IS NOT NULL AND slug != '' LIMIT ? OFFSET ?`,
      args: [PAGE, offset],
    });
    if (res.rows.length === 0) break;
    for (const row of res.rows) {
      tursoSlugMap.set(String(row.slug), { id: String(row.id), title: String(row.title) });
    }
    if (res.rows.length < PAGE) break;
    offset += PAGE;
    console.log(`  fetched ${offset.toLocaleString()}...`);
  }
  console.log(`Turso books with slugs: ${tursoSlugMap.size.toLocaleString()}\n`);

  let matching = 0;
  let onlyLocal = 0;
  const collisions: { slug: string; local: LocalRow; turso: { id: string; title: string } }[] = [];

  for (const local of localRows) {
    const turso = tursoSlugMap.get(local.slug);
    if (!turso) {
      onlyLocal++;
      continue;
    }
    if (turso.id === local.id) matching++;
    else collisions.push({ slug: local.slug, local, turso });
  }

  console.log(`=== RESULTS ===`);
  console.log(`Matching IDs (happy case):             ${matching.toLocaleString()}`);
  console.log(`Local-only slugs (not pushed yet):     ${onlyLocal.toLocaleString()}`);
  console.log(`Slug collisions (same slug, diff IDs): ${collisions.length.toLocaleString()}`);
  console.log();

  console.log("Deep-dive on top collisions (Turso enrichment state)...");
  const enriched: any[] = [];
  for (const c of collisions.slice(0, 50)) {
    const r = await turso.execute({
      sql: `SELECT cover_image_url, cover_source,
                   (description IS NOT NULL AND length(description) > 0) AS hasDesc,
                   (summary IS NOT NULL AND length(summary) > 0) AS hasSum,
                   (SELECT COUNT(*) FROM book_category_ratings WHERE book_id = ?) AS ratings,
                   (SELECT COUNT(*) FROM user_book_state WHERE book_id = ?) AS userStates
            FROM books WHERE id = ?`,
      args: [c.turso.id, c.turso.id, c.turso.id],
    });
    if (r.rows.length > 0) enriched.push({ slug: c.slug, local: c.local, turso: r.rows[0] });
  }

  console.log();
  console.log("Sample (local vs turso enrichment + user impact):");
  for (const e of enriched.slice(0, 15)) {
    const lStr = `cover=${e.local.coverImageUrl ? "✓" : "×"} desc=${e.local.hasDescription ? "✓" : "×"} ratings=${e.local.ratingCount}`;
    const tRatings = Number(e.turso.ratings ?? 0);
    const tUsers = Number(e.turso.userStates ?? 0);
    const tStr = `cover=${e.turso.cover_image_url ? "✓" : "×"} desc=${e.turso.hasDesc ? "✓" : "×"} ratings=${tRatings} users=${tUsers}`;
    console.log(`  "${e.local.title.slice(0, 55)}"`);
    console.log(`     local : ${lStr}`);
    console.log(`     turso : ${tStr}`);
  }

  const reportDir = path.join(process.cwd(), "reports");
  fs.mkdirSync(reportDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = path.join(reportDir, `slug-collision-audit-${stamp}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify({
    matching, onlyLocal, collisions: collisions.length, pairs: collisions,
  }, null, 2));
  console.log(`\nFull manifest: ${jsonPath}`);

  localDb.close();
  turso.close();
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
