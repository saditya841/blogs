# Virall — Cloudflare-only AI business blog

**Live:** https://virall.in

Virall ek Hindi/English **business analysis** site hai jo poori tarah **Cloudflare free tier** par chalti hai:
Workers (hosting + cron), D1 (database), Workers AI (images), KV (API usage counters).
Koi VPS, koi paid database, koi npm dependency nahi. Paisa **Google AdSense** se aata hai.

Business mode default me ON hai (`BUSINESS_MODE=true`). News pipeline code me maujood hai aur
`BUSINESS_MODE=false` karke wapas chalu ki ja sakti hai — par default direction ab business hai.

> **Sabse pehle:** `MONETIZATION.md` padho. Usme AdSense approval checklist, 30-day content plan
> aur honest earning expectations hain.

---

## 1. Ek nazar me

| Cheez | Kahan |
|---|---|
| Worker + saare routes | `src/index.js` |
| Topic discovery (Google Trends / News) | `src/trends.js` |
| Business topic bank + frameworks + depth gate | `src/business.js` |
| Auto-heal agent (topic cleanup + metadata repair + draft deepening) | `src/autoheal.js` |
| Zero-token source pre-read / reading brief | `src/preread.js` |
| Multi-AI debate + code-checked claim ledger | `src/debate.js`, `src/claims.js` |
| Duplicate check (SimHash/MinHash) | `src/similarity.js` + `post_fingerprints` table |
| Human-like writing guard | `src/style.js` |
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
| Purane database ka upgrade | `migration_v3.sql` + `migration_v4.sql` + `migration_v5.sql` + `deploy.sh` |
| Poora architecture / runbook | `ARCHITECTURE.md` |
| Tests | `test/unit/*.test.js` |

**Auto-publish default me OFF hai.** Admin panel ke do switches (`auto_write`, `auto_publish`)
D1 me `settings` table me rehte hain. Bina human review AI news publish karna AdSense ke liye
risky hai — isliye manual approve default hai.

---

## 2. Local setup

Zaroorat: **Node.js 22+** (Node 26 par test kiye gaye). `npm install` ki zaroorat nahi — koi dependency nahi hai.

```bash
npm test          # 347 unit tests (network nahi, DB nahi)
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
npx wrangler d1 execute virall-db --remote --file=migration_v4.sql
npx wrangler d1 execute virall-db --remote --file=migration_v5.sql
```

