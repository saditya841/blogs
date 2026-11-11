// Tests for the ZERO-token quality layers added in this round:
//   conflicts, originality, specificity, voice, factregistry, corrections, sourcecheck.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { claimConflict, numberPairs, unitOf, conflictSummary } from '../../src/conflicts.js';
import { originality } from '../../src/originality.js';
import { specificity } from '../../src/specificity.js';
import { buildVoiceProfile, voiceCheck, scriptRatio, paragraphsOf } from '../../src/voice.js';
import { saveFacts, linkPostFacts, factsForPost, staleFacts, markPostFactsVerified } from '../../src/factregistry.js';
import { addCorrection, correctionsForPost, recentCorrections, correctionLine } from '../../src/corrections.js';
import { checkUrl, recheckSources, isHttp } from '../../src/sourcecheck.js';

// ---------- tiny D1 adapter over in-memory SQLite ----------
function d1() {
  const db = new DatabaseSync(':memory:');
  const stmt = (sql, args = []) => ({
    run: async () => {
      const r = db.prepare(sql).run(...args);
      return { meta: { changes: Number(r.changes || 0), last_row_id: Number(r.lastInsertRowid || 0) } };
    },
    first: async () => db.prepare(sql).get(...args) || null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    bind: (...a) => stmt(sql, a)
  });
  return {
    db,
    prepare: (sql) => stmt(sql),
    batch: async (list) => Promise.all((list || []).map((s) => s.run()))
  };
}

const now = () => Math.floor(Date.now() / 1000);

describe('conflicts — two outlets, two different numbers', () => {
  test('unitOf reads Indian units and Devanagari', () => {
    assert.equal(unitOf('1200 crore rupees'), 'crore');
    assert.equal(unitOf('१२०० करोड़'), 'crore');
    assert.equal(unitOf('45 percent'), 'percent');
    assert.equal(unitOf('no unit here'), '');
  });

  test('numberPairs attaches the nearest unit', () => {
    const p = numberPairs('The project will cost 1200 crore and finish in 3 years.');
    assert.equal(p.find((x) => x.value === '1200').unit, 'crore');
    assert.equal(p.find((x) => x.value === '3').unit, 'year');
  });

  test('same fact with different values is a conflict', () => {
    const sources = [
      { source: 'Outlook', text: 'The metro project will cost 1200 crore rupees and cover nine stations.' },
      { source: 'Bhaskar', text: 'The metro project will cost 2100 crore rupees and cover nine stations.' }
    ];
    const r = claimConflict('The metro project will cost 1200 crore rupees', sources);
    assert.equal(r.conflict, true);
    assert.deepEqual(r.values.map((v) => v.outlet).sort(), ['Bhaskar', 'Outlook']);
    assert.match(conflictSummary(r.values), /1200 crore/);
    assert.match(conflictSummary(r.values), /2100 crore/);
  });

  test('same value in both outlets is not a conflict', () => {
    const sources = [
      { source: 'Outlook', text: 'The metro project will cost 1200 crore rupees and cover nine stations.' },
      { source: 'Bhaskar', text: 'Officials said the metro project will cost 1200 crore rupees in total.' }
    ];
    assert.equal(claimConflict('The metro project will cost 1200 crore rupees', sources).conflict, false);
  });

  test('a claim without numbers can never conflict', () => {
    const sources = [{ source: 'A', text: 'The board approved the metro plan on Monday.' }];
    assert.equal(claimConflict('The board approved the metro plan', sources).conflict, false);
  });
});

describe('originality — fresh writing, not a press-release rewrite', () => {
  const src = [{
    source: 'Wire',
    text: 'The state cabinet on Tuesday approved the long pending metro extension which will add nine stations between the old bus stand and the airport and cost about twelve thousand crore rupees officials said after the meeting.'
  }];

  test('copied source sentences score low', () => {
    const copied = src[0].text + ' ' + src[0].text;
    const r = originality(copied, src);
    assert.ok(r.score < 0.85, `score=${r.score}`);
    assert.ok(r.penalty > 0);
    assert.ok(r.notes.length);
  });

  test('a genuinely rewritten article scores full marks', () => {
    const fresh = [
      'The cabinet cleared the metro extension on Tuesday, ending a wait that stretched for years.',
      'Nine new stations will link the old bus stand with the airport.',
      'Officials put the cost at roughly twelve thousand crore rupees.',
      'Shopkeepers on the main road are worried about three years of construction.'
    ].join(' ');
    const r = originality(fresh, src);
    assert.equal(r.score, 1);
    assert.equal(r.penalty, 0);
  });

  test('empty text is penalised, never crashes', () => {
    const r = originality('', src);
    assert.equal(r.score, 0);
    assert.equal(r.penalty, 10);
  });
});

