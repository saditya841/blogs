# Virall — Architecture (A + B + C)

Ye document batata hai ki Virall kaise kaam karta hai: business/news topics → research → 0-token pre-read →
multi-AI debate + cross-check → claim ledger (code verified) → human-style article (business mode me framework +
counterpoint + playbook) → duplicate/style/originality/voice/business-depth check → SEO → DRAFT → human edit +
3-fact check → live → corrections. Sab kuch **Cloudflare free tier** par chalta hai.

Aakhri update: 11 Nov 2026 | Code: `src/*.js` | DB: D1 `virall-db` | Deploy: Cloudflare Workers

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
│ 7b. QUALITY LAYERS (0 token)                                             │
│    originality.js → 6-word runs vs sources (copied share)               │
│    specificity.js → naam/number/tareekh per 100 words                    │
│    voice.js       → last 10 approved posts se rhythm drift               │
│    conflicts.js   → do outlets ke alag numbers = claim `conflict`        │
│    → total penalty cap 20; check_json me scores + `unconfirmed` list      │
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
│ 10. HUMAN CHECK + APPROVAL                                               │
│     /admin/post/<id> → claims + quality scores + unconfirmed + sources   │
│     body edit (200+ chars) ya 30+ char note + "3 facts mile" checkbox    │
│     → source recheck (404/410/451) → publish → facts registry + history  │
│     Auto-publish bhi human_edited_at ke bina nahi chalta.                │
│     Live post par `Update (date)` corrections line + /corrections page.  │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Module map

| File | Kaam | Network/AI? |
|---|---|---|
| `src/index.js` | Public site, SEO pages, sitemap/RSS, admin UI + routes | D1 |
| `src/trends.js` | Trends ×2 + News parallel, junk filter, business topic collection, research one topic | Yes (free, no AI) |
| `src/business.js` | Business topic bank, hot-traffic query list, 13 frameworks, operator prompt, depth gate, derived arithmetic | No |
| `src/deepen.js` | Existing Business draft ka 0-token gap report + fresh-source deepening (write → re-fact-check → gate) | AI (manual) |
| `src/autodraft.js` | Hourly auto-draft safety rails: approval-queue cap, auto-reject low-quality business drafts | No |
| `src/preread.js` | 0-token reading brief: language, relevance, facts, allowed numbers, gaps | No |
| `src/facts.js` | 2+ outlet agreed facts, date/number keys | No |
| `src/verify.js` | injection check, shingles, grounded claims, numbers/names not in sources | No |
| `src/debate.js` | 3 neutral AI roles + judge, provider rotation, timeouts | AI |
| `src/claims.js` | Claim ledger: parse, evidence match, outlet count, verified/single-source/unsupported/conflict | No |
| `src/conflicts.js` | Same fact ke do alag numbers (outlet vs outlet) pakadta hai | No |
| `src/originality.js` | 6-word runs se originality score (sources se kitna alag likha) | No |
| `src/specificity.js` | 100 shabd par naam/number/tareekh (thos reporting vs filler) | No |
| `src/voice.js` | Last 10 approved posts ka voice profile + naye draft ka drift | No |
| `src/factregistry.js` | Verified facts + outlets + last_verified, stale-fact detection | D1 |
| `src/corrections.js` | Public corrections + dated Update line | D1 |
| `src/sourcecheck.js` | Approve se pehle source link liveness (404/410/451 dead) | Yes (free) |
| `src/writer.js` | Duplicate gate → debate → draft → copy check → editor → style/originality/specificity/voice → image → SEO → D1 | AI |
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

## 6b. Quality layers + human gate + corrections (0 token)

Style guard ke baad writer teen aur **pure-code** layers chalata hai. Sabka penalty ek hi
`qualityPenalty` me judta hai, par **total cap 20 points** hai — isliye ek layer doosri ko
chhupa nahi sakti.

