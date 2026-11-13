import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUSINESS_FRAMEWORKS,
  BUSINESS_HOT_QUERIES,
  BUSINESS_KINDS,
  BUSINESS_ROLES,
  BUSINESS_TOPIC_BANK,
  businessAngle,
  businessGate,
  businessKind,
  businessMessages,
  businessSeeds,
  derivedNumbers,
  frameworkFor,
  hotBusinessTopics,
  isBusinessMode,
  kindRules
} from '../../src/business.js';
import { classify, preflight, YMYL_STRICT } from '../../src/playbook.js';
import { validatePost } from '../../src/validate.js';

const NOW = 1_800_000_000;

// A business article that should pass the depth gate: 8 sections, sourced numbers,
// a named framework, counterpoint, playbook, risks, honesty and India context.
const paragraph = (s) => `${s} DMart ka model India ke retail market me volume par chalta hai. 1200 crore ka revenue aur 9 percent ka margin dikhata hai ki 1200 / 9 = 133 ka simple hisaab bhi matter karta hai. 2024 me 45 din ka inventory cycle aur 300 store ka network isi discipline ka saboot hai. Operator ko har mahine cash, rent, staff aur supplier payment dekhni padti hai, warna unit economics bigad jati hai. Isliye estimate ko estimate likhna zaroori hai, kyunki data har quarter badalta hai aur ek galat assumption poora plan hila sakti hai. Chhote retailer ke liye sabak ye hai ki margin se pehle cash cycle samjho, kyunki profit paper par achha lag sakta hai jabki bank account khali ho.`;

const goodBusiness = (over = {}) => ({
  title: 'DMart ka low-margin model: unit economics se samjho',
  summary: 'DMart kam margin par zyada volume kaise kamata hai, kahan tootta hai, aur ek chhote retailer ko kya test karna chahiye.',
  body: [
    '## The setup', paragraph('DMart ne apna pehla store Maharashtra me khola aur aaj bhi wahi discipline chalati hai.'),
    '## The money engine', paragraph('Customer ka payment turant aata hai, supplier ka payment baad me hota hai, aur yahi cash cycle ka asli fayda hai.'),
    '## Framework: Unit Economics', paragraph('Unit economics ka matlab hai ek order par kitna contribution margin bachta hai aur CAC kab wapas aata hai.'),
    '## Worked example', paragraph('Ek simple udaharan lete hain: 1200 crore revenue aur 300 store ka network, matlab 1200 / 300 = 4 crore per store ka rough average. Ye estimate hai, isliye ise estimate likhna zaroori hai.'),
    '## The counterpoint', paragraph('However, low margin ka matlab hai ki ek galat expansion plan poora business hilaa sakta hai.'),
    '## Operator playbook', paragraph('Playbook simple hai: pehle ek store par test karo, phir inventory turn check karo, phir hi doosra store kholo.'),
    '## What could go wrong', paragraph('Sabse bada risk hai rent aur staff cost badhna. Early signal hai ki footfall same rehkar basket size gir raha hai.'),
    '## What the result shows', paragraph('Result ye hai ki 45 din ka inventory cycle aur 9 percent margin dono saath chal rahe hain. 1200 / 9 = 133 ka simple hisaab dikhata hai ki volume ka game hai.'),
    '## What is not confirmed', paragraph('Ye estimate hai kyunki company ke exact store-level numbers public nahi hain. Confirm nahi hai ki har city me same model chalega.'),
    '## Analysis', paragraph('Business model ki asli kahani margin nahi, cash cycle aur discipline hai. Ye India ke har retailer ke liye sabak hai.')
  ].join('\n\n'),
  category: 'Business',
  ...over
});

