/**
 * migrate-content-taxonomy.ts
 *
 * Restructures content rating categories in local SQLite.
 *
 * Category-level changes (idempotent):
 *   - sexual_content → romance_sex (rename in place)
 *   - witchcraft_occult → magic_witchcraft (rename in place)
 *   - user_added → other (rename in place)
 *   - CREATE occult_demonology (new)
 *   - DEACTIVATE sexual_assault_coercion (soft delete, rows preserved)
 *
 * Data migration:
 *   - For each book with sexual_assault_coercion rating > 0:
 *       • abuse_suffering: intensity = max(existing, SA); append SA notes
 *       • romance_sex: append SA notes only (no intensity change)
 *
 *   - For each book with magic_witchcraft rating > 0:
 *       Three-way classification based on notes content:
 *         (a) MOVE (occult-only): note has occult triggers, no fantasy markers
 *             → magic_witchcraft row zeroed with placeholder note
 *             → NEW occult_demonology row with original intensity + notes
 *         (b) SPLIT (both present): note has both occult triggers AND fantasy markers
 *             → magic_witchcraft unchanged
 *             → NEW occult_demonology row with synthesized template note
 *         (c) STAY (fantasy-only / no occult): nothing changes
 *
 *   - Before re-running: DELETES all existing occult_demonology rows so the
 *     script is safe to run multiple times.
 *
 * Usage:
 *   npx tsx scripts/migrate-content-taxonomy.ts              # dry-run, prints stats + 18 samples
 *   npx tsx scripts/migrate-content-taxonomy.ts --execute    # write changes
 */

require("dotenv").config({ path: ".env.local" });
const Database = require("better-sqlite3");
const path = require("path");

const EXECUTE = process.argv.includes("--execute");
const db = new Database(path.join(process.cwd(), "data", "tbra.db"));
db.pragma("foreign_keys = OFF");

const NOW = new Date().toISOString().replace("T", " ").slice(0, 19);
const PLACEHOLDER_ZERO_NOTE = "No evidence found in available sources.";

// ── Occult triggers, grouped for synthesized-note generation ──────────────
type OccultGroup = {
  id: string;
  triggers: string[];
  phraseCap: string; // capitalized form for sentence start
  phraseLower: string; // lowercase form for mid-sentence
  generic?: boolean;
};
const OCCULT_GROUPS: OccultGroup[] = [
  // Order matters for first-match-wins per term.
  { id: "demonology",  triggers: ["demonic possession", "demonic", "demon"],        phraseCap: "Demonology",                      phraseLower: "demonology" },
  { id: "satanism",    triggers: ["devil worship", "satanic", "satan"],             phraseCap: "Satanism",                        phraseLower: "satanism" },
  { id: "seance",      triggers: ["séance", "seance", "ouija"],                     phraseCap: "Séances and spirit communication", phraseLower: "séances and spirit communication" },
  { id: "necromancy",  triggers: ["necromancy"],                                    phraseCap: "Necromancy",                      phraseLower: "necromancy" },
  { id: "exorcism",    triggers: ["exorcism"],                                      phraseCap: "Exorcism",                        phraseLower: "exorcism" },
  { id: "wicca",       triggers: ["wiccan", "wicca"],                               phraseCap: "Wicca and pagan practices",       phraseLower: "Wicca and pagan practices" },
  { id: "divination",  triggers: ["tarot", "divination"],                           phraseCap: "Divination",                      phraseLower: "divination" },
  { id: "dark",        triggers: ["ritual sacrifice", "black magic"],               phraseCap: "Dark occult practices",           phraseLower: "dark occult practices" },
  { id: "generic",     triggers: ["summoning circle", "occult"],                    phraseCap: "Occult elements",                 phraseLower: "occult elements", generic: true },
];
const OCCULT_TRIGGERS: string[] = OCCULT_GROUPS.flatMap((g) => g.triggers);