| Layer | File | Kya pakadta hai | Penalty |
|---|---|---|---|
| Originality | `originality.js` | Sources ke saath 6-word runs; copied share `ORIGINALITY_TARGET` (0.85) se kam | 0–8 |
| Specificity | `specificity.js` | 100 shabd par naam/number/tareekh; 3 se kam (vague) ya 10 se zyada (press-release list) | 0–6 |
| Voice | `voice.js` | Last 10 approved posts ka sentence rhythm; naye draft ka drift | 0–6 |
| Style | `style.js` | AI phrases + flat rhythm (upar section 6) | 0–15 |

Scores `check_json` me save hote hain: `originality`, `specificity`, `voice`, `quality`.
Specificity aur originality me sirf **counts** jate hain (numbers/names ki list), isliye review
page par admin ko wahi cheezein dikhti hain jo code ne gini.

### Conflicts (do outlet, do sach)

Agar ek hi fact ke do alag numbers/units milte hain (`1200 crore` vs `2100 crore`), to claim
`conflict` banta hai — **na verified, na unsupported**. Writer ko prompt me bola jata hai:
"reports differ" likho ya number chhodo. Post review page par `unconfirmed` box me dono outlets
ka version dikhta hai. Ye AdSense ki "misleading content" policy ka sabse bada bachav hai.

### Human gate (`REQUIRE_HUMAN_EDIT=true`)

Draft publish karne ke liye admin ko **do me se ek** karna hoga:

1. Body me 200+ akshar ka real change (typo fix count nahi hota), **ya**
2. 30+ akshar ka check-note ("3 facts Outlook/Bhaskar se mile").

Saath me checkbox: *"maine 3 random facts sources se mila liye"*. Tab `human_edited_at` set hota
hai aur usi click par publish hota hai. `auto_publish` bhi `human_edited_at` ke bina nahi chalta.
`force` se bypass sirf debugging ke liye hai.

### Source recheck

Publish se pehle `sourcecheck.js` top 3 source links kholta hai (3s timeout). `404/410/451` = dead;
2+ dead links publish rok dete hain. `403`/timeout = `unknown` — article unfairly block nahi hota,
par review page par "verify manually" dikhta hai.

### Fact registry + corrections

- `facts` / `fact_sources` / `post_facts` me code-verified facts + outlets + `last_verified` save hote hain.
- `FACT_MAX_AGE_HOURS` (24) se purane facts review page par "re-check pending" warning dete hain;
  **Facts aaj verify kiye** click timestamp update karta hai (0 token).
- `corrections` table public history rakhta hai. Admin review page se correction darj karta hai;
  article ke neeche dated `Update (YYYY-MM-DD)` line judti hai aur `/corrections` par sab dikhta hai.
- `/author` par desk identity, `/news-sitemap.xml` par last 48h posts.

---

## 6c. Business mode (default direction)

`BUSINESS_MODE=true` ek **additive branch** hai — news pipeline code delete nahi hui. Business branch
tab chalti hai jab env switch ON ho ya topic ke `research.mode === "business"` ho.

### Topics (0 token)

`business.js` me ~48 evergreen, India-first queries ka `BUSINESS_TOPIC_BANK` hai (DMart, Zerodha, Amul,
quick commerce, kirana economics, MSME cash flow, SaaS pricing, etc.). Har entry me `angle` + `framework`.
Inme se 20 sabse zyada search-hone wale sawaal `BUSINESS_HOT_QUERIES` me alag list hain (DMart low-margin
model, Zerodha revenue, dark-store economics, restaurant failure reasons, D2C CAC/LTV, UPI economics...).

`trends.js::collectBusinessTopics` teen jagah se topics laata hai, isi order me:

1. **High-traffic evergreen queries** (`hotBusinessTopics`, din ke hisaab se rotate) — ek slot fresh news
   ke liye bacha rehta hai. Har row par `heat: "high"` aur `why` set hota hai.
2. Google Business News RSS (ek fresh headline).
3. Topic bank ka baaki hissa, din ke hisaab se rotate (same topic baar-baar nahi).

`BUSINESS_TOPIC_LIMIT` (3) + `DAILY_TOPIC_LIMIT` room ka rule lagta hai; `INSERT OR IGNORE` duplicate
query ko rokta hai. Research me news providers ke saath **Wikipedia background** source judta hai
(context ke liye; koi number isi se "verified" nahi hota). Wikipedia-only source set reject hota hai.

