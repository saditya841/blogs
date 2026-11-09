#!/bin/bash
# Manual deploy helper (normally Cloudflare deploys automatically when you commit to GitHub).
# Needs: Node.js + `npx wrangler login` done once. On Windows run it in Git Bash.
set -e

echo "== Virall.in deploy =="

# 1. wrangler.toml must have a real KV id
if grep -q "PASTE_32_CHAR_KV_ID_HERE\|YOUR_KV_NAMESPACE_ID" wrangler.toml; then
  echo "STOP: wrangler.toml me KV id abhi placeholder hai."
  echo "      Banao: npx wrangler kv namespace create API_USAGE   (jo id mile wo wrangler.toml me daalo)"
  exit 1
fi

# 2. wrangler.toml must not hold API keys
if grep -qE 'gsk_[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{30,}|hf_[A-Za-z0-9]{20,}' wrangler.toml; then
  echo "STOP: wrangler.toml me API key likhi hai. Keys ko secret banao: npx wrangler secret put GROQ_API_KEY"
  exit 1
fi

# 3. Database columns: add only the ones that are missing (LIVE database => --remote)
for col in featured_image:TEXT thumbnail_image:TEXT og_image:TEXT "seo_score:INTEGER DEFAULT 0" meta_description:TEXT meta_keywords:TEXT schema_json:TEXT; do
  name="${col%%:*}"; type="${col#*:}"
  has=$(npx wrangler d1 execute virall-db --remote --json --command "SELECT COUNT(*) AS c FROM pragma_table_info('posts') WHERE name='$name'" | grep -o '"c": *[0-9]*' | grep -o '[0-9]*$' | head -1)
  if [ "$has" = "0" ]; then
    echo "adding column $name"
    npx wrangler d1 execute virall-db --remote --command "ALTER TABLE posts ADD COLUMN $name $type"
  else
    echo "column $name already exists"
  fi
done
npx wrangler d1 execute virall-db --remote --file=migration_images_seo.sql
npx wrangler d1 execute virall-db --remote --file=migration_v3.sql
# Fresh database? Upar ke ALTER steps ki jagah ek hi baar: --file=schema.sql

# 4. Deploy
npx wrangler deploy
echo "Done. Check: https://virall.in/admin/api-status"
