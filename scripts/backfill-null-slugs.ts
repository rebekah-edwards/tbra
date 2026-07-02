/**
 * Backfill NULL slugs for public books, on BOTH Turso and local.
 *
 * Books created through some prod paths ended up with slug=NULL, which
 * means no book-page URL can be generated for them (all public links are
 * slug-based). sync-push NEVER writes slug, so this must dual-write:
 * Turso directly + local data/tbra.db.
 *
 * Slug logic mirrors src/lib/utils/slugify.ts (generateBookSlug +
 * numeric-suffix collision handling), uniquified against the combined
 * slug set of BOTH databases so the two sides never diverge.
 *
 * Usage: npx tsx scripts/backfill-null-slugs.ts [--dry-run]
 */
import Database from "better-sqlite3";
import path from "path";
import { createGuardedTurso } from "./lib/turso-guard";
import { generateBookSlug } from "../src/lib/utils/slugify";

// eslint-disable-next-line @typescript-eslint/no-require-imports
require("dotenv").config({ path: ".env.vercel.local" });

const DRY_RUN = process.argv.includes("--dry-run");

(async () => {
  const { remote } = await createGuardedTurso({
    name: "backfill-null-slugs",
    maxRuntimeMs: 45 * 60 * 1000,
    queryTimeoutMs: 300_000, // the NULL-slug scan is a full books scan (~2-3 min on Turso)
  });

  const local = new Database(path.join(process.cwd(), "data", "tbra.db"));
  local.pragma("journal_mode = WAL");

  console.log("[1/4] Fetching NULL-slug public books from Turso (full scan, be patient)...");
  const nullBooks = await remote.execute(`
    SELECT b.id, b.title,
      (SELECT a.name FROM book_authors ba JOIN authors a ON a.id = ba.author_id
        WHERE ba.book_id = b.id AND ba.role = 'author' LIMIT 1) AS author_name
    FROM books b
    WHERE b.slug IS NULL AND b.visibility = 'public'
  `);
  console.log(`  ${nullBooks.rows.length} books need slugs on Turso`);

  console.log("[2/4] Building combined existing-slug set (Turso + local)...");
  const turSlugs = await remote.execute(`SELECT slug FROM books WHERE slug IS NOT NULL`);
  const taken = new Set<string>(turSlugs.rows.map((r) => String(r.slug)));
  for (const r of local.prepare(`SELECT slug FROM books WHERE slug IS NOT NULL`).all() as { slug: string }[]) {
    taken.add(r.slug);
  }
  console.log(`  ${taken.size} existing slugs`);

  console.log("[3/4] Generating unique slugs...");
  const assignments: { id: string; slug: string }[] = [];
  let skippedEmpty = 0;
  for (const row of nullBooks.rows) {
    const title = String(row.title ?? "").trim();
    const author = String(row.author_name ?? "").trim();
    const base = generateBookSlug(title, author);
    if (!base) { skippedEmpty++; continue; }
    let slug = base;
    let suffix = 2;
    while (taken.has(slug)) slug = `${base}-${suffix++}`;
    taken.add(slug);
    assignments.push({ id: String(row.id), slug });
  }
  console.log(`  ${assignments.length} slugs generated, ${skippedEmpty} skipped (unslugifiable title)`);
  for (const a of assignments.slice(0, 5)) console.log(`  sample: ${a.id} -> ${a.slug}`);

  if (DRY_RUN) { console.log("DRY RUN — no writes."); process.exit(0); }

  console.log("[4/4] Writing (Turso batched, then local)...");
  const CHUNK = 100;
  let tursoUpdated = 0;
  for (let i = 0; i < assignments.length; i += CHUNK) {
    const chunk = assignments.slice(i, i + CHUNK);
    const results = await remote.batch(
      chunk.map((a) => ({
        sql: `UPDATE books SET slug = ? WHERE id = ? AND slug IS NULL`,
        args: [a.slug, a.id],
      })),
      "write",
    );
    tursoUpdated += results.reduce((n, r) => n + (r.rowsAffected ?? 0), 0);
    if ((i / CHUNK) % 5 === 0) console.log(`  Turso ${Math.min(i + CHUNK, assignments.length)}/${assignments.length}`);
  }
  console.log(`  Turso rows updated: ${tursoUpdated}`);

  const localStmt = local.prepare(`UPDATE books SET slug = ? WHERE id = ? AND slug IS NULL`);
  let localUpdated = 0;
  const tx = local.transaction((rows: { id: string; slug: string }[]) => {
    for (const a of rows) localUpdated += localStmt.run(a.slug, a.id).changes;
  });
  tx(assignments);
  console.log(`  Local rows updated: ${localUpdated}`);

  const remaining = await remote.execute(`SELECT COUNT(*) AS n FROM books WHERE slug IS NULL AND visibility='public'`);
  console.log(`Done. Remaining NULL-slug public books on Turso: ${remaining.rows[0].n}`);
  local.close();
  process.exit(0);
})();