### Writing contract

`businessMessages()` AI ko operator ki tarah sochna sikhata hai (first principles, inversion, base rates,
incentives, second-order effects, margin of safety, constraint). Required structure (10 sections,
1200–1600 words):

```
## The setup (plain language, headline-only reader ke liye)
→ ## The money engine
→ ## Framework: <named>
→ ## Worked example (sourced case, ya clearly labelled illustrative numbers)
→ ## The counterpoint
→ ## Operator playbook
→ ## What could go wrong
→ ## What the result shows (ya honest "result abhi known nahi")
→ ## What is not confirmed
→ ## Analysis
```

Rules prompt me + code me:

- har number/naam/date source ya code-checked ledger me hona chahiye,
- calculation sirf `A / B = C` form me, inputs sourced aur arithmetic sahi,
- estimate ko "estimate" likhna, illustrative example ko fact nahi banana,
- jargon pehli baar use karne se pehle ek line me explain karna,
- guarantee / risk-free / get-rich / stock tip / target price / multibagger = **hard block**.

### Code gate (`businessGate`)

0-token check: words (default 1200, 80% hard floor), 8–10 headings, 3+ numbers, named framework,
worked example, result/outcome, counterpoint, playbook, risks, honesty section, plain-language setup,
India context, generic-AI phrases. Score 100 se shuru, har missing layer par -7; `guarantee` -30,
`stock_tip` -25. `ok` ke liye score 70+, hard-fail nahi, words floor, 7+ headings, aur **example +
result dono** zaroori — sirf headings ka hona kaafi nahi.

`derivedNumbers()` article ke `A / B = C` patterns ko sources ke numbers se match karta hai; sirf tab
result allow hota hai jab inputs sources me hon aur arithmetic 2% tolerance ke andar sahi ho.

### `check_json.business`

```json
{
  "ok": true, "score": 86, "words": 1342, "headings": 10, "numbers": 9,
  "framework": true, "example": true, "result": true, "plain": true,
  "counterpoint": true, "playbook": true, "risks": true,
  "honesty": true, "india": true,
  "errors": [], "warnings": []
}
```

Business posts `validate.js` me extra rules paate hain: guarantee/stock-tip errors publish block karte
hain; shallow depth warning hai (human fix kar sakta hai); `strict` auto-publish me depth fail block hai.
Public article page par hamesha "Business analysis, not investment advice" box dikhta hai.

### Existing post ko deepen karna (`deepen.js`)

Purane/thin Business **draft** ko sudharne ke liye manual admin action:

1. `gapReport(post)` — 0 token: words, headings, aur `check_json.business` ke flags dekhkar missing
   detail list karta hai (framework, example, result, counterpoint, playbook, risks, honesty, India).
2. `collectSources(title)` — wahi research providers se fresh sources.
3. `businessMessages(..., existingBody)` — wahi story expand hoti hai, naya topic nahi banta.
4. `factCheck` dobara chalta hai, phir `businessGate` + `copyCheck` + `ungroundedNumbers`.
5. Sab pass ho to hi body save hoti hai; warna post chhoti rehti hai aur reason admin ko dikhta hai.

Sirf `status='draft'` par chalta hai (live/approved post ko pehle "Back to draft" karna padta hai).
Review page aur `/admin/business` dono par gap report + Deepen button dikhta hai.

### Limits

- `BUSINESS_DAILY_LIMIT=3` (hard cap), `BUSINESS_MIN_WORDS=1200`, `BUSINESS_TOPIC_LIMIT=3`.
- `BUSINESS_LANG` default `en`; admin per draft EN ya HI chun sakta hai. Research language alag hoti hai.
- Human approval abhi bhi mandatory hai. Auto-publish default me off (`SCORE_MAX=94 < 95`).

### Auto-draft (hourly cron, human approve)

