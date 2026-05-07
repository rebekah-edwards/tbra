#!/usr/bin/env tsx
/**
 * Manually add "American Paladin" by Larry Correia.
 * Pre-release (June 23, 2026), data sourced from PDF — no API calls.
 *
 * Usage: npx tsx scripts/add-american-paladin.ts
 */
import { config } from "dotenv";
import path from "path";

config({ path: path.resolve(process.cwd(), ".env.local") });

import { db } from "../src/db";
import { books, authors, bookAuthors, series, bookSeries } from "../src/db/schema";
import { sql, eq } from "drizzle-orm";
import { assignBookSlug, generateAuthorSlug } from "../src/lib/utils/slugify";
import crypto from "crypto";

const TITLE = "American Paladin";
const AUTHOR_NAME = "Larry Correia";
const SERIES_NAME = "American Paladin";
const ISBN_13 = "9781945649554";
const ISBN_10 = "1945649550";
const PAGES = 264;
const PUBLICATION_YEAR = 2026;
const PUBLICATION_DATE = "2026-06-23";
const PUBLISHER = "Ark Press";

const DESCRIPTION = `First entry in an all-new contemporary fantasy series by New York Times and USA Today best-selling author Larry Correia, creator of Monster Hunter International. Paranormal worlds collide, monsters emerge, and one man stands alone to face them down when no one else will.

One Man to Step Into the Darkness

Mike Spears is a drifter, a vigilante, an expert in taking down the evil in our world one monstrous incursion at a time. He's anonymous and low profile because he needs to be. A man with a name only whispered in legend and only spoken aloud in desperate straits.

Welcome to the dark places of the modern American west—a west where mythic worlds roam the landscape like so many weather fronts. And when those fronts collide, horror often spills out. Blood-soaked ground. Vanished neighbors. Towns gutted by monstrous horrors no one dares name. The so-called authorities won't touch this stuff. Most won't even admit it's real.

But when the last shred of hope is nearly spent, there's one man who will step into that darkness—and deal with it.

Now a true-crime podcaster is closing in on the truth about Spears and the strange world he navigates. Too close. She's drawn something demonic through the door between worlds—a kill team from another deeply twisted reality. And, if Spears is right, these techno-Aztec operators are only the tip of an apocalyptic invasion set to bathe our land in blood.

But first they'll have to get past Spears.`;

async function findOrCreateAuthor(name: string): Promise<string> {
  const existing = (await db.all(sql`
    SELECT id FROM authors WHERE LOWER(name) = LOWER(${name}) LIMIT 1
  `)) as { id: string }[];
  if (existing[0]) {
    console.log(`  ✓ Author exists: ${name} (id=${existing[0].id})`);
    return existing[0].id;
  }
  const id = crypto.randomUUID();
  const slug = generateAuthorSlug(name);
  await db.insert(authors).values({ id, name, slug });
  console.log(`  + Created author: ${name} (id=${id})`);
  return id;
}

async function findOrCreateSeries(name: string): Promise<string> {
  const existing = (await db.all(sql`
    SELECT id FROM series WHERE LOWER(name) = LOWER(${name}) LIMIT 1
  `)) as { id: string }[];
  if (existing[0]) {
    console.log(`  ✓ Series exists: ${name} (id=${existing[0].id})`);
    return existing[0].id;
  }
  const id = crypto.randomUUID();
  await db.insert(series).values({ id, name });
  console.log(`  + Created series: ${name} (id=${id})`);
  return id;
}

async function main() {
  console.log("=== Adding American Paladin ===");

  const existingByIsbn = await db
    .select({ id: books.id, title: books.title })
    .from(books)
    .where(eq(books.isbn13, ISBN_13))
    .limit(1);
  if (existingByIsbn[0]) {
    console.log(`Book already exists by ISBN: ${existingByIsbn[0].title} (id=${existingByIsbn[0].id})`);
    process.exit(0);
  }

  const authorId = await findOrCreateAuthor(AUTHOR_NAME);
  const seriesId = await findOrCreateSeries(SERIES_NAME);

  const bookId = crypto.randomUUID();
  console.log(`  + Inserting book ${bookId}`);
  await db.insert(books).values({
    id: bookId,
    title: TITLE,
    description: DESCRIPTION,
    isbn10: ISBN_10,
    isbn13: ISBN_13,
    pages: PAGES,
    publicationYear: PUBLICATION_YEAR,
    publicationDate: PUBLICATION_DATE,
    publisher: PUBLISHER,
    isFiction: true,
    isBoxSet: false,
    coverImageUrl: null,
    coverSource: null,
    coverVerified: false,
    visibility: "public",
  });

  await db.insert(bookAuthors).values({ bookId, authorId, role: "author" });
  console.log(`  + Linked author`);

  await db.insert(bookSeries).values({ bookId, seriesId, positionInSeries: 1 });
  console.log(`  + Linked series (position 1)`);

  const slug = await assignBookSlug(bookId, TITLE, AUTHOR_NAME);
  console.log(`  + Assigned slug: ${slug}`);

  console.log("\n=== Done ===");
  console.log(`Book ID: ${bookId}`);
  console.log(`URL path: /book/${slug}`);
  console.log(`\nNext: ./scripts/sync-incremental.sh push`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
