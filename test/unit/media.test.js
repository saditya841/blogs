import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_PHOTO_WORDS, photoRelevant, findPhoto,
  genericQuery, stockQuery, topicAmbiguous, findPexels,
  thumbPrompt, makeHook, aiThumbnail,
  findVideo, addMedia, brandedImage,
} from '../../src/media.js';
import { ImageGenerator } from '../../src/image-generator.js';

describe('brandedImage — guaranteed image without any API key', () => {
  test('stores an SVG in D1 and returns a public https URL', async () => {
    const stmts = [];
    const run = async (sql, args) => { stmts.push({ sql, args }); return { ok: true }; };
    const db = { prepare: (sql) => ({ run: () => run(sql, []), bind: (...args) => ({ run: () => run(sql, args) }) }) };
    const r = await brandedImage({ DB: db, SITE_URL: 'https://virall.in' }, 'Big news headline', 'Sports');
    assert.ok(r);
    assert.match(r.url, /^https:\/\/virall\.in\/img\/[a-z0-9]+\.svg$/);
    assert.equal(r.credit, 'Virall graphic');
    const ins = stmts.find((s) => /INSERT INTO images/.test(s.sql));
    assert.ok(ins);
    assert.equal(ins.args[1], 'image/svg+xml');
    const svg = Buffer.from(ins.args[2], 'base64').toString('utf8');
    assert.match(svg, /Big news headline/);
    assert.match(svg, /SPORTS/);
  });
});

describe('photoRelevant — no misleading photos for short/ambiguous queries', () => {
  test('a 1-2 word query never gets a real photo (DAC, Free Fire)', () => {
    assert.equal(MIN_PHOTO_WORDS, 3);
    assert.equal(photoRelevant('DAC', 'DAC airport in Dhaka', 'Dhaka airport'), false);
    assert.equal(photoRelevant('Free Fire', 'Free Fire movie cast', 'film promotion'), false);
  });

  test('a full topic with the words in the file title is relevant', () => {
    assert.equal(photoRelevant('Odisha train accident', 'Odisha train accident site', ''), true);
  });

  test('a title that only matches one topic word is not relevant', () => {
    assert.equal(photoRelevant('Odisha train accident', 'Odisha temple at sunrise', 'puri coast'), false);
  });

  test('title + description together must cover most topic words', () => {
    assert.equal(photoRelevant('Odisha train accident', 'Odisha train', 'accident on the tracks'), true);
    assert.equal(photoRelevant('Odisha train accident', 'Odisha train', 'at the station'), true); // 2/3 is enough
  });
});

describe('stockQuery / genericQuery — Pexels needs English and a clear topic', () => {
  test('one Latin word is too ambiguous, so the category image is used', () => {
    assert.equal(stockQuery('DAC', 'India'), 'india city skyline sunset');
    assert.equal(stockQuery('', 'Technology'), 'technology circuit board neon');
    assert.equal(stockQuery('क्रिकेट मैच', 'Sports'), 'sports stadium floodlights');
  });

  test('two or more Latin words are used as the query', () => {
    assert.equal(stockQuery('Free Fire', 'Entertainment'), 'Free Fire');
    assert.equal(stockQuery('India vs Australia cricket', 'Sports'), 'India Australia cricket');
  });

  test('ambiguous topics are marked so callers try an AI illustration first', () => {
    assert.equal(topicAmbiguous('DAC', 'India'), true);
    assert.equal(topicAmbiguous('क्रिकेट मैच', 'Sports'), true);
    assert.equal(topicAmbiguous('', 'Business'), true);
    assert.equal(topicAmbiguous('Free Fire', 'Entertainment'), false);
    assert.equal(topicAmbiguous('India vs Australia cricket', 'Sports'), false);
  });

  test('filler words such as "explained" are not sent to a photo library', () => {
    assert.equal(stockQuery('Demat account explained', 'Business'), 'Demat account');
    assert.equal(topicAmbiguous('IPO subscription process', 'Business'), false);
    assert.equal(topicAmbiguous('IPO guide for beginners', 'Business'), true);
  });

  test('unknown categories fall back to a neutral news image', () => {
    assert.equal(genericQuery('Nope'), 'news studio background');
    assert.equal(genericQuery(), 'news studio background');
  });
});

