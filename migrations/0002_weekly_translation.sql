CREATE TABLE IF NOT EXISTS weekly_briefs(id INTEGER PRIMARY KEY AUTOINCREMENT,watchlist_id INTEGER NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,week_start TEXT NOT NULL,snapshot TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(watchlist_id,week_start));
CREATE TABLE IF NOT EXISTS translation_cache(hash TEXT PRIMARY KEY,translated TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ai_usage(day TEXT PRIMARY KEY,neurons INTEGER NOT NULL DEFAULT 0);
ALTER TABLE articles ADD COLUMN translation_attempted_at TEXT;
