/**
 * One-shot cleanup: walks public catalog descriptions that contain ≥3
 * blurb-attribution patterns and rewrites them through stripBlurbs(),
 * preserving non-blurb prose.
 *
 *   --dry-run (default): preview what changes for each book
 *   --apply              : write the cleaned descriptions back to Turso
 *
 * Books where stripping leaves <60 chars are CLEARED (description=NULL,
 * description_stale=1) — same fallback behavior as flag-junk-descriptions.ts.
 *
 * The 2 PURE blurb-walls were already cleared by clear-pure-blurbs.ts;
 * this script's WHERE clause naturally excludes them (no longer have a
 * description containing the pattern).
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.vercel.local" });

import { createGuardedTurso } from "./lib/turso-guard";
import { stripBlurbs } from "../src/lib/enrichment/sanitize";

const APPLY = process.argv.includes("--apply");
const MIN_PROSE_LENGTH = 60;
const BLURB_REGEX = /"[^"]{15,}"\s*[―—–]\s*[A-Z][\w\s.,&]+/g;

(async () => {
  const guard = await createGuardedTurso({
    name: "strip-blurbs-from-existing",
    maxRuntimeMs: 30 * 60 * 1000,
    // The candidate-fetch query pulls ~5500 rows of full descriptions —
    // bump the per-query timeout above the 30s default so the initial SELECT
    // can complete on slow Turso replicas.
    queryTimeoutMs: 120_000,
  });
  const remote = guard.remote;

  console.log(`[strip-blurbs] mode=${APPLY ? "APPLY" : "DRY-RUN"}`);
  console.log("");

  // Pull books with description that has at least one em-dash variant —
  // pre-filter to make the scan tractable.
  const candidates = await remote.execute(`
    SELECT id, title, description
    FROM books
    WHERE visibility = 'public'
      AND description IS NOT NULL AND description <> ''
      AND (description LIKE '%—%' OR description LIKE '%―%' OR description LIKE '%–%')
  `);

  type Outcome =
    | { kind: "skip-no-blurbs"; id: string; title: string }
    | { kind: "stripped"; id: string; title: string; before: string; after: string; removed: number; lenBefore: number; lenAfter: number }
    | { kind: "cleared"; id: string; title: string; before: string; removed: number };

  const outcomes: Outcome[] = [];

  for (const row of candidates.rows) {
    const id = String(row.id ?? "");
    const title = String(row.title ?? "");
    const desc = String(row.description ?? "");

    const matchCount = (desc.match(BLURB_REGEX) ?? []).length;
    if (matchCount < 3) {
      outcomes.push({ kind: "skip-no-blurbs", id, title });
      continue;
    }

    const { stripped, removed } = stripBlurbs(desc);

    if (stripped.length < MIN_PROSE_LENGTH) {
      outcomes.push({ kind: "cleared", id, title, before: desc, removed });
    } else {
      outcomes.push({
        kind: "stripped",
        id,
        title,
        before: desc,
        after: stripped,
        removed,
        lenBefore: desc.length,
        lenAfter: stripped.length,
      });
    }
  }

  const stripped = outcomes.filter((o) => o.kind === "stripped");
  const cleared = outcomes.filter((o) => o.kind === "cleared");

  console.log(`Scanned ${candidates.rows.length} candidates with em-dash variants`);
  console.log(`  ${stripped.length} books — stripped (kept prose)`);
  console.log(`  ${cleared.length} books — cleared (left below ${MIN_PROSE_LENGTH} chars after strip)`);
  console.log("");

  // ── Show samples ──
  console.log("===== STRIPPED SAMPLES (up to 10) =====\n");
  for (const o of stripped.slice(0, 10)) {
    if (o.kind !== "stripped") continue;
    console.log(`"${o.title}" (${o.id})`);
    console.log(`  before (${o.lenBefore}ch, ${o.removed} blurbs removed):`);
    console.log(`    ${o.before.slice(0, 200).replace(/\s+/g, " ")}...`);
    console.log(`  after (${o.lenAfter}ch):`);
    console.log(`    ${o.after.slice(0, 200).replace(/\s+/g, " ")}...`);
    console.log("");
  }

  if (cleared.length > 0) {
    console.log("===== CLEARED SAMPLES (would clear, prose too short) =====\n");
    for (const o of cleared.slice(0, 10)) {
      if (o.kind !== "cleared") continue;
      console.log(`"${o.title}" (${o.id})`);
      console.log(`  before (${o.before.length}ch, ${o.removed} blurbs removed):`);
      console.log(`    ${o.before.slice(0, 200).replace(/\s+/g, " ")}...`);
      console.log("");
    }
  }

  if (!APPLY) {
    console.log("DRY-RUN — no changes made.");
    console.log("Re-run with --apply to write changes to Turso.");
    process.exit(0);
  }

  // ── APPLY ──
  console.log(`Applying changes to ${stripped.length + cleared.length} books on Turso...`);
  let applied = 0;
  let failed = 0;
  for (const o of outcomes) {
    if (o.kind === "skip-no-blurbs") continue;
    try {
      if (o.kind === "stripped") {
        await remote.execute({
          sql: `UPDATE books SET description = ?, updated_at = datetime('now') WHERE id = ?`,
          args: [o.after, o.id],
        });
      } else if (o.kind === "cleared") {
        await remote.execute({
          sql: `UPDATE books SET description = NULL, description_stale = 1, updated_at = datetime('now') WHERE id = ?`,
          args: [o.id],
        });
      }
      applied++;
    } catch (e: any) {
      console.error(`  FAIL ${o.id}: ${e?.message ?? e}`);
      failed++;
    }
  }

  console.log("");
  console.log(`===== APPLY DONE =====`);
  console.log(`  applied: ${applied} (${stripped.length} stripped, ${cleared.length} cleared)`);
  console.log(`  failed:  ${failed}`);
  process.exit(0);
})();