describe('ImageGenerator — AI first for short/ambiguous topics', () => {
  const fakeDB = { prepare: () => ({ run: async () => ({}), bind: () => ({ run: async () => ({}) }) }) };

  test('an ambiguous title uses the AI illustration before any stock search', async () => {
    const real = globalThis.fetch;
    let fetches = 0, aiCalls = 0;
    globalThis.fetch = async () => { fetches++; throw new Error('stock should not be called first'); };
    try {
      const env = {
        SITE_URL: 'https://virall.in', PEXELS_API_KEY: 'k', DB: fakeDB,
        AI: { run: async () => { aiCalls++; return { image: 'AAAA' }; } },
      };
      const r = await new ImageGenerator(env).generateFeaturedImage('DAC', 'India');
      assert.equal(r.success, true);
      assert.equal(r.provider, 'workers-ai');
      assert.equal(aiCalls, 1);
      assert.equal(fetches, 0);
    } finally { globalThis.fetch = real; }
  });

  test('a clear topic still gets a relevant stock photo first', async () => {
    const real = globalThis.fetch;
    let aiCalls = 0;
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ photos: [
      { alt: 'India Australia cricket stadium at night', src: { large: 'https://x/cricket.jpg' }, photographer: 'A' },
    ] }) });
    try {
      const env = {
        SITE_URL: 'https://virall.in', PEXELS_API_KEY: 'k', DB: fakeDB,
        AI: { run: async () => { aiCalls++; return { image: 'AAAA' }; } },
      };
      const r = await new ImageGenerator(env).generateFeaturedImage('India vs Australia cricket final', 'Sports');
      assert.equal(r.success, true);
      assert.equal(r.provider, 'pexels');
      assert.equal(r.featuredImage, 'https://x/cricket.jpg');
      assert.equal(aiCalls, 0);
    } finally { globalThis.fetch = real; }
  });
});

describe('network helpers stop early without keys', () => {
  test('findPhoto returns null for short queries without calling the network', async () => {
    assert.equal(await findPhoto('DAC'), null);
    assert.equal(await findPhoto('Free Fire'), null);
    assert.equal(await findPhoto(''), null);
  });

  test('findPexels is a no-op when PEXELS_API_KEY is missing', async () => {
    assert.equal(await findPexels({}, 'india city', 'India'), null);
    assert.equal(await findPexels(null, 'india city', 'India'), null);
  });

  test('a generic stock photo must still match a keyword in its alt text', async () => {
    const real = globalThis.fetch;
    try {
      globalThis.fetch = async () => ({ ok: true, json: async () => ({ photos: [
        { alt: 'a random office desk', src: { large: 'https://x/a.jpg' }, photographer: 'A' },
      ] }) });
      assert.equal(await findPexels({ PEXELS_API_KEY: 'k' }, 'DAC', 'India'), null);
    } finally { globalThis.fetch = real; }
  });

  test('a topic photo needs most of the query words, and people are skipped', async () => {
    const real = globalThis.fetch;
    try {
      globalThis.fetch = async () => ({ ok: true, json: async () => ({ photos: [
        { alt: 'India cricket player in the stadium', src: { large: 'https://x/people.jpg' }, photographer: 'A' },
        { alt: 'India cricket stadium at night', src: { large: 'https://x/good.jpg' }, photographer: 'B' },
      ] }) });
      const r = await findPexels({ PEXELS_API_KEY: 'k' }, 'India vs Australia cricket', 'Sports');
      assert.equal(r.url, 'https://x/good.jpg');
      assert.match(r.credit, /Pexels/);
    } finally { globalThis.fetch = real; }
  });

  test('findVideo explains that the YouTube key is missing', async () => {
    const r = await findVideo({}, 'odisha train');
    assert.match(r.note, /YOUTUBE_API_KEY/);
  });

  test('aiThumbnail returns null when there is no subject (no AI call)', async () => {
    assert.equal(await aiThumbnail({}, {}), null);
    assert.equal(await aiThumbnail({}, { query: '' }), null);
  });
});

describe('thumbPrompt / makeHook — thumbnail text rules', () => {
  test('the prompt carries the category scene and the topic', () => {
    const p = thumbPrompt('Free Fire launch', 'Technology');
    assert.match(p, /circuits/);
    assert.match(p, /Theme: Free Fire launch/);
    assert.match(p, /No text, no letters, no numbers/);
  });

  test('quotes are removed and an unknown category gets the neutral scene', () => {
    const p = thumbPrompt('"Big" news', 'Nope');
    assert.ok(!p.includes('"'));
    assert.match(p, /breaking-news/);
  });

  test('makeHook keeps the part before a colon when it is a real phrase', () => {
    assert.equal(makeHook('Odisha train accident: full report'), 'Odisha train accident');
  });

  test('makeHook shortens long titles and marks the cut', () => {
    const h = makeHook('India beat Australia in the final match today');
    assert.ok(h.endsWith('…'));
    assert.equal(h.replace('…', '').split(' ').length, 7);
  });

  test('makeHook is safe for empty input and honours a custom max', () => {
    assert.equal(makeHook(''), '');
    assert.equal(makeHook('one two three four', 3), 'one two three…');
  });
});

describe('addMedia — never throws when the post is missing', () => {
  test('missing post returns a short note', async () => {
    const env = { DB: { prepare: () => ({ bind: () => ({ first: async () => null }) }) } };
    assert.deepEqual(await addMedia(env, 99, {}), { image: 'post nahi mila', video: '' });
  });
});
