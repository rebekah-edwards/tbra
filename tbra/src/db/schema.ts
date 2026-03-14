import { sqliteTable, text, integer, real, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// ─── Core tables ───

export const books = sqliteTable("books", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  title: text("title").notNull(),
  description: text("description"),
  summary: text("summary"),
  publicationYear: integer("publication_year"),
  isbn10: text("isbn_10"),
  isbn13: text("isbn_13"),
  pages: integer("pages"),
  words: integer("words"),
  audioLengthMinutes: integer("audio_length_minutes"),
  coverImageUrl: text("cover_image_url"),
  openLibraryKey: text("open_library_key"),
  isFiction: integer("is_fiction", { mode: "boolean" }).default(true),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex("books_isbn13_unique").on(table.isbn13),
  uniqueIndex("books_ol_key_unique").on(table.openLibraryKey),
]);

export const authors = sqliteTable("authors", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  bio: text("bio"),
  openLibraryKey: text("open_library_key"),
});

export const bookAuthors = sqliteTable("book_authors", {
  bookId: text("book_id").notNull().references(() => books.id),
  authorId: text("author_id").notNull().references(() => authors.id),
  role: text("role").notNull().default("author"),
});

export const narrators = sqliteTable("narrators", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
});

export const bookNarrators = sqliteTable("book_narrators", {
  bookId: text("book_id").notNull().references(() => books.id),
  narratorId: text("narrator_id").notNull().references(() => narrators.id),
});

export const genres = sqliteTable("genres", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
});

export const bookGenres = sqliteTable("book_genres", {
  bookId: text("book_id").notNull().references(() => books.id),
  genreId: text("genre_id").notNull().references(() => genres.id),
});

export const series = sqliteTable("series", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
});

export const bookSeries = sqliteTable("book_series", {
  bookId: text("book_id").notNull().references(() => books.id),
  seriesId: text("series_id").notNull().references(() => series.id),
  positionInSeries: integer("position_in_series"),
});

export const links = sqliteTable("links", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  bookId: text("book_id").notNull().references(() => books.id),
  type: text("type").notNull(), // 'amazon' | 'presave' | 'publisher'
  url: text("url").notNull(),
});

// ─── Taxonomy tables ───

export const taxonomyCategories = sqliteTable("taxonomy_categories", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const bookCategoryRatings = sqliteTable("book_category_ratings", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  bookId: text("book_id").notNull().references(() => books.id),
  categoryId: text("category_id").notNull().references(() => taxonomyCategories.id),
  intensity: integer("intensity").notNull(), // 0–4
  notes: text("notes"),
  evidenceLevel: text("evidence_level").notNull(), // 'ai_inferred' | 'cited' | 'human_verified'
  updatedByUserId: text("updated_by_user_id"),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

// ─── Citations / evidence ───

export const citations = sqliteTable("citations", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  sourceType: text("source_type").notNull(), // 'review' | 'excerpt' | 'publisher' | 'user_report' | 'other'
  url: text("url"),
  quote: text("quote"),
  locator: text("locator"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

export const ratingCitations = sqliteTable("rating_citations", {
  ratingId: text("rating_id").notNull().references(() => bookCategoryRatings.id),
  citationId: text("citation_id").notNull().references(() => citations.id),
});

// ─── Users & reading state ───

export const users = sqliteTable("users", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

export const userBookState = sqliteTable("user_book_state", {
  userId: text("user_id").notNull().references(() => users.id),
  bookId: text("book_id").notNull().references(() => books.id),
  state: text("state"), // 'tbr' | 'currently_reading' | 'completed' | 'paused' | 'dnf' | null
  ownedFormats: text("owned_formats"), // JSON array: ["hardcover","paperback","ebook","audiobook"] | null
  activeFormats: text("active_formats"), // JSON array: ["hardcover","audiobook"] | null
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex("user_book_state_unique").on(table.userId, table.bookId),
]);

export const userBookRatings = sqliteTable("user_book_ratings", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references(() => users.id),
  bookId: text("book_id").notNull().references(() => books.id),
  rating: real("rating").notNull(), // 0.25 to 5.0 in 0.25 increments
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex("user_book_ratings_unique").on(table.userId, table.bookId),
]);

// ─── Editions ───

export const editions = sqliteTable("editions", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  openLibraryKey: text("open_library_key").notNull().unique(),
  bookId: text("book_id").notNull().references(() => books.id),
  title: text("title"),
  publishDate: text("publish_date"),
  publishers: text("publishers"), // JSON array
  isbn13: text("isbn_13"),
  isbn10: text("isbn_10"),
  pages: integer("pages"),
  coverId: integer("cover_id"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

export const userOwnedEditions = sqliteTable("user_owned_editions", {
  userId: text("user_id").notNull().references(() => users.id),
  bookId: text("book_id").notNull().references(() => books.id),
  editionId: text("edition_id").notNull().references(() => editions.id),
  format: text("format").notNull(), // "hardcover" | "paperback" | "ebook" | "audiobook"
}, (table) => [
  uniqueIndex("user_owned_editions_unique").on(table.userId, table.bookId, table.editionId, table.format),
]);

// ─── Reviews ───

export const userBookReviews = sqliteTable("user_book_reviews", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references(() => users.id),
  bookId: text("book_id").notNull().references(() => books.id),
  overallRating: real("overall_rating"), // 0.25–5.0, nullable
  mood: text("mood"), // "lighthearted" | "warm" | "touched" | "emotional" | "devastated"
  moodIntensity: real("mood_intensity"), // 0.0–1.0 raw slider position
  reviewText: text("review_text"),
  didNotFinish: integer("did_not_finish", { mode: "boolean" }).notNull().default(false),
  dnfPercentComplete: integer("dnf_percent_complete"), // 0-100
  finishedMonth: integer("finished_month"), // 1-12
  finishedYear: integer("finished_year"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex("user_book_reviews_unique").on(table.userId, table.bookId),
]);

export const userBookDimensionRatings = sqliteTable("user_book_dimension_ratings", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  reviewId: text("review_id").notNull().references(() => userBookReviews.id),
  dimension: text("dimension").notNull(), // 'characters' | 'plot' | 'setting' | 'writing_style'
  rating: real("rating").notNull(), // 0.25–5.0
}, (table) => [
  uniqueIndex("dimension_ratings_unique").on(table.reviewId, table.dimension),
]);

export const reviewDescriptorTags = sqliteTable("review_descriptor_tags", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  reviewId: text("review_id").notNull().references(() => userBookReviews.id),
  dimension: text("dimension").notNull(), // 'characters' | 'plot' | 'setting' | 'writing_style' | 'content_warnings'
  tag: text("tag").notNull(),
}, (table) => [
  uniqueIndex("descriptor_tags_unique").on(table.reviewId, table.dimension, table.tag),
]);

// ─── Report corrections ───

export const reportCorrections = sqliteTable("report_corrections", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").references(() => users.id),
  bookId: text("book_id").notNull().references(() => books.id),
  categoryId: text("category_id").references(() => taxonomyCategories.id),
  proposedIntensity: integer("proposed_intensity"),
  proposedNotes: text("proposed_notes"),
  message: text("message").notNull(),
  status: text("status").notNull().default("new"), // 'new' | 'triaged' | 'accepted' | 'rejected'
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});