`migration_v3.sql`, `migration_v4.sql` aur `migration_v5.sql` idempotent hain (tables par `IF NOT EXISTS`), unhe dobara chalana safe hai.
`migration_v5.sql` do naye columns (`posts.human_edited_at`, `posts.human_edit_note`) add karta hai;
dobara chalane par D1 "duplicate column" error dega — us case me wo step skip karo.

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
| `BUSINESS_MODE` | `true` | ON = business blog pipeline (business news + evergreen topic bank, Wikipedia background source, business depth gate). `false` = purana news pipeline. |
| `BUSINESS_LANG` | `en` | Default business article language (`en`/`hi`). Admin se per draft EN/HI chuna ja sakta hai. |
| `BUSINESS_DAILY_LIMIT` | `3` | Business mode ka hard daily draft cap. Isse zyada draft ek din me nahi bante. |
| `BUSINESS_MIN_WORDS` | `1200` | Business article ki minimum depth (words). Gate 80% se neeche hard-fail karta hai. |
| `BUSINESS_TOPIC_LIMIT` | `3` | Ek run me kitne naye business topics laane hain. |
| `AUTO_DRAFT_QUEUE_MAX` | `6` | Auto-draft sirf tab chalta hai jab approve karne ke liye itne se kam drafts pending hon. |
| `AUTO_DRAFT_MIN_SCORE` | `60` | Auto-draft is score se neeche wale business draft ko khud reject kar deta hai. |
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
| `DEBATE_ENABLED` | `true` | Multi-AI debate (Reporter/Analyst/Skeptic + judge) write se pehle. |
| `DEBATE_ROUNDS` | `1` | `0` = sirf 3 roles, `1` = judge cross-exam bhi. |
| `DEBATE_ROLES` | `3` | Kitne neutral roles (2–3). |
| `DEBATE_TIMEOUT_MS` | `45000` | Ek debate ka hard deadline (page hang nahi hota). |
| `DEBATE_REUSE_SECONDS` | `7200` | Preview debate itni der write me reuse (double token no). |
| `DEBATE_PROVIDER_ORDER` | khali | Optional: `cohere,groq,gemini` — kaun pehle. |
| `MIN_AGREE_SOURCES` | `2` | Claim "verified" hone ke liye kitne independent outlets. |
| `DUPLICATE_CHECK` | `true` | Same story pehle se hai to AI se pehle block. |
| `DUP_MAX_SIMILARITY` | `0.82` | Isse zyada similarity = duplicate. |
| `DUP_CHECK_LIMIT` | `400` | Kitne purane posts ke fingerprints compare karne hain. |
| `STYLE_MIN_SCORE` | `60` | Style guard report threshold (penalty score me subtract hota hai). |
| `REQUIRE_HUMAN_EDIT` | `true` | Draft publish/auto-publish se pehle insaan ka edit ya 30+ akshar ka note zaroori. |
| `FACT_REGISTRY` | `true` | Code-verified facts ko permanent `facts` table me save karo (stale-fact warning ke liye). |
| `FACT_MAX_AGE_HOURS` | `24` | Itne ghante baad fact "re-check pending" dikhta hai. |
| `VOICE_PROFILE` | `true` | Site voice profile (last 10 approved posts) se naya draft compare karo. |
| `VOICE_PROFILE_LIMIT` | `10` | Kitne approved posts se voice profile bane. |
| `SOURCE_RECHECK` | `true` | Approve se pehle source links live hain ya nahi check karo. |
| `SOURCE_RECHECK_MAX` | `3` | Kitne source links check karne hain. |
| `SOURCE_RECHECK_TIMEOUT_MS` | `3000` | Ek source check ka timeout. |
| `ORIGINALITY_TARGET` | `0.85` | Itne se kam original sentences par score penalty. |
| `SPECIFICITY_LOW` / `SPECIFICITY_HIGH` | `3` / `10` | 100 shabd par thos detail (naam/number/tareekh) ki natural range. |

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
3. `collectBusinessTopics` (business mode) ya `collectTopics` (news mode) — naye topics.
4. `researchPending` — 2 topics ke sources jama karta hai.
5. `writeOne` — sirf tab jab `auto_write` switch ON ho.

Pehli baar deploy ke baad:
- `/admin` kholo, `ADMIN_PASSWORD` se login karo.
- **Topics** page se "Abhi trends + research chalao" dabao.
- Ek topic kholo → **Card banao** (0 token) → card dekho → **Approve: article likho**.
- Draft review page par publish se pehle ki jaanch, image/video, sources dikhte hain.
- **Human check form** bharo: article padho, zaroorat ho to `body` edit karo (ya 30+ akshar ka note likho), "maine 3 random facts sources se mila liye" tick karo, phir **Human-check ke saath approve + publish** dabao. Iske bina normal approve nahi chalega.

- **Business** page kholo → "Naye business topics lao" (0 token) → Topics page se ek topic ka research chalao → wapas Business page par **Write English** ya **Write Hindi** dabao. Draft banne ke baad wahi human review/approval flow chalta hai.
- Ek din me 3 se zyada business draft nahi bante (`BUSINESS_DAILY_LIMIT=3`) — quality over volume.
- Pehle se bane **thin Business draft** ko sudharne ke liye review page par **Content gap analysis** card dikhta hai. `Deepen` dabane par fresh sources aate hain, wahi story expand hoti hai (plain-language setup + worked example + result section), aur fact-check dobara chalta hai. Sirf draft par kaam karta hai — live post pehle "Back to draft" karo.
- **Business** page ke neeche last 30 Business posts ka gap report bhi dikhta hai, taaki purane kamzor drafts ek jagah mil jayein.

### Auto-draft mode (AI likhe, tum sirf approve karo)

`/admin` par **Auto-draft: ON** karo. Cron pehle se har ghante chalta hai (`crons = ["0 * * * *"]`), par usme safety rails hain:

