/**
 * One-off: attach Levi Lusko as the author of "Blessed Are the Spiraling"
 * (book 01695e9e-4758-422c-a4f5-eaf7b1830b8a), fix its slug to the standard
 * title-author form, and clear the needs_review flag. Dual-writes Turso +
 * local (sync-push never writes slug/needs_review on existing books).
 *
 * Author verified via Google Books: "Blessed Are the Spiraling", Levi Lusko, 2025.
 */
import Database from "better-sqlite3";
import path from "path";
import { randomUUID } from "crypto";
import { createGuardedTurso } from "./lib/turso-guard";

// eslint-disable-next-line @typescript-eslint/no-require-imports
require("dotenv").config({ path: ".env.vercel.local" });

const BOOK_ID = "01695e9e-4758-422c-a4f5-eaf7b1830b8a";
const AUTHOR_NAME = "Levi Lusko";
const AUTHOR_SLUG = "levi-lusko";
const NEW_BOOK_SLUG = "blessed-are-the-spiraling-levi-lusko";

(async () => {
  const { remote } = await createGuardedTurso({
    name: "fix-blessed-spiraling",
    maxRuntimeMs: 5 * 60 * 1000,
    queryTimeoutMs: 60_000,
  });
  const local = new Database(path.join(process.cwd(), "data", "tbra.db"));

  // Reuse an existing author row if either side already has him
  const turAuthor = await remote.execute({
    sql: `SELECT id FROM authors WHERE name = ? OR slug = ?`,
    args: [AUTHOR_NAME, AUTHOR_SLUG],
  });
  const locAuthor = local
    .prepare(`SELECT id FROM authors WHERE name = ? OR slug = ?`)
    .get(AUTHOR_NAME, AUTHOR_SLUG) as { id: string } | undefined;
  const authorId =
    (turAuthor.rows[0]?.id as string | undefined) ?? locAuthor?.id ?? randomUUID();
  console.log(`Author id: ${authorId} (turso=${!!turAuthor.rows[0]}, local=${!!locAuthor})`);

  // Slug collision guard on both sides
  const slugTaken = await remote.execute({
    sql: `SELECT id FROM books WHERE slug = ? AND id != ?`,
    args: [NEW_BOOK_SLUG, BOOK_ID],
  });
  if (slugTaken.rows.length) throw new Error(`slug ${NEW_BOOK_SLUG} already taken on Turso`);

  // Turso writes
  await remote.execute({
    sql: `INSERT OR IGNORE INTO authors (id, name, slug) VALUES (?, ?, ?)`,
    args: [authorId, AUTHOR_NAME, AUTHOR_SLUG],
  });
  await remote.execute({
    sql: `INSERT OR IGNORE INTO book_authors (book_id, author_id, role) VALUES (?, ?, 'author')`,
    args: [BOOK_ID, authorId],
  });
  await remote.execute({
    sql: `UPDATE books SET slug = ?, needs_review = 0, review_reason = NULL WHERE id = ?`,
    args: [NEW_BOOK_SLUG, BOOK_ID],
  });

  // Local writes
  local.prepare(`INSERT OR IGNORE INTO authors (id, name, slug) VALUES (?, ?, ?)`).run(authorId, AUTHOR_NAME, AUTHOR_SLUG);
  local.prepare(`INSERT OR IGNORE INTO book_authors (book_id, author_id, role) VALUES (?, ?, 'author')`).run(BOOK_ID, authorId);
  local.prepare(`UPDATE books SET slug = ?, needs_review = 0, review_reason = NULL WHERE id = ?`).run(NEW_BOOK_SLUG, BOOK_ID);

  const verify = await remote.execute({
    sql: `SELECT b.slug, b.needs_review, a.name FROM books b
          LEFT JOIN book_authors ba ON ba.book_id = b.id
          LEFT JOIN authors a ON a.id = ba.author_id WHERE b.id = ?`,
    args: [BOOK_ID],
  });
  console.log("Turso verify:", JSON.stringify(verify.rows[0]));
  local.close();
  process.exit(0);
})();
