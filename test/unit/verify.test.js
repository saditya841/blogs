import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  tok, shingles, devDigits, normNums, numbersIn,
  groundedCheck, entailPrompt, parseEntail,
  numbersNotIn, latinNotIn,
  chunkArticle, expectedClaims,
  cleanSlug, slugFrom,
} from '../../src/verify.js';

describe('text helpers', () => {
  test('tok keeps Devanagari letters and splits punctuation', () => {
    assert.deepEqual(tok('मोदी ने कहा, "अच्छी खबर!"'), ['मोदी', 'ने', 'कहा', 'अच्छी', 'खबर']);
  });

  test('shingles builds the expected number of word runs', () => {
    assert.deepEqual([...shingles(['a', 'b', 'c', 'd'], 3)], ['a b c', 'b c d']);
    assert.equal(shingles(['a', 'b'], 3).size, 0);
  });

  test('Devanagari digits are converted, so both scripts compare equal', () => {
    assert.equal(devDigits('१२३'), '123');
    assert.deepEqual(numbersIn('१२,००० और 12,000'), ['12000', '12000']);
  });

  test('normNums removes Indian digit-group commas', () => {
    assert.equal(normNums('2,12,000'), '212000');
  });
});

describe('groundedCheck — a claim is trusted only with real evidence', () => {
  const notes = 'The company reported a profit of 12000 rupees in the quarter ending March 2025.';
  const line = (claim, evidence) => `CLAIM: ${claim} || EVIDENCE: ${evidence}`;

  test('a claim whose evidence appears in the notes passes', () => {
    const [c] = groundedCheck(line('Profit was 12000 rupees', 'reported a profit of 12000 rupees'), notes);
    assert.equal(c.ok, true, c.why);
  });

  test('evidence that is not in the notes fails', () => {
    const [c] = groundedCheck(line('Profit was 12000 rupees', 'the company lost money this year'), notes);
    assert.equal(c.ok, false);
    assert.match(c.why, /nahi mila/);
  });

  test('a number missing from the evidence fails even if the evidence is real', () => {
    const [c] = groundedCheck(line('Profit was 99000 rupees', 'reported a profit of 12000 rupees'), notes);
    assert.equal(c.ok, false);
    assert.match(c.why, /99000/);
  });

  test('a claim number that appears nowhere in the notes fails (must be in its own evidence)', () => {
    const [c] = groundedCheck(line('Profit was 12000 rupees in 2024', 'reported a profit of 12000 rupees'), notes);
    assert.equal(c.ok, false);
    assert.match(c.why, /2024/);
  });

  test('a year only needs to appear somewhere in the notes', () => {
    const [c] = groundedCheck(line('This happened in 2025', 'reported a profit of 12000 rupees'), notes);
    assert.equal(c.ok, true, c.why);
  });

  test('NONE / empty evidence fails', () => {
    assert.equal(groundedCheck(line('X happened', 'NONE'), notes)[0].ok, false);
    assert.equal(groundedCheck(line('X happened', ''), notes)[0].ok, false);
  });

  test('evidence shorter than 3 words fails', () => {
    const [c] = groundedCheck(line('Profit rose', 'profit rose'), notes);
    assert.equal(c.ok, false);
    assert.match(c.why, /chhota/);
  });

  test('lines without the CLAIM/EVIDENCE shape are ignored', () => {
    assert.deepEqual(groundedCheck('just some prose', notes), []);
  });

  test('quotes around the evidence are stripped before matching', () => {
    const [c] = groundedCheck(line('Profit was 12000 rupees', '"reported a profit of 12000 rupees"'), notes);
    assert.equal(c.ok, true, c.why);
  });
});

describe('entailPrompt / parseEntail — second AI opinion', () => {
  const claims = [
    { claim: 'Profit was 12000', evidence: 'profit of 12000 rupees' },
    { claim: 'Shares rose', evidence: 'shares went up 5 percent' },
  ];

  test('prompt numbers every claim and asks for YES/NO only', () => {
    const p = entailPrompt(claims);
    assert.match(p, /1\. CLAIM: Profit was 12000/);
    assert.match(p, /2\. CLAIM: Shares rose/);
    assert.match(p, /YES.*NO/);
  });

  test('answers are parsed in order; missing answers stay null', () => {
    assert.deepEqual(parseEntail('1: YES\n2: NO', 3), [true, false, null]);
  });

  test('other numbering styles work and out-of-range numbers are ignored', () => {
    assert.deepEqual(parseEntail('1) yes\n2. NO\n9: YES', 2), [true, false]);
  });

  test('garbage output yields all null', () => {
    assert.deepEqual(parseEntail('maybe?', 2), [null, null]);
  });
});

