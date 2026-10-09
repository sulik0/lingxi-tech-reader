CREATE TABLE IF NOT EXISTS reading_events (id TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS event_articles (article_id TEXT PRIMARY KEY, event_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS digest_articles (article_id TEXT PRIMARY KEY, digest_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS collection_runs (id TEXT PRIMARY KEY, started_at INTEGER NOT NULL, added INTEGER NOT NULL, failures TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS reading_events_time ON reading_events(updated_at);
CREATE TABLE IF NOT EXISTS article_seen (source_id TEXT NOT NULL, article_id TEXT NOT NULL, url TEXT NOT NULL, content_hash TEXT NOT NULL, PRIMARY KEY(source_id,article_id));
CREATE INDEX IF NOT EXISTS article_seen_url ON article_seen(source_id,url);
CREATE INDEX IF NOT EXISTS article_seen_hash ON article_seen(source_id,content_hash);
