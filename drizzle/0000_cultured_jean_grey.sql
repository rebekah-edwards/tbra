CREATE TABLE `authors` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`bio` text,
	`open_library_key` text
);
--> statement-breakpoint
CREATE TABLE `book_authors` (
	`book_id` text NOT NULL,
	`author_id` text NOT NULL,
	`role` text DEFAULT 'author' NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_id`) REFERENCES `authors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `book_category_ratings` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text NOT NULL,
	`category_id` text NOT NULL,
	`intensity` integer NOT NULL,
	`notes` text,
	`evidence_level` text NOT NULL,
	`updated_by_user_id` text,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `taxonomy_categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `book_genres` (
	`book_id` text NOT NULL,
	`genre_id` text NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`genre_id`) REFERENCES `genres`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `book_narrators` (
	`book_id` text NOT NULL,
	`narrator_id` text NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`narrator_id`) REFERENCES `narrators`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `book_series` (
	`book_id` text NOT NULL,
	`series_id` text NOT NULL,
	`position_in_series` integer,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `books` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`summary` text,
	`publication_year` integer,
	`isbn_10` text,
	`isbn_13` text,
	`pages` integer,
	`words` integer,
	`audio_length_minutes` integer,
	`cover_image_url` text,
	`open_library_key` text,
	`is_fiction` integer DEFAULT true,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `books_isbn13_unique` ON `books` (`isbn_13`);--> statement-breakpoint
CREATE UNIQUE INDEX `books_ol_key_unique` ON `books` (`open_library_key`);--> statement-breakpoint
CREATE TABLE `citations` (
	`id` text PRIMARY KEY NOT NULL,
	`source_type` text NOT NULL,
	`url` text,
	`quote` text,
	`locator` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `editions` (
	`id` text PRIMARY KEY NOT NULL,
	`open_library_key` text NOT NULL,
	`book_id` text NOT NULL,
	`title` text,
	`publish_date` text,
	`publishers` text,
	`isbn_13` text,
	`isbn_10` text,
	`pages` integer,
	`cover_id` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `editions_open_library_key_unique` ON `editions` (`open_library_key`);--> statement-breakpoint
CREATE TABLE `genres` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `links` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text NOT NULL,
	`type` text NOT NULL,
	`url` text NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `narrators` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rating_citations` (
	`rating_id` text NOT NULL,
	`citation_id` text NOT NULL,
	FOREIGN KEY (`rating_id`) REFERENCES `book_category_ratings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`citation_id`) REFERENCES `citations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `reading_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`book_id` text NOT NULL,
	`read_number` integer NOT NULL,
	`state` text NOT NULL,
	`started_at` text DEFAULT (datetime('now')) NOT NULL,
	`completion_date` text,
	`completion_precision` text,
	`active_formats` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reading_sessions_user_book_read` ON `reading_sessions` (`user_id`,`book_id`,`read_number`);--> statement-breakpoint
CREATE INDEX `reading_sessions_user_book` ON `reading_sessions` (`user_id`,`book_id`);--> statement-breakpoint
CREATE TABLE `report_corrections` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`book_id` text NOT NULL,
	`category_id` text,
	`proposed_intensity` integer,
	`proposed_notes` text,
	`message` text NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `taxonomy_categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `review_descriptor_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`dimension` text NOT NULL,
	`tag` text NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `user_book_reviews`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `descriptor_tags_unique` ON `review_descriptor_tags` (`review_id`,`dimension`,`tag`);--> statement-breakpoint
CREATE TABLE `review_helpful_votes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`review_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`review_id`) REFERENCES `user_book_reviews`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `helpful_votes_unique` ON `review_helpful_votes` (`user_id`,`review_id`);--> statement-breakpoint
CREATE TABLE `series` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `taxonomy_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `taxonomy_categories_key_unique` ON `taxonomy_categories` (`key`);--> statement-breakpoint
CREATE TABLE `up_next` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`book_id` text NOT NULL,
	`position` integer NOT NULL,
	`added_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `up_next_user_book_unique` ON `up_next` (`user_id`,`book_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `up_next_user_position_unique` ON `up_next` (`user_id`,`position`);--> statement-breakpoint
CREATE TABLE `user_book_dimension_ratings` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`dimension` text NOT NULL,
	`rating` real NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `user_book_reviews`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dimension_ratings_unique` ON `user_book_dimension_ratings` (`review_id`,`dimension`);--> statement-breakpoint
CREATE TABLE `user_book_ratings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`book_id` text NOT NULL,
	`rating` real NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_book_ratings_unique` ON `user_book_ratings` (`user_id`,`book_id`);--> statement-breakpoint
CREATE TABLE `user_book_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`book_id` text NOT NULL,
	`overall_rating` real,
	`mood` text,
	`mood_intensity` real,
	`review_text` text,
	`did_not_finish` integer DEFAULT false NOT NULL,
	`dnf_percent_complete` integer,
	`finished_month` integer,
	`finished_year` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_book_reviews_unique` ON `user_book_reviews` (`user_id`,`book_id`);--> statement-breakpoint
CREATE TABLE `user_book_state` (
	`user_id` text NOT NULL,
	`book_id` text NOT NULL,
	`state` text,
	`owned_formats` text,
	`active_formats` text,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_book_state_unique` ON `user_book_state` (`user_id`,`book_id`);--> statement-breakpoint
CREATE TABLE `user_owned_editions` (
	`user_id` text NOT NULL,
	`book_id` text NOT NULL,
	`edition_id` text NOT NULL,
	`format` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`edition_id`) REFERENCES `editions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_owned_editions_unique` ON `user_owned_editions` (`user_id`,`book_id`,`edition_id`,`format`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text,
	`display_name` text,
	`avatar_url` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);