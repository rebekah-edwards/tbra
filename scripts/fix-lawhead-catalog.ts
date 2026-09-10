/**
 * fix-lawhead-catalog.ts — repairs the Stephen R. Lawhead author listing.
 *
 * Filed via reported_issues: "Stephen Lawhead's author listing is woefully
 * incomplete. Please look through and ensure all series include all books and
 * have no obvious metadata errors."
 *
 * Bibliography verified against Wikipedia (en.wikipedia.org/wiki/Stephen_R._Lawhead)
 * on 2026-09-10.
 *
 * Three phases, all idempotent, all dual-written (local mirror first, then Turso):
 *   1. ATTACH  — existing English books that were never linked to their series.
 *   2. UNHIDE  — books hidden despite being verified English canon (title + year
 *                + page count all match). Some were hidden because they carry a
 *                foreign ISBN; the ISBN is the error, not the book.
 *   3. CREATE  — canonical volumes missing from the catalogue entirely.
 *
 * Deliberately NOT touched (left for manual review — see the nightly triage note):
 *   - The Empyrion records ("Empyrion I"/"Empyrion II"), which do not map cleanly
 *     onto The Search for Fierra / The Siege of Dome.
 *   - Foreign-language editions with corrupted titles ("Robin,", "Will,",
 *     "KNOOP ZONDER EINDE, DE     Albion3", "Merlin / The Pendragon Cycle").
 *     These stay hidden; they are only detached from English series slots.
 *   - Aurelia (2025), whose position in the Pendragon Cycle is ambiguous.
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env.vercel.local" });

import { type Client } from "@libsql/client";
import Database from "better-sqlite3";
import path from "path";
import { createGuardedTurso } from "./lib/turso-guard";

const APPLY = process.argv.includes("--apply");
const AUTHOR = "Stephen R. Lawhead";

// ─── DB abstraction (same pattern as add-series-books-batch.ts) ───

interface DbLike {
  label: string;
  exec(sql: string, args?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

function wrapLocal(db: Database.Database): DbLike {
  return {
    label: "local",
    async exec(sql: string, args: unknown[] = []) {
      const isSelect = sql.trim().toUpperCase().startsWith("SELECT");
      const stmt = db.prepare(sql);
      if (isSelect) return { rows: stmt.all(...(args as never[])) as Record<string, unknown>[] };
      stmt.run(...(args as never[]));
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

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ─── What to fix ───

/**
 * Series that must exist before anything can be attached to them. Note that an
 * unrelated "Dragon Kings" series already exists for a different author — series
 * lookup is exact-match precisely so we create Lawhead's rather than reuse it.
 */
const NEW_SERIES: { id: string; name: string }[] = [
  { id: "1abcdef0-0000-4000-8000-0000000000a1", name: "The Dragon King" },
];

/** Existing books to link to a series at a verified position. Matched by exact title. */
const ATTACH: { title: string; series: string; position: number }[] = [
  { title: "In the Hall of the Dragon King", series: "The Dragon King", position: 1 },
  { title: "The Sword and the Flame", series: "The Dragon King", position: 3 },
  { title: "Silver Hand", series: "The Song of Albion", position: 2 },
  { title: "Endless Knot", series: "The Song of Albion", position: 3 },
  { title: "The Mystic Rose Book the Celtic Crusades Book III", series: "The Celtic Crusades", position: 3 },
  { title: "In the Land of the Everliving", series: "Eirlandia", position: 2 },
];

/** Titles to correct on existing rows (import artefacts). */
const RETITLE: { from: string; to: string }[] = [
  { from: "The Mystic Rose Book the Celtic Crusades Book III", to: "The Mystic Rose" },
];

/**
 * Hidden rows verified as English canon — title, year and page count all match
 * the published English edition. Safe to surface.
 */
const UNHIDE = [
  "Arthur",
  "Pendragon",
  "The Iron Lance",
  "In the Kingdom of All Tomorrows",
];

/** Foreign editions squatting an English series slot. Detach only — never delete. */
const DETACH: { title: string; series: string }[] = [
  { title: "Robin,", series: "King Raven" },
  { title: "KNOOP ZONDER EINDE, DE     Albion3", series: "The Song of Albion" },
];

/** Canonical volumes absent from the catalogue. Deterministic ids => rerun-safe. */
const CREATE: {
  id: string;
  title: string;
  year: number;
  series: string | null;
  position: number | null;
  description: string;
}[] = [
  {
    id: "1abcdef0-0000-4000-8000-000000000001",
    title: "Hood",
    year: 2006,
    series: "King Raven",
    position: 1,
    description:
      "The first book of the King Raven trilogy retells the Robin Hood legend, moving it from Sherwood Forest to the Welsh March under Norman occupation, where a dispossessed prince becomes the outlaw the people call Rhi Bran y Hud.",
  },
  {
    id: "1abcdef0-0000-4000-8000-000000000002",
    title: "The Warlords of Nin",
    year: 1983,
    series: "The Dragon King",
    position: 2,
    description:
      "The second book of the Dragon King trilogy. As a merciless warlord sweeps across the land, Quentin must take up an ancient quest and forge the sword that alone can stand against the coming darkness.",
  },
  {
    id: "1abcdef0-0000-4000-8000-000000000003",
    title: "Avalon",
    year: 1999,
    series: "The Pendragon Cycle",
    position: 6,
    description:
      "The concluding volume of the Pendragon Cycle. In a near-future Britain that has abolished its monarchy, a young officer discovers he is the rightful heir to the throne, and the Arthurian promise of a king's return is put to the test.",
  },
  {
    id: "1abcdef0-0000-4000-8000-000000000004",
    title: "Patrick: Son of Ireland",
    year: 2003,
    series: null,
    position: null,
    description:
      "A standalone novel reimagining the life of Saint Patrick, from his capture as a Briton slave boy through his years in Ireland and Gaul to the calling that would return him to the island of his bondage.",
  },
];

