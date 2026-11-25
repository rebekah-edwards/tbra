/**
 * READ-ONLY audit: public books whose stored DESCRIPTION is not English, plus
 * public books whose canonical ISBN belongs to a non-English registration group
 * (the usual root cause — see src/lib/text/description-language.ts).
 *
 * Reads production Turso (the source of truth for what readers see), in id
 * order, 2,000 rows a page, first 1,500 chars of each description.
 *
 *   npx tsx scripts/audit-description-language.ts            # live (Turso)
 *   npx tsx scripts/audit-description-language.ts --local    # data/tbra.db
 *
 * Writes reports/description-language-audit-<date>.json. No DB writes.
 */
import { config } from "dotenv";
config({ path: ".env.vercel.local" });
import { createClient } from "@libsql/client";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { detectDescriptionLanguage, nonEnglishIsbnGroup } from "../src/lib/text/description-language";

const LOCAL = process.argv.includes("--local");
const PAGE = 2000;

type Row = { id: string; title: string; slug: string; isbn_13: string | null; language: string | null; d: string | null; shelved: number };

async function main() {
  const sql = `SELECT b.id, b.title, b.slug, b.isbn_13, b.language, substr(b.description,1,1500) AS d,
                 (SELECT COUNT(*) FROM user_book_state s WHERE s.book_id=b.id) AS shelved
               FROM books b WHERE b.visibility='public' AND b.id > ? ORDER BY b.id LIMIT ${PAGE}`;
  const local = LOCAL ? new Database(path.join(process.cwd(), "data", "tbra.db"), { readonly: true }) : null;
  const remote = LOCAL ? null : createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN! });
  const fetchPage = async (after: string): Promise<Row[]> =>
    local ? (local.prepare(sql).all(after) as Row[]) : ((await remote!.execute({ sql, args: [after] })).rows as unknown as Row[]);

  const foreignDesc: any[] = [];
  const foreignIsbn: any[] = [];
  let scanned = 0, withDesc = 0, after = "";
  for (;;) {
    const rows = await fetchPage(after);
    if (!rows.length) break;
    after = String(rows[rows.length - 1].id);
    for (const r of rows) {
      scanned++;
      const group = nonEnglishIsbnGroup(r.isbn_13);
      let v = null;
      if (r.d && r.d.trim()) {
        withDesc++;
        v = detectDescriptionLanguage(String(r.d));
        if (!v.english) foreignDesc.push({ id: r.id, title: r.title, slug: r.slug, isbn13: r.isbn_13, isbnGroup: group, languageField: r.language, detected: v.language, enHits: v.englishHits, fHits: v.foreignHits, shelved: Number(r.shelved), sample: String(r.d).replace(/\s+/g, " ").slice(0, 160) });
      }
      if (group) foreignIsbn.push({ id: r.id, title: r.title, slug: r.slug, isbn13: r.isbn_13, isbnGroup: group, descEnglish: v ? v.english : null, shelved: Number(r.shelved) });
    }
    process.stdout.write(`\r  scanned ${scanned.toLocaleString()}`);
  }
  console.log("");

  const byLang = new Map<string, number>();
  for (const f of foreignDesc) byLang.set(f.detected, (byLang.get(f.detected) ?? 0) + 1);
  console.log(`\nPublic books scanned: ${scanned.toLocaleString()} (${withDesc.toLocaleString()} with a description) — ${LOCAL ? "LOCAL" : "LIVE"}`);
  console.log(`Non-English descriptions: ${foreignDesc.length} (${foreignDesc.filter((f) => f.shelved > 0).length} on a reader's shelf)`);
  for (const [l, n] of [...byLang.entries()].sort((a, b) => b[1] - a[1])) console.log(`   ${l.padEnd(18)} ${n}`);
  console.log(`   ...of which language field still says English/blank: ${foreignDesc.filter((f) => !f.languageField || f.languageField === "English").length}`);
  console.log(`   ...of which canonical ISBN is a non-English group:     ${foreignDesc.filter((f) => f.isbnGroup).length}`);
  console.log(`Public books with a non-English-group canonical ISBN: ${foreignIsbn.length} (${foreignIsbn.filter((f) => f.descEnglish === false).length} also have foreign text, ${foreignIsbn.filter((f) => f.shelved > 0).length} shelved)`);

  console.log(`\nSample non-English descriptions (shelved first):`);
  for (const f of [...foreignDesc].sort((a, b) => b.shelved - a.shelved).slice(0, 25))
    console.log(`  [${f.detected}${f.isbnGroup ? ` / ISBN ${f.isbnGroup}` : ""}${f.shelved ? ` / ${f.shelved} shelved` : ""}] ${f.title} — ${f.sample.slice(0, 90)}`);

  fs.mkdirSync("reports", { recursive: true });
  const out = `reports/description-language-audit-${new Date().toISOString().slice(0, 10)}${LOCAL ? "-local" : ""}.json`;
  fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), source: LOCAL ? "local" : "live", scanned, withDesc, foreignDesc, foreignIsbn }, null, 1));
  console.log(`\nWrote ${out}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
