// business.js — ZERO-token business-content brain.
//
// Ye module news pipeline se alag hai: yahan "kya hua" se zyada "paisa kaise banta hai,
// model kahan tootta hai, aur ek operator ko Monday morning kya karna chahiye" matter karta hai.
//
// Design:
//  * topic bank + framework library (pure data, 0 token),
//  * a prompt that forces the AI to THINK like an operator before writing,
//  * a code gate that checks depth (numbers, framework, counterpoint, risks, honesty),
//  * a derived-number checker: article may show `1200 / 9 = 133` only if 1200 and 9 are
//    in the sources and the arithmetic is actually correct.
//
// AI kabhi `verified` set nahi karta. Code karta hai.

import { numbersIn, normNums } from './verify.js';

const lower = (s) => String(s || '').toLowerCase();

// ---------------------------------------------------------------------------
// 1. Topic bank (evergreen, high-intent, India-first)
// ---------------------------------------------------------------------------
// q = search query used for research. angle/framework guide the prompt, not the facts.
// High-traffic, high-intent business questions. These are evergreen searches ("how does X make
// money", "why do restaurants fail") that keep bringing readers long after a news cycle ends.
// Every query must also exist in BUSINESS_TOPIC_BANK so research/angle/framework stay consistent.
export const BUSINESS_HOT_QUERIES = [
  'DMart business model low margin high volume',
  'Zerodha business model revenue profit',
  'quick commerce dark store economics India',
  'Swiggy Zomato unit economics profitability',
  'kirana store economics India margin',
  'restaurant business failure rate India reasons',
  'D2C brand CAC LTV India profitability',
  'franchise business model India economics',
  'Amul cooperative business model farmers',
  'Ola Electric losses unit economics',
  'Paytm regulatory risk business model',
  'Apple services revenue business model',
  'Nvidia moat competition AI chips',
  'Reliance retail expansion economics',
  'Tata group acquisition strategy',
  'SaaS pricing India startup churn',
  'gym business model retention India',
  'cloud kitchen economics India',
  'cold storage business economics India',
  'UPI payments economics banks merchants'
];

// Rotate through the hot list so the same topic is not collected every day.
export function hotBusinessTopics({ limit = 8, offset = 0 } = {}) {
  const byQuery = new Map(BUSINESS_TOPIC_BANK.map((t) => [t.q.toLowerCase(), t]));
  const pool = BUSINESS_HOT_QUERIES.map((q) => byQuery.get(q.toLowerCase()) || { q, angle: 'model', framework: 'unit-economics' });
  const n = pool.length || 1;
  const start = (((Number(offset) || 0) % n) + n) % n;
  const out = [];
  for (let i = 0; i < n && out.length < Math.max(1, Number(limit) || 8); i++) {
    out.push(pool[(start + i) % n]);
  }
  return out;
}

