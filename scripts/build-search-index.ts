/**
 * Build (or rebuild) the FTS5 search index on both local SQLite and Turso.
 *
 * Creates the `search_index` virtual table if it doesn't exist, then
 * populates it from the books + book_authors + book_series tables. Safe
 * to rerun — drops and rebuilds the content each time.
 *
 * Usage:
 *   cd /Users/clankeredwards/claude/tbra
 *   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npx tsx scripts/build-search-index.ts
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

async function build(db: DbLike) {
  console.log(`\n╭─ Building search index on ${db.label}`);

  // Drop and recreate to ensure clean state
  await db.exec(`DROP TABLE IF EXISTS search_index`);
  await db.exec(`
    CREATE VIRTUAL TABLE search_index USING fts5(
      book_id UNINDEXED,
      title,
      author_names,
      series_name,
      tokenize='porter unicode61'
    )
  `);
  console.log(`│  ✓ search_index table created`);

  // Populate — one big INSERT from a JOIN that collects authors + series per book.
  // We use GROUP_CONCAT to flatten multiple authors/series into space-separated strings.
  // Only include public, non-box-set books.
  const startMs = Date.now();
  await db.exec(`
    INSERT INTO search_index (book_id, title, author_names, series_name)
    SELECT
      b.id,
      b.title,
      COALESCE(
        (SELECT GROUP_CONCAT(a.name, ' ')
         FROM book_authors ba
         INNER JOIN authors a ON ba.author_id = a.id
         WHERE ba.book_id = b.id),
        ''
      ),
      COALESCE(
        (SELECT GROUP_CONCAT(s.name, ' ')
         FROM book_series bs
         INNER JOIN series s ON bs.series_id = s.id
         WHERE bs.book_id = b.id),
        ''
      )
    FROM books b
    WHERE b.visibility = 'public'
      AND b.is_box_set = 0
  `);
  const elapsedMs = Date.now() - startMs;

  // Count rows
  const countResult = await db.exec(`SELECT COUNT(*) AS cnt FROM search_index`);
  const count = countResult.rows[0]?.cnt ?? 0;

  console.log(`│  ✓ Populated ${count} books in ${elapsedMs}ms`);

  // Quick sanity test
  const test = await db.exec(
    `SELECT book_id, title, rank FROM search_index WHERE search_index MATCH 'piranesi' ORDER BY rank LIMIT 3`,
  );
  if (test.rows.length > 0) {
    console.log(`│  ✓ Sanity test: "piranesi" → "${test.rows[0].title}" (rank ${test.rows[0].rank})`);
  } else {
    console.log(`│  ⚠ Sanity test: "piranesi" returned 0 results`);
  }

  console.log(`╰─ ${db.label} done\n`);
}

async function main() {
  const localDbPath = path.resolve(
    process.cwd(),
    process.cwd().endsWith("tbra") ? "data/tbra.db" : "claude/tbra/data/tbra.db",
  );
  const localRaw = new Database(localDbPath);
  await build(wrapLocal(localRaw));

  const tursoUrl = process.env.TURSO_DATABASE_URL;
  const tursoToken = process.env.TURSO_AUTH_TOKEN;
  if (tursoUrl && tursoToken) {
    const tursoClient = createClient({ url: tursoUrl, authToken: tursoToken });
    await build(wrapRemote(tursoClient));
  } else {
    console.warn("TURSO_* not set — local only");
  }
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