- Ek din me max `BUSINESS_DAILY_LIMIT` (3) drafts — 24 nahi. 24 AI posts/day AdSense ke "scaled content" rule aur free AI quota dono ke liye khatra hai.
- Approval queue `AUTO_DRAFT_QUEUE_MAX` (6) drafts par ruk jati hai. Tumhare paas 6 pending drafts hain to cron naya draft nahi banayega.
- Jo draft business depth gate fail kare ya `AUTO_DRAFT_MIN_SCORE` (60) se neeche ho, wo **auto-reject** ho jata hai — review queue me sirf achhe drafts aate hain.
- Auto-publish abhi bhi OFF rakho. Tum har draft padhkar human-check form ke saath approve karo (2–3 min per post).
- Har ghante ka result `/admin` par "Aakhri auto-draft koshish" me dikhta hai: draft bana, auto-reject, queue full, ya token nahi kharch hua.

### Admin click ka rule (time pass nahi)

- **Abhi trends + research chalao** hamesha ek topic kholta hai: naya pending topic → warna purana `thin` topic dobara padhta hai → warna ready/latest topic khol deta hai. Dead-end "koi pending nahi" nahi aata.
- Trends ke 3 source (Google Trends ×2 + Google News) **parallel** chalte hain. Ek provider dead ho to 1.2s ke andar best available source use ho jata hai.
- Research ke providers 10s par cap hain; article text 6s par. Timeout par retry nahi hota (wahi "time pass" tha).
- Har research se pehle **pre-read (0 token)** chalta hai. Sources weak/foreign/unrelated hon to topic `thin` hota hai aur AI token kharch nahi hota. Topic page par poora brief + hate hue sources dikhte hain.
- `ready` topic ke sources purane ho jayein (2+ din) to **write karte waqt code khud fresh sources laata hai** (token se pehle). Fresh nahi mile to topic `thin` ho jata hai; purana error ab nahi aata.
- **Har draft me image guarantee**: AI/stock image fail ho to branded news-card SVG (0 token, koi API key nahi) `/img/<id>.svg` par banti hai. Topic page par 0-token image preview bhi dikhta hai.
- **Video optional hai**: site par video lagane ke liye free `YOUTUBE_API_KEY` secret chahiye. Na ho to article phir bhi image ke saath publish ho sakta hai.
- **Card banao** (0 token) seedha us topic ka page kholta hai, jahan "Card post banao" button milta hai.
- **Multi-AI debate chalao** (topic page) 3 neutral roles (Reporter/Analyst/Skeptic) + judge chalta hai. Har claim ke saath source line aati hai, aur code check karta hai ki evidence sach me sources me hai ya nahi. Result topic page par verified / single-source / unsupported claims ke roop me dikhta hai.
- **Approve: iska article likho** dabane par wahi debate (agar 2 ghante ke andar chala hai) reuse hota hai, isliye token dobara kharch nahi hote. Debate na chala ho to write click khud chala leta hai — single click me result.
- **Duplicate gate (0 token):** agar same story pehle se site par hai (SimHash + MinHash + title hash), topic `duplicate` ho jata hai, AI token kharch nahi hota, aur admin ko purana post dikh jata hai.
- **Style guard (0 token):** draft me `furthermore`/`in conclusion` jaise AI phrases, flat sentence rhythm ya repeated phrases hon to score me penalty lagti hai; post review page par style score + notes dikhte hain.
- **Quality layers (0 token):** writer har draft par originality (sources se kitna alag likha), specificity (100 shabd par naam/number/tareekh) aur site-voice (last 10 approved posts ka rhythm) bhi check karta hai. Chaaron penalties milakar maximum 20 points kate hain, isliye ek layer doosre ko chhupa nahi sakti.
- **Contradiction detector (0 token):** agar do outlets ek hi fact ke do alag number dete hain (1200 crore vs 2100 crore), claim `conflict` hota hai - na verified, na writer ko "sach" bana kar diya jata hai. Article me "reports differ" ya number chhodna padta hai.
- **Human edit gate:** `REQUIRE_HUMAN_EDIT=true` par draft tab tak publish nahi hota jab tak admin body edit (200+ akshar ka change) ya 30+ akshar ka check-note na de aur "3 random facts" checkbox tick na kare. Auto-publish bhi `human_edited_at` ke bina nahi chalta.
- **Source recheck (0 token):** approve se pehle 404/410/451 links pakde jate hain; 2+ dead links approve rok dete hain. 403/timeout "unknown" hote hain, article unfairly block nahi hota.
- **Fact registry (0 token):** verified claims outlets ke saath D1 me save hote hain. 24 ghante se re-check na hue facts review page par warning dikhate hain; "Facts aaj verify kiye" se timestamp update hota hai.
- **Auto-heal agent (`/admin/autoheal`):** purane thin/rejected/duplicate topics aur ready backlog (top 12 ke baad) ka preview dikhata hai, phir confirm par delete karta hai (0 token). Thin Business draft ek click me deepen hota hai (token), missing summary/tags/meta body se bhar jate hain (0 token), aur har run ka before/after log rehta hai. Cron roz 03:30 IST par sirf 0-token cleanup chalata hai.
- **Corrections:** admin review page se correction darj karo - article ke neeche dated `Update (YYYY-MM-DD)` line judti hai aur `/corrections` par sab public dikhta hai.

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
| `/about`, `/author`, `/editorial-policy`, `/contact`, `/corrections`, `/privacy-policy`, `/terms`, `/disclaimer` | Trust pages (AdSense ke liye zaroori) |
| `/sitemap.xml`, `/news-sitemap.xml`, `/feed.xml`, `/robots.txt`, `/ads.txt` | SEO / ads |
| `/{INDEXNOW_KEY}.txt` | IndexNow verification |
| `/admin` | Login + dashboard |
| `/admin/topics`, `/admin/topic/<id>` | Trends, research, card, write (EN/HI business) |
| `/admin/business` | Business topics (HIGH TRAFFIC tag), EN/HI draft buttons, daily cap, existing-post gap report |
| `/admin/post/<id>` | Review, content gap analysis + Deepen (draft only), media refresh, approve/reject/delete |
| `/admin/new` | Manual draft |
| `/admin/ai-test` | AI provider test |
| `/admin/autoheal` | Auto-heal agent: topic cleanup preview/confirm, thin draft heal, missing metadata fix, run log |
| `/admin/api-status` | Per-provider usage / cooldown / limits |

