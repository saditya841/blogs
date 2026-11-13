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
  schema_json TEXT,
  -- human approval (REQUIRE_HUMAN_EDIT): set when a person has edited/checked the draft
  human_edited_at INTEGER,
  human_edit_note TEXT
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

-- Duplicate protection: one fingerprint per post (SimHash + MinHash + exact title hash).
-- similarity.js ise lazily bhi bana leta hai, phir bhi fresh install ke liye yahan hai.
CREATE TABLE IF NOT EXISTS post_fingerprints (
  post_id INTEGER PRIMARY KEY,
  simhash TEXT,
  title_simhash TEXT,
  title_hash TEXT,
  minhash TEXT,
  tokens INTEGER DEFAULT 0,
  title TEXT,
  created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_post_fp_created ON post_fingerprints(created_at);

-- Admin switches (auto_write / auto_publish / last_write). Lazily bhi banti hai.
CREATE TABLE IF NOT EXISTS settings (
  k TEXT PRIMARY KEY,
  v TEXT
);

-- Permanent fact record: every code-verified claim + its outlets + last verification time.
-- factregistry.js inhe lazily bhi bana leta hai.
CREATE TABLE IF NOT EXISTS facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id INTEGER,
  text TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  first_seen INTEGER,
  last_verified INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_facts_topic_text ON facts(topic_id, text);
CREATE TABLE IF NOT EXISTS fact_sources (
  fact_id INTEGER NOT NULL,
  source TEXT,
  url TEXT,
  date INTEGER,
  PRIMARY KEY(fact_id, source)
);
CREATE TABLE IF NOT EXISTS post_facts (
  post_id INTEGER NOT NULL,
  fact_id INTEGER NOT NULL,
  PRIMARY KEY(post_id, fact_id)
);

-- Public corrections / dated updates. corrections.js lazily bhi banati hai.
CREATE TABLE IF NOT EXISTS corrections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  old_text TEXT,
  new_text TEXT,
  reason TEXT,
  created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_corrections_post ON corrections(post_id, created_at);

-- Newsletter (single opt-in). No accounts/passwords: one email = one row.
-- subscribers bhi lazily banti hai (ensureSubscribers in index.js).
CREATE TABLE IF NOT EXISTS subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  source TEXT,
  created_at INTEGER NOT NULL,
  unsubscribed INTEGER NOT NULL DEFAULT 0
);
