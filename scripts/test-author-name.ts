/**
 * Unit-style cases for src/lib/text/author-name.ts.
 *
 *   npx tsx scripts/test-author-name.ts
 *
 * Exits 1 on the first run that has any failure. No DB, no network.
 * Add a case here whenever a new shape of author string shows up in the
 * catalogue — the normaliser is shared by every import path, so a regression
 * here is a regression everywhere.
 */
import { analyzeAuthorName, normalizeAuthorName, splitAuthorList } from "../src/lib/text/author-name";

let failed = 0;
let passed = 0;

function eq(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    passed++;
  } else {
    failed++;
    console.log(`✗ ${label}\n    got  ${g}\n    want ${w}`);
  }
}

/** [input, expected output] */
const NAME_CASES: Array<[string, string]> = [
  // ── plain inversions ──
  ["Edwards, Rebekah", "Rebekah Edwards"],
  ["Yarros, Rebecca", "Rebecca Yarros"],
  ["Sanderson, Brandon", "Brandon Sanderson"],
  ["Allen, Nancy Campbell", "Nancy Campbell Allen"],
  ["Huffington, Arianna Stassinopoulos", "Arianna Stassinopoulos Huffington"],
  ["Anderson, M. T.", "M. T. Anderson"],
  ["Stedman, M.L.", "M.L. Stedman"],
  ["Davenport, Thomas H.", "Thomas H. Davenport"],
  ["Tolkien, J. R. R.", "J. R. R. Tolkien"],
  ["Rowling, J.K.", "J.K. Rowling"],
  ["Larroca,Salvador", "Salvador Larroca"],
  ["  Dekker ,  Ted ", "Ted Dekker"],
  ["O'Brien, John", "John O'Brien"],
  ["Ōyama, Masutatsu.", "Masutatsu Ōyama"],
  ["García Márquez, Gabriel", "Gabriel García Márquez"],
  ["Conan Doyle, Arthur", "Arthur Conan Doyle"],
  ["Le Guin, Ursula K.", "Ursula K. Le Guin"],
  ["de la Cruz, Melissa", "Melissa de la Cruz"],
  ["Van Der Kolk, Bessel", "Bessel Van Der Kolk"],
  ["St. John Mandel, Emily", "Emily St. John Mandel"],
  ["Beethoven, Ludwig van", "Ludwig van Beethoven"],
  ["Smith-Jones, Anne-Marie", "Anne-Marie Smith-Jones"],
  ["Seuss, Dr.", "Dr. Seuss"],

  // ── catalogue punctuation, dates, roles ──
  ["Coburn, Andrew.", "Andrew Coburn"],
  ["Shepherd, Michael.", "Michael Shepherd"],
  ["Tolkien, J. R. R., 1892-1973", "J. R. R. Tolkien"],
  ["Kennedy, Daniel Joseph, 1862-1930", "Daniel Joseph Kennedy"],
  ["Warrack, Grace Harriet, 1855-1932", "Grace Harriet Warrack"],
  ["Atwood, Margaret, 1939-", "Margaret Atwood"],
  ["Chaucer, Geoffrey, d. 1400", "Geoffrey Chaucer"],
  ["Smith, John (Editor)", "John Smith"],
  ["Smith, John, editor", "John Smith"],
  ["Smith, John, ed.", "John Smith"],
  ["Albarran, Juan (Comic book artist)", "Juan Albarran"],
  ["Marrs, John (Freelance journalist)", "John Marrs"],
  ["Stevenson, D. E. (Dorothy Emily)", "D. E. Stevenson"],
  ["Cave, Julie (Novelist)", "Julie Cave"],
  ["John Smith (Editor)", "John Smith"],
  ["Jane Doe (Illustrator)", "Jane Doe"],
  ["Harry Turtledove (ed.)", "Harry Turtledove"],

  // ── shouting ──
  ["KING, Joe", "Joe King"],
  ["SMITH, JOHN", "John Smith"],

  // ── suffixes ──
  ["King, Martin Luther, Jr.", "Martin Luther King Jr."],
  ["King, Martin Luther Jr.", "Martin Luther King Jr."],
  ["King Jr., Martin Luther", "Martin Luther King Jr."],
  ["Smith, John, III", "John Smith III"],
  ["Stewart, Charles, III", "Charles Stewart III"],
  ["Layton, Bob, Jr.", "Bob Layton Jr."],
  ["Gutierrez, Manuel, IV", "Manuel Gutierrez IV"],
  // already natural order — the comma is legitimate, leave it
  ["Horatio Alger, Jr.", "Horatio Alger, Jr."],
  ["James Tiptree, Jr.", "James Tiptree, Jr."],
  ["Pascal Covici, Jr.", "Pascal Covici, Jr."],
  ["Martin Luther King Jr.", "Martin Luther King Jr."],
  // OpenLibrary's mangled suffix placement
  ["Boy F., Jr. Petersen", "Boy F. Petersen Jr."],
  ["Herbert A., II Beas", "Herbert A. Beas II"],
  ["Jose, Jr. Marzan", "Jose Marzan Jr."],
  ["Alan L., MD Rubin", "Alan L. Rubin"],
  ["Caroline J., Simon", "Caroline J. Simon"],

  // ── credentials ──
  ["Daniel J. Siegel, MD", "Daniel J. Siegel"],
  ["Anna Lembke, MD", "Anna Lembke"],
  ["Terri Cole, MSW, LCSW", "Terri Cole"],
  ["Jeremy Robinson, MSW, MCC", "Jeremy Robinson"],
  ["Jane Roe, Ph.D.", "Jane Roe"],

  // ── the same name twice ──
  ["Leila Russo, Leila Russo", "Leila Russo"],
  ["J.R.R. Tolkien, J.R.R. Tolkien", "J.R.R. Tolkien"],

  // ── MUST NOT flip: organisations ──
  ["Disney Book Group", "Disney Book Group"],
  ["Harvard Business Review, Inc.", "Harvard Business Review, Inc."],
  ["Anderson Galleries, Inc", "Anderson Galleries, Inc"],
  ["Sotheby & Co. (London, England)", "Sotheby & Co. (London, England)"],
  ["Safety-Critical Systems Symposium (9th 2001 Bristol, England)", "Safety-Critical Systems Symposium (9th 2001 Bristol, England)"],
  ["Press, Oxford University", "Press, Oxford University"],
  ["National Geographic Society", "National Geographic Society"],

  // ── MUST NOT flip: several people in one string ──
  ["Smith, Jones, and Lee", "Smith, Jones, and Lee"],
  ["Agatha Christie, Sophie Hannah", "Agatha Christie, Sophie Hannah"],
  ["Brandon Sanderson, Janci Patterson", "Brandon Sanderson, Janci Patterson"],
  ["S.T. Joshi, H.P. Lovecraft", "S.T. Joshi, H.P. Lovecraft"],
  ["Bruce D. Perry, Oprah Winfrey", "Bruce D. Perry, Oprah Winfrey"],
  ["Lauren Willig, Karen White, Beatriz Williams", "Lauren Willig, Karen White, Beatriz Williams"],
  ["STEWART, PAUL, RIDDELL, CHRIS", "STEWART, PAUL, RIDDELL, CHRIS"],
  ["Philpott, Kent Allan, Philpott, Katie L. C.", "Philpott, Kent Allan, Philpott, Katie L. C."],
  ["Foxe, John, and King, Marie Gentert (editor)", "Foxe, John, and King, Marie Gentert (editor)"],
  ["Lindsay, Jeffry P./ Murillo, Eduardo G. (TRN)", "Lindsay, Jeffry P./ Murillo, Eduardo G. (TRN)"],
  ["Jimmy; Gray, Justin Palmiotti", "Jimmy; Gray, Justin Palmiotti"],
  ["WILLIAMS,BELASCO&MEYERS", "WILLIAMS,BELASCO&MEYERS"],
  ["Lecrae, Lecrae Moore", "Lecrae, Lecrae Moore"],

  // ── MUST NOT flip: titles and phrases ──
  ["Prince Harry, Duke of Sussex", "Prince Harry, Duke of Sussex"],
  ["Eusebius of Caesarea, Bishop of Caesarea", "Eusebius of Caesarea, Bishop of Caesarea"],
  ["Athanasius Saint, Patriarch of Alexandria", "Athanasius Saint, Patriarch of Alexandria"],
  ["Fullerton, Georgiana Lady", "Fullerton, Georgiana Lady"],
  ["Douglas, Gertrude Lady.", "Douglas, Gertrude Lady."],
  ["Morris, Heather teacher.", "Morris, Heather teacher."],
  ["Evfimii͡a, [Pashchenko], monakhini͡a", "Evfimii͡a, [Pashchenko], monakhini͡a"],

  // ── already fine ──
  ["Rebekah Edwards", "Rebekah Edwards"],
  ["J.R.R. Tolkien", "J.R.R. Tolkien"],
  ["Madonna", "Madonna"],
  ["Andre 3000", "Andre 3000"],
  ["50 Cent", "50 Cent"],
  ["", ""],
];

