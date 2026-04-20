/**
 * migrate-user-content-prefs.ts — reconcile user preferences with the
 * 2026-04-17 content taxonomy restructure.
 *
 * Book-side taxonomy already moved:
 *   - sexual_assault_coercion → DEACTIVATED, rows migrated into
 *     abuse_suffering + romance_sex (see migrate-content-taxonomy.ts).
 *   - magic_witchcraft stayed active; occult_demonology added as a new split.
 *
 * But user preferences were never migrated. Users who had a tolerance set
 * for the deprecated SA category are now effectively unprotected on the
 * replacement categories, and users who had magic_witchcraft tolerance
 * never got an equivalent occult_demonology tolerance.
 *
 * Migration logic:
 *
 *   A. sexual_assault_coercion → abuse_suffering + romance_sex
 *      For each user with a SA pref of value X:
 *        - For each target (abuse_suffering, romance_sex):
 *            if the user has a pref there: keep min(existing, X) — lower
 *              tolerance = stricter, so we preserve strictest preference.
 *            else: create it at X.
 *        - Delete the SA pref (category is inactive; Settings UI no longer
 *          lists it, so leaving the row would orphan it).
 *
 *   B. magic_witchcraft → occult_demonology (only if user doesn't already
 *      have one — they may have set it explicitly already).
 *
 * Runs both local SQLite and production Turso in one pass. Dry-run default.
 */
import Database from "better-sqlite3";
import path from "path";
import { createClient } from "@libsql/client";
import { config } from "dotenv";

config({ path: ".env.vercel.local" });

const APPLY = process.argv.includes("--apply");

const CAT_SA = "4b8dc655-d645-4fec-b177-3a4fd4568134";       // sexual_assault_coercion (INACTIVE)
const CAT_ABUSE = "be479980-2b8a-4693-9ac9-ca22b7a46183";    // abuse_suffering
const CAT_ROMANCE = "4ba66d94-2d8b-4558-858c-5643c5ae9864";  // romance_sex
const CAT_MAGIC = "895cee59-f605-49b5-9e8a-905cfe36c455";    // magic_witchcraft
const CAT_OCCULT = "882fd4c3-2cc9-4572-ac8b-d091e1ae7fce";   // occult_demonology (NEW)

const localDb = new Database(path.join(process.cwd(), "data", "tbra.db"));
const turso = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

type Row = { user_id: string; category_id: string; max_tolerance: number };

async function fetchAllLocal(): Promise<Row[]> {
  return localDb
    .prepare(`SELECT user_id, category_id, max_tolerance FROM user_content_preferences
              WHERE category_id IN (?, ?, ?, ?, ?)`)
    .all(CAT_SA, CAT_ABUSE, CAT_ROMANCE, CAT_MAGIC, CAT_OCCULT) as Row[];
}

async function fetchAllTurso(): Promise<Row[]> {
  const res = await turso.execute({
    sql: `SELECT user_id, category_id, max_tolerance FROM user_content_preferences
          WHERE category_id IN (?, ?, ?, ?, ?)`,
    args: [CAT_SA, CAT_ABUSE, CAT_ROMANCE, CAT_MAGIC, CAT_OCCULT],
  });
  return res.rows.map((r) => ({
    user_id: String(r.user_id),
    category_id: String(r.category_id),
    max_tolerance: Number(r.max_tolerance),
  }));
}

function plan(rows: Row[]) {
  // Build per-user view
  const byUser = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const m = byUser.get(r.user_id) ?? new Map<string, number>();
    m.set(r.category_id, r.max_tolerance);
    byUser.set(r.user_id, m);
  }

  const upserts: { user_id: string; category_id: string; max_tolerance: number }[] = [];
  const deletes: { user_id: string; category_id: string }[] = [];

  for (const [userId, prefs] of byUser) {
    // A. SA migration
    const sa = prefs.get(CAT_SA);
    if (sa !== undefined) {
      // abuse_suffering
      const abuse = prefs.get(CAT_ABUSE);
      const newAbuse = abuse !== undefined ? Math.min(abuse, sa) : sa;
      if (abuse !== newAbuse) {
        upserts.push({ user_id: userId, category_id: CAT_ABUSE, max_tolerance: newAbuse });
      }
      // romance_sex
      const romance = prefs.get(CAT_ROMANCE);
      const newRomance = romance !== undefined ? Math.min(romance, sa) : sa;
      if (romance !== newRomance) {
        upserts.push({ user_id: userId, category_id: CAT_ROMANCE, max_tolerance: newRomance });
      }
      // Drop SA pref
      deletes.push({ user_id: userId, category_id: CAT_SA });
    }

    // B. magic_witchcraft → occult_demonology (only when occult isn't set)
    const magic = prefs.get(CAT_MAGIC);
    const occult = prefs.get(CAT_OCCULT);
    if (magic !== undefined && occult === undefined) {
      upserts.push({ user_id: userId, category_id: CAT_OCCULT, max_tolerance: magic });
    }
  }

  return { upserts, deletes };
}