Cron trigger pehle se `0 * * * *` hai. `auto_write=1` hone par `scheduled()` har ghante ek draft try karta hai,
lekin `autodraft.js` do hard rails lagata hai:

1. `posts WHERE status='draft'` ki ginti `AUTO_DRAFT_QUEUE_MAX` (6) se kam honi chahiye, warna AI call hi nahi hoti.
2. Draft banne ke baad `businessOk` false ya `score < AUTO_DRAFT_MIN_SCORE` (60) ho to post `rejected` ho jata hai.

Isliye "har ghante" ka matlab 24 posts/day nahi — max `BUSINESS_DAILY_LIMIT` (3) quality drafts/day, aur
review queue kabhi 6 se zyada nahi hoti. Auto-publish ON karne ki zaroorat nahi; human gate chalu rehta hai.

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
| Business writer draft | 5,000–8,000 |
| Editor + factual claims | 5,000–8,000 |
| Rewrite retry (kabhi-kabhi) | 5,000–8,000 |
| **Business total typical** | **~20,000–35,000** |
| **News total typical** | **~40,000–55,000** |

Business mode me `BUSINESS_DAILY_LIMIT=3` hai — free keys par realistically **2–3 deep articles/day**,
10 nahi. News mode (`BUSINESS_MODE=false`) me `DAILY_POST_LIMIT=5` rehta hai. `DEBATE_ENABLED=false`
karke token bacha sakte ho, par quality gate kam ho jayega.

**Koi artificial wait/sleep nahi:** network calls ke hard deadlines hain (research 10s, article text
6s, debate 45s), timeout par kaam aage badhta hai — page hang nahi hota.

---

## 8. Admin click map (har click = ek result)

| Button | Kya hota hai | Token |
|---|---|---|
| **Auto-draft ON** (dashboard) | Har ghante cron try karta hai; max 3/day, queue 6 par rukti hai, low score auto-reject | AI |
| **Naye business topics lao** (Business page) | Google Business News + rotated topic bank; duplicate-safe insert | 0 |
| **Write English / Write Hindi** (Business page, topic page) | Business prompt → debate → draft → depth gate → image → DRAFT | AI |
| **Abhi trends + research chalao** | Naye topics + ek pending topic research, phir us topic ka page | 0 |
| **Agla pending topic research karo** | 1 topic; pending na ho to purana `thin`, phir stale `ready` refresh | 0 |
| **Card banao** | Us topic ka page kholta hai (card button wahan) | 0 |
| **Ready topic se ek draft likho** | Duplicate gate → debate → draft → image → SEO | AI |
| **Research dobara chalao** (topic page) | Us topic ke fresh sources + brief | 0 |
| **Multi-AI debate chalao** (topic page) | 3 roles + judge + code ledger preview | AI |
| **Approve: iska article likho** | Wahi debate reuse (2h), phir draft | AI |
| **Card post banao** | Chhota AI call, `/card/<id>` par turant live | AI |
| **Human-check ke saath approve + publish** (post page) | Body edit/note + 3-fact checkbox + source recheck + publish | 0 |
| **Sources dobara check karo** (post page) | Top 3 links ki liveness + timestamp | 0 |
| **Facts aaj verify kiye** (post page) | Registry timestamp update, stale warning hat jati hai | 0 |
| **Correction darj karo** (post page) | `corrections` row + public Update line | 0 |
| **Approve + publish** (force) | Human gate bypass — sirf debugging ke liye | 0 |

Failure par message me saaf likha hota hai: **`Token kharch nahi hua`** ya **`Token laga`**.

---

## 9. Database (D1)

### Core tables

