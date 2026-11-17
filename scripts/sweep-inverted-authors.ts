/**
 * Sweep the catalogue for author rows stored "Last, First" (and the related
 * junk that rides in on the same comma) and fix them on BOTH databases.
 *
 *   npx tsx scripts/sweep-inverted-authors.ts            # dry run: prints the plan
 *   npx tsx scripts/sweep-inverted-authors.ts --apply    # local sqlite + Turso + Meilisearch
 *   npx tsx scripts/sweep-inverted-authors.ts --apply --limit=20
 *
 * What it does to a row, decided by src/lib/text/author-name.ts:
 *
 *   RENAME  "Yarros, Rebecca" → "Rebecca Yarros" when no such author exists yet.
 *   MERGE   the same, when "Rebecca Yarros" already exists: the inverted row's
 *           book links and follows move onto the existing row, then it is removed.
 *   SPLIT   "Agatha Christie, Sophie Hannah" (a StoryGraph import artefact) into
 *           one link per person. Only when every piece is plainly a full name.
 *   SPACES  "Amy    Wallace" → "Amy Wallace" (rename, or merge into the clean
 *           row). Needed because the shared lookup now collapses whitespace:
 *           left alone, the next import of that author would not match the
 *           padded row and would mint a duplicate.
 *   LEAVE   anything ambiguous — listed under "Left for a human".
 *
 * Safety:
 *   - One plan, built from local, verified row-by-row against Turso. A row
 *     whose name differs between the two is skipped and reported, not guessed.
 *   - Rows are MOVED with `UPDATE ... SET author_id = ?`. Collisions (a book
 *     already linked to both rows) are removed explicitly first — the link is
 *     (book, author, role) with no other data, so nothing is lost. Never
 *     INSERT-OR-IGNORE + DELETE (memory: project_dedup_move_destroyed_ratings).
 *   - Applied per author, local first then Turso, so sync-push (which pushes
 *     local authors missing on Turso) can never resurrect a removed row.
 *   - Every removed id and retired slug is recorded in `author_redirects`, so
 *     old links and the iOS app's cached author ids keep resolving.
 *   - Turso goes through createGuardedTurso. Deletes are a few hundred author
 *     rows in total, one author per statement — far under the 1,000-row bar.
 *
 * Idempotent: a second run finds nothing left to do.
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.vercel.local" });
dotenv.config({ path: ".env.local" });

import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { InStatement } from "@libsql/client";
import { createGuardedTurso } from "./lib/turso-guard";
import { analyzeAuthorName, authorNameKey, splitAuthorList } from "../src/lib/text/author-name";

const APPLY = process.argv.includes("--apply");
const LIMIT = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 0) || Infinity;
const SKIP_MEILI = process.argv.includes("--no-meili");

/**
 * Hand decisions for names the rules cannot get right. Key = the stored name.
 * A string is the corrected name; `null` means leave the row alone (it is then
 * listed under "Left for a human" with the note below).
 */
const OVERRIDES: Record<string, string | null> = {
  // "First, Last" — a stray comma in natural order, not an inversion.
  "Anne, McElvoy": "Anne McElvoy",
  "Markus, Wolf": "Markus Wolf",
  "Beverly, LaHote Schwind": "Beverly LaHote Schwind",
  // Family name comes first in these names and is conventionally kept there.
  "Soe, Hok Gie.": "Soe Hok Gie",
  "Li, Hongzhi": "Li Hongzhi",
  // Honorific is not part of the name.
  "Weaver, Mr. Travis James": "Travis James Weaver",
  "Malkmus, George, H.": "George H. Malkmus",
  "Morris, Heather teacher.": "Heather Morris",
  // Not confidently one thing or the other — leave for a human.
  "Wesley, B Jarvis": null,
  "Tevagah, Matt Dinniman": null,
  "Dani Sabia, D Sabia, D Sabia": null,
};

// ── types ──────────────────────────────────────────────────────────────────

interface AuthorRow {
  id: string;
  name: string;
  slug: string | null;
  bio: string | null;
  open_library_key: string | null;
}

type Step =
  /** Rename `id` in place. `newSlug` undefined = leave slug untouched. */
  | { op: "rename"; id: string; to: string; oldSlug: string | null; newSlug?: string | null }
  /** Move everything from `from` onto `into`, then remove `from`. */
  | { op: "merge"; from: string; into: string; fromSlug: string | null }
  /** Create a new author row (same id on both databases). */
  | { op: "create"; id: string; name: string }
  /** Link every book `source` WAS linked to (captured before the item ran) to `author`. */
  | { op: "link"; author: string };

