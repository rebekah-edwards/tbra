/**
 * NYT Bestsellers import — curated titles from NYT Fiction, Nonfiction,
 * Young Adult, and Children's lists (2020-2026).
 * Target: ~1K new books (direct imports + author cascade).
 * Runs with: npx tsx scripts/import-nyt-bestsellers.ts
 *
 * Slow pace: 800ms between queries, 500ms between cascade books.
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

// ── NYT Bestseller Lists (2020–2026) ───────────────────────────────
const NYT_QUERIES = [
  // ─── NYT Fiction Bestsellers 2024-2026 ───
  "Intermezzo Sally Rooney",
  "James Percival Everett",
  "We Solve Murders Richard Osman",
  "The God of the Woods Liz Moore",
  "The Women Kristin Hannah",
  "All Fours Miranda July",
  "The Ministry of Time Kaliane Bradley",
  "Long Island Colm Toibin",
  "Sandwich Catherine Newman",
  "The Anxious Generation Jonathan Haidt",
  "Table for Two Amor Towles",
  "Somehow Adriana Trigiani",
  "The Familiar Leigh Bardugo",
  "Wind and Truth Brandon Sanderson",
  "Counting Miracles Nicholas Sparks",
  "Swan Song Elin Hilderbrand",
  "Eruption Michael Crichton",
  "The Life Impossible Matt Haig",
  "Here One Moment Liane Moriarty",
  "All the Colors of the Dark Chris Whitaker",
  "Camino Ghosts John Grisham",
  "The Edge David Baldacci",
  "First Lie Wins Ashley Elston",
  "The Paradise Problem Christina Lauren",
  "Funny Story Emily Henry",
  "You Like It Darker Stephen King",

  // ─── NYT Fiction 2023 ───
  "Holly Stephen King",
  "Tom Clancy Red Winter Marc Cameron",
  "The Exchange John Grisham",
  "Hello Beautiful Ann Napolitano",
  "Lessons in Chemistry Bonnie Garmus",
  "The Covenant of Water Abraham Verghese",
  "Fourth Wing Rebecca Yarros",
  "Iron Flame Rebecca Yarros",
  "A Court of Thorns and Roses Sarah J Maas",
  "Demon Copperhead Barbara Kingsolver",
  "Tomorrow and Tomorrow and Tomorrow Gabrielle Zevin",
  "The Wager David Grann",
  "Killers of the Flower Moon David Grann",

  // ─── NYT Fiction 2022 ───
  "It Ends with Us Colleen Hoover",
  "Fairy Tale Stephen King",
  "The Hotel Nantucket Elin Hilderbrand",
  "Sparring Partners John Grisham",
  "Run Rose Run Dolly Parton",
  "Dream Town David Baldacci",
  "The Recovery Agent Janet Evanovich",
  "The Match Harlan Coben",
  "The Lightning Rod Brad Meltzer",
  "Sea of Tranquility Emily St John Mandel",
  "The Paris Apartment Lucy Foley",
  "The Maid Nita Prose",

  // ─── NYT Fiction 2021 ───
  "The Lincoln Highway Amor Towles",
  "The Judge's List John Grisham",
  "Apples Never Fall Liane Moriarty",
  "Beautiful World Where Are You Sally Rooney",
  "The Last Thing He Told Me Laura Dave",
  "Malibu Rising Taylor Jenkins Reid",
  "The Midnight Library Matt Haig",
  "People We Meet on Vacation Emily Henry",
  "The Four Winds Kristin Hannah",
  "Later Stephen King",
  "The Vanishing Half Brit Bennett",

  // ─── NYT Fiction 2020 ───
  "A Time for Mercy John Grisham",
  "The Evening and the Morning Ken Follett",
  "The Return Nicholas Sparks",
  "Anxious People Fredrik Backman",
  "The Invisible Life of Addie LaRue V.E. Schwab",
  "A Promised Land Barack Obama",
  "Troubled Blood Robert Galbraith",
  "Ready Player Two Ernest Cline",
  "The Sentinel Lee Child",

  // ─── NYT Nonfiction Bestsellers 2023-2026 ───
  "Outlive Peter Attia",
  "The Wager David Grann",
  "The Light We Carry Michelle Obama",
  "I'm Glad My Mom Died Jennette McCurdy",
  "Spare Prince Harry",
  "Greenlights Matthew McConaughey",
  "The Body Keeps the Score Bessel van der Kolk",
  "Atomic Habits James Clear",
  "Untamed Glennon Doyle",
  "Educated Tara Westover",
  "Caste Isabel Wilkerson",
  "Think Again Adam Grant",
  "The Subtle Art of Not Giving a F Mark Manson",
  "Can't Hurt Me David Goggins",
  "Never Finished David Goggins",
  "12 Rules for Life Jordan Peterson",
  "Beyond Order Jordan Peterson",
  "Range David Epstein",
  "Talking to Strangers Malcolm Gladwell",
  "Outliers Malcolm Gladwell",
  "The Tipping Point Malcolm Gladwell",
  "Blink Malcolm Gladwell",
  "The Psychology of Money Morgan Housel",
  "Rich Dad Poor Dad Robert Kiyosaki",
  "The 7 Habits of Highly Effective People Stephen Covey",
  "How to Win Friends and Influence People Dale Carnegie",
  "Thinking Fast and Slow Daniel Kahneman",
  "Sapiens Yuval Noah Harari",
  "The Power of Now Eckhart Tolle",
  "Man's Search for Meaning Viktor Frankl",
  "When Breath Becomes Air Paul Kalanithi",
  "Born a Crime Trevor Noah",
  "Crying in H Mart Michelle Zauner",

  // ─── NYT Young Adult 2022-2026 ───
  "The Ballad of Songbirds and Snakes Suzanne Collins",
  "Sunrise on the Reaping Suzanne Collins",
  "House of Salt and Sorrows Erin A Craig",
  "Powerless Lauren Roberts",
  "Reckless Lauren Roberts",
  "Lightlark Alex Aster",
  "Caraval Stephanie Garber",
  "The Cruel Prince Holly Black",
  "Children of Blood and Bone Tomi Adeyemi",
  "Legendborn Tracy Deonn",
  "Bloodmarked Tracy Deonn",
  "The Inheritance Games Jennifer Lynn Barnes",
  "The Hawthorne Legacy Jennifer Lynn Barnes",
  "Final Gambit Jennifer Lynn Barnes",
  "The Brothers Hawthorne Jennifer Lynn Barnes",
  "A Good Girl's Guide to Murder Holly Jackson",
  "Good Girl Bad Blood Holly Jackson",
  "As Good as Dead Holly Jackson",
  "Five Survive Holly Jackson",
  "The Hunger Games Suzanne Collins",
  "Catching Fire Suzanne Collins",
  "Mockingjay Suzanne Collins",
  "Divergent Veronica Roth",
  "Insurgent Veronica Roth",
  "Allegiant Veronica Roth",
  "The Maze Runner James Dashner",
  "The Scorch Trials James Dashner",
  "Red Queen Victoria Aveyard",
  "An Ember in the Ashes Sabaa Tahir",
  "A Torch Against the Night Sabaa Tahir",
  "We Were Liars E Lockhart",
  "The Hate U Give Angie Thomas",
  "On the Come Up Angie Thomas",
  "Concrete Rose Angie Thomas",

  // ─── NYT Children's / Middle Grade 2022-2026 ───
  "Percy Jackson and the Olympians The Lightning Thief Rick Riordan",
  "The Sea of Monsters Rick Riordan",
  "The Battle of the Labyrinth Rick Riordan",
  "The Last Olympian Rick Riordan",
  "The Lost Hero Rick Riordan",
  "The Son of Neptune Rick Riordan",
  "The Mark of Athena Rick Riordan",
  "The House of Hades Rick Riordan",
  "The Blood of Olympus Rick Riordan",
  "Keeper of the Lost Cities Shannon Messenger",
  "Exile Shannon Messenger",
  "Everblaze Shannon Messenger",
  "Wings of Fire Tui T Sutherland",
  "The One and Only Ivan Katherine Applegate",
  "Diary of a Wimpy Kid Jeff Kinney",
  "Dog Man Dav Pilkey",
  "The Wild Robot Peter Brown",
  "Hatchet Gary Paulsen",
  "Wonder R J Palacio",
  "The Giver Lois Lowry",
  "Number the Stars Lois Lowry",
  "Bridge to Terabithia Katherine Paterson",
  "Holes Louis Sachar",
  "Because of Winn-Dixie Kate DiCamillo",
  "The Tale of Despereaux Kate DiCamillo",

  // ─── Recent Award-Adjacent Bestsellers ───
  "Demon Copperhead Barbara Kingsolver",
  "Trust Hernan Diaz",
  "The Sympathizer Viet Thanh Nguyen",
  "Shuggie Bain Douglas Stuart",
  "The Overstory Richard Powers",
  "Hamnet Maggie O'Farrell",
  "Bewilderment Richard Powers",
  "Piranesi Susanna Clarke",
  "Detransition Baby Torrey Peters",
  "Klara and the Sun Kazuo Ishiguro",
  "The Promise Damon Galgut",
  "Prophet Song Paul Lynch",
  "Orbital Samantha Harvey",
  "Small Things Like These Claire Keegan",
];

// ── Helper functions ──────────────────────────────────────────────

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

let totalNewBooks = 0;
const MAX_NEW_BOOKS = 1000;

async function importCascadeBooks(authorOlKeys: string[]) {
  for (const authorKey of authorOlKeys) {
    if (totalNewBooks >= MAX_NEW_BOOKS) return;
    await delay(500);
    try {
      const works = await fetchAuthorWorks(authorKey);
      for (const work of works) {
        if (totalNewBooks >= MAX_NEW_BOOKS) return;
        const workKey = work.key;
        const existing = await db.query.books.findFirst({ where: eq(books.openLibraryKey, workKey) });
        if (existing) continue;
        const coverUrl = buildCoverUrl(work.covers?.[0], "L");
        const englishTitle = await findEnglishEditionTitle(workKey);
        await delay(500);
        const [newBook] = await db.insert(books).values({
          title: englishTitle ?? work.title,
          coverImageUrl: coverUrl,
          openLibraryKey: workKey,
        }).returning();
        const author = await db.query.authors.findFirst({ where: eq(authors.openLibraryKey, authorKey) });
        if (author) {
          await db.insert(bookAuthors).values({ bookId: newBook.id, authorId: author.id }).onConflictDoNothing();
        }
        totalNewBooks++;
        if (totalNewBooks % 50 === 0) {
          console.log(`  [cascade] ${totalNewBooks} new books so far...`);
        }
      }
    } catch (err) {
      console.warn(`  Cascade error for ${authorKey}:`, err);
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
    const existing = await db.query.books.findFirst({
      where: eq(books.openLibraryKey, result.key),
    });
    if (existing) {
      console.log(`  Already imported: ${result.title}`);
      return false;
    }

    await delay(500);
    const work = await fetchOpenLibraryWork(result.key);
    const coverUrl = buildCoverUrl(work.coverId, "L") ?? buildCoverUrl(result.cover_i, "L");
    const genreNames = normalizeGenres(work.subjects);
    const isFiction = detectIsFiction(genreNames);

    const [book] = await db.insert(books).values({
      title: result.title,
      description: work.description,
      publicationYear: result.first_publish_year,
      isbn13: result.isbn?.find((i: string) => i.length === 13) ?? null,
      isbn10: result.isbn?.find((i: string) => i.length === 10) ?? null,
      pages: result.number_of_pages_median,
      coverImageUrl: coverUrl,
      openLibraryKey: result.key,
      isFiction,
    }).returning();

    totalNewBooks++;

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

    for (const genreName of genreNames) {
      let genre = await db.query.genres.findFirst({ where: eq(genres.name, genreName) });
      if (!genre) {
        [genre] = await db.insert(genres).values({ name: genreName }).returning();
      }
      await db.insert(bookGenres).values({ bookId: book.id, genreId: genre.id }).onConflictDoNothing();
    }

    // Enrich first 200 direct imports
    if (totalNewBooks <= 200) {
      try {
        await enrichBook(book.id);
      } catch (err) {
        console.warn(`  Enrichment failed for ${result.title}:`, err);
      }
    }

    if (authorOlKeys.length > 0 && totalNewBooks < MAX_NEW_BOOKS) {
      try {
        await importCascadeBooks(authorOlKeys);
      } catch (err) {
        console.warn(`  Cascade failed:`, err);
      }
    }

    console.log(`  ✓ Imported: ${result.title} (total new: ${totalNewBooks})`);
    return true;
  } catch (err) {
    console.error(`  ✗ Error importing "${query}":`, err);
    return false;
  }
}

async function main() {
  const startTime = Date.now();
  const MAX_RUNTIME_MS = 4 * 60 * 60 * 1000;

  const startCount = (await db.select({ id: books.id }).from(books)).length;
  console.log(`[nyt] Starting import — ${NYT_QUERIES.length} queries, limit ${MAX_NEW_BOOKS} new books`);
  console.log(`[nyt] Current book count: ${startCount}`);

  let imported = 0;
  let skipped = 0;

  for (const query of NYT_QUERIES) {
    if (totalNewBooks >= MAX_NEW_BOOKS) {
      console.log(`\n[nyt] Hit ${MAX_NEW_BOOKS} new books limit, stopping`);
      break;
    }
    if (Date.now() - startTime > MAX_RUNTIME_MS) {
      console.log(`\n[nyt] Hit max runtime, stopping`);
      break;
    }

    console.log(`\n[${imported + skipped + 1}/${NYT_QUERIES.length}] ${query}`);
    const result = await importBook(query);
    if (result) imported++;
    else skipped++;

    await delay(800);
  }

  const finalCount = (await db.select({ id: books.id }).from(books)).length;
  console.log(`\n[nyt] ═══════════════════════════════════`);
  console.log(`[nyt] Done! Direct imports: ${imported}, Skipped: ${skipped}`);
  console.log(`[nyt] Total new books (incl. cascade): ${totalNewBooks}`);
  console.log(`[nyt] Book count: ${startCount} → ${finalCount} (+${finalCount - startCount})`);
  console.log(`[nyt] Runtime: ${((Date.now() - startTime) / 1000 / 60).toFixed(1)} minutes`);
  process.exit(0);
}

main();
