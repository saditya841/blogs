-- Database Migration: Add Image and SEO columns
-- Run this with: wrangler d1 execute virall-db --file=migration_images_seo.sql

-- Add new columns to posts table
ALTER TABLE posts ADD COLUMN featured_image TEXT;
ALTER TABLE posts ADD COLUMN thumbnail_image TEXT;
ALTER TABLE posts ADD COLUMN og_image TEXT;
ALTER TABLE posts ADD COLUMN seo_score INTEGER DEFAULT 0;
ALTER TABLE posts ADD COLUMN meta_description TEXT;
ALTER TABLE posts ADD COLUMN meta_keywords TEXT;
ALTER TABLE posts ADD COLUMN schema_json TEXT;
ALTER TABLE posts ADD COLUMN slug TEXT;

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_posts_seo_score ON posts(seo_score);
CREATE INDEX IF NOT EXISTS idx_posts_slug ON posts(slug);
CREATE INDEX IF NOT EXISTS idx_posts_featured_image ON posts(featured_image) WHERE featured_image IS NOT NULL;

-- Update existing posts with slugs (optional, for retroactive)
-- UPDATE posts SET slug = LOWER(REPLACE(REPLACE(title, ' ', '-'), '।', '')) WHERE slug IS NULL;

-- Success message
SELECT 'Migration completed successfully! New columns added.' as message;