interface Item {
  kind: "rename" | "merge" | "split";
  sourceId: string;
  sourceName: string;
  /** Human description of the outcome. */
  result: string;
  note?: string;
  steps: Step[];
  /** Author ids that still exist afterwards and were touched (for Meilisearch). */
  touched: string[];
  /** The only thing wrong was stray whitespace ("Amy    Wallace"). */
  spaces?: boolean;
  /** Turso already holds the corrected name — fix local only. */
  localOnly?: boolean;
}

interface Declined {
  id: string;
  name: string;
  books: number;
  reason: string;
}

// ── helpers ────────────────────────────────────────────────────────────────

/** Mirror of generateAuthorSlug() in src/lib/utils/slugify.ts (that module opens a DB on import). */
function authorSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\s/g, "-");
}

const RANK_WORDS = new Set([
  "lieut", "lt", "capt", "captain", "col", "colonel", "gen", "general", "sgt", "major", "rev",
  "reverend", "dr", "mr", "mrs", "ms", "miss", "prof", "professor", "sir", "lord", "lady", "dame",
  "saint", "bishop", "pope", "father", "brother", "sister", "duke", "prince", "princess", "king", "queen",
]);
const PARTICLE = /^(de|del|della|der|den|di|da|dos|du|la|le|van|von|ter|ten|bin|ibn|al|el|y)$/i;
const WORD = /^\p{Lu}[\p{L}\p{M}'’.\-]*$/u;
const INITIALISH = /^(?:\p{Lu}\.?|(?:\p{Lu}\.){2,}|\p{Lu}{1,2}\.)$/u;

/** Is this piece of a comma-joined string plainly one person's full name? */
function looksLikeFullName(part: string): boolean {
  const toks = part.split(" ").filter(Boolean);
  if (toks.length < 2 || toks.length > 5) return false;
  if (!toks.every((t) => WORD.test(t) || PARTICLE.test(t))) return false;
  const first = toks[0].replace(/\./g, "").toLowerCase();
  if (RANK_WORDS.has(first)) return false;
  const last = toks[toks.length - 1];
  const lastBare = last.replace(/\./g, "");
  const suffix = /^(jr|sr|ii|iii|iv)$/i.test(lastBare);
  const surname = suffix ? toks[toks.length - 2] : last;
  if (INITIALISH.test(surname) || [...surname.replace(/[^\p{L}]/gu, "")].length < 2) return false;
  // At least one real word, not just initials.
  if (!toks.some((t) => !INITIALISH.test(t) && [...t.replace(/[^\p{L}]/gu, "")].length >= 3)) return false;
  // And the piece must not itself need fixing.
  return analyzeAuthorName(part).action === "unchanged";
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

// ── plan ───────────────────────────────────────────────────────────────────

function buildPlan(
  authors: AuthorRow[],
  bookCount: Map<string, number>,
): { items: Item[]; declined: Declined[]; untouched: Declined[] } {
  const byId = new Map(authors.map((a) => [a.id, { ...a }]));
  const byKey = new Map<string, Set<string>>();
  const slugOwner = new Map<string, string>();
  const index = (a: AuthorRow) => {
    const k = authorNameKey(a.name);
    if (!k) return;
    if (!byKey.has(k)) byKey.set(k, new Set());
    byKey.get(k)!.add(a.id);
  };
  const unindex = (a: AuthorRow) => byKey.get(authorNameKey(a.name))?.delete(a.id);
  for (const a of byId.values()) {
    index(a);
    if (a.slug) slugOwner.set(a.slug, a.id);
  }
  const books = (id: string) => bookCount.get(id) ?? 0;

  /** Existing author with the same name (loosely), preferring an exact spelling, then the busiest row. */
  const findTwin = (name: string, exclude: string): AuthorRow | null => {
    const ids = [...(byKey.get(authorNameKey(name)) ?? [])].filter((id) => id !== exclude);
    if (!ids.length) return null;
    const rows = ids.map((id) => byId.get(id)!).filter(Boolean);
    rows.sort(
      (a, b) =>
        Number(b.name === name) - Number(a.name === name) ||
        Number(!b.name.includes(",")) - Number(!a.name.includes(",")) ||
        books(b.id) - books(a.id) ||
        a.id.localeCompare(b.id),
    );
    return rows[0] ?? null;
  };

  // Candidates: every row the normaliser would change or declines, plus overrides.
  const candidates = authors
    .map((a) => ({ row: a, analysis: analyzeAuthorName(a.name) }))
    .filter(({ row, analysis }) => row.name in OVERRIDES || analysis.action !== "unchanged" || analysis.name !== row.name)
    .sort((a, b) => a.row.name.localeCompare(b.row.name) || a.row.id.localeCompare(b.row.id));

  // Keys that some candidate will be renamed TO — used by the "First, Last" guard.
  const targetKeys = new Map<string, string>();
  for (const { row, analysis } of candidates) {
    const t = row.name in OVERRIDES ? OVERRIDES[row.name] : analysis.action === "declined" ? null : analysis.name;
    if (t) targetKeys.set(row.id, authorNameKey(t));
  }

  const items: Item[] = [];
  const declined: Declined[] = [];
  const untouched: Declined[] = [];

  /** Move `row` to the name `target`: merge into a twin if one exists, else rename. Returns the surviving id. */
  const renameOrMerge = (row: AuthorRow, target: string, steps: Step[]): { id: string; merged: boolean } => {
    const twin = findTwin(target, row.id);
    if (twin) {
      steps.push({ op: "merge", from: row.id, into: twin.id, fromSlug: row.slug });
      // The surviving row keeps its own spelling ("C.S. Silverne") unless it is
      // shouting ("I. GRAHAM. SMITH") or padded — then it takes the clean one.
      const letters = twin.name.replace(/[^\p{L}]/gu, "");
      const shouting = letters.length > 3 && letters === letters.toUpperCase() && letters !== letters.toLowerCase();
      if (twin.name !== target && (shouting || /\s{2,}/.test(twin.name) || twin.name !== twin.name.trim())) {
        steps.push({ op: "rename", id: twin.id, to: target, oldSlug: twin.slug });
        twin.name = target;
      }
      if (row.slug) slugOwner.set(row.slug, twin.id);
      bookCount.set(twin.id, books(twin.id) + books(row.id));
      unindex(row);
      byId.delete(row.id);
      return { id: twin.id, merged: true };
    }
    const step: Step = { op: "rename", id: row.id, to: target, oldSlug: row.slug };
    if (row.slug) {
      const want = authorSlug(target);
      const owner = slugOwner.get(want);
      if (want && want !== row.slug && (!owner || owner === row.id)) {
        step.newSlug = want;
        slugOwner.set(want, row.id);
      }
    }
    steps.push(step);
    unindex(row);
    row.name = target;
    if (step.newSlug) row.slug = step.newSlug;
    index(row);
    return { id: row.id, merged: false };
  };

  for (const { row: original, analysis } of candidates) {
    if (items.length >= LIMIT) break;
    const row = byId.get(original.id);
    if (!row) continue;
    const n = books(row.id);
    const overridden = row.name in OVERRIDES;
    const override = overridden ? OVERRIDES[row.name] : undefined;

    if (override === null) {
      declined.push({ id: row.id, name: row.name, books: n, reason: "held by hand: not confidently one thing or the other" });
      continue;
    }

    // ── a single corrected name ──
    const target = typeof override === "string" ? override : analysis.action !== "declined" ? analysis.name : null;
    if (target && target !== row.name) {
      if (!overridden && analysis.action === "flipped") {
        // Guard 1: "Markus, Wolf" might be "First, Last". If the natural-order
        // reading is, or is about to be, an author, do not guess.
        // (Only natural-order rows count as evidence — a second inverted copy
        // of the same person, "Orlando, Steve" twice, is not.)
        const naive = authorNameKey(row.name.replace(/\([^)]*\)/g, " ").replace(/\d+/g, " "));
        const naiveExisting = [...(byKey.get(naive) ?? [])].filter(
          (id) => id !== row.id && !byId.get(id)?.name.includes(","),
        );
        const naiveProjected = [...targetKeys.entries()].some(([id, k]) => id !== row.id && k === naive);
        const twin = findTwin(target, row.id);
        if ((naiveExisting.length || naiveProjected) && !twin) {
          declined.push({
            id: row.id, name: row.name, books: n,
            reason: `could be "First, Last": an author named like "${row.name.replace(/\s*,\s*/, " ")}" also exists`,
          });
          continue;
        }
        // Guard 2: "Tevagah, Matt Dinniman" — the part after the comma is
        // already an author in its own right, so this is probably two people.
        const given = row.name.split(",").slice(1).join(",").replace(/\([^)]*\)/g, "").trim();
        if (given.split(" ").filter(Boolean).length >= 2 && !twin && findTwin(given, row.id)) {
          declined.push({
            id: row.id, name: row.name, books: n,
            reason: `"${given}" is already an author on its own — may be two people`,
          });
          continue;
        }
      }
      const steps: Step[] = [];
      const out = renameOrMerge(row, target, steps);
      items.push({
        kind: out.merged ? "merge" : "rename",
        sourceId: original.id,
        sourceName: original.name,
        result: out.merged ? `${target}  (existing row "${byId.get(out.id)!.name}")` : target,
        note: overridden ? "hand override" : analysis.reason,
        steps,
        touched: [out.id],
        ...(!overridden && analysis.action === "unchanged" ? { spaces: true } : {}),
      });
      continue;
    }

    if (analysis.action !== "declined") continue;

    // ── several people in one row ──
    const splittable = ["multiple-authors", "repeated-word", "unrecognised-shape"].includes(analysis.reason ?? "");
    const parts = splittable && !/[;/&\[\]()\d|]/.test(row.name) ? splitAuthorList(row.name, { commaSeparated: true }) : [];
    if (parts.length >= 2 && parts.length <= 4 && parts.every(looksLikeFullName)) {
      const steps: Step[] = [];
      const touched: string[] = [];
      // First person: reuse this row (rename) or fold into their existing row.
      const first = renameOrMerge(row, parts[0], steps);
      touched.push(first.id);
      for (const part of parts.slice(1)) {
        const existing = findTwin(part, "");
        let id = existing?.id;
        if (!id) {
          id = crypto.randomUUID();
          const created: AuthorRow = { id, name: part, slug: null, bio: null, open_library_key: null };
          byId.set(id, created);
          index(created);
          steps.push({ op: "create", id, name: part });
        }
        steps.push({ op: "link", author: id });
        bookCount.set(id, books(id) + n);
        touched.push(id);
      }
      items.push({
        kind: "split",
        sourceId: original.id,
        sourceName: original.name,
        result: parts.join("  +  "),
        steps,
        touched,
      });
      continue;
    }

    (n > 0 ? declined : untouched).push({
      id: row.id, name: row.name, books: n,
      reason:
        analysis.reason === "organisation" ? "organisation, not a person"
        : analysis.reason === "title-or-phrase" ? "title or descriptive phrase"
        : analysis.reason === "trailing-title" ? "title after the given name (Lady/Lord…)"
        : analysis.reason === "separator-or-non-name-characters" ? "several names joined with ; / & or brackets"
        : parts.length > 4 ? `${parts.length} names in one row (cast list?)`
        : "several names, not all plainly full names",
    });
  }

  return { items, declined, untouched };
}

