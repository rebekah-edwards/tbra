import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import {
  books,
  authors,
  bookAuthors,
  bookCategoryRatings,
  taxonomyCategories,
} from "./schema";
import path from "path";
import fs from "fs";

const dataDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, "tbra.db");
const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

const db = drizzle(sqlite, {
  schema: { books, authors, bookAuthors, bookCategoryRatings, taxonomyCategories },
});

const OL_BASE = "https://openlibrary.org";
const COVERS_BASE = "https://covers.openlibrary.org";
const USER_AGENT = "tbra/0.1.0 (https://github.com/rebekah-edwards/tbra)";

// 15 books chosen for genre diversity — we search OL to find the right key
const SEED_QUERIES = [
  "Beloved Toni Morrison",
  "The Great Gatsby",
  "The Hunger Games Suzanne Collins",
  "Dune Frank Herbert",
  "Pride and Prejudice",
  "The Fault in Our Stars John Green",
  "Circe Madeline Miller",
  "The Road Cormac McCarthy",
  "Brave New World",
  "Slaughterhouse-Five Kurt Vonnegut",
  "Jane Eyre",
  "Kindred Octavia Butler",
  "Mexican Gothic Silvia Moreno-Garcia",
  "An American Marriage Tayari Jones",
  "The House in the Cerulean Sea TJ Klune",
];

// Sample taxonomy ratings for 6 books (keyed by search query prefix)
const SAMPLE_RATINGS: Record<
  string,
  { categoryKey: string; intensity: number; notes: string; evidence: string }[]
> = {
  "Beloved": [
    { categoryKey: "violence_gore", intensity: 4, notes: "Graphic depictions of slavery violence", evidence: "cited" },
    { categoryKey: "sexual_assault_coercion", intensity: 3, notes: "Sexual violence under slavery", evidence: "cited" },
    { categoryKey: "child_harm", intensity: 4, notes: "Central to the plot", evidence: "human_verified" },
    { categoryKey: "profanity_language", intensity: 2, notes: "Moderate strong language", evidence: "ai_inferred" },
  ],
  "The Hunger Games": [
    { categoryKey: "violence_gore", intensity: 3, notes: "Arena combat, child-on-child violence", evidence: "cited" },
    { categoryKey: "child_harm", intensity: 3, notes: "Children forced to fight to the death", evidence: "human_verified" },
    { categoryKey: "political_ideological", intensity: 2, notes: "Dystopian government critique", evidence: "ai_inferred" },
  ],
  "The Road": [
    { categoryKey: "violence_gore", intensity: 4, notes: "Post-apocalyptic brutality, cannibalism", evidence: "cited" },
    { categoryKey: "child_harm", intensity: 2, notes: "Child in constant danger but not directly harmed", evidence: "ai_inferred" },
    { categoryKey: "self_harm_suicide", intensity: 2, notes: "Suicidal ideation as a theme", evidence: "ai_inferred" },
    { categoryKey: "profanity_language", intensity: 1, notes: "Sparse language overall", evidence: "ai_inferred" },
  ],
  "Brave New World": [
    { categoryKey: "sexual_content", intensity: 3, notes: "Casual sex is a societal norm, discussed openly", evidence: "cited" },
    { categoryKey: "substance_use", intensity: 3, notes: "Soma use is central to the plot", evidence: "human_verified" },
    { categoryKey: "political_ideological", intensity: 3, notes: "Heavy dystopian social commentary", evidence: "cited" },
  ],
  "Circe": [
    { categoryKey: "sexual_content", intensity: 2, notes: "Some romantic/sexual scenes, not explicit", evidence: "ai_inferred" },
    { categoryKey: "sexual_assault_coercion", intensity: 2, notes: "Sexual assault occurs, not graphic", evidence: "cited" },
    { categoryKey: "violence_gore", intensity: 2, notes: "Mythological violence", evidence: "ai_inferred" },
    { categoryKey: "witchcraft_occult", intensity: 3, notes: "Witchcraft is central — Circe is a witch", evidence: "human_verified" },
  ],
  "The House in the Cerulean Sea": [
    { categoryKey: "lgbtqia_representation", intensity: 3, notes: "Gay romance central to the story", evidence: "human_verified" },
    { categoryKey: "violence_gore", intensity: 0, notes: "Cozy, no violence", evidence: "ai_inferred" },
    { categoryKey: "profanity_language", intensity: 0, notes: "Clean language throughout", evidence: "ai_inferred" },
  ],
};