export const BUSINESS_TOPIC_BANK = [
  { q: 'DMart business model low margin high volume', angle: 'model', framework: 'unit-economics' },
  { q: 'Zerodha business model revenue profit', angle: 'model', framework: 'unit-economics' },
  { q: 'Amul cooperative business model farmers', angle: 'model', framework: 'flywheel' },
  { q: 'Costco membership model profit margin', angle: 'model', framework: 'flywheel' },
  { q: 'Amazon flywheel business model explained', angle: 'model', framework: 'flywheel' },
  { q: 'IKEA flat pack supply chain business model', angle: 'operations', framework: 'lean' },
  { q: 'Toyota production system lean manufacturing waste', angle: 'operations', framework: 'lean' },
  { q: 'Swiggy Zomato unit economics profitability', angle: 'unit-economics', framework: 'unit-economics' },
  { q: 'quick commerce dark store economics India', angle: 'unit-economics', framework: 'unit-economics' },
  { q: 'Nykaa marketing spend unit economics', angle: 'unit-economics', framework: 'unit-economics' },
  { q: 'D2C brand CAC LTV India profitability', angle: 'unit-economics', framework: 'unit-economics' },
  { q: 'kirana store economics India margin', angle: 'unit-economics', framework: 'break-even' },
  { q: 'restaurant business failure rate India reasons', angle: 'failure', framework: 'inversion' },
  { q: "Byju's collapse lessons business model", angle: 'failure', framework: 'inversion' },
  { q: 'Ola Electric losses unit economics', angle: 'failure', framework: 'unit-economics' },
  { q: 'Paytm regulatory risk business model', angle: 'regulation', framework: 'porter' },
  { q: 'Air India turnaround strategy losses', angle: 'case-study', framework: 'inversion' },
  { q: 'Maruti Suzuki supplier network advantage', angle: 'moat', framework: 'moat' },
  { q: 'FMCG distribution moat India', angle: 'moat', framework: 'moat' },
  { q: 'paint industry distribution moat India', angle: 'moat', framework: 'moat' },
  { q: 'cement industry cyclicality India economics', angle: 'model', framework: 'second-order' },
  { q: 'telecom ARPU economics India', angle: 'unit-economics', framework: 'unit-economics' },
  { q: 'UPI payments economics banks merchants', angle: 'model', framework: 'second-order' },
  { q: 'credit card economics India rewards', angle: 'unit-economics', framework: 'unit-economics' },
  { q: 'insurance distribution economics India', angle: 'model', framework: 'unit-economics' },
  { q: 'mutual fund expense ratio business India', angle: 'model', framework: 'unit-economics' },
  { q: 'stock broker revenue model India', angle: 'model', framework: 'unit-economics' },
  { q: 'real estate developer cash flow India', angle: 'cash', framework: 'cash' },
  { q: 'textile exporter working capital cycle India', angle: 'cash', framework: 'cash' },
  { q: 'MSME cash flow problems India', angle: 'cash', framework: 'cash' },
  { q: 'franchise business model India economics', angle: 'model', framework: 'break-even' },
  { q: 'gym business model retention India', angle: 'unit-economics', framework: 'unit-economics' },
  { q: 'coaching centre business model India', angle: 'model', framework: 'unit-economics' },
  { q: 'cloud kitchen economics India', angle: 'unit-economics', framework: 'unit-economics' },
  { q: 'EV charging business model India payback', angle: 'unit-economics', framework: 'break-even' },
  { q: 'solar rooftop payback India business', angle: 'unit-economics', framework: 'break-even' },
  { q: 'agri supply chain economics India', angle: 'model', framework: 'cash' },
  { q: 'cold storage business economics India', angle: 'unit-economics', framework: 'break-even' },
  { q: 'logistics cost per km India trucking', angle: 'operations', framework: 'unit-economics' },
  { q: 'SaaS pricing India startup churn', angle: 'pricing', framework: 'pricing' },
  { q: 'luxury brand pricing power economics', angle: 'pricing', framework: 'pricing' },
  { q: 'fast fashion supply chain business model', angle: 'operations', framework: 'lean' },
  { q: 'Apple services revenue business model', angle: 'model', framework: 'moat' },
  { q: 'Microsoft subscription transition business model', angle: 'case-study', framework: 'flywheel' },
  { q: 'Nvidia moat competition AI chips', angle: 'moat', framework: 'porter' },
  { q: 'OpenAI business model costs revenue', angle: 'model', framework: 'unit-economics' },
  { q: 'Reliance retail expansion economics', angle: 'model', framework: 'unit-economics' },
  { q: 'Tata group acquisition strategy', angle: 'case-study', framework: 'portfolio' },
];

