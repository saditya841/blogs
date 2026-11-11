-- migration_v5.sql — human approval + fact registry + public corrections.
--
-- Run once on the live database (order matters, v3/v4 ke baad):
--   npx wrangler d1 execute virall-db --remote --file=migration_v5.sql
--
-- Safe to run more than once: ALTER TABLE ADD COLUMN fails with "duplicate column" on a
-- database where it already ran, which the deploy script ignores. Tables/indexes use IF NOT EXISTS.

-- 1. Human edit gate. A draft becomes publishable only after a person edited it or wrote a
--    30+ character check note. Auto-publish also requires this (REQUIRE_HUMAN_EDIT=true).
ALTER TABLE posts ADD COLUMN human_edited_at INTEGER;
ALTER TABLE posts ADD COLUMN human_edit_note TEXT;

-- 2. Permanent fact registry: every code-verified claim, its outlets and last verification time.
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

-- 3. Public corrections / dated updates (shown on /corrections and under the article).
CREATE TABLE IF NOT EXISTS corrections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  old_text TEXT,
  new_text TEXT,
  reason TEXT,
  created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_corrections_post ON corrections(post_id, created_at);
