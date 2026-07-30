/**
 * Backfill the blank `books.language` column from sources we already pay for.
 *
 * WHY: ~6,600 public books have no language value. That column is the only
 * authoritative signal the non-English sweep (scripts/hide-non-english.ts) can
 * act on — the title heuristic in enrichable.ts deliberately ignores clean
 * Latin-script titles, so a French or Spanish book with a blank language and no
 * accents is invisible to it. The values were never missing upstream: enrichment
 * read them from ISBNdb/OpenLibrary responses for years and simply didn't store
 * them. (Fixed going forward — importFromISBNdbAndReturn now persists it.)
 *
 * COST: essentially nothing.
 *   - ISBNdb exposes a BULK endpoint (POST /books, up to 1000 ISBNs per
 *     request), so ~4,100 ISBN-bearing books cost ~9 requests, not 4,100.
 *     Verified enabled on the current plan.
 *   - OpenLibrary is free and unmetered (used for books with only an OL key,
 *     and as a fallback for ISBNs ISBNdb doesn't know). ~62% hit rate.
 *   - ZERO Brave, ZERO Grok, ZERO Google Books.
 *
 * Deliberately does NOT change visibility. It only fills the language column;
 * run scripts/hide-non-english.ts afterwards to act on what it finds. Keeping
 * detection and demotion as separate reviewable steps is the point.
 *
 * Uses raw fetch + a raw libSQL client rather than the app's helpers on purpose:
 * `@/db` imports silently bind to LOCAL sqlite in standalone scripts (ESM
 * hoisting runs them before dotenv), and the app's ISBNdb quota key is the
 * user-facing search budget, which this must not touch.
 *
 * Dry-run by default. Pass --apply to write.
 *
 * Usage:
 *   npx tsx scripts/backfill-language.ts                 # dry run
 *   npx tsx scripts/backfill-language.ts --apply
 *   npx tsx scripts/backfill-language.ts --apply --limit=500
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env.vercel.local" });

import Database from "better-sqlite3";
import path from "path";
import { createGuardedTurso } from "./lib/turso-guard";

const APPLY = process.argv.includes("--apply");
const LIMIT = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1]) || Infinity;

const ISBNDB_KEY = process.env.ISBNDB_API_KEY;
if (!ISBNDB_KEY) { console.error("Missing ISBNDB_API_KEY"); process.exit(1); }

/** ISBNdb bulk accepts up to 1000; 500 keeps request bodies and blast radius small. */
const BULK = 500;
const OL_DELAY_MS = 120;

let isbndbRequests = 0;
let olRequests = 0;

/**
 * Normalize an upstream code to the catalog's convention: a capitalized English
 * language NAME ("Spanish"), which is what every existing row already uses.
 * Sources disagree wildly — ISBNdb returns "es"/"en", OpenLibrary returns
 * "spa"/"eng", and either can return a locale form.
 */
const THREE_TO_TWO: Record<string, string> = {
  eng: "en", spa: "es", fre: "fr", fra: "fr", ger: "de", deu: "de", ita: "it",
  por: "pt", rus: "ru", jpn: "ja", chi: "zh", zho: "zh", kor: "ko", dut: "nl",
  nld: "nl", pol: "pl", tur: "tr", heb: "he", ara: "ar", swe: "sv", nor: "no",
  dan: "da", fin: "fi", gre: "el", ell: "el", cze: "cs", ces: "cs", hun: "hu",
  rum: "ro", ron: "ro", ukr: "uk", cat: "ca", wel: "cy", cym: "cy", lat: "la",
  srp: "sr", hrv: "hr", vie: "vi", tha: "th", hin: "hi", ind: "id",
};