export const BUSINESS_FRAMEWORKS = {
  'unit-economics': {
    name: 'Unit Economics',
    idea: 'Ek customer / ek order / ek store par kitna paisa aata hai, kitna jaata hai, aur payback kitne mahine me hota hai.',
    ask: 'CAC, contribution margin, LTV, payback period, aur kis volume par fixed cost cover hota hai.'
  },
  porter: {
    name: "Porter's Five Forces",
    idea: 'Industry ki profitability supplier power, buyer power, new entrants, substitutes aur rivalry se tay hoti hai.',
    ask: 'Kaun zyada bargaining power rakhta hai, entry barrier kya hai, substitute kya hai, aur rivalry kyun badh rahi hai.'
  },
  flywheel: {
    name: 'Flywheel / Network Effects',
    idea: 'Ek achha loop: zyada users -> better supply/price -> aur users. Har turn me value badhni chahiye.',
    ask: 'Loop ke steps kya hain, kahan friction hai, aur kya loop ulta bhi chal sakta hai?'
  },
  jtbd: {
    name: 'Jobs To Be Done',
    idea: 'Customer product nahi, ek kaam karwane ke liye kharidta hai. Functional + emotional + social job.',
    ask: 'Customer actually kya job karwana chahta hai, aur aaj wo kaam kaise kar raha hai?'
  },
  cash: {
    name: 'Cash Conversion Cycle',
    idea: 'Inventory, receivables aur payables ka cycle batata hai ki profit hone par bhi cash kyun phansa rehta hai.',
    ask: 'Cash kitne din ke liye phansta hai, working capital kahan jaata hai, aur cycle bigadne par kya hota hai?'
  },
  pricing: {
    name: 'Pricing Power',
    idea: 'Price badhane par customer kitna churn karta hai. Ye brand, switching cost aur alternatives par depend karta hai.',
    ask: 'Price elasticity kya hai, competitor sasta ho to kya hoga, aur value-based pricing kaise justify hogi?'
  },
  lean: {
    name: 'Lean / Theory of Constraints',
    idea: 'System ki speed uske sabse slow step se decide hoti hai. Waste hatao, bottleneck kholo.',
    ask: 'Real bottleneck kahan hai, kaunsa step waste hai, aur throughput badhane se cost kaise badlegi?'
  },
  inversion: {
    name: 'Inversion / Pre-mortem',
    idea: 'Safalta ka plan likhne se pehle likho ki ye kaise fail hoga. Phir un failure modes ko rokho.',
    ask: 'Do saal baad failure ka sabse likely reason kya hoga? Kaun sa early signal use pakdega?'
  },
  'base-rate': {
    name: 'Base Rates',
    idea: 'Is category ke kitne business survive karte hain? Apne case ko average se alag sabit karna padta hai.',
    ask: 'Same category me survival/failure rate kya hai, aur ye case us base rate se kyun alag hai?'
  },
  moat: {
    name: 'Moats / Switching Costs',
    idea: 'Profit ko competition se bachane wali cheez: brand, distribution, switching cost, network, scale, regulation.',
    ask: 'Moat kya hai, kitna durable hai, aur competitor use kitne paise/time me tod sakta hai?'
  },
  'break-even': {
    name: 'Break-even Math',
    idea: 'Fixed cost / contribution per unit = kitne units par loss khatam. Iske pehle har mahina cash jal raha hai.',
    ask: 'Break-even kitne customers/orders/mahine par hai, aur monthly fixed cost kitna hai?'
  },
  'second-order': {
    name: 'Second-order Thinking',
    idea: 'Pehla effect sabko dikhta hai. Doosra effect wahi hota hai jo baad me market ka shape badal deta hai.',
    ask: 'Sab log ye model copy karenge to kya hoga? Incentive kis ka badal jayega?'
  },
  portfolio: {
    name: 'Portfolio / Capital Allocation',
    idea: 'Har business cash nahi banata. Kuch cash banate hain, kuch cash khate hain. Capital allocation hi strategy hai.',
    ask: 'Kaun cash generate karta hai, kaun cash khata hai, aur capital kahan reinvest ho raha hai?'
  }
};

// Thinking patterns of good operators (not quotes, just methods).
export const BUSINESS_THINKING = [
  ['First principles', 'Bhasha aur buzzwords hatao. Who pays whom, kitna, kyun, aur kya alternative hai?'],
  ['Inversion', 'Pehle likho ki ye business kaise fail hoga. Phir us failure ko rokne wala evidence dhoondo.'],
  ['Base rates', 'Is category me zyadatar log fail kyun hote hain? Sirf exceptional case ko exceptional sabit karo.'],
  ['Incentives', 'Har source ka apna incentive hota hai. Promoter, broker, platform aur journalist kya chahte hain?'],
  ['Second-order effects', 'Agar model successful ho gaya to competitor, regulator aur customer kya karenge?'],
  ['Margin of safety', 'Agar revenue 30% gir jaye to kya business zinda rahega? Fixed cost kitna hai?'],
  ['Opportunity cost', 'Wahi paisa, wahi time kisi doosre business me lagane par kya milta?'],
  ['Constraint', 'Growth ka real bottleneck kya hai: demand, supply, cash, hiring, ya regulation?']
];

