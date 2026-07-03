/**
 * One-off: merge the duplicate J.K. Rowling author rows (found 2026-07-02
 * during the Cormoran Strike repair). Keeper is the row with the canonical
 * slug, OL key, and 47 book links; the dupe ("J.K. Rowling", slug jk-rowling,
 * no OL key) had 5 book links. Dual-writes Turso + local.
 */
import Database from "better-sqlite3";
import path from "path";
import { createGuardedTurso } from "./lib/turso-guard";

// eslint-disable-next-line @typescript-eslint/no-require-imports
require("dotenv").config({ path: ".env.vercel.local" });

const KEEP = "4208efaf-cfc1-4a6f-9b35-b3f3fd4a6a9c"; // "J. K. Rowling" j-k-rowling OL23919A
const DUPE = "870cdd36-b0b9-48e9-b000-b2444f151ed4"; // "J.K. Rowling" jk-rowling

type Exec = (sql: string, args?: unknown[]) => Promise<{ rowsAffected: number; rows: Record<string, unknown>[] }>;

async function merge(label: string, exec: Exec) {
  console.log(`\n===== ${label} =====`);
  const before = await exec(`SELECT id, name, slug FROM authors WHERE id IN (?, ?)`, [KEEP, DUPE]);
  console.log(`  rows present: ${before.rows.map((r) => `${r.name}(${r.slug})`).join(", ")}`);

  for (const t of ["book_authors", "author_follows"]) {
    try {
      const u = await exec(`UPDATE OR IGNORE ${t} SET author_id = ? WHERE author_id = ?`, [KEEP, DUPE]);
      const d = await exec(`DELETE FROM ${t} WHERE author_id = ?`, [DUPE]);
      console.log(`  ${t}: repointed ${u.rowsAffected}, residual-deleted ${d.rowsAffected}`);
    } catch (e) { console.log(`  ${t}: skipped (${(e as Error).message})`); }
  }

  await exec(`DELETE FROM authors WHERE id = ?`, [DUPE]);
  const gone = await exec(`SELECT id FROM authors WHERE id = ?`, [DUPE]);
  if (gone.rows.length) throw new Error(`${label}: dupe author row survived delete`);

  const count = await exec(`SELECT COUNT(*) AS n FROM book_authors WHERE author_id = ?`, [KEEP]);
  console.log(`  dupe deleted (verified); keeper now has ${count.rows[0].n} book links`);
}

(async () => {
  const { remote } = await createGuardedTurso({
    name: "merge-rowling-author",
    maxRuntimeMs: 5 * 60 * 1000,
    queryTimeoutMs: 60_000,
  });
  const local = new Database(path.join(process.cwd(), "data", "tbra.db"));

  await merge("TURSO (production)", async (sql, args = []) => {
    const r = await remote.execute({ sql, args: args as never[] });
    return { rowsAffected: r.rowsAffected ?? 0, rows: r.rows as unknown as Record<string, unknown>[] };
  });
  await merge("LOCAL (data/tbra.db)", async (sql, args = []) => {
    if (/^\s*SELECT/i.test(sql)) return { rowsAffected: 0, rows: local.prepare(sql).all(...(args as never[])) as Record<string, unknown>[] };
    const info = local.prepare(sql).run(...(args as never[]));
    return { rowsAffected: info.changes, rows: [] };
  });

  console.log("\nDone — J.K. Rowling merged on both databases.");
  local.close();
  process.exit(0);
})();
