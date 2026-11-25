/**
 * Fill BLANK audio lengths and page counts on Turso from the local DB
 * (2026-11-25). sync-push never carried `audio_length_minutes`, so lengths
 * found or entered locally (phone Debug build, goals fixer, audiobook lookup)
 * stayed local and live goals flagged those books as "missing audio length".
 * Only fills where live is NULL/0 — never overwrites a live value.
 *
 *   npx tsx scripts/backfill-book-lengths-to-turso.ts          # dry run
 *   APPLY=1 npx tsx scripts/backfill-book-lengths-to-turso.ts
 * Run from the checkout that holds data/tbra.db.
 */
import { config } from "dotenv";
config({ path: ".env.vercel.local" });
import Database from "better-sqlite3";
import path from "path";
import { createGuardedTurso } from "./lib/turso-guard";

const APPLY = process.env.APPLY === "1";

(async () => {
  const { remote } = await createGuardedTurso({ name: "backfill-book-lengths", maxRuntimeMs: 30 * 60 * 1000, queryTimeoutMs: 30_000 });
  const local = new Database(path.join(process.cwd(), "data", "tbra.db"), { readonly: true });
  const rows = local
    .prepare(`SELECT id, audio_length_minutes AS a, pages AS p FROM books
              WHERE (audio_length_minutes > 0) OR (pages > 0)`)
    .all() as { id: string; a: number | null; p: number | null }[];
  console.log(`${rows.length} local books with a length or page count`);

  // Local audio lengths include junk: suspicious round values (1500, 4500,
  // 3000… — ~1,100 books) and ~1,475 lengths implausible for the page count.
  // Only plausible ones go to live: 0.8–4 minutes per page when pages are
  // known, and never one of those round values when they aren't.
  const ROUND_JUNK = new Set([180, 300, 360, 600, 1440, 1500, 3000, 4500]);
  const plausibleAudio = (a: number, p: number | null) =>
    p && p > 0 ? a / p >= 0.8 && a / p <= 4 : !ROUND_JUNK.has(a);
  let audioFills = 0, pageFills = 0, audioSkipped = 0;
  const samples: string[] = [];
  for (let i = 0; i < rows.length; i += 400) {
    const chunk = rows.slice(i, i + 400);
    const live = await remote.execute({
      sql: `SELECT id, audio_length_minutes AS a, pages AS p FROM books WHERE id IN (${chunk.map(() => "?").join(",")})`,
      args: chunk.map((r) => r.id),
    });
    const liveById = new Map((live.rows as any[]).map((r) => [String(r.id), r]));
    const stmts: { sql: string; args: any[] }[] = [];
    for (const r of chunk) {
      const l = liveById.get(r.id);
      if (!l) continue;
      let needA = !!(r.a && r.a > 0 && !(Number(l.a) > 0));
      if (needA && !plausibleAudio(r.a!, r.p ?? (Number(l.p) || null))) { needA = false; audioSkipped++; }
      const needP = r.p && r.p > 0 && !(Number(l.p) > 0);
      if (!needA && !needP) continue;
      if (needA) audioFills++;
      if (needP) pageFills++;
      if (samples.length < 5) samples.push(`${r.id.slice(0, 8)} audio ${l.a}→${needA ? r.a : "-"} pages ${l.p}→${needP ? r.p : "-"}`);
      stmts.push({
        sql: `UPDATE books SET
                audio_length_minutes = CASE WHEN COALESCE(audio_length_minutes, 0) <= 0 THEN ? ELSE audio_length_minutes END,
                pages = CASE WHEN COALESCE(pages, 0) <= 0 THEN ? ELSE pages END
              WHERE id = ?`,
        args: [needA ? r.a : null, needP ? r.p : null, r.id],
      });
    }
    if (APPLY && stmts.length) await remote.batch(stmts, "write");
  }
  console.log(`${APPLY ? "filled" : "would fill"}: audio ${audioFills}, pages ${pageFills} (implausible audio skipped: ${audioSkipped})`);
  samples.forEach((s) => console.log("  " + s));
  process.exit(0);
})();
