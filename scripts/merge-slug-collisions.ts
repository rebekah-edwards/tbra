/**
 * merge-slug-collisions.ts
 *
 * TRUE field-level merge for slug-collision pairs (same slug, different ids on
 * local vs Turso). Successor to fix-slug-collisions.ts.
 *
 * Why not just use fix-slug-collisions.ts:
 *   That script is LOCAL-WINS. It blindly writes local's value over live for
 *   every enrichment field, and it DELETEs live's book_category_ratings and
 *   replaces them with local's. That was safe in 2026-04 when live was reliably
 *   the un-enriched shell. It is NOT safe now: the 2026-07-30 audit found live
 *   is as good as or better than local in 585 of 587 pairs, so a local-wins
 *   pass would actively destroy production data (16 pairs where local is worse,
 *   plus any pair where local has NULL and live has a value — better-sqlite3
 *   returns null, not undefined, so those NULLs pass the existing guard and
 *   overwrite).
 *
 * What this does instead — per field, keep the BETTER value, never lose data:
 *   - title            → the cleaner title (format-cruft scoring, see scoreTitle)
 *   - description      → the richer non-stale text
 *   - cover            → live wins if user-set ('manual') or already present and
 *                        verified; otherwise whichever side actually has one
 *   - identifiers      → fill only where the other side is NULL (UNIQUE-safe)
 *   - scalars          → fill only where the other side is NULL
 *   - category ratings → UNION by category_id. Live rows are never deleted;
 *                        local only contributes categories live is missing.
 *   - genres/authors/series → additive INSERT OR IGNORE
 *   - all user activity (state, ratings, reviews, shelves) → never touched
 *
 * Never writes: id, slug, visibility, needs_review, review_reason, created_at.
 * Visibility and triage state are human/product decisions, not merge output.
 *
 * Reads the latest reports/slug-collision-audit-*.json as its manifest.
 * Dry-run by default; pass --apply to mutate. --limit=N to cap pairs.
 */
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import type { Client } from "@libsql/client";
import { randomUUID } from "crypto";
import { config } from "dotenv";
import { createGuardedTurso } from "./lib/turso-guard";

config({ path: ".env.vercel.local" });

const APPLY = process.argv.includes("--apply");
const arg = (k: string, d: number) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? parseInt(a.split("=")[1], 10) : d;
};
const LIMIT = arg("limit", Infinity as unknown as number);
const CHUNK_SIZE = arg("chunk", 10);
const PAUSE_MS = arg("pause", 100);
const COOLDOWN_SEC = arg("cooldown", 20);
// See preserveAsEdition() — opt-in because a colliding identifier can be flat wrong.
const PRESERVE_EDITIONS = process.argv.includes("--preserve-editions");

const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

const localDb = new Database(path.join(process.cwd(), "data", "tbra.db"), { readonly: true });
let turso: Client;

