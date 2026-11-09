# Virall — Cloudflare-only AI news site

**Live:** https://virall.in

Virall ek Hindi/English news + explainer site hai jo poori tarah **Cloudflare free tier** par chalti hai:
Workers (hosting + cron), D1 (database), Workers AI (images), KV (API usage counters).
Koi VPS, koi paid database, koi npm dependency nahi. Paisa **Google AdSense** se aata hai.

> **Sabse pehle:** `MONETIZATION.md` padho. Usme AdSense approval checklist, 30-day content plan
> aur honest earning expectations hain.

---

## 1. Ek nazar me

| Cheez | Kahan |
|---|---|
| Worker + saare routes | `src/index.js` |
| Topic discovery (Google Trends / News) | `src/trends.js` |
| Zero-token source pre-read / reading brief | `src/preread.js` |
| AI router (Groq → Gemini → HF → Cohere → Workers AI) | `src/ai.js`, `src/multi-api-manager.js` |
| Article writer + quality score | `src/writer.js` |
| Fact-check helpers | `src/verify.js`, `src/facts.js` |
| Publish rules | `src/validate.js` |
| Topic type / YMYL / preflight | `src/playbook.js` |
| Images / video | `src/media.js`, `src/image-generator.js` |
| Thumbnail-style card posts | `src/cardpost.js`, `src/card.js` |
| SEO helpers | `src/seo-optimizer.js` |
| Admin API dashboard | `src/admin-api-status.js` |
| Fresh database | `schema.sql` |
| Purane database ka upgrade | `migration_v3.sql` + `deploy.sh` |
| Tests | `test/unit/*.test.js` |

**Auto-publish default me OFF hai.** Admin panel ke do switches (`auto_write`, `auto_publish`)
D1 me `settings` table me rehte hain. Bina human review AI news publish karna AdSense ke liye
risky hai — isliye manual approve default hai.

---

## 2. Local setup

Zaroorat: **Node.js 22+** (Node 26 par test kiye gaye). `npm install` ki zaroorat nahi — koi dependency nahi hai.

```bash
npm test          # 241 unit tests (network nahi, DB nahi)
npm run check     # har src/*.js ko import karke syntax/import error pakadta hai
npx wrangler dev  # local Worker (pehli baar Cloudflare login maangega)
```

Local secrets ke liye `.dev.vars.example` ko `.dev.vars` bana kar values bharo. `.dev.vars`
git me kabhi commit mat karo.

---

## 3. Cloudflare resources

`wrangler.toml` me D1 database aur KV namespace ke IDs pehle se hain. Naya project bana rahe ho to:

```bash
npx wrangler d1 create virall-db
npx wrangler kv namespace create API_USAGE
```

Jo IDs mile, unhe `wrangler.toml` me `database_id` / `id` me daalo.

### Database

**Naya (khali) database — ek hi baar:**

```bash
npx wrangler d1 execute virall-db --remote --file=schema.sql
```

**Purana live database (columns/tables missing ho sakte hain):**

```bash
# Git Bash / WSL / macOS / Linux par:
bash deploy.sh

# PowerShell par manually (columns pehle, phir tables/indexes):
npx wrangler d1 execute virall-db --remote --command "ALTER TABLE posts ADD COLUMN featured_image TEXT"
npx wrangler d1 execute virall-db --remote --command "ALTER TABLE posts ADD COLUMN thumbnail_image TEXT"
npx wrangler d1 execute virall-db --remote --command "ALTER TABLE posts ADD COLUMN og_image TEXT"
npx wrangler d1 execute virall-db --remote --command "ALTER TABLE posts ADD COLUMN seo_score INTEGER DEFAULT 0"
npx wrangler d1 execute virall-db --remote --command "ALTER TABLE posts ADD COLUMN meta_description TEXT"
npx wrangler d1 execute virall-db --remote --command "ALTER TABLE posts ADD COLUMN meta_keywords TEXT"
npx wrangler d1 execute virall-db --remote --command "ALTER TABLE posts ADD COLUMN schema_json TEXT"
npx wrangler d1 execute virall-db --remote --file=migration_images_seo.sql
npx wrangler d1 execute virall-db --remote --file=migration_v3.sql
```

`migration_v3.sql` idempotent hai (sirf `IF NOT EXISTS`), use dobara chalana safe hai.
Column `ALTER` dobara chalane par error dega — pehle check kar lo ki column already hai.

---

## 4. Secrets (Cloudflare dashboard → Worker → Settings → Variables and Secrets)

