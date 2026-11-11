import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { autoDraftQueue, autoDraftKeep } from '../../src/autodraft.js';

describe('autoDraftQueue — approval queue must stay small', () => {
  test('an empty or small queue allows one hourly attempt', () => {
    assert.equal(autoDraftQueue(0, {}).allowed, true);
    assert.equal(autoDraftQueue(5, { AUTO_DRAFT_QUEUE_MAX: '6' }).allowed, true);
  });

  test('a full queue stops the cron before any AI token is spent', () => {
    const q = autoDraftQueue(6, { AUTO_DRAFT_QUEUE_MAX: '6' });
    assert.equal(q.allowed, false);
    assert.equal(q.pending, 6);
    assert.match(q.reason, /queue full/i);
  });

  test('a broken value never breaks the cron', () => {
    assert.equal(autoDraftQueue('x', { AUTO_DRAFT_QUEUE_MAX: 'bad' }).allowed, true);
    assert.equal(autoDraftQueue(-3, {}).pending, 0);
  });
});

describe('autoDraftKeep — only approve-worthy drafts stay in the queue', () => {
  const businessDraft = (over = {}) => ({ ok: true, postId: 7, score: 78, business: true, businessOk: true, businessScore: 82, ...over });

  test('a passing draft is kept', () => {
    const r = autoDraftKeep(businessDraft(), {});
    assert.equal(r.keep, true);
  });

  test('a failed AI call is not kept', () => {
    const r = autoDraftKeep({ ok: false, reason: 'limit poori' }, {});
    assert.equal(r.keep, false);
    assert.match(r.reason, /limit/);
  });

  test('a business draft that fails the depth gate is auto-rejected', () => {
    const r = autoDraftKeep(businessDraft({ businessOk: false, businessScore: 42 }), {});
    assert.equal(r.keep, false);
    assert.match(r.reason, /depth gate/i);
  });

  test('a low score is auto-rejected even when the gate technically passes', () => {
    const r = autoDraftKeep(businessDraft({ score: 55 }), { AUTO_DRAFT_MIN_SCORE: '60' });
    assert.equal(r.keep, false);
    assert.match(r.reason, /55/);
  });

  test('news mode drafts are always kept once saved', () => {
    const r = autoDraftKeep({ ok: true, postId: 9, score: 40, business: false }, {});
    assert.equal(r.keep, true);
  });
});
