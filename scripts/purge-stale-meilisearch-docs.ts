/**
 * purge-stale-meilisearch-docs.ts
 *
 * sync-meilisearch.ts only ever addDocuments — it never deletes. So every book
 * removed by a dedup/merge/hide pass leaves an orphan document behind in the
 * `books` index, producing dead search hits that 404 when tapped.
 *
 * This script diffs the live index against the books that SHOULD be indexed and
 * purges the difference:
 *
 *   1. Page every document id out of the Meilisearch `books` index.
 *   2. Build the eligible set from local SQLite (visibility='public' AND
 *      is_box_set=0 — exactly sync-meilisearch.ts's filter).
 *   3. Candidates = indexed - eligible-locally.
 *   4. SAFETY: re-check every candidate against production Turso. Anything that
 *      is still public + non-box-set on Turso is KEPT and reported as a
 *      local/prod divergence — local being stale must never silently delete a
 *      search doc for a book that is live on the site.
 *   5. Write reports/meili-stale-manifest-<ts>.json, then (with --apply) delete.
 *
 * Dry-run by default. Pass --apply to mutate the index.
 *
 * Deleting here is recoverable: anything removed in error comes back on the
 * next sync-meilisearch.ts run, which re-adds every eligible book.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env.vercel.local" });

import { Meilisearch } from "meilisearch";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { createGuardedTurso } from "./lib/turso-guard";

const APPLY = process.argv.includes("--apply");

const host = process.env.MEILISEARCH_HOST;
const adminKey = process.env.MEILISEARCH_ADMIN_KEY;
if (!host || !adminKey) {
  console.error("Missing MEILISEARCH_HOST or MEILISEARCH_ADMIN_KEY in .env.local");
  process.exit(1);
}

const client = new Meilisearch({ host, apiKey: adminKey });
const index = client.index("books");

/** Meilisearch Cloud drops upload/read sockets intermittently — see sync-meilisearch.ts. */
async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  const MAX_ATTEMPTS = 4;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS) throw err;
      const waitMs = 2000 * attempt;
      console.log(`  ! ${label} failed (attempt ${attempt}/${MAX_ATTEMPTS}), retrying in ${waitMs}ms`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main() {
  console.log("=== purge-stale-meilisearch-docs.ts ===");
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN"}`);

  // 1. Every id currently in the index
  const indexedIds: string[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const res = await withRetry(
      () => index.getDocuments({ fields: ["id"], limit: PAGE, offset }),
      `getDocuments offset=${offset}`,
    );
    const results = res.results as { id: string }[];
    indexedIds.push(...results.map((r) => r.id));
    if (results.length < PAGE) break;
  }
  console.log(`Indexed documents:        ${indexedIds.length}`);

  // 2. What SHOULD be indexed, per local SQLite
  const db = new Database(path.join(process.cwd(), "data", "tbra.db"));
  db.pragma("journal_mode = WAL");
  const eligible = db
    .prepare(`SELECT id FROM books WHERE visibility = 'public' AND is_box_set = 0`)
    .all() as { id: string }[];
  const eligibleSet = new Set(eligible.map((r) => r.id));
  console.log(`Eligible books (local):   ${eligibleSet.size}`);

  // 3. Orphan candidates
  const candidates = indexedIds.filter((id) => !eligibleSet.has(id));
  console.log(`Orphan candidates:        ${candidates.length}`);
  if (candidates.length === 0) {
    console.log("\nIndex is already clean — nothing to purge.");
    process.exit(0);
  }

  // 4. Safety re-check against production Turso
  const { remote } = await createGuardedTurso({
    name: "purge-stale-meilisearch-docs",
    maxRuntimeMs: 30 * 60 * 1000,
    queryTimeoutMs: 30_000,
    longRunning: false,
  });

  const liveOnProd = new Set<string>();
  // 50 ids/query: a 200-id IN list reliably blew the guard's 30s query timeout.
  const batches = chunk(candidates, 50);
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const placeholders = batch.map(() => "?").join(",");
    // Filter in JS, NOT in SQL. Adding `AND visibility=... AND is_box_set=...`
    // makes Turso's planner drop the primary-key index and full-scan `books`:
    // an IN(10) lookup goes from ~65ms to ~82s and blows the guard's timeout.
    const rs = await remote.execute({
      sql: `SELECT id, visibility, is_box_set FROM books WHERE id IN (${placeholders})`,
      args: batch,
    });
    for (const row of rs.rows) {
      const r = row as any;
      if (String(r.visibility) === "public" && Number(r.is_box_set) === 0) {
        liveOnProd.add(String(r.id));
      }
    }
    if ((i + 1) % 10 === 0 || i === batches.length - 1) {
      console.log(`  Turso re-check ${i + 1}/${batches.length} batches`);
    }
  }

  const toDelete = candidates.filter((id) => !liveOnProd.has(id));
  console.log(`\nStill live on Turso (KEEP):  ${liveOnProd.size}`);
  console.log(`Confirmed stale (DELETE):    ${toDelete.length}`);

  // 5. Manifest
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const manifestPath = path.join(process.cwd(), "reports", `meili-stale-manifest-${ts}.json`);
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        indexedDocuments: indexedIds.length,
        eligibleLocal: eligibleSet.size,
        orphanCandidates: candidates.length,
        keptStillLiveOnTurso: [...liveOnProd],
        staleIds: toDelete,
      },
      null,
      2,
    ),
  );
  console.log(`Manifest: ${manifestPath}`);

  if (!APPLY) {
    console.log(`\nDRY-RUN — would delete ${toDelete.length} documents. Re-run with --apply.`);
    process.exit(0);
  }

  if (toDelete.length === 0) {
    console.log("\nNothing confirmed stale — no deletion performed.");
    process.exit(0);
  }

  console.log(`\nDeleting ${toDelete.length} documents...`);
  for (const batch of chunk(toDelete, 1000)) {
    const task = await withRetry(() => index.deleteDocuments(batch), "deleteDocuments");
    const result = await client.tasks.waitForTask(task.taskUid, { timeOutMs: 300_000 });
    console.log(`  Task ${task.taskUid} ${result.status}: ${(result.details as any)?.deletedDocuments ?? "?"} deleted`);
  }

  const stats = await withRetry(() => index.getStats(), "getStats");
  console.log(`\nBooks index now: ${stats.numberOfDocuments} documents`);
  process.exit(0);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
