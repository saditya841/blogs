-- Migration v3 — purane live database ke liye (schema.sql pehle se chal chuka hai).
-- Sirf wahi statements jo dobara chalane par error nahi dete (IF NOT EXISTS).
--
--   npx wrangler d1 execute virall-db --remote --file=migration_v3.sql
--
-- Column-level changes (SQLite me "ADD COLUMN IF NOT EXISTS" nahi hota) deploy.sh khud check karke karta hai.

CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,
  mime TEXT,
  b64 TEXT,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS settings (
  k TEXT PRIMARY KEY,
  v TEXT
);

CREATE INDEX IF NOT EXISTS idx_posts_seo_score ON posts(seo_score);
CREATE INDEX IF NOT EXISTS idx_posts_slug ON posts(slug);
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status, publish_at);
CREATE INDEX IF NOT EXISTS idx_posts_cat ON posts(category, publish_at);
CREATE INDEX IF NOT EXISTS idx_topics_status ON topics(status, created_at);
