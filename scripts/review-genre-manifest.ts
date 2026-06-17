/**
 * READ-ONLY. Renders the proposed hierarchy grouped by root for human review.
 * Prints, per root: total book-links and the top child tags assigned to it.
 * This is the artifact to eyeball for misfiles before applying anything.
 */
import { readFileSync, writeFileSync } from "fs";

const data = JSON.parse(readFileSync("reports/genre-parent-manifest.json", "utf8"));
const manifest: { name: string; books: number; root: string | null; source: string }[] = data.manifest;

const byRoot = new Map<string, { name: string; books: number; source: string }[]>();
for (const m of manifest) {
  if (!m.root) continue;
  const arr = byRoot.get(m.root) ?? [];
  arr.push({ name: m.name, books: m.books, source: m.source });
  byRoot.set(m.root, arr);
}

const roots = [...byRoot.entries()]
  .map(([root, kids]) => ({ root, kids, links: kids.reduce((a, k) => a + k.books, 0) }))
  .sort((a, b) => b.links - a.links);

const TOPN = Number(process.argv[2] ?? 18);
const lines: string[] = [];
for (const { root, kids, links } of roots) {
  const childRows = kids.filter((k) => k.source !== "root");
  lines.push(`\n━━ ${root}  (${links} book-links, ${kids.length} tags) ━━`);
  childRows.sort((a, b) => b.books - a.books);
  for (const k of childRows.slice(0, TOPN)) {
    lines.push(`   ${String(k.books).padStart(5)}  ${k.name}`);
  }
  if (childRows.length > TOPN) lines.push(`         …+${childRows.length - TOPN} more tags`);
}
const out = lines.join("\n");
console.log(out);
writeFileSync("reports/genre-hierarchy-review.txt", out);
console.log(`\n\nWritten: reports/genre-hierarchy-review.txt`);
