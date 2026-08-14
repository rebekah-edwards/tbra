/**
 * Hand-merge the edition-variant pairs where ONE USER holds rows on BOTH books.
 *
 * `replay-dedup-both.ts` deliberately refuses these: it moves rows with
 * `UPDATE book_id`, which would violate the (user, book) unique constraint when
 * the same user is on both sides. The decision of which row wins is a judgement
 * call, so it belongs here rather than in the bulk applier.
 *
 * Scope check performed 2026-08-14 before writing this: across all four pairs,
 * the ONLY colliding table is `user_book_state`. No ratings and no reviews are
 * involved, so nothing irreversible is at stake.
 *
 * Rule applied: the MORE ADVANCED reading state wins, and owned_formats are
 * unioned. This can only ever upgrade what the user sees — it never downgrades
 * a shelf state or drops a format. Three of the four pairs are no-ops under
 * this rule (both rows already carry the same state); the fourth (Shatter Me)
 * promotes the canon from `null` to `completed`, which is precisely the row a
 * naive INSERT-OR-IGNORE merge would have destroyed.
 *
 *   npx tsx scripts/resolve-edition-variant-collisions.ts --scan=<scan>.json
 *   npx tsx scripts/resolve-edition-variant-collisions.ts --scan=<scan>.json --apply
 *
 * After this runs, the pairs are collision-free and go through the normal
 * applier:
 *   npx tsx scripts/replay-dedup-both.ts --manifest=reports/<emitted>.json --apply
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env.vercel.local" });

import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { createGuardedTurso } from "./lib/turso-guard";
import { findUserOverlap, localRunner, tursoRunner } from "./lib/dupe-overlap";

const APPLY = process.argv.includes("--apply");
const SCAN = process.argv.find((a) => a.startsWith("--scan="))?.split("=")[1];
if (!SCAN) {
  console.error("--scan=<find-edition-variant-dupes output> is required");
  process.exit(1);
}

/** Reading-state progression. Higher wins. `null` = no shelf state at all. */
const RANK: Record<string, number> = {
  tbr: 1,
  up_next: 2,
  currently_reading: 3,
  paused: 3,
  dnf: 4,
  completed: 5,
};
const rank = (s: string | null) => (s ? (RANK[s] ?? 1) : 0);

function unionFormats(a: string | null, b: string | null): string | null {
  const parse = (v: string | null): string[] => {
    if (!v) return [];
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  };
  const merged = [...new Set([...parse(a), ...parse(b)])].filter((f) => f && f !== "unknown");
  return merged.length ? JSON.stringify(merged) : (a ?? b);
}

