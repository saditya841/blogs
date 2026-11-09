# Monetization — AdSense se paise kamane ka practical plan

Ye document sirf **owner ke liye** hai. Code me jo cheezein already ho chuki hain, jo owner ko
khud karni hain, aur realistic earning expectations — sab yahan hai.

---

## 0. Sabse pehle: honest reality check

AdSense approval **automatic nahi** hai aur AI-generated news sites par sabse zyada sawal
uthate hain. Google ki policies me "scaled content abuse" / "low-value content" ka matlab hai:
bahut si pages jo mainly kisi aur ka content re-write karti hain, bina original value ke.

Is site ka current model (Trends → research → AI draft → publish) **bilkul wahi shape** hai
jise Google dekh kar reject kar sakta hai. Isliye:

- **Har post human review ke baad hi publish karo.** Code me auto-publish default OFF hai —
  ise ON mat karo jab tak quality aur traffic dono stable na ho jayein.
- Har article me **original value** dalo: 2-3 line ka apna analysis, "iska matlab kya hai",
  local angle, timeline, ya comparison table. Sirf press release ko dobara mat likho.
- **Sources + correction policy + real contact** already hain — inhe aur visible rakho.
- Agar 30-40 achhe posts ke baad bhi reject ho, to 2-3 mahine content quality par kaam karo,
  phir apply karo. Baar-baar apply karne se fayda nahi.

**Earning ka math (rough):** Indian news traffic par AdSense RPM aksar ₹15-60 per 1,000
pageviews hota hai (niche, device, season par depend). Yani:

| Pageviews / month | Rough earning @ ₹30 RPM |
|---|---|
| 10,000 | ₹300 |
| 50,000 | ₹1,500 |
| 1,00,000 | ₹3,000 |
| 5,00,000 | ₹15,000 |

Ye guarantee nahi hai — sirf expectation set karne ke liye. Pehle 3-6 mahine ka target
**traffic** hona chahiye, paisa nahi. 100 posts likhne se pehle 20 posts ko best banane par
zyada return milega.

---

## 1. Code me kya already ready hai

- [x] AdSense script + ad units (`ADSENSE_PUB`, `ADSENSE_SLOT`, `ADSENSE_SLOT_BOTTOM`)
- [x] `ads.txt` route (pub ID set karte hi sahi line serve hoti hai)
- [x] In-article ad (2nd paragraph ke baad) + article-end ad, sirf 600+ word posts par
- [x] Mobile-first, fast, no popups / no intrusive ads
- [x] Privacy Policy me Google AdSense cookies + opt-out links
- [x] About / Editorial Policy / Contact / Terms / Disclaimer pages
- [x] Sources list har article me + "AI ki madad se taiyar" disclosure
- [x] Canonical, OG/Twitter tags, NewsArticle JSON-LD, sitemap, RSS, robots.txt
- [x] IndexNow (Bing/Yandex instant indexing)
- [x] Human review queue + strict publish checklist (`validate.js`)
- [x] YMYL (paisa/sehat ki salah) auto-block, junk/unsafe topics filter
- [x] Image safety: ambiguous topics par galat stock photo nahi, AI illustration
- [x] Readable Hindi slugs (pehle `post-0lz57` jaisa tha)

---

## 2. AdSense apply karne se pehle — owner checklist

### Site par

- [ ] **Domain live + HTTPS** (virall.in already Cloudflare par hai)
- [ ] **20-30 quality posts** live (600-900 words, 3+ sources, images, apna analysis)
- [ ] Homepage par clear navigation + categories
- [ ] About page par **real editor/owner** ki info (naam, kaam, contact) — "Virall Desk"
      ke saath ek real naam add karna better hai
- [ ] Editorial Policy me AI use + fact-check process saaf likha ho (already hai)
- [ ] Contact page par working email
- [ ] Privacy Policy me AdSense/cookies disclosure (already hai)
- [ ] Koi copyrighted image bina credit ke nahi
- [ ] Koi adult/betting/crypto-scam/medical-claim content nahi
- [ ] Site mobile par theek chale
- [ ] `https://virall.in/sitemap.xml` aur `/feed.xml` khulte hain
- [ ] `https://virall.in/robots.txt` me sitemap line hai
- [ ] Google Search Console verified + sitemap submitted (Section 5)

