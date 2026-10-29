-- Database migration v2: image + SEO columns for table `posts`
-- STATUS: the 7 ALTER TABLE lines below were ALREADY APPLIED on virall-db (29 Oct 2026). `slug` already existed.
-- This file is safe to run again: it only contains statements that do nothing the second time.
--
-- (history, do NOT run again - SQLite has no "ADD COLUMN IF NOT EXISTS")
--   ALTER TABLE posts ADD COLUMN featured_image TEXT;
--   ALTER TABLE posts ADD COLUMN thumbnail_image TEXT;
--   ALTER TABLE posts ADD COLUMN og_image TEXT;
--   ALTER TABLE posts ADD COLUMN seo_score INTEGER DEFAULT 0;
--   ALTER TABLE posts ADD COLUMN meta_description TEXT;
--   ALTER TABLE posts ADD COLUMN meta_keywords TEXT;
--   ALTER TABLE posts ADD COLUMN schema_json TEXT;

CREATE INDEX IF NOT EXISTS idx_posts_seo_score ON posts(seo_score);
CREATE INDEX IF NOT EXISTS idx_posts_slug ON posts(slug);
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at);
