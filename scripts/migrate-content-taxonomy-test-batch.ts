/**
 * migrate-content-taxonomy-test-batch.ts
 *
 * READ-ONLY dry-run sampling for the content taxonomy restructure.
 *
 * Generates a test batch of 15–20 books currently rated `witchcraft_occult`
 * and shows how the keyword heuristic would classify them into the new
 * `magic_witchcraft` + `occult_demonology` split. User reviews before we
 * run the full migration.
 *
 * Does NOT modify any data. Reads local tbra.db only.
 */

require("dotenv").config({ path: ".env.local" });
const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(path.join(process.cwd(), "data", "tbra.db"), { readonly: true });

// Strong triggers → creates occult_demonology row
const OCCULT_TRIGGERS = [
  "demon",
  "demonic",
  "wicca",
  "wiccan",
  "ouija",
  "séance",
  "seance",
  "satanic",
  "satan",
  "devil worship",
  "necromancy",
  "exorcism",
  "demonic possession",
  "black magic",
  "ritual sacrifice",
  "occult",
  "tarot",
  "divination",
  "summoning circle",
];

// Ambiguous — flag but do not auto-classify as occult
const AMBIGUOUS = ["pagan", "ritual", "cult"];

// Negation markers that invalidate a trigger if they appear in the same clause
// before the trigger (within a small window of characters).
const NEGATION_WORDS = [
  "not",
  "no",
  "without",
  "never",
  "free of",
  "absent",
  "absent of",
  "devoid of",
  "lacking",
  "nothing",
];

// Clause separators — negations only apply within the same clause as the trigger.
const CLAUSE_SEPARATORS = /[.;,!?]|(?: but | however | though | although | yet )/gi;

function splitClauses(text: string): string[] {
  return text.split(CLAUSE_SEPARATORS).map((s) => s.trim()).filter(Boolean);
}

function isNegated(clause: string, triggerIdx: number): boolean {
  const prefix = clause.slice(0, triggerIdx).toLowerCase();
  // Look for negation word within the 40 chars preceding the trigger
  const window = prefix.slice(-40);
  return NEGATION_WORDS.some((neg) => {
    const re = new RegExp(`\\b${neg.replace(/ /g, "\\s+")}\\b`);
    return re.test(window);
  });
}

// Word-boundary-aware regex per keyword. Multi-word keywords become flexible
// whitespace. "demon" matches "demon"/"demons"/"demonic"? — we want "demon"
// alone (plurals), but "demonic" and "demonic possession" are separate keywords
// in the list already. So word-boundary on both sides, with optional trailing
// "s" for pluralization.
function kwRegex(kw: string): RegExp {
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
  return new RegExp(`\\b${escaped}s?\\b`, "i");
}

function findActiveMatches(notes: string, triggers: string[]): string[] {
  const hits = new Set<string>();
  for (const clause of splitClauses(notes)) {
    for (const kw of triggers) {
      const re = kwRegex(kw);
      const m = re.exec(clause);
      if (!m) continue;
      if (isNegated(clause, m.index)) continue;
      hits.add(kw);
    }
  }
  return [...hits];
}

function classify(notes: string | null): {
  occult: boolean;
  ambiguous: boolean;
  matchedOccult: string[];
  matchedAmbiguous: string[];
} {
  if (!notes) return { occult: false, ambiguous: false, matchedOccult: [], matchedAmbiguous: [] };
  const matchedOccult = findActiveMatches(notes, OCCULT_TRIGGERS);
  const matchedAmbiguous = findActiveMatches(notes, AMBIGUOUS);
  return {
    occult: matchedOccult.length > 0,
    ambiguous: matchedAmbiguous.length > 0 && matchedOccult.length === 0,
    matchedOccult,
    matchedAmbiguous,
  };
}

