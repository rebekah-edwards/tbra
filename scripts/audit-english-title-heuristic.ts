/**
 * audit-english-title-heuristic.ts
 *
 * `isEnglishTitle()` is load-bearing: enrich-book.ts hides a book from the
 * public catalog when it returns false. A false negative therefore deletes a
 * real book from search, silently.
 *
 * This replays BOTH the original rule set (as it stood on 2026-07-30) and the
 * current one over every locally-hidden book, and reports which books change
 * verdict and which rule was responsible. Read-only — it writes a report and
 * nothing else. `scripts/unhide-english-false-positives.ts` consumes it.
 *
 *   npx tsx scripts/audit-english-title-heuristic.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { whyNotEnglish } from "../src/lib/text/english-title";

/**
 * The rule set exactly as it was before the 2026-07-30 fix, kept here so the
 * audit can attribute each historical demotion to the rule that caused it.
 * Do not "tidy" this to match the new list — it is a historical record.
 */
const ORIGINAL_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "slavic-diacritics", re: /[łśźżćąęŁŚŹŻĆĄĘ]/ },
  { name: "nordic-chars", re: /[åæøÅÆØ]/ },
  { name: "german-chars", re: /[äöüÄÖÜß]/ },
  { name: "german-words", re: /\b(das|der|die|und|oder|für|über|ein|eine|vom|zur|zum|Tödliche|Lektion|Geschichte|Buch|erwacht|Geheimnis)\b/i },
  { name: "french-words", re: /\b(avec|dans|pour|une|fille|froide|lune|autres|mortels|pasteur|monde|héritage|incroyable|affreuse|meurtrière|charmante?|garce|allumeuse|pétard|nouvelle|nouvelle|trop|chance|maison|coeur|amour|nuit|jour|mort|petit|petite|grand|grande|noir|blanc|rouge|bleu|vert|vrai|faux|nouveau|beau|belle|jeune|vieux|haut|bas|seul|tout|même|autre|cher|chère)\b/i },
  { name: "french-article", re: /\b(le|la|les|du|des|au|aux|ce|cette|qui|est|sont|sur|par|en)\b(?=\s+[a-zà-ÿ])/i },
  { name: "spanish-words", re: /\b(del|los|las|por|como|desde|hacia|seus|sua|seu|mejor|amiga|amigo|sangre|fuego|ceniza|linaje|gracia|junto|monstruo|viene|verme|secreto|cuentos|comienzo|luchador|cumpleaños|pequeño|favor|aquí|casa|sal|lágrimas|cartas|diablo|caza|poder|reglas|estuche)\b/i },
  { name: "italian-words", re: /\b(nel|nella|della|degli|delle|dell|giardino|oscurità|sogni)\b/i },
  { name: "dutch-words", re: /\b(het|een|van|zij|haar|hij|zijn|priester|ontsnapping|echtgenoten|mandolinespeler|verzamelde|werken|bijbel|nachtegaal|boomgaard|ellendigen|mevrouw)\b/i },
  { name: "foreign-leading-article", re: /^(El|Lo|Gli|Een|Het|Las|Los|Une)\s+\w/i },
  { name: "leading-un", re: /^Un\s+[a-záéíóúñ]/i },
  { name: "foreign-edition-marker", re: /\bédition\b|\bTeil\b|\bBand\b|\bTome\b|\bTomo\b|\bLivre\b|\blivro\b|\bSérie\b/i },
  { name: "foreign-suffix", re: /\b\w+(zione|ción|ção|heit|keit|ung|eux|euse|eux|isse)\b/i },
  { name: "foreign-box-set", re: /^(Estuche|Coffret)\s/i },
  { name: "two-accented-words", re: /\b\w*[à-ëí-ïñ-öù-ü]\w*\b.*\b\w*[à-ëí-ïñ-öù-ü]\w*\b/ },
  { name: "enye", re: /\b\w*[ñÑ]\w*\b/ },
  { name: "accented-word", re: /\b[A-ZÀ-ß][a-zà-ÿ]*[à-ëí-ïò-öù-ü][a-zà-ÿ]+\b/i },
];

