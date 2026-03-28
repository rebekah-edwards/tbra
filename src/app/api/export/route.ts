import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, isPremium } from "@/lib/auth";
import { db } from "@/db";
import {
  books, authors, bookAuthors,
  userBookState, readingSessions, userBookRatings,
  userBookReviews, userBookDimensionRatings, reviewDescriptorTags,
  readingNotes, readingGoals, upNext, userFavoriteBooks,
  userHiddenBooks, userGenrePreferences, userContentPreferences,
  userReadingPreferences, userFollows, users,
} from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";

// ─── CSV Export (Free) ──────────────────────────────────────────────

function escapeCSV(val: string | number | null | undefined): string {
  if (val == null) return "";
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function stateToGoodreads(state: string | null): string {
  switch (state) {
    case "completed": return "read";
    case "currently_reading": return "currently-reading";
    case "paused": return "currently-reading";
    case "tbr": return "to-read";
    case "dnf": return "read";
    default: return "to-read";
  }
}

function formatToBinding(formats: string | null): string {
  if (!formats) return "";
  try {
    const arr = JSON.parse(formats) as string[];
    const f = arr[0];
    switch (f) {
      case "hardcover": return "Hardcover";
      case "paperback": return "Paperback";
      case "ebook": return "Kindle Edition";
      case "audiobook": return "Audiobook";
      default: return "";
    }
  } catch { return ""; }
}

async function generateCSV(userId: string): Promise<string> {
  // Fetch all user book data with book info and authors
  const rows = await db.all(sql`
    SELECT
      b.id, b.title, b.isbn_10, b.isbn_13, b.pages, b.publication_year,
      ubs.state, ubs.owned_formats, ubs.updated_at as state_updated,
      ubr.rating,
      rev.review_text, rev.overall_rating as review_rating,
      GROUP_CONCAT(DISTINCT a.name) as author_names,
      (SELECT COUNT(*) FROM reading_sessions rs WHERE rs.user_id = ${userId} AND rs.book_id = b.id AND rs.state = 'completed') as read_count,
      (SELECT MAX(rs.completion_date) FROM reading_sessions rs WHERE rs.user_id = ${userId} AND rs.book_id = b.id) as date_read,
      (SELECT MIN(rs.started_at) FROM reading_sessions rs WHERE rs.user_id = ${userId} AND rs.book_id = b.id) as date_added
    FROM user_book_state ubs
    JOIN books b ON ubs.book_id = b.id
    LEFT JOIN book_authors ba ON b.id = ba.book_id
    LEFT JOIN authors a ON ba.author_id = a.id
    LEFT JOIN user_book_ratings ubr ON ubr.user_id = ${userId} AND ubr.book_id = b.id
    LEFT JOIN user_book_reviews rev ON rev.user_id = ${userId} AND rev.book_id = b.id
    WHERE ubs.user_id = ${userId}
    GROUP BY b.id
    ORDER BY b.title
  `) as Record<string, unknown>[];

  const headers = [
    "Title", "Author", "ISBN", "ISBN13", "My Rating",
    "Number of Pages", "Year Published", "Date Read", "Date Added",
    "Exclusive Shelf", "My Review", "Read Count", "Binding",
  ];

  const csvRows = [headers.join(",")];

  for (const row of rows) {
    const dateRead = row.date_read ? String(row.date_read).split("T")[0].replace(/-/g, "/") : "";
    const dateAdded = row.date_added ? String(row.date_added).split("T")[0].replace(/-/g, "/") :
      (row.state_updated ? String(row.state_updated).split("T")[0].replace(/-/g, "/") : "");

    // Strip HTML from review text
    const reviewText = row.review_text
      ? String(row.review_text).replace(/<[^>]*>/g, "").replace(/\n+/g, " ").trim()
      : "";

    csvRows.push([
      escapeCSV(row.title as string),
      escapeCSV(row.author_names as string),
      escapeCSV(row.isbn_10 as string),
      escapeCSV(row.isbn_13 as string),
      escapeCSV(row.rating as number ?? row.review_rating as number),
      escapeCSV(row.pages as number),
      escapeCSV(row.publication_year as number),
      escapeCSV(dateRead),
      escapeCSV(dateAdded),
      escapeCSV(stateToGoodreads(row.state as string)),
      escapeCSV(reviewText),
      escapeCSV(Math.max(row.read_count as number ?? 0, row.state === "completed" ? 1 : 0)),
      escapeCSV(formatToBinding(row.owned_formats as string)),
    ].join(","));
  }

  return csvRows.join("\n");
}

// ─── JSON Export (Premium) ──────────────────────────────────────────

async function generateJSON(userId: string) {
  const [
    bookStates,
    sessions,
    ratings,
    reviews,
    notes,
    goals,
    upNextItems,
    favorites,
    hidden,
    genrePrefs,
    contentPrefs,
    readingPrefs,
    following,
    followers,
    userInfo,
  ] = await Promise.all([
    // Books + states
    db.all(sql`
      SELECT b.id, b.title, b.slug, b.isbn_10, b.isbn_13, b.pages, b.publication_year,
        ubs.state, ubs.owned_formats, ubs.active_formats, ubs.updated_at,
        GROUP_CONCAT(DISTINCT a.name) as authors
      FROM user_book_state ubs
      JOIN books b ON ubs.book_id = b.id
      LEFT JOIN book_authors ba ON b.id = ba.book_id
      LEFT JOIN authors a ON ba.author_id = a.id
      WHERE ubs.user_id = ${userId}
      GROUP BY b.id
      ORDER BY b.title
    `),
    // Reading sessions
    db.select().from(readingSessions).where(eq(readingSessions.userId, userId)).all(),
    // Ratings
    db.select({
      bookId: userBookRatings.bookId,
      rating: userBookRatings.rating,
    }).from(userBookRatings).where(eq(userBookRatings.userId, userId)).all(),
    // Reviews with dimensions
    db.all(sql`
      SELECT r.id, r.book_id, r.overall_rating, r.mood, r.review_text,
        r.did_not_finish, r.dnf_percent_complete, r.is_anonymous, r.created_at,
        GROUP_CONCAT(DISTINCT d.dimension || ':' || d.rating) as dimension_ratings,
        GROUP_CONCAT(DISTINCT t.dimension || ':' || t.descriptor) as descriptor_tags
      FROM user_book_reviews r
      LEFT JOIN user_book_dimension_ratings d ON d.review_id = r.id
      LEFT JOIN review_descriptor_tags t ON t.review_id = r.id
      WHERE r.user_id = ${userId}
      GROUP BY r.id
    `),
    // Reading notes
    db.select().from(readingNotes).where(eq(readingNotes.userId, userId)).all(),
    // Goals
    db.select().from(readingGoals).where(eq(readingGoals.userId, userId)).all(),
    // Up Next
    db.all(sql`
      SELECT un.book_id, un.position, b.title
      FROM up_next un JOIN books b ON un.book_id = b.id
      WHERE un.user_id = ${userId}
      ORDER BY un.position
    `),
    // Favorites
    db.all(sql`
      SELECT uf.book_id, uf.position, b.title
      FROM user_favorite_books uf JOIN books b ON uf.book_id = b.id
      WHERE uf.user_id = ${userId}
      ORDER BY uf.position
    `),
    // Hidden
    db.all(sql`
      SELECT uh.book_id, b.title
      FROM user_hidden_books uh JOIN books b ON uh.book_id = b.id
      WHERE uh.user_id = ${userId}
    `),
    // Genre preferences
    db.select().from(userGenrePreferences).where(eq(userGenrePreferences.userId, userId)).all(),
    // Content preferences
    db.select().from(userContentPreferences).where(eq(userContentPreferences.userId, userId)).all(),
    // Reading preferences
    db.select().from(userReadingPreferences).where(eq(userReadingPreferences.userId, userId)).get(),
    // Following
    db.all(sql`
      SELECT uf.followed_id, u.display_name, u.username
      FROM user_follows uf JOIN users u ON uf.followed_id = u.id
      WHERE uf.follower_id = ${userId}
    `),
    // Followers
    db.all(sql`
      SELECT uf.follower_id, u.display_name, u.username
      FROM user_follows uf JOIN users u ON uf.follower_id = u.id
      WHERE uf.followed_id = ${userId}
    `),
    // User profile
    db.select({
      email: users.email,
      displayName: users.displayName,
      username: users.username,
      bio: users.bio,
      accountType: users.accountType,
      createdAt: users.createdAt,
    }).from(users).where(eq(users.id, userId)).get(),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    exportVersion: "1.0",
    platform: "tbra",
    user: userInfo,
    library: bookStates,
    readingSessions: sessions,
    ratings,
    reviews,
    readingNotes: notes,
    readingGoals: goals,
    upNext: upNextItems,
    favorites,
    hiddenBooks: hidden,
    preferences: {
      genres: genrePrefs,
      contentTolerances: contentPrefs,
      reading: readingPrefs,
    },
    social: {
      following,
      followers,
    },
  };
}

// ─── Route Handler ──────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const format = request.nextUrl.searchParams.get("format") ?? "csv";

  if (format === "json") {
    if (!isPremium(user)) {
      return NextResponse.json(
        { error: "Full export requires a Based Reader subscription" },
        { status: 403 }
      );
    }

    const data = await generateJSON(user.userId);
    const json = JSON.stringify(data, null, 2);
    const filename = `tbra-export-${new Date().toISOString().split("T")[0]}.json`;

    return new NextResponse(json, {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  // Default: CSV
  const csv = await generateCSV(user.userId);
  const filename = `tbra-library-${new Date().toISOString().split("T")[0]}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
