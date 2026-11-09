-- Virall database schema — FRESH INSTALL.
-- Naya D1 banana ho to sirf ye file chalao:
--   npx wrangler d1 execute virall-db --remote --file=schema.sql
-- Purana database pehle se hai? schema.sql dobara chalane ki zaroorat nahi — migration_v3.sql chalao.
--
-- NOTE: writer.js insert karta hai in columns ko, isliye ye sab yahan hone chahiye:
--   featured_image, thumbnail_image, og_image, seo_score, meta_description, meta_keywords, schema_json
-- (pehle ye sirf deploy.sh ke ALTER se bante the, isliye fresh install toot jata tha)

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
  updated_at INTEGER,
  -- SEO / media (writer.js + seo-optimizer.js)
  featured_image TEXT,
  thumbnail_image TEXT,
  og_image TEXT,
  seo_score INTEGER DEFAULT 0,
  meta_description TEXT,
  meta_keywords TEXT,
  schema_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status, publish_at);
CREATE INDEX IF NOT EXISTS idx_posts_cat ON posts(category, publish_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_title ON posts(title COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_posts_seo_score ON posts(seo_score);
CREATE INDEX IF NOT EXISTS idx_posts_slug ON posts(slug);
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at);

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

-- AI illustrations (served at /img/<id>.jpg). media.js inhe lazily bhi bana leta hai.
CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,
  mime TEXT,
  b64 TEXT,
  created_at INTEGER
);

-- Admin switches (auto_write / auto_publish / last_write). Lazily bhi banti hai.
CREATE TABLE IF NOT EXISTS settings (
  k TEXT PRIMARY KEY,
  v TEXT
);
