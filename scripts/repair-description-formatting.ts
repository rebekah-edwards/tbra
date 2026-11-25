/**
 * Restore paragraph breaks and bold/italics to descriptions that were
 * flattened into one run-on paragraph (bug fixed 2026-11-25 in
 * src/lib/enrichment/sanitize.ts + isbndb.ts: tags were deleted instead of
 * converted, and the blurb stripper collapsed every "\n\n" into a space).
 *
 * For each flat description (no newline, 300+ chars) it re-fetches the
 * source text — OpenLibrary first (free), then ISBNdb (Premium quota) — runs
 * it through the FIXED cleaners, and replaces the stored text ONLY when the
 * two hold exactly the same words (letters and digits compared, formatting
 * ignored). Anything else is left alone: this never swaps one description for
 * a different one.
 *
 * Writes prod Turso and the local SQLite (both, same row) with a fresh
 * updated_at so sync can't revert it.
 *
 *   npx tsx scripts/repair-description-formatting.ts            # dry run, 40 books
 *   LIMIT=2000 APPLY=1 npx tsx scripts/repair-description-formatting.ts
 *   SOURCES=ol  (default "ol,isbndb")   CONCURRENCY=3
 *
 * Run from the checkout that holds data/tbra.db.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env.vercel.local" });

import { createClient } from "@libsql/client";
import { createGuardedTurso } from "./lib/turso-guard";
import { sanitizeDescription } from "../src/lib/enrichment/sanitize";
import { searchISBNdb, getISBNdbDescription } from "../src/lib/enrichment/isbndb";

const APPLY = process.env.APPLY === "1";
const LIMIT = Number(process.env.LIMIT ?? 40);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 3);
const SOURCES = (process.env.SOURCES ?? "ol,isbndb").split(",").map((s) => s.trim());

/** Words only: what must match for a swap to be safe. */
function wordsOf(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "");
}

function isFormatted(s: string): boolean {
  return s.includes("\n") || /\*\*[^*]+\*\*/.test(s);
}

async function fromOpenLibrary(olKey: string | null): Promise<string | null> {
  if (!olKey || !olKey.startsWith("/works/")) return null;
  try {
    const res = await fetch(`https://openlibrary.org${olKey}.json`, {
      headers: { "User-Agent": "tbra-description-repair/1.0" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { description?: string | { value?: string } };
    const raw = typeof j.description === "string" ? j.description : j.description?.value;
    return raw ? sanitizeDescription(raw) : null;
  } catch {
    return null;
  }
}

async function fromIsbndb(isbn13: string | null): Promise<string | null> {
  if (!isbn13) return null;
  try {
    const hit = await searchISBNdb(isbn13);
    const desc = hit ? getISBNdbDescription(hit) : null;
    return desc ? sanitizeDescription(desc) : null;
  } catch {
    return null;
  }
}

(async () => {
  const local = createClient({ url: "file:data/tbra.db" });
  const { remote } = await createGuardedTurso({
    name: "repair-description-formatting",
    maxRuntimeMs: 55 * 60 * 1000,
    queryTimeoutMs: 30_000,
  });

  // Readers' books first, then the SEO core set (prod-only table), then the
  // rest. Selection runs on the local mirror — the same query on Turso
  // times out — and every write is a compare-and-set on prod's own text.
  const coreIds = new Set(
    ((await remote.execute("SELECT book_id FROM seo_index_books")).rows as unknown as { book_id: string }[]).map((r) => r.book_id),
  );
  const pool = (
    await local.execute({
      sql: `SELECT b.id, b.title, b.description, b.isbn_13, b.open_library_key,
                   EXISTS(SELECT 1 FROM user_book_state s WHERE s.book_id = b.id) AS shelved
            FROM books b
            WHERE b.visibility = 'public'
              AND b.description IS NOT NULL
              AND length(b.description) >= 300
              AND instr(b.description, char(10)) = 0
              AND (b.isbn_13 IS NOT NULL OR b.open_library_key LIKE '/works/%')
            ORDER BY shelved DESC, b.updated_at DESC`,
      args: [],
    })
  ).rows as unknown as {
    id: string; title: string; description: string; isbn_13: string | null;
    open_library_key: string | null; shelved: number;
  }[];
  const rank = (b: (typeof pool)[number]) => (b.shelved ? 0 : coreIds.has(b.id) ? 1 : 2);
  const candidates = [...pool].sort((a, b) => rank(a) - rank(b)).slice(0, LIMIT);

  console.log(`${candidates.length} flat descriptions to check (${APPLY ? "APPLY" : "dry run"}; sources ${SOURCES.join("→")})`);

  const tally = { repaired: 0, noSource: 0, alreadyFlat: 0, wordsDiffer: 0, localSkipped: 0, prodSkipped: 0 };
  const samples: string[] = [];
  let next = 0;

  async function worker() {
    while (next < candidates.length) {
      const b = candidates[next++];
      const want = wordsOf(b.description);
      let fixed: string | null = null;
      let sawSource = false;
      let sawDiffer = false;
      for (const src of SOURCES) {
        const text = src === "ol" ? await fromOpenLibrary(b.open_library_key) : src === "isbndb" ? await fromIsbndb(b.isbn_13) : null;
        if (!text) continue;
        sawSource = true;
        if (!isFormatted(text)) continue;
        if (wordsOf(text) !== want) { sawDiffer = true; continue; }
        fixed = text;
        break;
      }
      if (!fixed) {
        if (!sawSource) tally.noSource++;
        else if (sawDiffer) tally.wordsDiffer++;
        else tally.alreadyFlat++;
        continue;
      }
      tally.repaired++;
      if (samples.length < 3) samples.push(`--- ${b.title}\n${fixed.slice(0, 400)}`);
      if (!APPLY) continue;
      const now = new Date().toISOString();
      // Compare-and-set on both sides: only replace the exact text we checked.
      const rem = await remote.execute({
        sql: "UPDATE books SET description = ?, updated_at = ? WHERE id = ? AND description = ?",
        args: [fixed, now, b.id, b.description],
      });
      const loc = await local.execute({
        sql: "UPDATE books SET description = ?, updated_at = ? WHERE id = ? AND description = ?",
        args: [fixed, now, b.id, b.description],
      });
      if (loc.rowsAffected === 0) tally.localSkipped++;
      if (rem.rowsAffected === 0) tally.prodSkipped++;
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log(JSON.stringify(tally));
  for (const s of samples) console.log(s);
  process.exit(0);
})();