```sql
posts(id, slug, title, summary, body, category, tags, lang, image_url, image_credit, video_url,
      sources, score, word_count, pinged, check_json, status, publish_at, created_at, updated_at,
      featured_image, thumbnail_image, og_image, seo_score, meta_description, meta_keywords, schema_json,
      human_edited_at, human_edit_note)

topics(id, query, traffic, status, research, source_count, created_at, updated_at)
-- status: new | ready | thin | drafted | duplicate | rejected | card_live

images(id, mime, b64, created_at)                 -- /img/<id>.jpg|.svg
settings(k, v)                                    -- auto_write / auto_publish / last_write
post_fingerprints(post_id, simhash, title_simhash, title_hash, minhash, tokens, title, created_at)
facts(id, topic_id, text, status, first_seen, last_verified)
fact_sources(fact_id, source, url, date)
post_facts(post_id, fact_id)
corrections(id, post_id, old_text, new_text, reason, created_at)
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
  "originality": {"score": 0.94, "copied": 1, "total": 18, "penalty": 0},
  "specificity": {"score": 92, "penalty": 1, "per100": 4.6, "numbers": ["..."], "names": ["..."]},
  "voice": {"score": 100, "penalty": 0, "compared": true},
  "quality": {"penalty": 4, "style": 3, "originality": 0, "specificity": 1, "voice": 0},
  "unconfirmed": [{"kind": "conflict", "text": "project cost ...", "detail": "Outlook: 1200 crore, Bhaskar: 2100 crore"}],
  "source_check": {"at": 0, "checked": 3, "okCount": 3, "dead": [], "unknown": []},
  "duplicate": {"checked": true, "score": 0.41, "duplicate": false},
  "debate": {"ok": true, "stats": {"verified": 4, "singleSource": 2, "unsupported": 1, "conflict": 1}}
}
```

### `topics.research` (topic ke andar)

```json
{
  "sources": [{"source": "...", "url": "...", "date": 0, "text": "..."}],
  "brief": {"version": 1, "ok": true, "stats": {}, "facts": [], "gaps": [], "briefText": "..."},
  "dropped": [{"source": "...", "reason": "..."}],
  "debate": {"ok": true, "roles": [], "ledger": {"verified": [], "singleSource": [], "unsupported": [], "conflict": []}},
  "duplicate": {"score": 0.91, "exact": false, "against": {"id": 42, "title": "..."}}
}
```

> `post_fingerprints` aur `images` lazily bhi ban jate hain, par fresh install ke liye
> `schema.sql` aur purane DB ke liye `migration_v4.sql` + `migration_v5.sql` chalao.

---

## 10. Env vars (wrangler.toml + Secrets)

### Public vars

| Var | Default | Matlab |
|---|---|---|
| `SITE_URL` | `https://virall.in` | Canonical URL, schema, sitemap |
| `POST_LANG` | `eng` | `en`/`eng` = English, warna Hindi |
| `DAILY_TOPIC_LIMIT` | `10` | Ek din me max naye topics |
| `DAILY_POST_LIMIT` | `5` | Ek din me max drafts (news mode) |
| `BUSINESS_MODE` | `true` | Business pipeline on/off (false = news pipeline) |
| `BUSINESS_LANG` | `en` | Default business output language (`en`/`hi`) |
| `BUSINESS_DAILY_LIMIT` | `3` | Business mode ka hard daily draft cap |
| `BUSINESS_MIN_WORDS` | `1200` | Business article depth floor (80% hard fail) |
| `BUSINESS_TOPIC_LIMIT` | `3` | Ek run me naye business topics |
| `AUTO_DRAFT_QUEUE_MAX` | `6` | Auto-draft tabhi chalta hai jab isse kam drafts pending hon |
| `AUTO_DRAFT_MIN_SCORE` | `60` | Isse neeche wale auto-draft ko khud reject kar do |
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
| `REQUIRE_HUMAN_EDIT` | `true` | Insaan ke edit/note ke bina publish nahi |
| `FACT_REGISTRY` | `true` | Verified facts D1 me save + stale warning |
| `FACT_MAX_AGE_HOURS` | `24` | Fact re-check reminder window |
| `VOICE_PROFILE` | `true` | Site voice comparison on/off |
| `VOICE_PROFILE_LIMIT` | `10` | Profile ke liye approved posts |
| `SOURCE_RECHECK` | `true` | Approve se pehle link liveness |
| `SOURCE_RECHECK_MAX` | `3` | Kitne source links check |
| `SOURCE_RECHECK_TIMEOUT_MS` | `3000` | Per-link timeout |
| `ORIGINALITY_TARGET` | `0.85` | Minimum original-sentence share |
| `SPECIFICITY_LOW` / `SPECIFICITY_HIGH` | `3` / `10` | Details per 100 words range |
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
- **Human final approval:** draft review page par claims, quality scores, unconfirmed facts, image, video sab dikhta hai.
- **Human edit gate:** `REQUIRE_HUMAN_EDIT=true` par body edit/note + 3-fact checkbox ke bina publish nahi; auto-publish bhi `human_edited_at` maangta hai.
- **Conflict = no fake certainty:** do outlets ke alag numbers par claim `conflict` hota hai, writer "reports differ" likhta hai.
- **Corrections public:** har badlav dated `Update` line + `/corrections` par visible; trust signal aur AdSense policy dono ke liye.

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
npx wrangler d1 execute virall-db --remote --file=migration_v5.sql

