/**
 * fix-malformed-slugs — task 5 of the 2026-11 indexing fix.
 *
 * Finds book and author slugs that start with "-", contain "--" or end in "-"
 * and gives them a well-formed one. Every old slug is recorded so the old URL
 * 301s to the new one (book_slug_history / author_redirects, both read by
 * src/middleware.ts), on Turso AND the local sqlite.
 *
 * Where they came from:
 *   - leading "-": generateBookSlug() emptied a Hebrew/Cyrillic/Japanese title
 *     and produced "-author" (fixed in src/lib/utils/slugify.ts the same day);
 *   - trailing "-": an old importer cut slugs at 80 chars mid-word;
 *   - "--": a title containing " - ".
 *
 * Series are covered too (since 2026-11-19, via series_redirects). Run the
 * series part only once that table exists and the middleware that reads it
 * is deployed — otherwise the old series URLs 404.
 *
 *   npx tsx scripts/fix-malformed-slugs.ts [--local=path/to/tbra.db]          # dry run
 *   npx tsx scripts/fix-malformed-slugs.ts [--local=...] --apply
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.vercel.local" });

import Database from "better-sqlite3";
import { createGuardedTurso } from "./lib/turso-guard";
import { generateAuthorSlug, generateBookSlug, generateSeriesSlug } from "../src/lib/utils/slugify";

const APPLY = process.argv.includes("--apply");
const LOCAL_PATH = process.argv.find((a) => a.startsWith("--local="))?.slice(8) ?? "data/tbra.db";
const MAX_LEN = 80;
const MALFORMED = `(slug LIKE '-%' OR slug LIKE '%--%' OR slug LIKE '%-')`;

/** Cut to MAX_LEN at a word boundary, keeping the author part whole. */
function fit(title: string, author: string): string {
  const full = generateBookSlug(title, author);
  if (full.length <= MAX_LEN) return full;
  const authorPart = generateBookSlug("x", author).slice(2); // "" when no author
  const room = MAX_LEN - (authorPart ? authorPart.length + 1 : 0);
  const titlePart = generateBookSlug(title, "");
  let cut = titlePart.slice(0, Math.max(room, 20));
  if (titlePart.length > cut.length && titlePart[cut.length] !== "-") cut = cut.slice(0, cut.lastIndexOf("-"));
  cut = cut.replace(/-+$/, "");
  return authorPart ? `${cut}-${authorPart}` : cut;
}

const clean = (s: string) => s.replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "");

