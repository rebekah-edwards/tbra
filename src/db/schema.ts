import { sqliteTable, text, integer, real, uniqueIndex, index } from "drizzle-orm/sqlite-core";
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
  asin: text("asin"),
  publicationDate: text("publication_date"), // precise date: "2026-04-01" or "2025-12"
  language: text("language"), // "English", "Spanish", etc.
  publisher: text("publisher"), // primary publisher name
  isFiction: integer("is_fiction", { mode: "boolean" }).default(true),
  isBoxSet: integer("is_box_set", { mode: "boolean" }).notNull().default(false),
  slug: text("slug"),
  coverVerified: integer("cover_verified", { mode: "boolean" }).notNull().default(false),
  coverSource: text("cover_source"), // 'openlibrary' | 'google_books' | 'amazon' | 'brave' | 'manual'
  seriesCoverUrl: text("series_cover_url"), // admin override for series views
  needsReview: integer("needs_review", { mode: "boolean" }).notNull().default(false),
  reviewReason: text("review_reason"),
  pacing: text("pacing"), // 'slow' | 'medium' | 'fast' — aggregated from user reviews
  visibility: text("visibility").notNull().default("public"), // 'public' | 'import_only'
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex("books_isbn13_unique").on(table.isbn13),
  uniqueIndex("books_ol_key_unique").on(table.openLibraryKey),
]);

export const authors = sqliteTable("authors", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  slug: text("slug"),
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
  parentGenreId: text("parent_genre_id"),
});

export const bookGenres = sqliteTable("book_genres", {
  bookId: text("book_id").notNull().references(() => books.id),
  genreId: text("genre_id").notNull().references(() => genres.id),
});

export const series = sqliteTable("series", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  slug: text("slug"),
  coverStyle: text("cover_style").notNull().default("default"), // 'default' = base covers, 'format' = user format covers
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
}, (table) => [
  index("idx_bcr_book_id").on(table.bookId),
]);

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
  username: text("username").unique(),
  avatarUrl: text("avatar_url"),
  bio: text("bio"),
  role: text("role").notNull().default("user"), // 'user' | 'admin' (legacy)
  accountType: text("account_type").notNull().default("reader"), // 'reader' | 'premium' | 'beta_tester' | 'admin' | 'super_admin'
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  emailVerificationToken: text("email_verification_token"),
  emailVerificationExpiresAt: text("email_verification_expires_at"),
  // Social handles (stored without @)
  instagram: text("instagram"),
  tiktok: text("tiktok"),
  threads: text("threads"),
  twitter: text("twitter"),
  // Location
  location: text("location"),
  locationVisibility: text("location_visibility").default("public"), // 'public' | 'followers'
  // Privacy
  isPrivate: integer("is_private", { mode: "boolean" }).notNull().default(false),
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

export const readingSessions = sqliteTable("reading_sessions", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references(() => users.id),
  bookId: text("book_id").notNull().references(() => books.id),
  readNumber: integer("read_number").notNull(), // 1, 2, 3... for re-reads
  state: text("state").notNull(), // 'currently_reading' | 'completed' | 'paused' | 'dnf'
  startedAt: text("started_at").notNull().default(sql`(datetime('now'))`),
  completionDate: text("completion_date"), // ISO date '2026-03-14' or null
  completionPrecision: text("completion_precision"), // 'exact' | 'month' | 'year' | null
  activeFormats: text("active_formats"), // JSON array
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex("reading_sessions_user_book_read").on(table.userId, table.bookId, table.readNumber),
  index("reading_sessions_user_book").on(table.userId, table.bookId),
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
  isAnonymous: integer("is_anonymous", { mode: "boolean" }).notNull().default(false),
  contentComments: text("content_comments"), // private notes on content details
  finishedMonth: integer("finished_month"), // 1-12
  finishedYear: integer("finished_year"),
  source: text("source").notNull().default("user"), // 'user' | 'goodreads' | 'storygraph'
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

export const reviewHelpfulVotes = sqliteTable("review_helpful_votes", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references(() => users.id),
  reviewId: text("review_id").notNull().references(() => userBookReviews.id),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex("helpful_votes_unique").on(table.userId, table.reviewId),
]);

// ─── Up Next queue ───