describe('business topic bank and helpers', () => {
  test('the topic bank is large, unique and India-first', () => {
    assert.ok(BUSINESS_TOPIC_BANK.length >= 40);
    const queries = BUSINESS_TOPIC_BANK.map((x) => x.q.toLowerCase());
    assert.equal(new Set(queries).size, queries.length);
    for (const t of BUSINESS_TOPIC_BANK) {
      assert.ok(t.q.length > 8, t.q);
      assert.ok(BUSINESS_FRAMEWORKS[t.framework], `unknown framework ${t.framework}`);
      assert.ok(t.angle);
    }
  });

  test('every framework has a name, an idea and a question', () => {
    for (const [id, fw] of Object.entries(BUSINESS_FRAMEWORKS)) {
      assert.ok(fw.name && fw.idea && fw.ask, id);
    }
  });

  test('every hot-traffic query exists in the topic bank', () => {
    assert.ok(BUSINESS_HOT_QUERIES.length >= 40);
    const bank = new Set(BUSINESS_TOPIC_BANK.map((x) => x.q.toLowerCase()));
    for (const q of BUSINESS_HOT_QUERIES) assert.ok(bank.has(q.toLowerCase()), q);
    assert.equal(new Set(BUSINESS_HOT_QUERIES.map((q) => q.toLowerCase())).size, BUSINESS_HOT_QUERIES.length);
  });

  test('hot topics rotate by day and keep angle/framework', () => {
    const a = hotBusinessTopics({ limit: 3, offset: 0 });
    const b = hotBusinessTopics({ limit: 3, offset: 3 });
    assert.equal(a.length, 3);
    assert.notEqual(a[0].q, b[0].q);
    for (const t of a) assert.ok(t.angle && t.framework);
  });

  test('businessSeeds rotates without repeating', () => {
    const a = businessSeeds({ limit: 5, offset: 0 });
    const b = businessSeeds({ limit: 5, offset: 5 });
    assert.equal(a.length, 5);
    assert.equal(b.length, 5);
    assert.equal(a[0].q, BUSINESS_TOPIC_BANK[0].q);
    assert.equal(b[0].q, BUSINESS_TOPIC_BANK[5].q);
    assert.notEqual(a[0].q, b[0].q);
    // an offset larger than the bank still wraps safely
    assert.equal(businessSeeds({ limit: 1, offset: BUSINESS_TOPIC_BANK.length + 3 })[0].q, BUSINESS_TOPIC_BANK[3].q);
  });

  test('mode, angle and framework are resolved from the topic', () => {
    assert.equal(isBusinessMode({ BUSINESS_MODE: 'true' }), true);
    assert.equal(isBusinessMode({ BUSINESS_MODE: 'off' }), false);
    assert.equal(isBusinessMode({}, { research: JSON.stringify({ mode: 'business' }) }), true);
    assert.equal(businessAngle('DMart business model low margin high volume', {}), 'unit-economics');
    assert.equal(businessAngle('restaurant failure reasons', {}), 'failure');
    assert.equal(frameworkFor('company cash flow working capital', {}), 'cash');
    assert.equal(frameworkFor('anything', { framework: 'porter' }), 'porter');
    assert.equal(frameworkFor('anything unknown', {}), 'unit-economics');
  });

  test('review roles are neutral operators, not gurus', () => {
    assert.deepEqual(BUSINESS_ROLES.map((r) => r.id), ['strategist', 'operator', 'skeptic', 'verifier']);
    for (const r of BUSINESS_ROLES) assert.ok(/business|unit economics|risk|failure|source|real/i.test(r.focus));
  });
});

describe('businessKind — three editorial categories plus the model explainer', () => {
  test('share-market education is detected first', () => {
    for (const q of [
      'stock market basics India how shares work',
      'sensex nifty explained for beginners India',
      'PE ratio explained India stock valuation',
      'demat account charges India comparison'
    ]) assert.equal(businessKind(q, {}), 'market', q);
  });

  test('founder queries are detected from words and names', () => {
    assert.equal(businessKind('Dhirubhai Ambani early business lessons Reliance', {}), 'founder');
    assert.equal(businessKind('Kishore Biyani rise and fall lessons', {}), 'founder');
    assert.equal(businessKind('Nikhil Kamath Zerodha lessons', {}), 'founder');
  });

  test('startup-cost queries become business plans', () => {
    for (const q of [
      'coffee shop startup cost India break-even',
      'PG hostel business India cost profit',
      'EV charging station investment India payback'
    ]) assert.equal(businessKind(q, {}), 'plan', q);
  });

  test('company/model queries stay model explainers', () => {
    assert.equal(businessKind('DMart business model low margin high volume', {}), 'model');
    assert.equal(businessKind('Zerodha business model revenue profit', {}), 'model');
  });

  test('research can pin a kind explicitly', () => {
    assert.equal(businessKind('anything at all', { kind: 'market' }), 'market');
    assert.equal(businessKind('anything at all', { kind: 'nonsense' }), 'model');
  });

  test('every kind has a label and a structure focus', () => {
    for (const [id, k] of Object.entries(BUSINESS_KINDS)) {
      assert.ok(k.label && k.section, id);
    }
    assert.deepEqual(Object.keys(BUSINESS_KINDS).sort(), ['founder', 'market', 'model', 'plan']);
  });

  test('the expanded topic bank covers all four kinds', () => {
    const kinds = new Set(BUSINESS_TOPIC_BANK.map((t) => businessKind(t.q, t)));
    for (const k of Object.keys(BUSINESS_KINDS)) assert.ok(kinds.has(k), k);
  });
});

