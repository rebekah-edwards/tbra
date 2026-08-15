/**
 * Regression check for `src/lib/text/edition-title.ts`.
 *
 * Seven ingestion paths now depend on that one regex to decide whether an
 * incoming title is a new book or an edition of one we already have. Widening
 * it merges genuinely different products; narrowing it lets duplicate entries
 * back in. Run this after ANY change to the decoration list.
 *
 *   npx tsx scripts/check-edition-title-rules.ts
 */
import {
  editionMatchKey,
  extractEditionLabel,
  isDecoratedTitle,
} from "../src/lib/text/edition-title";

/** Decorated title -> the canon it must collapse onto. */
const SHOULD_MATCH: [string, string][] = [
  ["Unravel Me Paperback Deluxe Limited Edition", "Unravel Me"],
  ["Shatter Me Collector's Deluxe Limited Edition", "Shatter Me"],
  ["Howl's Moving Castle Deluxe Limited Edition", "Howl's Moving Castle"],
  ["Dungeon Crawler Carl: Deluxe Edition", "Dungeon Crawler Carl"],
  ["The Hobbit: 75th Anniversary Edition", "The Hobbit"],
  ["Ready Player One (Movie Tie-In)", "Ready Player One"],
  ["Jane Eyre - Large Print Edition", "Jane Eyre"],
  ["Never Never Collector's Edition", "Never Never"],
  ["Check and Mate SIGNED", "Check and Mate"],
  ["Hunting Adeline International Edition", "Hunting Adeline"],
  ["Ben-Hur Illustrated", "Ben-Hur"],
  ["Gambler (Annotated)", "Gambler"],
  // "1st" is a printing marker over the same text — see the ordinal note in
  // EDITION_SUFFIX for why only the FIRST ordinal is stripped.
  ["Worlds Fair 1ST Edition", "World's Fair"],
  ["E IS FOR EVIDENCE Signed 1st", "\"E\" is for Evidence"],
  ["H Is for Homicide 1ST Edition", "H Is for Homicide"],
];

/**
 * Merging any of these would destroy a real distinction. Collections, box
 * sets, omnibuses and sequels are DIFFERENT PRODUCTS, and a decoration word
 * that appears mid-title ("Special Topics…", "The Illustrated Man") is part of
 * the title, not decoration.
 */
const MUST_NOT_MATCH: [string, string][] = [
  ["Shatter Me: the Six-Novel Collection", "Shatter Me"],
  ["Harry Potter Box Set", "Harry Potter"],
  ["The Sandman Omnibus", "The Sandman"],
  ["Dune Messiah", "Dune"],
  ["Throne of Glass Book 2", "Throne of Glass"],
  ["Special Topics in Calamity Physics", "Calamity Physics"],
  ["The Illustrated Man", "Man"],
  // Ordinals ABOVE 1st mark revised content, not a printing. Annual reference
  // works are the reason: a general ordinal rule collapsed five distinct
  // Overstreet price guides into one entry (audited 2026-08-15). If someone
  // widens EDITION_SUFFIX to all ordinals, these fail loudly.
  ["The Official Overstreet Comic Book Price Guide, 27th Edition", "The Official Overstreet Comic Book Price Guide, 32nd Edition"],
  ["The Official Overstreet Identification and Price Guide to Indian Arrowheads 10th Edition", "The Official Overstreet Identification and Price Guide to Indian Arrowheads, 14th Edition"],
  ["Normal Life 2nd Edition", "Normal Life"],
  // A Young Readers Edition is a REWRITTEN, abridged text for a younger
  // audience — materially different content, which for a content-ratings app
  // is precisely the thing that must not be merged away.
  ["The Disappearing Spoon, Young Readers Edition", "The Disappearing Spoon"],
];

const UNDECORATED = [
  "Unravel Me",
  "The Hobbit",
  "Dune",
  "Special Topics in Calamity Physics",
  "The Illustrated Man",
];

let failures = 0;
const fail = (msg: string) => {
  failures++;
  console.log(`FAIL ${msg}`);
};

for (const [decorated, canon] of SHOULD_MATCH) {
  if (editionMatchKey(decorated) !== editionMatchKey(canon)) {
    fail(`"${decorated}" should collapse onto "${canon}"`);
  } else if (!extractEditionLabel(decorated)) {
    fail(`"${decorated}" collapsed but produced no edition label`);
  }
}

for (const [a, b] of MUST_NOT_MATCH) {
  if (editionMatchKey(a) === editionMatchKey(b)) {
    fail(`"${a}" must stay distinct from "${b}"`);
  }
}

for (const t of UNDECORATED) {
  if (isDecoratedTitle(t)) fail(`"${t}" must not be treated as decorated`);
}

console.log(
  failures === 0
    ? `ALL PASS (${SHOULD_MATCH.length} collapse, ${MUST_NOT_MATCH.length} distinct, ${UNDECORATED.length} undecorated)`
    : `${failures} FAILURES`,
);
process.exit(failures === 0 ? 0 : 1);
