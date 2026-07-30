/**
 * Remove non-English books from the public catalog — DB-only, zero API calls.
 *
 * Background: enrich-book.ts (~L283) already demotes non-English books to
 * 'import_only' the moment anything enriches them — but only REACTIVELY, when a
 * lane happens to touch the book. Books enriched before that rule existed are
 * still sitting in the public catalog and public search, and at thin-recovery's
 * ~60 books/night they'd take a year to be reached. This applies the same rule
 * to the whole catalog in one pass, with no Brave/Grok/OpenLibrary spend.
 *
 * Matches enrich-book.ts's behaviour exactly:
 *   - visibility → 'import_only' (NOT 'hidden' — a user who imported it keeps it
 *     on their shelf; it's just out of the public catalog and public search)
 *   - language   → existing value, or the literal 'non-English' when unknown
 *   - books on ANY user's shelf / favourites / up-next are PROTECTED and skipped,
 *     mirroring the `hasUserStates` guard in enrich-book.ts
 *
 * Detection is the shared classifier (src/lib/enrichment/enrichable.ts) — no new
 * heuristics invented here:
 *   Tier A: explicit non-English `language` column value (authoritative)
 *   Tier B: language is NULL/blank AND isLikelyNonEnglish(title) — non-Latin
 *           scripts (CJK/Hebrew/Cyrillic/Arabic/Greek/Thai/Devanagari) or >25%
 *           diacritics. Deliberately does NOT catch clean Latin-script titles.
 *
 * Writes Turso FIRST (it is the live site and the source of truth for
 * visibility — sync-push step 5b never pushes visibility), then mirrors locally
 * so future candidate scans agree.
 *
 * Default is DRY RUN. Pass --apply to write.
 *
 * Usage:
 *   npx tsx scripts/hide-non-english.ts               # dry run
 *   npx tsx scripts/hide-non-english.ts --apply       # apply
 *   npx tsx scripts/hide-non-english.ts --tier=a      # tier A only
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env.vercel.local" });

import Database from "better-sqlite3";
import path from "path";
import { createGuardedTurso } from "./lib/turso-guard";
import { isLikelyNonEnglish } from "../src/lib/enrichment/enrichable";

const APPLY = process.argv.includes("--apply");
const TIER = (process.argv.find((a) => a.startsWith("--tier="))?.split("=")[1] ?? "ab").toLowerCase();
const DO_A = TIER.includes("a");
const DO_B = TIER.includes("b");

const ENGLISH_MARKERS = new Set(["en", "eng", "english"]);

(async () => {
  const { remote, heartbeat } = await createGuardedTurso({
    name: "hide-non-english",
    maxRuntimeMs: 40 * 60 * 1000,
    queryTimeoutMs: 300_000,
    longRunning: false,
  });

  // ── Candidate scan. Decomposed: plain SELECTs + JS set math, never a join to
  // user_book_state (that join has no usable index on Turso and times out). ──
  const publicRows = (await remote.execute(
    `SELECT id, title, language FROM books WHERE visibility = 'public'`,
  )).rows as any[];
  heartbeat(`public books: ${publicRows.length}`);

  const protectedIds = new Set<string>();
  for (const t of ["user_book_state", "user_favorite_books", "up_next"]) {
    try {
      const r = await remote.execute(`SELECT DISTINCT book_id AS id FROM ${t}`);
      for (const row of r.rows as any[]) protectedIds.add(String(row.id));
    } catch (e) {
      console.error(`FATAL: could not read ${t} — refusing to run without the shelf guard.`);
      throw e;
    }
    heartbeat(`protected after ${t}: ${protectedIds.size}`);
  }
  console.log(`Shelf/favourite/up-next protected book ids: ${protectedIds.size}`);

  const tierA: { id: string; title: string; language: string | null }[] = [];
  const tierB: { id: string; title: string; language: string | null }[] = [];
  let protectedHits = 0;

  for (const b of publicRows) {
    const id = String(b.id);
    const title = String(b.title ?? "");
    const langRaw = b.language == null ? "" : String(b.language).trim();
    const hasLang = langRaw.length > 0;
    const explicitNonEnglish = hasLang && !ENGLISH_MARKERS.has(langRaw.toLowerCase());

    let bucket: "a" | "b" | null = null;
    if (explicitNonEnglish) bucket = "a";
    else if (!hasLang && isLikelyNonEnglish(title, null)) bucket = "b";
    if (!bucket) continue;
    if (bucket === "a" && !DO_A) continue;
    if (bucket === "b" && !DO_B) continue;

    if (protectedIds.has(id)) { protectedHits++; continue; }
    (bucket === "a" ? tierA : tierB).push({ id, title, language: hasLang ? langRaw : null });
  }

  const targets = [...tierA, ...tierB];

  console.log(`\n=== hide-non-english (${APPLY ? "APPLY" : "DRY RUN"}, tiers=${TIER}) ===`);
  console.log(`Tier A (explicit non-English language column): ${tierA.length}`);
  console.log(`Tier B (null language + non-English title):    ${tierB.length}`);
  console.log(`PROTECTED (on a shelf/favourite/up-next):      ${protectedHits}  — left public`);
  console.log(`TOTAL to demote to import_only:               ${targets.length}`);

  const byLang: Record<string, number> = {};
  for (const t of tierA) byLang[t.language!] = (byLang[t.language!] ?? 0) + 1;
  console.log(`\n--- Tier A by language ---`);
  for (const [k, v] of Object.entries(byLang).sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    console.log(`   ${k.padEnd(18)} ${v}`);
  }
  console.log(`\n--- sample Tier A ---`);
  for (const t of tierA.slice(0, 12)) console.log(`   [${t.language}] ${JSON.stringify(t.title).slice(0, 62)}`);
  console.log(`\n--- sample Tier B (heuristic — eyeball these) ---`);
  for (const t of tierB.slice(0, 25)) console.log(`   ${JSON.stringify(t.title).slice(0, 62)}`);

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing written. Re-run with --apply to demote ${targets.length} books.`);
    process.exit(0);
  }
  if (targets.length === 0) {
    console.log(`\nNothing to do.`);
    process.exit(0);
  }

  // ── Apply: Turso first (live), then local mirror. UPDATE only, never DELETE. ──
  const now = new Date().toISOString();
  const CHUNK = 150;
  let done = 0;
  for (let i = 0; i < targets.length; i += CHUNK) {
    const batch = targets.slice(i, i + CHUNK);
    for (const t of batch) {
      await remote.execute({
        sql: `UPDATE books SET visibility='import_only', language=?, updated_at=? WHERE id=? AND visibility='public'`,
        args: [t.language ?? "non-English", now, t.id],
      });
    }
    done += batch.length;
    heartbeat(`turso ${done}/${targets.length}`);
    console.log(`   Turso: ${done}/${targets.length}`);
  }

  const verify = await remote.execute(
    `SELECT COUNT(*) n FROM books WHERE visibility='public' AND language IS NOT NULL AND lower(trim(language)) NOT IN ('en','eng','english')`,
  );
  console.log(`\nVerify — public books still carrying a non-English language value: ${(verify.rows[0] as any).n}`);

  const db = new Database(path.join(process.cwd(), "data", "tbra.db"));
  const upd = db.prepare(
    `UPDATE books SET visibility='import_only', language=?, updated_at=? WHERE id=? AND visibility='public'`,
  );
  let localChanged = 0;
  const tx = db.transaction((rows: typeof targets) => {
    for (const t of rows) localChanged += upd.run(t.language ?? "non-English", now, t.id).changes;
  });
  tx(targets);
  console.log(`Local mirror: ${localChanged} rows updated (rows already non-public locally are skipped).`);

  console.log(`\nDONE. ${targets.length} books demoted to import_only.`);
  console.log(`NEXT: run scripts/sync-meilisearch.ts to drop them from public search.`);
  process.exit(0);
})();
