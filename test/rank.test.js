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
  const CFG_VARS = ['ATS_WATCH_LLM_BASE_URL', 'ATS_WATCH_LLM_MODEL', 'ATS_WATCH_LLM_MAX_TOKENS', 'ATS_WATCH_LLM_TIMEOUT_MS', 'ATS_WATCH_LLM_BATCH_SIZE'];
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

  // deepseek-v4-pro is a reasoning model: hidden reasoning tokens are drawn
  // from max_tokens before any content is emitted. A budget sized only for the
  // answer gets spent entirely on reasoning and returns empty content - which
  // is exactly what the first real run against the live API did.
  test('token budget leaves headroom for reasoning tokens', async () => {
    process.env.ATS_WATCH_LLM_API_KEY = 'sk-test';
    let seenInit;
    await rankJobs(jobs, 'p', {
      log: makeLog(),
      fetchImpl: async (_u, init) => { seenInit = init; return reply(goodBody); },
    });
    const { max_tokens } = JSON.parse(seenInit.body);
    // Measured live: a 5-job prompt burnt ~750-1020 reasoning tokens alone.
    assert.ok(max_tokens >= 2560, `budget ${max_tokens} leaves no reasoning headroom`);
  });

  test('ATS_WATCH_LLM_MAX_TOKENS overrides the computed budget', async () => {
    process.env.ATS_WATCH_LLM_API_KEY = 'sk-test';
    process.env.ATS_WATCH_LLM_MAX_TOKENS = '1234';
    let seenInit;
    await rankJobs(jobs, 'p', {
      log: makeLog(),
      fetchImpl: async (_u, init) => { seenInit = init; return reply(goodBody); },
    });
    assert.equal(JSON.parse(seenInit.body).max_tokens, 1234);
  });

  // The first real 23-job run took 2m37s: a reasoning model on a large batch
  // blows straight through a one-minute timeout.
  test('timeout is generous by default and env-overridable', async () => {
    process.env.ATS_WATCH_LLM_API_KEY = 'sk-test';
    let seenSignal;
    await rankJobs(jobs, 'p', {
      log: makeLog(),
      fetchImpl: async (_u, init) => { seenSignal = init.signal; return reply(goodBody); },
    });
    assert.ok(seenSignal instanceof AbortSignal);

    process.env.ATS_WATCH_LLM_TIMEOUT_MS = '1';
    const log = makeLog();
    const result = await rankJobs(jobs, 'p', {
      log,
      fetchImpl: async () => { const e = new Error('aborted'); e.name = 'TimeoutError'; throw e; },
    });
    assert.equal(result, null);
    assert.match(log.errors.join(' '), /timed out after 1ms/);
  });

  test('budget exhausted by reasoning -> null, and says so', async () => {
    process.env.ATS_WATCH_LLM_API_KEY = 'sk-test';
    const log = makeLog();
    const result = await rankJobs(jobs, 'p', {
      log,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ finish_reason: 'length', message: { content: '' } }] }),
      }),
    });
    assert.equal(result, null);
    assert.match(log.errors.join(' '), /budget on reasoning/);
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

