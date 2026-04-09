/**
 * Second-pass fixes for reported issues. Corrects mistakes from pass 1
 * and handles items the DB research agent found that pass 1 missed.
 *
 * Runs against both local + Turso.
 */

import { createClient, type Client } from "@libsql/client";
import Database from "better-sqlite3";
import path from "path";

interface DbLike {
  label: string;
  exec(sql: string, args?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

function wrapLocal(db: Database.Database): DbLike {
  return {
    label: "local",
    async exec(sql: string, args: unknown[] = []) {
      if (sql.trim().toUpperCase().startsWith("SELECT")) {
        return { rows: db.prepare(sql).all(...(args as never[])) as Record<string, unknown>[] };
      }
      db.prepare(sql).run(...(args as never[]));
      return { rows: [] };
    },
  };
}

function wrapRemote(client: Client): DbLike {
  return {
    label: "turso",
    async exec(sql: string, args: unknown[] = []) {
      const res = await client.execute({ sql, args: args as (string | number | null)[] });
      return { rows: res.rows.map((r) => ({ ...r } as unknown as Record<string, unknown>)) };
    },
  };
}

async function migrate(db: DbLike) {
  console.log(`\n╭─ Pass 2 fixes on ${db.label}`);

  // 1. REVERT Hell's Heart — I wrongly replaced the Star Trek description
  // with an Alexis Hall blurb. The book IS a Star Trek novel by John Jackson
  // Miller. The Alexis Hall "Hell's Heart" is a completely different book.
  await db.exec(
    `UPDATE books SET description = ?, summary = ? WHERE slug = 'hells-heart'`,
    [
      "When Klingon commander Kruge died in combat against James T. Kirk on the Genesis planet back in 2285, he left behind a powerful house in disarray and a series of ticking time bombs. Now, one hundred years later, Captain Jean-Luc Picard and the crew of the USS Enterprise are snared in a trap and thrust directly in the middle of an ancient conflict.",
      "When Klingon commander Kruge died in combat, he left behind a powerful house in disarray. Now, one hundred years later, Picard and the Enterprise crew are thrust into the middle of an ancient Klingon conflict.",
    ],
  );
  // Also add the correct author: John Jackson Miller
  const hhBook = await db.exec(`SELECT id FROM books WHERE slug = 'hells-heart'`);
  if (hhBook.rows.length > 0) {
    const bookId = hhBook.rows[0].id as string;
    // Find or create John Jackson Miller
    let jjm = await db.exec(`SELECT id FROM authors WHERE name = 'John Jackson Miller'`);
    if (jjm.rows.length === 0) {
      const id = crypto.randomUUID();
      await db.exec(`INSERT INTO authors (id, name, slug) VALUES (?, 'John Jackson Miller', 'john-jackson-miller')`, [id]);
      jjm = { rows: [{ id }] };
    }
    // Check if already linked
    const existing = await db.exec(
      `SELECT 1 FROM book_authors WHERE book_id = ? AND author_id = ?`,
      [bookId, jjm.rows[0].id],
    );
    if (existing.rows.length === 0) {
      await db.exec(
        `INSERT INTO book_authors (book_id, author_id, role) VALUES (?, ?, 'author')`,
        [bookId, jjm.rows[0].id],
      );
    }
  }
  console.log(`│  ✓ Hell's Heart: reverted to Star Trek description + added John Jackson Miller`);

  // 2. Piranesi — year is 2015 (wrong), should be 2020
  await db.exec(
    `UPDATE books SET publication_year = 2020 WHERE slug = 'piranesi' AND (publication_year IS NULL OR publication_year != 2020)`,
  );
  console.log(`│  ✓ Piranesi: year fixed to 2020`);

  // 3. Worlds to Come — author should be Damon Knight (editor), not Heinlein
  const wcBook = await db.exec(`SELECT id FROM books WHERE slug = 'worlds-to-come-robert-a-heinlein'`);
  if (wcBook.rows.length > 0) {
    const bookId = wcBook.rows[0].id as string;
    // Remove all existing authors
    await db.exec(`DELETE FROM book_authors WHERE book_id = ?`, [bookId]);
    // Find or create Damon Knight
    let dk = await db.exec(`SELECT id FROM authors WHERE name = 'Damon Knight'`);
    if (dk.rows.length === 0) {
      const id = crypto.randomUUID();
      await db.exec(`INSERT INTO authors (id, name, slug) VALUES (?, 'Damon Knight', 'damon-knight')`, [id]);
      dk = { rows: [{ id }] };
    }
    await db.exec(
      `INSERT INTO book_authors (book_id, author_id, role) VALUES (?, ?, 'editor')`,
      [bookId, dk.rows[0].id],
    );
    // Clear needsReview flag since data is now complete
    await db.exec(`UPDATE books SET needs_review = 0 WHERE id = ?`, [bookId]);
    console.log(`│  ✓ Worlds to Come: author changed to Damon Knight (editor)`);
  }

  // 4. Gorp — author name inverted: "Ross, Dave" → "Dave Ross"
  const gorpAuthors = await db.exec(
    `SELECT ba.author_id, a.name FROM book_authors ba INNER JOIN authors a ON ba.author_id = a.id INNER JOIN books b ON ba.book_id = b.id WHERE b.slug = 'gorp-and-the-jelly-sippers-ross-dave'`,
  );
  for (const row of gorpAuthors.rows) {
    if ((row.name as string) === "Ross, Dave") {
      await db.exec(`UPDATE authors SET name = 'Dave Ross' WHERE id = ?`, [row.author_id]);
      console.log(`│  ✓ Gorp: author name fixed to "Dave Ross"`);
    }
  }

  // 5. Can I Say That? — add author Brenna Blain
  const cisBook = await db.exec(`SELECT id FROM books WHERE title LIKE 'Can I Say That%'`);
  if (cisBook.rows.length > 0) {
    const bookId = cisBook.rows[0].id as string;
    const existingAuthors = await db.exec(
      `SELECT COUNT(*) AS cnt FROM book_authors WHERE book_id = ?`, [bookId],
    );
    if ((existingAuthors.rows[0].cnt as number) === 0) {
      let bb = await db.exec(`SELECT id FROM authors WHERE name = 'Brenna Blain'`);
      if (bb.rows.length === 0) {
        const id = crypto.randomUUID();
        await db.exec(`INSERT INTO authors (id, name, slug) VALUES (?, 'Brenna Blain', 'brenna-blain')`, [id]);
        bb = { rows: [{ id }] };
      }
      await db.exec(
        `INSERT INTO book_authors (book_id, author_id, role) VALUES (?, ?, 'author')`,
        [bookId, bb.rows[0].id],
      );
      console.log(`│  ✓ Can I Say That?: added author Brenna Blain`);
    }
  }

  // 6. BadAsstronauts — has Spanish ISBN (978-84 prefix). Hide the Spanish
  // edition; the English version would need a separate entry.
  await db.exec(
    `UPDATE books SET visibility = 'import_only', language = 'Spanish' WHERE slug = 'badasstronauts-grady-hendrix'`,
  );
  console.log(`│  ✓ BadAsstronauts: marked as Spanish edition + hidden`);

  // 7. Anatomy of an Alibi — generate slug
  await db.exec(
    `UPDATE books SET slug = 'anatomy-of-an-alibi-ashley-elston', language = 'English' WHERE title LIKE 'Anatomy of an Alibi%' AND (slug IS NULL OR slug = '')`,
  );
  console.log(`│  ✓ Anatomy of an Alibi: slug assigned`);

  // 8. Final Weapon — cleaner description
  await db.exec(
    `UPDATE books SET description = ?, summary = ? WHERE slug = 'final-weapon-everett-b-cole'`,
    [
      "In a dystopian society governed by strict military hierarchy, a district leader encounters a newly invented telepathy device that threatens to upend the regime's control over communication and power. A classic science fiction novella by Everett B. Cole.",
      "A district leader encounters a newly invented telepathy device that threatens to upend the regime's control over communication and power.",
    ],
  );
  console.log(`│  ✓ Final Weapon: description cleaned up`);

  // 9. Black Sun parenthetical duplicate — hide it (may already be hidden)
  await db.exec(
    `UPDATE books SET visibility = 'import_only' WHERE title LIKE 'Black Sun (Between Earth and Sky%'`,
  );
  console.log(`│  ✓ Black Sun: duplicate hidden`);

  console.log(`╰─ ${db.label} done\n`);
}

async function main() {
  const localDbPath = path.resolve(
    process.cwd(),
    process.cwd().endsWith("tbra") ? "data/tbra.db" : "claude/tbra/data/tbra.db",
  );
  const localRaw = new Database(localDbPath);
  await migrate(wrapLocal(localRaw));

  const tursoUrl = process.env.TURSO_DATABASE_URL;
  const tursoToken = process.env.TURSO_AUTH_TOKEN;
  if (tursoUrl && tursoToken) {
    await migrate(wrapRemote(createClient({ url: tursoUrl, authToken: tursoToken })));
  }
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
