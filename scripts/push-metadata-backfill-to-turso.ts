/**
 * One-shot catch-up script: pushes locally-backfilled book metadata to Turso.
 *
 * WHY THIS EXISTS
 * ---------------
 * The nightly `metadata-backfill` task fills missing description/summary/
 * cover/pages/publisher/isbn13 on the local SQLite database via ISBNdb +
 * Google Books, but intentionally skips syncing to Turso (per the task
 * SKILL file). That left production ~10k books behind local. This script
 * does the one-time catch-up.
 *
 * SAFETY
 * ------
 * - Only fills BLANKS on Turso. Never overwrites a non-null field with
 *   local data — uses COALESCE-style guards in the UPDATE so live-side
 *   edits are preserved.
 * - Skips books that don't exist on Turso (local-only rows).
 * - Processes in chunks with progress logging so interruption is safe
 *   (rerun just picks up the remaining work).
 *
 * USAGE
 * -----
 *   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... \
 *     npx tsx scripts/push-metadata-backfill-to-turso.ts [--dry-run] [--limit=N]
 */

import { createClient } from "@libsql/client";
import Database from "better-sqlite3";
import path from "path";

const DRY_RUN = process.argv.includes("--dry-run");
const LIMIT_ARG = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = LIMIT_ARG ? parseInt(LIMIT_ARG.split("=")[1], 10) : Infinity;

// isbn_13 is intentionally excluded — Turso has a UNIQUE constraint on it
// and some local books have ISBNs that collide with different Turso books
// (dupes across the two catalogs). Handle ISBN backfill in a separate pass
// with explicit dedup.
const FIELDS = [
  "description",
  "summary",
  "cover_image_url",
  "pages",
  "publisher",
  "publication_year",
] as const;
type Field = (typeof FIELDS)[number];

async function main() {
  const tursoUrl = process.env.TURSO_DATABASE_URL;
  const tursoToken = process.env.TURSO_AUTH_TOKEN;
  if (!tursoUrl || !tursoToken) {
    console.error("ERROR: TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set");
    process.exit(1);
  }

  // ── Connect to local SQLite ──
  const localDbPath = path.resolve(
    process.cwd(),
    process.cwd().endsWith("tbra") ? "data/tbra.db" : "claude/tbra/data/tbra.db",
  );
  const local = new Database(localDbPath, { readonly: true });
  console.log(`✓ Local SQLite: ${localDbPath}`);

  // ── Connect to Turso ──
  const turso = createClient({ url: tursoUrl, authToken: tursoToken });
  console.log(`✓ Turso: ${tursoUrl}`);

  // ── Fetch the list of Turso books needing ANY of these fields ──
  console.log("\nFetching Turso books with missing metadata…");
  const missingCondition = FIELDS.map((f) => `${f} IS NULL OR ${f} = ''`).join(" OR ");
  const tursoRows = await turso.execute(
    `SELECT id, ${FIELDS.join(", ")} FROM books WHERE ${missingCondition}`,
  );
  console.log(`  ${tursoRows.rows.length} Turso books need at least one field filled`);

  if (tursoRows.rows.length === 0) {
    console.log("Nothing to do!");
    return;
  }

  // ── For each, build a map of what's missing on Turso ──
  type BookNeeds = { id: string; missing: Field[] };
  const needsByBook = new Map<string, BookNeeds>();
  for (const row of tursoRows.rows) {
    const id = row.id as string;
    const missing: Field[] = [];
    for (const field of FIELDS) {
      const val = row[field];
      if (val === null || val === undefined || val === "") missing.push(field);
    }
    if (missing.length > 0) needsByBook.set(id, { id, missing });
  }
  console.log(`  ${needsByBook.size} books cataloged by missing field`);

  // ── Pull local values for those books in bulk ──
  // Split into chunks because SQLite has a ~999-param IN clause limit.
  const ids = [...needsByBook.keys()];
  const CHUNK = 500;
  const localByBook = new Map<string, Record<Field, unknown>>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => "?").join(",");
    const rows = local
      .prepare(
        `SELECT id, ${FIELDS.join(", ")} FROM books WHERE id IN (${placeholders})`,
      )
      .all(...chunk) as ({ id: string } & Record<Field, unknown>)[];
    for (const row of rows) {
      const { id, ...fields } = row;
      localByBook.set(id, fields as Record<Field, unknown>);
    }
  }
  console.log(`  ${localByBook.size} of those exist locally (others are live-only)`);

  // ── Determine which updates we actually need to send ──
  type Update = { id: string; fields: Partial<Record<Field, unknown>> };
  const updates: Update[] = [];
  for (const [id, needs] of needsByBook) {
    const local = localByBook.get(id);
    if (!local) continue; // book doesn't exist locally — skip
    const fields: Partial<Record<Field, unknown>> = {};
    let hasAny = false;
    for (const field of needs.missing) {
      const val = local[field];
      if (val !== null && val !== undefined && val !== "") {
        fields[field] = val;
        hasAny = true;
      }
    }
    if (hasAny) updates.push({ id, fields });
  }

  const perFieldCounts: Record<Field, number> = Object.fromEntries(
    FIELDS.map((f) => [f, 0]),
  ) as Record<Field, number>;
  for (const u of updates) {
    for (const f of Object.keys(u.fields) as Field[]) perFieldCounts[f]++;
  }

  console.log(`\n${updates.length} books will be updated on Turso.`);
  console.log("Field-level counts (how many books get each field filled):");
  for (const [f, count] of Object.entries(perFieldCounts)) {
    if (count > 0) console.log(`  ${f.padEnd(20)} ${count}`);
  }

  if (DRY_RUN) {
    console.log("\n[dry run] no changes made.");
    return;
  }

  if (updates.length === 0) {
    console.log("Nothing to update.");
    return;
  }

  // ── Cap at --limit if passed ──
  const toApply = updates.slice(0, LIMIT);
  if (toApply.length < updates.length) {
    console.log(`\n(--limit=${LIMIT}) — only pushing the first ${toApply.length}`);
  }

  // ── Push updates in chunks using libsql batch mode ──
  console.log("\nPushing updates to Turso…");
  const BATCH_SIZE = 100;
  let pushed = 0;
  const started = Date.now();
  for (let i = 0; i < toApply.length; i += BATCH_SIZE) {
    const chunk = toApply.slice(i, i + BATCH_SIZE);
    const statements = chunk.map((u) => {
      const cols = Object.keys(u.fields) as Field[];
      // COALESCE() guard: only sets the field if it's still NULL/empty on Turso.
      // This protects against races where Turso gained a value after our read.
      const setClauses = cols
        .map(
          (c) =>
            `${c} = CASE WHEN ${c} IS NULL OR ${c} = '' THEN ? ELSE ${c} END`,
        )
        .join(", ");
      return {
        sql: `UPDATE books SET ${setClauses} WHERE id = ?`,
        args: [...cols.map((c) => u.fields[c] as string | number), u.id],
      };
    });
    await turso.batch(statements, "write");
    pushed += chunk.length;
    const elapsed = Math.round((Date.now() - started) / 1000);
    process.stdout.write(
      `\r  ${pushed}/${toApply.length} books updated (${elapsed}s)`,
    );
  }
  console.log("\n\n✓ Done.");
}

main().catch((err) => {
  console.error("\nFAILED:", err);
  process.exit(1);
});