### AdSense account

- [ ] https://adsense.google.com par account banao (18+, ek hi account)
- [ ] "Sites" → apna domain add karo
- [ ] Ownership verify karo — code me `ADSENSE_PUB` set karne par meta tag
      `google-adsense-account` automatically lag jaata hai, ya DNS/HTML method use karo
- [ ] `ADSENSE_PUB` me **`ca-` ke bina** `pub-...` value dalo
      (galat: `ca-pub-123...`, sahi: `pub-123...`)
- [ ] Ad units banao: ek "In-article" (slot → `ADSENSE_SLOT`) aur ek "Display"
      (slot → `ADSENSE_SLOT_BOTTOM`, optional)
- [ ] Deploy ke baad `https://virall.in/ads.txt` par
      `google.com, pub-..., DIRECT, f08c47fec0942fa0` dikhna chahiye
- [ ] Review ke liye submit karo; approval me 2 din se 4 hafte lag sakte hain

> **Note:** Approval se pehle bhi ads code laga sakte ho, par ads tab tak blank rahenge.
> Better hai pehle content + GSC, phir apply.

---

## 3. AdSense rules jo todne se ban ho sakta hai

- Apne ads par **khud click** mat karo (ya dost/family se karwao).
- **Paid/bot traffic** mat kharido; "traffic exchange" bhi invalid hai.
- Ad ko content ke upar/cover mat karo; users ko click ke liye force mat karo.
- "Click here to support us" jaisi wording mat likho.
- Ek page par bahut saare ads mat thoos do — current 2 units kaafi hain.
- Copyrighted images/music/video bina license ke mat lagao.
- Misleading headline (clickbait) se traffic laakar ad dikhana policy risk hai.
- AI content ko "100% human written" mat bolo. Disclosure already hai — rakho.

---

## 4. Agar AdSense reject ho jaye (ya jaldi paisa chahiye)

Pehle **reason** padho (AdSense email me likha hota hai): content, navigation, policy,
ownership, ya invalid traffic. Usi ko fix karo, phir reapply.

Tab tak ye free/low-risk alternatives hain (par quality ka dhyan rakho):

| Network | Kya chahiye | Note |
|---|---|---|
| **Adsterra** | Koi minimum nahi | Approval aasan, RPM kam; popunder/redirect ads se bachna — SEO/trust kharab hota hai |
| **Monetag** | Koi minimum nahi | Similar; popups avoid karo |
| **PropellerAds** | Koi minimum nahi | Low quality; AdSense ke liye future me problem ban sakta hai |
| **Ezoic** | ~10k monthly sessions (roughly) | Better UX, par setup + consent complexity |
| **Mediavine / Raptive** | 50k sessions / 100k pageviews (roughly) | Bade traffic par; abhi door hai |
| **Affiliate (Amazon etc.)** | Content + disclosure | News site par natural fit kam; "best products" type posts chahiye |

**Salah:** AdSense reject hone par pehle 30 din content/quality par kaam karo. Adsterra/Monetag
sirf temporary bridge ki tarah use karo, aur popunder/redirect bilkul band rakho — warna
AdSense dobara reject hone ka risk badh jata hai.

---

## 5. Google Search Console + indexing (free, zaroori)

1. https://search.google.com/search-console par **Domain** property add karo (DNS verify).
2. **Sitemaps** → `https://virall.in/sitemap.xml` submit karo.
3. **URL Inspection** se top 10-20 posts ko "Request indexing" karo.
4. 1-2 hafte baad **Performance** dekho: kaunse queries par impressions aa rahe hain.
   Jo post impressions le raha hai par CTR kam hai, uska title/description improve karo.