// ── Title quality ──────────────────────────────────────────────────────────
// Format cruft that makes the catalog look amateurish in a reader's library.
// Higher penalty = worse title. We only ever CHOOSE between the two existing
// titles here; we never rewrite one. Rewriting is title-cleanup's job, and
// collapsing a box-set title to its base title would create a duplicate of the
// real book.
const TITLE_PENALTIES: [RegExp, number, string][] = [
  [/\bkindle\s+edition\b/i, 10, "kindle-edition"],
  [/\[\s*(paperback|hardcover|hardback|large\s*print)[^\]]*\]/i, 10, "bracket-format"],
  [/\(\s*\d+\s*book\s*series\s*\)/i, 10, "n-book-series"],
  [/\bturtleback\s+school\s*&?\s*library\s+binding\b/i, 9, "turtleback"],
  [/\blibrary\s+binding\b/i, 6, "library-binding"],
  [/\bmass\s+market\s+(paperback|edition)\b/i, 6, "mass-market"],
  [/\blarge\s+print\b/i, 5, "large-print"],
  [/\b(deluxe|premiere|collector'?s?|limited)\s+(hardcover|edition)\b/i, 5, "deluxe-edition"],
  [/\b(hardcover|paperback|hardback)\s+(edition|ed\.?)\b/i, 5, "format-edition"],
  [/\b\d+\s+books?\s+collection\s+set\b/i, 8, "collection-set"],
  [/\bcomplete\s+series\s+collection\b/i, 8, "complete-series"],
  [/\b(box|boxed)\s*set\b/i, 7, "box-set"],
  [/\bgift\s+set\b/i, 7, "gift-set"],
  [/¿/, 6, "mojibake"],
  [/\bby\s+[A-Z][a-z]+\s+[A-Z][a-z]+\s*$/,  3, "trailing-author"],
  [/\s{2,}/, 1, "double-space"],
];

function scoreTitle(t: string | null): { penalty: number; hits: string[] } {
  if (!t) return { penalty: 999, hits: ["null"] };
  let penalty = 0;
  const hits: string[] = [];
  for (const [re, w, label] of TITLE_PENALTIES) {
    if (re.test(t)) {
      penalty += w;
      hits.push(label);
    }
  }
  // Very long titles are usually concatenated series blurbs.
  if (t.length > 120) {
    penalty += 4;
    hits.push("very-long");
  }
  return { penalty, hits };
}

// ── Field merge helpers ────────────────────────────────────────────────────
const isBlank = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
const textLen = (v: unknown) => (typeof v === "string" ? v.trim().length : 0);

/** Fields filled only when live is blank. Never overwrite a live value. */
const FILL_IF_BLANK = [
  "publication_year", "publication_date", "pages", "words", "audio_length_minutes",
  "publisher", "language", "is_fiction", "is_box_set", "pacing",
  "series_cover_url", "audiobook_cover_url",
] as const;

/** Same, but UNIQUE-indexed — a conflict means another book owns the value. */
const UNIQUE_FILL_IF_BLANK = ["isbn_13", "isbn_10", "asin", "open_library_key"] as const;

interface Pair { slug: string; local: { id: string; title: string }; turso: { id: string; title: string } }

function resolveManifest(): string {
  const dir = path.join(process.cwd(), "reports");
  const files = fs.readdirSync(dir).filter((f) => /^slug-collision-audit-.*\.json$/.test(f)).sort();
  if (!files.length) throw new Error("No slug-collision-audit manifest. Run scripts/audit-slug-collisions.ts first.");
  return path.join(dir, files[files.length - 1]);
}

async function idSet(table: string): Promise<Set<string>> {
  const set = new Set<string>();
  let offset = 0;
  for (;;) {
    const r = await turso.execute({ sql: `SELECT id FROM ${table} LIMIT 5000 OFFSET ?`, args: [offset] });
    if (!r.rows.length) break;
    for (const row of r.rows) set.add(String(row.id));
    if (r.rows.length < 5000) break;
    offset += 5000;
  }
  return set;
}

/**
 * OPT-IN ONLY (--preserve-editions). Off by default, and that default is
 * deliberate — do not flip it.
 *
 * A UNIQUE conflict on isbn_13 / isbn_10 / asin / open_library_key means some
 * OTHER live book already owns that identifier. fix-slug-collisions.ts treated
 * that as "real edition data we shouldn't drop" and wrote it into `editions`.
 * The 2026-07-30 enrichment investigation showed that reasoning is only half
 * right: those collisions split two ways, and one way is dangerous.
 *
 *   1. Genuine duplicate rows — the identifier is correct, two rows describe
 *      one book. An `editions` row is reasonable.
 *   2. ENRICHMENT MIS-MATCHES — the identifier is simply WRONG. Observed cases:
 *      "Sex Criminals v. 10" resolved to v. 6's ISBN; "Managing Network
 *      Resources" to "Alliances and networks". Here the unique index was
 *      *preventing corruption*, and writing the value into `editions` would
 *      attach another book's ISBN to this one — laundering the bad data past
 *      the very constraint that caught it.
 *
 * Nothing is lost by skipping: the values remain on the local row, and every
 * conflict is recorded in the run report for triage. See memory
 * project_description_refresh_isbn13_head_block: "never fix a unique-constraint
 * failure by merging on the colliding identifier alone."
 *
 * editions.open_library_key is NOT NULL UNIQUE, hence the synthetic fallback.
 */
async function preserveAsEdition(localBookId: string, liveBookId: string): Promise<boolean> {
  const L = localDb
    .prepare(`SELECT title, isbn_13, isbn_10, open_library_key, publication_date, publisher, pages, cover_image_url FROM books WHERE id = ?`)
    .get(localBookId) as Record<string, any> | undefined;
  if (!L) return false;
  if (!L.isbn_13 && !L.isbn_10 && !L.open_library_key) return false;

  let olKey: string;
  if (L.open_library_key) {
    await sleep(PAUSE_MS);
    const r = await turso.execute({ sql: `SELECT 1 FROM editions WHERE open_library_key = ? LIMIT 1`, args: [L.open_library_key] });
    olKey = r.rows.length === 0 ? L.open_library_key : `synthetic:isbn:${L.isbn_13 ?? L.isbn_10 ?? randomUUID()}`;
  } else {
    olKey = `synthetic:isbn:${L.isbn_13 ?? L.isbn_10 ?? randomUUID()}`;
  }

  const coverId = L.cover_image_url?.match(/\/b\/id\/(\d+)-/)?.[1];
  try {
    await sleep(PAUSE_MS);
    await turso.execute({
      sql: `INSERT INTO editions (id, open_library_key, book_id, title, publish_date, publishers, isbn_13, isbn_10, pages, cover_id)
            VALUES (?,?,?,?,?,?,?,?,?,?)`,
      args: [randomUUID(), olKey, liveBookId, L.title, L.publication_date,
             L.publisher ? JSON.stringify([L.publisher]) : null,
             L.isbn_13, L.isbn_10, L.pages, coverId ? parseInt(coverId, 10) : null],
    });
    return true;
  } catch {
    return false; // edition already recorded, or a further conflict — not fatal
  }
}

interface PairResult {
  slug: string;
  changes: string[];
  ratingsAdded: number;
  genres: number;
  authors: number;
  series: number;
  titleSwapped?: { from: string; to: string };
  editionCreated?: boolean;
  identifierConflicts?: { field: string; localValue: string }[];
}

async function mergePair(
  pair: Pair,
  live: { authors: Set<string>; genres: Set<string>; series: Set<string> },
): Promise<PairResult> {
  const res: PairResult = { slug: pair.slug, changes: [], ratingsAdded: 0, genres: 0, authors: 0, series: 0 };

  const L = localDb.prepare(`SELECT * FROM books WHERE id = ?`).get(pair.local.id) as Record<string, any> | undefined;
  if (!L) throw new Error(`local book missing: ${pair.local.id}`);

  await sleep(PAUSE_MS);
  const tRes = await turso.execute({ sql: `SELECT * FROM books WHERE id = ?`, args: [pair.turso.id] });
  const T = tRes.rows[0] as Record<string, any> | undefined;
  if (!T) throw new Error(`turso book missing: ${pair.turso.id}`);

  const set: Record<string, any> = {};

  // 1. Title — choose the cleaner of the two. Never synthesize a new one.
  const lt = scoreTitle(L.title), tt = scoreTitle(T.title);
  if (lt.penalty < tt.penalty) {
    set.title = L.title;
    res.titleSwapped = { from: T.title, to: L.title };
    res.changes.push(`title(-${tt.penalty - lt.penalty}: ${tt.hits.join(",")})`);
  }

  // 2. Description / summary — richer non-stale text wins. description_stale
  //    follows whichever description we end up with.
  const lStale = Number(L.description_stale) === 1, tStale = Number(T.description_stale) === 1;
  const lDesc = textLen(L.description), tDesc = textLen(T.description);
  if (lDesc > 0) {
    const liveUnusable = tDesc === 0;
    const localCleaner = tStale && !lStale;
    const localRicher = !lStale && !tStale && lDesc > tDesc * 1.2;
    if (liveUnusable || localCleaner || localRicher) {
      set.description = L.description;
      set.description_stale = L.description_stale ?? 0;
      res.changes.push(`description(${tDesc}→${lDesc}${tStale ? ",live-stale" : ""})`);
    }
  }
  if (textLen(L.summary) > textLen(T.summary)) {
    set.summary = L.summary;
    res.changes.push(`summary(${textLen(T.summary)}→${textLen(L.summary)})`);
  }

  // 3. Cover — live is authoritative when a human set it or it's verified.
  //    Only fill from local when live genuinely has nothing.
  const liveHasCover = !isBlank(T.cover_image_url);
  const liveUserSet = T.cover_source === "manual" || Number(T.cover_verified) === 1;
  if (!liveHasCover && !isBlank(L.cover_image_url)) {
    set.cover_image_url = L.cover_image_url;
    set.cover_source = L.cover_source;
    set.cover_verified = L.cover_verified;
    res.changes.push("cover(filled)");
  } else if (liveHasCover && !liveUserSet && Number(L.cover_verified) === 1) {
    // Local has a human/pipeline-verified cover, live's is unverified guesswork.
    set.cover_image_url = L.cover_image_url;
    set.cover_source = L.cover_source;
    set.cover_verified = L.cover_verified;
    res.changes.push("cover(verified-upgrade)");
  }

  // 4. Plain scalars — fill only where live is blank.
  for (const f of FILL_IF_BLANK) {
    if (isBlank(T[f]) && !isBlank(L[f])) {
      set[f] = L[f];
      res.changes.push(f);
    }
  }

  if (Object.keys(set).length) {
    const cols = Object.keys(set);
    const sql = `UPDATE books SET ${cols.map((c) => `${c} = ?`).join(", ")}, updated_at = ? WHERE id = ?`;
    const args = [...cols.map((c) => set[c]), new Date().toISOString(), pair.turso.id];
    if (APPLY) {
      await sleep(PAUSE_MS);
      await turso.execute({ sql, args });
    }
  }

  // 5. UNIQUE-indexed identifiers — one at a time so a conflict on one doesn't
  //    lose the others. A conflict means another live book already owns it.
  let hadConflict = false;
  for (const f of UNIQUE_FILL_IF_BLANK) {
    if (!isBlank(T[f]) || isBlank(L[f])) continue;
    if (!APPLY) { res.changes.push(`${f}?`); continue; }
    try {
      await sleep(PAUSE_MS);
      await turso.execute({ sql: `UPDATE books SET ${f} = ? WHERE id = ?`, args: [L[f], pair.turso.id] });
      res.changes.push(f);
    } catch (e: any) {
      if (!/UNIQUE constraint/i.test(e?.message ?? "")) throw e;
      res.changes.push(`${f}!conflict`);
      hadConflict = true;
    }
  }
  // Conflicting identifiers are RECORDED, not written (see preserveAsEdition's
  // header). The value may legitimately belong to a different book.
  if (hadConflict) {
    res.identifierConflicts = UNIQUE_FILL_IF_BLANK
      .filter((f) => res.changes.includes(`${f}!conflict`))
      .map((f) => ({ field: f, localValue: String(L[f]) }));
    if (PRESERVE_EDITIONS && APPLY && (await preserveAsEdition(pair.local.id, pair.turso.id))) {
      res.editionCreated = true;
      res.changes.push("edition+");
    }
  }

  // 6. Category ratings — UNION by category_id. Live rows are never deleted.
  const liveRatings = await turso.execute({
    sql: `SELECT category_id FROM book_category_ratings WHERE book_id = ?`,
    args: [pair.turso.id],
  });
  const haveCats = new Set(liveRatings.rows.map((r: any) => String(r.category_id)));
  const localRatings = localDb
    .prepare(`SELECT category_id, intensity, notes, evidence_level, updated_by_user_id FROM book_category_ratings WHERE book_id = ?`)
    .all(pair.local.id) as any[];
  for (const r of localRatings) {
    if (haveCats.has(String(r.category_id))) continue;
    if (!APPLY) { res.ratingsAdded++; continue; }
    try {
      await sleep(PAUSE_MS);
      await turso.execute({
        sql: `INSERT INTO book_category_ratings (id, book_id, category_id, intensity, notes, evidence_level, updated_by_user_id) VALUES (?,?,?,?,?,?,?)`,
        args: [randomUUID(), pair.turso.id, r.category_id, r.intensity, r.notes, r.evidence_level, r.updated_by_user_id],
      });
      res.ratingsAdded++;
    } catch { /* skip unusable row */ }
  }

  // 7. Junction tables — additive only, filtered to ids that exist live.
  const junctions: [string, string, Set<string>, "authors" | "genres" | "series"][] = [
    ["book_authors", "author_id", live.authors, "authors"],
    ["book_genres", "genre_id", live.genres, "genres"],
    ["book_series", "series_id", live.series, "series"],
  ];
  for (const [table, col, allowed, key] of junctions) {
    const rows = localDb.prepare(`SELECT ${col} FROM ${table} WHERE book_id = ?`).all(pair.local.id) as any[];
    const candidates = rows.map((r) => String(r[col])).filter((v) => allowed.has(v));
    if (!candidates.length) continue;
    // Read what live already has, so both the dry-run count and the apply pass
    // reflect rows that genuinely land. INSERT OR IGNORE would otherwise make
    // "added" indistinguishable from "already there".
    await sleep(PAUSE_MS);
    const existing = await turso.execute({
      sql: `SELECT ${col} FROM ${table} WHERE book_id = ?`,
      args: [pair.turso.id],
    });
    const have = new Set(existing.rows.map((r: any) => String(r[col])));
    for (const v of candidates) {
      if (have.has(v)) continue;
      if (!APPLY) { res[key]++; continue; }
      try {
        await sleep(PAUSE_MS);
        await turso.execute({
          sql: `INSERT OR IGNORE INTO ${table} (book_id, ${col}) VALUES (?, ?)`,
          args: [pair.turso.id, v],
        });
        res[key]++;
      } catch { /* FK or shape mismatch — skip */ }
    }
  }

  return res;
}

async function main() {
  const manifestPath = resolveManifest();
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const pairs: Pair[] = manifest.pairs.slice(0, LIMIT);

  console.log(`=== merge-slug-collisions.ts ${APPLY ? "(APPLY)" : "(DRY RUN)"} ===`);
  console.log(`Manifest: ${path.basename(manifestPath)}`);
  console.log(`Pairs: ${pairs.length}\n`);

  const g = await createGuardedTurso({
    name: "merge-slug-collisions",
    maxRuntimeMs: 6 * 60 * 60 * 1000,
    queryTimeoutMs: 30_000,
    longRunning: true,
  });
  turso = g.remote;

  console.log("Loading live id sets (authors/genres/series)...");
  const live = { authors: await idSet("authors"), genres: await idSet("genres"), series: await idSet("series") };
  console.log(`  authors=${live.authors.size} genres=${live.genres.size} series=${live.series.size}\n`);

  const results: PairResult[] = [];
  const failures: { slug: string; error: string }[] = [];
  let done = 0;

  for (let i = 0; i < pairs.length; i += CHUNK_SIZE) {
    const chunk = pairs.slice(i, i + CHUNK_SIZE);
    for (const p of chunk) {
      try {
        results.push(await mergePair(p, live));
      } catch (e: any) {
        failures.push({ slug: p.slug, error: e?.message ?? String(e) });
      }
      done++;
    }
    g.heartbeat(`${done}/${pairs.length}`);
    console.log(`  [${done}/${pairs.length}] chunk done`);
    if (i + CHUNK_SIZE < pairs.length) await sleep(COOLDOWN_SEC * 1000);
  }

  const touched = results.filter((r) => r.changes.length || r.ratingsAdded || r.genres || r.authors || r.series);
  const titleSwaps = results.filter((r) => r.titleSwapped);
  console.log(`\n=== ${APPLY ? "APPLIED" : "WOULD APPLY"} ===`);
  console.log(`Pairs processed:        ${results.length}`);
  console.log(`Pairs with changes:     ${touched.length}`);
  console.log(`Pairs unchanged:        ${results.length - touched.length}`);
  console.log(`Title improvements:     ${titleSwaps.length}`);
  console.log(`Ratings added:          ${results.reduce((s, r) => s + r.ratingsAdded, 0)}`);
  console.log(`Genre links added:      ${results.reduce((s, r) => s + r.genres, 0)}`);
  console.log(`Author links added:     ${results.reduce((s, r) => s + r.authors, 0)}`);
  console.log(`Series links added:     ${results.reduce((s, r) => s + r.series, 0)}`);
  const conflicted = results.filter((r) => r.identifierConflicts?.length);
  console.log(`Editions preserved:     ${results.filter((r) => r.editionCreated).length}${PRESERVE_EDITIONS ? "" : " (--preserve-editions off)"}`);
  console.log(`Identifier conflicts:   ${conflicted.length} pairs — recorded for triage, NOT written`);
  console.log(`Failures:               ${failures.length}`);

  const fieldTally = new Map<string, number>();
  for (const r of results) for (const c of r.changes) {
    const k = c.split("(")[0];
    fieldTally.set(k, (fieldTally.get(k) ?? 0) + 1);
  }
  console.log(`\n--- field change tally ---`);
  [...fieldTally.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k.padEnd(22)} ${v}`));

  if (titleSwaps.length) {
    console.log(`\n--- title improvements (first 25) ---`);
    titleSwaps.slice(0, 25).forEach((r) => console.log(`  "${r.titleSwapped!.from}"\n    → "${r.titleSwapped!.to}"`));
  }
  if (failures.length) {
    console.log(`\n--- failures (first 15) ---`);
    failures.slice(0, 15).forEach((f) => console.log(`  ${f.slug}: ${f.error}`));
  }

  const outPath = path.join(process.cwd(), "reports", `slug-merge-${APPLY ? "applied" : "dryrun"}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ apply: APPLY, manifest: path.basename(manifestPath), results, failures }, null, 2));
  console.log(`\nReport: ${outPath}`);
  if (!APPLY) console.log(`\nDry run only. Re-run with --apply to write.`);

  g.shutdown();
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