(async () => {
  const scan = JSON.parse(fs.readFileSync(SCAN, "utf8")) as { supervised: any[] };
  const local = new Database("data/tbra.db");
  const { remote } = await createGuardedTurso({
    name: "resolve-edition-variant-collisions",
    maxRuntimeMs: 20 * 60 * 1000,
    queryTimeoutMs: 30_000,
    longRunning: false,
  });

  const lr = localRunner(local);
  const tr = tursoRunner(remote);
  const resolved: any[] = [];

  console.log(`[resolve-collisions] mode=${APPLY ? "APPLY" : "DRY RUN"}\n`);

  for (const p of scan.supervised) {
    const L = await findUserOverlap(lr, p.canonical_id, p.dupe_id);
    const T = await findUserOverlap(tr, p.canonical_id, p.dupe_id);
    if (!L.length && !T.length) continue; // handled by the bulk applier

    const nonState = [...L, ...T].filter(
      (h) => !h.startsWith("user_book_state:") && !h.startsWith("reading_sessions:"),
    );
    if (nonState.length) {
      // Ratings/reviews/favourites in play — a genuine content decision this
      // script is not entitled to make. Leave it entirely alone.
      console.log(`SKIP  "${p.dupe_title}" — collides beyond shelf state: ${nonState.join(", ")}`);
      continue;
    }

    console.log(`=== "${p.dupe_title}"  ->  "${p.canonical_title}"`);

    const dupeRows = (
      await remote.execute({
        sql: "SELECT user_id, state, owned_formats FROM user_book_state WHERE book_id = ?",
        args: [p.dupe_id],
      })
    ).rows as any[];

    for (const d of dupeRows) {
      const canonRow = (
        await remote.execute({
          sql: "SELECT state, owned_formats FROM user_book_state WHERE book_id = ? AND user_id = ?",
          args: [p.canonical_id, d.user_id],
        })
      ).rows[0] as any;
      if (!canonRow) continue; // no collision for this user — applier moves it

      const winner = rank(d.state) > rank(canonRow.state) ? d.state : canonRow.state;
      const formats = unionFormats(canonRow.owned_formats, d.owned_formats);
      const changed = winner !== canonRow.state || formats !== canonRow.owned_formats;

      console.log(
        `  user ${String(d.user_id).slice(0, 8)}: canon="${canonRow.state}" dupe="${d.state}" -> "${winner}"` +
          `  formats ${canonRow.owned_formats ?? "null"} + ${d.owned_formats ?? "null"} -> ${formats ?? "null"}` +
          (changed ? "   [UPDATE]" : "   [no-op]"),
      );

      if (APPLY && changed) {
        const ts = new Date().toISOString();
        local
          .prepare("UPDATE user_book_state SET state = ?, owned_formats = ?, updated_at = ? WHERE book_id = ? AND user_id = ?")
          .run(winner, formats, ts, p.canonical_id, d.user_id);
        await remote.execute({
          sql: "UPDATE user_book_state SET state = ?, owned_formats = ?, updated_at = ? WHERE book_id = ? AND user_id = ?",
          args: [winner, formats, ts, p.canonical_id, d.user_id],
        });
      }
    }

    // ── reading_sessions ────────────────────────────────────────────────
    // A user with a session on BOTH books read the work ONCE — the duplicate
    // catalog entry is why it got recorded twice. So these are folded into one
    // session rather than kept as two reads: earliest start wins (that is when
    // the read actually began) and any non-null finish date is preserved.
    const dupeSessions = (
      await remote.execute({
        sql: "SELECT user_id, read_number, state, started_at, completion_date, completion_precision FROM reading_sessions WHERE book_id = ?",
        args: [p.dupe_id],
      })
    ).rows as any[];

    for (const ds of dupeSessions) {
      const cs = (
        await remote.execute({
          sql: "SELECT state, started_at, completion_date, completion_precision FROM reading_sessions WHERE book_id = ? AND user_id = ? AND read_number = ?",
          args: [p.canonical_id, ds.user_id, ds.read_number],
        })
      ).rows[0] as any;
      if (!cs) continue; // no clash on this read_number — the applier moves it

      const earliest = [cs.started_at, ds.started_at].filter(Boolean).sort()[0] ?? cs.started_at;
      // Whichever side actually HAS a completion date wins; if both do, the
      // earlier one. On Shatter Me the canon session had no completion_date at
      // all and the DUPE carried it — keeping the canon row blindly would have
      // erased a real finish date.
      const dates = [cs.completion_date, ds.completion_date].filter(Boolean).sort();
      const completion = dates[0] ?? null;
      const precision =
        completion === null
          ? null
          : completion === cs.completion_date
            ? cs.completion_precision
            : ds.completion_precision;
      const state = rank(ds.state) > rank(cs.state) ? ds.state : cs.state;

      const changed =
        earliest !== cs.started_at ||
        completion !== cs.completion_date ||
        precision !== cs.completion_precision ||
        state !== cs.state;

      console.log(
        `  session user ${String(ds.user_id).slice(0, 8)} read#${ds.read_number}: ` +
          `state ${cs.state}/${ds.state} -> ${state}` +
          ` | start ${cs.started_at} vs ${ds.started_at} -> ${earliest}` +
          ` | completed ${cs.completion_date ?? "null"} vs ${ds.completion_date ?? "null"} -> ${completion ?? "null"}` +
          (changed ? "   [UPDATE]" : "   [no-op]"),
      );

      if (APPLY) {
        if (changed) {
          const sql =
            "UPDATE reading_sessions SET state = ?, started_at = ?, completion_date = ?, completion_precision = ?, updated_at = ? WHERE book_id = ? AND user_id = ? AND read_number = ?";
          const args = [
            state,
            earliest,
            completion,
            precision,
            new Date().toISOString(),
            p.canonical_id,
            ds.user_id,
            ds.read_number,
          ];
          local.prepare(sql).run(...(args as any[]));
          await remote.execute({ sql, args: args as any[] });
        }
        local
          .prepare("DELETE FROM reading_sessions WHERE book_id = ? AND user_id = ? AND read_number = ?")
          .run(p.dupe_id, ds.user_id, ds.read_number);
        await remote.execute({
          sql: "DELETE FROM reading_sessions WHERE book_id = ? AND user_id = ? AND read_number = ?",
          args: [p.dupe_id, ds.user_id, ds.read_number],
        });
      }
    }

    // The dupe's colliding state rows have now been folded into the canon, so
    // delete them — that is what clears the collision for the bulk applier.
    if (APPLY) {
      for (const d of dupeRows) {
        const canonRow = (
          await remote.execute({
            sql: "SELECT 1 FROM user_book_state WHERE book_id = ? AND user_id = ?",
            args: [p.canonical_id, d.user_id],
          })
        ).rows[0];
        if (!canonRow) continue;
        local
          .prepare("DELETE FROM user_book_state WHERE book_id = ? AND user_id = ?")
          .run(p.dupe_id, d.user_id);
        await remote.execute({
          sql: "DELETE FROM user_book_state WHERE book_id = ? AND user_id = ?",
          args: [p.dupe_id, d.user_id],
        });
      }
    }

    resolved.push({
      dupe_id: p.dupe_id,
      dupe_title: p.dupe_title,
      canonical_id: p.canonical_id,
      canonical_title: p.canonical_title,
    });
  }

  const out = path.join(
    "reports",
    `dedup-manifest-edition-collisions-${new Date().toISOString().slice(0, 10)}.json`,
  );
  if (APPLY) {
    fs.writeFileSync(out, JSON.stringify(resolved, null, 2));
    console.log(`\n  collisions cleared: ${resolved.length}`);
    console.log(`  merge manifest: ${out}`);
    console.log(`  next: npx tsx scripts/replay-dedup-both.ts --manifest=${out} --apply`);
  } else {
    console.log(`\n  would clear ${resolved.length} collisions and write ${out}`);
  }
  process.exit(0);
})();
