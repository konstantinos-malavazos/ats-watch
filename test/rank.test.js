import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { parseRankingResponse, buildUserPrompt, rankJobs, SYSTEM_PROMPT } from '../lib/rank.js';

function makeJob(overrides = {}) {
  return {
    id: 'id1', ats: 'greenhouse', company: 'Acme', company_token: 'acme',
    ats_job_id: '1', title: 'Engineer', location: 'Austin, TX', remote: false,
    url: 'https://x', posted_at: '2026-08-20T00:00:00Z', raw_description: 'desc', salary: '',
    ...overrides,
  };
}

describe('parseRankingResponse()', () => {
  const jobs = [makeJob({ id: 'a' }), makeJob({ id: 'b', ats_job_id: '2' })];

  test('clean JSON object with a rankings array', () => {
    const text = JSON.stringify({ rankings: [
      { id: 'a', score: 8, rationale: 'strong fit', red_flags: [] },
      { id: 'b', score: 3, rationale: 'meh', red_flags: ['seniority mismatch'] },
    ] });
    const out = parseRankingResponse(text, jobs);
    assert.equal(out.get('a').score, 8);
    assert.equal(out.get('b').red_flags[0], 'seniority mismatch');
  });

  test('response wrapped in ```json fences', () => {
    const text = '```json\n' + JSON.stringify({ rankings: [{ id: 'a', score: 7, rationale: 'x', red_flags: [] }] }) + '\n```';
    const out = parseRankingResponse(text, jobs);
    assert.equal(out.get('a').score, 7);
  });

  test('prose before and after the JSON', () => {
    const text = `Here is the ranking:\n${JSON.stringify({ rankings: [{ id: 'a', score: 6, rationale: 'y', red_flags: [] }] })}\nHope that helps!`;
    const out = parseRankingResponse(text, jobs);
    assert.equal(out.get('a').score, 6);
  });

  test('a bare array instead of the wrapper object', () => {
    const text = JSON.stringify([{ id: 'a', score: 4, rationale: 'z', red_flags: [] }]);
    const out = parseRankingResponse(text, jobs);
    assert.equal(out.get('a').score, 4);
  });

  test('scores out of range are clamped to 0-10', () => {
    const text = JSON.stringify({ rankings: [
      { id: 'a', score: 99, rationale: '', red_flags: [] },
      { id: 'b', score: -5, rationale: '', red_flags: [] },
    ] });
    const out = parseRankingResponse(text, jobs);
    assert.equal(out.get('a').score, 10);
    assert.equal(out.get('b').score, 0);
  });

  test('a non-numeric score becomes 0', () => {
    const text = JSON.stringify({ rankings: [{ id: 'a', score: 'not a number', rationale: '', red_flags: [] }] });
    const out = parseRankingResponse(text, jobs);
    assert.equal(out.get('a').score, 0);
  });

  test('red_flags given as a bare string is wrapped in an array', () => {
    const text = JSON.stringify({ rankings: [{ id: 'a', score: 5, rationale: '', red_flags: 'contract-only' }] });
    const out = parseRankingResponse(text, jobs);
    assert.deepEqual(out.get('a').red_flags, ['contract-only']);
  });

  test('entries with ids not in the job list are ignored', () => {
    const text = JSON.stringify({ rankings: [
      { id: 'a', score: 5, rationale: '', red_flags: [] },
      { id: 'unknown-id', score: 9, rationale: '', red_flags: [] },
    ] });
    const out = parseRankingResponse(text, jobs);
    assert.equal(out.size, 1);
    assert.equal(out.has('unknown-id'), false);
  });

  test('duplicate ids keep the first', () => {
    const text = JSON.stringify({ rankings: [
      { id: 'a', score: 1, rationale: 'first', red_flags: [] },
      { id: 'a', score: 9, rationale: 'second', red_flags: [] },
    ] });
    const out = parseRankingResponse(text, jobs);
    assert.equal(out.get('a').score, 1);
    assert.equal(out.get('a').rationale, 'first');
  });

  test('total garbage -> null', () => {
    assert.equal(parseRankingResponse('this is not json at all {{{', jobs), null);
  });

  test('empty string -> null', () => {
    assert.equal(parseRankingResponse('', jobs), null);
  });
});

