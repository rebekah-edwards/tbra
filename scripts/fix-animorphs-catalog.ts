/**
 * Animorphs catalog cleanup (2026-11-16). Idempotent; local first, then Turso
 * (so a later sync-push cannot resurrect what was hidden).
 *
 *  1. Link the two missing main-series books (stubs already in the catalog):
 *     The Journey → Animorphs #42, The Sacrifice → Animorphs #52.
 *  2. #27 The Exposed: import_only → public, prod title "Animorphs - The
 *     Exposed" → "The Exposed" (title drift; sync-push never pushes titles).
 *  3. Animorphs Graphix: number the ISBN-bearing rows (#2 Visitor, #3
 *     Encounter, #4 Message), link the #5/#6 stubs, and HIDE the two
 *     scrape-titled duplicates of #2/#3 (zero user rows on both DBs — hidden,
 *     not deleted, per the safe-merge recipe).
 *  4. Chronicles + Graphix become sub-series of Animorphs (like Megamorphs).
 *  5. Delete the empty duplicate series "Animorphs Graphic Novels".
 *
 *  6. (--promote, run AFTER the four stubs are enriched via the prod trigger)
 *     give the stubs slugs and make them public on both DBs.
 *
 * Usage: npx tsx scripts/fix-animorphs-catalog.ts [--apply] [--promote]
 */
import { config } from "dotenv";
config({ path: ".env.vercel.local" });

import { createClient, type Client } from "@libsql/client";
import { createGuardedTurso } from "./lib/turso-guard";

const APPLY = process.argv.includes("--apply");
const PROMOTE = process.argv.includes("--promote");

// Enriched stubs → [bookId, slug]
const STUBS: [string, string][] = [
  ["30ddf952-8e00-4106-8a95-e1372d64e894", "the-journey-katherine-applegate"],
  ["32a9ef64-5e22-41b6-8627-c533f5263250", "the-sacrifice-katherine-applegate"],
  ["e28752b5-9421-435b-af6d-d1830374b9ac", "predator-animorphs-graphix-5-katherine-applegate"],
  ["345c704e-9aaa-4811-9f2f-a63d486970fa", "capture-animorphs-graphix-6-katherine-applegate"],
];

const ANIMORPHS = "1617b532-4396-4bf6-a51b-5b3e7e0b286f";
const CHRONICLES = "3f7a26f4-3317-4c68-8e1f-185b88ff1e76";
const GRAPHIX = "db129d9b-15dc-467e-8ab3-e77b7658be56";
const EMPTY_SERIES = "ce65ee26-fe44-4395-bc82-f652344d6239"; // "Animorphs Graphic Novels"

const EXPOSED = "b639afcb-74db-4cdd-9839-91c689eef115";

// [bookId, seriesId, position]
const LINKS: [string, string, number][] = [
  ["30ddf952-8e00-4106-8a95-e1372d64e894", ANIMORPHS, 42], // The Journey
  ["32a9ef64-5e22-41b6-8627-c533f5263250", ANIMORPHS, 52], // The Sacrifice
  ["6432ed65-216e-4b9e-bd56-8356928c4c5d", GRAPHIX, 2], // Animorphs Graphix - The Visitor
  ["2cade2b2-15c1-4433-b9b5-ab26cdc6fe32", GRAPHIX, 3], // The Encounter - Animorphs Graphix #3
  ["2ea1f4da-b2f0-4fe4-ab55-28ea10b5c8dd", GRAPHIX, 4], // The Message - Animorphs Graphix #4
  ["e28752b5-9421-435b-af6d-d1830374b9ac", GRAPHIX, 5], // Predator (Animorphs Graphix #5)
  ["345c704e-9aaa-4811-9f2f-a63d486970fa", GRAPHIX, 6], // Capture (Animorphs Graphix #6)
];

// Scrape-titled duplicates of Graphix #2 / #3 — hide + unlink.
const HIDE = [
  "a08cb65f-9b41-48ba-ae45-5dc0e48e6df4", // The Visitor: The Graphic Novel
  "9c5a34c5-58d3-4354-9a7c-442554377ad0", // The Encounter (3) (Animorphs Graphic Novels): Applegate, …
];

const USER_TABLES = [
  "user_book_state", "user_book_ratings", "user_book_reviews", "user_favorite_books",
  "up_next", "reading_sessions", "reading_notes", "tbr_notes", "shelf_books", "user_owned_editions",
];

