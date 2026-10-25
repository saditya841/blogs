-- Agar purana schema (v1/v2) pehle chala chuke ho to SIRF yeh chalao.
-- (Agar pehle migration ki ALTER lines nahi chalayi, to unhe bhi ek-ek karke chala lo; "duplicate column" aaye to chhod do.)
ALTER TABLE posts ADD COLUMN category TEXT;
ALTER TABLE posts ADD COLUMN tags TEXT;
ALTER TABLE posts ADD COLUMN lang TEXT DEFAULT 'hi';
ALTER TABLE posts ADD COLUMN word_count INTEGER DEFAULT 0;
ALTER TABLE posts ADD COLUMN pinged INTEGER DEFAULT 0;
ALTER TABLE posts ADD COLUMN check_json TEXT;
CREATE INDEX IF NOT EXISTS idx_posts_cat ON posts(category, publish_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_title ON posts(title COLLATE NOCASE);
CREATE TABLE IF NOT EXISTS topics (id INTEGER PRIMARY KEY AUTOINCREMENT, query TEXT NOT NULL, traffic TEXT, status TEXT NOT NULL DEFAULT 'new', research TEXT, source_count INTEGER DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER);
CREATE UNIQUE INDEX IF NOT EXISTS idx_topics_query ON topics(query COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_topics_status ON topics(status, created_at);