describe('kindRules — the evidence each category needs', () => {
  test('market rules forbid tips and demand risk/cost/downside', () => {
    const r = kindRules('market');
    assert.match(r, /buy\/sell|target price/i);
    assert.match(r, /risk/i);
    assert.match(r, /not investment advice/i);
  });

  test('plan rules demand startup cost, fixed cost and break-even', () => {
    const r = kindRules('plan');
    assert.match(r, /startup-cost/i);
    assert.match(r, /fixed cost/i);
    assert.match(r, /break-even/i);
    assert.match(r, /downside/i);
  });

  test('founder rules demand a dated timeline and no invented quotes', () => {
    const r = kindRules('founder');
    assert.match(r, /dated timeline/i);
    assert.match(r, /invent a quote/i);
    assert.match(r, /survivorship/i);
  });

  test('unknown kinds fall back to the model rules', () => {
    assert.match(kindRules('nonsense'), /who pays whom/i);
  });
});

describe('business prompt', () => {
  test('it forces operator thinking, a framework and honest gaps', () => {
    const [system, user] = businessMessages({}, {
      topic: { query: 'DMart business model low margin high volume' },
      lang: 'en',
      sources: [{ title: 'DMart annual report', url: 'https://example.com/a', text: 'Revenue was 1200 crore.' }]
    });
    const all = system.content + user.content;
    assert.match(system.content, /Unit Economics|framework/i);
    assert.match(system.content, /Never write "guaranteed"/i);
    assert.match(system.content, /stock tips/i);
    assert.match(user.content, /FRAMEWORK TO APPLY: Unit Economics/);
    assert.match(user.content, /## The counterpoint/);
    assert.match(user.content, /## Operator playbook/);
    assert.match(user.content, /## Worked example/);
    assert.match(user.content, /## What the result shows/);
    assert.match(user.content, /## What is not confirmed/);
    assert.match(user.content, /plain language/i);
    assert.match(all, /1200 crore/);
  });

  test('each article kind gets its own evidence rules and structure focus', () => {
    const plan = businessMessages({}, {
      topic: { query: 'coffee shop startup cost India break-even' },
      lang: 'en',
      sources: [{ title: 'Cafe cost report', url: 'https://www.livemint.com/x', text: 'Setup cost was 12 lakh.' }]
    });
    const planText = plan[0].content + plan[1].content;
    assert.match(plan[1].content, /KIND: plan/);
    assert.match(planText, /startup-cost breakdown/i);
    assert.match(planText, /break-even/i);
    assert.match(planText, /STRUCTURE FOCUS FOR THIS KIND/);

    const founder = businessMessages({}, {
      topic: { query: 'Dhirubhai Ambani early business lessons Reliance' },
      lang: 'en'
    });
    assert.match(founder[1].content, /KIND: founder/);
    assert.match(founder[1].content, /dated timeline/i);

    const market = businessMessages({}, {
      topic: { query: 'PE ratio explained India stock valuation' },
      lang: 'en'
    });
    assert.match(market[1].content, /KIND: market/);
    assert.match(market[0].content, /not investment advice/i);
  });

  test('sources are ordered by trust and labelled in the prompt', () => {
    const messages = businessMessages({}, {
      topic: { query: 'DMart business model low margin high volume' },
      lang: 'en',
      sources: [
        { title: 'Blog take', url: 'https://medium.com/@x/dmart', text: 'A blog opinion.' },
        { title: 'SEBI circular', url: 'https://www.sebi.gov.in/legal.html', text: 'A regulator note.' },
        { title: 'Mint report', url: 'https://www.livemint.com/market', text: 'A newsroom report.' }
      ]
    });
    const text = messages[1].content;
    assert.match(text, /\[trust: official\/regulator\]/);
    assert.match(text, /SOURCE TRUST: 3 sources/);
    assert.ok(text.indexOf('sebi.gov.in') < text.indexOf('livemint.com'));
    assert.ok(text.indexOf('livemint.com') < text.indexOf('medium.com'));
  });

  test('Hindi mode asks for Devanagari output', () => {
    const messages = businessMessages({}, { topic: { query: 'kirana store economics India margin' }, lang: 'hi' });
    assert.match(messages[1].content, /LANGUAGE: Hindi \(Devanagari script\)/);
  });

  test('an existing article is sent as a draft to deepen, not as a fact source', () => {
    const messages = businessMessages({}, {
      topic: { query: 'DMart business model low margin high volume' },
      lang: 'en',
      existingBody: '## The setup\n\nPurana draft jo expand karna hai.',
      sources: [{ title: 'DMart annual report', url: 'https://example.com/a', text: 'Revenue was 1200 crore.' }]
    });
    assert.match(messages[0].content, /EXISTING ARTICLE/i);
    assert.match(messages[1].content, /EXISTING ARTICLE TO DEEPEN/);
    assert.match(messages[1].content, /Purana draft/);
  });
});

describe('businessGate — code decides if it is a real business article', () => {
  test('a deep, sourced article passes', () => {
    const g = businessGate(goodBusiness(), { minWords: 900 });
    assert.equal(g.ok, true, JSON.stringify(g.warnings));
    assert.equal(g.hasFramework, true);
    assert.equal(g.hasExample, true);
    assert.equal(g.hasResult, true);
    assert.equal(g.hasCounter, true);
    assert.equal(g.hasPlaybook, true);
    assert.equal(g.hasRisks, true);
    assert.equal(g.hasHonesty, true);
    assert.equal(g.hasIndia, true);
    assert.ok(g.numbers >= 3);
    assert.ok(g.score >= 70);
  });

  test('missing worked example or result blocks the gate even when words are fine', () => {
    const noExample = goodBusiness({ body: goodBusiness().body.replace('## Worked example', '## More context') });
    const g1 = businessGate(noExample, { minWords: 900 });
    assert.equal(g1.ok, false);
    assert.equal(g1.hasExample, false);

    const noResult = goodBusiness({ body: goodBusiness().body.replace('## What the result shows', '## Final note') });
    const g2 = businessGate(noResult, { minWords: 900 });
    assert.equal(g2.ok, false);
    assert.equal(g2.hasResult, false);
  });

  test('guarantee / get-rich language is a hard fail', () => {
    const g = businessGate(goodBusiness({
      body: goodBusiness().body + '\n\nYe scheme guaranteed return deti hai, 100% profit pakka hai.'
    }));
    assert.equal(g.ok, false);
    assert.ok(g.errors.some((e) => e.code === 'guarantee'));
  });

  test('stock tips are a hard fail', () => {
    const g = businessGate(goodBusiness({
      body: goodBusiness().body + '\n\nBuy this stock now, target price 500, multibagger hai.'
    }));
    assert.equal(g.ok, false);
    assert.ok(g.errors.some((e) => e.code === 'stock_tip'));
  });

  test('honest "no guarantee" wording is allowed', () => {
    const g = businessGate(goodBusiness({
      body: goodBusiness().body + '\n\nThere is no guarantee that this model will keep working in every city.'
    }));
    assert.equal(g.guaranteeHits.length, 0);
    assert.equal(g.ok, true, JSON.stringify(g.warnings));
  });

  test('a thin draft fails even with no banned words', () => {
    const g = businessGate({ title: 'Business', summary: 'Short.', body: '## Setup\n\nBahut chhota text hai.' }, { minWords: 900 });
    assert.equal(g.ok, false);
    assert.ok(g.errors.some((e) => e.code === 'short'));
  });

  test('a plan article without cost or break-even evidence gets a kind warning', () => {
    const body = goodBusiness().body.replace(/rent/g, 'bijli').replace(/cost/gi, 'kharch').replace(/unit/gi, 'hisab').replace(/contribution/gi, 'hissa');
    const g = businessGate(goodBusiness({ title: 'Coffee shop startup cost India break-even', body }), { minWords: 900 });
    assert.equal(g.kind, 'plan');
    assert.equal(g.hasKindEvidence, false);
    assert.ok(g.warnings.some((w) => w.code === 'kind_plan'), JSON.stringify(g.warnings));
  });

  test('a founder story without a dated timeline gets a kind warning', () => {
    const body = goodBusiness().body.replace(/2024/g, 'pichhle saal');
    const g = businessGate(goodBusiness({ title: 'Dhirubhai Ambani early business lessons Reliance', body }), { minWords: 900 });
    assert.equal(g.kind, 'founder');
    assert.equal(g.hasKindEvidence, false);
    assert.ok(g.warnings.some((w) => w.code === 'kind_founder'), JSON.stringify(g.warnings));
  });

  test('market education without risk or downside language gets a kind warning', () => {
    const body = goodBusiness().body.replace(/risk/gi, 'dikkat').replace(/downside/gi, 'mushkil');
    const g = businessGate(goodBusiness({ title: 'PE ratio explained India stock valuation', body }), { minWords: 900 });
    assert.equal(g.kind, 'market');
    assert.equal(g.hasKindEvidence, false);
    assert.ok(g.warnings.some((w) => w.code === 'kind_market'), JSON.stringify(g.warnings));
  });
});

describe('derivedNumbers — arithmetic is allowed only with sourced inputs', () => {
  const notes = 'Revenue was 1200 crore and margin was 9 percent. Store count 300.';

  test('a correct calculation with sourced inputs is allowed', () => {
    assert.deepEqual(derivedNumbers('1200 / 9 = 133', notes), ['133']);
    assert.deepEqual(derivedNumbers('1200 + 300 = 1500', notes), ['1500']);
  });

  test('wrong arithmetic is never allowed', () => {
    assert.deepEqual(derivedNumbers('1200 / 9 = 150', notes), []);
  });

  test('an input missing from the sources is never allowed', () => {
    assert.deepEqual(derivedNumbers('5000 / 9 = 555', notes), []);
  });

  test('percent change needs all three sourced inputs', () => {
    assert.deepEqual(derivedNumbers('(1200 - 300) / 300 * 100 = 300', notes), ['300']);
    assert.deepEqual(derivedNumbers('(1200 - 700) / 700 * 100 = 71', notes), []);
  });
});

describe('playbook — business classification', () => {
  test('business mode allows analysis but keeps YMYL strict', () => {
    assert.equal(classify('DMart business model low margin high volume', true).type, 'business');
    assert.equal(classify('restaurant business failure rate India reasons', true).type, 'business');
    assert.equal(classify('stock tips for tomorrow', true).type, 'ymyl');
    assert.equal(classify('home remedies for fever', true).type, 'ymyl');
    assert.match('stock tips', YMYL_STRICT);
  });

  test('business preflight accepts two sources without fresh dates', () => {
    const topic = { query: 'DMart business model margin' };
    const rs = {
      sources: [
        { title: 'DMart business model and margin', text: 'DMart business model works on margin.', date: 0 },
        { title: 'DMart business model explained', text: 'The DMart business model is low margin.', date: 0 }
      ]
    };
    const pf = preflight(topic, rs, NOW, true);
    assert.equal(pf.ok, true, pf.reason);
    assert.equal(pf.minSources, 2);
    assert.equal(pf.needDates, false);
  });

  test('business preflight does not accept Wikipedia-only research', () => {
    const topic = { query: 'DMart business model margin' };
    const rs = {
      sources: [
        { title: 'DMart business model', url: 'https://en.wikipedia.org/wiki/DMart', text: 'DMart business model and margin.' },
        { title: 'DMart business model', url: 'https://en.wikipedia.org/wiki/Avenue_Supermarts', text: 'DMart business model margin.' }
      ]
    };
    const pf = preflight(topic, rs, NOW, true);
    assert.equal(pf.ok, false);
    assert.match(pf.reason, /Wikipedia/);
  });

  test('business preflight still stops an unrelated source set', () => {
    const topic = { query: 'DMart business model margin' };
    const rs = {
      sources: [
        { title: 'Cricket score', text: 'India won the match.' },
        { title: 'Weather today', text: 'It will rain.' }
      ]
    };
    const pf = preflight(topic, rs, NOW, true);
    assert.equal(pf.ok, false);
    assert.equal(pf.retry, true);
  });
});

describe('validatePost — Business articles', () => {
  const sources = JSON.stringify([{ url: 'https://a.com/x' }, { url: 'https://b.com/y' }]);
  const post = (over = {}) => {
    const a = goodBusiness(over);
    return {
      ...a,
      tags: 'dmart, retail, unit economics',
      lang: 'en',
      word_count: 900,
      image_url: 'https://example.com/a.jpg',
      image_credit: 'Test',
      slug: 'dmart-unit-economics-abc12',
      sources,
      ...over
    };
  };

  test('a good business article is publishable by a human', () => {
    const r = validatePost(post(), { nowSec: NOW });
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.ok(!r.errors.some((e) => e.code.startsWith('business_')));
  });

  test('guarantee language always blocks publish', () => {
    const r = validatePost(post({ body: goodBusiness().body + '\n\nGuaranteed return milega.' }), { nowSec: NOW });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.code === 'business_guarantee'));
  });

  test('stock tip language always blocks publish', () => {
    const r = validatePost(post({ body: goodBusiness().body + '\n\nBuy this stock, target price 500.' }), { nowSec: NOW });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.code === 'business_stock_tip'));
  });

  test('auto-publish strict mode blocks a shallow business article', () => {
    const shallow = post({ body: '## Setup\n\nChhota article hai. India me business mushkil hai.' });
    const r = validatePost(shallow, { nowSec: NOW, strict: true });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.code === 'business_auto'));
  });
});
