/**
 * Dry-run impact sizing for the `normalizeTitleForDedup()` hyphen bug
 * (docs/handoff-app-bug-backlog.md §6, diagnosed 2026-08-23).
 *
 * The bare `-` in the separator class truncates titles at the FIRST hyphen,
 * so "New X-Men Modern Era Epic Collection: E Is for Extinction" normalizes
 * to "newx" and collides with every other same-author "New X-…" title.
 *
 * That section left the fix unshipped pending "a dry-run over existing titles
 * to size the impact". This is that dry-run. READ-ONLY — no writes anywhere.
 *
 * It reports, over the live catalog:
 *   A. how many books change normalized key under the proposed regex
 *   B. same-author groups that collapse to one key TODAY but would split
 *      apart under the fix  → these are the false merges the bug is causing
 *   C. same-author groups that collapse under BOTH regexes
 *      → unaffected by the fix; the existing merge behaviour is preserved
 *
 * B is the win. C is the safety check. If C is unchanged, the fix cannot
 * cause missed merges relative to today.
 */

import * as dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env.vercel.local"), override: true });

import { createClient } from "@libsql/client";

// ─── The two normalizers, verbatim except for the separator class ───

const CURRENT_SEP = /\s*[:\-–—([\/{]\s*.*$/;
// Proposed: bare "-" only counts as a separator when spaced (" - ").
const PROPOSED_SEP = /\s*(?:[:–—([\/{]|\s-\s)\s*.*$/;

function normalize(title: string, sep: RegExp): string {
  let t = title;
  t = t.replace(sep, "");
  t = t.replace(/\s+by\s+.+$/i, "");
  t = t.replace(
    /\b(paperback|hardcover|kindle|edition|large print|spanish|special|unabridged|abridged|annotated|illustrated|classic|global|dyslexia[- ]friendly)\b/gi,
    "",
  );
  t = t.replace(/^(the|a|an)\s+/i, "");
  return t.toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}

interface Row {
  id: string;
  title: string;
  author: string | null;
}

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;
  if (!url || !token) throw new Error("TURSO_* env missing");
  const db = createClient({ url, authToken: token });

  // Keyset-paginate the whole catalog (per turso_sync_process: no OFFSET).
  const rows: Row[] = [];
  let cursor = "";
  for (;;) {
    const res = await db.execute({
      sql: `SELECT b.id, b.title,
                   (SELECT a.name FROM book_authors ba
                      JOIN authors a ON a.id = ba.author_id
                     WHERE ba.book_id = b.id LIMIT 1) AS author
              FROM books b
             WHERE b.id > ?
             ORDER BY b.id
             LIMIT 5000`,
      args: [cursor],
    });
    if (res.rows.length === 0) break;
    for (const r of res.rows) {
      rows.push({ id: r.id as string, title: (r.title as string) ?? "", author: (r.author as string) ?? null });
    }
    cursor = res.rows[res.rows.length - 1].id as string;
    process.stderr.write(`  …${rows.length}\n`);
  }
  console.log(`Catalog scanned: ${rows.length} books\n`);

  const authorKey = (a: string | null) => (a ?? "∅").toLowerCase().replace(/[^a-z]/g, "");

  // A. keys that change
  let changed = 0;
  const curGroups = new Map<string, Row[]>();
  const propGroups = new Map<string, Row[]>();

  for (const r of rows) {
    const cur = normalize(r.title, CURRENT_SEP);
    const prop = normalize(r.title, PROPOSED_SEP);
    if (cur !== prop) changed++;
    if (cur) {
      const k = `${authorKey(r.author)}|${cur}`;
      (curGroups.get(k) ?? curGroups.set(k, []).get(k)!).push(r);
    }
    if (prop) {
      const k = `${authorKey(r.author)}|${prop}`;
      (propGroups.get(k) ?? propGroups.set(k, []).get(k)!).push(r);
    }
  }

  console.log(`A. Books whose normalized key changes: ${changed} (${((changed / rows.length) * 100).toFixed(2)}%)\n`);

  // B + C. same-author collision groups
  const curCollisions = [...curGroups.entries()].filter(([, v]) => v.length > 1);
  const propCollisions = [...propGroups.entries()].filter(([, v]) => v.length > 1);
  const propKeys = new Set(propCollisions.map(([k]) => k));

  const splitApart = curCollisions.filter(([k]) => !propKeys.has(k));
  const preserved = curCollisions.filter(([k]) => propKeys.has(k));

  console.log(`Same-author collision groups today:        ${curCollisions.length}`);
  console.log(`Same-author collision groups after fix:    ${propCollisions.length}`);
  console.log(`  B. groups the fix SPLITS APART (false merges the bug causes): ${splitApart.length}`);
  console.log(`  C. groups preserved by the fix (merge behaviour unchanged):   ${preserved.length}`);

  const newGroups = propCollisions.filter(([k]) => !curGroups.has(k) || curGroups.get(k)!.length <= 1);
  console.log(`  D. collision groups the fix CREATES (should be 0):            ${newGroups.length}\n`);

  console.log(`── B: groups that stop colliding (first 40) ──`);
  for (const [k, v] of splitApart.slice(0, 40)) {
    console.log(`\n  key "${k}"  (${v.length} books)`);
    for (const b of v) console.log(`    - ${b.title}   [${b.author ?? "no author"}]`);
  }
  if (splitApart.length > 40) console.log(`\n  …and ${splitApart.length - 40} more groups not listed.`);

  if (newGroups.length) {
    console.log(`\n── D: NEW collisions introduced (investigate before shipping) ──`);
    for (const [k, v] of newGroups.slice(0, 20)) {
      console.log(`  key "${k}": ${v.map((b) => b.title).join(" | ")}`);
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
