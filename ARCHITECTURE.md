# Virall — Architecture (A + B + C)

Ye document batata hai ki Virall kaise kaam karta hai: trends → research → 0-token pre-read →
multi-AI debate + cross-check → claim ledger (code verified) → human-style article → duplicate/style
check → SEO → DRAFT → human approval. Sab kuch **Cloudflare free tier** par chalta hai.

Aakhri update: 10 Nov 2026 | Code: `src/*.js` | DB: D1 `virall-db` | Deploy: Cloudflare Workers

---

## 1. Ek line me design

> AI **likhta** hai, lekin AI **verify nahi karta**. Verification plain JavaScript karta hai
> (quote source me hai ya nahi, number/naam allowed hai ya nahi, 2+ outlet agree karte hain ya nahi).
> Isliye multi-AI debate quality badhata hai, par jhooth ko "verified" nahi bana sakta.

---

## 2. Poora pipeline

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 1. TRENDS (0 token)                                                      │
│    Google Trends ×2 + Google News (parallel)                             │
│    → junk filter (standings, points table, prediction, lineups, preview) │
│    → topics table (status = new)                                         │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │  admin click: "Agla pending topic research karo"
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ 2. RESEARCH (0 token)                                                    │
│    RSS/Google News se 6+ outlets, real article text, date, language      │
│    → preread.js: language match, relevance, injection check,             │
│      facts (2+ outlet agree), allowed numbers/dates/names, gaps          │
│    → status = ready (usable) | thin (specific reason)                    │
│    → topics.research me sources + brief + dropped + errors               │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │  admin click: "Approve: iska article likho"
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ 3. DUPLICATE GATE (0 token)                         similarity.js         │
│    topic title + agreed facts ka fingerprint                             │
│    vs post_fingerprints (SimHash + MinHash + exact title hash)           │
│    score >= DUP_MAX_SIMILARITY (default 0.82) → status = duplicate       │
│    → AI token KHARCH NAHI hota, admin ko exact purana post dikhta hai    │
└───────────────────────────────┬──────────────────────────────────────────┘
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ 4. MULTI-AI DEBATE + CROSS-CHECK (token)            debate.js + claims.js│
│    Reporter / Analyst / Skeptic (3 alag provider par parallel)           │
│    → Judge AI cross-examine karta hai (kaun kis claim se agree)          │
│    → code: evidence 3-word match + numbers + outlet count                │
│    → ledger: verified (2+ outlets) | single-source | unsupported         │
│    → topics.research.debate me save; 2 ghante tak reuse (double spend no)│
└───────────────────────────────┬──────────────────────────────────────────┘
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ 5. WRITER (token)                                   writer.js            │
│    prompt = reading brief + CODE-CHECKED ledger + sources                │
│    → 500-750 words, 3-5 headings, mandatory Vishleshan/Analysis          │
│    → copy check vs sources (6-word shingles) + 1 rewrite retry           │
└───────────────────────────────┬──────────────────────────────────────────┘
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ 6. EDITOR + FACT-CHECK (token)                      editor.js             │
│    AI editor rewrite + CLAIM || EVIDENCE list                            │
│    → code: groundedCheck + numbersNotIn + latinNotIn + analysis section  │
│    → fail ho to 1-2 fix rounds; phir bhi fail = draft saved, NOT verified│
└───────────────────────────────┬──────────────────────────────────────────┘
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ 7. STYLE GUARD + SCORE (0 token)                    style.js              │
│    banned AI phrases, sentence rhythm, repeated openings/phrases         │
│    → penalty (max 15) score me subtract; check_json me notes             │
└───────────────────────────────┬──────────────────────────────────────────┘
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ 8. MEDIA + SEO (mostly 0 token)                                          │
│    AI/stock image → fail? branded SVG news-card (0 token, guaranteed)    │
│    thumbnail, meta description, keywords, NewsArticle schema             │
└───────────────────────────────┬──────────────────────────────────────────┘
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ 9. SAVE (atomic D1 batch)                                                │
│    posts row (status=draft) + topics.status=drafted + research/debate    │
│    post_fingerprints row (future duplicate checks ke liye)               │
└───────────────────────────────┬──────────────────────────────────────────┘
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ 10. HUMAN APPROVAL                                                       │
│     /admin/post/<id> → "Publish se pehle jaanch" (claims + style + media)│
│     Approve = live. Auto-publish default OFF (SCORE_MAX=94 < 95).        │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Module map