async function run(db: Client, label: string) {
  const exec = async (sql: string, args: any[] = []) => {
    if (!APPLY) { console.log(`  [dry ${label}] ${sql.replace(/\s+/g, " ").slice(0, 110)} ${JSON.stringify(args)}`); return; }
    const r = await db.execute({ sql, args });
    console.log(`  [${label}] ${r.rowsAffected} row(s): ${sql.replace(/\s+/g, " ").slice(0, 90)}`);
  };
  const one = async (sql: string, args: any[] = []) => (await db.execute({ sql, args })).rows[0] as any;
  const tables = new Set((await db.execute("SELECT name FROM sqlite_master WHERE type='table'")).rows.map((r: any) => r.name));

  // Guard: the rows being hidden must carry no user data on THIS database.
  for (const id of HIDE) {
    for (const t of USER_TABLES) {
      if (!tables.has(t)) continue;
      const n = Number((await one(`SELECT COUNT(*) n FROM ${t} WHERE book_id=?`, [id])).n);
      if (n > 0) throw new Error(`[${label}] ${id} has ${n} row(s) in ${t} — refusing to hide; needs a hand merge`);
    }
  }
  // Guard: every book + series we touch must exist here.
  for (const [bookId] of LINKS) {
    if (!(await one("SELECT id FROM books WHERE id=?", [bookId]))) throw new Error(`[${label}] book ${bookId} missing`);
  }

  // 1 + 3. series links / positions
  for (const [bookId, seriesId, pos] of LINKS) {
    const existing = await one("SELECT position_in_series p FROM book_series WHERE book_id=? AND series_id=?", [bookId, seriesId]);
    if (!existing) {
      await exec("INSERT INTO book_series (book_id, series_id, position_in_series) VALUES (?,?,?)", [bookId, seriesId, pos]);
    } else if (Number(existing.p) !== pos) {
      await exec("UPDATE book_series SET position_in_series=? WHERE book_id=? AND series_id=?", [pos, bookId, seriesId]);
    }
  }

  // 2. The Exposed
  await exec("UPDATE books SET visibility='public', title='The Exposed', updated_at=datetime('now') WHERE id=? AND (visibility!='public' OR title!='The Exposed')", [EXPOSED]);

  // 3. hide the duplicates
  for (const id of HIDE) {
    await exec("DELETE FROM book_series WHERE book_id=? AND series_id=?", [id, GRAPHIX]);
    await exec("UPDATE books SET visibility='import_only', updated_at=datetime('now') WHERE id=? AND visibility!='import_only'", [id]);
  }

  // 4. sub-series of Animorphs
  await exec("UPDATE series SET parent_series_id=? WHERE id IN (?,?) AND parent_series_id IS NULL", [ANIMORPHS, CHRONICLES, GRAPHIX]);

  // 5. empty duplicate series
  const inUse = Number((await one("SELECT COUNT(*) n FROM book_series WHERE series_id=?", [EMPTY_SERIES])).n)
    + Number((await one("SELECT COUNT(*) n FROM series WHERE parent_series_id=?", [EMPTY_SERIES])).n)
    + Number((await one("SELECT COUNT(*) n FROM reported_issues WHERE series_id=?", [EMPTY_SERIES])).n);
  if (inUse === 0) await exec("DELETE FROM series WHERE id=?", [EMPTY_SERIES]);
  else console.log(`  [${label}] empty series still referenced (${inUse}) — left in place`);
}

(async () => {
  console.log(APPLY ? "APPLYING" : "DRY RUN (pass --apply)");
  const local = createClient({ url: "file:data/tbra.db" });
  const { remote } = await createGuardedTurso({
    name: "fix-animorphs-catalog",
    maxRuntimeMs: 5 * 60 * 1000,
    queryTimeoutMs: 30_000,
  });
  if (PROMOTE) {
    const r = remote as unknown as Client;
    for (const [id, slug] of STUBS) {
      const rated = Number(((await r.execute({ sql: "SELECT COUNT(*) n FROM book_category_ratings WHERE book_id=?", args: [id] })).rows[0] as any).n);
      if (rated === 0) { console.log(`  skip ${slug}: not enriched on Turso yet`); continue; }
      for (const [db, label] of [[local, "local"], [r, "turso"]] as [Client, string][]) {
        const clash = (await db.execute({ sql: "SELECT id FROM books WHERE slug=? AND id!=?", args: [slug, id] })).rows[0];
        if (clash) throw new Error(`[${label}] slug ${slug} already used by ${(clash as any).id}`);
      }
      for (const [db, label] of [[local, "local"], [r, "turso"]] as [Client, string][]) {
        if (!APPLY) { console.log(`  [dry ${label}] promote ${slug}`); continue; }
        const res = await db.execute({
          sql: "UPDATE books SET slug=COALESCE(slug, ?), visibility='public', updated_at=datetime('now') WHERE id=?",
          args: [slug, id],
        });
        console.log(`  [${label}] ${res.rowsAffected} row(s): promote ${slug}`);
      }
    }
    process.exit(0);
  }
  console.log("── local");
  await run(local, "local");
  console.log("── turso");
  await run(remote as unknown as Client, "turso");
  process.exit(0);
})();