function normalizeLanguage(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let code = String(raw).trim().toLowerCase();
  if (!code) return null;
  code = code.split(/[_-]/)[0];
  if (THREE_TO_TWO[code]) code = THREE_TO_TWO[code];
  if (code.length === 2) {
    try {
      const name = new Intl.DisplayNames(["en"], { type: "language" }).of(code);
      if (name && name.toLowerCase() !== code) {
        return name.charAt(0).toUpperCase() + name.slice(1);
      }
    } catch { /* fall through */ }
  }
  // Sources also return the full name already ("English"). Capitalize those so
  // the column doesn't end up holding both "English" and "english".
  if (code.length > 3) return code.charAt(0).toUpperCase() + code.slice(1);
  // Unknown/collective codes (e.g. OL's "gem" = Germanic) — keep the raw code
  // rather than guess. It is still a non-English value, which is what matters.
  return code;
}

const normIsbn = (s: unknown): string | null => {
  if (!s) return null;
  const c = String(s).replace(/[^0-9Xx]/g, "").toUpperCase();
  return c.length >= 10 ? c : null;
};

async function isbndbBulk(isbns: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const res = await fetch("https://api2.isbndb.com/books", {
    method: "POST",
    headers: { Authorization: ISBNDB_KEY!, "Content-Type": "application/x-www-form-urlencoded" },
    body: `isbns=${isbns.join(",")}`,
  });
  isbndbRequests++;
  if (!res.ok) {
    console.warn(`   ISBNdb bulk HTTP ${res.status} for a ${isbns.length}-ISBN batch — skipping batch`);
    return out;
  }
  const j: any = await res.json().catch(() => ({}));
  for (const b of j?.data ?? []) {
    const lang = normalizeLanguage(b?.language);
    if (!lang) continue;
    for (const cand of [b?.isbn13, b?.isbn10, b?.isbn]) {
      const n = normIsbn(cand);
      if (n) out.set(n, lang);
    }
  }
  return out;
}