describe('rankJobs() batching', () => {
  const CFG_VARS = [
    'ATS_WATCH_LLM_API_KEY', 'DEEPSEEK_API_KEY', 'ATS_WATCH_LLM_BASE_URL',
    'ATS_WATCH_LLM_MODEL', 'ATS_WATCH_LLM_MAX_TOKENS', 'ATS_WATCH_LLM_TIMEOUT_MS',
    'ATS_WATCH_LLM_BATCH_SIZE',
  ];
  let saved;

  beforeEach(() => {
    saved = {};
    for (const k of CFG_VARS) { saved[k] = process.env[k]; delete process.env[k]; }
    process.env.ATS_WATCH_LLM_API_KEY = 'sk-test';
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

  /** n jobs with distinct ids. */
  const manyJobs = (n) => Array.from({ length: n }, (_, i) =>
    makeJob({ id: `j${i}`, ats_job_id: String(i) }));

  /** A fetch that scores every posting it is handed, recording batch sizes. */
  function scoringFetch(sizes) {
    return async (_url, init) => {
      const body = JSON.parse(init.body);
      const prompt = body.messages[1].content;
      const postings = JSON.parse(prompt.slice(prompt.indexOf('['), prompt.lastIndexOf(']') + 1));
      sizes.push(postings.length);
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: JSON.stringify({
          rankings: postings.map((p) => ({ id: p.id, score: 5, rationale: 'ok', red_flags: [] })),
        }) } }] }),
        text: async () => '',
      };
    };
  }

  test('20 jobs go out as a single request', async () => {
    const sizes = [];
    const result = await rankJobs(manyJobs(20), 'p', { log: makeLog(), fetchImpl: scoringFetch(sizes) });
    assert.deepEqual(sizes, [20]);
    assert.equal(result.size, 20);
  });

  test('41 jobs are split into batches of at most 20 and merged', async () => {
    const sizes = [];
    const log = makeLog();
    const result = await rankJobs(manyJobs(41), 'p', { log, fetchImpl: scoringFetch(sizes) });
    assert.deepEqual(sizes, [20, 20, 1]);
    assert.equal(result.size, 41, 'every job appears exactly once in the merged map');
    assert.ok(log.infos.some((i) => /3 batches of up to 20/.test(i)));
  });

  test('every job is scored exactly once across batches', async () => {
    const sizes = [];
    const jobs = manyJobs(45);
    const result = await rankJobs(jobs, 'p', { log: makeLog(), fetchImpl: scoringFetch(sizes) });
    for (const j of jobs) assert.ok(result.has(j.id), `${j.id} missing from merged map`);
    assert.equal(sizes.reduce((a, b) => a + b, 0), 45, 'no posting sent twice');
  });

  test('ATS_WATCH_LLM_BATCH_SIZE overrides the default', async () => {
    process.env.ATS_WATCH_LLM_BATCH_SIZE = '5';
    const sizes = [];
    await rankJobs(manyJobs(12), 'p', { log: makeLog(), fetchImpl: scoringFetch(sizes) });
    assert.deepEqual(sizes, [5, 5, 2]);
  });

  test('one failing batch does not sink the others', async () => {
    const log = makeLog();
    let call = 0;
    const good = scoringFetch([]);
    const result = await rankJobs(manyJobs(40), 'p', {
      log,
      fetchImpl: async (url, init) => {
        if (++call === 1) return { ok: false, status: 500, text: async () => 'boom' };
        return good(url, init);
      },
    });
    assert.equal(result.size, 20, 'the surviving batch is still returned');
    assert.ok(log.warns.some((w) => /1 of 2 batches failed/.test(w)));
    assert.ok(log.warns.some((w) => /scored 20 of 40/.test(w)));
  });

  test('every batch failing returns null, as the unranked fallback', async () => {
    const log = makeLog();
    const result = await rankJobs(manyJobs(40), 'p', {
      log, fetchImpl: async () => { throw new Error('network down'); },
    });
    assert.equal(result, null);
  });

  test('a batch that silently drops entries is warned about', async () => {
    const log = makeLog();
    const result = await rankJobs(manyJobs(20), 'p', {
      log,
      fetchImpl: async (_url, init) => {
        const prompt = JSON.parse(init.body).messages[1].content;
        const postings = JSON.parse(prompt.slice(prompt.indexOf('['), prompt.lastIndexOf(']') + 1));
        const short = postings.slice(0, 17).map((p) => ({ id: p.id, score: 4, rationale: 'x', red_flags: [] }));
        return {
          ok: true,
          status: 200,
          json: async () => ({ choices: [{ message: { content: JSON.stringify({ rankings: short }) } }] }),
          text: async () => '',
        };
      },
    });
    assert.equal(result.size, 17);
    assert.ok(log.warns.some((w) => /returned 17 of 20 postings/.test(w)));
  });

  test('batches go out sequentially, not concurrently', async () => {
    let inFlight = 0, maxInFlight = 0;
    const good = scoringFetch([]);
    await rankJobs(manyJobs(60), 'p', {
      log: makeLog(),
      fetchImpl: async (url, init) => {
        maxInFlight = Math.max(maxInFlight, ++inFlight);
        await new Promise((r) => setImmediate(r));
        inFlight--;
        return good(url, init);
      },
    });
    assert.equal(maxInFlight, 1);
  });
});

