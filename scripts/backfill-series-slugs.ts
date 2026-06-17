/**
 * backfill-series-slugs.ts
 *
 * Generate slugs for any `series` rows where slug IS NULL or empty.
 * Pattern: `${slugify(name)}-${slugify(primary_author)}` — same shape
 * the enrichment pipeline uses on fresh series creation. Collisions
 * resolved by numeric suffix (-2, -3, ...).
 *
 * Runs against LOCAL tbra.db and production Turso in a single pass
 * so both sides end up in sync without a follow-up sync-push (slug
 * is not in step 5b's pushed field list).
 *
 * Dry-run by default. Pass --apply to mutate.
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

function slugify(s: string): string {
  return s
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .replace(/\s+/g, " ").trim().toLowerCase()
    .replace(/\s/g, "-");
}

function generateSeriesSlug(name: string, author: string | null): string {
  const n = slugify(name);
  if (!author) return n;
  const a = slugify(author);
  if (!a) return n;
  return `${n}-${a}`;
}

type Row = { id: string; name: string; primary_author: string | null };

async function main() {
  console.log(`=== backfill-series-slugs.ts ===`);
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN"}\n`);

  // Pull all null-slug series with their most-common author
  const rows = localDb
    .prepare(
      `SELECT s.id, s.name,
              (SELECT a.name FROM authors a
               JOIN book_authors ba ON ba.author_id = a.id
               JOIN book_series bs ON bs.book_id = ba.book_id
               WHERE bs.series_id = s.id
               GROUP BY a.id
               ORDER BY COUNT(*) DESC
               LIMIT 1) AS primary_author
       FROM series s
       WHERE s.slug IS NULL OR s.slug = ''`,
    )
    .all() as Row[];

  console.log(`Found ${rows.length} series with null slug.\n`);
  if (rows.length === 0) return;

  // Load existing slugs so we can collision-check
  const existing = localDb
    .prepare(`SELECT id, slug FROM series WHERE slug IS NOT NULL AND slug != ''`)
    .all() as { id: string; slug: string }[];
  const slugToId = new Map<string, string>();
  for (const r of existing) slugToId.set(r.slug, r.id);

  const updates: { id: string; slug: string; name: string; author: string | null }[] = [];
  let noAuthorCount = 0;
  let collisionCount = 0;

  for (const r of rows) {
    if (!r.primary_author) noAuthorCount++;

    const base = generateSeriesSlug(r.name, r.primary_author);
    if (!base) continue;

    let slug = base;
    let suffix = 2;
    while (slugToId.has(slug) && slugToId.get(slug) !== r.id) {
      slug = `${base}-${suffix}`;
      suffix++;
      collisionCount++;
    }

    slugToId.set(slug, r.id);
    updates.push({ id: r.id, slug, name: r.name, author: r.primary_author });
  }

  console.log(`Will update: ${updates.length}`);
  console.log(`   (of those, ${noAuthorCount} have no author — slug is just the series name)`);
  console.log(`   (of those, ${collisionCount} needed a numeric suffix to avoid collision)\n`);

  console.log("Sample of planned updates:");
  for (const u of updates.slice(0, 10)) {
    console.log(`  ${u.id.slice(0, 8)} "${u.name}" by ${u.author ?? "(no author)"} → ${u.slug}`);
  }
  console.log();

  if (!APPLY) {
    console.log("DRY-RUN complete. Re-run with --apply to mutate.");
    return;
  }

  const localStmt = localDb.prepare(`UPDATE series SET slug = ? WHERE id = ?`);
  const localTxn = localDb.transaction((items: typeof updates) => {
    for (const u of items) localStmt.run(u.slug, u.id);
  });

  console.log("Writing to local SQLite...");
  localTxn(updates);
  console.log("  local: done.");

  console.log("Writing to Turso...");
  let pushed = 0;
  let errors = 0;
  for (const u of updates) {
    try {
      await turso.execute({
        sql: `UPDATE series SET slug = ? WHERE id = ?`,
        args: [u.slug, u.id],
      });
      pushed++;
      if (pushed % 50 === 0) console.log(`  turso: ${pushed}/${updates.length}`);
    } catch (e: any) {
      errors++;
      console.warn(`  ERROR on ${u.id}: ${e?.message}`);
    }
  }
  console.log(`  turso: ${pushed} updated, ${errors} errors.`);

  localDb.close();
  turso.close();
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
