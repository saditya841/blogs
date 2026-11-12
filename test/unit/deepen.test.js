import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { gapReport } from '../../src/deepen.js';

const bodyWith = (headings, wordsPerSection) => headings
  .map((h) => `## ${h}\n\n${Array.from({ length: wordsPerSection }, (_, i) => `shabd${i}`).join(' ')}`)
  .join('\n\n');

describe('gapReport — existing Business post ka gap analysis (0 token)', () => {
  test('a thin draft lists every missing detail', () => {
    const g = gapReport({
      id: 1,
      title: 'Chhota draft',
      status: 'draft',
      body: '## The setup\n\nBahut chhota text hai.',
      check_json: JSON.stringify({ business: { framework: false } })
    });
    assert.equal(g.needed, true);
    const codes = g.gaps.map((x) => x.code);
    for (const c of ['words', 'sections', 'framework', 'example', 'result', 'counterpoint', 'playbook', 'risks', 'honesty', 'india']) {
      assert.ok(codes.includes(c), c);
    }
  });

  test('a detailed post with all gate fields reports no gap', () => {
    const headings = [
      'The setup', 'The money engine', 'Framework: Unit Economics', 'Worked example',
      'The counterpoint', 'Operator playbook', 'What could go wrong', 'What the result shows',
      'What is not confirmed', 'Analysis'
    ];
    const g = gapReport({
      id: 2,
      title: 'Detailed post',
      status: 'draft',
      body: bodyWith(headings, 130),
      check_json: JSON.stringify({
        business: {
          framework: true, example: true, result: true, counterpoint: true,
          playbook: true, risks: true, honesty: true, india: true
        }
      })
    });
    assert.equal(g.needed, false, JSON.stringify(g.gaps));
    assert.equal(g.gaps.length, 0);
    assert.ok(g.words >= 1200);
    assert.equal(g.headings, 10);
  });

  test('invalid check_json never crashes the report', () => {
    const g = gapReport({ id: 3, title: 'x', body: '', check_json: 'not-json' });
    assert.equal(g.needed, true);
    assert.ok(g.gaps.length > 0);
  });
});
