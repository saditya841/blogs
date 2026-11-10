-- migration_v4.sql — duplicate protection (multi-AI debate / claim ledger needs no new table:
-- the code-checked ledger is stored in topics.research and posts.check_json).
--
-- Run once on the live database:
--   npx wrangler d1 execute virall-db --remote --file=migration_v4.sql
--
-- Safe to run more than once.

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

-- Backfill fingerprints for posts that were published before this migration.
-- (The app also rebuilds them from the posts table on its own if the table is empty.)
