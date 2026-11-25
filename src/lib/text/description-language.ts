/**
 * Is this DESCRIPTION written in English?
 *
 * Why this exists (2026-11-25): every non-English safeguard in the pipeline
 * keyed on the book's TITLE (`isEnglishTitle`) or its `language` field. Neither
 * says anything about the description text. Skyward (Sanderson) had an English
 * title, language='English', and a Turkish canonical ISBN — so ISBN-keyed
 * lookups (ISBNdb / Google Books / OL edition) returned the Turkish edition's
 * blurb and every gate waved it through. The one description-level check,
 * `looksNonEnglish()` in sanitize.ts, needs 3+ CONSECUTIVE accented letters,
 * which Turkish, Spanish, German, Italian, Portuguese and Dutch prose almost
 * never produce (and ISBNdb often strips the diacritics anyway: "irkindan").
 *
 * Method: function-word frequencies. Every language's prose is ~30-45% short
 * grammatical words, and those words barely overlap across languages. We count
 * English function words against each candidate language's, ignoring tokens
 * that are function words in BOTH (a, in, an, is, en, de, to, die, so …).
 * Non-Latin scripts are caught by letter share. Short texts are not judged —
 * a false positive here blanks a real English description.
 *
 * `scripts/audit-description-language.ts` runs this over the live catalog;
 * check its hit list before tightening or widening a threshold.
 */

const EN = new Set(
  "the and of that his her with for as on be by this from but they she he it was are has have their who which will when into about not or all what its can been more after only must were had would there them through than then her him your our out up one over".split(" "),
);

/** Foreign function words. Anything that is also an English word is left out. */
const FOREIGN: Record<string, string[]> = {
  Spanish: "el los las del que una por con para como pero más sus es y se lo al este esta cuando sobre también ella él porque muy sin entre hasta donde años vida".split(" "),
  Portuguese: "não que uma com para os do da dos das em mais seu sua ele ela ao na no pelo pela também quando sobre muito sem entre até onde anos vida".split(" "),
  French: "le la les des du une est et que qui dans pour pas sur avec il elle son sa ses au aux ce cette mais plus sont été être leur elles ils où aussi tout très".split(" "),
  German: "der das und ist nicht ein eine mit sich auf für dem den von zu sie er auch wird aus bei nach wie einer eines seine ihre wenn noch nur über vor".split(" "),
  Italian: "il di che è la le un una per non con del della nel sono si gli ma anche più questo suo sua dei delle alla dalla come dopo tra".split(" "),
  Dutch: "de het een en van dat niet op met zijn voor ook maar aan er hij zij naar wordt hun haar bij door om worden deze".split(" "),
  Turkish: "bir ve bu ile için icin olan olarak çok cok daha gibi kadar ama sonra onun her değil degil ki olan oldu da de ona onu kendi yeni büyük".split(" "),
  Scandinavian: "och att det som är på för med av inte den til og er ikke af har han hon hun men om ett jeg vi".split(" "),
  Polish: "w z na nie się że do jest jak ale od po przez dla jego jej tym który która".split(" "),
  Indonesian: "yang dan di ini itu dengan untuk dari tidak dalam akan pada ke juga adalah oleh".split(" "),
};

/** Tokens that are function words in English AND elsewhere — never counted. */
const AMBIGUOUS = new Set("a an in is en de to die so me no son war also hat will man".split(" "));

const FOREIGN_SETS = Object.fromEntries(
  Object.entries(FOREIGN).map(([lang, words]) => [lang, new Set(words.filter((w) => !EN.has(w) && !AMBIGUOUS.has(w)))]),
) as Record<string, Set<string>>;

export interface DescriptionLanguageVerdict {
  english: boolean;
  /** Best-guess language when not English. */
  language: string | null;
  /** Rule that decided it — for audit output. */
  reason: string;
  englishHits: number;
  foreignHits: number;
  tokens: number;
}

const MIN_TOKENS = 15;

/**
 * Judges the OPENING (first ~700 chars) and the whole text (first 2,000) and
 * calls it foreign if either is. The opening pass catches bilingual retailer
 * blurbs — Spanish copy with the English publisher text appended after it —
 * which read as a foreign description on the page even though the whole is
 * half English.
 */
export function detectDescriptionLanguage(raw: string): DescriptionLanguageVerdict {
  // NFKC folds "fancy" Unicode letters (𝐌𝐢𝐝𝐧𝐢𝐠𝐡𝐭, ｆｕｌｌｗｉｄｔｈ) back to plain
  // Latin — otherwise styled English reads as a non-Latin script.
  const text = raw.normalize("NFKC");
  const opening = detectSample(text.slice(0, 700));
  if (!opening.english) return opening;
  return detectSample(text.slice(0, 2000));
}

