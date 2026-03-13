import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core";
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
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

export const userBookState = sqliteTable("user_book_state", {
  userId: text("user_id").notNull().references(() => users.id),
  bookId: text("book_id").notNull().references(() => books.id),
  state: text("state").notNull(), // 'tbr' | 'owned' | 'currently_reading' | 'completed' | 'paused' | 'dnf'
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

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
