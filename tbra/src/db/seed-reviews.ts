import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import {
  books,
  users,
  userBookReviews,
  userBookDimensionRatings,
  reviewDescriptorTags,
  userBookRatings,
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
  schema: { books, users, userBookReviews, userBookDimensionRatings, reviewDescriptorTags, userBookRatings },
});

// Deterministic IDs for idempotency
const DUMMY_USERS = [
  { id: "seed-reviewer-001", email: "maria@example.com", displayName: "Maria Santos" },
  { id: "seed-reviewer-002", email: "jordan@example.com", displayName: "Jordan Lee" },
  { id: "seed-reviewer-003", email: "anon@example.com", displayName: null },
  { id: "seed-reviewer-004", email: "priya@example.com", displayName: "Priya Nair" },
  { id: "seed-reviewer-005", email: "sam@example.com", displayName: "Sam Torres" },
];

function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

interface ReviewSeed {
  userId: string;
  overallRating: number | null;
  mood: string | null;
  didNotFinish: boolean;
  dnfPercentComplete: number | null;
  reviewText: string | null;
  createdAt: string;
  dimensions: { dimension: string; rating: number }[];
  tags: { dimension: string; tag: string }[];
}

async function seed() {
  console.log("Seeding review data...\n");

  // Find first book in DB
  const firstBook = db.select().from(books).limit(1).get();
  if (!firstBook) {
    console.error("No books found in database. Run db:seed-books first.");
    process.exit(1);
  }
  console.log(`Using book: "${firstBook.title}" (${firstBook.id})\n`);

  // Create dummy users
  console.log("Creating dummy users...");
  for (const u of DUMMY_USERS) {
    await db
      .insert(users)
      .values({
        id: u.id,
        email: u.email,
        displayName: u.displayName,
      })
      .onConflictDoNothing();
    console.log(`  + ${u.displayName ?? "(Anonymous)"} (${u.email})`);
  }

  // Define 5 varied reviews
  const reviews: ReviewSeed[] = [
    {
      userId: DUMMY_USERS[0].id, // Maria Santos
      overallRating: 4.5,
      mood: "inspired",
      didNotFinish: false,
      dnfPercentComplete: null,
      reviewText:
        '<p>Absolutely <b>loved</b> this book. The characters felt so real and the writing pulled me in from the first page.</p><p>I couldn\'t put it down — stayed up way too late finishing it. The ending was <span class="spoiler-tag" data-spoiler="true">completely unexpected and left me in tears, especially when the main character finally confronted the truth about their past</span>.</p><p>Highly recommend for anyone who loves <i>emotionally rich</i> storytelling.</p>',
      createdAt: daysAgo(1),
      dimensions: [
        { dimension: "characters", rating: 5.0 },
        { dimension: "plot", rating: 4.25 },
        { dimension: "setting", rating: 4.0 },
        { dimension: "prose", rating: 4.5 },
      ],
      tags: [
        { dimension: "characters", tag: "Lovable" },
        { dimension: "characters", tag: "Well-developed" },
        { dimension: "plot", tag: "Page turner" },
        { dimension: "plot", tag: "Satisfying" },
        { dimension: "prose", tag: "Descriptive" },
      ],
    },
    {
      userId: DUMMY_USERS[1].id, // Jordan Lee
      overallRating: 3.0,
      mood: "contemplative",
      didNotFinish: false,
      dnfPercentComplete: null,
      reviewText:
        "<p>It was fine. The prose was solid but the pacing dragged in the middle third. I kept waiting for something to happen and it didn't really pick up until the last fifty pages.</p><p>That said, it gave me a lot to think about afterward. Sometimes the slow ones stick with you.</p>",
      createdAt: daysAgo(5),
      dimensions: [
        { dimension: "characters", rating: 3.5 },
        { dimension: "plot", rating: 2.5 },
      ],
      tags: [
        { dimension: "characters", tag: "Morally grey" },
        { dimension: "plot", tag: "Slow-paced" },
        { dimension: "plot", tag: "Nonlinear" },
      ],
    },
    {
      userId: DUMMY_USERS[2].id, // Anonymous
      overallRating: 2.5,
      mood: "angry",
      didNotFinish: true,
      dnfPercentComplete: 45,
      reviewText:
        "<p>I really wanted to like this but I couldn't get past the halfway point. The writing felt clunky and the plot went nowhere.</p><p>Maybe it gets better but life is too short for books that don't grab you.</p>",
      createdAt: daysAgo(14),
      dimensions: [
        { dimension: "plot", rating: 2.0 },
        { dimension: "prose", rating: 2.25 },
      ],
      tags: [
        { dimension: "prose", tag: "Clunky" },
        { dimension: "plot", tag: "Predictable" },
        { dimension: "plot", tag: "Unsatisfying" },
      ],
    },
    {
      userId: DUMMY_USERS[3].id, // Priya Nair
      overallRating: 5.0,
      mood: "devastated",
      didNotFinish: false,
      dnfPercentComplete: null,
      reviewText:
        '<p>I am <b>wrecked</b>. This book destroyed me in the best possible way.</p><p>The way the author builds up to <span class="spoiler-tag" data-spoiler="true">the sacrifice at the end — when you realize the whole story was leading to this one impossible choice</span> is just masterful storytelling.</p><p>I ugly-cried on public transit. <i>No regrets.</i></p><ul><li>Characters: perfection</li><li>Plot: devastating</li><li>Would I read again? In a heartbeat</li></ul>',
      createdAt: daysAgo(30),
      dimensions: [
        { dimension: "characters", rating: 5.0 },
        { dimension: "plot", rating: 5.0 },
        { dimension: "setting", rating: 4.5 },
        { dimension: "prose", rating: 4.75 },
      ],
      tags: [
        { dimension: "characters", tag: "Lovable" },
        { dimension: "characters", tag: "Relatable" },
        { dimension: "plot", tag: "Epic" },
        { dimension: "plot", tag: "Shocking" },
        { dimension: "setting", tag: "Fantastical" },
        { dimension: "setting", tag: "Expansive" },
      ],
    },
    {
      userId: DUMMY_USERS[4].id, // Sam Torres
      overallRating: 3.75,
      mood: "lighthearted",
      didNotFinish: false,
      dnfPercentComplete: null,
      reviewText:
        "<p>Fun, breezy read. Not going to change your life but it doesn't need to. Sometimes you just want a book that makes you smile and this delivers.</p><p>The humor lands more often than it misses and the characters are charming even when they're being ridiculous.</p>",
      createdAt: daysAgo(90),
      dimensions: [
        { dimension: "characters", rating: 3.75 },
        { dimension: "setting", rating: 3.5 },
        { dimension: "prose", rating: 4.0 },
      ],
      tags: [
        { dimension: "characters", tag: "Relatable" },
        { dimension: "prose", tag: "Humorous" },
        { dimension: "prose", tag: "Simple" },
        { dimension: "setting", tag: "Contemporary/modern" },
      ],
    },
  ];

  console.log("\nCreating reviews...");
  for (const r of reviews) {
    const reviewId = `seed-review-${r.userId}`;

    // Insert review
    await db
      .insert(userBookReviews)
      .values({
        id: reviewId,
        userId: r.userId,
        bookId: firstBook.id,
        overallRating: r.overallRating,
        mood: r.mood,
        reviewText: r.reviewText,
        didNotFinish: r.didNotFinish,
        dnfPercentComplete: r.dnfPercentComplete,
        createdAt: r.createdAt,
        updatedAt: r.createdAt,
      })
      .onConflictDoNothing();

    // Insert dimension ratings
    for (const dim of r.dimensions) {
      await db
        .insert(userBookDimensionRatings)
        .values({
          reviewId,
          dimension: dim.dimension,
          rating: dim.rating,
        })
        .onConflictDoNothing();
    }

    // Insert tags
    for (const tag of r.tags) {
      await db
        .insert(reviewDescriptorTags)
        .values({
          reviewId,
          dimension: tag.dimension,
          tag: tag.tag,
        })
        .onConflictDoNothing();
    }

    // Sync to userBookRatings for aggregation
    if (r.overallRating != null) {
      await db
        .insert(userBookRatings)
        .values({
          userId: r.userId,
          bookId: firstBook.id,
          rating: r.overallRating,
        })
        .onConflictDoNothing();
    }

    const userName = DUMMY_USERS.find((u) => u.id === r.userId)?.displayName ?? "Anonymous";
    console.log(
      `  + ${userName}: ${r.overallRating ?? "no rating"}★ ${r.mood ?? ""} ${r.didNotFinish ? "(DNF)" : ""}`
    );
  }

  console.log("\nDone! Seeded 5 reviews for:", firstBook.title);
  sqlite.close();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