---

## 8. Content pipeline (short)

**Business mode (default):**

```
HIGH-TRAFFIC evergreen queries (BUSINESS_HOT_QUERIES, rotated daily, 1 slot reserved)
  + Google Business News (1 fresh headline)
  + evergreen BUSINESS_TOPIC_BANK (rotated daily)
        │  (same BLOCK + JUNK + script filter; 0 token)
        ▼
topics table (research.mode = "business", heat = high | fresh)
        │
        ▼
research: Bing News + GDELT + Google News + Wikipedia background
        ▼
pre-read (0 token) ─► preflight (business: 2 sources, no freshness requirement)
        ▼
writer: business prompt — 10 sections (plain-language setup, money engine, named
        framework, worked example, counterpoint, operator playbook, risks,
        result/outcome, what is not confirmed, analysis) — 1200-1600 words
        → copy check → AI editor/fact-check → business depth gate (code)
        → derived-number check (A / B = C) → score (cap 94) → DRAFT
        ▼
admin review (EN/HI available; gap report + Deepen for drafts)
        → human edit + approve → live
```

**News mode (`BUSINESS_MODE=false`):**

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
- **Multi-AI debate safe hai:** roles neutral analysts hain, koi real neta/neta persona nahi. Kisi ke mu me fake quote daalna prompt me mana hai; article me quotation marks bhi nahi aate. Debate ka claim ledger code verify karta hai (evidence 3-word match + 2+ outlet), AI khud `verified` nahi bol sakta.
- **Duplicate se pehle block:** same headline/story ka post pehle se ho to topic `duplicate` hota hai aur AI token nahi lagta. `post_fingerprints` table purane posts ke liye khud bhi ban jati hai.
- **Style guard:** stock AI phrases aur machine-jaisa sentence rhythm score penalty laata hai, taaki content human jaisa rahe.
- Har post par sources list + "AI ki madad se taiyar" disclaimer.
- **Business mode ka extra gate:** article me plain-language setup (headline hi padha ho to bhi samajh aaye),
  named framework, unit economics/cash engine, **worked example**, strong counterpoint, operator playbook,
  risks, **result/outcome**, "what is not confirmed" aur final analysis hona chahiye (10 sections, 1200+ words).
  Worked example ya result section missing ho to gate `ok=false` — sirf headings ka joda hona kaafi nahi.
  Guarantee/risk-free/get-rich language aur stock tips (`buy`, `target price`, `multibagger`) hard-block hain.
  Calculation tabhi allowed hai jab `A / B = C` ke inputs sources me hon aur arithmetic sahi ho (`derivedNumbers`).