function detectSample(sample: string): DescriptionLanguageVerdict {

  // Non-Latin scripts: share of letters that are not Latin.
  const letters = sample.match(/\p{L}/gu) ?? [];
  if (letters.length >= 20) {
    const nonLatin = letters.filter((c) => !/\p{Script=Latin}/u.test(c)).length;
    if (nonLatin / letters.length > 0.3) {
      return { english: false, language: "non-Latin script", reason: "non-latin-script", englishHits: 0, foreignHits: nonLatin, tokens: letters.length };
    }
  }

  const tokens = (sample.toLowerCase().match(/\p{L}+/gu) ?? []);
  if (tokens.length < MIN_TOKENS) {
    return { english: true, language: null, reason: "too-short", englishHits: 0, foreignHits: 0, tokens: tokens.length };
  }

  let en = 0;
  const counts: Record<string, number> = {};
  for (const t of tokens) {
    if (EN.has(t)) en++;
    for (const lang in FOREIGN_SETS) if (FOREIGN_SETS[lang].has(t)) counts[lang] = (counts[lang] ?? 0) + 1;
  }
  let best: string | null = null;
  let fHits = 0;
  for (const lang in counts) if (counts[lang] > fHits) { best = lang; fHits = counts[lang]; }

  const enRatio = en / tokens.length;
  const fRatio = fHits / tokens.length;
  // English prose runs ~0.20-0.35 on this list; foreign prose ~0-0.03.
  // Require BOTH a weak English signal and a clear foreign one, so an English
  // blurb with one quoted foreign line, or a list of names, is never flagged.
  const foreign = fHits >= 5 && fRatio >= 0.08 && fRatio > enRatio * 2;
  return {
    english: !foreign,
    language: foreign ? best : null,
    reason: foreign ? "function-words" : "english",
    englishHits: en,
    foreignHits: fHits,
    tokens: tokens.length,
  };
}

export function isEnglishDescription(text: string): boolean {
  return detectDescriptionLanguage(text).english;
}

/**
 * ISBN registration groups that are overwhelmingly NOT English-language
 * publishers. A canonical ISBN in one of these means the row is pointing at a
 * translated edition, and every ISBN-keyed lookup will return that edition's
 * blurb, cover, page count and publisher. Not proof on its own (English books
 * are published in Germany too), so callers combine it with the text check.
 * 978-0/1 and 979-8 are English; India (81/93), Singapore (981), etc. publish
 * lots of English and are deliberately absent.
 */
const NON_ENGLISH_ISBN_PREFIXES: [string, string][] = [
  ["9782", "French"], ["9783", "German"], ["9784", "Japanese"], ["9785", "Russian"], ["9787", "Chinese"],
  ["97884", "Spanish"], ["97885", "Portuguese"], ["97887", "Danish"], ["97888", "Italian"], ["97889", "Korean"],
  ["97890", "Dutch"], ["97894", "Dutch"], ["97891", "Swedish"], ["97882", "Norwegian"], ["97883", "Polish"],
  ["97880", "Czech/Slovak"], ["97886", "Serbian/Croatian"], ["978605", "Turkish"], ["978975", "Turkish"],
  ["978960", "Greek"], ["978963", "Hungarian"], ["978972", "Portuguese"], ["978973", "Romanian"],
  ["978950", "Argentine"], ["978956", "Chilean"], ["978958", "Colombian"], ["978968", "Mexican"], ["978970", "Mexican"],
  ["978607", "Mexican"], ["978612", "Peruvian"], ["978602", "Indonesian"], ["978623", "Indonesian"], ["978604", "Vietnamese"],
  ["978616", "Thai"], ["978974", "Thai"], ["978965", "Hebrew"], ["978964", "Persian"], ["978600", "Persian"],
  ["978951", "Finnish"], ["978952", "Finnish"], ["978966", "Ukrainian"], ["978617", "Ukrainian"], ["978954", "Bulgarian"],
  ["978986", "Taiwanese"], ["978957", "Taiwanese"], ["97965", "Brazilian"], ["97910", "French"], ["97911", "Korean"], ["97912", "Italian"],
];

/** Language of the ISBN's registration group, or null if English-or-unknown. */
export function nonEnglishIsbnGroup(isbn13: string | null | undefined): string | null {
  const s = (isbn13 ?? "").replace(/[^0-9]/g, "");
  if (s.length !== 13) return null;
  for (const [p, lang] of NON_ENGLISH_ISBN_PREFIXES) if (s.startsWith(p)) return lang;
  return null;
}