| File | Kaam | Network/AI? |
|---|---|---|
| `src/index.js` | Public site, SEO pages, sitemap/RSS, admin UI + routes | D1 |
| `src/trends.js` | Trends ×2 + News parallel, junk filter, research one topic | Yes (free, no AI) |
| `src/preread.js` | 0-token reading brief: language, relevance, facts, allowed numbers, gaps | No |
| `src/facts.js` | 2+ outlet agreed facts, date/number keys | No |
| `src/verify.js` | injection check, shingles, grounded claims, numbers/names not in sources | No |
| `src/debate.js` | 3 neutral AI roles + judge, provider rotation, timeouts | AI |
| `src/claims.js` | Claim ledger: parse, evidence match, outlet count, verified/single-source/unsupported | No |
| `src/writer.js` | Duplicate gate → debate → draft → copy check → editor → style → image → SEO → D1 | AI |
| `src/editor.js` | Editor + claim evidence pass, code decides `verified` | AI |
| `src/similarity.js` | SimHash/MinHash fingerprint + `post_fingerprints` DB helpers | No |
| `src/style.js` | Human-like writing guard (banned phrases, rhythm, repetition) | No |
| `src/media.js` | Image (Pexels/Wikimedia/AI) + branded SVG fallback + YouTube video | Yes (free keys) |
| `src/seo-optimizer.js` | Meta, schema, content analysis | No |
| `src/multi-api-manager.js` | Groq → Gemini → HF → Cohere router, cooldown, daily limits, `providers` filter | Yes |
| `src/ai.js` | Multi-API first, Cloudflare Workers AI fallback | Yes |

---

## 4. Multi-AI debate (safe design)

### Roles (real politicians nahi)

| Role | Kaam |
|---|---|
| **Reporter** | Sirf confirmed facts: kya, kab, kahan, kaun |
| **Analyst** | Is khabar ka matlab, context, kis par asar |
| **Skeptic** | Kya missing hai, kaun si baat sirf 1 source me hai, contradictions |

### Hard safety rules (prompt + code)

- Koi AI **kisi neta ke mu me shabd nahi** daal sakta. Prompt me saaf: *"You are NOT a politician… never invent quotes."*
- Koi fake dialogue, fake statement, fake number, fake name nahi.
- Article me sirf **publicly reported stand ka summary**, quote nahi.
- Har claim ke saath **exact source line (EVIDENCE)** chahiye.
- Judge sirf claims chunta hai, naye facts nahi banata.
- Code `verified` set karta hai — AI nahi.

### Provider rotation

```
role 0 → GROQ → GEMINI → HF → COHERE
role 1 → GEMINI → HF → COHERE → GROQ
role 2 → HF → COHERE → GROQ → GEMINI
judge  → COHERE → GROQ → GEMINI → HF
```

`DEBATE_PROVIDER_ORDER` se order badal sakte ho. Key na ho to provider skip, phir Workers AI fallback.

### Ledger classification

| Status | Rule | Writer ko |
|---|---|---|
| `verified` | evidence sources me mila **+ 2+ independent outlets** | Normal fact ki tarah use |
| `single-source` | evidence mila, par sirf 1 outlet | "ek report ke mutabik" likh sakta hai |
| `unsupported` | evidence sources me nahi mila | **Bilkul nahi** |

Writer ko sirf ye text block milta hai (`ledgerText`), poora debate nahi — token bachta hai aur
hallucination ka risk kam hota hai.

---

## 5. Duplicate checking (3 layer)

1. **Sources ke against copy** — `writer.js` 6-word shingles, overlap + longest run. Zyada ho to 1 rewrite, phir reject.
2. **Apni site ke against duplicate** — `similarity.js`:
   - `SimHash` (64-bit, word frequency)
   - `MinHash` (48 hashes, Jaccard estimate)
   - exact title hash
   - combined score → `DUP_MAX_SIMILARITY` (default 0.82) se upar = duplicate
3. **Same title, alag body** — exact title hash turant block.

Fingerprint `post_fingerprints` me save hota hai. Purane posts ke liye table khali ho to code
`posts` table se fingerprints bana leta hai, isliye migration ke baad bhi protection chalu rehti hai.

