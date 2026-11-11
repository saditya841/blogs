import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validatePost, CATS } from '../../src/validate.js';

const HOUR = 3600;
const NOW = 1_800_000_000; // fixed clock: tests never depend on today's date

// a post that should pass every check (only warnings allowed)
const good = (over = {}) => ({
  title: 'Odisha mein kisanon ke liye nayi yojana shuru hui',
  summary: 'Rajya sarkar ne kisanon ke liye nayi yojana shuru ki hai jisse fasalon par seedha labh milega aur unki aay badhegi.',
  body: 'Pehla paragraph yahan hai aur isme kaafi shabd hain taaki lekh chhota na lage.\n\n## Nayi yojana\n\nDoosra paragraph hai jisme yojana ke baare mein detail di gayi hai.\n\n## Labh\n\nTeesra paragraph hai jisme kisanon ko milne wale labh bataye gaye hain.',
  category: 'Odisha',
  tags: 'odisha, kisan, yojana',
  lang: 'hi',
  word_count: 400,
  image_url: 'https://example.com/a.jpg',
  image_credit: 'Test / Wikimedia Commons',
  slug: 'odisha-kisan-yojana-abc12',
  sources: JSON.stringify([{ url: 'https://a.com/x' }, { url: 'https://b.com/y' }, { url: 'https://c.com/z' }]),
  ...over,
});

const codes = (list) => list.map((x) => x.code);

describe('validatePost — basic publish checklist', () => {
  test('a complete post is allowed', () => {
    assert.equal(validatePost(good(), { nowSec: NOW }).ok, true);
  });

  test('missing title blocks publish', () => {
    const r = validatePost(good({ title: '   ' }), { nowSec: NOW });
    assert.equal(r.ok, false);
    assert.deepEqual(codes(r.errors), ['title']);
  });

  test('title over 120 characters is an error, 91-120 is only a warning', () => {
    assert.equal(validatePost(good({ title: 'a'.repeat(121) }), { nowSec: NOW }).ok, false);
    const long = validatePost(good({ title: 'a'.repeat(100) }), { nowSec: NOW });
    assert.equal(long.ok, true);
    assert.ok(codes(long.warnings).includes('title_long'));
  });

  test('missing summary blocks publish', () => {
    assert.equal(validatePost(good({ summary: '' }), { nowSec: NOW }).ok, false);
  });

  test('body under 150 words blocks publish', () => {
    const r = validatePost(good({ body: 'bahut chhota lekh', word_count: 3 }), { nowSec: NOW });
    assert.equal(r.ok, false);
    assert.ok(codes(r.errors).includes('body_short'));
  });

  test('no sources blocks publish; one source is only a warning', () => {
    assert.equal(validatePost(good({ sources: '[]' }), { nowSec: NOW }).ok, false);
    const one = validatePost(good({ sources: JSON.stringify([{ url: 'https://only.com/a' }]) }), { nowSec: NOW });
    assert.equal(one.ok, true);
    assert.ok(codes(one.warnings).includes('sources_few'));
  });

  test('image must be https', () => {
    const r = validatePost(good({ image_url: 'http://insecure.com/a.jpg' }), { nowSec: NOW });
    assert.equal(r.ok, false);
    assert.ok(codes(r.errors).includes('image_https'));
  });

  test('category outside the list is only a warning', () => {
    const r = validatePost(good({ category: 'Random' }), { nowSec: NOW });
    assert.equal(r.ok, true);
    assert.ok(codes(r.warnings).includes('category'));
  });

  test('CATS has the 10 categories the writer prompt uses', () => {
    assert.equal(CATS.length, 10);
    for (const c of ['India', 'Odisha', 'Business', 'Technology', 'Sports', 'Entertainment', 'Education', 'Jobs', 'Politics', 'World']) {
      assert.ok(CATS.includes(c), c);
    }
  });
});

describe('validatePost — fact-check records', () => {
  const check = (over = {}) => ({ verified: true, supported: 4, claims: 4, unsupportedCount: 0, newest_source: NOW - 2 * HOUR, ...over });

  test('manual approve without a fact-check record: warning only', () => {
    const r = validatePost(good(), { nowSec: NOW });
    assert.equal(r.ok, true);
    assert.ok(codes(r.warnings).includes('no_check'));
  });

  test('auto-publish without a fact-check record is blocked (strict)', () => {
    const r = validatePost(good(), { nowSec: NOW, strict: true });
    assert.equal(r.ok, false);
    assert.deepEqual(codes(r.errors), ['no_check']);
  });

  test('verified record with a fresh source passes', () => {
    assert.equal(validatePost(good(), { nowSec: NOW, strict: true, check: check() }).ok, true);
  });

  test('unsupported claims block publish', () => {
    const r = validatePost(good(), { nowSec: NOW, strict: true, check: check({ unsupportedCount: 2 }) });
    assert.equal(r.ok, false);
    assert.ok(codes(r.errors).includes('unsupported'));
  });

  test('an old source blocks publish (stale news)', () => {
    const r = validatePost(good(), { nowSec: NOW, check: check({ newest_source: NOW - 10 * 86400 }) });
    assert.equal(r.ok, false);
    assert.ok(codes(r.errors).includes('stale'));
  });

  test('a fact-check that skipped claims blocks publish', () => {
    const r = validatePost(good(), { nowSec: NOW, check: check({ coverageLow: true }) });
    assert.equal(r.ok, false);
    assert.ok(codes(r.errors).includes('coverage'));
  });
});

describe('validatePost — language guard', () => {
  test('a "Hindi" post written mostly in Latin letters gets a warning', () => {
    const r = validatePost(good({
      body: 'This body is written in English even though the language says Hindi. '.repeat(5),
      lang: 'hi',
    }), { nowSec: NOW });
    assert.ok(codes(r.warnings).includes('language'));
  });
});
