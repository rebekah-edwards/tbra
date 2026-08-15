/**
 * Audit what widening EDITION_SUFFIX would actually do to the catalog.
 *
 * EDITION_SUFFIX decides which trailing words count as edition decoration, and
 * therefore which titles collapse onto the same match key and get merged. It is
 * the matching rule for EVERY ingestion path, so adding an alternative can
 * silently merge two books that are not the same work. This measures the blast
 * radius of a candidate addition before anyone edits the shared regex.
 *
 * For each candidate it reports:
 *   - how many titles change match key at all
 *   - the NEW merge groups created (books that would now fold together but
 *     don't today) — this is the number that matters
 *   - every such group printed in full, so the merges can be judged by eye
 *
 *   npx tsx scripts/audit-edition-suffix-widening.ts
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import Database from "better-sqlite3";
import { normalizeTitle, normalizeAuthor } from "../src/lib/text/edition-title";

/** The alternatives currently in EDITION_SUFFIX (src/lib/text/edition-title.ts). */
const CURRENT = [
  String.raw`(?:the\s+)?(?:\d+(?:st|nd|rd|th)\s+)?anniversary`,
  String.raw`paperback`,
  String.raw`hardcover|hardback`,
  String.raw`mass market`,
  String.raw`large (?:print|type)`,
  String.raw`deluxe`,
  String.raw`limited`,
  String.raw`collectors?`,
  String.raw`collector s`,
  String.raw`special`,
  String.raw`exclusive`,
  String.raw`signed`,
  String.raw`illustrated`,
  String.raw`annotated`,
  String.raw`unabridged|abridged`,
  String.raw`revised`,
  String.raw`expanded`,
  String.raw`international|intl`,
  String.raw`(?:movie|media|tv|film)\s+tie\s*in`,
  String.raw`reissue`,
  String.raw`edition`,
];

const CANDIDATES: { name: string; extra: string[] }[] = [
  { name: "bare ordinal (1st / 2nd / 10th)", extra: [String.raw`\d+(?:st|nd|rd|th)`] },
  { name: "young readers", extra: [String.raw`young readers?`] },
  // Refinement: "1st" marks a PRINTING (a collector's distinction — same text),
  // whereas 2nd and higher mark REVISED CONTENT. Annual reference works are the
  // proof: the 27th and 32nd Overstreet price guides are different books.
  { name: "FIRST ordinal only (1st)", extra: [String.raw`1st`] },
];

function makeStripper(alts: string[]) {
  const re = new RegExp(`(?:\\s+(?:${alts.join("|")}))$`);
  return (normalized: string) => {
    let prev = normalized;
    for (;;) {
      const next = prev.replace(re, "").trim();
      if (next === prev) break;
      prev = next;
    }
    return prev.length > 0 ? prev : normalized;
  };
}

const stripCurrent = makeStripper(CURRENT);

type Row = { id: string; title: string; author_name: string | null; users: number; visibility: string };

const db = new Database("data/tbra.db", { readonly: true });
const rows = db
  .prepare(
    `SELECT b.id, b.title, b.visibility,
            (SELECT a.name FROM authors a JOIN book_authors ba ON ba.author_id = a.id
              WHERE ba.book_id = b.id ORDER BY a.name LIMIT 1) AS author_name,
            (SELECT COUNT(*) FROM user_book_state WHERE book_id = b.id) AS users
     FROM books b WHERE b.is_box_set = 0`,
  )
  .all() as Row[];

console.log(`Catalog: ${rows.length.toLocaleString()} books (box sets excluded)\n`);

const keyOf = (strip: (s: string) => string, r: Row) =>
  `${strip(normalizeTitle(r.title)).replace(/ /g, "")}|||${normalizeAuthor(r.author_name ?? "")}`;

// Baseline grouping.
const baseGroups = new Map<string, Row[]>();
for (const r of rows) {
  if (!r.title || !r.author_name) continue;
  const k = keyOf(stripCurrent, r);
  if (!baseGroups.has(k)) baseGroups.set(k, []);
  baseGroups.get(k)!.push(r);
}

for (const cand of CANDIDATES) {
  const strip = makeStripper([...CURRENT, ...cand.extra]);

  let keyChanged = 0;
  const newGroups = new Map<string, Row[]>();
  for (const r of rows) {
    if (!r.title || !r.author_name) continue;
    const before = keyOf(stripCurrent, r);
    const after = keyOf(strip, r);
    if (before !== after) keyChanged++;
    if (!newGroups.has(after)) newGroups.set(after, []);
    newGroups.get(after)!.push(r);
  }

  // A group is NEWLY merged when its members were not already in one baseline
  // group together. That — not the raw key-change count — is what actually
  // causes books to be folded into each other.
  const newlyMerged: Row[][] = [];
  for (const [, g] of newGroups) {
    if (g.length < 2) continue;
    const baseKeys = new Set(g.map((r) => keyOf(stripCurrent, r)));
    if (baseKeys.size > 1) newlyMerged.push(g);
  }

  console.log("=".repeat(78));
  console.log(`CANDIDATE: ${cand.name}`);
  console.log("=".repeat(78));
  console.log(`  titles whose match key changes: ${keyChanged}`);
  console.log(`  NEW merge groups created:       ${newlyMerged.length}`);
  const affected = newlyMerged.reduce((n, g) => n + g.length, 0);
  const withUsers = newlyMerged.reduce((n, g) => n + g.filter((r) => r.users > 0).length, 0);
  console.log(`  books pulled into those groups: ${affected}  (with user rows: ${withUsers})\n`);

  for (const g of newlyMerged) {
    console.log(`  ${g[0].author_name}`);
    for (const r of g) {
      console.log(
        `     "${r.title}"  [${r.visibility}${r.users ? `, ${r.users} user${r.users > 1 ? "s" : ""}` : ""}]`,
      );
    }
    console.log("");
  }
}
