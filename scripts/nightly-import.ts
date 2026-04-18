/**
 * Nightly import script — imports popular books into the tbra database.
 * Targets: bestsellers (current → backwards), classics, education staples.
 * Runs with: npx tsx scripts/nightly-import.ts
 *
 * Each run picks a batch of search queries and imports books found.
 * The cascade import will pull all books by discovered authors.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "../src/db";
import { books, authors, bookAuthors, genres, bookGenres } from "../src/db/schema";
import { eq } from "drizzle-orm";
import {
  searchOpenLibrary,
  fetchOpenLibraryWork,
  buildCoverUrl,
  normalizeGenres,
  fetchAuthorWorks,
  findEnglishEditionTitle,
} from "../src/lib/openlibrary";
import { enrichBook } from "../src/lib/enrichment/enrich-book";

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

async function importCascadeBooks(authorOlKeys: string[]) {
  for (const authorKey of authorOlKeys) {
    await delay(350);
    const works = await fetchAuthorWorks(authorKey);
    for (const work of works) {
      const workKey = work.key;
      const existing = await db.query.books.findFirst({ where: eq(books.openLibraryKey, workKey) });
      if (existing) continue;
      const coverUrl = buildCoverUrl(work.covers?.[0], "L");
      // Resolve English title for foreign-language works
      const englishTitle = await findEnglishEditionTitle(workKey);
      await delay(350);
      const [newBook] = await db.insert(books).values({
        title: englishTitle ?? work.title,
        coverImageUrl: coverUrl,
        openLibraryKey: workKey,
      }).returning();
      const author = await db.query.authors.findFirst({ where: eq(authors.openLibraryKey, authorKey) });
      if (author) {
        await db.insert(bookAuthors).values({ bookId: newBook.id, authorId: author.id }).onConflictDoNothing();
      }
    }
  }
}

async function importBook(query: string): Promise<boolean> {
  try {
    const results = await searchOpenLibrary(query, 3);
    if (results.length === 0) {
      console.log(`  No results for: ${query}`);
      return false;
    }

    const result = results[0];

    // Check if already imported
    const existing = await db.query.books.findFirst({
      where: eq(books.openLibraryKey, result.key),
    });
    if (existing) {
      console.log(`  Already imported: ${result.title}`);
      return false;
    }

    // Fetch work details
    await delay(300);
    const work = await fetchOpenLibraryWork(result.key);
    const coverUrl = buildCoverUrl(work.coverId, "L") ?? buildCoverUrl(result.cover_i, "L");
    const genreNames = normalizeGenres(work.subjects);
    const isFiction = detectIsFiction(genreNames);

    const [book] = await db.insert(books).values({
      title: result.title,
      description: work.description,
      publicationYear: result.first_publish_year,
      isbn13: result.isbn?.find((i) => i.length === 13) ?? null,
      isbn10: result.isbn?.find((i) => i.length === 10) ?? null,
      pages: result.number_of_pages_median,
      coverImageUrl: coverUrl,
      openLibraryKey: result.key,
      isFiction,
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

    // Enrich
    try {
      await enrichBook(book.id);
    } catch (err) {
      console.warn(`  Enrichment failed for ${result.title}:`, err);
    }

    // Cascade import (non-blocking for the script, but we await for thoroughness)
    if (authorOlKeys.length > 0) {
      try {
        await importCascadeBooks(authorOlKeys);
      } catch (err) {
        console.warn(`  Cascade failed:`, err);
      }
    }

    console.log(`  Imported: ${result.title}`);
    return true;
  } catch (err) {
    console.error(`  Error importing "${query}":`, err);
    return false;
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

async function main() {
  const startTime = Date.now();
  const MAX_RUNTIME_MS = 5 * 60 * 60 * 1000; // 5 hours safety cap

  // Volume cap — override via env TARGET_BOOKS
  const TARGET_BOOKS = Number(process.env.TARGET_BOOKS) || 500;

  // Christian queries get double-weight per user direction (prioritize
  // Christian fiction + nonfiction in discovery). Other pools are single-weight.
  const allQueries = seededShuffle([
    ...BESTSELLER_QUERIES,
    ...CLASSICS_QUERIES,
    ...EDUCATION_QUERIES,
    ...CHRISTIAN_FICTION_QUERIES,
    ...CHRISTIAN_FICTION_QUERIES,        // 2× weight
    ...CHRISTIAN_NONFICTION_QUERIES,
    ...CHRISTIAN_NONFICTION_QUERIES,     // 2× weight
  ]);

  let imported = 0;
  let skipped = 0;
  let failed = 0;

  console.log(`[nightly] Target: ${TARGET_BOOKS} books; query pool size: ${allQueries.length}`);
  console.log(`[nightly] Current book count: ${(await db.select({ id: books.id }).from(books)).length}`);

  for (const query of allQueries) {
    if (imported >= TARGET_BOOKS) {
      console.log(`[nightly] Hit target ${TARGET_BOOKS}, stopping`);
      break;
    }
    if (Date.now() - startTime > MAX_RUNTIME_MS) {
      console.log(`[nightly] Hit max runtime, stopping`);
      break;
    }

    console.log(`\n[${imported + skipped + failed + 1}/${allQueries.length}] ${query}`);
    const result = await importBook(query);
    if (result) imported++;
    else skipped++;

    await delay(500); // Be nice to APIs
  }

  const finalCount = (await db.select({ id: books.id }).from(books)).length;
  console.log(`\n[nightly] Done! Imported: ${imported}, Skipped: ${skipped}, Failed: ${failed}`);
  console.log(`[nightly] Final book count: ${finalCount}`);
  process.exit(0);
}

main();
