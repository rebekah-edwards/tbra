/**
 * Fix remaining beta issues (part 2) — series creation and linking.
 * Part 1 already fixed issues #1-18.
 * This handles #19-22 with proper Turso sync.
 */

import Database from "better-sqlite3";
import { createClient } from "@libsql/client";
import path from "path";
import crypto from "crypto";

const dbPath = path.join(process.cwd(), "data", "tbra.db");
const local = new Database(dbPath);
local.pragma("journal_mode = WAL");

const turso = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

const now = new Date().toISOString().replace("T", " ").slice(0, 19);

function uuid() { return crypto.randomUUID(); }

function generateBookSlug(title: string, authorName: string): string {
  function normalize(str: string): string {
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9\s]/g, "").replace(/\s+/g, " ").trim().toLowerCase().replace(/\s/g, "-");
  }
  const t = normalize(title), a = normalize(authorName);
  return a ? `${t}-${a}` : t;
}

function generateSeriesSlug(seriesName: string, authorName?: string): string {
  function normalize(str: string): string {
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9\s]/g, "").replace(/\s+/g, " ").trim().toLowerCase().replace(/\s/g, "-");
  }
  const n = normalize(seriesName);
  if (!authorName) return n;
  const a = normalize(authorName);
  return a ? `${n}-${a}` : n;
}

async function both(sql: string, params: any[] = []) {
  local.prepare(sql).run(...params);
  await turso.execute({ sql, args: params });
}

async function bothInsertIgnore(sql: string, params: any[] = []) {
  const s = sql.replace("INSERT INTO", "INSERT OR IGNORE INTO");
  local.prepare(s).run(...params);
  await turso.execute({ sql: s, args: params });
}

/** Ensure a series exists on BOTH local and Turso. Returns the ID. */
async function ensureSeries(name: string, slug: string): Promise<string> {
  // Check local
  const localRow = local.prepare(`SELECT id FROM series WHERE name = ? LIMIT 1`).get(name) as any;
  if (localRow) {
    // Ensure it also exists on Turso
    const tursoRow = await turso.execute({ sql: `SELECT id FROM series WHERE id = ?`, args: [localRow.id] });
    if (tursoRow.rows.length === 0) {
      // Create on Turso with same ID
      await turso.execute({
        sql: `INSERT OR IGNORE INTO series (id, name, slug) VALUES (?, ?, ?)`,
        args: [localRow.id, name, slug]
      });
      console.log(`  Synced series "${name}" to Turso (${localRow.id})`);
    }
    return localRow.id;
  }
  // Create on both
  const id = uuid();
  await both(`INSERT INTO series (id, name, slug) VALUES (?, ?, ?)`, [id, name, slug]);
  console.log(`  Created series "${name}" on both (${id})`);
  return id;
}

/** Ensure an author exists on BOTH local and Turso. Returns the ID. */
async function ensureAuthor(name: string, slug: string): Promise<string> {
  const localRow = local.prepare(`SELECT id FROM authors WHERE name = ? LIMIT 1`).get(name) as any;
  if (localRow) {
    const tursoRow = await turso.execute({ sql: `SELECT id FROM authors WHERE id = ?`, args: [localRow.id] });
    if (tursoRow.rows.length === 0) {
      await turso.execute({
        sql: `INSERT OR IGNORE INTO authors (id, name, slug) VALUES (?, ?, ?)`,
        args: [localRow.id, name, slug]
      });
      console.log(`  Synced author "${name}" to Turso (${localRow.id})`);
    }
    return localRow.id;
  }
  const id = uuid();
  await both(`INSERT INTO authors (id, name, slug) VALUES (?, ?, ?)`, [id, name, slug]);
  console.log(`  Created author "${name}" on both (${id})`);
  return id;
}