// ── Fantasy markers (presence → fantasy side exists) ──────────────────────
// Deliberately excludes "supernatural" and "mystical" — those tilt horror/occult
// more than fantasy-as-story-element. "magic" is broad; carve-out for
// "black magic" via fantasyMatches() below.
const FANTASY_MARKERS = [
  "fantasy",
  "fantastical",
  "magical realism",
  "spellcasting",
  "spell",
  "wizard",
  "sorcery",
  "sorcerer",
  "sorceress",
  "enchanted",
  "enchantment",
  "fae",
  "fey",
  "mythical",
  "magical abilities",
  "magical power",
  "magic system",
  "magic",
];

// ── Negation ──────────────────────────────────────────────────────────────
const NEGATION_PATTERNS = [
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
  "rather than",
  "as opposed to",
  "instead of",
];

const CLAUSE_SEPARATORS = /[.;,!?]|(?: but | however | though | although | yet )/gi;

function splitClauses(text: string): string[] {
  return text.split(CLAUSE_SEPARATORS).map((s) => s.trim()).filter(Boolean);
}
function kwRegex(kw: string): RegExp {
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
  return new RegExp(`\\b${escaped}s?\\b`, "i");
}
function isNegated(clause: string, triggerIdx: number): boolean {
  const prefix = clause.slice(0, triggerIdx).toLowerCase();
  // Look for negation word within the 50 chars preceding the trigger
  const window = prefix.slice(-50);
  return NEGATION_PATTERNS.some((neg) => {
    const re = new RegExp(`\\b${neg.replace(/ /g, "\\s+")}\\b`);
    return re.test(window);
  });
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

// "black magic" → not fantasy (it's occult). Strip it before fantasy detection.
function fantasyMatches(notes: string): string[] {
  // Remove "black magic" references from the text before checking fantasy markers
  const stripped = notes.replace(/\bblack\s+magics?\b/gi, "");
  return findActiveMatches(stripped, FANTASY_MARKERS);
}
function occultMatches(notes: string): string[] {
  return findActiveMatches(notes, OCCULT_TRIGGERS);
}

// Classify three-way
type Classification = "move" | "split" | "stay";
type ClassifyResult = {
  kind: Classification;
  occultTerms: string[];
  fantasyTerms: string[];
};
function classify(notes: string | null): ClassifyResult {
  if (!notes) return { kind: "stay", occultTerms: [], fantasyTerms: [] };
  const occult = occultMatches(notes);
  const fantasy = fantasyMatches(notes);
  if (occult.length === 0) return { kind: "stay", occultTerms: [], fantasyTerms: fantasy };
  if (fantasy.length === 0) return { kind: "move", occultTerms: occult, fantasyTerms: [] };
  return { kind: "split", occultTerms: occult, fantasyTerms: fantasy };
}

// Synthesized note for SPLIT case
function synthesizeOccultNote(occultTerms: string[]): string {
  // Map matched terms → groups (first-match-wins since OCCULT_GROUPS is ordered
  // specific-first, generic-last, and triggers within each group are also ordered)
  const matchedGroups = new Set<string>();
  for (const term of occultTerms) {
    for (const g of OCCULT_GROUPS) {
      if (g.triggers.some((t) => t.toLowerCase() === term.toLowerCase())) {
        matchedGroups.add(g.id);
        break;
      }
    }
  }

  // Drop generic if any specific group matched
  const hasSpecific = [...matchedGroups].some(
    (id) => !OCCULT_GROUPS.find((g) => g.id === id)?.generic,
  );
  if (hasSpecific) matchedGroups.delete("generic");

  const orderedIds = OCCULT_GROUPS.map((g) => g.id).filter((id) => matchedGroups.has(id));
  if (orderedIds.length === 0) return "Occult elements present as part of the fantasy magic system.";

  const phrases: string[] = orderedIds.map((id, i) => {
    const g = OCCULT_GROUPS.find((x) => x.id === id)!;
    return i === 0 ? g.phraseCap : g.phraseLower;
  });

  let joined: string;
  if (phrases.length === 1) joined = phrases[0];
  else if (phrases.length === 2) joined = `${phrases[0]} and ${phrases[1]}`;
  else joined = `${phrases.slice(0, -1).join(", ")}, and ${phrases[phrases.length - 1]}`;

  return `${joined} present as part of the fantasy magic system.`;
}

// ── Types ─────────────────────────────────────────────────────────────────
type Cat = { id: string; key: string; name: string; description: string; active: number };
type Rating = {
  id: string;
  book_id: string;
  category_id: string;
  intensity: number;
  notes: string | null;
  evidence_level: string;
  updated_by_user_id: string | null;
  updated_at: string;
};

function randomUUID(): string {
  return (global as any).crypto?.randomUUID?.() ?? require("crypto").randomUUID();
}

function appendNote(existing: string | null, addition: string | null): string | null {
  if (!addition || !addition.trim()) return existing;
  if (!existing || !existing.trim()) return addition;
  if (existing.includes(addition)) return existing;
  return `${existing.trim()}\n\n${addition.trim()}`;
}

// ── SA note reshaper ──────────────────────────────────────────────────────
// Converts a raw sexual_assault_coercion note into a form that reads naturally
// when joined onto an abuse_suffering or romance_sex note.
//
// Transformations:
//   1. Strip leading severity qualifiers ("Minor references;", "Moderate
//      depiction of", etc.) — they're redundant once merged into another note.
//   2. Ensure "sexual" context is unambiguous. If the note already mentions
//      sex/rape/assault, keep as-is. Otherwise inject "sexual " before a
//      key noun (threats, coercion, violence, etc.). Last-resort fallback
//      prefixes "Sexual context: ".
//   3. Capitalize first letter, ensure terminal punctuation.
const SEVERITY_PREFIX_RE =
  /^(Minor|Moderate|Major|Central|Heavy|Pervasive|Frequent|Brief|Recurring|Implied|Some|Occasional)\s+(references?|mentions?|depictions?|depiction|focus|themes?|discussion|treatments?)\s*[:;,]?\s*(of\s+)?/i;
const SEX_REF_RE = /\b(sex|sexual|sexually|rape|rapes|raping|raped|assault|assaulted|assaulting|molest|molestation|incest|lust|prostitut|sodomy|seduce|seduction)/i;
const INJECTABLE_NOUNS_RE =
  /\b(coercion|threats?|violence|abuses?|aftermath|subjugations?|contexts?|contents?|relationships?|dynamics?|scenes?|acts?|scenarios?|imagery|undertones?|themes?|references?|aspects?|elements?)\b/i;

function reshapeSaNote(saNote: string): string {
  let cleaned = saNote.trim();

  cleaned = cleaned.replace(SEVERITY_PREFIX_RE, "").trim();

  if (!SEX_REF_RE.test(cleaned)) {
    const injected = cleaned.replace(INJECTABLE_NOUNS_RE, "sexual $1");
    if (injected !== cleaned) {
      cleaned = injected;
    } else {
      cleaned = `Sexual context: ${cleaned.charAt(0).toLowerCase() + cleaned.slice(1)}`;
    }
  }

  if (cleaned.length === 0) return saNote.trim();
  cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  if (!/[.!?]$/.test(cleaned)) cleaned += ".";
  return cleaned;
}

// Merge the reshaped SA note as a new sentence onto an existing note.
// Idempotent — if the merge has already been applied, won't double-append.
function mergeSaSentence(existing: string | null, reshapedSa: string): string {
  if (!existing || !existing.trim()) return reshapedSa;
  if (existing.includes(reshapedSa)) return existing;
  const baseText = existing.trim().replace(/[.!?]+$/, ""); // strip trailing punct so we re-add cleanly
  return `${baseText}. ${reshapedSa}`;
}

// Strip a previously-appended SA block from a note. We used "\n\n<sa raw>" as
// the separator in the earlier migration pass; this pulls it off so we can
// re-merge with the new reshaped logic. Idempotent: if the suffix isn't
// present, returns the note unchanged.
function unappendOldSa(note: string | null, rawSaNote: string): string | null {
  if (!note) return note;
  const oldSuffix = `\n\n${rawSaNote}`;
  if (note.endsWith(oldSuffix)) {
    return note.slice(0, -oldSuffix.length);
  }
  return note;
}

function shuffle<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// ── Main ──────────────────────────────────────────────────────────────────
(() => {
  console.log(`\n${EXECUTE ? "EXECUTING" : "DRY RUN"} — content taxonomy migration\n`);

  // ── 1. Ensure categories exist with correct keys ──
  const ensureCats = () => {
    const cats = db.prepare(`SELECT * FROM taxonomy_categories`).all() as Cat[];
    const byKey = new Map(cats.map((c) => [c.key, c]));

    // Renames
    const renames: Array<[string, string, string, string]> = [
      [
        "sexual_content",
        "romance_sex",
        "Romance & sex",
        "On-page vs fade-to-black romantic and sexual content, including explicitness and frequency. Notes may include sexual-assault context where relevant.",
      ],
      [
        "witchcraft_occult",
        "magic_witchcraft",
        "Magic & witchcraft",
        "Fantasy magic, witchcraft, and spellcasting as story elements (e.g., Harry Potter). Does not include real-world occult or demonology — see Occult / demonology.",
      ],
      [
        "user_added",
        "other",
        "Other",
        "Additional content details and trigger warnings that don't fit the other categories (e.g., eating disorders, anti-obesity content, medical trauma).",
      ],
    ];
    for (const [oldKey, newKey, newName, newDesc] of renames) {
      if (byKey.has(oldKey)) {
        console.log(`    rename: ${oldKey} → ${newKey}`);
        if (EXECUTE) {
          db.prepare(
            `UPDATE taxonomy_categories SET key = ?, name = ?, description = ? WHERE key = ?`,
          ).run(newKey, newName, newDesc, oldKey);
        }
      }
    }

    // occult_demonology new category
    const refreshed = db.prepare(`SELECT * FROM taxonomy_categories`).all() as Cat[];
    const byKey2 = new Map(refreshed.map((c) => [c.key, c]));
    let occultId = byKey2.get("occult_demonology")?.id;
    if (!occultId) {
      occultId = randomUUID();
      console.log(`    insert: occult_demonology (id=${occultId})`);
      if (EXECUTE) {
        db.prepare(
          `INSERT INTO taxonomy_categories (id, key, name, description, active) VALUES (?, ?, ?, ?, 1)`,
        ).run(
          occultId,
          "occult_demonology",
          "Occult / demonology",
          "Real-world occult content, Wicca, demons, demonology, rituals, séances, divination, or ritual magic. Distinct from fantasy magic — see Magic & witchcraft.",
        );
      }
    }

    // Deactivate SA
    if (byKey2.get("sexual_assault_coercion")?.active) {
      console.log(`    deactivate: sexual_assault_coercion`);
      if (EXECUTE) {
        db.prepare(`UPDATE taxonomy_categories SET active = 0 WHERE key = ?`).run(
          "sexual_assault_coercion",
        );
      }
    }

    return { occultId };
  };

  console.log("[1] Category-level changes:");
  const { occultId: occultDemonologyId } = ensureCats();

  // Fetch canonical IDs post-rename
  const cats = db.prepare(`SELECT * FROM taxonomy_categories`).all() as Cat[];
  const byKey = new Map(cats.map((c) => [c.key, c]));
  const romanceSexId = byKey.get("romance_sex")!.id;
  const magicWitchcraftId = byKey.get("magic_witchcraft")!.id;
  const saId = byKey.get("sexual_assault_coercion")!.id;
  const abuseSufferingId = byKey.get("abuse_suffering")!.id;

  // ── 2. SA merge (idempotent via appendNote) ──
  console.log("\n[2] Sexual-assault merge:");
  const saRatings = db
    .prepare(`SELECT * FROM book_category_ratings WHERE category_id = ? AND intensity > 0`)
    .all(saId) as Rating[];
  console.log(`    ${saRatings.length} books have SA rating > 0`);

  let abuseUpdated = 0, abuseCreated = 0, romanceNotesUpdated = 0, romanceSkipped = 0;

  const processSa = (write: boolean) => {
    for (const sa of saRatings) {
      if (!sa.notes) continue;
      const reshaped = reshapeSaNote(sa.notes);

      // abuse_suffering
      const abuse = db
        .prepare(`SELECT * FROM book_category_ratings WHERE book_id = ? AND category_id = ?`)
        .get(sa.book_id, abuseSufferingId) as Rating | undefined;

      if (abuse) {
        // Strip any prior old-style append (\n\n<raw SA>) so we can re-merge cleanly
        const base = unappendOldSa(abuse.notes, sa.notes);
        const newIntensity = Math.max(abuse.intensity, sa.intensity);
        const newNotes = mergeSaSentence(base, reshaped);

        if (newIntensity !== abuse.intensity || newNotes !== abuse.notes) {
          if (write) {
            db.prepare(
              `UPDATE book_category_ratings SET intensity = ?, notes = ?, updated_at = ? WHERE id = ?`,
            ).run(newIntensity, newNotes, NOW, abuse.id);
          }
          abuseUpdated++;
        }
      } else {
        if (write) {
          db.prepare(
            `INSERT INTO book_category_ratings (id, book_id, category_id, intensity, notes, evidence_level, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          ).run(randomUUID(), sa.book_id, abuseSufferingId, sa.intensity, reshaped, sa.evidence_level, NOW);
        }
        abuseCreated++;
      }

      // romance_sex (notes only, no intensity change)
      const romance = db
        .prepare(`SELECT * FROM book_category_ratings WHERE book_id = ? AND category_id = ?`)
        .get(sa.book_id, romanceSexId) as Rating | undefined;

      if (romance) {
        const base = unappendOldSa(romance.notes, sa.notes);
        const newNotes = mergeSaSentence(base, reshaped);
        if (newNotes !== romance.notes) {
          if (write) {
            db.prepare(
              `UPDATE book_category_ratings SET notes = ?, updated_at = ? WHERE id = ?`,
            ).run(newNotes, NOW, romance.id);
          }
          romanceNotesUpdated++;
        }
      } else {
        romanceSkipped++;
      }
    }
  };

  if (EXECUTE) {
    db.transaction(() => processSa(true))();
  } else {
    processSa(false);
  }

  console.log(`    abuse_suffering updated:    ${abuseUpdated}`);
  console.log(`    abuse_suffering created:    ${abuseCreated}`);
  console.log(`    romance_sex notes appended: ${romanceNotesUpdated}`);
  console.log(`    romance_sex skipped:        ${romanceSkipped}`);

  // ── 3. Witchcraft split with three-way logic ──
  console.log("\n[3] Witchcraft split (three-way):");

  // Reset: restore MOVE'd magic rows from their occult partner (prior-run
  // state), then delete all occult_demonology rows. Makes re-runs idempotent.
  const existingOccultRows = db
    .prepare(
      `SELECT bcr.book_id, bcr.intensity, bcr.notes, bcr.evidence_level
         FROM book_category_ratings bcr
        WHERE bcr.category_id = ?`,
    )
    .all(occultDemonologyId) as Array<{ book_id: string; intensity: number; notes: string | null; evidence_level: string }>;
  console.log(`    existing occult_demonology rows to reset: ${existingOccultRows.length}`);

  let restoredFromPriorMove = 0;
  if (EXECUTE) {
    // Restore magic_witchcraft row where previous run MOVE'd it (intensity=0,
    // placeholder notes) and an occult row has the real data.
    const restoreTx = db.transaction(() => {
      for (const occRow of existingOccultRows) {
        const magic = db
          .prepare(
            `SELECT id, intensity, notes FROM book_category_ratings WHERE book_id = ? AND category_id = ?`,
          )
          .get(occRow.book_id, magicWitchcraftId) as { id: string; intensity: number; notes: string | null } | undefined;

        if (
          magic &&
          magic.intensity === 0 &&
          magic.notes === PLACEHOLDER_ZERO_NOTE &&
          occRow.intensity > 0 &&
          occRow.notes
        ) {
          db.prepare(
            `UPDATE book_category_ratings SET intensity = ?, notes = ?, evidence_level = ?, updated_at = ? WHERE id = ?`,
          ).run(occRow.intensity, occRow.notes, occRow.evidence_level, NOW, magic.id);
          restoredFromPriorMove++;
        }
      }
      db.prepare(`DELETE FROM book_category_ratings WHERE category_id = ?`).run(occultDemonologyId);
    });
    restoreTx();
  }
  if (restoredFromPriorMove > 0) {
    console.log(`    restored from prior-run MOVE: ${restoredFromPriorMove}`);
  }

  const magicRatings = db
    .prepare(`SELECT * FROM book_category_ratings WHERE category_id = ? AND intensity > 0`)
    .all(magicWitchcraftId) as Rating[];
  console.log(`    ${magicRatings.length} books have magic_witchcraft rating > 0`);

  let moveCount = 0, splitCount = 0, stayCount = 0;

  const processWitchcraft = (write: boolean) => {
    for (const r of magicRatings) {
      const c = classify(r.notes);
      if (c.kind === "stay") { stayCount++; continue; }

      if (c.kind === "move") {
        moveCount++;
        if (write) {
          // Zero out the magic row (placeholder), move content to occult
          db.prepare(
            `UPDATE book_category_ratings SET intensity = 0, notes = ?, updated_at = ? WHERE id = ?`,
          ).run(PLACEHOLDER_ZERO_NOTE, NOW, r.id);
          db.prepare(
            `INSERT INTO book_category_ratings (id, book_id, category_id, intensity, notes, evidence_level, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            randomUUID(),
            r.book_id,
            occultDemonologyId,
            r.intensity,
            r.notes,
            r.evidence_level,
            NOW,
          );
        }
      } else {
        // split: keep magic unchanged, add synthesized occult row
        splitCount++;
        const syntNote = synthesizeOccultNote(c.occultTerms);
        if (write) {
          db.prepare(
            `INSERT INTO book_category_ratings (id, book_id, category_id, intensity, notes, evidence_level, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            randomUUID(),
            r.book_id,
            occultDemonologyId,
            r.intensity,
            syntNote,
            "ai_inferred",
            NOW,
          );
        }
      }
    }
  };

  if (EXECUTE) {
    db.transaction(() => processWitchcraft(true))();
  } else {
    processWitchcraft(false);
  }

  console.log(`    MOVE  (occult-only):  ${moveCount}`);
  console.log(`    SPLIT (both):         ${splitCount}`);
  console.log(`    STAY  (no occult):    ${stayCount}`);

  // ── 4. Backfill: every rated book must have all 12 active category rows ──
  console.log("\n[4] 12-row consistency backfill:");
  const activeCats = db
    .prepare(`SELECT id, key FROM taxonomy_categories WHERE active = 1`)
    .all() as Array<{ id: string; key: string }>;

  // Find every book that has at least one rating
  const ratedBooks = db
    .prepare(`SELECT DISTINCT book_id FROM book_category_ratings`)
    .all() as Array<{ book_id: string }>;
  console.log(`    ${ratedBooks.length} books have ≥1 rating; ensuring all 12 active categories`);

  let backfillInserted = 0;

  const processBackfill = (write: boolean) => {
    for (const { book_id } of ratedBooks) {
      const existing = db
        .prepare(`SELECT category_id FROM book_category_ratings WHERE book_id = ?`)
        .all(book_id) as Array<{ category_id: string }>;
      const existingIds = new Set(existing.map((r) => r.category_id));

      for (const cat of activeCats) {
        if (existingIds.has(cat.id)) continue;
        if (write) {
          db.prepare(
            `INSERT INTO book_category_ratings (id, book_id, category_id, intensity, notes, evidence_level, updated_at) VALUES (?, ?, ?, 0, ?, 'ai_inferred', ?)`,
          ).run(randomUUID(), book_id, cat.id, PLACEHOLDER_ZERO_NOTE, NOW);
        }
        backfillInserted++;
      }
    }
  };

  if (EXECUTE) {
    db.transaction(() => processBackfill(true))();
  } else {
    processBackfill(false);
  }

  console.log(`    placeholder rows inserted: ${backfillInserted}`);

  // ── Dry-run: show 18 sample classifications ──
  if (!EXECUTE) {
    console.log("\n[Sample — 18 books]");
    const withSlugs = magicRatings
      .map((r) => {
        const b = db
          .prepare(
            `SELECT b.slug, b.title, (SELECT GROUP_CONCAT(a.name, ', ') FROM book_authors ba JOIN authors a ON a.id = ba.author_id WHERE ba.book_id = b.id) as authors FROM books b WHERE b.id = ?`,
          )
          .get(r.book_id) as any;
        return { ...r, slug: b?.slug, title: b?.title, authors: b?.authors };
      })
      .filter((r) => r.slug);

    withSlugs.sort((a, b) => a.book_id.localeCompare(b.book_id));

    const classified = withSlugs.map((r) => ({ ...r, cls: classify(r.notes) }));
    const moves = classified.filter((r) => r.cls.kind === "move");
    const splits = classified.filter((r) => r.cls.kind === "split");
    const stays = classified.filter((r) => r.cls.kind === "stay" && r.intensity >= 2);

    const sample: typeof classified = [];
    // 6 moves across intensities
    for (const intensity of [1, 2, 3, 4]) {
      sample.push(...moves.filter((r) => r.intensity === intensity).slice(0, 2));
    }
    while (sample.length < 6 && moves.length > sample.filter((s) => s.cls.kind === "move").length) {
      const m = moves[sample.filter((s) => s.cls.kind === "move").length];
      if (!m) break;
      if (!sample.find((s) => s.book_id === m.book_id)) sample.push(m);
    }
    // 7 splits
    sample.push(...splits.slice(0, 7));
    // 5 stays (higher intensity, should be fantasy-only)
    sample.push(...stays.slice(0, 5));

    for (const r of sample) {
      console.log(`\n"${r.title}" — ${r.authors ?? "Unknown"}`);
      console.log(`  slug: ${r.slug}`);
      console.log(`  intensity: ${r.intensity}/4`);
      console.log(`  original note: ${r.notes}`);
      if (r.cls.kind === "move") {
        console.log(`  decision: MOVE → occult-only`);
        console.log(`  magic_witchcraft will become: 0/4, "${PLACEHOLDER_ZERO_NOTE}"`);
        console.log(`  occult_demonology will become: ${r.intensity}/4, "${r.notes}"`);
      } else if (r.cls.kind === "split") {
        console.log(`  decision: SPLIT → both`);
        console.log(`  magic_witchcraft stays: ${r.intensity}/4, "${r.notes}"`);
        console.log(`  occult_demonology gets: ${r.intensity}/4, "${synthesizeOccultNote(r.cls.occultTerms)}"`);
        console.log(`  (matched occult: ${r.cls.occultTerms.join(", ")}; matched fantasy: ${r.cls.fantasyTerms.join(", ")})`);
      } else {
        console.log(`  decision: STAY → magic-only (fantasy matches: ${r.cls.fantasyTerms.join(", ") || "(none)"})`);
      }
    }
  }

  // ── Summary ──
  console.log("\n" + "=".repeat(70));
  console.log(`Summary (${EXECUTE ? "APPLIED" : "dry-run"}):`);
  console.log(`  abuse_suffering updated:  ${abuseUpdated}`);
  console.log(`  abuse_suffering created:  ${abuseCreated}`);
  console.log(`  romance_sex notes:        ${romanceNotesUpdated}`);
  console.log(`  MOVE (occult-only):       ${moveCount}`);
  console.log(`  SPLIT (both):             ${splitCount}`);
  console.log(`  STAY (fantasy-only):      ${stayCount}`);
  console.log(`  backfill rows inserted:   ${backfillInserted}`);
  console.log("=".repeat(70));

  if (!EXECUTE) {
    console.log("\nRun with --execute to apply changes.");
  } else {
    console.log("\nMigration applied.");
  }

  db.close();
})();
