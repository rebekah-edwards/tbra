/**
 * Mirror the hide-junk-discovery visibility change to production Turso.
 *
 * sync-push.ts deliberately NEVER touches `visibility`, so hiding books locally
 * does not propagate. This targeted, guarded script reads the id list written by
 * hide-junk-discovery.ts (data/hidden-discovery-ids.json) and sets
 * visibility='hidden' on Turso in batches.
 *
 * Guarded per the mandatory Turso-write rule (createGuardedTurso).
 *
 * Usage: npx tsx scripts/push-hidden-to-turso.ts
 */
import { config } from "dotenv";
config({ path: ".env.vercel.local" });

import * as fs from "fs";
import * as path from "path";
import { createGuardedTurso } from "./lib/turso-guard";

(async () => {
  const idsPath = path.join(process.cwd(), "data", "hidden-discovery-ids.json");
  if (!fs.existsSync(idsPath)) {
    console.error(`No id list at ${idsPath} — run hide-junk-discovery.ts --apply first.`);
    process.exit(1);
  }
  const ids: string[] = JSON.parse(fs.readFileSync(idsPath, "utf8"));
  console.log(`Pushing visibility='hidden' for ${ids.length} books to Turso…`);

  const { remote, heartbeat } = await createGuardedTurso({
    name: "push-hidden-discovery",
    maxRuntimeMs: 20 * 60 * 1000,
    queryTimeoutMs: 30_000,
  });

  const CHUNK = 100;
  let updated = 0;
  let notFound = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const batch = ids.slice(i, i + CHUNK);
    const placeholders = batch.map(() => "?").join(",");
    // Only flip rows that are still public — never resurrect a book a user has
    // since interacted with, and keep the operation idempotent.
    const res = await remote.execute({
      sql: `UPDATE books SET visibility='hidden' WHERE id IN (${placeholders}) AND visibility='public'`,
      args: batch,
    });
    updated += res.rowsAffected ?? 0;
    notFound += batch.length - (res.rowsAffected ?? 0);
    if (i % (CHUNK * 10) === 0) heartbeat(`${i}/${ids.length}`);
  }

  console.log(`\n✓ Turso updated: ${updated} rows set to hidden.`);
  console.log(`  (${notFound} ids were already non-public or not present on Turso — expected for local-only rows.)`);
  process.exit(0);
})();