// Multi-AI review roles for business mode (neutral, no fake gurus).
export const BUSINESS_ROLES = [
  {
    id: 'strategist',
    name: 'Strategist',
    focus: 'Business model, moat, industry structure aur long-term incentives. Kaun paisa banata hai aur kyun?'
  },
  {
    id: 'operator',
    name: 'Operator',
    focus: 'Unit economics, cash flow, capacity, hiring aur daily execution. Kya ye Monday morning chalega?'
  },
  {
    id: 'skeptic',
    name: 'Skeptic',
    focus: 'Base rate, failure modes, missing data, contradictions aur survivorship bias. Sabse strong ulta argument.'
  }
];

// ---------------------------------------------------------------------------
// 2. Mode + angle helpers
// ---------------------------------------------------------------------------
export function parseResearch(topic) {
  if (!topic) return {};
  if (typeof topic.research === 'object' && topic.research) return topic.research;
  try { return JSON.parse(topic.research || '{}'); } catch { return {}; }
}

export function isBusinessMode(env, topic, research) {
  const r = research || parseResearch(topic);
  if (r && r.mode === 'business') return true;
  const v = String((env && env.BUSINESS_MODE) || '').trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'on' || v === 'yes';
}

const ANGLE_RE = [
  ['unit-economics', /\b(unit economics|cac|ltv|margin|payback|arpu|aov|churn|retention|cost per)\b/i],
  ['failure', /\b(fail|failure|collapse|loss|shutdown|downfall|lessons)\b/i],
  ['moat', /\b(moat|advantage|competition|competitor|switching|network effect|market share)\b/i],
  ['cash', /\b(cash ?flow|working capital|inventory|receivable|payable|debt|balance sheet)\b/i],
  ['pricing', /\b(pricing|price|premium|luxury|discount)\b/i],
  ['operations', /\b(supply chain|manufactur|logistics|warehouse|store|operations|lean)\b/i],
  ['regulation', /\b(regulation|regulator|policy|licen[cs]e|tax|gst|compliance)\b/i],
  ['model', /\b(business model|revenue model|how .* makes money|subscription|franchise|marketplace)\b/i]
];

export function businessAngle(query, research) {
  const r = research || {};
  if (r.angle) return r.angle;
  for (const [angle, re] of ANGLE_RE) if (re.test(String(query || ''))) return angle;
  return 'model';
}

export function frameworkFor(query, research) {
  const r = research || {};
  if (r.framework && BUSINESS_FRAMEWORKS[r.framework]) return r.framework;
  const q = lower(query);
  if (/unit economic|cac|ltv|margin|arpu|aov|churn|payback|profit/.test(q)) return 'unit-economics';
  if (/moat|brand|distribution|network|competition|market share/.test(q)) return 'moat';
  if (/cash|working capital|inventory|debt|receivable/.test(q)) return 'cash';
  if (/price|pricing|luxury|premium/.test(q)) return 'pricing';
  if (/supply|manufactur|logistics|store|operations|lean|factory/.test(q)) return 'lean';
  if (/fail|loss|collapse|shutdown|turnaround/.test(q)) return 'inversion';
  if (/regulat|policy|tax|licen[cs]e/.test(q)) return 'porter';
  if (/flywheel|amazon|network|platform|marketplace/.test(q)) return 'flywheel';
  return 'unit-economics';
}