Topic duplicate milne par:
- `topics.status = 'duplicate'`
- `topics.research.duplicate = { score, exact, against: { id, title } }`
- **0 AI token** kharch
- admin ko exact purana post dikhta hai

---

## 6. Style guard (human-like writing)

`src/style.js` AI detector chase nahi karta. Ye obvious machine patterns pakadta hai:

- stock phrases: `furthermore`, `in conclusion`, `it is important to note`, `delve`, `landscape`, `testament`, `इस लेख में`, `निष्कर्ष के रूप में`…
- sentence length ka average 9 se kam ya 29 se zyada
- har sentence lagbhag same length (standard deviation < 4)
- 32%+ sentences bahut lambe
- koi chhota sentence nahi
- same shuruaati 2 shabd baar-baar
- same 4-word phrase 3+ baar

Penalty max **15 points**; score me subtract hota hai aur `check_json.style` me notes save hote hain.
Iske liye **koi extra AI call nahi** hoti.

---

## 7. Free API stack aur limits (ground reality)

| Service | Free use | Limit ka dhyan |
|---|---|---|
| Cloudflare Workers | 1,00,000 requests/day | Static + dynamic dono |
| Cloudflare D1 | 5 GB storage, 5M reads/day (free plan) | Posts + images + fingerprints |
| Cloudflare KV | 1 GB, 1L reads/day | API usage + cooldown counters |
| Workers AI | Daily free neuron quota | Fallback writer/image; bade articles me jaldi khatam |
| Groq | Free rate limit | Sabse fast; debate + writer ke liye best |
| Google Gemini AI Studio | Free tier rate limit | Free tier data training ke liye use ho sakta hai |
| Hugging Face | Free monthly credits | Backup |
| Cohere | Free trial/limited | Judge/backup |
| Pexels | Free key | Stock image |
| YouTube Data API | Free quota | Video optional |

**Token budget (approx, per article):**

| Stage | Tokens |
|---|---|
| 3 debate roles | 2,000–4,000 |
| Judge cross-exam | 1,000–1,800 |
| Writer draft | 5,000–7,000 |
| Editor + factual claims | 5,000–7,000 |
| Rewrite retry (kabhi-kabhi) | 5,000–7,000 |
| **Total typical** | **~40,000–55,000** |

Isliye `DAILY_POST_LIMIT=5` rakha hai. Free tier par realistically **3–5 solid articles/day**,
10 nahi. `DEBATE_ENABLED=false` karke token bacha sakte ho, par quality gate kam ho jayega.

**Koi artificial wait/sleep nahi:** network calls ke hard deadlines hain (research 10s, article text
6s, debate 45s), timeout par kaam aage badhta hai — page hang nahi hota.

---

## 8. Admin click map (har click = ek result)

| Button | Kya hota hai | Token |
|---|---|---|
| **Abhi trends + research chalao** | Naye topics + ek pending topic research, phir us topic ka page | 0 |
| **Agla pending topic research karo** | 1 topic; pending na ho to purana `thin`, phir stale `ready` refresh | 0 |
| **Card banao** | Us topic ka page kholta hai (card button wahan) | 0 |
| **Ready topic se ek draft likho** | Duplicate gate → debate → draft → image → SEO | AI |
| **Research dobara chalao** (topic page) | Us topic ke fresh sources + brief | 0 |
| **Multi-AI debate chalao** (topic page) | 3 roles + judge + code ledger preview | AI |
| **Approve: iska article likho** | Wahi debate reuse (2h), phir draft | AI |
| **Card post banao** | Chhota AI call, `/card/<id>` par turant live | AI |
| **Approve + publish** (post page) | Validation + live | 0 |

Failure par message me saaf likha hota hai: **`Token kharch nahi hua`** ya **`Token laga`**.

---

## 9. Database (D1)

### Core tables

```sql
posts(id, slug, title, summary, body, category, tags, lang, image_url, image_credit, video_url,
      sources, score, word_count, pinged, check_json, status, publish_at, created_at, updated_at,
      featured_image, thumbnail_image, og_image, seo_score, meta_description, meta_keywords, schema_json)

topics(id, query, traffic, status, research, source_count, created_at, updated_at)
-- status: new | ready | thin | drafted | duplicate | rejected | card_live

images(id, mime, b64, created_at)                 -- /img/<id>.jpg|.svg
settings(k, v)                                    -- auto_write / auto_publish / last_write
post_fingerprints(post_id, simhash, title_simhash, title_hash, minhash, tokens, title, created_at)
```