async function main() {
  console.log(`=== migrate-user-content-prefs.ts ===`);
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN"}\n`);

  const [localRows, tursoRows] = await Promise.all([fetchAllLocal(), fetchAllTurso()]);

  // Plan separately for each side (users might exist on one and not the other)
  const localPlan = plan(localRows);
  const tursoPlan = plan(tursoRows);

  console.log(`Local: ${localRows.length.toLocaleString()} relevant prefs → ${localPlan.upserts.length} upserts + ${localPlan.deletes.length} deletes`);
  console.log(`Turso: ${tursoRows.length.toLocaleString()} relevant prefs → ${tursoPlan.upserts.length} upserts + ${tursoPlan.deletes.length} deletes\n`);

  // Sample: distribution of SA tolerance values we're migrating
  const saSamples = localRows.filter((r) => r.category_id === CAT_SA);
  const dist: Record<number, number> = {};
  for (const r of saSamples) dist[r.max_tolerance] = (dist[r.max_tolerance] ?? 0) + 1;
  console.log(`SA tolerance distribution (local): ${JSON.stringify(dist)}`);
  const magicSamples = localRows.filter((r) => r.category_id === CAT_MAGIC);
  const mDist: Record<number, number> = {};
  for (const r of magicSamples) mDist[r.max_tolerance] = (mDist[r.max_tolerance] ?? 0) + 1;
  console.log(`Magic tolerance distribution (local): ${JSON.stringify(mDist)}`);
  console.log();

  if (!APPLY) {
    console.log("DRY-RUN complete. Re-run with --apply.");
    localDb.close(); turso.close();
    return;
  }

  // LOCAL apply
  const upsertStmt = localDb.prepare(
    `INSERT INTO user_content_preferences (user_id, category_id, max_tolerance)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id, category_id) DO UPDATE SET max_tolerance = excluded.max_tolerance`,
  );
  const deleteStmt = localDb.prepare(
    `DELETE FROM user_content_preferences WHERE user_id = ? AND category_id = ?`,
  );
  const localTxn = localDb.transaction(() => {
    for (const u of localPlan.upserts) upsertStmt.run(u.user_id, u.category_id, u.max_tolerance);
    for (const d of localPlan.deletes) deleteStmt.run(d.user_id, d.category_id);
  });
  localTxn();
  console.log(`Local: applied ${localPlan.upserts.length} upserts + ${localPlan.deletes.length} deletes`);

  // TURSO apply
  let tUp = 0, tDel = 0, tErrors = 0;
  for (const u of tursoPlan.upserts) {
    try {
      await turso.execute({
        sql: `INSERT INTO user_content_preferences (user_id, category_id, max_tolerance)
              VALUES (?, ?, ?)
              ON CONFLICT(user_id, category_id) DO UPDATE SET max_tolerance = excluded.max_tolerance`,
        args: [u.user_id, u.category_id, u.max_tolerance],
      });
      tUp++;
    } catch (e: any) { tErrors++; console.warn(`turso upsert err: ${e?.message?.slice(0, 100)}`); }
  }
  for (const d of tursoPlan.deletes) {
    try {
      await turso.execute({
        sql: `DELETE FROM user_content_preferences WHERE user_id = ? AND category_id = ?`,
        args: [d.user_id, d.category_id],
      });
      tDel++;
    } catch (e: any) { tErrors++; console.warn(`turso delete err: ${e?.message?.slice(0, 100)}`); }
  }
  console.log(`Turso: ${tUp} upserts, ${tDel} deletes, ${tErrors} errors`);

  localDb.close();
  turso.close();
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
