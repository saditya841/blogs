import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseClaimLines, verifyClaim, buildLedger, ledgerText, ledgerMeta, ledgerTextFromMeta
} from '../../src/claims.js';

const sources = [
  { source: 'Outlook', title: 'Metro approved', url: 'https://a.example/1', text: 'The board approved the new metro plan on Monday. The project will cost 1200 crore rupees.' },
  { source: 'Bhaskar', title: 'Metro plan cleared', url: 'https://b.example/2', text: 'On Monday the board approved the new metro plan. Officials said the project will cost 1200 crore rupees.' },
  { source: 'Wire', title: 'Opposition reacts', url: 'https://c.example/3', text: 'The opposition criticised the metro plan and demanded a review.' }
];

describe('parseClaimLines', () => {
  test('reads claim, evidence and support', () => {
    const r = parseClaimLines('CLAIM: board approved plan || EVIDENCE: the board approved the new metro plan || SUPPORT: reporter, analyst');
    assert.equal(r.length, 1);
    assert.equal(r[0].claim, 'board approved plan');
    assert.match(r[0].evidence, /board approved/);
    assert.deepEqual(r[0].support, ['reporter', 'analyst']);
  });

  test('supports single pipe and ignores noise lines', () => {
    const r = parseClaimLines('some point\nCLAIM: cost is 1200 crore | EVIDENCE: the project will cost 1200 crore rupees');
    assert.equal(r.length, 1);
    assert.deepEqual(r[0].support, []);
  });

  test('a line without EVIDENCE is ignored', () => {
    assert.deepEqual(parseClaimLines('CLAIM: something is true'), []);
  });
});

describe('verifyClaim — code decides, never the AI', () => {
  test('exact evidence found in two outlets is grounded in both', () => {
    const v = verifyClaim({ claim: 'Board approved the metro plan', evidence: 'the board approved the new metro plan' }, sources);
    assert.equal(v.ok, true);
    assert.equal(v.outlets.length, 2);
    assert.deepEqual(v.outlets.sort(), ['Bhaskar', 'Outlook']);
  });

  test('invented evidence is not grounded', () => {
    const v = verifyClaim({ claim: 'Board approved a secret deal', evidence: 'a secret deal was signed in the closed meeting' }, sources);
    assert.equal(v.ok, false);
    assert.match(v.why, /evidence|sabut/i);
  });

  test('evidence found in one outlet only is grounded but has one outlet', () => {
    const v = verifyClaim({ claim: 'Opposition criticised the plan', evidence: 'the opposition criticised the metro plan' }, sources);
    assert.equal(v.ok, true);
    assert.deepEqual(v.outlets, ['Wire']);
  });
});

describe('buildLedger — verified / single-source / unsupported', () => {
  const items = [
    { claim: 'Board approved the metro plan', evidence: 'the board approved the new metro plan', support: ['reporter', 'analyst'] },
    { claim: 'Project will cost 1200 crore rupees', evidence: 'the project will cost 1200 crore rupees', support: ['analyst'] },
    { claim: 'Opposition criticised the metro plan', evidence: 'the opposition criticised the metro plan', support: ['skeptic'] },
    { claim: 'Chief minister skipped the meeting', evidence: 'the chief minister skipped the meeting', support: ['skeptic'] }
  ];

  test('classifies every claim with source agreement', () => {
    const l = buildLedger(items, sources, { minAgree: 2 });
    assert.equal(l.stats.total, 4);
    assert.equal(l.stats.verified, 2);
    assert.equal(l.stats.singleSource, 1);
    assert.equal(l.stats.unsupported, 1);
    assert.deepEqual(l.verified.map((x) => x.claim).sort(), ['Board approved the metro plan', 'Project will cost 1200 crore rupees']);
    assert.equal(l.singleSource[0].claim, 'Opposition criticised the metro plan');
    assert.equal(l.unsupported[0].claim, 'Chief minister skipped the meeting');
  });

  test('minAgree=1 makes every grounded claim verified', () => {
    const l = buildLedger(items, sources, { minAgree: 1 });
    assert.equal(l.stats.unsupported, 1);
    assert.equal(l.stats.verified + l.stats.singleSource, 3);
    assert.ok(l.stats.verified >= 3);
  });

  test('duplicate claims are merged and outlets are combined', () => {
    const dup = buildLedger([
      { claim: 'Board approved the metro plan', evidence: 'the board approved the new metro plan' },
      { claim: 'The board approved the metro plan', evidence: 'on monday the board approved the new metro plan' }
    ], sources, { minAgree: 2 });
    assert.equal(dup.stats.total, 1);
    assert.equal(dup.stats.verified, 1);
  });

  test('empty input gives an empty ledger, no throw', () => {
    const l = buildLedger([], sources);
    assert.equal(l.stats.total, 0);
    assert.deepEqual(l.items, []);
  });

  test('same fact with different numbers in two outlets becomes a conflict, never verified', () => {
    const conflictSources = [
      { source: 'Outlook', title: 'Metro approved', url: 'https://a.example/9', text: 'The metro project will cost 1200 crore rupees and cover nine stations.' },
      { source: 'Bhaskar', title: 'Metro cleared', url: 'https://b.example/9', text: 'The metro project will cost 2100 crore rupees and cover nine stations.' }
    ];
    const l = buildLedger([
      { claim: 'The metro project will cost 1200 crore rupees', evidence: 'the metro project will cost 1200 crore rupees', support: ['reporter'] }
    ], conflictSources, { minAgree: 2 });
    assert.equal(l.stats.conflict, 1);
    assert.equal(l.stats.verified, 0);
    assert.equal(l.conflict[0].status, 'conflict');
    assert.match(l.conflict[0].conflictText, /1200 crore/);
    assert.match(l.conflict[0].conflictText, /2100 crore/);
    assert.match(ledgerText(l), /CONFLICTS/);
  });
});

describe('ledgerText / ledgerMeta — what the writer receives', () => {
  const l = buildLedger([
    { claim: 'Board approved the metro plan', evidence: 'the board approved the new metro plan' },
    { claim: 'Opposition criticised the metro plan', evidence: 'the opposition criticised the metro plan' }
  ], sources, { minAgree: 2 });

  test('verified and single-source claims are clearly separated', () => {
    const t = ledgerText(l);
    assert.match(t, /VERIFIED CLAIMS/);
    assert.match(t, /SINGLE-SOURCE CLAIMS/);
    assert.match(t, /Board approved the metro plan/);
    assert.match(t, /Opposition criticised the metro plan/);
  });

  test('meta is compact and can rebuild the writer block', () => {
    const m = ledgerMeta(l);
    assert.equal(m.stats.verified, 1);
    assert.equal(m.verified[0].c, 'Board approved the metro plan');
    const t = ledgerTextFromMeta(m);
    assert.match(t, /VERIFIED CLAIMS/);
    assert.match(t, /Board approved the metro plan/);
  });
});
