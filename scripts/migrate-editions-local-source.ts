/**
 * Add local-edition support columns to `editions` (local + Turso).
 *
 * Purely additive ALTER TABLE ADD COLUMN — no table rebuild, so
 * `open_library_key` keeps its NOT NULL UNIQUE constraint and no production
 * table is ever dropped. Non-OpenLibrary editions carry a synthetic
 * `local:<uuid>` key instead; `source` is what tells the two apart.
 *
 * Per the schema rule in CLAUDE.md this must run on Turso BEFORE any code
 * referencing the new columns is deployed.
 *
 *   npx tsx scripts/migrate-editions-local-source.ts          # dry run
 *   npx tsx scripts/migrate-editions-local-source.ts --apply
 */
import { config } from "dotenv";
import { createClient } from "@libsql/client";
import { createGuardedTurso } from "./lib/turso-guard";

config({ path: ".env.local" });
config({ path: ".env.vercel.local" });

const APPLY = process.argv.includes("--apply");

const COLUMNS: { name: string; ddl: string }[] = [
  { name: "source", ddl: "ALTER TABLE editions ADD COLUMN source TEXT NOT NULL DEFAULT 'openlibrary'" },
  { name: "cover_url", ddl: "ALTER TABLE editions ADD COLUMN cover_url TEXT" },
  { name: "format", ddl: "ALTER TABLE editions ADD COLUMN format TEXT" },
  { name: "edition_label", ddl: "ALTER TABLE editions ADD COLUMN edition_label TEXT" },
  { name: "merged_from_book_id", ddl: "ALTER TABLE editions ADD COLUMN merged_from_book_id TEXT" },
];

type Exec = (sql: string) => Promise<{ rows: unknown[] }>;

async function migrate(label: string, exec: Exec) {
  const info = await exec("PRAGMA table_info(editions)");
  const existing = new Set((info.rows as { name: string }[]).map((r) => r.name));

  for (const col of COLUMNS) {
    if (existing.has(col.name)) {
      console.log(`  [${label}] ${col.name} — already present, skipping`);
      continue;
    }
    if (!APPLY) {
      console.log(`  [${label}] ${col.name} — WOULD ADD`);
      continue;
    }
    await exec(col.ddl);
    console.log(`  [${label}] ${col.name} — added`);
  }
}

(async () => {
  console.log(`[migrate-editions] mode=${APPLY ? "APPLY" : "DRY RUN"}`);

  const local = createClient({ url: "file:data/tbra.db" });
  console.log("local:");
  await migrate("local", (sql) => local.execute(sql));

  const { remote } = await createGuardedTurso({
    name: "migrate-editions-local-source",
    maxRuntimeMs: 5 * 60 * 1000,
    queryTimeoutMs: 30_000,
    longRunning: false,
  });
  console.log("turso:");
  await migrate("turso", (sql) => remote.execute(sql));

  console.log(APPLY ? "[migrate-editions] done" : "[migrate-editions] dry run — re-run with --apply");
  process.exit(0);
})();