async function olLanguage(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { headers: { "User-Agent": "tbra-language-backfill/1.0" } });
    olRequests++;
    if (!r.ok) return null;
    const j: any = await r.json();
    const key = j?.languages?.[0]?.key;
    const m = key && /\/languages\/(\w+)/.exec(key);
    return m ? normalizeLanguage(m[1]) : null;
  } catch { return null; }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const { remote, heartbeat } = await createGuardedTurso({
    name: "backfill-language",
    maxRuntimeMs: 90 * 60 * 1000,
    queryTimeoutMs: 300_000,
    longRunning: true,
  });

  const rows = (await remote.execute(`
    SELECT id, title, isbn_13 AS isbn13, isbn_10 AS isbn10, open_library_key AS olKey
    FROM books
    WHERE visibility='public' AND (language IS NULL OR trim(language)='')
  `)).rows as any[];
  console.log(`Public books with a blank language: ${rows.length}`);

  const targets = rows
    .map((r) => ({
      id: String(r.id),
      title: String(r.title ?? ""),
      isbn: normIsbn(r.isbn13) ?? normIsbn(r.isbn10),
      olKey: r.olKey ? String(r.olKey) : null,
    }))
    .filter((t) => t.isbn || t.olKey)
    .slice(0, LIMIT === Infinity ? undefined : LIMIT);

  const withIsbn = targets.filter((t) => t.isbn);
  const olOnly = targets.filter((t) => !t.isbn && t.olKey);
  console.log(`Resolvable: ${targets.length}  (ISBN: ${withIsbn.length}, OL-key only: ${olOnly.length})`);
  console.log(`Unresolvable (no identifier) are skipped — they need the description-based LLM pass.\n`);

  const resolved = new Map<string, string>(); // book id -> language

  // ── Phase A: ISBNdb bulk (≈9 requests for the whole catalog) ──
  console.log(`Phase A — ISBNdb bulk, ${Math.ceil(withIsbn.length / BULK)} request(s)`);
  for (let i = 0; i < withIsbn.length; i += BULK) {
    const batch = withIsbn.slice(i, i + BULK);
    const map = await isbndbBulk(batch.map((b) => b.isbn!));
    for (const b of batch) {
      const lang = map.get(b.isbn!);
      if (lang) resolved.set(b.id, lang);
    }
    console.log(`   ${Math.min(i + BULK, withIsbn.length)}/${withIsbn.length} — resolved so far: ${resolved.size}`);
    heartbeat(`isbndb ${resolved.size}`);
    await sleep(400); // 3 req/sec limit, with margin
  }

  // ── Phase B: OpenLibrary — free. Covers OL-key-only books and ISBNdb misses. ──
  const phaseB = [...olOnly, ...withIsbn.filter((b) => !resolved.has(b.id))];
  console.log(`\nPhase B — OpenLibrary, ${phaseB.length} lookups (free)`);
  let done = 0;
  for (const b of phaseB) {
    let lang: string | null = null;
    if (b.isbn) lang = await olLanguage(`https://openlibrary.org/isbn/${b.isbn}.json`);
    if (!lang && b.olKey) {
      const key = b.olKey.startsWith("/") ? b.olKey : `/works/${b.olKey}`;
      lang = await olLanguage(`https://openlibrary.org${key}.json`);
    }
    if (lang) resolved.set(b.id, lang);
    done++;
    if (done % 250 === 0) {
      console.log(`   ${done}/${phaseB.length} — resolved so far: ${resolved.size}`);
      heartbeat(`openlibrary ${done}/${phaseB.length}`);
    }
    await sleep(OL_DELAY_MS);
  }

  // ── Report ──
  const byLang: Record<string, number> = {};
  for (const l of resolved.values()) byLang[l] = (byLang[l] ?? 0) + 1;
  const nonEnglish = [...resolved.values()].filter((l) => l.toLowerCase() !== "english").length;

  console.log(`\n=== backfill-language (${APPLY ? "APPLY" : "DRY RUN"}) ===`);
  console.log(`Resolved:   ${resolved.size} / ${targets.length}`);
  console.log(`Unresolved: ${targets.length - resolved.size} (left blank)`);
  console.log(`ISBNdb requests: ${isbndbRequests}   OpenLibrary requests: ${olRequests}   Brave/Grok/Google: 0`);
  console.log(`\nOf the resolved: English ${resolved.size - nonEnglish}, NON-ENGLISH ${nonEnglish}`);
  console.log(`--- by language ---`);
  for (const [k, v] of Object.entries(byLang).sort((a, b) => b[1] - a[1]).slice(0, 25)) {
    console.log(`   ${k.padEnd(18)} ${v}`);
  }

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing written. Re-run with --apply.`);
    process.exit(0);
  }
  if (resolved.size === 0) { console.log("\nNothing to write."); process.exit(0); }

  // ── Write: Turso first (live), then local mirror. Only ever fills a BLANK
  // language — never overwrites a value someone or something already set. ──
  const now = new Date().toISOString();
  const entries = [...resolved.entries()];
  let written = 0;
  for (let i = 0; i < entries.length; i += 150) {
    for (const [id, lang] of entries.slice(i, i + 150)) {
      await remote.execute({
        sql: `UPDATE books SET language=?, updated_at=? WHERE id=? AND (language IS NULL OR trim(language)='')`,
        args: [lang, now, id],
      });
      written++;
    }
    heartbeat(`turso ${written}/${entries.length}`);
    console.log(`   Turso: ${written}/${entries.length}`);
  }

  const db = new Database(path.join(process.cwd(), "data", "tbra.db"));
  const upd = db.prepare(
    `UPDATE books SET language=?, updated_at=? WHERE id=? AND (language IS NULL OR trim(language)='')`,
  );
  let localChanged = 0;
  db.transaction(() => {
    for (const [id, lang] of entries) localChanged += upd.run(lang, now, id).changes;
  })();
  console.log(`Local mirror: ${localChanged} rows updated.`);

  console.log(`\nDONE. ${written} language values filled; ${nonEnglish} of them are non-English.`);
  console.log(`NEXT: npx tsx scripts/hide-non-english.ts        (dry run — review, then --apply)`);
  process.exit(0);
})();
