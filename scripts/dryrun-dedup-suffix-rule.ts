/**
 * Dry-run: does a SUFFIX-AWARE match rule fix the "volume 2 resolves to
 * volume 1" class without causing a wave of new duplicate books?
 *
 * The hyphen fix (shipped separately) does not solve the reported case:
 * "…Epic Collection: E Is for Extinction" and "…Epic Collection: New Worlds"
 * both truncate at the colon to the same stem, so they still match.
 *
 * Proposed extra check, applied only when the stems already match:
 *   take what follows the separator on each side, strip edition junk;
 *   if BOTH sides have a non-empty remainder and they differ → NOT the same
 *   book. If either side is empty (or reduces to junk) → still a match, so
 *   "Jane Eyre" ←→ "Jane Eyre : (Classics Collection)" keeps working.
 *
 * Read-only. Reports how many same-author groups the rule splits, and shows
 * a sample so the split can be eyeballed for false negatives.
 */

import * as dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env.vercel.local"), override: true });
import { createClient } from "@libsql/client";

const SEP = /\s*(?:[:–—([\/{]|\s-\s)\s*.*$/;
// Only a COLON/DASH suffix distinguishes a volume. Parentheses and brackets
// carry edition/series annotation — "(TruTone, Blush Rose)", "(Grovehill
// Giants Book 3)" — and splitting on those creates duplicate editions.
const SEP_FIND = /\s*(?:[:–—]|\s-\s)\s*/;
const JUNK = /\b(a novel|the novel|a memoir|a story|a mystery|a thriller|novel|memoir|paperback|hardcover|kindle|edition|large print|spanish|special|unabridged|abridged|annotated|illustrated|classic|classics|global|dyslexia[- ]friendly|book|vol|volume)\b/gi;

const stem = (t: string) => t.replace(SEP, "")
  .replace(/\s+by\s+.+$/i, "")
  .replace(JUNK, "")
  .replace(/^(the|a|an)\s+/i, "")
  .toLowerCase().replace(/[^a-z0-9]/g, "").trim();

function suffix(t: string): string {
  const m = t.split(SEP_FIND);
  if (m.length < 2) return "";
  return m.slice(1).join(" ").replace(JUNK, "").toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}

/** true when the proposed rule says these are DIFFERENT books */
function splitsApart(a: string, b: string): boolean {
  const sa = suffix(a), sb = suffix(b);
  return sa !== "" && sb !== "" && sa !== sb;
}

async function main() {
  const db = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN! });
  const rows: { id: string; title: string; author: string }[] = [];
  let cursor = "";
  for (;;) {
    const res = await db.execute({
      sql: `SELECT b.id, b.title, (SELECT a.name FROM book_authors ba JOIN authors a ON a.id=ba.author_id WHERE ba.book_id=b.id LIMIT 1) author
              FROM books b WHERE b.id > ? ORDER BY b.id LIMIT 5000`,
      args: [cursor],
    });
    if (!res.rows.length) break;
    for (const r of res.rows) rows.push({ id: r.id as string, title: (r.title as string) ?? "", author: ((r.author as string) ?? "").toLowerCase().replace(/[^a-z]/g, "") });
    cursor = res.rows[res.rows.length - 1].id as string;
  }
  console.log(`catalog: ${rows.length} books\n`);

  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = `${r.author}|${stem(r.title)}`;
    if (!stem(r.title)) continue;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }
  const collisions = [...groups.values()].filter((v) => v.length > 1);

  let splitGroups = 0, stillMerged = 0;
  const samples: string[][] = [];
  for (const g of collisions) {
    let anySplit = false;
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
      if (splitsApart(g[i].title, g[j].title)) anySplit = true;
    }
    if (anySplit) { splitGroups++; if (samples.length < 30) samples.push(g.map((x) => x.title)); }
    else stillMerged++;
  }

  console.log(`same-author collision groups (after the hyphen fix): ${collisions.length}`);
  console.log(`  groups the SUFFIX RULE would split:  ${splitGroups}`);
  console.log(`  groups still treated as one book:    ${stillMerged}\n`);
  console.log("── sample of groups that would split (check for false splits) ──");
  for (const s of samples) console.log("\n  " + s.join("\n  "));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
