import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runAI, modelList, thinkLess, RETRY_CAP, MAX_MODELS, MultiAPIManager } from '../../src/ai.js';

const msg = [{ role: 'user', content: 'hello' }];

describe('modelList / thinkLess', () => {
  test('the env model comes first and duplicates are removed', () => {
    const list = modelList({ AI_MODEL: '@cf/openai/gpt-oss-20b' });
    assert.equal(list[0], '@cf/openai/gpt-oss-20b');
    assert.equal(new Set(list).size, list.length);
  });

  test('a custom model is added and the list is never empty', () => {
    assert.ok(modelList({ AI_MODEL: 'custom-model' }).includes('custom-model'));
    assert.ok(modelList({}).length > 0);
  });

  test('gpt-oss gets low reasoning effort, other models get thinking disabled', () => {
    assert.deepEqual(thinkLess('@cf/openai/gpt-oss-20b'), { reasoning: { effort: 'low' } });
    assert.deepEqual(thinkLess('some/model'), { chat_template_kwargs: { enable_thinking: false } });
  });

  test('the retry cap is above the default token budget and only two models are tried', () => {
    assert.ok(RETRY_CAP > 1200);
    assert.equal(MAX_MODELS, 2);
  });
});

describe('runAI — Cloudflare Workers AI backup', () => {
  test('a missing AI binding is reported, never thrown', async () => {
    const r = await runAI({}, msg);
    assert.equal(r.text, '');
    assert.equal(r.provider, 'none');
    assert.ok(r.errors.some((e) => /AI binding missing/.test(e)));
  });

  test('a model that rejects the thinking flag is retried without it', async () => {
    let calls = 0;
    const env = {
      AI: {
        run: async () => {
          calls++;
          if (calls === 1) throw new Error('extras not supported');
          return { response: 'hello world' };
        },
      },
    };
    const r = await runAI(env, msg);
    assert.equal(r.text, 'hello world');
    assert.equal(r.model, modelList(env)[0]);
    assert.equal(r.provider, 'workers-ai');
    assert.ok(r.errors.some((e) => /thinkLess nahi chala/.test(e)));
  });

  test('a length-truncated empty answer is retried with more tokens', async () => {
    const maxes = [];
    const env = {
      AI: {
        run: async (_model, args) => {
          maxes.push(args.max_tokens);
          return maxes.length === 1 ? { response: '', status: 'length' } : { response: 'complete' };
        },
      },
    };
    const r = await runAI(env, msg, { max_tokens: 100 });
    assert.equal(r.text, 'complete');
    assert.deepEqual(maxes, [100, 150]);
  });

  test('the next model is tried when the first one fails', async () => {
    const env = {
      AI: {
        run: async (model) => {
          if (model === 'bad') throw new Error('boom');
          return { choices: [{ message: { content: [{ text: 'a' }, { text: 'b' }] }, finish_reason: 'stop' }] };
        },
      },
    };
    const r = await runAI(env, msg, { models: ['bad', 'good'] });
    assert.equal(r.text, 'ab');
    assert.equal(r.model, 'good');
    assert.ok(r.errors.some((e) => /bad: boom/.test(e)));
  });

  test('an OpenAI-style response is understood', async () => {
    const env = { AI: { run: async () => ({ choices: [{ message: { content: 'plain text' }, finish_reason: 'stop' }], usage: { completion_tokens: 7 } }) } };
    const r = await runAI(env, msg, { models: ['m'] });
    assert.equal(r.text, 'plain text');
    assert.equal(r.tokens, 7);
  });

  test('USE_MULTI_API=true falls back to Workers AI and keeps both error lists', async () => {
    const r = await runAI({ USE_MULTI_API: 'true' }, msg);
    assert.equal(r.text, '');
    assert.equal(r.provider, 'none');
    assert.ok(r.errors.some((e) => /groq: API key not configured/.test(e)));
    assert.ok(r.errors.some((e) => /AI binding missing/.test(e)));
  });
});

describe('MultiAPIManager is exported for the admin dashboard', () => {
  test('it can be constructed with an empty env', () => {
    assert.ok(new MultiAPIManager({}) instanceof MultiAPIManager);
  });
});
