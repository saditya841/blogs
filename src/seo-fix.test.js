// TDD for "ERROR: Invalid time value" in seo-optimizer.js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SEOOptimizer } from './seo-optimizer.js';

const env = { SITE_URL: 'https://virall.in', SITE_NAME: 'Virall', AUTHOR_NAME: 'Virall Desk' };
const seo = new SEOOptimizer(env);
const base = { title: 'Odisha mein nayi yojana shuru hui', body: 'Pehla paragraph.\n\n## Heading\n\nDusra paragraph.', category: 'Odisha', tags: 'odisha,yojana' };
const isISO = (s) => typeof s === 'string' && !Number.isNaN(Date.parse(s)) && /^\d{4}-\d{2}-\d{2}T/.test(s);

describe('Invalid time value — root cause: created_at/updated_at missing or not in seconds', () => {
  test('T1 no created_at/updated_at at all (draft object straight from AI) must not throw', () => {
    const m = seo.generateSEOMetadata({ ...base });
    assert.ok(isISO(m.publishDate) && isISO(m.modifiedDate));
  });
  test('T2 schema without dates must not throw', () => {
    const j = JSON.parse(seo.generateArticleSchema({ ...base }));
    assert.ok(isISO(j.datePublished) && isISO(j.dateModified));
  });
  test('T3 D1 row with updated_at = NULL: modified date falls back to created date', () => {
    const m = seo.generateSEOMetadata({ ...base, created_at: 1761600000, updated_at: null });
    assert.equal(m.modifiedDate, m.publishDate);
  });
  test('T4 timestamp in milliseconds is understood (year 2025, not year 57000)', () => {
    const m = seo.generateSEOMetadata({ ...base, created_at: 1761600000000, updated_at: 1761600000000 });
    assert.equal(m.publishDate.slice(0, 4), '2025');
  });
  test('T5 numeric string and ISO string timestamps are understood', () => {
    assert.equal(seo.generateSEOMetadata({ ...base, created_at: '1761600000' }).publishDate.slice(0, 4), '2025');
    assert.equal(seo.generateSEOMetadata({ ...base, created_at: '2026-10-29T05:00:00Z' }).publishDate.slice(0, 4), '2026');
  });
  test('T6 garbage date value must not throw', () => {
    assert.doesNotThrow(() => seo.generateSEOMetadata({ ...base, created_at: 'abc', updated_at: {} }));
  });
  test('T7 minimal post (only title+body) can render meta tags', () => {
    assert.doesNotThrow(() => seo.generateMetaTags({ title: 'T', body: 'b' }));
  });
});

describe('Other SEO crashes found earlier', () => {
  test('T8 tags undefined/null does not crash', () => {
    assert.doesNotThrow(() => seo.extractKeywords({ ...base, tags: undefined }));
    assert.doesNotThrow(() => seo.extractKeywords({ ...base, tags: null }));
  });
  test('T9 double quote in title cannot break the HTML attribute', () => {
    const h = seo.generateMetaTags({ ...base, title: 'Modi said "big news" today in Odisha state' });
    assert.ok(!h.includes('content="Modi said "big'));
    assert.ok(h.includes('&quot;big news&quot;'));
  });
  test('T10 </script> in title cannot break JSON-LD', () => {
    const h = seo.generateMetaTags({ ...base, title: 'x</script><script>alert(1)</script> long title for seo test' });
    assert.ok(!h.includes('</script><script>alert(1)'));
  });
  test('T11 canonical never contains "undefined"', () => {
    assert.ok(!seo.generateSEOMetadata({ ...base }).canonicalUrl.includes('undefined'));
    assert.ok(seo.generateSEOMetadata({ ...base, id: 42 }).canonicalUrl.endsWith('/post/42'));
  });
  test('T12 analyzeContent with empty title/body returns numeric score', () => {
    const a = seo.analyzeContent({ title: '', body: '', tags: '' });
    assert.equal(typeof a.score, 'number'); assert.ok(!Number.isNaN(a.score));
  });
  test('T13 missing body does not crash description', () => {
    assert.doesNotThrow(() => seo.generateMetaDescription({ title: 'x' }));
  });
  test('T14 normal post still gives correct values (no regression)', () => {
    const m = seo.generateSEOMetadata({ ...base, slug: 'odisha-yojana', created_at: 1761600000, updated_at: 1761600000 });
    assert.equal(m.canonicalUrl, 'https://virall.in/post/odisha-yojana');
    assert.equal(m.publishDate, '2025-10-27T21:20:00.000Z');
    assert.ok(m.title.length <= 60);
  });
});
