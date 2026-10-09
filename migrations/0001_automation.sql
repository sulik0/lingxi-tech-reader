CREATE TABLE IF NOT EXISTS automation_settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS feed_sources (id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL UNIQUE, enabled INTEGER NOT NULL DEFAULT 1, last_checked INTEGER, last_success INTEGER, error TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS feed_articles (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, source TEXT NOT NULL, title TEXT NOT NULL, author TEXT NOT NULL, content TEXT NOT NULL, url TEXT NOT NULL, published_at INTEGER NOT NULL, collected_at INTEGER NOT NULL, content_hash TEXT NOT NULL, UNIQUE(source_id,url));
CREATE INDEX IF NOT EXISTS feed_articles_time ON feed_articles(published_at);
CREATE TABLE IF NOT EXISTS daily_digests (id TEXT PRIMARY KEY, date TEXT NOT NULL, status TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, preview INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS digest_deliveries (digest_id TEXT NOT NULL, channel TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, started_at INTEGER, error TEXT NOT NULL DEFAULT '', payload TEXT NOT NULL, PRIMARY KEY(digest_id,channel));
CREATE TABLE IF NOT EXISTS automation_lock (id INTEGER PRIMARY KEY CHECK(id=1), holder TEXT NOT NULL, expires_at INTEGER NOT NULL);
