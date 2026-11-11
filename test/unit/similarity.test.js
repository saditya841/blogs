import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  contentTokens, hash64, simhash, hammingHex, minhash, minhashJaccard,
  fingerprint, compareFingerprints, findDuplicate, DUP_BLOCK
} from '../../src/similarity.js';

const A = 'Chief minister announced a new farm scheme in Odisha on Monday. The scheme will give 5000 rupees to every farmer.';
const A2 = 'On Monday, Odisha chief minister announced a new farm scheme. Every farmer will get 5000 rupees under the scheme.';
const B = 'India won the hockey final against Australia in Bhubaneswar. The goalkeeper saved two penalty corners.';

describe('contentTokens / hashing', () => {
  test('stopwords and bare numbers are removed', () => {
    const t = contentTokens('The board approved the new metro plan in 2026 for the city');
    assert.ok(t.includes('board'));
    assert.ok(t.includes('approved'));
    assert.ok(!t.includes('the'));
    assert.ok(!t.includes('2026'));
  });

  test('hash64 is deterministic and 64-bit', () => {
    assert.equal(hash64('hello'), hash64('hello'));
    assert.notEqual(hash64('hello'), hash64('world'));
    assert.ok(hash64('hello') <= (1n << 64n) - 1n);
  });

  test('hamming distance is 0 for the same simhash and <= 64 otherwise', () => {
    const s = simhash(A);
    assert.equal(hammingHex(s, s), 0);
    assert.ok(hammingHex(simhash(A), simhash(B)) <= 64);
  });
});

describe('minhash / simhash fingerprints', () => {
  test('the same text has Jaccard 1 and a similar simhash', () => {
    const same = minhash(A);
    assert.equal(minhashJaccard(same, same), 1);
    assert.ok(minhashJaccard(minhash(A), minhash(A2)) >= 0.7);
    assert.ok(hammingHex(simhash(A), simhash(A2)) <= 32);
  });

  test('unrelated stories are far apart', () => {
    assert.ok(minhashJaccard(minhash(A), minhash(B)) < 0.5);
    assert.ok(hammingHex(simhash(A), simhash(B)) > 8);
  });

  test('fingerprint is deterministic and has the expected shape', () => {
    const f1 = fingerprint('Odisha farm scheme', A);
    const f2 = fingerprint('Odisha farm scheme', A);
    assert.deepEqual(f1, f2);
    assert.equal(f1.minhash.length, 48);
    assert.equal(f1.simhash.length, 16);
    assert.equal(f1.titleSimhash.length, 16);
    assert.ok(f1.tokens > 10);
  });
});

describe('findDuplicate — block the same story before AI spend', () => {
  test('the same headline is an exact duplicate', () => {
    const cand = fingerprint('Odisha farm scheme announced', A);
    const r = findDuplicate(cand, [{ ...fingerprint('Odisha farm scheme announced', B), postId: 7, title: 'Old post' }]);
    assert.equal(r.duplicate, true);
    assert.equal(r.exact, true);
    assert.equal(r.against.postId, 7);
  });

  test('a rewritten copy of the same story is caught as near duplicate', () => {
    const cand = fingerprint('Odisha farm scheme for farmers', A);
    const old = { ...fingerprint('New farm scheme in Odisha', A2), postId: 9, title: 'Old post' };
    const r = findDuplicate(cand, [old]);
    assert.ok(r.score >= DUP_BLOCK, `score=${r.score}`);
    assert.equal(r.duplicate, true);
    assert.ok(r.reason.length > 0);
  });

  test('an unrelated new story is not blocked', () => {
    const cand = fingerprint('India hockey final win', B);
    const old = { ...fingerprint('Odisha farm scheme announced', A), postId: 1, title: 'Farm post' };
    const r = findDuplicate(cand, [old]);
    assert.equal(r.duplicate, false);
    assert.ok(r.score < DUP_BLOCK);
  });

  test('an empty candidate never crashes or blocks', () => {
    const r = findDuplicate(fingerprint('', ''), []);
    assert.equal(r.duplicate, false);
    assert.equal(r.against, null);
  });

  test('compare returns exact when title hashes match', () => {
    const f = fingerprint('Same headline here', A);
    const c = compareFingerprints(f, { ...f, simhash: '0000000000000000' });
    assert.equal(c.exact, true);
    assert.equal(c.score, 1);
  });
});
