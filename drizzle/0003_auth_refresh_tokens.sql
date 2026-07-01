CREATE TABLE `auth_refresh_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`last_used_at` text,
	`revoked_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_refresh_tokens_hash_unique` ON `auth_refresh_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `auth_refresh_tokens_user_idx` ON `auth_refresh_tokens` (`user_id`);
