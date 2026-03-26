/**
 * BookTok / BookTube import — curated viral + community-favorite titles.
 * Target: ~1K new books (direct imports + author cascade).
 * Runs with: npx tsx scripts/import-booktok.ts
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

// ── BookTok / BookTube viral favorites ──────────────────────────────
// Curated from the most discussed titles on TikTok #BookTok,
// YouTube BookTube channels, and reading community polls 2020-2026.
const BOOKTOK_QUERIES = [
  // ─── Dark Romance / Spicy BookTok ───
  "Twisted Love Ana Huang",
  "Twisted Games Ana Huang",
  "Twisted Hate Ana Huang",
  "Twisted Lies Ana Huang",
  "King of Wrath Ana Huang",
  "King of Pride Ana Huang",
  "King of Greed Ana Huang",
  "Haunting Adeline H D Carlton",
  "Hunting Adeline H D Carlton",
  "Den of Vipers K A Knight",
  "Butcher and Blackbird Brynne Weaver",
  "Leather and Lark Brynne Weaver",
  "The Sweetest Oblivion Danielle Lori",
  "The Maddest Obsession Danielle Lori",
  "Things We Never Got Over Lucy Score",
  "Things We Hide from the Light Lucy Score",
  "Things We Left Behind Lucy Score",
  "Punk 57 Penelope Douglas",
  "Credence Penelope Douglas",
  "Birthday Girl Penelope Douglas",
  "Bully Penelope Douglas",
  "Corrupt Penelope Douglas",
  "Hideaway Penelope Douglas",
  "Kill Switch Penelope Douglas",
  "Nightfall Penelope Douglas",
  "Icebreaker Hannah Grace",
  "Wildfire Hannah Grace",
  "Daydream Hannah Grace",
  "Better Than the Movies Lynn Painter",
  "Right on Cue Lynn Painter",

  // ─── Romantasy (BookTok's biggest genre) ───
  "From Blood and Ash Jennifer L Armentrout",
  "A Kingdom of Flesh and Fire Jennifer L Armentrout",
  "The Crown of Gilded Bones Jennifer L Armentrout",
  "The War of Two Queens Jennifer L Armentrout",
  "A Soul of Ash and Blood Jennifer L Armentrout",
  "Born of Blood and Fire Jennifer L Armentrout",
  "Fall of Ruin and Wrath Jennifer L Armentrout",
  "The Serpent and the Wings of Night Carissa Broadbent",
  "The Songbird and the Heart of Stone Carissa Broadbent",
  "The Ashes and the Star-Cursed King Carissa Broadbent",
  "Daughter of No Worlds Carissa Broadbent",
  "Powerless Lauren Roberts",
  "Reckless Lauren Roberts",
  "Fearless Lauren Roberts",
  "Ruthless Vows Rebecca Ross",
  "Divine Rivals Rebecca Ross",
  "A Fire in the Flesh Jennifer L Armentrout",
  "The Primal of Blood and Bone Jennifer L Armentrout",
  "Lightlark Alex Aster",
  "Nightbane Alex Aster",
  "Skyshade Alex Aster",
  "House of Salt and Sorrows Erin A Craig",
  "House of Roots and Ruin Erin A Craig",
  "Throne of the Fallen Kerri Maniscalco",
  "Kingdom of the Wicked Kerri Maniscalco",
  "Kingdom of the Cursed Kerri Maniscalco",
  "Kingdom of the Feared Kerri Maniscalco",
  "Assistant to the Villain Hannah Nicole Maehrer",
  "Apprentice to the Villain Hannah Nicole Maehrer",

  // ─── Contemporary Romance BookTok ───
  "The Love Hypothesis Ali Hazelwood",
  "Love on the Brain Ali Hazelwood",
  "Check and Mate Ali Hazelwood",
  "Bride Ali Hazelwood",
  "Love Theoretically Ali Hazelwood",
  "Beach Read Emily Henry",
  "People We Meet on Vacation Emily Henry",
  "Book Lovers Emily Henry",
  "Happy Place Emily Henry",
  "Funny Story Emily Henry",
  "Great Big Beautiful Life Emily Henry",
  "The Spanish Love Deception Elena Armas",
  "The American Roommate Experiment Elena Armas",
  "Part of Your World Abby Jimenez",
  "Yours Truly Abby Jimenez",
  "Just for the Summer Abby Jimenez",
  "The Happy Ever After Playlist Abby Jimenez",
  "Life's Too Short Abby Jimenez",
  "The Friend Zone Abby Jimenez",
  "Tessa Bailey It Happened One Summer",
  "Hook Line and Sinker Tessa Bailey",
  "Fangirl Rainbow Rowell",
  "Eleanor and Park Rainbow Rowell",
  "The Flatshare Beth O'Leary",
  "The No-Show Beth O'Leary",
  "One Day in December Josie Silver",
  "In a Holidaze Christina Lauren",
  "The Unhoneymooners Christina Lauren",
  "Something Wilder Christina Lauren",

  // ─── BookTok Thrillers / Dark ───
  "The Silent Patient Alex Michaelides",
  "The Maidens Alex Michaelides",
  "The Maid Nita Prose",
  "The Housemaid Freida McFadden",
  "The Housemaid's Secret Freida McFadden",
  "Never Lie Freida McFadden",
  "The Inmate Freida McFadden",
  "Do You Remember Freida McFadden",
  "Ward D Freida McFadden",
  "The Teacher Freida McFadden",
  "One by One Ruth Ware",
  "The Woman in Cabin 10 Ruth Ware",
  "In a Dark Dark Wood Ruth Ware",
  "The It Girl Ruth Ware",
  "The Paris Apartment Lucy Foley",
  "The Guest List Lucy Foley",
  "The Hunting Party Lucy Foley",
  "None of This Is True Lisa Jewell",
  "Then She Was Gone Lisa Jewell",
  "The Family Upstairs Lisa Jewell",
  "Rock Paper Scissors Alice Feeney",
  "Sometimes I Lie Alice Feeney",
  "Daisy Darker Alice Feeney",
  "The Last Thing He Told Me Laura Dave",
  "Reminders of Him Colleen Hoover",

  // ─── BookTube Literary Fiction / Classics Hype ───
  "The Song of Achilles Madeline Miller",
  "Circe Madeline Miller",
  "Normal People Sally Rooney",
  "Beautiful World Where Are You Sally Rooney",
  "Conversations with Friends Sally Rooney",
  "Intermezzo Sally Rooney",
  "A Little Life Hanya Yanagihara",
  "The Goldfinch Donna Tartt",
  "The Secret History Donna Tartt",
  "The Idiot Elif Batuman",
  "My Year of Rest and Relaxation Ottessa Moshfegh",
  "Eileen Ottessa Moshfegh",
  "Lapvona Ottessa Moshfegh",
  "The Bell Jar Sylvia Plath",
  "Norwegian Wood Haruki Murakami",
  "Kafka on the Shore Haruki Murakami",
  "1Q84 Haruki Murakami",
  "The Wind-Up Bird Chronicle Haruki Murakami",
  "Never Let Me Go Kazuo Ishiguro",
  "Klara and the Sun Kazuo Ishiguro",
  "The Remains of the Day Kazuo Ishiguro",
  "The Kite Runner Khaled Hosseini",
  "A Thousand Splendid Suns Khaled Hosseini",
  "Pachinko Min Jin Lee",
  "The Vanishing Half Brit Bennett",

  // ─── Fantasy BookTube ───
  "The Priory of the Orange Tree Samantha Shannon",
  "A Day of Fallen Night Samantha Shannon",
  "The Bone Season Samantha Shannon",
  "The Mask of Mirrors M A Carrick",
  "The Liar's Knot M A Carrick",
  "Labyrinth's Heart M A Carrick",
  "Jade City Fonda Lee",
  "Jade War Fonda Lee",
  "Jade Legacy Fonda Lee",
  "The Jasmine Throne Tasha Suri",
  "The Oleander Sword Tasha Suri",
  "The Burning Kingdoms Tasha Suri",
  "She Who Became the Sun Shelley Parker-Chan",
  "He Who Drowned the World Shelley Parker-Chan",
  "Black Sun Rebecca Roanhorse",
  "Fevered Star Rebecca Roanhorse",
  "Mirrored Heavens Rebecca Roanhorse",
  "The Goblin Emperor Katherine Addison",
  "The Witness for the Dead Katherine Addison",
  "The Grief of Stones Katherine Addison",
  "Legends and Lattes Travis Baldree",
  "Bookshops and Bonedust Travis Baldree",
  "The Atlas Six Olivie Blake",
  "The Atlas Paradox Olivie Blake",
  "The Atlas Complex Olivie Blake",

  // ─── Sci-Fi BookTube ───
  "Project Hail Mary Andy Weir",
  "The Martian Andy Weir",
  "Artemis Andy Weir",
  "Recursion Blake Crouch",
  "Dark Matter Blake Crouch",
  "Upgrade Blake Crouch",
  "Klara and the Sun Kazuo Ishiguro",
  "The Long Way to a Small Angry Planet Becky Chambers",
  "A Closed and Common Orbit Becky Chambers",
  "Record of a Spaceborn Few Becky Chambers",
  "The Galaxy and the Ground Within Becky Chambers",
  "A Psalm for the Wild-Built Becky Chambers",
  "A Prayer for the Crown-Shy Becky Chambers",
  "Ancillary Justice Ann Leckie",
  "Ancillary Sword Ann Leckie",
  "Ancillary Mercy Ann Leckie",
  "Translation State Ann Leckie",
  "All Systems Red Martha Wells",
  "Artificial Condition Martha Wells",
  "Rogue Protocol Martha Wells",
  "Exit Strategy Martha Wells",
  "Network Effect Martha Wells",
  "Fugitive Telemetry Martha Wells",
  "System Collapse Martha Wells",
  "The Calculating Stars Mary Robinette Kowal",
  "The Fated Sky Mary Robinette Kowal",
  "Children of Time Adrian Tchaikovsky",
  "Children of Ruin Adrian Tchaikovsky",
  "Children of Memory Adrian Tchaikovsky",

  // ─── YA BookTok ───
  "The Cruel Prince Holly Black",
  "The Wicked King Holly Black",
  "The Queen of Nothing Holly Black",
  "Six of Crows Leigh Bardugo",
  "Crooked Kingdom Leigh Bardugo",
  "Shadow and Bone Leigh Bardugo",
  "Siege and Storm Leigh Bardugo",
  "Ruin and Rising Leigh Bardugo",
  "King of Scars Leigh Bardugo",
  "Rule of Wolves Leigh Bardugo",
  "Ninth House Leigh Bardugo",
  "Hell Bent Leigh Bardugo",
  "These Hollow Vows Lexi Ryan",
  "These Twisted Bonds Lexi Ryan",
  "Caraval Stephanie Garber",
  "Legendary Stephanie Garber",
  "Finale Stephanie Garber",
  "Once Upon a Broken Heart Stephanie Garber",
  "The Ballad of Never After Stephanie Garber",
  "A Curse for True Love Stephanie Garber",

  // ─── Horror / Gothic BookTok ───
  "Mexican Gothic Silvia Moreno-Garcia",
  "The Only Good Indians Stephen Graham Jones",
  "My Heart Is a Chainsaw Stephen Graham Jones",
  "Don't Fear the Reaper Stephen Graham Jones",
  "The Angel of Indian Lake Stephen Graham Jones",
  "The Haunting of Hill House Shirley Jackson",
  "We Have Always Lived in the Castle Shirley Jackson",
  "House of Leaves Mark Z Danielewski",
  "Bunny Mona Awad",
  "Rouge Mona Awad",
  "All's Well Mona Awad",
  "The Troop Nick Cutter",
  "Tender is the Flesh Agustina Bazterrica",
  "The Southern Book Club's Guide to Slaying Vampires Grady Hendrix",
  "Horrorstör Grady Hendrix",
  "My Best Friend's Exorcism Grady Hendrix",
  "How to Sell a Haunted House Grady Hendrix",

  // ─── Nonfiction BookTok/BookTube ───
  "Educated Tara Westover",
  "The Glass Castle Jeannette Walls",
  "Crying in H Mart Michelle Zauner",
  "Know My Name Chanel Miller",
  "I'm Glad My Mom Died Jennette McCurdy",
  "Greenlights Matthew McConaughey",
  "The Body Keeps the Score Bessel van der Kolk",
  "Man's Search for Meaning Viktor Frankl",
  "Sapiens Yuval Noah Harari",
  "Homo Deus Yuval Noah Harari",
  "21 Lessons for the 21st Century Yuval Noah Harari",
  "Born a Crime Trevor Noah",
  "Becoming Michelle Obama",
  "When Breath Becomes Air Paul Kalanithi",
  "In Order to Live Yeonmi Park",
];

// ── Helper functions (reused from nightly-import) ──────────────────

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

    // Enrich (skip if approaching limit to save API calls)
    if (totalNewBooks <= 200) {
      try {
        await enrichBook(book.id);
      } catch (err) {
        console.warn(`  Enrichment failed for ${result.title}:`, err);
      }
    }

    // Cascade import author catalogs
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
  const MAX_RUNTIME_MS = 4 * 60 * 60 * 1000; // 4 hours max

  const startCount = (await db.select({ id: books.id }).from(books)).length;
  console.log(`[booktok] Starting import — ${BOOKTOK_QUERIES.length} queries, limit ${MAX_NEW_BOOKS} new books`);
  console.log(`[booktok] Current book count: ${startCount}`);

  let imported = 0;
  let skipped = 0;

  for (const query of BOOKTOK_QUERIES) {
    if (totalNewBooks >= MAX_NEW_BOOKS) {
      console.log(`\n[booktok] Hit ${MAX_NEW_BOOKS} new books limit, stopping`);
      break;
    }
    if (Date.now() - startTime > MAX_RUNTIME_MS) {
      console.log(`\n[booktok] Hit max runtime, stopping`);
      break;
    }

    console.log(`\n[${imported + skipped + 1}/${BOOKTOK_QUERIES.length}] ${query}`);
    const result = await importBook(query);
    if (result) imported++;
    else skipped++;

    await delay(800); // Slow pace
  }

  const finalCount = (await db.select({ id: books.id }).from(books)).length;
  console.log(`\n[booktok] ═══════════════════════════════════`);
  console.log(`[booktok] Done! Direct imports: ${imported}, Skipped: ${skipped}`);
  console.log(`[booktok] Total new books (incl. cascade): ${totalNewBooks}`);
  console.log(`[booktok] Book count: ${startCount} → ${finalCount} (+${finalCount - startCount})`);
  console.log(`[booktok] Runtime: ${((Date.now() - startTime) / 1000 / 60).toFixed(1)} minutes`);
  process.exit(0);
}

main();
