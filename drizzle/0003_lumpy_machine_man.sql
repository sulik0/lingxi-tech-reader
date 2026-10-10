CREATE INDEX `article_screenings_policy` ON `article_screenings` (`policy_key`,`keep`);--> statement-breakpoint
CREATE INDEX `model_usage_time` ON `model_usage` (`created_at`);