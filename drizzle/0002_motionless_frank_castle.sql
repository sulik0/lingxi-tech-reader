CREATE TABLE `collection_policy` (
	`id` integer PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	CONSTRAINT "single_policy" CHECK("collection_policy"."id"=1)
);
--> statement-breakpoint
CREATE TABLE `article_screenings` (
	`article_id` text NOT NULL,
	`policy_key` text NOT NULL,
	`keep` integer NOT NULL,
	`reason` text NOT NULL,
	`stage` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`article_id`, `policy_key`)
);
--> statement-breakpoint
CREATE TABLE `model_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`stage` text NOT NULL,
	`model` text NOT NULL,
	`prompt_tokens` integer,
	`completion_tokens` integer,
	`created_at` integer NOT NULL
);