5. **Core Web Vitals** check karo (Cloudflare + ye code already fast hai).
6. Bing Webmaster Tools bhi add karo — IndexNow already kaam karta hai.

Traffic analytics ke liye **Cloudflare Web Analytics** use karo (free, cookieless) — GA4 se
consent/cookie complications kam. AdSense ke apne reports alag honge.

---

## 6. 30-day content + traffic plan

**Target:** 30-40 strong posts, 3-4 hafte me. Roz 1-2, par quality fix pehle.

### Week 1 — purana content theek karo
- Live 11 posts padho. Jo galat image, weak title, ya sirf press-release summary hain —
  unhe edit karo ya delete karo.
- Har post me 2-3 line ka **"Iska matlab kya hai"** section add karo.
- Purane `post-xxxxx` type URLs ko naye readable slug par redirect karo (agar possible ho;
  warna naye posts par focus).
- Categories clean karo: 6-8 hi rakho.

### Week 2 — 10 original explainers
- Trends ke top topics chuno, par sirf wahi jinke 3+ achhe sources hon.
- Har post: 600-900 words, 3+ sources, 1 image, 2+ internal links, clear headings.
- Paisa/sehat/crime/sex jaise YMYL topics **manual** likho ya skip karo.
- Har post ke end me source list + correction link.

### Week 3 — 10 aur + Discover-ready
- 1200x675 image (AI illustration ya licensed photo), fresh publish time.
- Headline me curiosity + specific number/place; clickbait nahi.
- Har post ko WhatsApp/Telegram/X par share karo; apna channel banao.
- Google Discover ke liye `max-image-preview:large` already set hai.

### Week 4 — apply + measure
- GSC me indexing check karo; jo pages index nahi hue unhe inspect karo.
- AdSense apply karo (agar 20+ solid posts hain).
- Cloudflare Analytics me top pages dekho; jo chal rahe hain unke similar 5 aur banao.
- AdSense approval ke baad `ADSENSE_PUB` + slots set karo, deploy, `ads.txt` verify.

### Ongoing (daily 30 min)
- 1 post publish ya 1 purana post improve.
- 1 social share.
- GSC me naye queries dekhna.
- Comment/email/correction ka jawab dena.

---

## 7. Kya measure karna hai

| Metric | Kahan | Target (first 90 days) |
|---|---|---|
| Indexed pages | GSC → Coverage | 80%+ of published |
| Impressions | GSC → Performance | Month 2 me growth |
| CTR | GSC | 2-5% (title quality) |
| Pageviews | Cloudflare Analytics | 10k/month se start |
| Ad RPM | AdSense | ₹15-60 (India news, rough) |
| Approval status | AdSense | Applied within 30-45 days |

---

## 8. EEA/UK traffic ho to

Agar Europe/UK se traffic aata hai, Google **certified CMP** (consent management platform)
mangta hai personalized ads ke liye. Abhi code me CMP nahi hai. Options:
- EEA traffic ignore karo (India-focused raho), ya
- Google-certified CMP (jaise Google's own consent message) AdSense ke andar se enable karo.

India-focused site ke liye ye urgent nahi, par AdSense account me "Privacy & messaging"
section check karte rehna.

---

## 9. Final checklist (copy-paste)

```
[ ] 20-30 quality posts live (600+ words, 3+ sources, image, original analysis)
[ ] Real editor/owner info on About
[ ] Contact email working
[ ] Privacy + Editorial Policy + Terms + Disclaimer live
[ ] GSC verified + sitemap submitted
[ ] robots.txt + sitemap.xml + feed.xml OK
[ ] Mobile check OK
[ ] No copyrighted images without credit/license
[ ] No YMYL auto-generated content
[ ] AdSense account created + site added + ownership verified
[ ] ADSENSE_PUB = pub-... (no "ca-")
[ ] ADSENSE_SLOT (+ bottom) set
[ ] ads.txt shows google.com, pub-..., DIRECT, f08c47fec0942fa0
[ ] Auto-publish switch OFF
[ ] Never click own ads / never buy traffic
```
