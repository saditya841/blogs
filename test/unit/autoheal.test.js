import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { deriveSummary, deriveTags, normalizeTopicQuery, topicCleanupPlan } from '../../src/autoheal.js';

const NOW = 1_700_000_000;
const daysAgo = (d) => NOW - d * 86400;

const topic = (over = {}) => ({
  id: 1,
  query: 'DMart business model',
  traffic: 'business',
  status: 'ready',
  source_count: 4,
  research: JSON.stringify({ mode: 'business', heat: 'high' }),
  created_at: daysAgo(1),
  updated_at: daysAgo(1),
  ...over
});

describe('topicCleanupPlan — deterministic, 0-token cleanup', () => {
  test('caps a big ready backlog but keeps every HIGH TRAFFIC topic', () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      topic({
        id: i + 1,
        query: `business topic ${i + 1}`,
        source_count: i,
        research: JSON.stringify({ mode: 'business', heat: i < 3 ? 'high' : 'normal' }),
        updated_at: daysAgo(1 + i)
      })
    );
    const plan = topicCleanupPlan(rows, { nowSec: NOW, readyMax: 12, businessMode: true });
    assert.equal(plan.total, 20);
    assert.equal(plan.deleteCount, 8);
    assert.equal(plan.keepCount, 12);
    assert.equal(plan.readyKept, 12);
    assert.equal((plan.counts.ready_over_cap || 0) + (plan.counts.stale_ready || 0), 8);
    for (let id = 1; id <= 3; id++) assert.ok(plan.keepIds.includes(id), `high-traffic ${id} kept`);
  });

  test('deletes stale thin/rejected/duplicate topics, keeps fresh ones', () => {
    const rows = [
      topic({ id: 1, query: 'old thin', status: 'thin', updated_at: daysAgo(10) }),
      topic({ id: 2, query: 'fresh thin', status: 'thin', updated_at: daysAgo(1) }),
      topic({ id: 3, query: 'old rejected', status: 'rejected', updated_at: daysAgo(10) }),
      topic({ id: 4, query: 'old duplicate', status: 'duplicate', updated_at: daysAgo(10) }),
      topic({ id: 5, query: 'old drafted', status: 'drafted', updated_at: daysAgo(40) }),
      topic({ id: 6, query: 'fresh drafted', status: 'drafted', updated_at: daysAgo(2) })
    ];
    const plan = topicCleanupPlan(rows, { nowSec: NOW, readyMax: 100, businessMode: true });
    const reasons = Object.fromEntries(plan.deletions.map((d) => [d.id, d.reason]));
    assert.equal(reasons[1], 'stale_thin');
    assert.equal(reasons[3], 'stale_rejected');
    assert.equal(reasons[4], 'stale_duplicate');
    assert.equal(reasons[5], 'old_drafted');
    assert.ok(plan.keepIds.includes(2));
    assert.ok(plan.keepIds.includes(6));
  });

  test('business mode removes old news topics but keeps old business topics', () => {
    const rows = [
      topic({ id: 1, query: 'old news', traffic: 'news', research: '{}', updated_at: daysAgo(10) }),
      topic({ id: 2, query: 'fresh news', traffic: 'news', research: '{}', updated_at: daysAgo(1) }),
      topic({ id: 3, query: 'old business', traffic: 'business', updated_at: daysAgo(10) })
    ];
    const plan = topicCleanupPlan(rows, { nowSec: NOW, readyMax: 100, businessMode: true });
    const reasons = Object.fromEntries(plan.deletions.map((d) => [d.id, d.reason]));
    assert.equal(reasons[1], 'old_news_topic');
    assert.ok(!reasons[2]);
    assert.ok(plan.keepIds.includes(2));
    assert.ok(plan.keepIds.includes(3));
  });

  test('news mode removes old business topics', () => {
    const rows = [topic({ id: 1, query: 'old business', traffic: 'business', updated_at: daysAgo(10) })];
    const plan = topicCleanupPlan(rows, { nowSec: NOW, readyMax: 100, businessMode: false });
    assert.equal(plan.deletions[0].reason, 'old_business_topic');
  });

  test('normalised duplicate queries keep the better-researched row', () => {
    const rows = [
      topic({ id: 1, query: 'DMart: low margin?', source_count: 2 }),
      topic({ id: 2, query: 'dmart low margin', source_count: 6 })
    ];
    const plan = topicCleanupPlan(rows, { nowSec: NOW, readyMax: 100, businessMode: true });
    assert.equal(plan.deleteCount, 1);
    assert.equal(plan.deletions[0].reason, 'duplicate_query');
    assert.equal(plan.deletions[0].id, 1);
    assert.ok(plan.keepIds.includes(2));
  });

  test('normalizeTopicQuery ignores case, punctuation and extra spaces', () => {
    assert.equal(normalizeTopicQuery('  DMart: Low-Margin?  '), 'dmart low margin');
    assert.equal(normalizeTopicQuery('quick   commerce — India!'), 'quick commerce india');
    assert.equal(normalizeTopicQuery(''), '');
  });
});

describe('metadata repair — 0 token', () => {
  test('deriveSummary strips markdown and stays within the limit', () => {
    const body = '## Heading\n\n**DMart** low margin par chalti hai. Ye example hai! [Source](https://example.com).';
    const s = deriveSummary(body, 60);
    assert.ok(s.length <= 60);
    assert.ok(!s.includes('##'));
    assert.ok(!s.includes('**'));
    assert.ok(s.includes('DMart'));
    assert.ok(s.includes('Ye example hai!'));
  });

  test('deriveSummary handles an empty body', () => {
    assert.equal(deriveSummary(''), '');
    assert.equal(deriveSummary(null), '');
  });

  test('deriveTags fills 3-5 useful tags without duplicates', () => {
    const tags = deriveTags('DMart low margin business model India', 'DMart volume game explained.', 'Business');
    const list = tags.split(',').map((x) => x.trim()).filter(Boolean);
    assert.ok(list.length >= 3);
    assert.ok(list.length <= 5);
    assert.equal(new Set(list.map((x) => x.toLowerCase())).size, list.length);
    assert.ok(list.some((x) => x.toLowerCase() === 'dmart'));
  });

  test('deriveTags falls back to category/business/India for a tiny title', () => {
    const tags = deriveTags('UPI', '', 'Business');
    const list = tags.split(',').map((x) => x.trim()).filter(Boolean);
    assert.ok(list.length >= 3);
  });
});
