import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { classify, preflight, postflight } from '../../src/playbook.js';

const NOW = 1_800_000_000;
const HOUR = 3600;
const src = (n = 3, ageHours = 2, title = 'Odisha train accident latest update') => ({
  sources: Array.from({ length: n }, (_, i) => ({
    source: `outlet${i}`, title,
    text: `${title} from the ground, reporters said.`,
    date: NOW - ageHours * HOUR,
  })),
});

describe('classify — topic type from plain rules (0 tokens)', () => {
  test('money/health advice is blocked', () => {
    assert.equal(classify('Best stock tips for tomorrow').type, 'ymyl');
    assert.equal(classify('Diabetes ke lakshan aur ilaaj').type, 'ymyl');
  });

  test('politics and sports are recognised', () => {
    assert.equal(classify('Modi government new election plan').type, 'politics');
    assert.equal(classify('India vs Australia cricket match today').type, 'sports');
    assert.equal(classify('Bigg Boss finale episode').type, 'entertainment');
  });

  test('a 1-2 word query with no category match is treated as a person name', () => {
    // an explicit category always wins: "Narendra Modi" is handled by the stricter politics rules
    assert.equal(classify('Narendra Modi').type, 'politics');
    assert.equal(classify('Salman Khan').type, 'name_only');
  });

  test('a 3-word event is NOT mistaken for a name (it is a normal news topic)', () => {
    assert.equal(classify('Odisha train accident').type, 'general');
  });
});

describe('preflight — before spending AI tokens', () => {
  test('blocked topic type is never written', () => {
    const r = preflight({ query: 'Best stock tips for tomorrow' }, src(5), NOW);
    assert.equal(r.ok, false);
    assert.ok(/insaan likhe/i.test(r.reason));
  });

  test('too few sources stops the draft (retry later, not rejected)', () => {
    const r = preflight({ query: 'Odisha train accident' }, src(2), NOW);
    assert.equal(r.ok, false);
    assert.equal(r.retry, true);
  });

  test('sources about something else are rejected', () => {
    const rs = { sources: [{ title: 'Cricket score', text: 'India won the match', date: NOW }, { title: 'Weather', text: 'Rain in Delhi', date: NOW }, { title: 'Markets', text: 'Sensex up', date: NOW }] };
    const r = preflight({ query: 'Odisha train accident' }, rs, NOW);
    assert.equal(r.ok, false);
    assert.ok(/alag cheez/i.test(r.reason));
  });

  test('stale sources are rejected', () => {
    const r = preflight({ query: 'Odisha train accident' }, src(3, 24 * 10), NOW);
    assert.equal(r.ok, false);
    assert.ok(/purani/i.test(r.reason));
  });

  test('good, fresh, on-topic sources pass and carry the writing rules', () => {
    const r = preflight({ query: 'Odisha train accident' }, src(3), NOW);
    assert.equal(r.ok, true);
    assert.equal(r.type, 'general');
    assert.ok(Array.isArray(r.rules));
  });

  test('politics needs 4 sources and dated news', () => {
    const POL = 'Modi government election plan announced';
    assert.equal(preflight({ query: POL }, src(3, 2, POL), NOW).ok, false);
    assert.equal(preflight({ query: POL }, src(4, 2, POL), NOW).ok, true);
    const noDates = { sources: src(4, 2, POL).sources.map(({ date, ...s }) => s) };
    assert.equal(preflight({ query: POL }, noDates, NOW).ok, false);
  });
});

describe('postflight — cheap code checks after the draft', () => {
  test('three invented numbers stop the draft before the AI fact-checker', () => {
    const art = { title: 'Khabar', summary: 'Summary', body: 'Yahan 111 aur 222 aur 333 likha hai.' };
    const r = postflight(art, 'notes me koi sankhya nahi hai');
    assert.equal(r.ok, false);
    assert.ok(/sankhya/i.test(r.reason));
  });

  test('numbers that do exist in the notes are fine', () => {
    const art = { title: 'Khabar', summary: 'Summary', body: 'Yahan 111 aur 222 likha hai.' };
    assert.equal(postflight(art, 'notes: 111 222').ok, true);
  });

  test('four invented names stop the draft', () => {
    const art = { title: 'Khabar', summary: 'S', body: 'Ramesh Suresh Mahesh Dinesh ne kaha.' };
    const r = postflight(art, 'notes me sirf ek naam hai', 'hi');
    assert.equal(r.ok, false);
    assert.ok(/naam/i.test(r.reason));
  });
});
