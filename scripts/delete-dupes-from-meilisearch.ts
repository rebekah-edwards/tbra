/**
 * delete-dupes-from-meilisearch.ts
 *
 * Reads a dedup manifest (reports/dedup-manifest-*.json) and removes the
 * superseded dupe book IDs from the Meilisearch `books` index.
 *
 * sync-meilisearch.ts only addDocuments — it never deletes — so stale dupe IDs
 * remain in the search index after a dedup pass and cause dead search hits.
 *
 * Dry-run by default. Pass --apply to mutate.
 */
import { Meilisearch } from "meilisearch";
import { config } from "dotenv";
import fs from "fs";
import path from "path";

config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");
const MANIFEST_ARG = process.argv.find((a) => a.startsWith("--manifest="))?.split("=")[1];

function resolveManifest(): string {
  if (MANIFEST_ARG) return MANIFEST_ARG;
  const dir = path.join(process.cwd(), "reports");
  const files = fs.readdirSync(dir).filter((f) => /^dedup-manifest-.*\.json$/.test(f));
  if (files.length === 0) throw new Error("No manifest files found in reports/");
  files.sort();
  return path.join(dir, files[files.length - 1]);
}

const manifestPath = resolveManifest();
const pairs: { dupe_id: string; canonical_id: string }[] =
  JSON.parse(fs.readFileSync(manifestPath, "utf8"));

const host = process.env.MEILISEARCH_HOST;
const adminKey = process.env.MEILISEARCH_ADMIN_KEY;
if (!host || !adminKey) {
  console.error("Missing MEILISEARCH_HOST or MEILISEARCH_ADMIN_KEY in .env.local");
  process.exit(1);
}

const client = new Meilisearch({ host, apiKey: adminKey });

async function main() {
  const dupeIds = pairs.map((p) => p.dupe_id);
  console.log(`=== delete-dupes-from-meilisearch.ts ===`);
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN"}`);
  console.log(`Manifest: ${manifestPath}`);
  console.log(`Dupe IDs to delete: ${dupeIds.length}`);

  const index = client.index("books");

  // Sample 10 IDs to confirm they exist in the index
  const sample = dupeIds.slice(0, 10);
  for (const id of sample) {
    try {
      const doc = await index.getDocument(id);
      console.log(`  ✓ present: ${id}  "${(doc as any)?.title?.slice(0, 40) ?? "(no title)"}"`);
    } catch {
      console.log(`  · absent:  ${id}`);
    }
  }

  if (!APPLY) {
    console.log(`\nDRY-RUN — would delete ${dupeIds.length} documents from books index.`);
    return;
  }

  console.log(`\nDeleting ${dupeIds.length} documents...`);
  const task = await index.deleteDocuments(dupeIds);
  console.log(`  Task queued: ${task.taskUid}`);

  // Wait for task to complete
  const result = await client.tasks.waitForTask(task.taskUid, { timeOutMs: 120_000 });
  console.log(`  Task ${result.status}: ${(result.details as any)?.deletedDocuments ?? "?"} deleted`);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