const ORIGINAL_WHITELIST =
  /\b(Brontë|Horrorstör|Brené|café|Café|naïve|résumé|Doré|André|fiancé|fiancée|cliché|décor|début|Beyoncé|Pokémon)\b/i;

function originalVerdict(title: string): string | null {
  const asciiChars = title.replace(/[^a-zA-Z]/g, "").length;
  const totalChars = title.replace(/[^a-zA-ZÀ-ɏЀ-ӿ一-鿿؀-ۿ֐-׿가-힯぀-ヿ]/g, "").length;
  if (totalChars > 0 && asciiChars / totalChars <= 0.8) return "non-ascii-script";
  const stripped = title.replace(ORIGINAL_WHITELIST, "");
  for (const p of ORIGINAL_PATTERNS) if (p.re.test(stripped)) return p.name;
  return null;
}

const db = new Database(path.join(process.cwd(), "data", "tbra.db"));
db.pragma("journal_mode = WAL");

const hidden = db
  .prepare(
    `SELECT id, title, slug, language, isbn_13, description, is_box_set, visibility
     FROM books WHERE visibility = 'import_only'`,
  )
  .all() as {
  id: string;
  title: string;
  slug: string | null;
  language: string | null;
  isbn_13: string | null;
  description: string | null;
  is_box_set: number;
  visibility: string;
}[];

console.log(`Locally hidden (import_only) books: ${hidden.length}`);

const byOldRule: Record<string, number> = {};
const rescued: typeof hidden = [];
const stillFlagged: typeof hidden = [];

for (const b of hidden) {
  const oldV = originalVerdict(b.title);
  const newV = whyNotEnglish(b.title);
  if (oldV) byOldRule[oldV] = (byOldRule[oldV] ?? 0) + 1;
  if (oldV && !newV) rescued.push(b);
  else if (newV) stillFlagged.push(b);
}

console.log(`\nWhich ORIGINAL rule flagged each hidden book:`);
for (const [rule, n] of Object.entries(byOldRule).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${rule.padEnd(26)} ${n}`);
}

console.log(`\nFlagged by OLD rules but NOT by the new ones: ${rescued.length}`);
console.log(`Still flagged by the new rules:                ${stillFlagged.length}`);

// A title-heuristic rescue is only safe to act on when the language field
// agrees it is English. Anything else stays hidden pending human review.
const englishLabelled = rescued.filter((b) => b.language === "English" || b.language === "eng");
const otherLanguage = rescued.filter((b) => !(b.language === "English" || b.language === "eng"));

console.log(`\n  of those rescued:`);
console.log(`    language = English  -> safe to un-hide: ${englishLabelled.length}`);
console.log(`    other/blank language -> leave hidden:   ${otherLanguage.length}`);

console.log(`\nSample of rescued + English-labelled:`);
for (const b of englishLabelled.slice(0, 25)) {
  console.log(`  "${b.title}"  [was: ${originalVerdict(b.title)}]`);
}

const ts = new Date().toISOString().replace(/[:.]/g, "-");
const out = path.join(process.cwd(), "reports", `english-heuristic-audit-${ts}.json`);
fs.writeFileSync(
  out,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      hiddenTotal: hidden.length,
      byOriginalRule: byOldRule,
      rescuedTotal: rescued.length,
      safeToUnhide: englishLabelled.map((b) => ({
        id: b.id,
        title: b.title,
        slug: b.slug,
        language: b.language,
        originalRule: originalVerdict(b.title),
      })),
      rescuedButNotEnglishLabelled: otherLanguage.map((b) => ({
        id: b.id,
        title: b.title,
        language: b.language,
        originalRule: originalVerdict(b.title),
      })),
    },
    null,
    2,
  ),
);
console.log(`\nReport: ${out}`);