export function businessSeeds({ limit = 6, offset = 0 } = {}) {
  const n = BUSINESS_TOPIC_BANK.length;
  const start = ((Number(offset) || 0) % n + n) % n;
  const out = [];
  for (let i = 0; i < n && out.length < Math.max(1, Number(limit) || 6); i++) {
    out.push(BUSINESS_TOPIC_BANK[(start + i) % n]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 3. Prompt (this is where "human + businessman thinking" is enforced)
// ---------------------------------------------------------------------------
const LANG_NAME = { en: 'English', hi: 'Hindi (Devanagari script)' };

export function businessMessages(env, opts = {}) {
  const lang = opts.lang === 'hi' ? 'hi' : 'en';
  const LANG = LANG_NAME[lang];
  const topic = String((opts.topic && (opts.topic.query || opts.topic.title)) || opts.query || '').trim();
  const research = opts.research || {};
  const angle = businessAngle(topic, research);
  const fwId = frameworkFor(topic, research);
  const fw = BUSINESS_FRAMEWORKS[fwId] || BUSINESS_FRAMEWORKS['unit-economics'];
  const sources = (opts.sources || []).slice(0, 6);
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const srcBlock = sources
    .map((s, i) => `[${i + 1}] ${s.title || hostOf(s.url) || 'source'}${hostOf(s.url) ? ' (' + hostOf(s.url) + ')' : ''}${s.date ? ' - ' + new Date(s.date * 1000).toISOString().slice(0, 10) : ''}\n${String(s.text || s.snippet || '').slice(0, 2200)}`)
    .join('\n\n');
  const briefBlock = opts.brief && opts.brief.briefText
    ? `READING BRIEF (already checked by code; trust its numbers):\n${String(opts.brief.briefText).slice(0, 2600)}\n\n`
    : '';
  const ledgerBlock = opts.ledgerBlock
    ? `CODE-CHECKED CLAIM LEDGER (only these facts are verified; use them as the spine):\n${String(opts.ledgerBlock).slice(0, 2600)}\n\n`
    : '';
  const today = new Date(Date.now() + 19800 * 1000).toISOString().slice(0, 10);

  const system =
    'You are a business writer for an Indian business publication. You have run a small business and analysed companies for 15 years. ' +
    'You write like an experienced operator explaining a hard idea to a smart friend: concrete, calm, specific, and honest about what you do not know. ' +
    'You are not a motivational speaker, a consultant, or a chatbot. No hype. No fake quotes. No guarantees.\n\n' +
    'THINK BEFORE YOU WRITE (do this silently, do not print your thinking):\n' +
    BUSINESS_THINKING.map(([name, how], i) => `${i + 1}. ${name}: ${how}`).join('\n') + '\n\n' +
    'HARD RULES:\n' +
    '- Every number, date, name and quote must appear in the SOURCES or in the CODE-CHECKED CLAIM LEDGER. Do not invent or recall from memory.\n' +
    '- You may show a calculation ONLY in the form `A / B = C` (or +, -) where A and B appear in the sources and the arithmetic is correct. Do not invent the result.\n' +
    '- If a number is your own estimate, write the word "estimate" next to it and show the sourced inputs. If you cannot show inputs, leave it out.\n' +
    '- If a fact is missing, write that it is not confirmed instead of filling the gap.\n' +
    '- Never write "guaranteed", "risk-free", "sure shot", "100% profit", "double your money" or any get-rich promise.\n' +
    '- Never give stock tips: no buy/sell recommendation, no target price, no multibagger call. Business analysis is fine, investment advice is not.\n' +
    '- Never put words in a real person\'s mouth. Quote only if the exact words are in the sources.\n' +
    '- The reader may have only seen a news headline. Explain the context and every technical term in plain language before you use it.\n' +
    '- Include one worked example and one result/outcome section. If the sources do not contain a real result, say the result is not known yet and explain what evidence would settle it.\n' +
    '- Do not copy 6 or more words in a row from any source. Rewrite in your own structure.\n' +
    '- No generic opening ("in today\'s fast-paced world", "as we all know"). Start with a specific number, decision, scene or question.\n' +
    '- No markdown bold, no bullet lists in the final body, no quotation marks. Headings only as lines starting with ##.\n\n' +
    'BUSINESS THINKING YOU MUST SHOW IN THE ARTICLE:\n' +
    '- who pays whom, and why the customer chooses this;\n' +
    '- the unit economics / cash engine, with sourced numbers where possible;\n' +
    '- a worked example with real numbers (sourced) or clearly labelled assumptions;\n' +
    '- the strongest counterargument (not a strawman);\n' +
    '- what would have to be true for this to work;\n' +
    '- what could go wrong, and the early signal that it is going wrong;\n' +
    '- what actually happened (result/outcome) and what it implies;\n' +
    '- what a small operator should test first, and what is still not confirmed.';

  const user =
    `DATE: ${today}\nTOPIC: ${topic}\nANGLE: ${angle}\nFRAMEWORK TO APPLY: ${fw.name}\nFRAMEWORK IDEA: ${fw.idea}\nASK YOURSELF: ${fw.ask}\nLANGUAGE: ${LANG}\n\n` +
    `${briefBlock}${ledgerBlock}SOURCES:\n${srcBlock}\n\n` +
    `Write a deep business article in ${LANG}. It must read like a real publication, not a listicle and not a press release.\n\n` +
    'STRUCTURE (use these headings, exactly as lines starting with ##):\n' +
    '1. ## The setup — in plain language: what happened, who is involved, why a reader should care, and the context a person who only saw a headline needs. Define every technical term in one line the first time you use it.\n' +
    '2. ## The money engine — who pays whom, revenue, costs, margins, cash. Use only sourced numbers.\n' +
    `3. ## Framework: ${fw.name} — apply the framework to this case, step by step. Explain it in plain language for a first-time reader.\n` +
    '4. ## Worked example — one concrete example. If the sources give a real case, use it and its numbers. If not, label it clearly as an illustrative example with simple assumptions, and do not present those assumptions as facts.\n' +
    '5. ## The counterpoint — the strongest argument against the article\'s main conclusion. Take it seriously.\n' +
    '6. ## Operator playbook — 3 to 5 concrete things a small business owner can test or check, in order. No vague advice.\n' +
    '7. ## What could go wrong — failure modes, risks, and the early warning signal for each.\n' +
    '8. ## What the result shows — what actually happened or what the sourced numbers imply. If the result is not known yet, say so and explain what would prove it.\n' +
    '9. ## What is not confirmed — missing data, single-source claims, estimates, and what evidence would change the conclusion.\n' +
    '10. ## Analysis — what this means, why it matters, and the one thing to remember. Do not repeat the intro.\n\n' +
    'LENGTH: 1200 to 1600 words. Each heading should have 2 to 4 short paragraphs. Vary sentence length. Use Indian examples and rupee/crore where the sources support it.\n\n' +
    'QUALITY BAR:\n' +
    '- The article must be understandable to a reader who has only seen news headlines, not a business textbook. Explain jargon, then use it.\n' +
    '- At least one worked example with numbers, and one clear result/outcome (or an honest "result not known yet").\n' +
    '- At least one contrarian insight that a careful reader would not get from the headlines.\n' +
    '- At least one line that names where the model breaks.\n' +
    '- At least one "what to check before you copy this" point.\n' +
    '- No sentence that could be pasted into any other business article. Be specific to this case.\n' +
    (opts.feedback ? `\nFIX THESE PROBLEMS FROM THE LAST ATTEMPT:\n${opts.feedback}\n` : '') +
    '\nReturn EXACTLY this format and nothing else:\n' +
    'TITLE: (35 to 90 characters, specific, no clickbait)\nSUMMARY: (110 to 155 characters)\nCATEGORY: Business\nTAGS: (5 comma separated tags)\nBODY:\n(article)';

  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

// ---------------------------------------------------------------------------
// 4. Code gate (0 token)
// ---------------------------------------------------------------------------
const RE = {
  framework: /\b(unit economics|cac|ltv|contribution margin|gross margin|net margin|cash ?flow|working capital|inventory (?:turn|turnover)|break[- ]even|payback|flywheel|network effect|moat|switching cost|five forces|porter|jobs to be done|jtbd|price elasticity|pricing power|fixed cost|variable cost|churn|retention|aov|arpu|roic|rule of 40|opportunity cost|margin of safety|second[- ]order|base rate|bottleneck|theory of constraints|capital allocation)\b|यूनिट इकॉनॉमिक्स|मार्जिन|नकदी|वर्किंग कैपिटल|ब्रेक ईवन|फ्लाईव्हील|मोट|चर्न|लागत|पूंजी/i,
  counter: /\b(counterpoint|on the other hand|however|but this breaks|the catch|downside|limitation|opposite view|contrarian|that said|there is a catch|doosri taraf|lekin|galat ho sakta|ulta|nuksan)\b|दूसरी तरफ|लेकिन|कमी|जोखिम|उलटा/i,
  playbook: /\b(playbook|action steps|what to do|monday morning|checklist|first step|next step|test first|kya karein|shuru karein|test karein|pehle kya)\b|क्या करें|शुरू करें|कदम|पहले क्या/i,
  risks: /\b(what could go wrong|risk|risks|downside|failure|fail|khatra|nuksan|galat ho sakta|fail ho sakta|warning sign|early signal)\b|जोखिम|क्या गलत|नुकसान|चेतावनी/i,
  honesty: /\b(not confirmed|unconfirmed|estimate|estimated|assumption|assume|data (?:is )?missing|verify|approx|roughly|our estimate|humara anuman|confirm nahi|anuman)\b|अनुमान|पुष्टि नहीं|आंकड़े नहीं|स्पष्ट नहीं/i,
  guarantee: /\b(guaranteed? (?:returns?|profits?|income|money|paisa)|risk[- ]free|sure shot|100% (?:profit|return)|double your money|get rich|pakka paisa|guaranteed return)\b|गारंटी\s*(?:वाला|वाली)?\s*(?:रिटर्न|मुनाफा|लाभ)|पक्का पैसा|निश्चित लाभ/i,
  stockTip: /\b(stock tip|buy (?:this|the) stock|target price|multibagger|sure shot stock|sell (?:this|the) stock)\b|शेयर टिप|टारगेट प्राइस/i,
  india: /\b(india|indian|inr|₹|rupee|crore|lakh|mumbai|delhi|bengaluru|bangalore|hyderabad|chennai|kolkata|pune|ahmedabad|odisha|bhubaneswar)\b|भारत|रुपये|करोड़|लाख/i,
  generic: /\b(in today's fast[- ]paced world|as we all know|in conclusion|it is important to note|game[- ]changer|delve into|the landscape of)\b|आज के दौर में|जैसा कि हम सब जानते/i
};

const countWords = (s) => String(s || '').split(/\s+/).filter(Boolean).length;
const headingsOf = (s) => [...String(s || '').matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim());

export function businessGate(article = {}, opts = {}) {
  const body = String(article.body || '');
  const full = `${article.title || ''}\n${article.summary || ''}\n${body}`;
  const words = countWords(body);
  const minWords = Math.max(300, Number(opts.minWords) || 900);
  const headings = headingsOf(body);
  const nums = [...new Set(numbersIn(full))].filter((n) => n.length >= 2 || n.includes('.'));
  const checks = {
    words,
    minWords,
    headings: headings.length,
    numbers: nums.length,
    hasFramework: RE.framework.test(body),
    hasCounter: RE.counter.test(body),
    hasPlaybook: RE.playbook.test(body),
    hasRisks: RE.risks.test(body),
    hasHonesty: RE.honesty.test(body),
    hasIndia: RE.india.test(body),
    hasExample: headings.some((h) => /^(worked example|example|illustration|उदाहरण|मिसाल)\b/i.test(h)),
    hasResult: headings.some((h) => /^(what the result shows|result|outcome|नतीजा|परिणाम)\b/i.test(h)),
    hasPlain: headings.some((h) => /plain language|simple language|आसान भाषा|सरल भाषा/i.test(h)) || /plain language/i.test(body),
    hasAnalysis: /^##\s*(?:analysis|विश्लेषण|bottom line|निचोड़)\s*$/im.test(body),
    guaranteeHits: [...new Set(full.match(new RegExp(RE.guarantee.source, 'gi')) || [])].slice(0, 5),
    stockTipHits: [...new Set(full.match(new RegExp(RE.stockTip.source, 'gi')) || [])].slice(0, 5),
    genericHits: [...new Set(full.match(new RegExp(RE.generic.source, 'gi')) || [])].slice(0, 5)
  };
  checks.hasNumbers = nums.length >= 3;

  const errors = [], warnings = [];
  const E = (code, msg) => errors.push({ code, msg });
  const W = (code, msg) => warnings.push({ code, msg });

  if (checks.guaranteeHits.length) E('guarantee', `Guarantee/get-rich language hataya ja sake: ${checks.guaranteeHits.join(', ')}`);
  if (checks.stockTipHits.length) E('stock_tip', `Stock tip jaisi line mili: ${checks.stockTipHits.join(', ')}`);
  if (words < Math.round(minWords * 0.8)) E('short', `Business article bahut chhota hai (${words} shabd, target ${minWords}+)`);
  else if (words < minWords) W('short_warn', `${words} shabd — ${minWords}+ behtar`);
  if (headings.length < 8) W('sections', `${headings.length} sections hain, 10 chahiye (setup, money engine, framework, example, counterpoint, playbook, risks, result, not confirmed, analysis)`);
  else if (headings.length < 10) W('sections_few', `${headings.length}/10 sections — example/result ke bina article adhura lagta hai`);
  if (!checks.hasNumbers) W('numbers', '3 se kam thos aankde — business article me numbers chahiye');
  if (!checks.hasFramework) W('framework', 'Koi business framework apply nahi hua');
  if (!checks.hasExample) W('example', 'Worked example section nahi mila — reader ko number ke saath example chahiye');
  if (!checks.hasResult) W('result', 'Result/outcome section nahi mila — "what happened" ke bina analysis adhura hai');
  if (!checks.hasCounter) W('counter', 'Counterpoint (sabse strong ulta argument) nahi mila');
  if (!checks.hasPlaybook) W('playbook', 'Operator playbook / action steps nahi mile');
  if (!checks.hasRisks) W('risks', 'Risks / failure modes section nahi mila');
  if (!checks.hasHonesty) W('honesty', '"What is not confirmed" / estimate label nahi mila');
  if (!checks.hasIndia) W('india', 'India context (₹/crore/Indian city) nahi dikha');
  if (checks.genericHits.length) W('generic', `Generic AI phrases mile: ${checks.genericHits.join(', ')}`);

  let score = 100;
  for (const code of ['short', 'sections', 'sections_few', 'numbers', 'framework', 'example', 'result', 'counter', 'playbook', 'risks', 'honesty', 'india', 'generic']) {
    if (errors.some((e) => e.code === code)) score -= 0;
    else if (warnings.some((w) => w.code === code || (code === 'short' && w.code === 'short_warn'))) score -= 7;
  }
  if (errors.some((e) => e.code === 'guarantee')) score -= 30;
  if (errors.some((e) => e.code === 'stock_tip')) score -= 25;
  score = Math.max(0, Math.min(100, score));

  const hardFail = checks.guaranteeHits.length > 0 || checks.stockTipHits.length > 0;
  const ok = score >= 70 && !hardFail && words >= Math.round(minWords * 0.8) && headings.length >= 7 && checks.hasExample && checks.hasResult;
  return { ok, score, ...checks, errors, warnings };
}

export function businessMeta(gate) {
  if (!gate) return null;
  return {
    ok: !!gate.ok,
    score: Number(gate.score) || 0,
    words: Number(gate.words) || 0,
    headings: Number(gate.headings) || 0,
    numbers: Number(gate.numbers) || 0,
    framework: !!gate.hasFramework,
    example: !!gate.hasExample,
    result: !!gate.hasResult,
    plain: !!gate.hasPlain,
    counterpoint: !!gate.hasCounter,
    playbook: !!gate.hasPlaybook,
    risks: !!gate.hasRisks,
    honesty: !!gate.hasHonesty,
    india: !!gate.hasIndia,
    errors: (gate.errors || []).slice(0, 4),
    warnings: (gate.warnings || []).slice(0, 8)
  };
}

// ---------------------------------------------------------------------------
// 5. Derived-number checker (0 token, real arithmetic)
// ---------------------------------------------------------------------------
// Article may say `1200 / 9 = 133`. Allowed only if 1200 and 9 are in the sources,
// and 1200/9 really is (about) 133. This lets business writers use ratios without
// letting them invent numbers.
export function derivedNumbers(text, notesText) {
  const have = new Set(numbersIn(notesText));
  const out = new Set();
  const s = normNums(text).replace(/[×x]/gi, '*').replace(/÷/g, '/').replace(/,/g, '');

  const near = (calc, shown) => Number.isFinite(calc) && Math.abs(calc - shown) <= Math.max(0.51, Math.abs(calc) * 0.02);

  for (const m of s.matchAll(/(\d+(?:\.\d+)?)\s*([+\-*/])\s*(\d+(?:\.\d+)?)\s*=\s*(\d+(?:\.\d+)?)/g)) {
    const a = m[1], b = m[3], shown = Number(m[4]);
    if (!have.has(a) || !have.has(b)) continue;
    const x = Number(a), y = Number(b);
    const calc = m[2] === '+' ? x + y : m[2] === '-' ? x - y : m[2] === '*' ? x * y : (y ? x / y : NaN);
    if (near(calc, shown)) out.add(m[4]);
  }
  // percent change: (a - b) / b * 100 = p
  for (const m of s.matchAll(/\(\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*\)\s*\/\s*(\d+(?:\.\d+)?)\s*\*\s*100\s*=\s*(\d+(?:\.\d+)?)/g)) {
    const a = m[1], b = m[2], c = m[3], shown = Number(m[4]);
    if (!have.has(a) || !have.has(b) || !have.has(c)) continue;
    const x = Number(a), y = Number(b), z = Number(c);
    if (!z) continue;
    if (near(((x - y) / z) * 100, shown)) out.add(m[4]);
  }
  return [...out];
}
