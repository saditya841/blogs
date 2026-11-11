import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  runDebate, roleMessages, judgeMessages, debateProviders, rotateProviders, debateMeta, debateBrief, DEBATE_ROLES
} from '../../src/debate.js';

const sources = [
  { source: 'Outlook', title: 'Metro approved', url: 'https://a.example/1', text: 'The board approved the new metro plan on Monday. The project will cost 1200 crore rupees.' },
  { source: 'Bhaskar', title: 'Metro plan cleared', url: 'https://b.example/2', text: 'On Monday the board approved the new metro plan. Officials said the project will cost 1200 crore rupees.' },
  { source: 'Wire', title: 'Opposition reacts', url: 'https://c.example/3', text: 'The opposition criticised the metro plan and demanded a review.' }
];

const roleReply = `- The board cleared the plan on Monday.\n- Two outlets give the same cost figure.\nCLAIM: Board approved the metro plan || EVIDENCE: the board approved the new metro plan\nCLAIM: Project will cost 1200 crore rupees || EVIDENCE: the project will cost 1200 crore rupees`;

const judgeReply = `CLAIM: Board approved the metro plan || EVIDENCE: the board approved the new metro plan || SUPPORT: reporter,analyst
CLAIM: Project will cost 1200 crore rupees || EVIDENCE: the project will cost 1200 crore rupees || SUPPORT: reporter,analyst
CLAIM: Opposition criticised the metro plan || EVIDENCE: the opposition criticised the metro plan || SUPPORT: skeptic
CLAIM: Chief minister skipped the meeting || EVIDENCE: the chief minister skipped the meeting || SUPPORT: skeptic`;

const isJudge = (messages) => /strict judge/i.test(String(messages?.[0]?.content || ''));

const fakeAI = (judgeText = judgeReply) => async (env, messages) => ({
  text: isJudge(messages) ? judgeText : roleReply,
  provider: isJudge(messages) ? 'judge-provider' : 'role-provider',
  model: 'fake',
  errors: []
});

describe('debate roles are safe (no real politicians)', () => {
  test('roles are neutral analyst roles only', () => {
    assert.deepEqual(DEBATE_ROLES.map((r) => r.id), ['reporter', 'analyst', 'skeptic']);
    assert.ok(!DEBATE_ROLES.some((r) => /neta|minister|politician|party/i.test(r.name)));
  });

  test('role prompt forbids quotes, fake names and first-person politician speech', () => {
    const m = roleMessages({}, { topic: { query: 'Metro plan' }, sources, role: DEBATE_ROLES[0] });
    const text = m.map((x) => x.content).join('\n');
    assert.match(text, /NOT a politician/i);
    assert.match(text, /Never invent quotes/i);
    assert.match(text, /EVIDENCE/);
  });

  test('judge prompt tells the AI to cross-examine and reject unsupported claims', () => {
    const m = judgeMessages({}, { topic: { query: 'Metro plan' }, sources, roles: [{ id: 'reporter', name: 'Reporter', text: roleReply }] });
    const text = m.map((x) => x.content).join('\n');
    assert.match(text, /cross-examine/i);
    assert.match(text, /Reject any claim/i);
    assert.match(text, /SUPPORT/);
  });
});

describe('provider assignment', () => {
  test('only configured providers are used', () => {
    assert.deepEqual(debateProviders({ GROQ_API_KEY: 'x', GEMINI_API_KEY: 'y' }), ['groq', 'gemini']);
    assert.deepEqual(debateProviders({}), []);
  });

  test('DEBATE_PROVIDER_ORDER is respected and missing keys are skipped', () => {
    assert.deepEqual(debateProviders({ DEBATE_PROVIDER_ORDER: 'cohere,groq,gemini', GROQ_API_KEY: 'x', COHERE_API_KEY: 'z' }), ['cohere', 'groq']);
  });

  test('roles start from different providers (real multi-AI)', () => {
    assert.deepEqual(rotateProviders(['groq', 'gemini', 'cohere'], 0), ['groq', 'gemini', 'cohere']);
    assert.deepEqual(rotateProviders(['groq', 'gemini', 'cohere'], 1), ['gemini', 'cohere', 'groq']);
    assert.deepEqual(rotateProviders([], 2), []);
  });
});

