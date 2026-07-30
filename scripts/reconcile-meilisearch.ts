/**
 * Reconcile the Meilisearch `books` index against the catalog — delete stale docs.
 *
 * WHY: sync-meilisearch.ts only ever calls addDocuments() — it never deletes.
 * So any book that LEAVES the public set (demoted to import_only/hidden, merged
 * away by a dedup pass, or flagged as a box set) stays in the search index
 * forever and keeps showing up as a live search hit. The search layer does NOT
 * post-filter on visibility either (src/lib/search/meilisearch.ts builds no
 * filter), so a stale doc is a real user-facing dead result, not just index bloat.
 *
 * WHAT: enumerates every doc id in the index, compares against the same query
 * sync-meilisearch.ts uses to build the index (visibility='public' AND
 * is_box_set=0, read from local sqlite), and deletes the difference.
 *
 * No paid APIs — Meilisearch Cloud only.
 *
 * Dry-run by default. Pass --apply to delete.
 *
 * Usage:
 *   npx tsx scripts/reconcile-meilisearch.ts
 *   npx tsx scripts/reconcile-meilisearch.ts --apply
 */
import { Meilisearch } from "meilisearch";
import { config } from "dotenv";
import Database from "better-sqlite3";
import path from "path";

config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");

const host = process.env.MEILISEARCH_HOST;
const adminKey = process.env.MEILISEARCH_ADMIN_KEY;
if (!host || !adminKey) {
  console.error("Missing MEILISEARCH_HOST or MEILISEARCH_ADMIN_KEY in .env.local");
  process.exit(1);
}

(async () => {
  const db = new Database(path.join(process.cwd(), "data", "tbra.db"), { readonly: true });
  const liveIds = new Set<string>(
    (db.prepare(`SELECT id FROM books WHERE visibility = 'public' AND is_box_set = 0`).all() as { id: string }[])
      .map((r) => String(r.id)),
  );
  console.log(`Catalog (local, public + not box set): ${liveIds.size}`);

  const client = new Meilisearch({ host, apiKey: adminKey });
  const index = client.index("books");

  // Enumerate every id currently in the index.
  const indexed: { id: string; title: string }[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const res = await index.getDocuments({ limit: PAGE, offset, fields: ["id", "title"] });
    const rows = res.results as any[];
    if (rows.length === 0) break;
    for (const r of rows) indexed.push({ id: String(r.id), title: String(r.title ?? "") });
    if (offset % 10000 === 0) console.log(`  enumerated ${indexed.length}…`);
    if (rows.length < PAGE) break;
  }
  console.log(`Indexed docs: ${indexed.length}`);

  const stale = indexed.filter((d) => !liveIds.has(d.id));
  console.log(`\n=== reconcile-meilisearch (${APPLY ? "APPLY" : "DRY RUN"}) ===`);
  console.log(`STALE docs in index but not in the public catalog: ${stale.length}`);
  console.log(`\n--- sample stale ---`);
  for (const d of stale.slice(0, 25)) console.log(`   ${JSON.stringify(d.title).slice(0, 62)}  ${d.id}`);

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing deleted. Re-run with --apply to remove ${stale.length} docs.`);
    process.exit(0);
  }
  if (stale.length === 0) { console.log("\nIndex already clean."); process.exit(0); }

  const ids = stale.map((d) => d.id);
  const CHUNK = 1000;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const batch = ids.slice(i, i + CHUNK);
    const task = await index.deleteDocuments(batch);
    await client.tasks.waitForTask(task.taskUid, { timeout: 120_000 });
    console.log(`   deleted ${Math.min(i + CHUNK, ids.length)}/${ids.length}`);
  }

  const after = await index.getStats();
  console.log(`\nIndex now holds ${after.numberOfDocuments} docs (catalog says ${liveIds.size}).`);
  process.exit(0);
})();
