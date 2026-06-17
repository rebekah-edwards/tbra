/**
 * READ-ONLY. Applies classifyToRoot() to every genre row and reports coverage,
 * then writes a full manifest to reports/ for human review. Writes nothing to any DB.
 */
import { createClient } from "@libsql/client";
import { writeFileSync, mkdirSync } from "fs";
import { CANONICAL_ROOTS, classifyToRoot } from "./genre-hierarchy";

const db = createClient({ url: "file:data/tbra.db" });

(async () => {
  const g = await db.execute(
    `SELECT g.id, g.name,
            (SELECT COUNT(*) FROM book_genres bg WHERE bg.genre_id = g.id) AS books
     FROM genres g`
  );

  const rows = g.rows.map((r) => ({ id: r.id as string, name: r.name as string, books: Number(r.books) }));
  const total = rows.length;
  const totalLinks = rows.reduce((a, r) => a + r.books, 0);

  const bySource: Record<string, { rows: number; books: number }> = {};
  const unmapped: { name: string; books: number }[] = [];
  const manifest = rows.map((r) => {
    const { root, source } = classifyToRoot(r.name);
    bySource[source] ??= { rows: 0, books: 0 };
    bySource[source].rows++;
    bySource[source].books += r.books;
    if (source === "unmapped") unmapped.push({ name: r.name, books: r.books });
    return { ...r, root, source };
  });

  const pct = (n: number, d: number) => `${((n / d) * 100).toFixed(1)}%`;
  console.log(`\n=== PROPOSED HIERARCHY MANIFEST ===`);
  console.log(`Genres: ${total}   book-links: ${totalLinks}   canonical roots: ${CANONICAL_ROOTS.length}\n`);
  for (const s of ["root", "alias", "override", "rule", "unmapped"]) {
    const c = bySource[s];
    if (!c) continue;
    console.log(`${s.padEnd(9)} rows=${String(c.rows).padStart(5)} (${pct(c.rows, total).padStart(6)})   book-links=${String(c.books).padStart(6)} (${pct(c.books, totalLinks).padStart(6)})`);
  }
  const mappedLinks = totalLinks - (bySource.unmapped?.books ?? 0);
  console.log(`\nCOVERAGE: ${pct(mappedLinks, totalLinks)} of all book-genre links land on a canonical root.`);

  // Distribution of book-links per root (sanity check — are roots balanced?)
  const linksByRoot = new Map<string, number>();
  for (const m of manifest) if (m.root) linksByRoot.set(m.root, (linksByRoot.get(m.root) ?? 0) + m.books);
  console.log(`\nBook-links per root (top 25):`);
  for (const [root, n] of [...linksByRoot.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
    console.log(`  ${String(n).padStart(6)}  ${root}`);
  }

  // Remaining unmapped, by weight
  unmapped.sort((a, b) => b.books - a.books);
  const unmappedHeavy = unmapped.filter((u) => u.books >= 5);
  console.log(`\nUNMAPPED with >=5 books: ${unmappedHeavy.length} (these still need a rule/override)`);
  for (const u of unmappedHeavy.slice(0, 60)) console.log(`  ${String(u.books).padStart(4)}  ${u.name}`);

  mkdirSync("reports", { recursive: true });
  const path = "reports/genre-parent-manifest.json";
  writeFileSync(path, JSON.stringify({ generatedFrom: "local", total, totalLinks, manifest }, null, 2));
  console.log(`\nFull manifest written: ${path}`);
})();