### `check_json` (post ke andar)

```json
{
  "verified": true,
  "claims": 8,
  "supported": 8,
  "claimList": [{"c": "...", "e": "...", "ok": true, "why": ""}],
  "numbersNotInSources": [],
  "latinNotInSources": [],
  "overlap": 0.04,
  "preread": {"ok": true, "quality": 88, "facts": 5, "agreed": 3},
  "style": {"score": 97, "penalty": 3, "notes": ["..."]},
  "duplicate": {"checked": true, "score": 0.41, "duplicate": false},
  "debate": {"ok": true, "stats": {"verified": 4, "singleSource": 2, "unsupported": 1}}
}
```

### `topics.research` (topic ke andar)

```json
{
  "sources": [{"source": "...", "url": "...", "date": 0, "text": "..."}],
  "brief": {"version": 1, "ok": true, "stats": {}, "facts": [], "gaps": [], "briefText": "..."},
  "dropped": [{"source": "...", "reason": "..."}],
  "debate": {"ok": true, "roles": [], "ledger": {"verified": [], "singleSource": [], "unsupported": []}},
  "duplicate": {"score": 0.91, "exact": false, "against": {"id": 42, "title": "..."}}
}
```

> `post_fingerprints` aur `images` lazily bhi ban jate hain, par fresh install ke liye
> `schema.sql` aur purane DB ke liye `migration_v4.sql` chalao.

---

## 10. Env vars (wrangler.toml + Secrets)

### Public vars

| Var | Default | Matlab |
|---|---|---|
| `SITE_URL` | `https://virall.in` | Canonical URL, schema, sitemap |
| `POST_LANG` | `eng` | `en`/`eng` = English, warna Hindi |
| `DAILY_TOPIC_LIMIT` | `10` | Ek din me max naye topics |
| `DAILY_POST_LIMIT` | `5` | Ek din me max drafts |
| `SCORE_MAX` | `94` | Auto-publish cap (95 se neeche) |
| `AUTO_APPROVE_MIN_SCORE` | `95` | Auto-publish threshold |
| `DEBATE_ENABLED` | `true` | Multi-AI debate on/off |
| `DEBATE_ROUNDS` | `1` | 0 = roles only, 1 = judge cross-exam |
| `DEBATE_TIMEOUT_MS` | `45000` | Ek debate ka hard deadline |
| `DEBATE_REUSE_SECONDS` | `7200` | Preview debate kitni der reuse |
| `MIN_AGREE_SOURCES` | `2` | Claim verified hone ke liye outlets |
| `DUPLICATE_CHECK` | `true` | Duplicate gate on/off |
| `DUP_MAX_SIMILARITY` | `0.82` | Block threshold |
| `STYLE_MIN_SCORE` | `60` | Report-only threshold |
| `COPY_MAX_OVERLAP` | `0.3` | Max source copy |
| `COPY_MAX_RUN` | `35` | Max copied words in a row |

### Secrets (Cloudflare → Secrets)

```
GROQ_API_KEY
GEMINI_API_KEY
HUGGINGFACE_API_KEY
COHERE_API_KEY
PEXELS_API_KEY        (optional)
YOUTUBE_API_KEY       (optional)
ADMIN_TOKEN / basic auth
```

---

## 11. Security & quality rules

- **Prompt injection:** sources me "ignore previous instructions" jaisa text ho to `looksInjected` us source ko drop karta hai.
- **Language lock:** source language `POST_LANG` se match karni chahiye; Spanish/other hamesha drop.
- **No fake quotes:** debate prompts me hard rule; writer prompt me "no quotation marks"; code `latinNotIn`/numbers check karta hai.
- **AI never self-verifies:** `verified` sirf `editor.js` ke code checks se aata hai.
- **Admin auth:** hardened session cookie; har admin route protected.
- **No paid fallback:** paid API key add nahi ki gayi; free tier hi.
- **Auto-publish OFF by design:** `SCORE_MAX=94` < `AUTO_APPROVE_MIN_SCORE=95`.
- **Human final approval:** draft review page par claims, style, image, video sab dikhta hai.