(async () => {
  const local = new Database(LOCAL_PATH);
  const { remote, shutdown } = await createGuardedTurso({
    name: "fix-malformed-slugs",
    maxRuntimeMs: 20 * 60 * 1000,
    queryTimeoutMs: 60_000,
  });

  const taken = async (table: "books" | "authors" | "series", slug: string, selfId: string) => {
    const l = local.prepare(`SELECT id FROM ${table} WHERE slug = ?`).get(slug) as { id: string } | undefined;
    const t = (await remote.execute({ sql: `SELECT id FROM ${table} WHERE slug = ?`, args: [slug] })).rows[0];
    const histTable =
      table === "books" ? "book_slug_history WHERE old_slug"
      : table === "authors" ? "author_redirects WHERE old_key"
      : "series_redirects WHERE old_key";
    const h = (await remote.execute({ sql: `SELECT 1 FROM ${histTable} = ?`, args: [slug] })).rows[0];
    return (!!l && l.id !== selfId) || (!!t && String(t.id) !== selfId) || !!h;
  };

  // ── Books ──
  const books = (
    await remote.execute(`
      SELECT b.id, b.slug, b.title,
        (SELECT a.name FROM book_authors ba JOIN authors a ON a.id = ba.author_id
          WHERE ba.book_id = b.id ORDER BY (ba.role = 'author') DESC, a.name LIMIT 1) AS author
      FROM books b WHERE ${MALFORMED.replace(/slug/g, "b.slug")}`)
  ).rows;

  let renamed = 0;
  for (const b of books) {
    const id = String(b.id);
    const oldSlug = String(b.slug);
    const base = clean(fit(String(b.title ?? ""), String(b.author ?? ""))) || "untitled";
    let slug = base;
    for (let n = 2; await taken("books", slug, id); n++) slug = `${base}-${n}`;
    if (slug === oldSlug) continue;
    console.log(`book   ${oldSlug}  ->  ${slug}`);
    renamed++;
    if (!APPLY) continue;

    const ts = new Date().toISOString();
    await remote.execute({
      sql: "INSERT OR IGNORE INTO book_slug_history (old_slug, book_id, reason) VALUES (?,?,?)",
      args: [oldSlug, id, "malformed-slug"],
    });
    await remote.execute({ sql: "UPDATE books SET slug = ?, updated_at = ? WHERE id = ? AND slug = ?", args: [slug, ts, id, oldSlug] });
    local.prepare("INSERT OR IGNORE INTO book_slug_history (old_slug, book_id, reason) VALUES (?,?,?)").run(oldSlug, id, "malformed-slug");
    local.prepare("UPDATE books SET slug = ?, updated_at = ? WHERE id = ? AND slug = ?").run(slug, ts, id, oldSlug);
  }

  // ── Authors ──
  const authors = (await remote.execute(`SELECT id, slug, name FROM authors WHERE ${MALFORMED}`)).rows;
  let authorsRenamed = 0;
  for (const a of authors) {
    const id = String(a.id);
    const oldSlug = String(a.slug);
    const base = clean(generateAuthorSlug(String(a.name ?? ""))) || "unknown-author";
    let slug = base;
    for (let n = 2; await taken("authors", slug, id); n++) slug = `${base}-${n}`;
    if (slug === oldSlug) continue;
    console.log(`author ${oldSlug}  ->  ${slug}`);
    authorsRenamed++;
    if (!APPLY) continue;

    await remote.execute({
      sql: "INSERT OR IGNORE INTO author_redirects (old_key, author_id, reason) VALUES (?,?,?)",
      args: [oldSlug, id, "malformed-slug"],
    });
    await remote.execute({ sql: "UPDATE authors SET slug = ? WHERE id = ? AND slug = ?", args: [slug, id, oldSlug] });
    local.prepare("INSERT OR IGNORE INTO author_redirects (old_key, author_id, reason) VALUES (?,?,?)").run(oldSlug, id, "malformed-slug");
    local.prepare("UPDATE authors SET slug = ? WHERE id = ? AND slug = ?").run(slug, id, oldSlug);
  }

  // ── Series ── (series_redirects exists since 2026-11-19; middleware 301s it)
  const seriesRows = (await remote.execute(`SELECT id, slug, name FROM series WHERE ${MALFORMED}`)).rows;
  let seriesRenamed = 0;
  for (const s of seriesRows) {
    const id = String(s.id);
    const oldSlug = String(s.slug);
    const base = clean(generateSeriesSlug(String(s.name ?? ""))) || "untitled-series";
    let slug = base;
    for (let n = 2; await taken("series", slug, id); n++) slug = `${base}-${n}`;
    if (slug === oldSlug) continue;
    console.log(`series ${oldSlug}  ->  ${slug}`);
    seriesRenamed++;
    if (!APPLY) continue;

    await remote.execute({
      sql: "INSERT OR IGNORE INTO series_redirects (old_key, series_id, reason) VALUES (?,?,?)",
      args: [oldSlug, id, "malformed-slug"],
    });
    await remote.execute({ sql: "UPDATE series SET slug = ? WHERE id = ? AND slug = ?", args: [slug, id, oldSlug] });
    local.prepare("INSERT OR IGNORE INTO series_redirects (old_key, series_id, reason) VALUES (?,?,?)").run(oldSlug, id, "malformed-slug");
    local.prepare("UPDATE series SET slug = ? WHERE id = ? AND slug = ?").run(slug, id, oldSlug);
  }

  console.log(`\n${APPLY ? "renamed" : "would rename"}: ${renamed} books, ${authorsRenamed} authors, ${seriesRenamed} series`);
  if (!APPLY) console.log("DRY RUN — add --apply");
  shutdown();
  process.exit(0);
})();
