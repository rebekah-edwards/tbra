import { Meilisearch } from "meilisearch";
import { config } from "dotenv";
config({ path: ".env.local" });

const host = process.env.MEILISEARCH_HOST!;
const adminKey = process.env.MEILISEARCH_ADMIN_KEY!;
if (!host || !adminKey) { console.error("Missing Meilisearch creds"); process.exit(1); }

const client = new Meilisearch({ host, apiKey: adminKey });

async function main() {
  const stats = await client.getStats();
  console.log("=== Meilisearch Cloud usage ===");
  console.log(`Database size: ${(stats.databaseSize / 1024 / 1024).toFixed(1)} MB`);
  console.log(`Used database size: ${(stats.usedDatabaseSize / 1024 / 1024).toFixed(1)} MB`);
  console.log(`Last update: ${stats.lastUpdate}`);
  console.log(`Indexing: ${stats.indexing}`);
  console.log(`\nIndexes:`);
  for (const [name, s] of Object.entries(stats.indexes)) {
    console.log(`  ${name.padEnd(10)}  ${s.numberOfDocuments.toLocaleString().padStart(8)} docs  (indexing=${s.isIndexing})`);
  }
  const totalDocs = Object.values(stats.indexes).reduce((sum, s) => sum + s.numberOfDocuments, 0);
  console.log(`\nTotal documents across all indexes: ${totalDocs.toLocaleString()}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
