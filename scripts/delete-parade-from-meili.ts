import { Meilisearch } from "meilisearch";
import { config } from "dotenv";
config({ path: ".env.local" });

const DUPE_ID = "bd8400ed-2580-4762-be68-059bb5992606";

const host = process.env.MEILISEARCH_HOST;
const adminKey = process.env.MEILISEARCH_ADMIN_KEY;
if (!host || !adminKey) {
  console.error("Missing MEILISEARCH_HOST or MEILISEARCH_ADMIN_KEY in .env.local");
  process.exit(1);
}

const client = new Meilisearch({ host, apiKey: adminKey });

async function main() {
  const index = client.index("books");
  try {
    const doc = await index.getDocument(DUPE_ID);
    console.log(`Found in index: ${(doc as any)?.title}`);
  } catch {
    console.log("Not found in index — nothing to delete.");
    return;
  }
  const task = await index.deleteDocument(DUPE_ID);
  console.log(`Delete task enqueued:`, task);
  await client.waitForTask(task.taskUid, { timeOutMs: 10000 });
  console.log("Done.");
}
main().catch((e) => { console.error(e); process.exit(1); });
