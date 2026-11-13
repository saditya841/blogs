import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pruneUnsupportedClaims, fitSummary, repairAfterFactCheck } from '../../src/claimprune.js';

const body = [
  '## The setup',
  'DMart sells groceries at a thin margin and earns on volume. The company was started in 2002 by Radhakishan Damani in Mumbai. It listed on the stock exchange in 2017.',
  '',
  '## What the result shows',
  'The chain crossed 300 stores and its revenue kept growing every year. Analysts say the model works because of fast inventory turnover.',
].join('\n');

describe('pruneUnsupportedClaims — an unsupported fact must not stay in the article', () => {
  test('the sentence carrying the unsupported claim is removed, headings and other lines stay', () => {
    const claimList = [
      { c: 'DMart was started in 2002 by Radhakishan Damani in Mumbai', ok: false, why: 'no evidence' },
      { c: 'DMart sells groceries at a thin margin', ok: true },
    ];
    const r = pruneUnsupportedClaims(body, claimList);
    assert.equal(r.changed, true);
    assert.equal(r.removed.length, 1);
    assert.ok(!r.body.includes('Radhakishan Damani'));
    assert.ok(r.body.includes('## The setup'));
    assert.ok(r.body.includes('thin margin'));
    assert.ok(r.body.includes('## What the result shows'));
  });

  test('a claim that matches nothing is reported, not silently dropped', () => {
    const r = pruneUnsupportedClaims(body, [{ c: 'A completely unrelated statement about cricket stadiums and rain', ok: false }]);
    assert.equal(r.changed, false);
    assert.equal(r.removed.length, 0);
    assert.equal(r.unmatched.length, 1);
    assert.equal(r.body, body);
  });

  test('short or empty claim lists change nothing', () => {
    assert.equal(pruneUnsupportedClaims(body, []).changed, false);
    assert.equal(pruneUnsupportedClaims(body, null).changed, false);
    assert.equal(pruneUnsupportedClaims('', [{ c: 'x y z', ok: false }]).changed, false);
  });

  test('two claims pointing at the same sentence never delete it twice', () => {
    const claimList = [
      { c: 'The company was started in 2002 by Radhakishan Damani in Mumbai', ok: false },
      { c: 'started in 2002 by Radhakishan Damani in Mumbai', ok: false },
    ];
    const r = pruneUnsupportedClaims(body, claimList);
    assert.equal(r.removed.length, 1);
    assert.ok(r.body.includes('It listed on the stock exchange in 2017'));
  });
});

describe('fitSummary — Google shows about 160 characters', () => {
  test('a short summary is untouched', () => {
    const s = 'DMart earns on volume, not margin.';
    assert.equal(fitSummary(s), s);
  });

  test('a long summary is cut at a sentence end and stays under the limit', () => {
    const s = 'DMart sells groceries at a thin margin. It earns on volume and fast inventory turnover. The chain keeps adding stores in every city. Analysts watch the same-store sales growth every quarter.';
    const out = fitSummary(s);
    assert.ok(out.length <= 160, `length=${out.length}`);
    assert.ok(out.length < s.length);
  });

  test('a single long sentence is cut at a word, never mid-word', () => {
    const s = 'word '.repeat(60).trim();
    const out = fitSummary(s, 100);
    assert.ok(out.length <= 101);
    assert.ok(out.endsWith('…'));
    assert.ok(!out.includes('wor…'));
  });
});

describe('repairAfterFactCheck — shared by writer, deepen and the admin button', () => {
  test('it removes the line, trims the summary and updates the check record', () => {
    const draft = {
      body,
      summary: 'DMart is a case study of how thin margins plus high volume can still build one of the largest grocery businesses in India, which is why the model is taught in business schools.',
    };
    const fc = {
      claims: 2,
      supported: 1,
      unsupportedCount: 1,
      claimList: [
        { c: 'DMart was started in 2002 by Radhakishan Damani in Mumbai', ok: false },
        { c: 'DMart sells groceries at a thin margin', ok: true },
      ],
      body,
    };
    const r = repairAfterFactCheck(fc, draft);
    assert.equal(r.removed.length, 1);
    assert.equal(r.summaryTrimmed, true);
    assert.ok(draft.summary.length <= 160);
    assert.equal(fc.unsupportedCount, 0);
    assert.equal(fc.supported, 1);
    assert.equal(fc.claimList.length, 1);
    assert.equal(fc.prunedClaims.length, 1);
    assert.equal(fc.body, draft.body);
  });

  test('nothing to do leaves the draft alone', () => {
    const draft = { body: 'Short body.', summary: 'Short summary.' };
    const fc = { claimList: [{ c: 'short body', ok: true }], unsupportedCount: 0 };
    const r = repairAfterFactCheck(fc, draft);
    assert.deepEqual(r.removed, []);
    assert.equal(draft.body, 'Short body.');
    assert.equal(draft.summary, 'Short summary.');
  });
});
