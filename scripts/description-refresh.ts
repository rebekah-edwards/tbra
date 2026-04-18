/**
 * nightly-description-refresh
 *
 * Re-enriches books flagged description_stale=1 so their descriptions get
 * rewritten from the primary sources (OL → ISBNdb → Google Books, filtered
 * through cleanISBNdbSynopsis()).
 *
 * The stale flag is set when a cleanup pass detects junk-like content but
 * can't cleanly clear the description (e.g. legit prose mixed with edition
 * meta). The enrichment pipeline honors the stale flag — see
 * src/lib/enrichment/enrich-book.ts — and clears stale=0 after writing a
 * fresh description.
 *
 * Runs 200/night. At 114 current backlog, clears in one pass with headroom
 * for future flagging.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import Database from "better-sqlite3";
import path from "path";
import { enrichBook } from "../src/lib/enrichment/enrich-book";

const DB_PATH = path.join(process.cwd(), "data", "tbra.db");
const db = new Database(DB_PATH);

const BATCH_SIZE = 200;
const DELAY_MS = 300;

type Row = { id: string; title: string };

function selectBatch(): Row[] {
  return db
    .prepare(
      `SELECT id, title
       FROM books
       WHERE description_stale = 1
         AND visibility = 'public'
       ORDER BY updated_at ASC
       LIMIT ?`,
    )
    .all(BATCH_SIZE) as Row[];
}

async function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log(`[description-refresh] Starting — batch ${BATCH_SIZE}`);
  const rows = selectBatch();
  console.log(`[description-refresh] ${rows.length} books flagged stale`);

  if (rows.length === 0) {
    console.log("[description-refresh] Nothing to do. Exiting.");
    db.close();
    return;
  }

  let success = 0;
  let failed = 0;
  const started = Date.now();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (i % 25 === 0) {
      console.log(`  [${i}/${rows.length}] success=${success} failed=${failed}`);
    }
    try {
      await enrichBook(r.id, { skipBrave: true });
      success++;
    } catch (e: any) {
      console.error(`  FAIL ${r.id} "${r.title}": ${e?.message || e}`);
      failed++;
    }
    await delay(DELAY_MS);
  }

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `[description-refresh] Done in ${elapsed}s — success=${success} failed=${failed}`,
  );
  console.log(`[description-refresh] Follow-up: sync-incremental.sh push`);
  db.close();
}

main().catch((e) => {
  console.error("[description-refresh] FATAL", e);
  db.close();
  process.exit(1);
});
