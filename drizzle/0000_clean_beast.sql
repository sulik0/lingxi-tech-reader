CREATE TABLE IF NOT EXISTS `feed_articles` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`source` text NOT NULL,
	`title` text NOT NULL,
	`author` text NOT NULL,
	`content` text NOT NULL,
	`url` text NOT NULL,
	`published_at` integer NOT NULL,
	`collected_at` integer NOT NULL,
	`content_hash` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `feed_articles_source_url` ON `feed_articles` (`source_id`,`url`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `feed_articles_time` ON `feed_articles` (`published_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `digest_deliveries` (
	`digest_id` text NOT NULL,
	`channel` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`started_at` integer,
	`error` text DEFAULT '' NOT NULL,
	`payload` text NOT NULL,
	PRIMARY KEY(`digest_id`, `channel`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `daily_digests` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`status` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`error` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`preview` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `reading_events` (
	`id` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `reading_events_time` ON `reading_events` (`updated_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `automation_lock` (
	`id` integer PRIMARY KEY NOT NULL,
	`holder` text NOT NULL,
	`expires_at` integer NOT NULL,
	CONSTRAINT "single_lock" CHECK("automation_lock"."id"=1)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `event_articles` (
	`article_id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `digest_articles` (
	`article_id` text PRIMARY KEY NOT NULL,
	`digest_id` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `collection_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`started_at` integer NOT NULL,
	`added` integer NOT NULL,
	`failures` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `article_seen` (
	`source_id` text NOT NULL,
	`article_id` text NOT NULL,
	`url` text NOT NULL,
	`content_hash` text NOT NULL,
	PRIMARY KEY(`source_id`, `article_id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `article_seen_url` ON `article_seen` (`source_id`,`url`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `article_seen_hash` ON `article_seen` (`source_id`,`content_hash`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `automation_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	CONSTRAINT "single_settings" CHECK("automation_settings"."id"=1)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `feed_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`last_checked` integer,
	`last_success` integer,
	`error` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `feed_sources_url_unique` ON `feed_sources` (`url`);