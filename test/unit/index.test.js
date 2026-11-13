import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import worker, { adsPub, validEmail, numText } from '../../src/index.js';

// The fetch handler is only called for routes that do not touch D1.
const call = (path, env = {}) => worker.fetch(new Request('https://virall.in' + path), { SITE_URL: 'https://virall.in', SITE_NAME: 'Virall', ...env });

describe('adsPub — accept every format the owner may paste', () => {
  test('the expected format is kept', () => {
    assert.equal(adsPub({ ADSENSE_PUB: 'pub-1234567890123456' }), 'pub-1234567890123456');
  });

  test('a full ca-pub id is normalised (no ca-ca-pub in the HTML)', () => {
    assert.equal(adsPub({ ADSENSE_PUB: 'ca-pub-1234567890123456' }), 'pub-1234567890123456');
    assert.equal(adsPub({ ADSENSE_PUB: ' CA-PUB-1234567890123456 ' }), 'pub-1234567890123456');
  });

  test('bare digits become pub-<digits>', () => {
    assert.equal(adsPub({ ADSENSE_PUB: '1234567890123456' }), 'pub-1234567890123456');
  });

  test('empty / missing gives an empty string', () => {
    assert.equal(adsPub({}), '');
    assert.equal(adsPub({ ADSENSE_PUB: '   ' }), '');
  });
});

describe('public text routes — no database needed', () => {
  test('ads.txt is a comment until ADSENSE_PUB is set', async () => {
    const r = await call('/ads.txt');
    assert.equal(r.headers.get('content-type'), 'text/plain');
    assert.equal(await r.text(), '# set ADSENSE_PUB\n');
  });

  test('ads.txt is valid with either pub or ca-pub input', async () => {
    for (const ADSENSE_PUB of ['pub-1234567890123456', 'ca-pub-1234567890123456']) {
      const r = await call('/ads.txt', { ADSENSE_PUB });
      assert.equal(await r.text(), 'google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n');
    }
  });

  test('robots.txt blocks admin/search and points at the sitemap', async () => {
    const txt = await (await call('/robots.txt')).text();
    assert.match(txt, /Disallow: \/admin/);
    assert.match(txt, /Disallow: \/search/);
    assert.match(txt, /Disallow: \/subscribe/);
    assert.match(txt, /Sitemap: https:\/\/virall\.in\/sitemap\.xml/);
  });

  test('the subscribe page has a simple email form', async () => {
    const html = await (await call('/subscribe')).text();
    assert.match(html, /action="\/subscribe"/);
    assert.match(html, /type="email"/);
    assert.match(html, /name="website"/); // honeypot
    assert.match(html, /noindex,nofollow/);
  });

  test('a successful subscription is confirmed without echoing an address', async () => {
    const html = await (await call('/subscribe?ok=1')).text();
    assert.match(html, /Subscribed/);
    assert.ok(!html.includes('reader@example.org'));
  });

  test('validEmail accepts normal addresses and rejects broken input', () => {
    assert.equal(validEmail('reader@example.com'), true);
    assert.equal(validEmail('  Reader@Example.CO.in '), true);
    assert.equal(validEmail('no-at-sign'), false);
    assert.equal(validEmail('a@b'), false);
    assert.equal(validEmail('a b@c.com'), false);
    assert.equal(validEmail(''), false);
  });

  test('numText never prints undefined in the admin UI', () => {
    assert.equal(numText(1200), 1200);
    assert.equal(numText('1200'), 1200);
    assert.equal(numText(undefined), 0);
    assert.equal(numText(null), 0);
  });

  test('IndexNow key file is served when the key is configured', async () => {
    const r = await call('/my-key.txt', { INDEXNOW_KEY: 'my-key' });
    assert.equal(await r.text(), 'my-key');
  });
});