/** Ensure a book exists on BOTH. Returns the ID. */
async function ensureBook(
  title: string, authorName: string, authorId: string,
  opts: { pages?: number; year?: number; desc?: string; isbn13?: string }
): Promise<string> {
  const localRow = local.prepare(`SELECT id FROM books WHERE title = ? LIMIT 1`).get(title) as any;
  if (localRow) {
    // Ensure on Turso
    const tursoRow = await turso.execute({ sql: `SELECT id FROM books WHERE id = ?`, args: [localRow.id] });
    if (tursoRow.rows.length === 0) {
      const slug = generateBookSlug(title, authorName);
      await turso.execute({
        sql: `INSERT OR IGNORE INTO books (id, title, slug, pages, publication_year, isbn_13, description, summary, is_fiction, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'public', ?, ?)`,
        args: [localRow.id, title, slug, opts.pages ?? null, opts.year ?? null, opts.isbn13 ?? null, opts.desc ?? null, opts.desc ?? null, now, now]
      });
      // Link author on Turso
      await turso.execute({
        sql: `INSERT OR IGNORE INTO book_authors (book_id, author_id, role) VALUES (?, ?, 'author')`,
        args: [localRow.id, authorId]
      });
      console.log(`  Synced book "${title}" to Turso`);
    }
    return localRow.id;
  }
  const id = uuid();
  const slug = generateBookSlug(title, authorName);
  await both(
    `INSERT INTO books (id, title, slug, pages, publication_year, isbn_13, description, summary, is_fiction, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'public', ?, ?)`,
    [id, title, slug, opts.pages ?? null, opts.year ?? null, opts.isbn13 ?? null, opts.desc ?? null, opts.desc ?? null, now, now]
  );
  await bothInsertIgnore(
    `INSERT INTO book_authors (book_id, author_id, role) VALUES (?, ?, 'author')`,
    [id, authorId]
  );
  console.log(`  Created book "${title}" on both`);
  return id;
}