// ── apply: local ───────────────────────────────────────────────────────────

const CREATE_REDIRECTS = `CREATE TABLE IF NOT EXISTS author_redirects (
  old_key TEXT PRIMARY KEY NOT NULL,
  author_id TEXT NOT NULL REFERENCES authors(id),
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;
const CREATE_REDIRECTS_IDX = `CREATE INDEX IF NOT EXISTS author_redirects_author ON author_redirects(author_id)`;

/** The SQL for one item. Identical text on both databases; `links` are the source's (book, role) pairs. */
function statementsFor(item: Item, links: { book_id: string; role: string }[]): { sql: string; args: (string | null)[] }[] {
  const out: { sql: string; args: (string | null)[] }[] = [];
  for (const s of item.steps) {
    if (s.op === "rename") {
      if (s.newSlug !== undefined) {
        out.push({ sql: `UPDATE authors SET name = ?, slug = ? WHERE id = ?`, args: [s.to, s.newSlug, s.id] });
        if (s.oldSlug && s.oldSlug !== s.newSlug) {
          out.push({
            sql: `INSERT INTO author_redirects (old_key, author_id, reason) VALUES (?, ?, 'rename')
                  ON CONFLICT(old_key) DO UPDATE SET author_id = excluded.author_id, reason = excluded.reason`,
            args: [s.oldSlug, s.id],
          });
        }
      } else {
        out.push({ sql: `UPDATE authors SET name = ? WHERE id = ?`, args: [s.to, s.id] });
      }
    } else if (s.op === "merge") {
      // 1. Collisions: a book already linked to BOTH rows in the same role. The
      //    link carries no other data, so the duplicate is simply removed.
      out.push({
        sql: `DELETE FROM book_authors WHERE author_id = ? AND EXISTS (
                SELECT 1 FROM book_authors t WHERE t.book_id = book_authors.book_id AND t.author_id = ? AND t.role = book_authors.role)`,
        args: [s.from, s.into],
      });
      // 2. Everything else MOVES.
      out.push({ sql: `UPDATE book_authors SET author_id = ? WHERE author_id = ?`, args: [s.into, s.from] });
      // 3. Follows: same shape (unique on user + author).
      out.push({
        sql: `DELETE FROM author_follows WHERE author_id = ? AND EXISTS (
                SELECT 1 FROM author_follows t WHERE t.user_id = author_follows.user_id AND t.author_id = ?)`,
        args: [s.from, s.into],
      });
      out.push({ sql: `UPDATE author_follows SET author_id = ? WHERE author_id = ?`, args: [s.into, s.from] });
      // 4. Keep any bio / OL key the surviving row lacks.
      out.push({
        sql: `UPDATE authors SET
                bio = COALESCE(NULLIF(bio, ''), (SELECT bio FROM authors WHERE id = ?)),
                open_library_key = COALESCE(NULLIF(open_library_key, ''), (SELECT open_library_key FROM authors WHERE id = ?))
              WHERE id = ?`,
        args: [s.from, s.from, s.into],
      });
      // 5. Old id + slug keep resolving; earlier redirects follow the row.
      out.push({ sql: `UPDATE author_redirects SET author_id = ? WHERE author_id = ?`, args: [s.into, s.from] });
      for (const key of [s.from, s.fromSlug]) {
        if (!key) continue;
        out.push({
          sql: `INSERT INTO author_redirects (old_key, author_id, reason) VALUES (?, ?, 'merge')
                ON CONFLICT(old_key) DO UPDATE SET author_id = excluded.author_id, reason = excluded.reason`,
          args: [key, s.into],
        });
      }
      // 6. Remove the emptied row.
      out.push({ sql: `DELETE FROM authors WHERE id = ?`, args: [s.from] });
    } else if (s.op === "create") {
      out.push({ sql: `INSERT OR IGNORE INTO authors (id, name) VALUES (?, ?)`, args: [s.id, s.name] });
    } else if (s.op === "link") {
      // New links for a co-author — additive, so OR IGNORE is correct here.
      for (const l of links) {
        out.push({
          sql: `INSERT OR IGNORE INTO book_authors (book_id, author_id, role) VALUES (?, ?, ?)`,
          args: [l.book_id, s.author, l.role],
        });
      }
    }
  }
  return out;
}

/** After an item: the removed row is gone and owns nothing. Throws if not. */
function removedIds(item: Item): string[] {
  return item.steps.filter((s): s is Extract<Step, { op: "merge" }> => s.op === "merge").map((s) => s.from);
}

// ── main ───────────────────────────────────────────────────────────────────

(async () => {
  const local = new Database(path.join(process.cwd(), "data", "tbra.db"));
  local.pragma("busy_timeout = 15000");
  local.pragma("foreign_keys = ON");

  const { remote, heartbeat } = await createGuardedTurso({
    name: "sweep-inverted-authors",
    maxRuntimeMs: 40 * 60 * 1000,
    queryTimeoutMs: 30_000,
  });

  const loadTurso = async (): Promise<Map<string, AuthorRow>> => {
    const out = new Map<string, AuthorRow>();
    let last = "";
    for (;;) {
      const r = await remote.execute({
        sql: `SELECT id, name, slug, bio, open_library_key FROM authors WHERE id > ? ORDER BY id LIMIT 5000`,
        args: [last],
      });
      if (!r.rows.length) break;
      for (const x of r.rows) out.set(String(x.id), x as unknown as AuthorRow);
      last = String(r.rows[r.rows.length - 1].id);
    }
    return out;
  };
  const commaCount = (rows: Iterable<AuthorRow>) => {
    let n = 0;
    for (const r of rows) if (r.name.includes(",")) n++;
    return n;
  };
  const invertedCount = (rows: Iterable<AuthorRow>) => {
    let n = 0;
    for (const r of rows) if (analyzeAuthorName(r.name).action === "flipped") n++;
    return n;
  };

  const localAuthors = local.prepare(`SELECT id, name, slug, bio, open_library_key FROM authors`).all() as AuthorRow[];
  const tursoAuthors = await loadTurso();
  const bookCount = new Map<string, number>(
    (local.prepare(`SELECT author_id, COUNT(*) n FROM book_authors GROUP BY author_id`).all() as { author_id: string; n: number }[])
      .map((r) => [r.author_id, r.n]),
  );
  const originalBooks = new Map(bookCount);

  console.log(`\n=== Author-name sweep (${APPLY ? "APPLY" : "dry run"}) ===`);
  console.log(`              authors   with a comma   inverted "Last, First"`);
  console.log(`local   ${String(localAuthors.length).padStart(13)}${String(commaCount(localAuthors)).padStart(15)}${String(invertedCount(localAuthors)).padStart(22)}`);
  console.log(`Turso   ${String(tursoAuthors.size).padStart(13)}${String(commaCount(tursoAuthors.values())).padStart(15)}${String(invertedCount(tursoAuthors.values())).padStart(22)}`);

  const plan = buildPlan(localAuthors, bookCount);

  // Verify each item against Turso: same row, same name, and every row it
  // touches exists there too. Anything else is skipped on BOTH sides.
  const outOfSync: Declined[] = [];
  const items: Item[] = [];
  const created = new Set<string>();
  for (const it of plan.items) {
    const t = tursoAuthors.get(it.sourceId);
    const ids = it.steps.flatMap((s) =>
      s.op === "merge" ? [s.into] : s.op === "link" ? [s.author] : [],
    );
    for (const s of it.steps) if (s.op === "create") created.add(s.id);
    const missing = ids.filter((id) => !tursoAuthors.has(id) && !created.has(id));
    const onlyStep = it.steps.length === 1 ? it.steps[0] : null;
    if (t && onlyStep?.op === "rename" && t.name === onlyStep.to && !missing.length) {
      items.push({ ...it, localOnly: true, note: "already correct on Turso — local only" });
      continue;
    }
    if (!t || t.name !== it.sourceName || missing.length) {
      outOfSync.push({
        id: it.sourceId, name: it.sourceName, books: originalBooks.get(it.sourceId) ?? 0,
        reason: !t ? "row missing on Turso" : t.name !== it.sourceName ? `Turso has a different name: "${t.name}"` : "merge target missing on Turso",
      });
      continue;
    }
    items.push(it);
  }

  const by = (k: Item["kind"]) => items.filter((i) => i.kind === k && !i.spaces);
  const spaced = (k: Item["kind"]) => items.filter((i) => i.kind === k && i.spaces);
  const booksOf = (list: Item[]) => list.reduce((n, i) => n + (originalBooks.get(i.sourceId) ?? 0), 0);
  const show = (label: string, list: Item[], sample = 12) => {
    console.log(`\n── ${label}: ${list.length} author rows, ${fmt(booksOf(list))} book links ──`);
    const full = !APPLY && !list[0]?.spaces;
    for (const i of full ? list : list.slice(0, sample)) {
      console.log(`  ${i.sourceName}  →  ${i.result}  [${originalBooks.get(i.sourceId) ?? 0} books]${i.note ? `  (${i.note})` : ""}`);
    }
    if (!full && list.length > sample) console.log(`  … and ${list.length - sample} more (all in the plan file)`);
  };
  show("RENAME in place (no correctly-ordered row exists)", by("rename"));
  show("MERGE into the existing correctly-ordered row", by("merge"));
  show("SPLIT several people out of one row", by("split"));
  show("EXTRA SPACES — rename in place", spaced("rename"), 6);
  show("EXTRA SPACES — merge into the clean row", spaced("merge"), 6);

  const listDeclined = (label: string, list: Declined[]) => {
    console.log(`\n── ${label}: ${list.length} ──`);
    for (const d of list.sort((a, b) => b.books - a.books || a.name.localeCompare(b.name))) {
      console.log(`  ${d.name}  [${d.books} books]  — ${d.reason}`);
    }
  };
  listDeclined("LEFT FOR A HUMAN (not changed)", plan.declined);
  if (plan.untouched.length) listDeclined("Not changed, and linked to no books", plan.untouched);
  if (outOfSync.length) listDeclined("SKIPPED — local and Turso disagree", outOfSync);

  const removals = items.reduce((n, i) => n + removedIds(i).length, 0);
  console.log(
    `\nTotals: ${by("rename").length} renamed, ${by("merge").length} merged, ${by("split").length} split; ` +
      `extra-space rows: ${spaced("rename").length} renamed, ${spaced("merge").length} merged; ` +
      `${removals} author rows removed per database (one statement each); ` +
      `${plan.declined.length + plan.untouched.length} left for a human; ${outOfSync.length} skipped out-of-sync.`,
  );

  fs.mkdirSync("reports", { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const planPath = path.join("reports", `author-sweep-${APPLY ? "applied" : "plan"}-${stamp}.json`);
  fs.writeFileSync(planPath, JSON.stringify({ items, declined: plan.declined, untouched: plan.untouched, outOfSync }, null, 2));
  console.log(`Plan written to ${planPath}`);

  if (!APPLY) {
    console.log(`\nDry run only. Re-run with --apply to change local + Turso.`);
    local.close();
    process.exit(0);
  }

  // ── apply ──
  local.exec(CREATE_REDIRECTS);
  local.exec(CREATE_REDIRECTS_IDX);
  await remote.execute(CREATE_REDIRECTS);
  await remote.execute(CREATE_REDIRECTS_IDX);

  const undoPath = path.join("reports", `author-sweep-undo-${stamp}.jsonl`);
  console.log(`Undo log: ${undoPath}`);
  const affectedBooks = new Set<string>();
  const allRemoved: string[] = [];
  const allTouched = new Set<string>();
  let done = 0;
  let failed = 0;

  for (const it of items) {
    // TOCTOU: the row must still be what the plan saw, on both sides.
    const lNow = local.prepare(`SELECT name FROM authors WHERE id = ?`).get(it.sourceId) as { name: string } | undefined;
    const tNow = (await remote.execute({ sql: `SELECT name FROM authors WHERE id = ?`, args: [it.sourceId] })).rows[0];
    const tExpected = it.localOnly ? (it.steps[0] as Extract<Step, { op: "rename" }>).to : it.sourceName;
    if (!lNow || lNow.name !== it.sourceName || !tNow || String(tNow.name) !== tExpected) {
      console.log(`  skip (changed since plan): ${it.sourceName}`);
      failed++;
      continue;
    }

    // The source's links, captured per database BEFORE anything moves.
    const lLinks = local.prepare(`SELECT book_id, role FROM book_authors WHERE author_id = ?`).all(it.sourceId) as { book_id: string; role: string }[];
    const tLinks = (await remote.execute({ sql: `SELECT book_id, role FROM book_authors WHERE author_id = ?`, args: [it.sourceId] }))
      .rows.map((r) => ({ book_id: String(r.book_id), role: String(r.role) }));
    for (const l of lLinks) affectedBooks.add(l.book_id);
    for (const l of tLinks) affectedBooks.add(l.book_id);

    // Undo record: enough to put every link back by hand if this ever needs reversing.
    fs.appendFileSync(undoPath, JSON.stringify({ item: it, localLinks: lLinks, tursoLinks: tLinks }) + "\n");

    try {
      // Local first, atomically.
      const lStmts = statementsFor(it, lLinks);
      local.transaction(() => {
        for (const s of lStmts) local.prepare(s.sql).run(...s.args);
      })();
      // Then Turso, atomically.
      if (!it.localOnly) await remote.batch(statementsFor(it, tLinks) as InStatement[], "write");

      // Verify: removed rows are gone and own nothing, on both sides.
      for (const id of removedIds(it)) {
        const check = `SELECT (SELECT COUNT(*) FROM authors WHERE id = ?) a, (SELECT COUNT(*) FROM book_authors WHERE author_id = ?) b`;
        const lRow = local.prepare(check).get(id, id) as { a: number; b: number };
        const tRow = (await remote.execute({ sql: check, args: [id, id] })).rows[0];
        if (lRow.a || lRow.b || Number(tRow.a) || Number(tRow.b)) {
          throw new Error(`verify failed for ${id}: local ${lRow.a}/${lRow.b}, turso ${tRow.a}/${tRow.b}`);
        }
        allRemoved.push(id);
      }
      for (const id of it.touched) allTouched.add(id);
      done++;
      if (done % 25 === 0) {
        heartbeat(`${done}/${items.length}`);
        console.log(`  … ${done}/${items.length}`);
      }
    } catch (err) {
      failed++;
      console.error(`  FAILED ${it.sourceName}:`, err instanceof Error ? err.message : err);
    }
  }
  console.log(`\nApplied ${done} of ${items.length} (${failed} skipped/failed).`);

  // ── local FTS index for affected books (Turso has no search_index table) ──
  const pub = local.prepare(`SELECT id, title FROM books WHERE id = ? AND visibility = 'public' AND COALESCE(is_box_set, 0) = 0`);
  const names = local.prepare(`SELECT a.name FROM book_authors ba JOIN authors a ON a.id = ba.author_id WHERE ba.book_id = ?`);
  const seriesOf = local.prepare(`SELECT s.name FROM book_series bs JOIN series s ON s.id = bs.series_id WHERE bs.book_id = ?`);
  const meiliBooks: { id: string; title: string; authorNames: string; seriesName: string; visibility: string; isBoxSet: boolean }[] = [];
  let ftsOk = 0;
  for (const bookId of affectedBooks) {
    const b = pub.get(bookId) as { id: string; title: string } | undefined;
    if (!b) continue;
    const authorNames = (names.all(bookId) as { name: string }[]).map((r) => r.name).join(" ");
    const seriesName = (seriesOf.all(bookId) as { name: string }[]).map((r) => r.name).join(" ");
    try {
      local.prepare(`DELETE FROM search_index WHERE book_id = ?`).run(bookId);
      local.prepare(`INSERT INTO search_index (book_id, title, author_names, series_name) VALUES (?, ?, ?, ?)`).run(bookId, b.title, authorNames, seriesName);
      ftsOk++;
    } catch { /* FTS is best-effort; the nightly rebuild catches drift */ }
    meiliBooks.push({ id: bookId, title: b.title, authorNames, seriesName, visibility: "public", isBoxSet: false });
  }
  console.log(`Local search index refreshed for ${ftsOk} public books.`);

  // ── Meilisearch ──
  if (!SKIP_MEILI && process.env.MEILISEARCH_HOST && process.env.MEILISEARCH_ADMIN_KEY) {
    try {
      const { Meilisearch } = await import("meilisearch");
      const client = new Meilisearch({ host: process.env.MEILISEARCH_HOST, apiKey: process.env.MEILISEARCH_ADMIN_KEY });
      const chunk = <T,>(arr: T[], n: number) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
      for (const c of chunk(meiliBooks, 500)) await client.index("books").updateDocuments(c);
      if (allRemoved.length) await client.index("authors").deleteDocuments(allRemoved);
      const authorDoc = local.prepare(
        `SELECT a.id, a.name, a.slug, COUNT(ba.book_id) AS bookCount FROM authors a
         INNER JOIN book_authors ba ON ba.author_id = a.id WHERE a.id = ? GROUP BY a.id`,
      );
      const docs = [...allTouched].map((id) => authorDoc.get(id)).filter(Boolean) as Record<string, unknown>[];
      for (const c of chunk(docs, 500)) await client.index("authors").addDocuments(c);
      console.log(`Meilisearch: ${meiliBooks.length} book documents updated, ${docs.length} author documents upserted, ${allRemoved.length} removed.`);
    } catch (err) {
      console.error(`Meilisearch refresh failed (run scripts/sync-meilisearch.ts --authors --books to catch up):`, err instanceof Error ? err.message : err);
    }
  } else {
    console.log(`Meilisearch refresh skipped.`);
  }

  // ── after ──
  const localAfter = local.prepare(`SELECT id, name, slug, bio, open_library_key FROM authors`).all() as AuthorRow[];
  const tursoAfter = await loadTurso();
  console.log(`\n              authors   with a comma   inverted "Last, First"`);
  console.log(`local   ${String(localAfter.length).padStart(13)}${String(commaCount(localAfter)).padStart(15)}${String(invertedCount(localAfter)).padStart(22)}`);
  console.log(`Turso   ${String(tursoAfter.size).padStart(13)}${String(commaCount(tursoAfter.values())).padStart(15)}${String(invertedCount(tursoAfter.values())).padStart(22)}`);

  try { local.pragma("wal_checkpoint(TRUNCATE)"); } catch { /* another reader holds the WAL */ }
  local.close();
  process.exit(failed ? 1 : 0);
})();