describe('specificity — concrete reporting vs vague filler', () => {
  test('vague filler gets a low score and a penalty', () => {
    const vague = 'The government is working on many important issues and will continue to take steps for the people of the state. ' +
      'Officials said the situation is being monitored and further decisions will be taken at the right time after proper discussion.';
    const r = specificity(vague);
    assert.ok(r.per100 < 3, `per100=${r.per100}`);
    assert.ok(r.penalty > 0);
    assert.ok(r.notes.some((n) => /detail|sankhya/i.test(n)));
  });

  test('a concrete report gets a high score and keeps numbers', () => {
    const text = 'On 8 November, Chief Minister Mohan Majhi said the project will cost 1200 crore rupees. ' +
      'The cabinet met in Bhubaneswar and cleared 9 stations. Work starts in January 2027 and will take 3 years. ' +
      'Minister Suresh Pujari said 45 percent of the land has been acquired. ' +
      'Residents have been waiting for this line for many years and say it will change how they travel to work every day. ' +
      'Shopkeepers near the old bus stand are worried about traffic during the construction period, but most people in the area support the plan. ' +
      'The state will review the progress every three months and publish the updated cost on its website.';
    const r = specificity(text);
    assert.ok(r.score >= 80, `score=${r.score}, per100=${r.per100}`);
    assert.ok(r.per100 >= 3 && r.per100 <= 20, `per100=${r.per100}`);
    assert.ok(r.numbers.includes('1200'));
    assert.ok(r.names.includes('Mohan'));
  });

  test('empty text never crashes', () => {
    const r = specificity('');
    assert.equal(r.words, 0);
    assert.ok(r.score <= 60);
  });
});

describe('voice — does the draft sound like this site?', () => {
  const posts = [
    { title: 'A', body: 'The cabinet met on Monday. It cleared the metro plan after a long wait. Officials say work will start soon. Shopkeepers are worried about the road being blocked for years. The next review is in January.' },
    { title: 'B', body: 'The board approved the new budget. Teachers will get a small raise. Parents say fees are already too high. The budget also funds two new schools in the district. A final vote is due next month.' },
    { title: 'C', body: 'Rain lashed the coast on Tuesday. Two districts reported flooding. The state sent rescue teams. Farmers say the paddy crop is damaged. More rain is expected this week.' }
  ];

  test('scriptRatio separates Devanagari and Latin words', () => {
    const r = scriptRatio('मौसम ठीक है but roads are bad');
    assert.equal(r.dev, 3);
    assert.equal(r.latin, 4);
  });

  test('paragraphsOf ignores headings', () => {
    assert.equal(paragraphsOf('## Head\n\nOne para here.\n\nTwo para here.').length, 2);
  });

  test('fewer than 3 approved posts means no opinion', () => {
    const p = buildVoiceProfile(posts.slice(0, 2));
    const r = voiceCheck(posts[0].body, p);
    assert.equal(r.penalty, 0);
    assert.equal(r.compared, false);
  });

  test('a draft in the same style is accepted', () => {
    const p = buildVoiceProfile(posts);
    const same = 'The minister visited the site on Friday. He said the bridge will open in March. Residents say the old bridge is unsafe. Work was delayed twice last year. A new deadline is now set.';
    const r = voiceCheck(same, p);
    assert.equal(r.compared, true);
    assert.equal(r.penalty, 0, JSON.stringify(r.notes));
  });

  test('a flat, machine-like draft drifts from the profile', () => {
    const p = buildVoiceProfile(posts);
    const flat = Array.from({ length: 8 }, () => 'This is a simple sentence of about ten words in total.').join(' ');
    const r = voiceCheck(flat, p);
    assert.equal(r.compared, true);
    assert.ok(r.penalty > 0);
    assert.ok(r.notes.length);
  });
});