| Secret | Zaroori? | Kaam |
|---|---|---|
| `ADMIN_PASSWORD` | **Haan** | `/admin` login. Iske bina admin khulta hi nahi. |
| `GROQ_API_KEY` | Optional | Free AI, sabse tez. https://console.groq.com/keys |
| `GEMINI_API_KEY` | Optional | Free AI fallback. https://aistudio.google.com/apikey |
| `HUGGINGFACE_API_KEY` | Optional | Free AI fallback. |
| `COHERE_API_KEY` | Optional | Free AI fallback. |
| `PEXELS_API_KEY` | Optional | Free stock photos. https://www.pexels.com/api/ |
| `YOUTUBE_API_KEY` | Optional | Related video embed. |

CLI se:

```bash
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put GROQ_API_KEY
# ...jitne chahiye
```

Keys **kabhi** `wrangler.toml` ya code me mat likho. `deploy.sh` isi ko check karta hai.

AI keys na ho to bhi site chalti hai: Workers AI (`env.AI`) last fallback hai, aur uske liye
koi key nahi chahiye. Sirf `PEXELS_API_KEY` / `YOUTUBE_API_KEY` na hone se photo/video step skip hota hai.

---

## 5. Vars (public config — `wrangler.toml`)

| Var | Default | Matlab |
|---|---|---|
| `SITE_URL` | `https://virall.in` | Canonical, sitemap, IndexNow. Bina trailing slash. |
| `SITE_NAME` | `Virall` | Brand name. |
| `SITE_TAGLINE` | — | Homepage heading + meta description. |
| `AUTHOR_NAME` | `Virall Desk` | Bylines / schema author. |
| `CONTACT_EMAIL` | — | Contact + privacy page. |
| `ADSENSE_PUB` | khali | Publisher ID - `pub-...`, `ca-pub-...` ya sirf digits, teeno chalenge. Khali = koi ad nahi. |
| `ADSENSE_SLOT` | khali | In-article ad unit slot ID. |
| `ADSENSE_SLOT_BOTTOM` | khali | Article ke end ka doosra ad unit (optional). |
| `MIN_WORDS_FOR_ADS` | `600` | Itne se chhote article par ads nahi (AdSense policy ke liye safe). |
| `INDEXNOW_KEY` | set | Bing/Yandex instant indexing. `/{key}.txt` auto serve hota hai. |
| `POST_LANG` | `eng` | `eng`/`en` = English, warna Hindi. |
| `TRENDS_GEO` | `IN` | Google Trends region. |
| `DAILY_TOPIC_LIMIT` | `10` | Roz max naye topics. |
| `DAILY_POST_LIMIT` | `5` | Reserved for writer limits. |
| `AUTO_APPROVE_HOURS` | `1` | Auto-publish switch ON ho to draft kitni der baad live ho. |
| `AUTO_APPROVE_MIN_SCORE` | `95` | Auto-publish ke liye minimum score. |
| `SCORE_MAX` | `94` | Writer ka score cap. **94 < 95**, isliye default me auto-publish kabhi fire nahi hota — ye jaan-boojh kar hai. |
| `ENABLE_AI_EDITOR` | `true` | `false` = editor + fact-check pass band (sirf debugging ke liye; posts tab verified nahi honge). |
| `EDITOR_MAX_ROUNDS` | `2` | Fact-check fail hone par AI ko kitne extra mauke (0 = sirf ek pass). |
| `CARD_INDEX` | khali | `1` = `/card/<id>` pages indexable (default noindex). |
| `POLICY_UPDATED` | `2026-11-08` | Privacy page ki "Last updated" date. |
| `AI_MODEL` | `@cf/openai/gpt-oss-20b` | Workers AI model. |
| `USE_MULTI_API` | `true` | Pehle Groq/Gemini/HF/Cohere, phir Workers AI. |
| `API_ORDER` | `groq,gemini,huggingface,cohere` | Provider order override. |
| `*_MODELS`, `*_DAILY_LIMIT` | code defaults | Per-provider model list / soft limit. |
| `THUMB_MODE` | khali | `ai` = AI thumbnail pehle, warna stock photo pehle. |
| `API_TIMEOUT_MS` | `25000` | Har provider call ka timeout. |

**AdSense on karne ke liye:** `ADSENSE_PUB` + `ADSENSE_SLOT` (+ optional bottom slot) bharo,
deploy karo, phir `https://virall.in/ads.txt` check karo. Detail: `MONETIZATION.md`.