// ─── Lookup helpers, scoped to this author only ───

async function authorId(db: DbLike): Promise<string> {
  const r = await db.exec(`SELECT id FROM authors WHERE name = ? COLLATE NOCASE`, [AUTHOR]);
  if (r.rows.length === 0) throw new Error(`author "${AUTHOR}" not found on ${db.label}`);
  return r.rows[0].id as string;
}

/** Find one of this author's books by exact title. Returns null if absent or ambiguous. */
async function findBook(db: DbLike, aid: string, title: string): Promise<string | null> {
  const r = await db.exec(
    `SELECT b.id FROM books b
       JOIN book_authors ba ON ba.book_id = b.id
      WHERE ba.author_id = ? AND b.title = ? COLLATE NOCASE`,
    [aid, title],
  );
  if (r.rows.length === 0) return null;
  if (r.rows.length > 1) {
    console.log(`   !  "${title}" is ambiguous on ${db.label} (${r.rows.length} rows) — skipped`);
    return null;
  }
  return r.rows[0].id as string;
}

async function findSeries(db: DbLike, name: string): Promise<string | null> {
  const r = await db.exec(`SELECT id FROM series WHERE name = ? COLLATE NOCASE`, [name]);
  return r.rows.length > 0 ? (r.rows[0].id as string) : null;
}

// ─── Phases ───