describe('buildUserPrompt()', () => {
  test('includes the profile text and every job id', () => {
    const jobs = [makeJob({ id: 'job-a' }), makeJob({ id: 'job-b', ats_job_id: '2' })];
    const prompt = buildUserPrompt('I want backend roles in Austin', jobs);
    assert.ok(prompt.includes('I want backend roles in Austin'));
    assert.ok(prompt.includes('job-a'));
    assert.ok(prompt.includes('job-b'));
  });

  test('truncates a very long description', () => {
    const longDesc = 'x'.repeat(5000);
    const jobs = [makeJob({ id: 'job-a', raw_description: longDesc })];
    const prompt = buildUserPrompt('profile', jobs);
    assert.ok(!prompt.includes('x'.repeat(5000)));
    assert.ok(prompt.includes('...'));
  });
});

describe('rankJobs()', () => {
  const KEY_VARS = ['ATS_WATCH_LLM_API_KEY', 'DEEPSEEK_API_KEY'];
  const CFG_VARS = ['ATS_WATCH_LLM_BASE_URL', 'ATS_WATCH_LLM_MODEL'];
  let saved;

  beforeEach(() => {
    saved = {};
    for (const k of [...KEY_VARS, ...CFG_VARS]) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  function makeLog() {
    const warns = [], errors = [], infos = [];
    return {
      warns, errors, infos,
      warn: (...a) => warns.push(a.join(' ')),
      error: (...a) => errors.push(a.join(' ')),
      info: (...a) => infos.push(a.join(' ')),
    };
  }

  function reply(content) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content } }] }),
      text: async () => content,
    };
  }

  const jobs = [makeJob({ id: 'a' }), makeJob({ id: 'b', ats_job_id: '2' })];
  const goodBody = JSON.stringify({ rankings: [
    { id: 'a', score: 9, rationale: 'strong fit', red_flags: [] },
    { id: 'b', score: 2, rationale: 'weak', red_flags: ['onsite only'] },
  ] });

  test('no API key -> null, warns, and makes no request', async () => {
    const log = makeLog();
    let called = false;
    const result = await rankJobs(jobs, 'profile', {
      log, fetchImpl: async () => { called = true; return reply(goodBody); },
    });
    assert.equal(result, null);
    assert.equal(called, false, 'must not call the provider without a key');
    assert.equal(log.warns.length, 1);
    assert.match(log.warns[0], /API_KEY/);
  });

  test('happy path returns a Map of rankings', async () => {
    process.env.ATS_WATCH_LLM_API_KEY = 'sk-test';
    const log = makeLog();
    const result = await rankJobs(jobs, 'profile', { log, fetchImpl: async () => reply(goodBody) });
    assert.ok(result instanceof Map);
    assert.equal(result.size, 2);
    assert.equal(result.get('a').score, 9);
    assert.deepEqual(result.get('b').red_flags, ['onsite only']);
    assert.equal(log.errors.length, 0);
  });

  test('sends bearer auth, the configured model, and both prompt roles', async () => {
    process.env.ATS_WATCH_LLM_API_KEY = 'sk-secret';
    process.env.ATS_WATCH_LLM_MODEL = 'deepseek-v4-pro';
    let seenUrl, seenInit;
    await rankJobs(jobs, 'MY PROFILE', {
      log: makeLog(),
      fetchImpl: async (url, init) => { seenUrl = url; seenInit = init; return reply(goodBody); },
    });
    assert.equal(seenUrl, 'https://api.deepseek.com/v1/chat/completions');
    assert.equal(seenInit.method, 'POST');
    assert.equal(seenInit.headers.authorization, 'Bearer sk-secret');
    const body = JSON.parse(seenInit.body);
    assert.equal(body.model, 'deepseek-v4-pro');
    assert.equal(body.messages[0].role, 'system');
    assert.equal(body.messages[1].role, 'user');
    assert.match(body.messages[1].content, /MY PROFILE/);
  });

  test('respects a custom base URL and strips its trailing slash', async () => {
    process.env.ATS_WATCH_LLM_API_KEY = 'sk-test';
    process.env.ATS_WATCH_LLM_BASE_URL = 'http://localhost:8080/';
    let seenUrl;
    await rankJobs(jobs, 'p', {
      log: makeLog(),
      fetchImpl: async (url) => { seenUrl = url; return reply(goodBody); },
    });
    assert.equal(seenUrl, 'http://localhost:8080/v1/chat/completions');
  });

  test('falls back to DEEPSEEK_API_KEY', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-fallback';
    let seenInit;
    const result = await rankJobs(jobs, 'p', {
      log: makeLog(),
      fetchImpl: async (_u, init) => { seenInit = init; return reply(goodBody); },
    });
    assert.ok(result instanceof Map);
    assert.equal(seenInit.headers.authorization, 'Bearer sk-fallback');
  });

  // Every failure below must return null rather than throw: a broken ranker
  // must never lose the day's jobs.
  test('non-2xx -> null, logs the status', async () => {
    process.env.ATS_WATCH_LLM_API_KEY = 'sk-test';
    const log = makeLog();
    const result = await rankJobs(jobs, 'p', {
      log,
      fetchImpl: async () => ({ ok: false, status: 401, text: async () => 'bad key' }),
    });
    assert.equal(result, null);
    assert.match(log.errors[0], /401/);
  });

  test('network throw -> null, does not reject', async () => {
    process.env.ATS_WATCH_LLM_API_KEY = 'sk-test';
    const log = makeLog();
    const result = await rankJobs(jobs, 'p', {
      log, fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
    });
    assert.equal(result, null);
    assert.match(log.errors[0], /ECONNREFUSED/);
  });

  test('timeout -> null with a timeout message', async () => {
    process.env.ATS_WATCH_LLM_API_KEY = 'sk-test';
    const log = makeLog();
    const result = await rankJobs(jobs, 'p', {
      log,
      fetchImpl: async () => { const e = new Error('aborted'); e.name = 'TimeoutError'; throw e; },
    });
    assert.equal(result, null);
    assert.match(log.errors[0], /timed out/);
  });

  test('unparseable model output -> null', async () => {
    process.env.ATS_WATCH_LLM_API_KEY = 'sk-test';
    const log = makeLog();
    const result = await rankJobs(jobs, 'p', {
      log, fetchImpl: async () => reply('I am afraid I cannot do that.'),
    });
    assert.equal(result, null);
    assert.equal(log.errors.length, 1);
  });

  test('empty message content -> null', async () => {
    process.env.ATS_WATCH_LLM_API_KEY = 'sk-test';
    const log = makeLog();
    const result = await rankJobs(jobs, 'p', {
      log, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ choices: [] }) }),
    });
    assert.equal(result, null);
  });

  test('empty job list -> null without a request', async () => {
    process.env.ATS_WATCH_LLM_API_KEY = 'sk-test';
    let called = false;
    const result = await rankJobs([], 'p', {
      log: makeLog(), fetchImpl: async () => { called = true; return reply(goodBody); },
    });
    assert.equal(result, null);
    assert.equal(called, false);
  });

  test('partial scoring warns but still returns what it got', async () => {
    process.env.ATS_WATCH_LLM_API_KEY = 'sk-test';
    const log = makeLog();
    const partial = JSON.stringify({ rankings: [{ id: 'a', score: 7, rationale: 'ok', red_flags: [] }] });
    const result = await rankJobs(jobs, 'p', { log, fetchImpl: async () => reply(partial) });
    assert.equal(result.size, 1);
    assert.ok(log.warns.some((w) => /scored 1 of 2/.test(w)));
  });

  test('the API key never reaches the logger', async () => {
    process.env.ATS_WATCH_LLM_API_KEY = 'sk-super-secret-value';
    const log = makeLog();
    await rankJobs(jobs, 'p', {
      log, fetchImpl: async () => ({ ok: false, status: 500, text: async () => 'boom' }),
    });
    const all = [...log.warns, ...log.errors, ...log.infos].join(' ');
    assert.ok(!all.includes('sk-super-secret-value'));
  });
});

describe('salary reaches the ranker', () => {
  test('a stated salary is passed through to the prompt', () => {
    const prompt = buildUserPrompt('profile', [makeJob({ id: 'a', salary: 'EUR 75,000-95,000/yr' })]);
    assert.match(prompt, /EUR 75,000-95,000\/yr/);
  });

  test('an unstated salary is passed as null, not an empty string', () => {
    const prompt = buildUserPrompt('profile', [makeJob({ id: 'a', salary: '' })]);
    const postings = JSON.parse(prompt.slice(prompt.indexOf('['), prompt.lastIndexOf(']') + 1));
    assert.equal(postings[0].salary, null);
  });

  test('the system prompt tells the model that null salary means unknown, not low', () => {
    assert.match(SYSTEM_PROMPT, /null means unknown, NOT low/i);
  });
});
