/**
 * Re-heal books whose summary was cut off mid-thought with a trailing ellipsis.
 *
 * These were invisible to the healer until 2026-10-16: a summary ending in
 * "..." satisfied heal.ts's endsWithPunctuation check via its final ".", so
 * `endsCleanly` was true and the rewrite never fired. They are also invisible
 * to enrichBook, whose summaryIsThin gate only catches <80 or >190 chars —
 * a truncated 185-char summary sits squarely inside the accepted range.
 * Two beta testers reported them as "summary is cut off".
 *
 * Reads candidates from the LOCAL db, heals locally (healBook writes local),
 * then the caller pushes with sync-push 5b, which carries `summary`.
 *
 * Usage:
 *   npx tsx scripts/heal-truncated-summaries.ts --dry-run
 *   npx tsx scripts/heal-truncated-summaries.ts --limit=20
 *   npx tsx scripts/heal-truncated-summaries.ts --ids=<uuid>,<uuid>
 */
import * as fs from "fs";
import * as path from "path";

// Standalone script: .env.local must be loaded explicitly, before any import
// that reads process.env at module scope.
const envPath = path.join(process.cwd(), ".env.local");
for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx === -1) continue;
  const key = trimmed.slice(0, eqIdx);
  let val = trimmed.slice(eqIdx + 1);
  if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
  process.env[key] = val;
}
process.env.ENRICHMENT_PAUSED = "false";

const arg = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const dryRun = process.argv.includes("--dry-run");
const limit = Number(arg("limit") ?? 500);
const explicitIds = arg("ids")?.split(",").map((s) => s.trim()).filter(Boolean);

(async () => {
  const { db } = await import("../src/db");
  const { books } = await import("../src/db/schema");
  const { healBook } = await import("../src/lib/enrichment/heal");
  const { sql, inArray } = await import("drizzle-orm");

  const rows = explicitIds
    ? await db
        .select({ id: books.id, title: books.title, summary: books.summary })
        .from(books)
        .where(inArray(books.id, explicitIds))
    : await db
        .select({ id: books.id, title: books.title, summary: books.summary })
        .from(books)
        .where(
          sql`${books.visibility} = 'public'
              AND ${books.summary} IS NOT NULL
              AND (${books.summary} LIKE '%...' OR ${books.summary} LIKE '%…')`
        )
        .limit(limit);

  console.log(`Candidates: ${rows.length}${dryRun ? "  [DRY RUN]" : ""}`);

  let rewritten = 0;
  let unchanged = 0;
  let failed = 0;

  for (const row of rows) {
    console.log(`\n— ${row.title} (${row.id})`);
    console.log(`  before [${row.summary?.length}]: ${row.summary}`);
    if (dryRun) continue;

    try {
      const result = await healBook(row.id);
      const summaryFix = result.fixes.find((f) => f.startsWith("Summary:"));
      const [after] = await db
        .select({ summary: books.summary })
        .from(books)
        .where(inArray(books.id, [row.id]));

      if (after?.summary && after.summary !== row.summary) {
        rewritten++;
        console.log(`  after  [${after.summary.length}]: ${after.summary}`);
        console.log(`  fix: ${summaryFix ?? "(no summary fix reported)"}`);
      } else {
        unchanged++;
        console.log(`  UNCHANGED — ${summaryFix ?? "healer reported no summary fix"}`);
      }
    } catch (e: unknown) {
      failed++;
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`  FAILED: ${msg}`);
      // The xAI 403 → API_EXHAUSTED mapping trips a 1h global auto-pause, so
      // keep going only while the API is actually answering.
      if (/API_EXHAUSTED|auto-pause/i.test(msg)) {
        console.log("  API exhausted or paused — stopping early.");
        break;
      }
    }
  }

  console.log(
    `\nDONE — rewritten ${rewritten}, unchanged ${unchanged}, failed ${failed}`
  );
  process.exit(0);
})();
