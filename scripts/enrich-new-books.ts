/**
 * Enrich the stub books created by fix-series-batch.ts (covers/descriptions/
 * ISBNs/genres) and normalize their slugs to the title-author convention.
 * Runs against Turso (@/db resolves to Turso when TURSO_DATABASE_URL is set).
 */
require("dotenv").config({ path: ".env.vercel.local" });
import { db } from "../src/db";
import { books, bookAuthors, authors } from "../src/db/schema";
import { eq, and, ne } from "drizzle-orm";
import { enrichBook } from "../src/lib/enrichment/enrich-book";
import * as fs from "fs";

const slugify = (s:string)=>s.normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-zA-Z0-9\s]/g,"").replace(/\s+/g," ").trim().toLowerCase().replace(/\s/g,"-");

(async () => {
  const ids = fs.readFileSync("/tmp/new-book-ids.txt","utf8").split("\n").map(s=>s.trim()).filter(Boolean);
  console.log(`Enriching ${ids.length} new books...`);
  let ok=0, fail=0;
  for (const id of ids) {
    const bk = await db.query.books.findFirst({ where: eq(books.id, id) });
    if (!bk) { console.log(`  ${id}: gone, skip`); continue; }
    // slug → title-author
    const au = await db.select({ name: authors.name }).from(bookAuthors).innerJoin(authors, eq(bookAuthors.authorId, authors.id)).where(eq(bookAuthors.bookId, id)).get();
    const base = slugify(`${bk.title} ${au?.name ?? ""}`);
    let slug = base, i = 1;
    while (await db.query.books.findFirst({ where: and(eq(books.slug, slug), ne(books.id, id)) })) { i++; slug = `${base}-${i}`; }
    if (slug !== bk.slug) await db.update(books).set({ slug }).where(eq(books.id, id));
    try { await enrichBook(id); ok++; console.log(`  ✓ ${bk.title} [${slug}]`); }
    catch (e:any) { fail++; console.log(`  ✗ ${bk.title}: ${e?.message?.slice(0,60)}`); }
  }
  console.log(`\nDone: ${ok} enriched, ${fail} failed.`);
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
