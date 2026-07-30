/**
 * Is this title English?
 *
 * Used to keep foreign-language editions out of search results and out of the
 * public catalog (src/lib/enrichment/enrich-book.ts demotes a book to
 * visibility='import_only' when this returns false and no user has it shelved).
 *
 * Because a false negative HIDES a real book, every rule here is named, and
 * `whyNotEnglish()` reports which one fired — run
 * `scripts/audit-english-title-heuristic.ts` to see the hit distribution over
 * the real catalog before adding or widening a rule.
 *
 * Catches:
 * - Non-ASCII scripts (Cyrillic, CJK, Arabic, etc.)
 * - Common non-English Latin-alphabet markers (accented words, foreign
 *   articles/prepositions)
 */

export interface TitleRule {
  name: string;
  re: RegExp;
}

/**
 * Words that are spelled the same in English and in some other language.
 * Matching these alone is not evidence of anything — "Die" in "Die for Me",
 * "Van" in "Van Helsing", "Noir" in "Noir Classics", "Band"/"Tome" as ordinary
 * English nouns. They are excluded from the foreign-word rules below; a real
 * foreign title almost always supplies a second, unambiguous signal.
 */
export const NON_ENGLISH_RULES: TitleRule[] = [
  // Polish/Czech/Slavic diacritics — virtually never in English titles
  { name: "slavic-diacritics", re: /[łśźżćąęŁŚŹŻĆĄĘ]/ },
  // Nordic-specific characters — very rare in English titles
  { name: "nordic-chars", re: /[åæøÅÆØ]/ },
  // German-specific characters
  { name: "german-chars", re: /[äöüÄÖÜß]/ },
  // German words/markers. "die"/"der"/"das" are excluded — "Die" is an ordinary
  // English verb ("Die for Me", "Only the Good Die Young") and was the single
  // largest source of wrongly-hidden English books.
  {
    name: "german-words",
    re: /\b(und|oder|für|über|eine|vom|zur|zum|Tödliche|Lektion|Geschichte|Buch|erwacht|Geheimnis)\b/i,
  },
  // German article + lowercase German-looking word (keeps real German titles
  // like "Das Boot" while ignoring English "The Die Is Cast").
  { name: "german-article", re: /\b(das|der|die|ein)\s+[a-zäöüß]+\b(?=\s|$)/ },
  // French articles/prepositions/words. Removed from this list because they are
  // also ordinary English words: noir, chance, mort, jour, tout, bas, haut,
  // grand, beau, vert, blanc, rouge, bleu, seul, autre, cher.
  {
    name: "french-words",
    re: /\b(avec|dans|pour|une|fille|froide|lune|autres|mortels|pasteur|monde|héritage|incroyable|affreuse|meurtrière|charmante?|garce|allumeuse|pétard|maison|coeur|amour|nuit|petite|grande|vrai|faux|nouveau|belle|jeune|vieux|même|chère)\b/i,
  },
  { name: "french-article", re: /\b(le|la|les|du|des|au|aux|ce|cette|qui|est|sont|sur|par|en)\b(?=\s+[a-zà-ÿ])/i },
  // Spanish/Portuguese. Removed: casa, sal, poder, caza, favor, como — all
  // ordinary English words or common English proper nouns.
  {
    name: "spanish-words",
    re: /\b(del|los|las|por|desde|hacia|seus|sua|seu|mejor|amiga|amigo|sangre|fuego|ceniza|linaje|gracia|junto|monstruo|viene|verme|secreto|cuentos|comienzo|luchador|cumpleaños|pequeño|aquí|lágrimas|cartas|diablo|reglas|estuche)\b/i,
  },
  // Italian
  { name: "italian-words", re: /\b(nel|nella|della|degli|delle|dell|giardino|oscurità|sogni)\b/i },
  // Dutch. Removed "van" — "Van Helsing", "Van Gogh", "Vincent van Gogh" are
  // English titles; and "haar"/"zijn"/"hij"/"zij" only when adjacent to other
  // Dutch markers, handled by the article rule.
  {
    name: "dutch-words",
    re: /\b(het|een|priester|ontsnapping|echtgenoten|mandolinespeler|verzamelde|werken|bijbel|nachtegaal|boomgaard|ellendigen|mevrouw)\b/i,
  },
  // Titles starting with non-English articles (followed by a word)
  { name: "foreign-leading-article", re: /^(El|Lo|Gli|Een|Het|Las|Los|Une)\s+\w/i },
  // "Un " at start followed by clearly non-English word (not "Un-" prefix)
  { name: "leading-un", re: /^Un\s+[a-záéíóúñ]/i },
  // Edition markers in other languages. "Band" and "Tome" are ordinary English
  // nouns ("The Band", "Tome of Secrets") — require the accented/unambiguous
  // forms instead.
  { name: "foreign-edition-marker", re: /\bédition\b|\bTeil\b|\bTomo\b|\bLivre\b|\blivro\b|\bSérie\b/i },
  // Common non-English suffixes (words ending in -zione, -ción, -ção, -heit, -keit, -ung).
  // "-ung" removed: it matches English "Young", "Sung", "Lung", "Hung", "Slung".
  { name: "foreign-suffix", re: /\b\w+(zione|ción|ção|heit|keit|eux|euse|isse)\b/i },
  // Titles starting with "Estuche" (Spanish box set) or "Coffret" (French box set)
  { name: "foreign-box-set", re: /^(Estuche|Coffret)\s/i },
  // Words with accented characters (any word containing ö, ü, ä, è, ê, ë, ñ, etc.)
  // Two+ accented words is almost certainly non-English
  { name: "two-accented-words", re: /\b\w*[à-ëí-ïñ-öù-ü]\w*\b.*\b\w*[à-ëí-ïñ-öù-ü]\w*\b/ },
  // Single accented word that's clearly not an English loanword (handles mixed/uppercase)
  { name: "enye", re: /\b\w*[ñÑ]\w*\b/ }, // ñ is almost never in English words
  { name: "accented-word", re: /\b[A-ZÀ-ß][a-zà-ÿ]*[à-ëí-ïò-öù-ü][a-zà-ÿ]+\b/i },
];

// English words/names that contain diacritics — must not trigger false positives
export const ENGLISH_WHITELIST =
  /\b(Brontë|Horrorstör|Brené|café|Café|naïve|résumé|Doré|André|fiancé|fiancée|cliché|décor|début|Beyoncé|Pokémon|Zoë|Chloë|Noël|Renée|Aimée|Salomé|Møller|Öther)\b/i;

/**
 * Returns the name of the rule that judged this title non-English, or null if
 * it looks English. Prefer this over isEnglishTitle when you need to explain or
 * audit a decision.
 */
export function whyNotEnglish(title: string): string | null {
  // First: check for non-ASCII scripts (Cyrillic, CJK, Arabic, etc.)
  const asciiChars = title.replace(/[^a-zA-Z]/g, "").length;
  const totalChars = title.replace(
    /[^a-zA-ZÀ-ɏЀ-ӿ一-鿿؀-ۿ֐-׿가-힯぀-ヿ]/g,
    "",
  ).length;
  if (totalChars > 0 && asciiChars / totalChars <= 0.8) return "non-ascii-script";

  // Strip whitelisted English words before checking non-English patterns
  const stripped = title.replace(ENGLISH_WHITELIST, "");

  // Second: check for common non-English Latin-alphabet patterns
  for (const rule of NON_ENGLISH_RULES) {
    if (rule.re.test(stripped)) return rule.name;
  }

  return null;
}

export function isEnglishTitle(title: string): boolean {
  return whyNotEnglish(title) === null;
}