// A truncated response is the one failure a retry can fix: the answer did not
// fit in max_tokens, and half a batch is half an answer. On 2026-09-03 the
// day's last batch of 8 was cut off, and because rankJobs gave up on it, all 8
// jobs printed unranked - which walked them straight past --min-score 7.
describe('rankJobs() split-on-truncation', () => {
  const CFG_VARS = [
    'ATS_WATCH_LLM_API_KEY', 'DEEPSEEK_API_KEY', 'ATS_WATCH_LLM_BASE_URL',
    'ATS_WATCH_LLM_MODEL', 'ATS_WATCH_LLM_MAX_TOKENS', 'ATS_WATCH_LLM_TIMEOUT_MS',
    'ATS_WATCH_LLM_BATCH_SIZE',
  ];
  let saved;

  beforeEach(() => {
    saved = {};
    for (const k of CFG_VARS) { saved[k] = process.env[k]; delete process.env[k]; }
    process.env.ATS_WATCH_LLM_API_KEY = 'sk-test';
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

  const manyJobs = (n) => Array.from({ length: n }, (_, i) =>
    makeJob({ id: `j${i}`, ats_job_id: String(i) }));

  function postingsOf(init) {
    const prompt = JSON.parse(init.body).messages[1].content;
    return JSON.parse(prompt.slice(prompt.indexOf('['), prompt.lastIndexOf(']') + 1));
  }

  /** Truncates any request carrying more than `limit` postings; scores the rest. */
  function truncateAbove(limit, sizes) {
    return async (_url, init) => {
      const postings = postingsOf(init);
      sizes.push(postings.length);
      if (postings.length > limit) {
        return {
          ok: true,
          status: 200,
          // Cut off mid-answer, exactly as the live failure looked.
          json: async () => ({ choices: [{
            finish_reason: 'length',
            message: { content: '{"rankings":[{"id":"j0","score":5,"rationale":"cut' },
          }] }),
          text: async () => '',
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
          rankings: postings.map((p) => ({ id: p.id, score: 5, rationale: 'ok', red_flags: [] })),
        }) } }] }),
        text: async () => '',
      };
    };
  }

  test('a cut-off batch is halved and retried until it fits', async () => {
    const sizes = [];
    const log = makeLog();
    const result = await rankJobs(manyJobs(8), 'p', { log, fetchImpl: truncateAbove(4, sizes) });
    assert.deepEqual(sizes, [8, 4, 4], 'the 8 is retried as two 4s');
    assert.equal(result.size, 8, 'no job is lost to the truncation');
    assert.ok(log.warns.some((w) => /retrying as 4 \+ 4/.test(w)));
  });

  test('splitting recurses until the batch fits', async () => {
    const sizes = [];
    const result = await rankJobs(manyJobs(8), 'p', { log: makeLog(), fetchImpl: truncateAbove(2, sizes) });
    assert.deepEqual(sizes, [8, 4, 2, 2, 4, 2, 2]);
    assert.equal(result.size, 8);
  });

  test('a single posting that still truncates is not retried forever', async () => {
    const sizes = [];
    const log = makeLog();
    const result = await rankJobs(manyJobs(2), 'p', { log, fetchImpl: truncateAbove(0, sizes) });
    assert.deepEqual(sizes, [2, 1, 1], 'bottoms out at one posting per request');
    assert.equal(result, null, 'nothing was rankable, so the caller prints unranked');
  });

  test('a non-truncation failure is NOT retried - a smaller batch cannot fix it', async () => {
    const sizes = [];
    const log = makeLog();
    const result = await rankJobs(manyJobs(8), 'p', {
      log,
      fetchImpl: async (_u, init) => {
        sizes.push(postingsOf(init).length);
        return { ok: false, status: 401, text: async () => 'bad key' };
      },
    });
    assert.deepEqual(sizes, [8], 'one request, no split');
    assert.equal(result, null);
  });

  test('the token budget grows with the batch on both terms', async () => {
    const budgets = [];
    const capture = async (_url, init) => {
      const body = JSON.parse(init.body);
      budgets.push(body.max_tokens);
      const postings = postingsOf(init);
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
          rankings: postings.map((p) => ({ id: p.id, score: 5, rationale: 'ok', red_flags: [] })),
        }) } }] }),
        text: async () => '',
      };
    };
    process.env.ATS_WATCH_LLM_BATCH_SIZE = '8';
    await rankJobs(manyJobs(8), 'p', { log: makeLog(), fetchImpl: capture });
    // 2048 headroom + 300/job reasoning + 512 + 400/job answer.
    assert.equal(budgets[0], 2048 + 300 * 8 + 512 + 400 * 8);
    assert.ok(budgets[0] > 5760, 'above the budget that failed live on 8 jobs');
  });
});