---

## 6. Deploy

```bash
npx wrangler deploy
```

Cron `0 * * * *` (har ghante) par ye kaam khud hota hai:
1. `autoApprove` — sirf tab jab switch ON ho aur post strict checks pass kare.
2. `pingIndexNow` — naye live posts Bing/Yandex ko bhejta hai.
3. `collectTopics` — Google Trends se naye topics.
4. `researchPending` — 2 topics ke sources jama karta hai.
5. `writeOne` — sirf tab jab `auto_write` switch ON ho.

Pehli baar deploy ke baad:
- `/admin` kholo, `ADMIN_PASSWORD` se login karo.
- **Topics** page se "Abhi trends + research chalao" dabao.
- Ek topic kholo → **Card banao** (0 token) → card dekho → **Approve: article likho**.
- Draft review page par publish se pehle ki jaanch, image/video, sources dikhte hain.
- Sab theek ho to **Approve + publish** dabao.

### Admin click ka rule (time pass nahi)

- **Abhi trends + research chalao** hamesha ek topic kholta hai: naya pending topic → warna purana `thin` topic dobara padhta hai → warna ready/latest topic khol deta hai. Dead-end "koi pending nahi" nahi aata.
- Trends ke 3 source (Google Trends ×2 + Google News) **parallel** chalte hain. Ek provider dead ho to 1.2s ke andar best available source use ho jata hai.
- Research ke providers 10s par cap hain; article text 6s par. Timeout par retry nahi hota (wahi "time pass" tha).
- Har research se pehle **pre-read (0 token)** chalta hai. Sources weak/foreign/unrelated hon to topic `thin` hota hai aur AI token kharch nahi hota. Topic page par poora brief + hate hue sources dikhte hain.
- **Card banao** (0 token) seedha us topic ka page kholta hai, jahan "Card post banao" button milta hai.

---

## 7. Routes

| Route | Kaam |
|---|---|
| `/` | Homepage, paginated (`?page=2`) |
| `/category/<name>` | Category listing |
| `/post/<slug>` | Article (ads, sources, share, schema) |
| `/search?q=` | Site search (noindex) |
| `/cards`, `/card/<id>` | Thumbnail-style card posts (default noindex) |
| `/img/<id>.jpg` | D1 me stored AI image (1 year immutable cache) |
| `/about`, `/editorial-policy`, `/contact`, `/privacy-policy`, `/terms`, `/disclaimer` | Trust pages (AdSense ke liye zaroori) |
| `/sitemap.xml`, `/feed.xml`, `/robots.txt`, `/ads.txt` | SEO / ads |
| `/{INDEXNOW_KEY}.txt` | IndexNow verification |
| `/admin` | Login + dashboard |
| `/admin/topics`, `/admin/topic/<id>` | Trends, research, card, write |
| `/admin/post/<id>` | Review, media refresh, approve/reject/delete |
| `/admin/new` | Manual draft |
| `/admin/ai-test` | AI provider test |
| `/admin/api-status` | Per-provider usage / cooldown / limits |

---

## 8. Content pipeline (short)

```
Google Trends / Google News
        │  (BLOCK + JUNK + non-Hindi/English script filter)
        ▼
topics table  ──►  research: Bing News + GDELT + Google News
        │          (parallel, 1 retry on timeout/5xx)
        ▼
pre-read (preread.js, 0 token): language match, relevance, real article text,
        │  duplicate/injection drop, agreed facts, allowed numbers, gaps
        │  weak / foreign / unrelated source set = STOP (koi AI token kharch nahi)
        ▼
preflight (playbook.js): YMYL blocked, politics/sports need 4 sources & fresh dates
        ▼
writer.js: AI draft (reading brief + sources) → copy check → AI editor + fact-check
           → code verification → score (cap 94) → DRAFT
        ▼
admin review: validate.js checklist + claim list + image/video + sources
        ▼
approve → live → IndexNow ping → sitemap/RSS
```

Safety rules jo code me already hain:
- Porn/betting/suicide/cure/loan-app jaise topics auto-block (`trends.js`).
- "live", "download", "price today" jaise junk searches skip.
- Paisa/sehat ki salah (YMYL) auto-write se block — sirf insaan likhe (`playbook.js`).
- Prompt-injection wala source text AI ko nahi diya jaata (`looksInjected`).
- **Pehle padho, phir token:** source language post ki language se match honi chahiye. Doosri bhasha
  (Spanish etc.) ya topic se unrelated source hamesha hate hain. Kaafi usable source na hone par
  topic `thin` rah jaata hai aur writer AI call hi nahi karta (`preread.js`).
