/**
 * Second pass of the metadata backfill: push isbn_13 values from local to
 * Turso, safely.
 *
 * The original push-metadata-backfill-to-turso.ts excludes isbn_13 because
 * naive updates hit the `books.isbn_13` UNIQUE constraint when local and
 * Turso have duplicate books stored in different ISBN formats. This script
 * handles that by:
 *
 *   1. Loading ALL existing isbn_13 values from Turso into a set (normalized)
 *   2. For each Turso book where isbn_13 is NULL and local has a value:
 *      a. Normalize to digits-only
 *      b. Look for that ISBN in the existing Turso set
 *      c. If it exists on a DIFFERENT book → collision, skip and log
 *      d. Otherwise → write it
 *
 * No UNIQUE violations possible — we never write an ISBN that's already
 * attached to someone else. Collisions are reported at the end so the user
 * can inspect them if desired.
 *
 * Safe to rerun. Only writes; never deletes or overwrites.
 */

import { createClient } from "@libsql/client";
import Database from "better-sqlite3";
import path from "path";

const DRY_RUN = process.argv.includes("--dry-run");
const LIMIT_ARG = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = LIMIT_ARG ? parseInt(LIMIT_ARG.split("=")[1], 10) : Infinity;

function normalizeIsbn(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9Xx]/g, "").toUpperCase();
  if (cleaned.length === 10 || cleaned.length === 13) return cleaned;
  return null;
}

async function main() {
  const tursoUrl = process.env.TURSO_DATABASE_URL;
  const tursoToken = process.env.TURSO_AUTH_TOKEN;
  if (!tursoUrl || !tursoToken) {
    console.error("TURSO_DATABASE_URL + TURSO_AUTH_TOKEN required");
    process.exit(1);
  }

  const localDbPath = path.resolve(
    process.cwd(),
    process.cwd().endsWith("tbra") ? "data/tbra.db" : "claude/tbra/data/tbra.db",
  );
  const local = new Database(localDbPath, { readonly: true });
  const turso = createClient({ url: tursoUrl, authToken: tursoToken });
  console.log(`✓ local: ${localDbPath}`);
  console.log(`✓ turso: ${tursoUrl}`);

  // 1) Load all non-null isbn_13 values from Turso — one query, then built
  //    into a Map<normalizedIsbn, bookId> for O(1) collision checks.
  console.log("\nLoading existing Turso isbn_13 map…");
  const existingRes = await turso.execute(
    `SELECT id, isbn_13 FROM books WHERE isbn_13 IS NOT NULL AND isbn_13 != ''`,
  );
  const existingByIsbn = new Map<string, string>();
  for (const row of existingRes.rows) {
    const norm = normalizeIsbn(row.isbn_13 as string);
    if (norm) existingByIsbn.set(norm, row.id as string);
  }
  console.log(`  ${existingByIsbn.size} Turso books already have normalized isbn_13`);

  // 2) Find Turso books missing isbn_13
  console.log("\nFetching Turso books with NULL isbn_13…");
  const missingRes = await turso.execute(
    `SELECT id FROM books WHERE isbn_13 IS NULL OR isbn_13 = ''`,
  );
  const missingIds = missingRes.rows.map((r) => r.id as string);
  console.log(`  ${missingIds.length} Turso books missing isbn_13`);
  if (missingIds.length === 0) {
    console.log("nothing to do!");
    return;
  }

  // 3) Look up local isbn_13 for those ids in chunks
  console.log("\nLooking up local isbn_13 for those ids…");
  const CHUNK = 500;
  const localByBookId = new Map<string, string>(); // bookId -> normalized isbn_13
  for (let i = 0; i < missingIds.length; i += CHUNK) {
    const chunk = missingIds.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => "?").join(",");
    const rows = local
      .prepare(
        `SELECT id, isbn_13 FROM books WHERE id IN (${placeholders}) AND isbn_13 IS NOT NULL AND isbn_13 != ''`,
      )
      .all(...chunk) as { id: string; isbn_13: string }[];
    for (const row of rows) {
      const norm = normalizeIsbn(row.isbn_13);
      if (norm) localByBookId.set(row.id, norm);
    }
  }
  console.log(`  ${localByBookId.size} of those exist locally with an isbn_13`);

  // 4) Partition into safe-writes vs collisions
  const safeWrites: { bookId: string; isbn: string }[] = [];
  const collisions: { bookId: string; isbn: string; collidesWith: string }[] = [];
  for (const [bookId, isbn] of localByBookId) {
    const owner = existingByIsbn.get(isbn);
    if (owner && owner !== bookId) {
      collisions.push({ bookId, isbn, collidesWith: owner });
    } else {
      safeWrites.push({ bookId, isbn });
    }
  }

  console.log(`\nPlan:`);
  console.log(`  ${safeWrites.length} books will be updated (no collision)`);
  console.log(`  ${collisions.length} books SKIPPED — another Turso book already holds that ISBN`);

  if (collisions.length > 0 && collisions.length <= 25) {
    console.log("\nCollision sample:");
    for (const c of collisions.slice(0, 25)) {
      console.log(`  ${c.bookId.slice(0, 8)}… wants ${c.isbn} — already held by ${c.collidesWith.slice(0, 8)}…`);
    }
  } else if (collisions.length > 25) {
    console.log(`\n(${collisions.length} collisions — omitting the list)`);
  }

  if (DRY_RUN) {
    console.log("\n[dry run] no changes made.");
    return;
  }

  if (safeWrites.length === 0) {
    console.log("nothing safe to write.");
    return;
  }

  // 5) Push in batches
  const toApply = safeWrites.slice(0, LIMIT);
  console.log(`\nPushing ${toApply.length} isbn_13 updates to Turso…`);
  const BATCH_SIZE = 100;
  let pushed = 0;
  const started = Date.now();
  for (let i = 0; i < toApply.length; i += BATCH_SIZE) {
    const chunk = toApply.slice(i, i + BATCH_SIZE);
    const statements = chunk.map((u) => ({
      sql: `UPDATE books SET isbn_13 = ? WHERE id = ? AND (isbn_13 IS NULL OR isbn_13 = '')`,
      args: [u.isbn, u.bookId],
    }));
    await turso.batch(statements, "write");
    pushed += chunk.length;
    const elapsed = Math.round((Date.now() - started) / 1000);
    process.stdout.write(`\r  ${pushed}/${toApply.length} (${elapsed}s)`);
  }
  console.log("\n\n✓ Done.");
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