---

## 12. SEO + Google crawl runbook

1. **Google Search Console** verify karo (`virall.in`).
2. `sitemap.xml` submit karo. News sitemap/RSS already `/rss.xml`.
3. **Har naye post par internal links** (3–5 related posts) — ye crawl ko sabse zyada help karta hai.
4. **IndexNow** (Bing/Yandex) optional; Google ke liye GSC "URL Inspection → Request indexing".
5. **Schema:** NewsArticle + Breadcrumb + Organization already.
6. **Images:** 1200×630, real/branded, credit ke saath. Discover ke liye ye zaroori hai.
7. **Title:** 30–90 chars, clickbait nahi, fact ke saath.
8. **Freshness:** roz 2–3 posts, 20–30 quality posts ke baad hi AdSense apply.
9. **Google News Publisher Center:** eligibility ho to apply; guarantee nahi.
10. **100% indexing ka koi guarantee nahi.** GSC + sitemap + internal links + fresh content hi best effort hai.

### AdSense approval checklist

- [ ] 20–30 original, deep posts (thin AI spam nahi)
- [ ] About, Contact, Privacy, Editorial Policy, Disclaimer
- [ ] Author/desk identity + "how we make articles" page
- [ ] Original/credited images only
- [ ] No fake quotes, hate, election misinformation
- [ ] `ads.txt`, consent (EEA), policy-compliant ads
- [ ] Real traffic (WhatsApp/Telegram/X + local SEO)
- [ ] `ADSENSE_PUB` + `ADSENSE_SLOT` set
- [ ] Apply → wait 2–4 weeks

**Reality:** AdSense approval guarantee nahi hai. Indian news RPM roughly ₹15–60 / 1,000
pageviews; approval aur traffic ke bina earning zero.

---

## 13. Deploy / migrate commands

```powershell
cd "C:\Users\Admin\Documents\Default Project"
npx wrangler login

# Secrets (ek baar)
npx wrangler secret put GROQ_API_KEY
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put HUGGINGFACE_API_KEY
npx wrangler secret put COHERE_API_KEY
npx wrangler secret put PEXELS_API_KEY      # optional
npx wrangler secret put YOUTUBE_API_KEY     # optional

# DB (purana DB)
npx wrangler d1 execute virall-db --remote --file=migration_v4.sql

# Code
npx wrangler deploy

# Local checks
npm test
npm run check
```

**Fresh install:** `schema.sql` chalao, `migration_v4.sql` ki zaroorat nahi (tables already hain).

---

## 14. Failure behaviour (koi dead-end nahi)

| Failure | Kya hota hai |
|---|---|
| Trends provider down | Dusra provider parallel se answer deta hai |
| Research weak/foreign/stale | Topic `thin`, **0 token**, specific reason |
| Sources purane | Write click par pehle auto-refresh (max 2), fresh na mile to `thin` |
| Duplicate story | Topic `duplicate`, **0 token**, purana post link |
| 1 debate role fail | Baaki roles se ledger banta hai |
| Judge fail | Role claims se ledger (code verified) |
| Saare AI providers fail | Workers AI fallback; phir bhi fail to draft nahi, reason |
| Image fail | Branded SVG news-card (0 token) |
| Video key missing | Article image ke saath publish; YouTube search link |
| Editor fail | Draft save hota hai, `verified=false`, human review |
| D1 save fail | Saaf error, token laga/na laga batata hai |

---

## 15. Known limits (honest)

- Free AI tiers rate-limited hain; 3–5 articles/day realistic.
- Google indexing/ranking/AdSense approval ki **guarantee nahi**.
- Multi-AI debate quality badhata hai, par 100% truth guarantee nahi.
- AI detectors unreliable hain; goal reader ko useful content dena hai.
- Token budget aur provider availability deploy ke baad monitor karo (`/admin/api-status`).

---

## 16. Test coverage

- `npm test` → **288 pass, 0 fail** (73 suites, 18 files)
- `npm run check` → **22/22 modules load**

New tests: `claims`, `similarity`, `style`, `debate` (ledger, duplicate, human-style, safe roles,
provider rotation, judge fallback, timeouts, no-source/less-roles failures).