- Reading brief AI ko sirf agreed facts, allowed numbers/dates/names aur "missing / do not invent"
  list deta hai — isliye AI apni purani ya bahar ki jaankari se numbers/naam nahi bana sakta.
- Invented numbers/names code se pakde jaate hain (`verify.js`, `postflight`, `editor.js`).
- Har post par sources list + "AI ki madad se taiyar" disclaimer.

---

## 9. Tests

```bash
npm test
```

241 tests in 14 files (`preread`, `validate`, `writer`, `editor`, `playbook`, `verify`, `facts`, `cardpost`, `media`,
`trends`, `ai`, `api-manager`, `seo-optimizer`, `index`). Sab pure functions / fake KV / fake fetch -
koi network call nahi, koi real DB nahi. `npm run check` har module import karke toota hua
import/syntax pakadta hai.

---

## 10. Known limits (honest list)

- **AdSense approval guaranteed nahi hai.** Google ki "scaled content abuse" / low-value
  content policy AI-generated news sites par lagti hai. Human editing, original analysis aur
  real traffic ke bina reject ya later ban ka risk hai. `MONETIZATION.md` me iska plan hai.
- **Ads sirf tab dikhte hain** jab `ADSENSE_PUB` + slot ID set ho aur account approved ho.
  Abhi live site par `ads.txt` sirf `# set ADSENSE_PUB` deta hai — yani earning zero.
- **Auto-publish by design off hai** (score cap 94 vs threshold 95). Ise force karna safe nahi.
- **AI model names badal sakte hain.** `src/ai.js` ke `FALLBACKS` aur provider model lists
  samay-samay par verify karni padti hain; purana model 404 de to `AI_MODEL`/`*_MODELS` badlo.
- **Hindi quality** AI par depend karti hai. Important post khud padh kar edit karo.
- **Images:** stock photo sirf jab topic clear ho; warna AI illustration. Short/ambiguous
  queries ("DAC", "Free Fire") par real photo jaan-boojh kar nahi lagti (galat photo se bachne ke liye).
- **Card posts default noindex** hain. Unhe index karana ho to `CARD_INDEX=1` + unique content.
- **Koi user account / comments / newsletter nahi.** Sab kuch anonymous + static.
- **Free tier limits:** Workers AI neurons, D1 rows, KV writes — bade traffic par
  paid plan ya caching strategy chahiye hogi.

---

## 11. Troubleshooting

| Problem | Check |
|---|---|
| `/admin` login page hi dikhta hai | `ADMIN_PASSWORD` secret set hai? Deploy ke baad naya cookie chahiye (purane cookies invalid ho gaye). |
| Ads nahi dikh rahe | AdSense approved? `ADSENSE_PUB` me `ca-` ke bina pub ID? `ADSENSE_SLOT` valid? Ad blocker? Article 600+ words? |
| `/ads.txt` galat | `ADSENSE_PUB` set karke redeploy karo; `google.com, pub-..., DIRECT, f08c47fec0942fa0` dikhna chahiye. |
| Homepage khali | D1 me approved + `publish_at <= now` posts hain? `/admin` se ek draft approve karo. |
| Sitemap khali | Same as above; `SITE_URL` sahi hai? |
| Image nahi aa rahi | `PEXELS_API_KEY` optional; Workers AI binding `AI` `wrangler.toml` me hai? |
| AI test fail | `/admin/api-status` kholo — provider key/limit/cooldown dikhega. |
| "no such column" | `schema.sql` (naya DB) ya `deploy.sh` / ALTER commands (purana DB) chalao. |
| 500 page | `npx wrangler tail` se real error dekho; ab stack user ko nahi dikhta. |

---

## 12. Owner ko ye khud karna hoga

Code se ye cheezein nahi ho sakti:

1. **AdSense account banana + site submit karna** (approval Google deta hai, code nahi).
2. **`ADSENSE_PUB` / slot IDs set karna** (account ke andar milte hain).
3. **AI keys / Pexels / YouTube keys dalna** (optional, par quality badhti hai).
4. **`ADMIN_PASSWORD` set karna** (warna admin band).
5. **Content review** — har AI draft publish se pehle padhna, kyunki zimmedari owner ki hai.
6. **Traffic laana** — WhatsApp/Telegram/X/Instagram/SEO; AdSense traffic ke bina kuch nahi deta.