describe('runDebate — debate + judge + code-checked ledger', () => {
  test('two-source claims are verified, one-source claim is single-source', async () => {
    const d = await runDebate({ MIN_AGREE_SOURCES: '2', DEBATE_ROUNDS: '1' }, {
      topic: { query: 'Metro plan' }, sources, runAI: fakeAI()
    });
    assert.equal(d.ok, true);
    assert.equal(d.roles.filter((r) => r.ok).length, 3);
    assert.equal(d.judge.ok, true);
    assert.equal(d.ledger.stats.verified, 2);
    assert.equal(d.ledger.stats.singleSource, 1);
    assert.equal(d.ledger.stats.unsupported, 1);
    assert.deepEqual(d.ledger.verified.map((x) => x.claim).sort(), ['Board approved the metro plan', 'Project will cost 1200 crore rupees']);
  });

  test('the writer block only contains the checked ledger', async () => {
    const d = await runDebate({ MIN_AGREE_SOURCES: '2' }, { topic: { query: 'Metro plan' }, sources, runAI: fakeAI() });
    const brief = debateBrief(d.ledger);
    assert.match(brief, /VERIFIED CLAIMS/);
    assert.match(brief, /SINGLE-SOURCE CLAIMS/);
    assert.match(brief, /NOT ALLOWED/);
  });

  test('if the judge fails, role claims are still code-verified (no dead end)', async () => {
    const noJudge = async (env, messages) => ({
      text: isJudge(messages) ? '' : roleReply,
      provider: 'role-provider', model: 'fake', errors: isJudge(messages) ? ['judge timeout'] : []
    });
    const d = await runDebate({ MIN_AGREE_SOURCES: '2', DEBATE_ROUNDS: '1' }, {
      topic: { query: 'Metro plan' }, sources, runAI: noJudge
    });
    assert.equal(d.ok, true);
    assert.equal(d.judge.ok, false);
    assert.equal(d.ledger.stats.verified, 2);
    assert.ok(d.errors.some((e) => /judge/i.test(e)));
  });

  test('with DEBATE_ROUNDS=0 there is no judge call but the ledger still works', async () => {
    let judgeCalls = 0;
    const spy = async (env, messages) => {
      if (isJudge(messages)) judgeCalls++;
      return { text: isJudge(messages) ? judgeReply : roleReply, provider: 'fake', model: 'fake', errors: [] };
    };
    const d = await runDebate({ MIN_AGREE_SOURCES: '2', DEBATE_ROUNDS: '0' }, {
      topic: { query: 'Metro plan' }, sources, runAI: spy
    });
    assert.equal(judgeCalls, 0);
    assert.equal(d.ok, true);
    assert.equal(d.judge.ok, false);
    assert.equal(d.ledger.stats.verified, 2);
  });

  test('no sources -> clear fail, no throw', async () => {
    const d = await runDebate({}, { topic: { query: 'X' }, sources: [], runAI: fakeAI() });
    assert.equal(d.ok, false);
    assert.match(d.reason, /source/i);
    assert.equal(d.ledger.stats.total, 0);
  });

  test('fewer than two AI answers -> clear fail, no throw', async () => {
    const dead = async () => ({ text: '', provider: null, model: null, errors: ['down'] });
    const d = await runDebate({}, { topic: { query: 'Metro plan' }, sources, runAI: dead });
    assert.equal(d.ok, false);
    assert.match(d.reason, /2 chahiye|role/i);
    assert.equal(d.roles.length, 3);
  });

  test('a throwing runAI is caught', async () => {
    const boom = async () => { throw new Error('provider exploded'); };
    const d = await runDebate({}, { topic: { query: 'Metro plan' }, sources, runAI: boom });
    assert.equal(d.ok, false);
    assert.ok(d.errors.length > 0);
  });
});

describe('debateMeta — D1-safe summary', () => {
  test('keeps stats, roles and a compact ledger', async () => {
    const d = await runDebate({ MIN_AGREE_SOURCES: '2' }, { topic: { query: 'Metro plan' }, sources, runAI: fakeAI() });
    const m = debateMeta(d);
    assert.equal(m.ok, true);
    assert.equal(m.stats.verified, 2);
    assert.equal(m.roles.length, 3);
    assert.equal(m.ledger.verified.length, 2);
    assert.ok(m.roles.every((r) => r.text.length <= 700));
  });
});
