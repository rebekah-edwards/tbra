/**
 * unhide-english-false-positives.ts
 *
 * Companion to audit-english-title-heuristic.ts. Restores books that the OLD
 * non-English title heuristic wrongly hid — English titles caught by foreign
 * words that are also ordinary English words ("Die for Me", "Van Helsing",
 * "Miami Noir", "Forever Young", "Fat Chance").
 *
 * Three gates, all required:
 *   1. The old rules flagged it, the fixed rules do not.
 *   2. books.language says English — the title heuristic alone is not trusted
 *      to un-hide anything.
 *   3. Not on the hand-review exclusion list below.
 *
 * Gate 3 exists because gates 1-2 still let a handful through: Dutch and
 * Spanish titles carrying a wrong language='English' field, plus omnibus/box-set
 * entries that should stay out of the catalog on their own merits. Every
 * candidate was read by hand; the ones below were rejected with a reason.
 *
 * Dry-run by default. Pass --apply to mutate local + Turso.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env.vercel.local" });

import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { createGuardedTurso } from "./lib/turso-guard";

const APPLY = process.argv.includes("--apply");

/** Rejected on hand review — title => why it stays hidden. */
const EXCLUDE: Record<string, string> = {
  "Erfenis van de Liefde": "Dutch title, language field is wrong",
  "Casa Desolada": "Spanish edition of Bleak House, language field is wrong",
  "Vergeten Waarom Ik van Je Hou": "Dutch title, language field is wrong",
  "Vlam van Hoop": "Dutch title, language field is wrong",
  "Staat van Verwondering": "Dutch title, language field is wrong",
  "Brtse dung gi glu pa": "Tibetan transliteration, language field is wrong",
  "Lobezno Noir": "Spanish edition of Wolverine Noir",
  "An Accidental Woman/2nd Chance/Distant Shores/City of Bones (Reader's Digest Select Editions, Volume 6":
    "Reader's Digest omnibus — belongs out of the catalog like other box sets",
  "Hannah Bonam-Young Bestselling Series, 3 Books Set, Out on a Limb, Next of Kin, Next to You":
    "3-book box set",
};

function latestAudit(): string {
  const dir = path.join(process.cwd(), "reports");
  const files = fs.readdirSync(dir).filter((f) => /^english-heuristic-audit-.*\.json$/.test(f));
  if (files.length === 0) {
    throw new Error("No audit report found — run scripts/audit-english-title-heuristic.ts first");
  }
  files.sort();
  return path.join(dir, files[files.length - 1]);
}

async function main() {
  console.log("=== unhide-english-false-positives.ts ===");
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN"}`);

  const auditPath = latestAudit();
  const audit = JSON.parse(fs.readFileSync(auditPath, "utf8"));
  console.log(`Audit: ${auditPath}`);

  const candidates: { id: string; title: string; originalRule: string }[] = audit.safeToUnhide;
  console.log(`Candidates from audit: ${candidates.length}`);

  const db = new Database(path.join(process.cwd(), "data", "tbra.db"));
  db.pragma("journal_mode = WAL");

  const rejected: { title: string; why: string }[] = [];
  const accepted: { id: string; title: string; originalRule: string }[] = [];

  for (const c of candidates) {
    if (EXCLUDE[c.title]) {
      rejected.push({ title: c.title, why: EXCLUDE[c.title] });
      continue;
    }
    // Independent safety gates against the live row, not the audit snapshot.
    const row = db
      .prepare(`SELECT visibility, is_box_set FROM books WHERE id = ?`)
      .get(c.id) as { visibility: string; is_box_set: number } | undefined;
    if (!row) {
      rejected.push({ title: c.title, why: "row no longer exists locally" });
      continue;
    }
    if (row.visibility !== "import_only") {
      rejected.push({ title: c.title, why: `already ${row.visibility}` });
      continue;
    }
    if (row.is_box_set) {
      rejected.push({ title: c.title, why: "flagged as a box set" });
      continue;
    }
    const openIssue = db
      .prepare(`SELECT COUNT(*) c FROM reported_issues WHERE book_id = ? AND status != 'resolved'`)
      .get(c.id) as { c: number };
    if (openIssue.c > 0) {
      rejected.push({ title: c.title, why: "has an unresolved reported issue" });
      continue;
    }
    accepted.push(c);
  }

  console.log(`\nRejected (${rejected.length}):`);
  for (const r of rejected) console.log(`  "${r.title.slice(0, 70)}" — ${r.why}`);

  console.log(`\nTo un-hide (${accepted.length}):`);
  for (const a of accepted) console.log(`  "${a.title.slice(0, 70)}"  [was: ${a.originalRule}]`);

  if (!APPLY) {
    console.log(`\nDRY-RUN — re-run with --apply to publish these ${accepted.length} books.`);
    process.exit(0);
  }
  if (accepted.length === 0) {
    console.log("\nNothing to do.");
    process.exit(0);
  }

  // LOCAL first, then Turso.
  const now = new Date().toISOString();
  const upd = db.prepare(`UPDATE books SET visibility = 'public', updated_at = ? WHERE id = ?`);
  for (const a of accepted) upd.run(now, a.id);
  console.log(`\nLOCAL: ${accepted.length} books set public`);

  const { remote } = await createGuardedTurso({
    name: "unhide-english-false-positives",
    maxRuntimeMs: 15 * 60 * 1000,
    queryTimeoutMs: 30_000,
    longRunning: false,
  });

  let remoteUpdated = 0;
  for (const a of accepted) {
    // Key on id alone — an extra visibility predicate makes Turso's planner
    // full-scan `books` (see push-visibility-demotions-to-turso.ts).
    await remote.execute({
      sql: `UPDATE books SET visibility = 'public', updated_at = ? WHERE id = ?`,
      args: [now, a.id],
    });
    remoteUpdated++;
  }
  console.log(`TURSO: ${remoteUpdated} books set public`);

  // Verify both sides.
  let badLocal = 0;
  for (const a of accepted) {
    const r = db.prepare(`SELECT visibility FROM books WHERE id = ?`).get(a.id) as { visibility: string };
    if (r.visibility !== "public") badLocal++;
  }
  let badRemote = 0;
  for (const a of accepted) {
    const rs = await remote.execute({ sql: `SELECT visibility FROM books WHERE id = ?`, args: [a.id] });
    if (String((rs.rows[0] as any).visibility) !== "public") badRemote++;
  }
  console.log(`\nVerify — local not public: ${badLocal}, turso not public: ${badRemote} (expect 0/0)`);
  process.exit(badLocal === 0 && badRemote === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