(() => {
  // Find the magic_witchcraft category id (post-migration). Falls back to old
  // key for pre-migration runs.
  const cat = (db
    .prepare(`SELECT id FROM taxonomy_categories WHERE key = ?`)
    .get("magic_witchcraft") ??
    db
      .prepare(`SELECT id FROM taxonomy_categories WHERE key = ?`)
      .get("witchcraft_occult")) as { id: string } | undefined;

  if (!cat) {
    console.error("magic_witchcraft / witchcraft_occult category not found locally.");
    process.exit(1);
  }

  // Summary counts first
  const total = db
    .prepare(
      `SELECT COUNT(*) as n FROM book_category_ratings WHERE category_id = ? AND intensity > 0`,
    )
    .get(cat.id) as { n: number };

  const withNotes = db
    .prepare(
      `SELECT COUNT(*) as n FROM book_category_ratings WHERE category_id = ? AND intensity > 0 AND notes IS NOT NULL AND length(notes) > 0`,
    )
    .get(cat.id) as { n: number };

  console.log(`\nTotal books with witchcraft_occult > 0: ${total.n}`);
  console.log(`  Of those, with notes: ${withNotes.n}\n`);

  // All rows for stats
  const all = db
    .prepare(
      `SELECT bcr.book_id, bcr.intensity, bcr.notes, b.title,
              (SELECT GROUP_CONCAT(a.name, ', ') FROM book_authors ba
                 JOIN authors a ON a.id = ba.author_id WHERE ba.book_id = b.id) as authors
         FROM book_category_ratings bcr
         JOIN books b ON b.id = bcr.book_id
        WHERE bcr.category_id = ? AND bcr.intensity > 0`,
    )
    .all(cat.id) as Array<{
    book_id: string;
    intensity: number;
    notes: string | null;
    title: string;
    authors: string | null;
  }>;

  let occultCount = 0;
  let ambiguousCount = 0;
  let pureMagicCount = 0;
  let noNotesCount = 0;

  for (const r of all) {
    const c = classify(r.notes);
    if (!r.notes) noNotesCount++;
    else if (c.occult) occultCount++;
    else if (c.ambiguous) ambiguousCount++;
    else pureMagicCount++;
  }

  console.log("Classification breakdown (all books):");
  console.log(`  Would get occult_demonology row:     ${occultCount}`);
  console.log(`  Ambiguous (keep magic only, flag):   ${ambiguousCount}`);
  console.log(`  Pure magic (stays magic_witchcraft): ${pureMagicCount}`);
  console.log(`  No notes (stays magic, no heuristic): ${noNotesCount}`);
  console.log(`  Total:                               ${all.length}\n`);

  // Fetch slugs for sampled books (deterministic — sort by book_id)
  type Row = (typeof all)[number] & { slug: string | null };
  const slugs = db
    .prepare(
      `SELECT id, slug FROM books WHERE id IN (${all.map(() => "?").join(",")})`,
    )
    .all(...all.map((r) => r.book_id)) as Array<{ id: string; slug: string | null }>;
  const slugMap = new Map(slugs.map((s) => [s.id, s.slug]));
  const withSlugs: Row[] = all.map((r) => ({ ...r, slug: slugMap.get(r.book_id) ?? null }));

  // Deterministic sample: sort by book_id (UUIDs = pseudo-random ordering).
  // Filter each bucket then take first N.
  withSlugs.sort((a, b) => a.book_id.localeCompare(b.book_id));

  const sample: Row[] = [];
  const occultHits = withSlugs.filter((r) => r.notes && classify(r.notes).occult && r.slug);
  const pureMagic = withSlugs.filter(
    (r) => r.notes && !classify(r.notes).occult && !classify(r.notes).ambiguous && r.slug,
  );
  const ambig = withSlugs.filter((r) => r.notes && classify(r.notes).ambiguous && r.slug);

  // Pick varied intensities among occult hits
  for (const intensity of [1, 2, 3, 4]) {
    const matches = occultHits.filter((r) => r.intensity === intensity).slice(0, 2);
    sample.push(...matches);
  }
  // Fill to 10 occult total with anything remaining
  for (const r of occultHits) {
    if (sample.length >= 10) break;
    if (!sample.find((s) => s.book_id === r.book_id)) sample.push(r);
  }

  // 5 pure magic, prefer intensity >= 2
  const pureMagicGood = pureMagic.filter((r) => r.intensity >= 2).slice(0, 5);
  sample.push(...pureMagicGood);

  // 3 ambiguous
  sample.push(...ambig.slice(0, 3));

  console.log("=".repeat(80));
  console.log(`TEST BATCH — ${sample.length} books`);
  console.log("=".repeat(80));

  for (const r of sample) {
    const c = classify(r.notes);
    const decision = c.occult
      ? `→ DUPLICATE into occult_demonology (matched: ${c.matchedOccult.join(", ")})`
      : c.ambiguous
        ? `→ AMBIGUOUS (ambiguous hits: ${c.matchedAmbiguous.join(", ")}) — stays magic only`
        : `→ stays magic only`;
    console.log(`\n"${r.title}" — ${r.authors ?? "Unknown"}`);
    console.log(`  slug: ${r.slug ?? "(none)"}`);
    console.log(`  intensity: ${r.intensity}/4`);
    console.log(`  notes: ${r.notes ?? "(none)"}`);
    console.log(`  decision: ${decision}`);
  }

  console.log("\n" + "=".repeat(80));
  console.log("\nURLs for spot-check (local dev server on port 3000):");
  for (const r of sample) {
    if (r.slug) console.log(`  http://localhost:3000/book/${r.slug}`);
  }

  db.close();
})();
