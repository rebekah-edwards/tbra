/**
 * Replace or clear NON-ENGLISH descriptions on public books.
 *
 * Input: the JSON written by scripts/audit-description-language.ts (live).
 * For each listed book, re-reads the CURRENT live description and skips it if
 * it is now English (TOCTOU — a lane may have fixed it since the audit). Then:
 *   1. tries the OpenLibrary WORK-level description (free; works are usually
 *      described in English even when the edition we point at is a translation)
 *      through sanitizeDescription(), which now rejects non-English text;
 *   2. otherwise clears the text and sets description_stale=1 so
 *      nightly-description-refresh refills it (shelved books first).
 * Blank beats wrong: a foreign blurb on an English book reads as broken.
 *
 * Writes Turso first, then local, with one fresh updated_at, so neither sync
 * direction can bring the old text back. Old values are backed up to
 * reports/backups/. Visibility is NOT touched — demoting real foreign editions
 * is a separate, judgment-heavy step.
 *
 *   npx tsx scripts/fix-non-english-descriptions.ts reports/description-language-audit-<date>.json          # dry run
 *   npx tsx scripts/fix-non-english-descriptions.ts reports/description-language-audit-<date>.json --apply
 */
require("dotenv").config({ path: ".env.vercel.local" });
import { createGuardedTurso } from "./lib/turso-guard";
import { sanitizeDescription } from "../src/lib/enrichment/sanitize";
import { detectDescriptionLanguage } from "../src/lib/text/description-language";
const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const APPLY = process.argv.includes("--apply");
const file = process.argv.find((a) => a.endsWith(".json"));
if (!file) throw new Error("pass the audit JSON");
const CONCURRENCY = 4;

async function olWorkDescription(key: string | null): Promise<string | null> {
  if (!key || !key.startsWith("/works/")) return null;
  try {
    const res = await fetch(`https://openlibrary.org${key}.json`, { headers: { "User-Agent": "tbra-catalog-maintenance" }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const j: any = await res.json();
    const raw = typeof j.description === "string" ? j.description : j.description?.value;
    if (!raw) return null;
    const cleaned = sanitizeDescription(String(raw).replace(/\s*\(?This description comes from the publisher\.?\)?\s*$/i, ""));
    return cleaned && detectDescriptionLanguage(cleaned).english ? cleaned : null;
  } catch {
    return null;
  }
}

(async () => {
  const audit = JSON.parse(fs.readFileSync(file, "utf8"));
  const ids: string[] = audit.foreignDesc.map((f: any) => f.id);
  const { remote, shutdown, heartbeat } = await createGuardedTurso({ name: "fix-non-english-desc", maxRuntimeMs: 40 * 60 * 1000 });
  const local = new Database(path.join(process.cwd(), "data", "tbra.db"));

  const current = new Map<string, any>();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const rows = (await remote.execute({ sql: `SELECT id, title, open_library_key, description, description_stale, updated_at FROM books WHERE id IN (${chunk.map(() => "?").join(",")})`, args: chunk })).rows as any[];
    for (const r of rows) current.set(String(r.id), r);
  }
  const todo = ids.map((id) => current.get(id)).filter((r) => r && r.description && !detectDescriptionLanguage(String(r.description)).english);
  console.log(`audit listed ${ids.length}; still foreign on live: ${todo.length}; mode=${APPLY ? "APPLY" : "DRY"}`);

  const plan: { id: string; title: string; action: "replace" | "clear"; text: string | null; before: any }[] = [];
  let cursor = 0;
  async function worker() {
    for (;;) {
      const r = todo[cursor++];
      if (!r) return;
      const ol = await olWorkDescription(r.open_library_key ? String(r.open_library_key) : null);
      plan.push({ id: String(r.id), title: String(r.title), action: ol ? "replace" : "clear", text: ol, before: { description: r.description, description_stale: r.description_stale, updated_at: r.updated_at } });
      if (plan.length % 100 === 0) { process.stdout.write(`\r  OL looked up ${plan.length}/${todo.length}`); heartbeat(`ol ${plan.length}`); }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log("");
  const rep = plan.filter((p) => p.action === "replace");
  console.log(`replace with English OL work description: ${rep.length}; clear + flag for refresh: ${plan.length - rep.length}`);
  for (const p of rep.slice(0, 8)) console.log(`  [replace] ${p.title}: ${String(p.text).slice(0, 90)}`);
  if (!APPLY) { shutdown(); process.exit(0); }

  const now = new Date().toISOString();
  fs.mkdirSync("reports/backups", { recursive: true });
  const backup = `reports/backups/non-english-descriptions-${now.replace(/[:.]/g, "-")}.json`;
  fs.writeFileSync(backup, JSON.stringify({ at: now, plan }, null, 1));
  console.log(`backup → ${backup}`);

  let tw = 0, lw = 0;
  const upd = local.prepare(`UPDATE books SET description=?, description_stale=?, updated_at=? WHERE id=?`);
  for (let i = 0; i < plan.length; i += 20) {
    const chunk = plan.slice(i, i + 20);
    // Guard on the updated_at we read, so a lane that rewrote the row since is not clobbered.
    const res = await remote.batch(chunk.map((p) => ({
      sql: `UPDATE books SET description=?, description_stale=?, updated_at=? WHERE id=? AND updated_at IS ?`,
      args: [p.text, p.text ? 0 : 1, now, p.id, p.before.updated_at],
    })), "write");
    chunk.forEach((p, j) => {
      if (Number((res as any[])[j].rowsAffected) > 0) { tw++; lw += upd.run(p.text, p.text ? 0 : 1, now, p.id).changes; }
    });
    heartbeat(`wrote ${tw}`);
  }
  console.log(`turso rows: ${tw}/${plan.length}; local rows: ${lw} (rows missing locally arrive on the next pull)`);

  const check = (await remote.execute({ sql: `SELECT COUNT(*) n FROM books WHERE updated_at=? AND (description IS NULL OR description_stale=0)`, args: [now] })).rows[0];
  console.log(`verify: ${check.n} live rows carry this run's stamp`);
  shutdown();
  process.exit(0);
})();
