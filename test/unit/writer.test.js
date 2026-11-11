import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  copyCheck, parseDraft, scoreDraft, ungroundedNumbers, slugify, dayStartIST, langOf, CATS,
} from '../../src/writer.js';

describe('copyCheck — copied text detection', () => {
  const source = 'the quick brown fox jumps over the lazy dog near the river bank today';

  test('a copied run of 10+ words is detected', () => {
    const article = `Yeh ek report hai. The quick brown fox jumps over the lazy dog near the river bank today. Aur aage.`;
    const r = copyCheck(article, [source]);
    assert.ok(r.longest >= 10, `longest=${r.longest}`);
    assert.ok(r.overlap > 0.3, `overlap=${r.overlap}`);
  });

  test('a fully original paraphrase is not flagged', () => {
    const article = 'Ek naya lekh jo bilkul apne shabdon mein likha gaya hai aur kisi bhi purane vakya ko nahi dohrata.';
    const r = copyCheck(article, [source]);
    assert.ok(r.longest < 10);
    assert.equal(r.overlap, 0);
  });

  test('very short text never crashes', () => {
    assert.deepEqual(copyCheck('hi', [source]), { overlap: 0, longest: 0 });
  });
});

describe('parseDraft — AI output parsing', () => {
  const text = `TITLE: Odisha mein nayi yojana shuru
SUMMARY: Sarkar ne kisanon ke liye ek nayi yojana shuru ki hai jisse unhe seedha fayda hoga.
CATEGORY: Odisha
TAGS: odisha, kisan, yojana
BODY:
Pehla paragraph yahan hai.

## Mukhya baat

Doosra paragraph yahan hai.

- bullet jo hatna chahiye`;

  const d = parseDraft(text);

  test('fields are read correctly', () => {
    assert.equal(d.title, 'Odisha mein nayi yojana shuru');
    assert.ok(d.summary.startsWith('Sarkar ne'));
    assert.equal(d.category, 'Odisha');
    assert.equal(d.tags, 'odisha, kisan, yojana');
  });

  test('body has no TITLE/SUMMARY lines and keeps ## headings', () => {
    assert.ok(!d.body.includes('TITLE:'));
    assert.ok(!d.body.includes('SUMMARY:'));
    assert.ok(d.body.includes('## Mukhya baat'));
    assert.ok(!d.body.includes('**'));
  });

  test('bullets are stripped but their text stays', () => {
    assert.ok(!/^-\s/m.test(d.body));
    assert.ok(d.body.includes('bullet jo hatna chahiye'));
  });
});

describe('scoreDraft — real quality score (never blindly 100 for a bad draft)', () => {
  const clean = { overlap: 0, longest: 0, ungrounded: [], words: 500, hasSummary: true, headings: 3, categoryOk: true };

  test('a clean draft scores 100', () => {
    assert.equal(scoreDraft(clean).score, 100);
  });

  test('copy overlap lowers the score', () => {
    const r = scoreDraft({ ...clean, overlap: 0.2 });
    assert.ok(r.score < 100);
    assert.ok(r.notes.some((n) => /Copy overlap/i.test(n)));
  });

  test('short and unstructured drafts lose points', () => {
    const r = scoreDraft({ ...clean, words: 200, headings: 1, hasSummary: false, categoryOk: false });
    assert.ok(r.score <= 70, `score=${r.score}`);
    assert.ok(r.notes.length >= 3);
  });

  test('score never goes below 0', () => {
    assert.ok(scoreDraft({ overlap: 1, longest: 100, ungrounded: [...Array(30).keys()].map(String), words: 10, headings: 0 }).score >= 0);
  });
});

describe('ungroundedNumbers — invented figures', () => {
  test('numbers in the sources are allowed (comma + Devanagari digits normalised)', () => {
    assert.deepEqual(ungroundedNumbers('Kimat 12,000 aur ५०० log', ['12000 500'], []), []);
  });

  test('a number that is nowhere in the sources is reported', () => {
    assert.deepEqual(ungroundedNumbers('Kimat 12,000 thi', ['price was 9000'], []), ['12000']);
  });

  test('single digits are ignored (too common to judge)', () => {
    assert.deepEqual(ungroundedNumbers('5 log aaye', ['no numbers here'], []), []);
  });
});

describe('slugify — readable Hindi URLs', () => {
  test('Devanagari titles keep their letters instead of becoming post-xxxxx', () => {
    const s = slugify('क्रिस्टल पैलेस बनाम न्यूकैसल');
    assert.match(s, /^[\u0900-\u097F-]+-[a-z0-9]{5}$/u);
    assert.ok(!s.startsWith('post-'));
  });

  test('English titles are still clean and unique', () => {
    const a = slugify('Free Fire Returns to India!');
    const b = slugify('Free Fire Returns to India!');
    assert.match(a, /^free-fire-returns-to-india-[a-z0-9]{5}$/);
    assert.notEqual(a, b);
  });

  test('empty title still gives a usable slug', () => {
    assert.match(slugify(''), /^post-[a-z0-9]{5}$/);
  });
});

describe('small helpers', () => {
  test('dayStartIST returns the start of the IST calendar day', () => {
    const ts = 1_800_000_000;
    const start = dayStartIST(ts);
    assert.ok(start <= ts && ts < start + 86400);
    assert.equal(start % 86400, 86400 - 19800);
  });

  test('langOf understands "eng" and "en"', () => {
    assert.equal(langOf({ POST_LANG: 'eng' }), 'en');
    assert.equal(langOf({ POST_LANG: 'en-IN' }), 'en');
    assert.equal(langOf({ POST_LANG: 'hi' }), 'hi');
    assert.equal(langOf({}), 'hi');
  });

  test('CATS is re-exported from validate.js (one source of truth)', () => {
    assert.equal(CATS.length, 10);
  });
});
