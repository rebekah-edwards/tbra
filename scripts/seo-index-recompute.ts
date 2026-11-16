/**
 * seo-index-recompute — recompute the SEO core set on Turso by hand.
 *
 * The nightly run is the Vercel cron /api/cron/seo-index; this script is for
 * the first population, for tuning CORE_GATE, and for forcing a large change.
 *
 *   npx tsx scripts/seo-index-recompute.ts --dry-run   # report only
 *   npx tsx scripts/seo-index-recompute.ts             # apply
 *   npx tsx scripts/seo-index-recompute.ts --force     # allow a >30% shrink
 *
 * Reads credentials from .env.vercel.local in the current directory, or from
 * the path in TBRA_ENV_FILE.
 */
import { config } from "dotenv";
config({ path: process.env.TBRA_ENV_FILE || ".env.vercel.local" });

import { createGuardedTurso } from "./lib/turso-guard";
import { recomputeCoreSet, SEO_INDEX_TABLE_DDL, CORE_GATE } from "../src/lib/seo/core-set";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const force = process.argv.includes("--force");

  const { remote, heartbeat, shutdown } = await createGuardedTurso({
    name: "seo-index-recompute",
    maxRuntimeMs: 15 * 60 * 1000,
    queryTimeoutMs: 120_000,
  });

  await remote.execute(SEO_INDEX_TABLE_DDL);
  heartbeat("table ready");

  const t0 = Date.now();
  const report = await recomputeCoreSet(
    async (sql, args = []) => {
      const res = await remote.execute({ sql, args });
      return res.rows as unknown as Record<string, unknown>[];
    },
    { dryRun, force },
  );

  const totals = await remote.execute(
    `SELECT COUNT(*) AS total, SUM(visibility = 'public') AS public FROM books`,
  );
  shutdown();

  const worst = Object.entries(report.failures).sort((a, b) => b[1] - a[1]);
  console.log(`[seo-index] gate: ${JSON.stringify(CORE_GATE)}`);
  console.log(`[seo-index] books total=${totals.rows[0].total} public=${totals.rows[0].public}`);
  console.log(`[seo-index] touched by a reader=${report.touchedBooks} evaluated=${report.evaluated}`);
  console.log(`[seo-index] PASSING (core set)=${report.passing}  previous=${report.previousSize}  +${report.added} -${report.removed}`);
  console.log(`[seo-index] failures among touched books (a book can fail several):`);
  for (const [k, n] of worst) console.log(`              ${k.padEnd(20)} ${n}`);
  console.log(`[seo-index] ${report.aborted ? "ABORTED: " + report.aborted : dryRun ? "dry run — nothing written" : "applied"} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (report.aborted) process.exit(3);
  process.exit(0);
}

main().catch((e) => {
  console.error("[seo-index] FAILED:", e);
  process.exit(1);
});
