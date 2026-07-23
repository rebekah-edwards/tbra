/**
 * Repair Rebekah's TBR-cleanup resurrection (2026-07-22 night).
 *
 * What happened: removing a reading state DELETES the user_book_state row
 * (non-owned books); the 30-min bidirectional sync never deletes, so prod
 * kept every removed row and re-inserted 33 of them into local during her
 * cleanup session (fingerprint: rowid > 12500 = inserted tonight, but
 * updated_at older than today). Prod still holds her ENTIRE pre-cleanup
 * TBR, so the full removed set = prod tbr MINUS local intended tbr.
 *
 * Steps:
 *   1. Local: delete the 33 fingerprinted resurrected rows.
 *   2. Prod: delete her tbr rows for books NOT in the local intended set.
 *   3. Prod: mirror her 28 owned-book soft-removals (state NULL, newer ts).
 *   4. Verify counts match; write a full manifest to /tmp for undo.
 */
require("dotenv").config({ path: ".env.local" });
require("dotenv").config({ path: ".env.vercel.local" });
import { createClient } from "@libsql/client";
import { createGuardedTurso } from "./lib/turso-guard";
import { writeFileSync } from "fs";

const REBEKAH = "c2f3eb27-139f-4605-9566-8ded8d9e1336";

(async () => {
  const { remote } = await createGuardedTurso({
    name: "repair-tbr-resurrection",
    maxRuntimeMs: 15 * 60 * 1000,
    queryTimeoutMs: 30_000,
  });
  const local = createClient({ url: "file:./data/tbra.db" });
  const manifest: any = { deletedLocal: [], deletedProd: [], nulledProd: [] };

  // ── 1. Local: fingerprinted resurrected rows ──
  const localRes = await local.execute({
    sql: `SELECT s.rowid rid, s.book_id, b.title FROM user_book_state s JOIN books b ON b.id=s.book_id
          WHERE s.user_id=? AND s.state='tbr' AND s.rowid > 12500 AND s.updated_at < '2026-07-22'`,
    args: [REBEKAH],
  });
  console.log(`local resurrected rows: ${localRes.rows.length}`);
  for (const r of localRes.rows as any[]) {
    manifest.deletedLocal.push({ bookId: r.book_id, title: r.title });
    await local.execute({ sql: "DELETE FROM user_book_state WHERE rowid=?", args: [r.rid] });
  }

  // ── 2. Prod: delete tbr rows not in the local intended set ──
  const intended = new Set(
    (await local.execute({
      sql: "SELECT book_id FROM user_book_state WHERE user_id=? AND state='tbr'",
      args: [REBEKAH],
    })).rows.map((r: any) => String(r.book_id))
  );
  console.log(`local intended tbr: ${intended.size}`);

  const prodTbr = (await remote.execute({
    sql: "SELECT s.book_id, b.title FROM user_book_state s JOIN books b ON b.id=s.book_id WHERE s.user_id=? AND s.state='tbr'",
    args: [REBEKAH],
  })).rows as any[];
  console.log(`prod tbr before: ${prodTbr.length}`);

  const toDelete = prodTbr.filter((r) => !intended.has(String(r.book_id)));
  console.log(`prod rows to delete: ${toDelete.length}`);
  if (toDelete.length >= 1000) throw new Error("unexpectedly large delete — aborting");
  for (const r of toDelete) {
    manifest.deletedProd.push({ bookId: r.book_id, title: r.title });
    await remote.execute({
      sql: "DELETE FROM user_book_state WHERE user_id=? AND book_id=?",
      args: [REBEKAH, r.book_id],
    });
  }

  // ── 3. Prod: mirror tonight's owned-book soft-removals (state NULL) ──
  const nulls = (await local.execute({
    sql: `SELECT book_id, updated_at, owned_formats FROM user_book_state
          WHERE user_id=? AND (state IS NULL OR state='') AND updated_at >= '2026-07-22'`,
    args: [REBEKAH],
  })).rows as any[];
  for (const r of nulls) {
    manifest.nulledProd.push({ bookId: r.book_id });
    await remote.execute({
      sql: "UPDATE user_book_state SET state=NULL, updated_at=? WHERE user_id=? AND book_id=?",
      args: [r.updated_at, REBEKAH, r.book_id],
    });
  }
  console.log(`prod soft-removals mirrored: ${nulls.length}`);

  // ── 4. Verify ──
  const lc = (await local.execute({ sql: "SELECT COUNT(*) n FROM user_book_state WHERE user_id=? AND state='tbr'", args: [REBEKAH] })).rows[0] as any;
  const pc = (await remote.execute({ sql: "SELECT COUNT(*) n FROM user_book_state WHERE user_id=? AND state='tbr'", args: [REBEKAH] })).rows[0] as any;
  console.log(`VERIFY tbr counts — local: ${lc.n}, prod: ${pc.n} ${lc.n === pc.n ? "✓ MATCH" : "✗ MISMATCH"}`);

  writeFileSync("/tmp/tbr-repair-manifest-2026-07-22.json", JSON.stringify(manifest, null, 2));
  console.log(`manifest → /tmp/tbr-repair-manifest-2026-07-22.json (${manifest.deletedLocal.length} local, ${manifest.deletedProd.length} prod deletions)`);
  process.exit(0);
})().catch((e) => { console.error("FATAL:", e); process.exit(1); });