for (const [input, want] of NAME_CASES) {
  eq(`normalizeAuthorName(${JSON.stringify(input)})`, normalizeAuthorName(input), want);
}

// Idempotence — running the output back through must change nothing.
for (const [input] of NAME_CASES) {
  const once = normalizeAuthorName(input);
  eq(`idempotent(${JSON.stringify(input)})`, normalizeAuthorName(once), once);
}

// Actions are reported correctly (the sweep groups on these).
eq("action flipped", analyzeAuthorName("Yarros, Rebecca").action, "flipped");
eq("action unchanged", analyzeAuthorName("Rebecca Yarros").action, "unchanged");
eq("action cleaned", analyzeAuthorName("Daniel J. Siegel, MD").action, "cleaned");
eq("action declined", analyzeAuthorName("Agatha Christie, Sophie Hannah").action, "declined");
eq("declined reason", analyzeAuthorName("Agatha Christie, Sophie Hannah").reason, "multiple-authors");
eq("organisation reason", analyzeAuthorName("Anderson Galleries, Inc").reason, "organisation");
eq("suffix unchanged", analyzeAuthorName("Horatio Alger, Jr.").action, "unchanged");

/** [input, commaSeparated, expected list] */
const LIST_CASES: Array<[string, boolean, string[]]> = [
  // StoryGraph / Libby / Goodreads "additional authors": natural order, comma-joined
  ["Agatha Christie, Sophie Hannah", true, ["Agatha Christie", "Sophie Hannah"]],
  ["Brandon Sanderson", true, ["Brandon Sanderson"]],
  ["Leila Russo, Leila Russo", true, ["Leila Russo"]],
  ["Pascal Covici, Jr.", true, ["Pascal Covici, Jr."]],
  ["Shane Hawk, Theodore C. Van Alst Jr.", true, ["Shane Hawk", "Theodore C. Van Alst Jr."]],
  ["Daniel J. Siegel, MD, Tina Payne Bryson", true, ["Daniel J. Siegel", "Tina Payne Bryson"]],
  ["Helen L. Taylor, Helen L. Taylor, John Bunyan, Joe Sutphin", true, ["Helen L. Taylor", "John Bunyan", "Joe Sutphin"]],
  ["Harry Turtledove (ed.), John Joseph Adams", true, ["Harry Turtledove", "John Joseph Adams"]],
  ["Lecrae, Lecrae Moore", true, ["Lecrae", "Lecrae Moore"]],
  ["Madonna; Cher", true, ["Madonna", "Cher"]],
  ["", true, []],
  // catalogue sources: only ";" separates, each piece is normalised
  ["Smith, John; Doe, Jane", false, ["John Smith", "Jane Doe"]],
  ["Yarros, Rebecca", false, ["Rebecca Yarros"]],
  ["Rebecca Yarros", false, ["Rebecca Yarros"]],
  ["Agatha Christie, Sophie Hannah", false, ["Agatha Christie, Sophie Hannah"]],
];

for (const [input, commaSeparated, want] of LIST_CASES) {
  eq(
    `splitAuthorList(${JSON.stringify(input)}, {commaSeparated:${commaSeparated}})`,
    splitAuthorList(input, { commaSeparated }),
    want,
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
