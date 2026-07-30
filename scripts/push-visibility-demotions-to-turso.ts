/**
 * push-visibility-demotions-to-turso.ts
 *
 * `books.visibility` syncs in NEITHER direction: sync-push.ts (5b) deliberately
 * excludes it ("admin-managed / stable") and sync-pull.ts never reads it. So a
 * local demotion can never reach production.
 *
 * The leak that matters: src/lib/enrichment/enrich-book.ts demotes a book to
 * visibility='import_only' when it detects non-English content AND no user has
 * it shelved. Every local nightly lane calls enrichBook, so ~900 books judged
 * unfit for the public catalog were demoted locally while production kept
 * serving them as public — browsable and searchable on thebasedreader.app.
 *
 * This pushes ONLY that one transition:
 *
 *     local visibility = 'import_only'  AND  prod visibility = 'public'
 *        =>  set prod visibility = 'import_only'
 *
 * Deliberately narrow. It never promotes (local 'public' -> prod), so a genuine
 * admin promotion made on live is never clobbered — which is why adding
 * visibility to sync-push wholesale would be the wrong fix.
 *
 * import_only HIDES a book from search and browse but keeps it fully readable
 * for anyone who already has it shelved. No user data is touched, and the
 * change is reversible by flipping visibility back.
 *
 * Dry-run by default. Pass --apply to mutate production.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env.vercel.local" });

import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { createGuardedTurso } from "./lib/turso-guard";

const APPLY = process.argv.includes("--apply");

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main() {
  console.log("=== push-visibility-demotions-to-turso.ts ===");
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN"}`);

  const db = new Database(path.join(process.cwd(), "data", "tbra.db"));
  db.pragma("journal_mode = WAL");

  const allDemoted = db
    .prepare(`SELECT id, title, language FROM books WHERE visibility = 'import_only'`)
    .all() as { id: string; title: string; language: string | null }[];

  // Exclude anything still labelled English. enrich-book.ts demotes on EITHER a
  // non-English language field OR a non-English *title* heuristic, and the
  // heuristic has false positives — genuinely English books like "Deadly Class,
  // Volume 4" and "Star Wars - The Cestus Deception" sit in the local
  // import_only set. Hiding those on prod would remove real catalog entries, so
  // this push only acts where the language field itself agrees. The excluded
  // rows stay public on prod (status quo) and are reported for separate review.
  const isEnglish = (l: string | null) => l === "English" || l === "eng";
  const localDemoted = allDemoted.filter((b) => !isEnglish(b.language));
  const skippedEnglish = allDemoted.filter((b) => isEnglish(b.language));
  console.log(`Local import_only books: ${allDemoted.length}`);
  console.log(`  excluded (language=English, possible heuristic false positives): ${skippedEnglish.length}`);
  console.log(`  eligible to push: ${localDemoted.length}`);

  const { remote } = await createGuardedTurso({
    name: "push-visibility-demotions",
    maxRuntimeMs: 45 * 60 * 1000,
    queryTimeoutMs: 30_000,
    longRunning: false,
  });

  // Find which of them are still 'public' on prod.
  //
  // Select by id ONLY and filter in JS. Adding `AND visibility = ...` to an
  // `id IN (...)` query makes Turso's planner drop the primary-key index and
  // full-scan `books`: an IN(10) goes from ~65ms to ~82s and trips the guard's
  // query timeout, which looks exactly like a hang.
  const byId = new Map(localDemoted.map((b) => [b.id, b]));
  const stillPublic: string[] = [];
  const batches = chunk(localDemoted.map((b) => b.id), 50);
  for (let i = 0; i < batches.length; i++) {
    const placeholders = batches[i].map(() => "?").join(",");
    const rs = await remote.execute({
      sql: `SELECT id, visibility FROM books WHERE id IN (${placeholders})`,
      args: batches[i],
    });
    for (const row of rs.rows) {
      const r = row as any;
      if (String(r.visibility) === "public") stillPublic.push(String(r.id));
    }
    if ((i + 1) % 20 === 0 || i === batches.length - 1) {
      console.log(`  Scanned ${i + 1}/${batches.length} batches — ${stillPublic.length} divergent so far`);
    }
  }

  console.log(`\nDivergent (local import_only, prod public): ${stillPublic.length}`);
  if (stillPublic.length === 0) {
    console.log("Nothing to push.");
    process.exit(0);
  }

  // Report user impact — import_only keeps these readable for existing owners,
  // but the count is worth seeing before mutating production.
  const stateStmt = db.prepare(
    `SELECT COUNT(*) c FROM user_book_state WHERE book_id = ? AND state IS NOT NULL`,
  );
  const shelved = stillPublic.filter((id) => (stateStmt.get(id) as any).c > 0);
  console.log(`Of those, shelved by at least one user: ${shelved.length} (they keep access)`);

  const langCounts: Record<string, number> = {};
  for (const id of stillPublic) {
    const lang = byId.get(id)?.language ?? "unknown";
    langCounts[lang] = (langCounts[lang] ?? 0) + 1;
  }
  console.log(
    "Languages: " +
      Object.entries(langCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([k, v]) => `${k}:${v}`)
        .join(" "),
  );

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const manifestPath = path.join(process.cwd(), "reports", `visibility-demotions-${ts}.json`);
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        transition: "prod public -> import_only",
        count: stillPublic.length,
        shelvedByAUser: shelved,
        excludedEnglishLabelled: skippedEnglish.map((b) => ({
          id: b.id,
          title: b.title,
          language: b.language,
        })),
        books: stillPublic.map((id) => ({
          id,
          title: byId.get(id)?.title ?? null,
          language: byId.get(id)?.language ?? null,
        })),
      },
      null,
      2,
    ),
  );
  console.log(`Manifest: ${manifestPath}`);

  if (!APPLY) {
    console.log(`\nDRY-RUN — would demote ${stillPublic.length} books on prod. Re-run with --apply.`);
    process.exit(0);
  }

  console.log(`\nDemoting ${stillPublic.length} books on Turso...`);
  let updated = 0;
  for (const id of stillPublic) {
    // Key on id ALONE. Adding `AND visibility = 'public'` here re-triggers the
    // same planner collapse as the SELECT above — the UPDATE full-scans `books`
    // and blows the guard's 30s timeout mid-run. The scan above already
    // established that every id in this list is public on prod.
    await remote.execute({
      sql: `UPDATE books SET visibility = 'import_only', updated_at = ? WHERE id = ?`,
      args: [new Date().toISOString(), id],
    });
    updated++;
    if (updated % 100 === 0) console.log(`  ${updated}/${stillPublic.length}`);
  }

  // Verify rather than trust the write count.
  let remaining = 0;
  for (const batch of chunk(stillPublic, 50)) {
    const placeholders = batch.map(() => "?").join(",");
    const rs = await remote.execute({
      sql: `SELECT visibility FROM books WHERE id IN (${placeholders})`,
      args: batch,
    });
    for (const row of rs.rows) if (String((row as any).visibility) === "public") remaining++;
  }
  console.log(`\nUpdated: ${updated}. Still public on prod after verify: ${remaining} (expect 0)`);
  process.exit(remaining === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
