import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseCardOutput, guardCard, renderCardPage, renderCardsList } from '../../src/cardpost.js';

describe('parseCardOutput', () => {
  test('reads the hook and bullet points, and strips markdown', () => {
    const out = parseCardOutput(`HOOK: “Big *win* for the team”
- First point with enough words to count as a point here.
* Second point that is also long enough for the guard.
2. Third point written with a number instead of a bullet.`);
    assert.equal(out.hook, 'Big win for the team');
    assert.equal(out.points.length, 3);
    assert.ok(out.points[0].startsWith('First point'));
    assert.ok(!out.points[0].includes('*'));
  });

  test('an empty or garbage answer gives an empty card', () => {
    assert.deepEqual(parseCardOutput(''), { hook: '', points: [] });
    assert.deepEqual(parseCardOutput('no structured lines here'), { hook: '', points: [] });
  });
});

describe('guardCard — code checks before a card is published', () => {
  const facts = [{ text: 'The company reported a profit of 12000 rupees in the March quarter.', outlets: ['Outlet A'] }];
  const base = {
    hook: 'Company profit jumps to 12000 rupees',
    points: [
      'The company reported a profit of 12000 rupees.',
      'The result was announced in the March quarter this year.',
      'Investors welcomed the numbers and shared their views.',
    ],
  };

  test('a truthful card that uses the facts passes', () => {
    const r = guardCard(base, facts, 'hi');
    assert.equal(r.ok, true, r.reason);
  });

  test('a missing headline is an error', () => {
    const r = guardCard({ ...base, hook: '' }, facts);
    assert.equal(r.ok, false);
    assert.match(r.reason, /headline/);
  });

  test('a headline longer than 10 words is rejected', () => {
    const r = guardCard({ ...base, hook: 'one two three four five six seven eight nine ten eleven' }, facts);
    assert.equal(r.ok, false);
    assert.match(r.reason, /lamba/);
  });

  test('fewer than 3 points is rejected', () => {
    const r = guardCard({ ...base, points: base.points.slice(0, 2) }, facts);
    assert.equal(r.ok, false);
    assert.match(r.reason, /sirf 2 point/);
  });

  test('a point that is too short or too long is rejected', () => {
    const short = guardCard({ ...base, points: [...base.points.slice(1), 'chhota'] }, facts);
    assert.equal(short.ok, false);
    assert.match(short.reason, /bahut chhota/);
    const long = guardCard({ ...base, points: [...base.points.slice(1), 'word '.repeat(60)] }, facts);
    assert.equal(long.ok, false);
    assert.match(long.reason, /bahut lamba/);
  });

  test('an invented number is rejected', () => {
    const r = guardCard({ ...base, points: [...base.points.slice(1), 'The profit was actually 99999 rupees this year.'] }, facts);
    assert.equal(r.ok, false);
    assert.match(r.reason, /99999/);
  });

  test('two names that are not in the facts are rejected', () => {
    const r = guardCard({ ...base, points: [...base.points.slice(1), 'Ramesh and Suresh said the numbers were good.'] }, facts);
    assert.equal(r.ok, false);
    assert.match(r.reason, /naam/);
  });

  test('a point copied word for word from the facts is rejected', () => {
    const r = guardCard({
      ...base,
      points: [...base.points.slice(1), 'The company reported a profit of 12000 rupees in the March quarter.'],
    }, facts);
    assert.equal(r.ok, false);
    assert.match(r.reason, /nakal/);
  });
});

describe('renderCardPage — safe HTML', () => {
  const env = { SITE_URL: 'https://virall.in', SITE_NAME: 'Virall' };
  const topic = { id: 7 };
  const post = {
    hook: 'Big news <script>alert(1)</script>',
    points: ['First point <b>bold</b> text.'],
    label: 'खेल',
    outlets: ['Outlet A', 'Outlet B'],
    image_url: 'https://cdn.example/a.jpg',
    image_credit: 'Someone / CC BY',
  };

  test('user/AI text is escaped', () => {
    const html = renderCardPage(env, topic, post);
    assert.ok(!html.includes('<script>alert(1)'));
    assert.ok(!html.includes('<b>bold</b>'));
    assert.ok(html.includes('&lt;script&gt;'));
  });

  test('canonical points at the card and the sources are shown', () => {
    const html = renderCardPage(env, topic, post);
    assert.ok(html.includes('rel="canonical" href="https://virall.in/card/7"'));
    assert.ok(html.includes('Outlet A, Outlet B'));
    assert.ok(html.includes('फोटो: Someone / CC BY'));
  });

  test('cards are noindex by default and indexable only when CARD_INDEX=1', () => {
    assert.ok(renderCardPage(env, topic, post).includes('content="noindex,follow"'));
    assert.ok(renderCardPage({ ...env, CARD_INDEX: '1' }, topic, post).includes('content="index,follow"'));
  });

  test('a non-https image is never put into a background style', () => {
    const html = renderCardPage(env, topic, { ...post, image_url: 'javascript:alert(1)' });
    assert.ok(!html.includes('javascript:alert'));
    assert.ok(html.includes('card nopic'));
  });

  test('a missing image credit does not print an empty label', () => {
    const html = renderCardPage(env, topic, { ...post, image_credit: '' });
    assert.ok(!html.includes('फोटो: '));
  });
});

describe('renderCardsList', () => {
  const env = { SITE_URL: 'https://virall.in', SITE_NAME: 'Virall' };

  test('an empty list shows a friendly message', () => {
    assert.ok(renderCardsList(env, []).includes('कोई कार्ड नहीं'));
    assert.ok(renderCardsList(env, null).includes('कोई कार्ड नहीं'));
  });

  test('each card links to /card/<id> and the hook is escaped', () => {
    const html = renderCardsList(env, [{ id: 5, post: { hook: '<i>Hi</i>', label: 'खेल', image_url: 'https://x.example/y.jpg' } }]);
    assert.ok(html.includes('href="/card/5"'));
    assert.ok(html.includes('&lt;i&gt;Hi&lt;/i&gt;'));
    assert.ok(html.includes('background-image'));
  });
});
