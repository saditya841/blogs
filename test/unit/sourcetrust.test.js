import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  SOURCE_TIERS,
  annotateSources,
  domainOf,
  sortByTrust,
  sourceTrust,
  trustMeta,
  trustSummary,
  trustText
} from '../../src/sourcetrust.js';

describe('domainOf — host parsing without a network call', () => {
  test('handles full URLs, bare domains and www', () => {
    assert.equal(domainOf('https://www.livemint.com/market/x'), 'livemint.com');
    assert.equal(domainOf('economictimes.indiatimes.com/markets'), 'economictimes.indiatimes.com');
    assert.equal(domainOf('  https://WWW.SEBI.GOV.IN/  '), 'sebi.gov.in');
    assert.equal(domainOf(''), '');
    assert.equal(domainOf('not a url !!!'), '');
  });
});

describe('sourceTrust — domain tiers, not a truth verdict', () => {
  test('official regulator/exchange pages score highest', () => {
    for (const u of ['https://www.sebi.gov.in/legal.html', 'https://rbi.org.in/', 'https://www.nseindia.com/companies-listing']) {
      const t = sourceTrust(u);
      assert.equal(t.kind, 'official', u);
      assert.equal(t.score, 100, u);
    }
  });

  test('financial press beats general press, reference and blogs', () => {
    assert.equal(sourceTrust('https://www.livemint.com/market').kind, 'financial');
    assert.equal(sourceTrust('https://economictimes.indiatimes.com/markets').score, 85);
    assert.equal(sourceTrust('https://www.thehindu.com/business').kind, 'general');
    assert.equal(sourceTrust('https://en.wikipedia.org/wiki/DMart').kind, 'reference');
    assert.equal(sourceTrust('https://medium.com/@someone/dmart').kind, 'blog');
    assert.equal(sourceTrust('https://www.reddit.com/r/IndiaInvestments').score, 20);
  });

  test('subdomains inherit their parent tier', () => {
    assert.equal(sourceTrust('https://markets.businessinsider.in/x').kind, 'general');
    assert.equal(sourceTrust('https://finance.yahoo.com/quote/DMART.NS').kind, 'financial');
  });

  test('company investor-relations pages are primary but self-interested', () => {
    const t = sourceTrust({ url: 'https://investor.example.com/annual-report-2024', title: 'Annual report' });
    assert.equal(t.kind, 'company');
    assert.equal(t.score, 72);
    assert.match(t.note, /self|apni hi kahani/i);
  });

  test('unknown sites are unverified, not automatically fake', () => {
    const t = sourceTrust('https://random-business-blog.example/post');
    assert.equal(t.kind, 'unknown');
    assert.equal(t.score, 40);
    assert.match(t.note, /proof ke liye akela mat use karo/i);
  });

  test('an empty link is a known unknown', () => {
    const t = sourceTrust({});
    assert.equal(t.kind, 'unknown');
    assert.equal(t.score, 35);
    assert.equal(t.host, '');
  });

  test('the tier list exposes every rank with official on top and blog at the bottom', () => {
    const byKind = Object.fromEntries(SOURCE_TIERS.map((t) => [t.kind, t.score]));
    assert.ok(byKind.official >= 95);
    assert.ok(byKind.official > byKind.financial);
    assert.ok(byKind.financial > byKind.general);
    assert.ok(byKind.general > byKind.reference);
    assert.ok(byKind.reference > byKind.aggregator);
    assert.ok(byKind.aggregator > byKind.blog);
  });
});

describe('trustSummary — strong / ok / weak in plain code', () => {
  test('official + financial + general is strong', () => {
    const s = trustSummary([
      'https://www.sebi.gov.in/legal.html',
      'https://www.livemint.com/market',
      'https://www.thehindu.com/business'
    ]);
    assert.equal(s.count, 3);
    assert.equal(s.independent, 3);
    assert.equal(s.level, 'strong');
    assert.ok(s.score >= 65);
    assert.match(trustText(s), /official/);
    assert.match(trustText(s), /financial press/);
  });

  test('one financial source plus an unknown is okay, not strong', () => {
    const s = trustSummary(['https://www.livemint.com/market', 'https://random.example/post']);
    assert.equal(s.level, 'ok');
  });

  test('Wikipedia plus a blog is weak', () => {
    const s = trustSummary(['https://en.wikipedia.org/wiki/DMart', 'https://medium.com/@x/dmart']);
    assert.equal(s.level, 'weak');
  });

  test('no sources is none, never a fake score', () => {
    const s = trustSummary([]);
    assert.equal(s.count, 0);
    assert.equal(s.score, 0);
    assert.equal(s.level, 'none');
    assert.match(trustText(s), /koi source nahi/);
  });

  test('trustMeta is compact and safe for check_json', () => {
    const m = trustMeta(trustSummary(['https://www.nseindia.com/', 'https://en.wikipedia.org/wiki/X']));
    assert.equal(m.count, 2);
    assert.equal(m.independent, 2);
    assert.ok(m.text.includes('trust'));
    assert.ok(m.strongest.host);
    assert.ok(m.weakest.host);
    assert.ok(m.counts.official >= 1);
  });
});

describe('sorting and annotation', () => {
  const sources = [
    { url: 'https://medium.com/@x/dmart', title: 'Blog take' },
    { url: 'https://www.livemint.com/market', title: 'Mint report' },
    { url: 'https://www.sebi.gov.in/legal.html', title: 'SEBI circular' }
  ];

  test('trusted sources come first and original order is stable within a tier', () => {
    const sorted = sortByTrust(sources);
    assert.equal(sorted[0].url, 'https://www.sebi.gov.in/legal.html');
    assert.equal(sorted[1].url, 'https://www.livemint.com/market');
    assert.equal(sorted[2].url, 'https://medium.com/@x/dmart');
  });

  test('annotateSources adds trust without mutating the caller', () => {
    const out = annotateSources(sources);
    assert.equal(out.length, 3);
    assert.ok(out.every((s) => s.trust && s.trust.label));
    assert.equal(sources[0].trust, undefined);
  });
});