describe('numbersNotIn — invented figures', () => {
  test('numbers found in the notes are allowed', () => {
    assert.deepEqual(numbersNotIn('12,000 log aur 500 gaadiyan', '12000 500'), []);
  });

  test('invented multi-digit numbers are reported', () => {
    assert.deepEqual(numbersNotIn('Kimat 99000 thi', 'price was 12000'), ['99000']);
  });

  test('single digits are ignored (too common)', () => {
    assert.deepEqual(numbersNotIn('5 log aaye', 'no numbers'), []);
  });

  test('at most 10 numbers are returned', () => {
    const t = Array.from({ length: 15 }, (_, i) => String(100 + i)).join(' ');
    assert.equal(numbersNotIn(t, '').length, 10);
  });
});

describe('latinNotIn — invented names/brands', () => {
  test('a Latin name missing from the notes is reported', () => {
    assert.deepEqual(latinNotIn('Ramesh ne Mumbai mein kaha', 'Ramesh was in Pune'), ['Mumbai']);
  });

  test('words that do appear in the notes are fine (case-insensitive)', () => {
    assert.deepEqual(latinNotIn('Mumbai mein baarish', 'heavy rain in mumbai'), []);
  });

  test('English posts skip a capitalised word at the start of a sentence', () => {
    assert.deepEqual(latinNotIn('Mumbai is a big city.', 'rain in pune', 'en'), []);
  });

  test('the same word is only reported once', () => {
    assert.deepEqual(latinNotIn('Mumbai aur Mumbai', 'nothing', 'hi'), ['Mumbai']);
  });
});

describe('chunkArticle — every part gets checked', () => {
  test('headline + summary travel together in the first chunk', () => {
    const chunks = chunkArticle('Title here', 'Summary here', 'Para one.\n\nPara two.');
    assert.ok(chunks[0].includes('Title here'));
    assert.ok(chunks[0].includes('Summary here'));
  });

  test('a heading stays with the paragraph after it', () => {
    const chunks = chunkArticle('T', 'S', '## Heading\n\nBody text after heading.', 40, 5);
    const joined = chunks.join('\n\n');
    const i = joined.indexOf('## Heading');
    assert.ok(i >= 0);
    assert.ok(joined.slice(i).includes('Body text after heading.'));
  });

  test('no content is lost when the article is split', () => {
    const body = Array.from({ length: 8 }, (_, i) => `Paragraph number ${i} with enough text to matter.`).join('\n\n');
    const chunks = chunkArticle('T', 'S', body, 100, 5);
    assert.ok(chunks.length > 1);
    const joined = chunks.join(' ');
    for (let i = 0; i < 8; i++) assert.ok(joined.includes(`Paragraph number ${i}`), String(i));
  });

  test('empty body still returns the headline chunk', () => {
    assert.deepEqual(chunkArticle('Only title', '', ''), ['Only title']);
  });

  test('trailing heading is not dropped', () => {
    const chunks = chunkArticle('T', 'S', 'Para.\n\n## Only a heading');
    assert.ok(chunks.join(' ').includes('## Only a heading'));
  });
});

describe('expectedClaims — how many claims the checker should return', () => {
  test('a short chunk expects at least one claim', () => {
    assert.equal(expectedClaims('ek chhota vaakya.'), 1);
  });

  test('about one claim per four sentences, capped at six', () => {
    const s = 'Yeh ek poora vaakya hai. '.repeat(8);
    assert.equal(expectedClaims(s), 2);
    const many = 'Yeh ek poora vaakya hai. '.repeat(60);
    assert.equal(expectedClaims(many), 6);
  });
});

describe('cleanSlug / slugFrom — readable URLs', () => {
  test('latin titles become a clean slug', () => {
    assert.equal(cleanSlug('Free Fire Returns to India!'), 'free-fire-returns-to-india');
  });

  test('long slugs are cut at a word boundary', () => {
    const s = cleanSlug('a'.repeat(30) + '-' + 'b'.repeat(30) + '-' + 'c'.repeat(30));
    assert.ok(s.length <= 60);
    assert.ok(!s.endsWith('-'));
  });

  test('a too-short slug is rejected instead of being used', () => {
    assert.equal(cleanSlug('ab'), '');
    assert.equal(cleanSlug('क्रिस्टल पैलेस'), '');
  });

  test('slugFrom falls back to title, tags and finally "news"', () => {
    assert.equal(slugFrom({ slug: 'my-slug' }), 'my-slug');
    assert.equal(slugFrom({ slug: '', title: 'Odisha News Today' }), 'odisha-news-today');
    assert.equal(slugFrom({ tags: 'cricket india' }), 'cricket-india');
    assert.equal(slugFrom({}), 'news');
  });
});
