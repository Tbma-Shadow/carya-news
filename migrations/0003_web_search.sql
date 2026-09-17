ALTER TABLE articles ADD COLUMN extraction_attempted_at TEXT;
CREATE TABLE IF NOT EXISTS search_import_runs (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 imported_at TEXT NOT NULL,
 summary TEXT NOT NULL
);
