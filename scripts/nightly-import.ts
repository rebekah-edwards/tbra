/**
 * Nightly import script — imports popular books into the tbra database.
 * Runs with: npx tsx scripts/nightly-import.ts  (TARGET_BOOKS caps net additions)
 *
 * PRIMARY engine (added 2026-06-01): paginated OpenLibrary subject feeds. Each
 * subject (Christian fiction weighted heaviest) exposes thousands of works; a
 * persisted per-subject offset in data/subject-offsets.json makes every run page
 * deeper, so discovery no longer dries up. See SUBJECTS / fetchSubjectWorks.
 *
 * LEGACY engine (kept as a top-up safety net): a static list of curated search
 * queries. Structurally capped — each query imports only its single top result —
 * which is why nightly volume collapsed to near-zero by late May 2026.
 *
 * Both feed importBook(), which dedups, enriches, and cascade-imports a
 * discovered author's backlist (capped per author).
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { existsSync, readFileSync, writeFileSync } from "fs";

// This script does not use createGuardedTurso (it writes locally, then a
// separate sync-push mirrors up), so nothing else claims a watchdog exemption
// for it. A big TARGET_BOOKS run can exceed the 60-min launchd watchdog and be
// SIGKILLed mid-import — silently, since the wrapper reports whatever it had.
import { startWatchdogExemption } from "./lib/watchdog-exempt";

startWatchdogExemption();

import { db } from "../src/db";
import { books, authors, bookAuthors, genres, bookGenres } from "../src/db/schema";
import { eq, sql } from "drizzle-orm";
import {
  searchOpenLibrary,
  fetchOpenLibraryWork,
  buildCoverUrl,
  normalizeGenres,
  fetchAuthorWorks,
  findEnglishEditionTitle,
  isJunkTitle,
} from "../src/lib/openlibrary";
import { isLikelyNonEnglish } from "../src/lib/enrichment/enrichable";
import { enrichBook } from "../src/lib/enrichment/enrich-book";
import { NYT_LISTS, NYT_DELAY_MS, fetchNytList, upsertNytEntries } from "../src/lib/enrichment/nyt";

const NONFICTION_GENRES = new Set([
  "Nonfiction", "Biography", "Memoir", "Self-Help", "True Crime", "Philosophy",
]);

function detectIsFiction(genreNames: string[]): boolean {
  return !genreNames.some((g) => NONFICTION_GENRES.has(g));
}

async function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Search queries organized by category
const BESTSELLER_QUERIES = [
  // Current bestsellers and popular series
  "Fourth Wing Rebecca Yarros",
  "Iron Flame Rebecca Yarros",
  "Onyx Storm Rebecca Yarros",
  "A Court of Thorns and Roses Sarah J Maas",
  "House of Flame and Shadow Sarah J Maas",
  "Throne of Glass Sarah J Maas",
  "It Ends with Us Colleen Hoover",
  "It Starts with Us Colleen Hoover",
  "Verity Colleen Hoover",
  "Atomic Habits James Clear",
  "The 48 Laws of Power Robert Greene",
  "Lessons in Chemistry Bonnie Garmus",
  "Tomorrow and Tomorrow and Tomorrow Gabrielle Zevin",
  "The Seven Husbands of Evelyn Hugo Taylor Jenkins Reid",
  "Daisy Jones and the Six Taylor Jenkins Reid",
  "Malibu Rising Taylor Jenkins Reid",
  "The Nightingale Kristin Hannah",
  "The Great Alone Kristin Hannah",
  "The Women Kristin Hannah",
  "Where the Crawdads Sing Delia Owens",
  "Anxious People Fredrik Backman",
  "A Man Called Ove Fredrik Backman",
  "The Midnight Library Matt Haig",
  "The Invisible Life of Addie LaRue V.E. Schwab",
  "Holly Stephen King",
  "The Institute Stephen King",
  "Billy Summers Stephen King",
  "Fairy Tale Stephen King",
  "The Ballad of Songbirds and Snakes Suzanne Collins",
  "Sunrise on the Reaping Suzanne Collins",
  "The Name of the Wind Patrick Rothfuss",
  "The Wise Man's Fear Patrick Rothfuss",
  "Piranesi Susanna Clarke",
  "Jonathan Strange and Mr Norrell Susanna Clarke",
  "Babel R.F. Kuang",
  "The Poppy War R.F. Kuang",
  "Yellowface R.F. Kuang",
  "The House in the Cerulean Sea TJ Klune",
  "Under the Whispering Door TJ Klune",
  "In the Lives of Puppets TJ Klune",
  // 2025-2026 bestsellers
  "Intermezzo Sally Rooney",
  "James Percival Everett",
  "All Fours Miranda July",
  "Funny Story Emily Henry",
  "Happy Place Emily Henry",
  "Book Lovers Emily Henry",
  "Beach Read Emily Henry",
  "People We Meet on Vacation Emily Henry",
  "The God of the Woods Liz Moore",
  "Orbital Samantha Harvey",
  "Somewhere Beyond the Sea TJ Klune",
  "Haunting Adeline HD Carlton",
  "Hunting Adeline HD Carlton",
  "The Love Hypothesis Ali Hazelwood",
  "Bride Ali Hazelwood",
  "Divine Rivals Rebecca Ross",
  "Ruthless Vows Rebecca Ross",
  "Powerless Lauren Roberts",
  "Reckless Lauren Roberts",
  "Fearless Lauren Roberts",
  "The Housemaid Freida McFadden",
  "Never Lie Freida McFadden",
  "The Inmate Freida McFadden",
  "A Good Girl's Guide to Murder Holly Jackson",
  "Good Girl Bad Blood Holly Jackson",
  "Twisted Love Ana Huang",
  "King of Sloth Ana Huang",
  "Tress of the Emerald Sea Brandon Sanderson",
  "Defiant Brandon Sanderson",
  "The Wishing Game Meg Shaffer",
  "Tom Lake Ann Patchett",
  "You Like It Darker Stephen King",
  "The Wild Robot Peter Brown",
  "Icebreaker Hannah Grace",
  "The Covenant of Water Abraham Verghese",
  "Demon Copperhead Barbara Kingsolver",
  "Starter Villain John Scalzi",
  "System Collapse Martha Wells",
  "Legends and Lattes Travis Baldree",
  "Bookshops and Bonedust Travis Baldree",
];

const CLASSICS_QUERIES = [
  "Pride and Prejudice Jane Austen",
  "Jane Eyre Charlotte Bronte",
  "Wuthering Heights Emily Bronte",
  "Great Expectations Charles Dickens",
  "A Tale of Two Cities Charles Dickens",
  "Crime and Punishment Fyodor Dostoevsky",
  "The Brothers Karamazov Fyodor Dostoevsky",
  "War and Peace Leo Tolstoy",
  "Anna Karenina Leo Tolstoy",
  "The Great Gatsby F. Scott Fitzgerald",
  "To Kill a Mockingbird Harper Lee",
  "1984 George Orwell",
  "Brave New World Aldous Huxley",
  "Lord of the Flies William Golding",
  "The Catcher in the Rye J.D. Salinger",
  "Of Mice and Men John Steinbeck",
  "The Grapes of Wrath John Steinbeck",
  "East of Eden John Steinbeck",
  "The Old Man and the Sea Ernest Hemingway",
  "A Farewell to Arms Ernest Hemingway",
  "One Hundred Years of Solitude Gabriel Garcia Marquez",
  "The Count of Monte Cristo Alexandre Dumas",
  "Les Miserables Victor Hugo",
  "Don Quixote Miguel de Cervantes",
  "Frankenstein Mary Shelley",
  "Dracula Bram Stoker",
  "The Picture of Dorian Gray Oscar Wilde",
  "Heart of Darkness Joseph Conrad",
  "Catch-22 Joseph Heller",
  "Slaughterhouse-Five Kurt Vonnegut",
];

const EDUCATION_QUERIES = [
  "The Handmaid's Tale Margaret Atwood",
  "Things Fall Apart Chinua Achebe",
  "The Color Purple Alice Walker",
  "Their Eyes Were Watching God Zora Neale Hurston",
  "Invisible Man Ralph Ellison",
  "Native Son Richard Wright",
  "The Crucible Arthur Miller",
  "Death of a Salesman Arthur Miller",
  "A Raisin in the Sun Lorraine Hansberry",
  "The Odyssey Homer",
  "The Iliad Homer",
  "Hamlet William Shakespeare",
  "Macbeth William Shakespeare",
  "Romeo and Juliet William Shakespeare",
  "Fahrenheit 451 Ray Bradbury",
  "The Giver Lois Lowry",
  "Animal Farm George Orwell",
  "The Outsiders S.E. Hinton",
  "The Book Thief Markus Zusak",
  "Night Elie Wiesel",
  "The Diary of a Young Girl Anne Frank",
  "I Know Why the Caged Bird Sings Maya Angelou",
  "The Alchemist Paulo Coelho",
  "Siddhartha Hermann Hesse",
  "Flowers for Algernon Daniel Keyes",
];

const CHRISTIAN_FICTION_QUERIES = [
  // Francine Rivers — all-time bestselling Christian fiction author
  "Redeeming Love Francine Rivers",
  "A Voice in the Wind Francine Rivers",
  "An Echo in the Darkness Francine Rivers",
  "As Sure as the Dawn Francine Rivers",
  "The Masterpiece Francine Rivers",
  "The Lady's Mine Francine Rivers",
  "Bridge to Haven Francine Rivers",
  "A Lineage of Grace Francine Rivers",
  "The Last Sin Eater Francine Rivers",
  "And the Shofar Blew Francine Rivers",
  // Karen Kingsbury — Baxter Family series & standalone
  "The Baxters Karen Kingsbury",
  "Redemption Karen Kingsbury",
  "Remember Karen Kingsbury",
  "Return Karen Kingsbury",
  "Rejoice Karen Kingsbury",
  "Reunion Karen Kingsbury",
  "A Time to Dance Karen Kingsbury",
  "Even Now Karen Kingsbury",
  "Forgiving Paris Karen Kingsbury",
  "The Christmas Ring Karen Kingsbury",
  "Someone Like You Karen Kingsbury",
  "Two Weeks Karen Kingsbury",
  // Beverly Lewis — Amish fiction
  "The Shunning Beverly Lewis",
  "The Confession Beverly Lewis",
  "The Reckoning Beverly Lewis",
  "The Preacher's Daughter Beverly Lewis",
  "The Christmas House Beverly Lewis",
  "The Ebb Tide Beverly Lewis",
  // Dee Henderson
  "Danger in the Shadows Dee Henderson",
  "The Negotiator Dee Henderson",
  "The Guardian Dee Henderson",
  "The Protector Dee Henderson",
  "Unspoken Dee Henderson",
  // Ted Dekker
  "Black Ted Dekker",
  "Red Ted Dekker",
  "White Ted Dekker",
  "Thr3e Ted Dekker",
  "The Bride Collector Ted Dekker",
  "Blessed Child Ted Dekker",
  // Frank Peretti
  "This Present Darkness Frank Peretti",
  "Piercing the Darkness Frank Peretti",
  "The Oath Frank Peretti",
  "Monster Frank Peretti",
  // Charles Martin
  "When Crickets Cry Charles Martin",
  "The Mountain Between Us Charles Martin",
  "The Keeper Charles Martin",
  "The Letter Keeper Charles Martin",
  "The Record Keeper Charles Martin",
  // Colleen Coble
  "Without a Trace Colleen Coble",
  "Tidewater Inn Colleen Coble",
  "Prowl Colleen Coble",
  // Lynn Austin
  "Waiting for Christmas Lynn Austin",
  "While We're Far Apart Lynn Austin",
  "Wings of Refuge Lynn Austin",
  // Liz Curtis Higgs
  "Thorn in My Heart Liz Curtis Higgs",
  "Fair Is the Rose Liz Curtis Higgs",
  // Tessa Afshar
  "Bread of Angels Tessa Afshar",
  "Land of Silence Tessa Afshar",
  "The Royal Artisan Tessa Afshar",
  "Jewel of the Nile Tessa Afshar",
  // Denise Hunter
  "The Second Story Bookshop Denise Hunter",
  "Before We Were Us Denise Hunter",
  "A Novel Proposal Denise Hunter",
  "Sweetbriar Cottage Denise Hunter",
  // Julie Klassen
  "The Secret of Pembrooke Park Julie Klassen",
  "Whispers at Painswick Court Julie Klassen",
  "The Bridge to Belle Island Julie Klassen",
  // Laura Frantz
  "The Belle of Chatham Laura Frantz",
  "Tidewater Bride Laura Frantz",
  "A Heart Adrift Laura Frantz",
  // Chris Fabry
  "The Forge Chris Fabry",
  "War Room Chris Fabry",
  "Overcomer Chris Fabry",
  // Roseanna M. White
  "A Name Unknown Roseanna M White",
  "Christmas at Sugar Plum Manor Roseanna M White",
  // Lynette Eason — Christian suspense
  "Target Acquired Lynette Eason",
  "Life Flight Lynette Eason",
  "Crosshairs Lynette Eason",
  // Classics / inspirational
  "Hinds' Feet on High Places Hannah Hurnard",
  "The Shack William Paul Young",
  "This Present Darkness Frank Peretti",
  "In His Steps Charles Sheldon",
  "The Screwtape Letters C.S. Lewis",
  "The Pilgrim's Progress John Bunyan",
  "Ben-Hur Lew Wallace",
  "Christy Catherine Marshall",
  // Janette Oke — pioneer of Christian fiction
  "Love Comes Softly Janette Oke",
  "Love's Enduring Promise Janette Oke",
  "When Calls the Heart Janette Oke",
  "When Comes the Spring Janette Oke",
  // Susan May Warren
  "Track of Courage Susan May Warren",
  "Sunrise Susan May Warren",
  // Tosca Lee
  "Iscariot Tosca Lee",
  "The Progeny Tosca Lee",
  // Becky Wade
  "True to You Becky Wade",
  "Falling for You Becky Wade",
  // Michelle Shocklee
  "Under the Tulip Tree Michelle Shocklee",
  "Count the Nights by Stars Michelle Shocklee",
  // Wanda Brunstetter — Amish fiction
  "The Discovery Wanda Brunstetter",
  "The Amish Ballerina Wanda Brunstetter",
  // Gabrielle Meyer
  "When the Day Comes Gabrielle Meyer",
  "In This Moment Gabrielle Meyer",
  // Jonathan Cahn — prophetic fiction
  "The Harbinger Jonathan Cahn",
  "The Book of Mysteries Jonathan Cahn",
  // Sarah E. Ladd — Regency
  "The Cloverton Charade Sarah E Ladd",
  "The Governess of Penwythe Hall Sarah E Ladd",
  // Melody Carlson
  "The Christmas Tree Farm Melody Carlson",
  "Christmas at Harrington's Melody Carlson",
  // Courtney Walsh
  "The Summer of Yes Courtney Walsh",
  "Is It Any Wonder Courtney Walsh",
  // Davis Bunn
  "The Great Divide Davis Bunn",
  "Gold of Kings Davis Bunn",
  // Joel Rosenberg
  "The Last Jihad Joel Rosenberg",
  "The Twelfth Imam Joel Rosenberg",
  // Tim LaHaye & Jerry B. Jenkins — Left Behind
  "Left Behind Tim LaHaye Jerry B Jenkins",
  "Tribulation Force Tim LaHaye Jerry B Jenkins",
  "Nicolae Tim LaHaye Jerry B Jenkins",
  "Soul Harvest Tim LaHaye Jerry B Jenkins",
  "Apollyon Tim LaHaye Jerry B Jenkins",
  "Assassins Tim LaHaye Jerry B Jenkins",
  "The Indwelling Tim LaHaye Jerry B Jenkins",
  "The Mark Tim LaHaye Jerry B Jenkins",
  "Desecration Tim LaHaye Jerry B Jenkins",
  "The Remnant Tim LaHaye Jerry B Jenkins",
  "Armageddon Tim LaHaye Jerry B Jenkins",
  "Glorious Appearing Tim LaHaye Jerry B Jenkins",
  // Bodie and Brock Thoene
  "A Daughter of Zion Bodie Thoene",
  "Vienna Prelude Bodie Thoene",
  // Lauraine Snelling
  "An Untamed Land Lauraine Snelling",
  "At Morning's Light Lauraine Snelling",
  // David Jeremiah
  "Vanished David Jeremiah",
  // T.I. Lowe
  "Lowcountry Lost T I Lowe",
  "Under the Magnolias T I Lowe",
];

// Christian NONFICTION — added 2026-04-17 for Christian-priority discovery
const CHRISTIAN_NONFICTION_QUERIES = [
  // C.S. Lewis
  "Mere Christianity C.S. Lewis",
  "The Screwtape Letters C.S. Lewis",
  "The Great Divorce C.S. Lewis",
  "The Problem of Pain C.S. Lewis",
  "Miracles C.S. Lewis",
  "The Four Loves C.S. Lewis",
  "Surprised by Joy C.S. Lewis",
  "The Weight of Glory C.S. Lewis",
  "Reflections on the Psalms C.S. Lewis",
  // Tim Keller
  "The Reason for God Tim Keller",
  "The Prodigal God Tim Keller",
  "Prayer Tim Keller",
  "Counterfeit Gods Tim Keller",
  "Every Good Endeavor Tim Keller",
  "Walking with God Tim Keller",
  "Forgive Tim Keller",
  "Hope in Times of Fear Tim Keller",
  "Making Sense of God Tim Keller",
  // John Piper
  "Desiring God John Piper",
  "Don't Waste Your Life John Piper",
  "Future Grace John Piper",
  "Coronavirus and Christ John Piper",
  "Providence John Piper",
  "A Peculiar Glory John Piper",
  // Max Lucado
  "Traveling Light Max Lucado",
  "Anxious for Nothing Max Lucado",
  "Fearless Max Lucado",
  "In the Eye of the Storm Max Lucado",
  "God Came Near Max Lucado",
  "Help Is Here Max Lucado",
  "Begin Again Max Lucado",
  // Ann Voskamp
  "One Thousand Gifts Ann Voskamp",
  "The Broken Way Ann Voskamp",
  "WayMaker Ann Voskamp",
  // Beth Moore
  "So Long Insecurity Beth Moore",
  "Breaking Free Beth Moore",
  "Believing God Beth Moore",
  "Chasing Vines Beth Moore",
  // Jen Wilkin
  "Women of the Word Jen Wilkin",
  "In His Image Jen Wilkin",
  // Henry Cloud
  "Boundaries Henry Cloud",
  "Changes That Heal Henry Cloud",
  "Necessary Endings Henry Cloud",
  "Integrity Henry Cloud",
  // Oswald Chambers / A.W. Tozer / Bonhoeffer classics
  "My Utmost for His Highest Oswald Chambers",
  "The Pursuit of God A.W. Tozer",
  "The Knowledge of the Holy A.W. Tozer",
  "The Cost of Discipleship Dietrich Bonhoeffer",
  "Life Together Dietrich Bonhoeffer",
  // Lee Strobel
  "The Case for Christ Lee Strobel",
  "The Case for Faith Lee Strobel",
  "The Case for a Creator Lee Strobel",
  // John Eldredge
  "Wild at Heart John Eldredge",
  "Captivating John Eldredge",
  "The Sacred Romance John Eldredge",
  "Walking with God John Eldredge",
  // Philip Yancey
  "What's So Amazing About Grace Philip Yancey",
  "The Jesus I Never Knew Philip Yancey",
  "Disappointment with God Philip Yancey",
  "Where is God When it Hurts Philip Yancey",
  // Rick Warren
  "The Purpose Driven Life Rick Warren",
  "The Purpose Driven Church Rick Warren",
  // Paul David Tripp
  "New Morning Mercies Paul David Tripp",
  "Parenting Paul David Tripp",
  "Suffering Paul David Tripp",
  // Kevin DeYoung
  "Just Do Something Kevin DeYoung",
  "Crazy Busy Kevin DeYoung",
  // Randy Alcorn
  "Heaven Randy Alcorn",
  "Safely Home Randy Alcorn",
  "The Treasure Principle Randy Alcorn",
  // Louie Giglio
  "Don't Give the Enemy a Seat at Your Table Louie Giglio",
  // Nancy Guthrie
  "Even Better than Eden Nancy Guthrie",
  "Seeing Jesus in the Old Testament Nancy Guthrie",
  // Christine Caine
  "Unashamed Christine Caine",
  "Unexpected Christine Caine",
  // Lysa TerKeurst
  "Uninvited Lysa TerKeurst",
  "It's Not Supposed to Be This Way Lysa TerKeurst",
  "Forgiving What You Can't Forget Lysa TerKeurst",
  "I Want to Trust You Lysa TerKeurst",
  // Priscilla Shirer
  "Fervent Priscilla Shirer",
  "The Armor of God Priscilla Shirer",
  // Tim Challies
  "Seasons of Sorrow Tim Challies",
];

async function findOrCreateAuthor(name: string, olKey?: string): Promise<string> {
  let author = await db.query.authors.findFirst({
    where: eq(authors.name, name),
  });
  if (author) {
    if (olKey && !author.openLibraryKey) {
      await db.update(authors).set({ openLibraryKey: olKey }).where(eq(authors.id, author.id));
    }
    return author.id;
  }
  const [created] = await db.insert(authors).values({ name, openLibraryKey: olKey ?? null }).returning();
  return created.id;
}

// Cap the per-author backlist pull so one prolific author can't dominate a
// single night's volume budget.
const CASCADE_LIMIT_PER_AUTHOR = 25;

async function importCascadeBooks(authorOlKeys: string[]): Promise<number> {
  let added = 0;
  for (const authorKey of authorOlKeys) {
    await delay(350);
    const works = await fetchAuthorWorks(authorKey);
    let perAuthor = 0;
    for (const work of works) {
      if (perAuthor >= CASCADE_LIMIT_PER_AUTHOR) break;
      const workKey = work.key;
      const existing = await db.query.books.findFirst({ where: eq(books.openLibraryKey, workKey) });
      if (existing) continue;
      // Resolve English title for foreign-language works
      const englishTitle = await findEnglishEditionTitle(workKey);
      const resolvedTitle = englishTitle ?? work.title;
      // Some OL works come back with no title at all. Without this guard the
      // whole cascade for the seed author throws (isLikelyNonEnglish does
      // title.replace) and their remaining backlist is silently skipped.
      if (!resolvedTitle) continue;
      // Cascade books are inserted as bare stubs (no ISBN/description/year), so
      // they must NOT enter the public catalog — that was the source of the
      // ~5k un-enrichable skeleton flood (2026-06-17). Skip junk/non-English
      // outright, and land the rest as import_only pending real enrichment.
      if (isJunkTitle(resolvedTitle) || isLikelyNonEnglish(resolvedTitle)) continue;
      const coverUrl = buildCoverUrl(work.covers?.[0], "L");
      await delay(350);
      const [newBook] = await db.insert(books).values({
        title: resolvedTitle,
        coverImageUrl: coverUrl,
        openLibraryKey: workKey,
        visibility: "import_only",
      }).returning();
      const author = await db.query.authors.findFirst({ where: eq(authors.openLibraryKey, authorKey) });
      if (author) {
        await db.insert(bookAuthors).values({ bookId: newBook.id, authorId: author.id }).onConflictDoNothing();
      }
      added++;
      perAuthor++;
    }
  }
  return added;
}

// Returns the number of books added (seed + cascade), 0 if skipped/failed.
interface ImportSeed {
  description?: string | null;
  publisher?: string | null;
  isbn13?: string | null;
  isbn10?: string | null;
  coverImageUrl?: string | null;
}

async function importBook(query: string, seed?: ImportSeed): Promise<number> {
  try {
    const results = await searchOpenLibrary(query, 3);
    if (results.length === 0) {
      console.log(`  No results for: ${query}`);
      return 0;
    }

    const result = results[0];

    // Reject junk/box-sets and non-English at the source. (Seeded imports —
    // NYT/curated — are always real, so they bypass this guard.)
    if (!seed && (isJunkTitle(result.title) || isLikelyNonEnglish(result.title))) {
      console.log(`  Skipped (junk/non-English): ${result.title}`);
      return 0;
    }

    // Check if already imported
    const existing = await db.query.books.findFirst({
      where: eq(books.openLibraryKey, result.key),
    });
    if (existing) {
      console.log(`  Already imported: ${result.title}`);
      return 0;
    }

    // Fetch work details
    await delay(300);
    const work = await fetchOpenLibraryWork(result.key);
    const coverUrl = buildCoverUrl(work.coverId, "L") ?? buildCoverUrl(result.cover_i, "L");
    const genreNames = normalizeGenres(work.subjects);
    const isFiction = detectIsFiction(genreNames);

    const description = seed?.description ?? work.description ?? null;
    const isbn13 = result.isbn?.find((i) => i.length === 13) ?? seed?.isbn13 ?? null;
    const isbn10 = result.isbn?.find((i) => i.length === 10) ?? seed?.isbn10 ?? null;

    // Don't publish a bare skeleton (no ISBN + no description). Land it as
    // import_only so the public catalog stays clean; a later enrichment that
    // fills real metadata can promote it. Seeded imports are always publishable.
    const isThin = !seed && !isbn13 && !isbn10 && !description;
    const visibility = isThin ? "import_only" : "public";

    const [book] = await db.insert(books).values({
      title: result.title,
      // Prefer NYT's curated description (seed) over OL's — addresses the
      // long-standing description-quality complaint for bestsellers.
      description,
      publicationYear: result.first_publish_year,
      isbn13,
      isbn10,
      pages: result.number_of_pages_median,
      coverImageUrl: coverUrl ?? seed?.coverImageUrl ?? null,
      publisher: seed?.publisher ?? null,
      openLibraryKey: result.key,
      isFiction,
      visibility,
    }).returning();

    // Authors
    const authorOlKeys: string[] = [];
    if (result.author_name?.length) {
      for (let i = 0; i < result.author_name.length; i++) {
        const name = result.author_name[i];
        const olKey = result.author_key?.[i];
        const authorId = await findOrCreateAuthor(name, olKey);
        await db.insert(bookAuthors).values({ bookId: book.id, authorId }).onConflictDoNothing();
        if (olKey) authorOlKeys.push(olKey);
      }
    }

    // Genres
    for (const genreName of genreNames) {
      let genre = await db.query.genres.findFirst({ where: eq(genres.name, genreName) });
      if (!genre) {
        [genre] = await db.insert(genres).values({ name: genreName }).returning();
      }
      await db.insert(bookGenres).values({ bookId: book.id, genreId: genre.id }).onConflictDoNothing();
    }

    // Enrich — metadata-only (skipContentSearch). Both the discovery and breadth
    // lanes bulk-add ~500 books/night; enrichBook's content-analysis + audiobook
    // Brave searches ignore skipBrave, so leaving them on spent ~6 Brave calls ×
    // ~500 books ≈ 3,000/night — enough to exhaust the shared ~3,300/day cap on
    // its OWN and starve the priority lanes (upcoming-releases, thin-recovery,
    // content-ratings) that run after it. skipContentSearch makes ingestion truly
    // Brave-free: books land with metadata/genres/cover from the free structured
    // sources, and their Grok content ratings are filled later by the (now
    // expanded) nightly content-ratings backfill. Bonus: it also skips enrichBook's
    // internal author-bibliography discovery — the redundant "double import" — so
    // the intended cascade below (importCascadeBooks, capped, import_only) is the
    // single source of backlist growth.
    try {
      await enrichBook(book.id, { skipContentSearch: true });
    } catch (err) {
      console.warn(`  Enrichment failed for ${result.title}:`, err);
    }

    // Cascade import (non-blocking for the script, but we await for thoroughness)
    let cascadeAdded = 0;
    if (authorOlKeys.length > 0) {
      try {
        cascadeAdded = await importCascadeBooks(authorOlKeys);
      } catch (err) {
        console.warn(`  Cascade failed:`, err);
      }
    }

    console.log(`  Imported: ${result.title}${cascadeAdded ? ` (+${cascadeAdded} cascade)` : ""}`);
    return 1 + cascadeAdded;
  } catch (err) {
    console.error(`  Error importing "${query}":`, err);
    return 0;
  }
}

/**
 * Deterministic shuffle seeded by today's date — so a run is idempotent
 * within a day (same query order for retries/resumes), but rotates nightly.
 */
function seededShuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  const today = new Date().toISOString().slice(0, 10);
  const crypto = require("crypto");
  let seed = crypto.createHash("md5").update(today).digest().readUInt32LE(0);
  for (let i = out.length - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const j = seed % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---------------------------------------------------------------------------
// PRIMARY DISCOVERY ENGINE: paginated OpenLibrary subject feeds.
//
// The legacy static query list (above) is structurally capped — each query
// imports at most its single top result, so once those ~350 seeds were in the
// catalog the importer dried up to near-zero/night. Subject feeds replace that:
// each subject exposes thousands of works, and we persist a per-subject offset
// so every run pages DEEPER into the catalog and (almost) never re-sees a work.
// Christian fiction is weighted heaviest per product direction.
// ---------------------------------------------------------------------------

const DISCOVERY_SUBJECTS: { subject: string; weight: number }[] = [
  { subject: "christian_fiction", weight: 3 },
  { subject: "christian_life", weight: 1 },
  { subject: "religious_fiction", weight: 1 },
  { subject: "christianity", weight: 1 },
  { subject: "fiction", weight: 1 },
  { subject: "historical_fiction", weight: 1 },
  { subject: "romance", weight: 1 },
  { subject: "fantasy", weight: 1 },
  { subject: "mystery", weight: 1 },
  { subject: "thrillers", weight: 1 },
  { subject: "young_adult_fiction", weight: 1 },
];

// BREADTH set (added 2026-06-20) — selected with SUBJECT_SET=broad by the
// Wed/Sat breadth-import lane (repurposed from the retired NYT backfill slot).
// Goal: the high-demand NONFICTION + adjacent categories people search for that
// DISCOVERY_SUBJECTS (fiction/Christian-heavy) never reaches, plus a few big
// fiction subjects discovery underweights. All slugs validated against the OL
// /subjects endpoint (work_count + popular top result) on 2026-06-20. Same
// sort=readinglog popularity paging — popular titles first, then the long tail.
const BROAD_SUBJECTS: { subject: string; weight: number }[] = [
  { subject: "biography", weight: 2 },        // 905k works
  { subject: "history", weight: 2 },          // 2.5M works
  { subject: "nonfiction", weight: 1 },
  { subject: "science", weight: 1 },
  { subject: "psychology", weight: 1 },
  { subject: "business", weight: 1 },
  { subject: "self-help", weight: 1 },
  { subject: "philosophy", weight: 1 },
  { subject: "religion", weight: 1 },
  { subject: "true_crime", weight: 1 },
  { subject: "cooking", weight: 1 },
  { subject: "health", weight: 1 },
  { subject: "poetry", weight: 1 },
  { subject: "literature", weight: 1 },
  { subject: "science_fiction", weight: 1 },
  { subject: "horror", weight: 1 },
  { subject: "juvenile_fiction", weight: 1 },
  { subject: "classics", weight: 1 },
  { subject: "autobiography", weight: 1 },
  { subject: "humor", weight: 1 },
];

// Default to the Christian-weighted discovery rotation; SUBJECT_SET=broad selects
// the breadth lane. Each lane keeps its OWN persisted offset file so they page
// independently (override via SUBJECT_OFFSET_FILE).
const SUBJECTS =
  process.env.SUBJECT_SET === "broad" ? BROAD_SUBJECTS : DISCOVERY_SUBJECTS;
const SUBJECT_PAGE_SIZE = 100;
const OFFSET_FILE = process.env.SUBJECT_OFFSET_FILE || "data/subject-offsets.json";
const OL_HEADERS = {
  "User-Agent": "tbra-nightly-import/1.0 (books@thebasedreaderapp.com)",
};

function loadOffsets(): Record<string, number> {
  try {
    if (existsSync(OFFSET_FILE)) return JSON.parse(readFileSync(OFFSET_FILE, "utf8"));
  } catch (err) {
    console.warn("  Could not read subject offsets, starting fresh:", err);
  }
  return {};
}

function saveOffsets(offsets: Record<string, number>) {
  try {
    writeFileSync(OFFSET_FILE, JSON.stringify(offsets, null, 2));
  } catch (err) {
    console.warn("  Failed to persist subject offsets:", err);
  }
}

interface SubjectWork {
  title: string;
  authorName: string | null;
}

async function fetchSubjectWorks(
  subject: string,
  offset: number,
  limit: number
): Promise<{ works: SubjectWork[]; workCount: number }> {
  // sort=readinglog orders by OpenLibrary reader engagement (how many users have
  // the book in their reading log) while keeping the subjects endpoint's accurate
  // subject matching — so we import the most-read titles in each subject first,
  // then page into the long tail. (search.json?subject=…&sort=readinglog was
  // rejected: its subject filter is far too loose — it surfaced The Handmaid's
  // Tale for "christian_fiction".)
  const url = `https://openlibrary.org/subjects/${subject}.json?sort=readinglog&limit=${limit}&offset=${offset}`;
  try {
    const res = await fetch(url, { headers: OL_HEADERS });
    if (!res.ok) {
      console.warn(`  [subject:${subject}] HTTP ${res.status} at offset ${offset}`);
      return { works: [], workCount: 0 };
    }
    const data: any = await res.json();
    const works: SubjectWork[] = (data.works ?? [])
      .map((w: any) => ({ title: w.title as string, authorName: w.authors?.[0]?.name ?? null }))
      // Reject junk/box-sets and non-English titles at the source so they never
      // enter the catalog as un-enrichable filler (2026-06-17 importer hardening).
      .filter((w: SubjectWork) => w.title && !isJunkTitle(w.title) && !isLikelyNonEnglish(w.title));
    return { works, workCount: data.work_count ?? 0 };
  } catch (err) {
    console.warn(`  [subject:${subject}] fetch failed at offset ${offset}:`, err);
    return { works: [], workCount: 0 };
  }
}

// NYT freshness source: the fetch/cache logic lives in the shared module
// (src/lib/enrichment/nyt.ts) so the retroactive backfill script and the
// enrichment pipeline reuse the exact same code. See the NYT loop in main().

async function bookCount(): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)` }).from(books);
  return Number(row.n);
}

async function main() {
  const startTime = Date.now();
  // Graceful wall-clock ceiling, checked at the loop top. Default 300min (the
  // long-standing hardcoded 5h); env-overridable to match description-refresh
  // and enrich-content-700, whose lanes tune this per slot.
  const MAX_RUNTIME_MIN = Number(process.env.MAX_RUNTIME_MIN) || 300;
  const MAX_RUNTIME_MS = MAX_RUNTIME_MIN * 60 * 1000;

  // Volume cap (NET books added, seed + cascade) — override via env TARGET_BOOKS
  const TARGET_BOOKS = Number(process.env.TARGET_BOOKS) || 500;

  let skipped = 0;
  let failed = 0;

  // Budget on ACTUAL catalog growth, not importBook's return value: enrichBook
  // runs its own author-bibliography discovery (importing ~25-30 books per new
  // author) that importBook never sees. A live COUNT(*) delta is the only honest
  // measure of how many net books a run has added.
  const startCount = await bookCount();
  let imported = 0; // net books added since start (catalog delta)
  console.log(`[nightly] Target: ${TARGET_BOOKS} net books; current catalog: ${startCount}`);

  const overBudget = () =>
    imported >= TARGET_BOOKS || Date.now() - startTime > MAX_RUNTIME_MS;

  // Hard backstop. The ceiling above is only consulted BETWEEN books, so a
  // single enrichBook() wedged on a stuck socket would stall the run forever
  // and the chained `&& sync-incremental.sh push` would never fire — the run's
  // completed work would sit unpushed until someone noticed. This unref'd timer
  // guarantees an exit. Exit 0, NOT an error, so the push still runs and
  // persists whatever landed. Same shape as description-refresh.ts.
  const deadline = setTimeout(async () => {
    console.error(
      `\n[nightly] HARD CEILING hit (${MAX_RUNTIME_MIN}min) mid-book — exiting 0 so push can run.`,
    );
    // Belt and braces: the summary below awaits a query, so a wedged DB would
    // keep us alive past the ceiling we just declared. Guarantee the exit.
    setTimeout(() => process.exit(0), 10_000).unref();
    // Re-read the catalog rather than trusting `imported`: the wedged book may
    // have committed rows (and its cascade) after the last loop-top refresh.
    try {
      const finalCount = await bookCount();
      console.error(
        `[nightly] Partial run: catalog ${startCount} → ${finalCount} (+${finalCount - startCount}), Skipped: ${skipped}, Failed: ${failed}`,
      );
    } catch {
      console.error(`[nightly] Partial run: ~${imported} added (count unavailable)`);
    }
    process.exit(0);
  }, MAX_RUNTIME_MS);
  deadline.unref();

  // ---- FRESHNESS SOURCE: NYT bestsellers (runs first when a key is set) ----
  // For each current list we (1) cache every entry into nyt_bestsellers so
  // enrichment + user imports can use NYT's curated descriptions, then (2) import
  // any not-yet-in-catalog bestseller, seeding it with the NYT description/cover.
  const nytKey = process.env.NYT_API_KEY;
  if (nytKey && process.env.DISABLE_NYT !== "1") {
    console.log(`[nightly] NYT bestsellers enabled — scanning ${NYT_LISTS.length} lists`);
    for (const list of NYT_LISTS) {
      const { ok, status, entries, listDate } = await fetchNytList(list, nytKey);
      if (!ok) {
        console.warn(`  [nyt:${list}] fetch failed (HTTP ${status})`);
        await delay(NYT_DELAY_MS);
        continue;
      }
      const stats = await upsertNytEntries(entries, list, listDate);
      console.log(`\n[nyt:${list}] ${entries.length} titles — cached (${stats.inserted} new, ${stats.updated} updated)`);
      for (const e of entries) {
        if (overBudget()) break;
        const query = e.author ? `${e.title} ${e.author}` : e.title;
        console.log(`[${imported}/${TARGET_BOOKS}] ${query}`);
        const added = await importBook(query, {
          description: e.description,
          publisher: e.publisher,
          isbn13: e.isbn13,
          isbn10: e.isbn10,
          coverImageUrl: e.bookImage,
        });
        if (added > 0) imported = (await bookCount()) - startCount;
        else skipped++;
        await delay(500);
      }
      await delay(NYT_DELAY_MS); // respect NYT rate limit between lists
    }
  } else if (process.env.DISABLE_NYT === "1") {
    console.log(`[nightly] NYT source disabled (DISABLE_NYT=1)`);
  } else {
    console.log(`[nightly] NYT_API_KEY not set — skipping NYT bestsellers source`);
  }

  // ---- PRIMARY ENGINE: paginated subject feeds ----
  const offsets = loadOffsets();
  const weightedSubjects = seededShuffle(
    SUBJECTS.flatMap(({ subject, weight }) => Array(weight).fill(subject))
  );

  for (const subject of weightedSubjects) {
    if (overBudget()) break;

    const offset = offsets[subject] ?? 0;
    const { works, workCount } = await fetchSubjectWorks(subject, offset, SUBJECT_PAGE_SIZE);
    await delay(500);

    // Advance the offset; wrap to 0 once we've paged past the subject's catalog.
    const nextOffset = offset + SUBJECT_PAGE_SIZE;
    offsets[subject] = workCount > 0 && nextOffset >= workCount ? 0 : nextOffset;
    saveOffsets(offsets);

    console.log(
      `\n[subject:${subject}] offset ${offset} → ${works.length} works (catalog ${workCount})`
    );

    for (const work of works) {
      if (overBudget()) break;
      const query = work.authorName ? `${work.title} ${work.authorName}` : work.title;
      console.log(`[${imported}/${TARGET_BOOKS}] ${query}`);
      const added = await importBook(query);
      if (added > 0) imported = (await bookCount()) - startCount;
      else skipped++;
      await delay(500);
    }
  }

  // ---- SAFETY NET: legacy curated queries top up if subjects underdeliver ----
  // (Skipped by the breadth lane via DISABLE_LEGACY=1 — those curated seeds are
  // bestseller/Christian titles that belong to nightly-discovery, not breadth.)
  if (!overBudget() && process.env.DISABLE_LEGACY !== "1") {
    const legacy = seededShuffle([
      ...BESTSELLER_QUERIES,
      ...CLASSICS_QUERIES,
      ...EDUCATION_QUERIES,
      ...CHRISTIAN_FICTION_QUERIES,
      ...CHRISTIAN_FICTION_QUERIES, // 2× weight
      ...CHRISTIAN_NONFICTION_QUERIES,
      ...CHRISTIAN_NONFICTION_QUERIES, // 2× weight
    ]);
    console.log(`\n[nightly] Subjects yielded ${imported}; topping up from ${legacy.length} curated queries`);
    for (const query of legacy) {
      if (overBudget()) break;
      console.log(`[${imported}/${TARGET_BOOKS}] ${query}`);
      const added = await importBook(query);
      if (added > 0) imported = (await bookCount()) - startCount;
      else skipped++;
      await delay(500);
    }
  }

  const finalCount = (await db.select({ id: books.id }).from(books)).length;
  console.log(`\n[nightly] Done! Net added: ${imported}, Skipped: ${skipped}, Failed: ${failed}`);
  console.log(`[nightly] Catalog: ${startCount} → ${finalCount} (+${finalCount - startCount})`);
  process.exit(0);
}

main();