- Business articles par public "Business analysis, not investment advice" box har article me dikhta hai.

---

## 9. Tests

```bash
npm test
```

354 tests in 22 files (`preread`, `validate`, `writer`, `editor`, `playbook`, `verify`, `facts`, `cardpost`, `media`,
`trends`, `ai`, `api-manager`, `seo-optimizer`, `index`, `claims`, `similarity`, `style`, `debate`, `quality-layers`, `business`, `autodraft`, `deepen`). Sab pure functions / fake KV / fake fetch -
koi network call nahi, koi real DB nahi. `quality-layers` conflicts, originality, specificity, voice, fact
registry, corrections aur source liveness ko cover karta hai (in-memory SQLite se, network nahi).
`business` topic bank, hot-topic rotation, frameworks, 10-section prompt, depth gate, derived arithmetic aur
Business publish rules cover karta hai. `deepen` existing post ka 0-token gap report cover karta hai.
`autodraft` approval-queue cap aur auto-reject rules cover karta hai.
`npm run check` har module import karke toota hua import/syntax pakadta hai.

---

## 10. Known limits (honest list)

- **AdSense approval guaranteed nahi hai.** Google ki "scaled content abuse" / low-value
  content policy AI-generated news sites par lagti hai. Human editing, original analysis aur
  real traffic ke bina reject ya later ban ka risk hai. `MONETIZATION.md` me iska plan hai.
- **Ads sirf tab dikhte hain** jab `ADSENSE_PUB` + slot ID set ho aur account approved ho.
  Abhi live site par `ads.txt` sirf `# set ADSENSE_PUB` deta hai — yani earning zero.
- **Auto-publish by design off hai** (score cap 94 vs threshold 95). Ise force karna safe nahi.
- **Human edit default me zaroori hai.** `REQUIRE_HUMAN_EDIT=true` par bina insaan ke edit/note koi post
  publish nahi hoti. Isse AdSense ki "scaled content" policy se bachne me madad milti hai, par iska
  matlab hai ki roz 20 posts automatically nahi nikal sakte — volume tumhari capacity ke hisaab se rakho.
- **AI model names badal sakte hain.** `src/ai.js` ke `FALLBACKS` aur provider model lists
  samay-samay par verify karni padti hain; purana model 404 de to `AI_MODEL`/`*_MODELS` badlo.
- **Hindi quality** AI par depend karti hai. Important post khud padh kar edit karo.
- **Images:** stock photo sirf jab topic clear ho; warna AI illustration. Short/ambiguous
  queries ("DAC", "Free Fire") par real photo jaan-boojh kar nahi lagti (galat photo se bachne ke liye).
- **Card posts default noindex** hain. Unhe index karana ho to `CARD_INDEX=1` + unique content.
- **Koi user account / comments / newsletter nahi.** Sab kuch anonymous + static.
- **Free tier limits:** Workers AI neurons, D1 rows, KV writes — bade traffic par
  paid plan ya caching strategy chahiye hogi.
- **3 deep business articles/day free AI keys par realistic upper bound hai.** Ek article me
  debate + draft + editor + fact-check milakar roughly 20,000–30,000 tokens lag sakte hain.
  Pehle 1–2 articles/day se shuru karo, quality check karo, phir cap tak badhao. 10 thin posts
  se ek deep post behtar hai — AdSense bhi yahi dekhta hai.

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