export const upNext = sqliteTable("up_next", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references(() => users.id),
  bookId: text("book_id").notNull().references(() => books.id),
  position: integer("position").notNull(), // 1-5
  addedAt: text("added_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex("up_next_user_book_unique").on(table.userId, table.bookId),
  uniqueIndex("up_next_user_position_unique").on(table.userId, table.position),
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

// ─── Reported issues (admin data quality reports) ───

export const reportedIssues = sqliteTable("reported_issues", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references(() => users.id),
  bookId: text("book_id").references(() => books.id),
  seriesId: text("series_id").references(() => series.id),
  pageUrl: text("page_url"),
  description: text("description").notNull(),
  status: text("status").notNull().default("new"), // 'new' | 'in_progress' | 'resolved' | 'wontfix'
  resolution: text("resolution"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  resolvedAt: text("resolved_at"),
});

// ─── Reading goals ───

export const readingGoals = sqliteTable("reading_goals", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references(() => users.id),
  year: integer("year").notNull(),
  targetBooks: integer("target_books").notNull(),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex("reading_goals_user_year_unique").on(table.userId, table.year),
]);

// ─── Favorites ───

export const userFavoriteBooks = sqliteTable("user_favorite_books", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references(() => users.id),
  bookId: text("book_id").notNull().references(() => books.id),
  position: integer("position").notNull(),
  addedAt: text("added_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex("user_favorite_books_unique").on(table.userId, table.bookId),
]);

// ─── Reading notes / journal ───

export const readingNotes = sqliteTable("reading_notes", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references(() => users.id),
  bookId: text("book_id").notNull().references(() => books.id),
  noteText: text("note_text").notNull(),
  pageNumber: integer("page_number"),
  percentComplete: integer("percent_complete"),
  mood: text("mood"),
  pace: text("pace"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index("reading_notes_user_book_idx").on(table.userId, table.bookId),
]);

// ─── User reading preferences ───

export const userReadingPreferences = sqliteTable("user_reading_preferences", {
  userId: text("user_id").primaryKey().references(() => users.id),
  fictionPreference: text("fiction_preference"), // 'fiction' | 'nonfiction' | 'both' | null
  pageLengthMin: integer("page_length_min"),
  pageLengthMax: integer("page_length_max"),
  pacePreference: text("pace_preference"), // 'slow' | 'medium' | 'fast' | null
  moodPreferences: text("mood_preferences"), // JSON array: ["cozy","dark","funny",...]
  storyFocus: text("story_focus"), // 'worldbuilding' | 'plot' | 'characters' | 'mix' | null
  characterTropes: text("character_tropes"), // JSON array: ["morally-grey","found-family",...] (liked)
  dislikedTropes: text("disliked_tropes"), // JSON array: ["chosen-one",...] (disliked character tropes)
  customContentWarnings: text("custom_content_warnings"), // JSON array of user-typed warnings: ["infidelity","animal death",...]
  textSize: text("text_size"), // 'small' | 'medium' | 'large' | null (null = medium)
  onboardingCompleted: integer("onboarding_completed").notNull().default(0),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

export const userGenrePreferences = sqliteTable("user_genre_preferences", {
  userId: text("user_id").notNull().references(() => users.id),
  genreName: text("genre_name").notNull(), // Canonical name from genre taxonomy
  preference: text("preference").notNull(), // 'love' | 'dislike'
}, (table) => [
  uniqueIndex("user_genre_pref_unique").on(table.userId, table.genreName),
]);

export const userContentPreferences = sqliteTable("user_content_preferences", {
  userId: text("user_id").notNull().references(() => users.id),
  categoryId: text("category_id").notNull(), // e.g. 'violence_gore', 'sexual_content'
  maxTolerance: integer("max_tolerance").notNull(), // 0=none, 1=mild, 2=moderate, 3=heavy, 4=no limit
}, (table) => [
  uniqueIndex("user_content_pref_unique").on(table.userId, table.categoryId),
]);

// ─── Enrichment status tracking ───

export const enrichmentLog = sqliteTable("enrichment_log", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  bookId: text("book_id").notNull().references(() => books.id),
  status: text("status").notNull(), // "success" | "failed" | "api_exhausted"
  errorMessage: text("error_message"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index("enrichment_log_book_idx").on(table.bookId),
  index("enrichment_log_status_idx").on(table.status),
]);

// ─── Hidden books (user-level recommendation exclusion) ───

export const userHiddenBooks = sqliteTable("user_hidden_books", {
  userId: text("user_id").notNull().references(() => users.id),
  bookId: text("book_id").notNull().references(() => books.id),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex("user_hidden_books_unique").on(table.userId, table.bookId),
]);

// ─── Social: follows ───

export const userFollows = sqliteTable("user_follows", {
  followerId: text("follower_id").notNull().references(() => users.id),
  followedId: text("followed_id").notNull().references(() => users.id),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex("user_follows_unique").on(table.followerId, table.followedId),
  index("user_follows_follower_idx").on(table.followerId),
  index("user_follows_followed_idx").on(table.followedId),
]);

// ─── Notification preferences ───

export const userNotificationPreferences = sqliteTable("user_notification_preferences", {
  userId: text("user_id").primaryKey().references(() => users.id),
  emailNewFollower: integer("email_new_follower", { mode: "boolean" }).notNull().default(true),
  emailNewCorrection: integer("email_new_correction", { mode: "boolean" }).notNull().default(true),
  emailWeeklyDigest: integer("email_weekly_digest", { mode: "boolean" }).notNull().default(false),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

// ─── Blocked OpenLibrary keys (prevent re-import of deleted junk) ───

// ─── Landing page curation ───

export const landingPageBooks = sqliteTable("landing_page_books", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  bookSlug: text("book_slug").notNull(),
  type: text("type").notNull().default("parade"), // 'parade' | 'featured'
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

export const landingPageCopy = sqliteTable("landing_page_copy", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  sectionKey: text("section_key").notNull().unique(),
  sectionLabel: text("section_label").notNull(),
  content: text("content").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

// ─── Password reset tokens ───

export const passwordResetTokens = sqliteTable("password_reset_tokens", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references(() => users.id),
  token: text("token").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
  used: integer("used", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

export const blockedOlKeys = sqliteTable("blocked_ol_keys", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  openLibraryKey: text("open_library_key").notNull().unique(),
  reason: text("reason"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});
