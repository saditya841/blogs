CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  body TEXT NOT NULL,
  category TEXT,
  tags TEXT,
  lang TEXT DEFAULT 'hi',
  image_url TEXT,
  image_credit TEXT,
  video_url TEXT,
  sources TEXT,
  score INTEGER,
  word_count INTEGER DEFAULT 0,
  pinged INTEGER DEFAULT 0,
  check_json TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  publish_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status, publish_at);
CREATE INDEX IF NOT EXISTS idx_posts_cat ON posts(category, publish_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_title ON posts(title COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS topics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query TEXT NOT NULL,
  traffic TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  research TEXT,
  source_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_topics_query ON topics(query COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_topics_status ON topics(status, created_at);