describe('factregistry — permanent checked facts', () => {
  test('saveFacts is idempotent and links facts to a post', async () => {
    const env = { DB: d1() };
    const facts = [
      { text: 'The metro project will cost 1200 crore rupees.', outlets: [{ source: 'Outlook', url: 'https://a.example/1' }, { source: 'Bhaskar', url: 'https://b.example/2' }] },
      { text: 'The metro will add nine stations.', outlets: ['Outlook'] }
    ];
    const ids1 = await saveFacts(env, 7, facts);
    const ids2 = await saveFacts(env, 7, facts);
    assert.equal(ids1.length, 2);
    assert.deepEqual(ids1, ids2);
    await linkPostFacts(env, 42, ids1);
    const linked = await factsForPost(env, 42);
    assert.equal(linked.length, 2);
    assert.equal(linked[0].status, 'active');
  });

  test('an old fact is stale until it is re-verified', async () => {
    const d = d1();
    const env = { DB: d };
    const ids = await saveFacts(env, 8, [{ text: 'The bridge opened on Monday after 3 years of work.', outlets: ['Outlook'] }]);
    await linkPostFacts(env, 43, ids);
    d.db.prepare('UPDATE facts SET last_verified=? WHERE id=?').run(now() - 48 * 3600, ids[0]);
    const stale = await staleFacts(env, 43, 24);
    assert.equal(stale.length, 1);
    const n = await markPostFactsVerified(env, 43);
    assert.equal(n, 1);
    assert.equal((await staleFacts(env, 43, 24)).length, 0);
  });

  test('facts without text are ignored and DB errors never throw', async () => {
    const env = { DB: d1() };
    assert.deepEqual(await saveFacts(env, 9, [{ text: '' }, {}]), []);
    const broken = { DB: { prepare: () => { throw new Error('db down'); }, batch: async () => { throw new Error('db down'); } } };
    assert.deepEqual(await saveFacts(broken, 9, [{ text: 'A real fact that is long enough.' }]), []);
    assert.deepEqual(await factsForPost(broken, 1), []);
  });
});

describe('corrections — dated, public, honest updates', () => {
  test('addCorrection stores the old text, new text and reason', async () => {
    const env = { DB: d1() };
    assert.equal(await addCorrection(env, 5, 'cost was 1200 crore', 'cost was 2100 crore', 'Official revised the figure'), true);
    const list = await correctionsForPost(env, 5);
    assert.equal(list.length, 1);
    assert.equal(list[0].new_text, 'cost was 2100 crore');
    assert.match(list[0].reason, /revised/i);
  });

  test('recentCorrections joins the post title and slug', async () => {
    const d = d1();
    d.db.exec("CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT, slug TEXT)");
    d.db.prepare('INSERT INTO posts(id,title,slug) VALUES(?,?,?)').run(11, 'Metro plan cleared', 'metro-plan-cleared');
    const env = { DB: d };
    await addCorrection(env, 11, 'old', 'new', 'Fixed a number');
    const list = await recentCorrections(env, 10);
    assert.equal(list.length, 1);
    assert.equal(list[0].title, 'Metro plan cleared');
    assert.equal(list[0].slug, 'metro-plan-cleared');
  });

  test('correctionLine is a dated IST update note', () => {
    const line = correctionLine('Fixed the cost figure', Date.UTC(2026, 10, 8, 6, 30) / 1000);
    assert.match(line, /Update \(2026-11-08\): Fixed the cost figure/);
  });
});

describe('sourcecheck — publish-time link liveness', () => {
  const fake = (map) => async (url) => ({ status: map[url] || 200 });

  test('isHttp accepts only real http(s) links', () => {
    assert.equal(isHttp('https://a.example/1'), true);
    assert.equal(isHttp('javascript:alert(1)'), false);
    assert.equal(isHttp(''), false);
  });

  test('2xx is ok, 404/410/451 is dead', async () => {
    const ok = await checkUrl('https://a.example/1', { fetch: fake({ 'https://a.example/1': 200 }) });
    assert.equal(ok.ok, true);
    assert.equal(ok.dead, false);
    const dead = await checkUrl('https://a.example/gone', { fetch: fake({ 'https://a.example/gone': 404 }) });
    assert.equal(dead.dead, true);
    assert.equal(dead.ok, false);
  });

  test('403 / timeout is unknown, not dead', async () => {
    const blocked = await checkUrl('https://a.example/blocked', { fetch: fake({ 'https://a.example/blocked': 403 }) });
    assert.equal(blocked.unknown, true);
    assert.equal(blocked.dead, false);
    const timeout = await checkUrl('https://a.example/slow', { fetch: async () => { throw new Error('timed out'); } });
    assert.equal(timeout.unknown, true);
    assert.equal(timeout.dead, false);
  });

  test('recheckSources reports dead links and a usable summary', async () => {
    const sources = [
      { url: 'https://a.example/1' },
      { url: 'https://b.example/gone' },
      'https://c.example/3'
    ];
    const r = await recheckSources(sources, {
      max: 3,
      fetch: fake({ 'https://a.example/1': 200, 'https://b.example/gone': 410, 'https://c.example/3': 200 })
    });
    assert.equal(r.checked, 3);
    assert.equal(r.okCount, 2);
    assert.deepEqual(r.dead, ['https://b.example/gone']);
    assert.equal(r.ok, false);
  });
});
