/**
 * One-off repair: user_book_state rows whose owned_formats contains the import
 * placeholder "unknown" ALONGSIDE a real format. The placeholder should have
 * been dropped when the user selected a real format, but the user-facing
 * setOwnedFormats action didn't strip it — inflating the "Owned · N" count
 * (e.g. ["unknown","paperback"] -> "Owned · 2"). Strip "unknown" from those
 * rows only. Rows that are "unknown"-only (owned, format genuinely unspecified)
 * are left untouched.
 *
 * Guarded per the mandatory Turso-script safety rule (CLAUDE.md).
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.vercel.local") });
import { createGuardedTurso } from "./lib/turso-guard";

(async () => {
  const { remote } = await createGuardedTurso({
    name: "fix-unknown-owned-formats",
    maxRuntimeMs: 5 * 60 * 1000,
    queryTimeoutMs: 30_000,
  });

  const rows = await remote.execute(
    `SELECT user_id, book_id, owned_formats FROM user_book_state WHERE owned_formats LIKE '%unknown%'`
  );

  let fixed = 0, skippedUnknownOnly = 0;
  const ts = "2026-06-04T09:30:00.000Z";
  for (const r of rows.rows) {
    let arr: string[];
    try { arr = JSON.parse(r.owned_formats as string); } catch { continue; }
    if (!Array.isArray(arr)) continue;
    const real = arr.filter((f) => f !== "unknown");
    if (real.length === 0) { skippedUnknownOnly++; continue; } // leave owned-unspecified rows alone
    if (real.length === arr.length) continue; // no "unknown" to strip (shouldn't happen given LIKE)
    await remote.execute({
      sql: `UPDATE user_book_state SET owned_formats = ?, updated_at = ? WHERE user_id = ? AND book_id = ?`,
      args: [JSON.stringify(real), ts, r.user_id as string, r.book_id as string],
    });
    console.log(`  fixed ${(r.book_id as string).slice(0,8)} user=${(r.user_id as string).slice(0,8)}: ${JSON.stringify(arr)} -> ${JSON.stringify(real)}`);
    fixed++;
  }
  console.log(`\nFixed ${fixed} inflated row(s); left ${skippedUnknownOnly} unknown-only row(s) untouched.`);
  process.exit(0);
})();