async function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function olFetch(url: string) {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) throw new Error(`OL fetch failed: ${res.status} ${url}`);
  return res.json();
}

async function findOrCreateAuthor(name: string): Promise<string> {
  const existing = db
    .select()
    .from(authors)
    .where(eq(authors.name, name))
    .get();
  if (existing) return existing.id;
  const [created] = await db.insert(authors).values({ name }).returning();
  return created.id;
}

async function seed() {
  console.log("Seeding 15 books from Open Library...\n");

  for (const query of SEED_QUERIES) {
    // Search OL for this book
    await delay(350);
    const params = new URLSearchParams({
      q: query,
      limit: "1",
      fields: "key,title,author_name,first_publish_year,cover_i,number_of_pages_median",
    });
    const searchData = await olFetch(`${OL_BASE}/search.json?${params}`);
    const hit = searchData.docs?.[0];
    if (!hit) {
      console.log(`  Not found: ${query}`);
      continue;
    }

    const key: string = hit.key;

    // Check if already imported
    const existing = db
      .select()
      .from(books)
      .where(eq(books.openLibraryKey, key))
      .get();
    if (existing) {
      console.log(`  Already exists: ${existing.title}`);
      continue;
    }

    // Fetch work for description
    await delay(350);
    const work = await olFetch(`${OL_BASE}${key}.json`);

    // Extract description
    let description: string | null = null;
    if (work.description) {
      description =
        typeof work.description === "string"
          ? work.description
          : work.description.value ?? null;
    }

    // Cover URL — prefer search cover_i, fall back to work covers
    const coverId = hit.cover_i ?? work.covers?.[0];
    const coverUrl = coverId
      ? `${COVERS_BASE}/b/id/${coverId}-L.jpg`
      : null;

    const title = hit.title || work.title;
    if (!title) {
      console.log(`  No title for: ${query}`);
      continue;
    }

    // Insert book
    const [book] = await db
      .insert(books)
      .values({
        title,
        description,
        publicationYear: hit.first_publish_year ?? null,
        pages: hit.number_of_pages_median ?? null,
        coverImageUrl: coverUrl,
        openLibraryKey: key,
      })
      .returning();

    // Link authors from search result
    const authorNames: string[] = hit.author_name ?? [];
    for (const name of authorNames) {
      const authorId = await findOrCreateAuthor(name);
      await db
        .insert(bookAuthors)
        .values({ bookId: book.id, authorId })
        .onConflictDoNothing();
    }

    console.log(
      `  Added: ${book.title}${authorNames.length ? ` by ${authorNames.join(", ")}` : ""}`
    );

    // Add taxonomy ratings if we have sample data (match by first word(s) of query)
    const ratingKey = Object.keys(SAMPLE_RATINGS).find((k) =>
      query.startsWith(k)
    );
    if (ratingKey) {
      const sampleRatings = SAMPLE_RATINGS[ratingKey];
      for (const rating of sampleRatings) {
        const category = db
          .select()
          .from(taxonomyCategories)
          .where(eq(taxonomyCategories.key, rating.categoryKey))
          .get();
        if (category) {
          await db.insert(bookCategoryRatings).values({
            bookId: book.id,
            categoryId: category.id,
            intensity: rating.intensity,
            notes: rating.notes,
            evidenceLevel: rating.evidence,
          });
        }
      }
      console.log(`    + ${sampleRatings.length} content ratings`);
    }
  }

  console.log("\nDone!");
  sqlite.close();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