async function main() {
  console.log("=== FIXING REMAINING BETA ISSUES (Part 2) ===\n");

  // ─── #19: RE-ROLL — Create/sync New Realm Online series ───
  console.log("#19: RE-ROLL / New Realm Online series");
  const nroId = await ensureSeries("New Realm Online", generateSeriesSlug("New Realm Online", "Robyn Wideman"));

  // Ensure RE-ROLL book exists on Turso
  const rerollLocal = local.prepare(`SELECT id FROM books WHERE id = '5fb88314-e5b2-479c-9ff7-7cb8f7be9df4'`).get() as any;
  if (rerollLocal) {
    const rerollTurso = await turso.execute({ sql: `SELECT id FROM books WHERE id = ?`, args: [rerollLocal.id] });
    if (rerollTurso.rows.length === 0) {
      // Need to sync RE-ROLL to Turso
      const bookData = local.prepare(`SELECT * FROM books WHERE id = ?`).get(rerollLocal.id) as any;
      await turso.execute({
        sql: `INSERT OR IGNORE INTO books (id, title, slug, pages, publication_year, description, summary, is_fiction, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'public', ?, ?)`,
        args: [bookData.id, bookData.title, bookData.slug, bookData.pages, bookData.publication_year, bookData.description, bookData.summary, now, now]
      });
    }
  }

  await bothInsertIgnore(
    `INSERT INTO book_series (book_id, series_id, position_in_series) VALUES (?, ?, ?)`,
    ["5fb88314-e5b2-479c-9ff7-7cb8f7be9df4", nroId, 1]
  );
  console.log("  Linked RE-ROLL as book 1\n");

  // ─── #20: All the Dust That Falls — add books 2-4 ───
  console.log("#20: All the Dust that Falls series");
  const adtfId = await ensureSeries("All the Dust that Falls", generateSeriesSlug("All the Dust that Falls", "Zaifyr"));
  const zaifyrId = await ensureAuthor("Zaifyr", "zaifyr");

  // Link book 1
  // Ensure book 1 is on Turso
  const adtf1Local = local.prepare(`SELECT id FROM books WHERE id = 'a32d14ad-c884-47f5-9a35-a71dbbd4ada1'`).get() as any;
  if (adtf1Local) {
    const adtf1Turso = await turso.execute({ sql: `SELECT id FROM books WHERE id = ?`, args: [adtf1Local.id] });
    if (adtf1Turso.rows.length === 0) {
      const bd = local.prepare(`SELECT * FROM books WHERE id = ?`).get(adtf1Local.id) as any;
      await turso.execute({
        sql: `INSERT OR IGNORE INTO books (id, title, slug, pages, publication_year, description, summary, is_fiction, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'public', ?, ?)`,
        args: [bd.id, bd.title, bd.slug, bd.pages, bd.publication_year, bd.description, bd.summary, now, now]
      });
      await turso.execute({
        sql: `INSERT OR IGNORE INTO book_authors (book_id, author_id, role) VALUES (?, ?, 'author')`,
        args: [bd.id, zaifyrId]
      });
    }
  }
  await bothInsertIgnore(
    `INSERT INTO book_series (book_id, series_id, position_in_series) VALUES (?, ?, ?)`,
    ["a32d14ad-c884-47f5-9a35-a71dbbd4ada1", adtfId, 1]
  );

  const adtfBooks = [
    { pos: 2, title: "All the Dust that Falls 2", isbn13: "9798878214742", pages: 592, year: 2024 },
    { pos: 3, title: "All the Dust that Falls 3", isbn13: "9798324663957", pages: 618, year: 2024 },
    { pos: 4, title: "All the Dust that Falls 4", isbn13: "9798338396247", pages: 618, year: 2024 },
  ];

  for (const book of adtfBooks) {
    const desc = `Book ${book.pos} in the All the Dust that Falls series, an Isekai LitRPG adventure by Zaifyr. Spot the sentient Roomba vacuum continues its journey, gaining power and allies in a fantasy world while keeping everything spotlessly clean.`;
    const bookId = await ensureBook(book.title, "Zaifyr", zaifyrId, {
      pages: book.pages, year: book.year, isbn13: book.isbn13, desc,
    });
    await bothInsertIgnore(
      `INSERT INTO book_series (book_id, series_id, position_in_series) VALUES (?, ?, ?)`,
      [bookId, adtfId, book.pos]
    );
  }
  console.log("  Added books 2-4 and linked to series\n");

  // ─── #21: Mayor of Noobtown — add missing series books ───
  console.log("#21: Noobtown series");
  const ntId = await ensureSeries("Noobtown", generateSeriesSlug("Noobtown", "Ryan Rimmel"));
  const rimmelId = await ensureAuthor("Ryan Rimmel", "ryan-rimmel");

  // Link existing Mayor of Noobtown as book 1
  const mayorLocal = local.prepare(`SELECT id FROM books WHERE id = '8418f8fd-29fb-4cfe-864f-0814b6c741a5'`).get() as any;
  if (mayorLocal) {
    const mayorTurso = await turso.execute({ sql: `SELECT id FROM books WHERE id = ?`, args: [mayorLocal.id] });
    if (mayorTurso.rows.length === 0) {
      const bd = local.prepare(`SELECT * FROM books WHERE id = ?`).get(mayorLocal.id) as any;
      await turso.execute({
        sql: `INSERT OR IGNORE INTO books (id, title, slug, pages, publication_year, description, summary, is_fiction, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'public', ?, ?)`,
        args: [bd.id, bd.title, bd.slug, bd.pages, bd.publication_year, bd.description, bd.summary, now, now]
      });
      await turso.execute({
        sql: `INSERT OR IGNORE INTO book_authors (book_id, author_id, role) VALUES (?, ?, 'author')`,
        args: [bd.id, rimmelId]
      });
    }
  }
  await bothInsertIgnore(
    `INSERT INTO book_series (book_id, series_id, position_in_series) VALUES (?, ?, ?)`,
    ["8418f8fd-29fb-4cfe-864f-0814b6c741a5", ntId, 1]
  );

  const noobBooks = [
    { pos: 2, title: "Village of Noobtown", year: 2019 },
    { pos: 3, title: "Castle of the Noobs", year: 2020 },
    { pos: 4, title: "Dungeons and Noobs", year: 2020 },
    { pos: 5, title: "Noob Game Plus", year: 2021 },
    { pos: 6, title: "Nautical Noobs", year: 2021 },
    { pos: 7, title: "Tower of the Noobs", year: 2022 },
    { pos: 8, title: "The War of the Noobs", year: 2024 },
  ];

  for (const book of noobBooks) {
    const desc = `Book ${book.pos} in the Noobtown LitRPG series by Ryan Rimmel. Jim has been isekai'd into a new world as the Mayor of Noobtown, and must build, battle, and level his way through an increasingly dangerous fantasy realm.`;
    const bookId = await ensureBook(book.title, "Ryan Rimmel", rimmelId, {
      year: book.year, desc,
    });
    await bothInsertIgnore(
      `INSERT INTO book_series (book_id, series_id, position_in_series) VALUES (?, ?, ?)`,
      [bookId, ntId, book.pos]
    );
  }
  console.log("  Added books 2-8 and linked to series\n");

  // ─── Mark reported_issues as resolved ───
  console.log("=== Marking reported_issues as resolved ===");
  await both(
    `UPDATE reported_issues SET status = 'resolved', resolution = ?, resolved_at = ? WHERE id = ?`,
    ["Added full Noobtown series (books 2-8) and linked Mayor of Noobtown as book 1", now, "fb5f2af4-5d58-45a0-b8dd-4abef99f609a"]
  );
  await both(
    `UPDATE reported_issues SET status = 'resolved', resolution = ?, resolved_at = ? WHERE id = ?`,
    ["Created All the Dust that Falls series, added books 2-4", now, "ed0d6444-0f0c-469f-a98e-480003bdde91"]
  );
  console.log("  Resolved 2 series issues. Feature request stays 'noted'.\n");

  console.log("=== PART 2 COMPLETE ===");
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