# Code
npx wrangler deploy

# Local checks
npm test
npm run check
```

**Fresh install:** sirf `schema.sql` chalao — usme `posts.human_edited_at`, `human_edit_note` aur
`facts`/`fact_sources`/`post_facts`/`corrections` tables already hain, isliye `migration_v4.sql`/`migration_v5.sql`
ki zaroorat nahi. Purane DB par dono migrations chalao.

`migration_v5.sql` do columns (`posts.human_edited_at`, `posts.human_edit_note`) add karta hai.
D1 dobara chalane par "duplicate column" error de sakta hai — us case me wo statement skip karo,
baaki tables `IF NOT EXISTS` hain.

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
| Conflict mile | Claim `conflict`; article "reports differ" ke saath, review page par dono versions |
| Quality score low | Draft save hota hai + penalty notes; publish ke liye human edit phir bhi zaroori |
| Source link dead (2+) | Publish block, review page par kaun sa link mara hai |
| Source 403/timeout | `unknown` — block nahi, "manual verify" warning |
| Human edit missing | Publish button reason deta hai; `human_approve` form focus hota hai |
| Facts stale (24h+) | Warning + **Facts aaj verify kiye** (0 token) |
| Correction darj | Dated `Update` line + `/corrections` entry, purana text bhi rehta hai |
| D1 save fail | Saaf error, token laga/na laga batata hai |

---

## 15. Known limits (honest)

- Free AI tiers rate-limited hain; 3–5 articles/day realistic.
- Google indexing/ranking/AdSense approval ki **guarantee nahi**.
- Multi-AI debate quality badhata hai, par 100% truth guarantee nahi.
- AI detectors unreliable hain; goal reader ko useful content dena hai.
- **Human edit default me zaroori hai:** `REQUIRE_HUMAN_EDIT=true` par roz 20 auto-posts nahi nikal sakte;
  volume insaan ki capacity ke hisaab se rakho.
- Originality/specificity/voice heuristics hain, proof nahi — weird but genuine articles par false
  penalty aa sakti hai, isliye ye sirf score/notes dete hain, hard block nahi (human gate hard block hai).
- Source recheck user-agent/bot protection se `unknown` de sakta hai; dead links ka pakadna best-effort hai.
- Token budget aur provider availability deploy ke baad monitor karo (`/admin/api-status`).

---

## 16. Test coverage

- `npm test` → **354 pass, 0 fail** (89 suites, 22 files)
- `npm run check` → **32/32 modules load**

New tests: `claims`, `similarity`, `style`, `debate` (ledger, duplicate, human-style, safe roles,
provider rotation, judge fallback, timeouts, no-source/less-roles failures), `quality-layers`
(conflicts, originality, specificity, voice, fact registry, corrections, source liveness — in-memory
SQLite D1 adapter se, koi network nahi), `business` (topic bank rotation, hot-topic bank sync,
10-section prompt, depth gate, example/result requirement, guarantee/stock-tip block, derived
arithmetic, business preflight, Business publish rules), `deepen` (0-token gap report for thin posts
aur complete posts) aur `autodraft` (approval-queue cap, auto-reject on depth-gate/score fail,
broken env values).