async function run(db: DbLike) {
  console.log(`\n══ [${db.label}] ${APPLY ? "APPLY" : "DRY RUN"} ══`);
  const aid = await authorId(db);

  // 0. Create any series that don't exist yet
  console.log(`\n-- ensure series --`);
  for (const s of NEW_SERIES) {
    if (await findSeries(db, s.name)) {
      console.log(`   =  series "${s.name}" exists`);
      continue;
    }
    console.log(`   +  create series "${s.name}"`);
    if (APPLY) {
      await db.exec(`INSERT INTO series (id, name, slug) VALUES (?, ?, ?)`, [
        s.id,
        s.name,
        slugify(s.name),
      ]);
    }
  }

  // 1. ATTACH
  console.log(`\n-- attach to series --`);
  for (const a of ATTACH) {
    const bid = await findBook(db, aid, a.title);
    if (!bid) {
      console.log(`   ?  "${a.title}" not found — skipped`);
      continue;
    }
    const sid = await findSeries(db, a.series);
    if (!sid) {
      console.log(`   ?  series "${a.series}" not found — skipped`);
      continue;
    }
    const existing = await db.exec(
      `SELECT position_in_series AS pos FROM book_series WHERE book_id = ? AND series_id = ?`,
      [bid, sid],
    );
    if (existing.rows.length > 0) {
      if (Number(existing.rows[0].pos) === a.position) {
        console.log(`   =  "${a.title}" already ${a.series} #${a.position}`);
        continue;
      }
      console.log(`   ~  "${a.title}": ${a.series} #${existing.rows[0].pos} -> #${a.position}`);
      if (APPLY) {
        await db.exec(
          `UPDATE book_series SET position_in_series = ? WHERE book_id = ? AND series_id = ?`,
          [a.position, bid, sid],
        );
      }
      continue;
    }
    console.log(`   +  "${a.title}" -> ${a.series} #${a.position}`);
    if (APPLY) {
      await db.exec(
        `INSERT INTO book_series (book_id, series_id, position_in_series) VALUES (?, ?, ?)`,
        [bid, sid, a.position],
      );
    }
  }

  // 2. RETITLE
  console.log(`\n-- retitle --`);
  for (const t of RETITLE) {
    const bid = await findBook(db, aid, t.from);
    if (!bid) {
      console.log(`   =  "${t.from}" not present (already renamed?)`);
      continue;
    }
    console.log(`   ~  "${t.from}" -> "${t.to}"`);
    if (APPLY) {
      await db.exec(
        `UPDATE books SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [t.to, bid],
      );
    }
  }

  // 3. DETACH foreign editions from English slots
  console.log(`\n-- detach foreign editions --`);
  for (const d of DETACH) {
    const bid = await findBook(db, aid, d.title);
    const sid = await findSeries(db, d.series);
    if (!bid || !sid) {
      console.log(`   =  "${d.title}" / ${d.series} not present — skipped`);
      continue;
    }
    const link = await db.exec(
      `SELECT position_in_series AS pos FROM book_series WHERE book_id = ? AND series_id = ?`,
      [bid, sid],
    );
    if (link.rows.length === 0) {
      console.log(`   =  "${d.title}" already detached from ${d.series}`);
      continue;
    }
    // Never orphan user data — verify nobody has shelved it.
    const users = await db.exec(
      `SELECT COUNT(*) AS n FROM user_book_state WHERE book_id = ?`,
      [bid],
    );
    if (Number(users.rows[0].n) > 0) {
      console.log(`   !  "${d.title}" has ${users.rows[0].n} user rows — left attached`);
      continue;
    }
    console.log(`   -  "${d.title}" detached from ${d.series} #${link.rows[0].pos}`);
    if (APPLY) {
      await db.exec(`DELETE FROM book_series WHERE book_id = ? AND series_id = ?`, [bid, sid]);
    }
  }

  // 4. UNHIDE verified English canon
  console.log(`\n-- unhide verified canon --`);
  for (const title of UNHIDE) {
    const bid = await findBook(db, aid, title);
    if (!bid) {
      console.log(`   ?  "${title}" not found — skipped`);
      continue;
    }
    const cur = await db.exec(`SELECT visibility FROM books WHERE id = ?`, [bid]);
    const vis = cur.rows[0].visibility as string;
    if (vis === "public") {
      console.log(`   =  "${title}" already public`);
      continue;
    }
    console.log(`   ~  "${title}": ${vis} -> public`);
    if (APPLY) {
      await db.exec(
        `UPDATE books SET visibility = 'public', needs_review = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [bid],
      );
    }
  }

  // 5. CREATE missing canon
  console.log(`\n-- create missing volumes --`);
  for (const c of CREATE) {
    const existing = await findBook(db, aid, c.title);
    if (existing) {
      console.log(`   =  "${c.title}" already exists (${existing.slice(0, 8)})`);
      continue;
    }
    const byId = await db.exec(`SELECT id FROM books WHERE id = ?`, [c.id]);
    if (byId.rows.length > 0) {
      console.log(`   =  "${c.title}" already exists by id`);
      continue;
    }
    const slug = slugify(`${c.title} ${AUTHOR}`);
    const clash = await db.exec(`SELECT id FROM books WHERE slug = ?`, [slug]);
    if (clash.rows.length > 0) {
      console.log(`   !  slug "${slug}" already taken — skipping "${c.title}"`);
      continue;
    }
    console.log(`   +  CREATE "${c.title}" (${c.year})${c.series ? ` — ${c.series} #${c.position}` : " — standalone"}`);
    if (!APPLY) continue;

    await db.exec(
      `INSERT INTO books (id, title, slug, description, publication_year, language, is_fiction, visibility)
       VALUES (?, ?, ?, ?, ?, 'English', 1, 'public')`,
      [c.id, c.title, slug, c.description, c.year],
    );
    await db.exec(
      `INSERT OR IGNORE INTO book_authors (book_id, author_id, role) VALUES (?, ?, 'author')`,
      [c.id, aid],
    );
    if (c.series && c.position != null) {
      const sid = await findSeries(db, c.series);
      if (sid) {
        await db.exec(
          `INSERT INTO book_series (book_id, series_id, position_in_series) VALUES (?, ?, ?)`,
          [c.id, sid, c.position],
        );
      } else {
        console.log(`      !  series "${c.series}" missing — book created unlinked`);
      }
    }
    if (db.label === "turso") created.push(c.id);
  }
}

const created: string[] = [];

async function triggerEnrichment(ids: string[]) {
  if (ids.length === 0) return;
  const secret = process.env.ENRICHMENT_SECRET;
  if (!secret) {
    console.log(`\n!! ENRICHMENT_SECRET not set — enrich these manually: ${ids.join(", ")}`);
    return;
  }
  console.log(`\n-- enriching ${ids.length} new books --`);
  for (const id of ids) {
    try {
      const res = await fetch("https://www.thebasedreader.app/api/enrichment/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-enrichment-secret": secret },
        body: JSON.stringify({ bookId: id }),
      });
      console.log(`   ${id.slice(0, 8)}: ${res.status} ${(await res.text()).slice(0, 80)}`);
    } catch (err) {
      console.error(`   ${id.slice(0, 8)}: FAILED`, err);
    }
  }
}

async function main() {
  const localPath = path.resolve(process.cwd(), "data/tbra.db");
  const local = wrapLocal(new Database(localPath));
  await run(local);

  if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
    console.warn("\nTURSO_* not set — local only, NOT in sync");
    return;
  }
  const { remote, shutdown } = await createGuardedTurso({
    name: "fix-lawhead-catalog",
    maxRuntimeMs: 10 * 60 * 1000,
    queryTimeoutMs: 30_000,
  });
  try {
    await run(wrapRemote(remote));
    if (APPLY) await triggerEnrichment(created);
  } finally {
    shutdown();
  }

  console.log(APPLY ? "\nDone." : "\nDry run only — rerun with --apply");
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
