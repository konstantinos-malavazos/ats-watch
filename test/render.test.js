import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderDigest, renderDiscord, renderDiscordChunks, BUDGET } from '../lib/render.js';

function makeJob(overrides = {}) {
  return {
    id: 'id1', ats: 'greenhouse', company: 'Acme', company_token: 'acme',
    ats_job_id: '1', title: 'Engineer', location: 'Austin, TX', remote: false,
    url: 'https://boards.greenhouse.io/acme/jobs/1', posted_at: '2026-08-20T00:00:00Z',
    raw_description: 'desc',
    ...overrides,
  };
}

describe('renderDigest()', () => {
  test('zero jobs -> empty string', () => {
    assert.equal(renderDigest([], null), '');
  });

  test('output contains no ANSI escape sequences', () => {
    const jobs = Array.from({ length: 5 }, (_, i) => makeJob({ id: `id${i}`, ats_job_id: String(i), title: `Role ${i}` }));
    const out = renderDigest(jobs, null);
    assert.ok(!/\x1b\[/.test(out));
  });

  test('output length stays within budget even with 60 long jobs', () => {
    const longTitle = 'A'.repeat(200);
    const ranks = new Map();
    const jobs = Array.from({ length: 60 }, (_, i) => {
      const id = `id${i}`;
      ranks.set(id, { score: i % 11, rationale: 'B'.repeat(300), red_flags: ['flag one', 'flag two', 'flag three'] });
      return makeJob({ id, ats_job_id: String(i), title: `${longTitle} ${i}` });
    });
    const out = renderDigest(jobs, ranks);
    assert.ok(out.length <= BUDGET, `length ${out.length} exceeds BUDGET ${BUDGET}`);
  });

  test('"+N more" tail appears and N is correct when not everything fits', () => {
    const longTitle = 'A'.repeat(200);
    const jobs = Array.from({ length: 60 }, (_, i) => makeJob({ id: `id${i}`, ats_job_id: String(i), title: `${longTitle} ${i}` }));
    const out = renderDigest(jobs, null);
    const m = out.match(/\+(\d+) more$/);
    assert.ok(m, `expected a "+N more" tail in:\n${out}`);
    const n = Number(m[1]);
    const shown = (out.match(/https:\/\/boards\.greenhouse\.io/g) || []).length;
    assert.equal(shown + n, jobs.length);
  });

  test('ranked mode sorts by score descending and renders the [score] prefix', () => {
    const jobs = [
      makeJob({ id: 'low', ats_job_id: 'low', title: 'Low Score Role' }),
      makeJob({ id: 'high', ats_job_id: 'high', title: 'High Score Role' }),
    ];
    const ranks = new Map([
      ['low', { score: 2, rationale: '', red_flags: [] }],
      ['high', { score: 9, rationale: '', red_flags: [] }],
    ]);
    const out = renderDigest(jobs, ranks);
    const highIdx = out.indexOf('High Score Role');
    const lowIdx = out.indexOf('Low Score Role');
    assert.ok(highIdx >= 0 && lowIdx >= 0);
    assert.ok(highIdx < lowIdx, 'higher score should render first');
    assert.ok(out.includes('[9]'));
    assert.ok(out.includes('[2]'));
  });

  test('unranked mode (ranks === null) lists every job and renders no [score] prefix', () => {
    const jobs = [makeJob({ id: 'a', ats_job_id: 'a', title: 'Role A' }), makeJob({ id: 'b', ats_job_id: 'b', title: 'Role B' })];
    const out = renderDigest(jobs, null);
    assert.ok(out.includes('Role A'));
    assert.ok(out.includes('Role B'));
    assert.ok(!/\[\d+\]/.test(out));
  });

  test('red_flags render when present', () => {
    const jobs = [makeJob({ id: 'a', ats_job_id: 'a' })];
    const ranks = new Map([['a', { score: 5, rationale: 'ok fit', red_flags: ['contract-only', 'heavy on-call'] }]]);
    const out = renderDigest(jobs, ranks);
    assert.ok(out.includes('flags: contract-only; heavy on-call'));
  });

  test('red_flags are absent from output when the array is empty', () => {
    const jobs = [makeJob({ id: 'a', ats_job_id: 'a' })];
    const ranks = new Map([['a', { score: 5, rationale: 'ok fit', red_flags: [] }]]);
    const out = renderDigest(jobs, ranks);
    assert.ok(!out.includes('flags:'));
  });

  test('a single job renders "1 new role" (singular)', () => {
    const out = renderDigest([makeJob()], null);
    assert.ok(out.startsWith('1 new role\n'));
    assert.ok(!out.startsWith('1 new roles'));
  });

  test('two jobs render "2 new roles" (plural)', () => {
    const jobs = [makeJob({ id: 'a', ats_job_id: 'a' }), makeJob({ id: 'b', ats_job_id: 'b' })];
    const out = renderDigest(jobs, null);
    assert.ok(out.startsWith('2 new roles\n'));
  });
});

describe('salary in the digest', () => {
  const job = (over = {}) => ({
    id: 'a', ats: 'lever', company: 'Acme', company_token: 'acme', ats_job_id: '1',
    title: 'Engineer', location: 'Remote - EU', remote: true,
    url: 'https://x', posted_at: null, raw_description: '', salary: '', ...over,
  });

  test('prints the salary on its own line when stated', () => {
    const out = renderDigest([job({ salary: 'EUR 75,000-95,000/yr' })], null);
    assert.ok(out.includes('\n  EUR 75,000-95,000/yr\n'), out);
  });

  test('prints no salary line when the posting states none', () => {
    const out = renderDigest([job({ salary: '' })], null);
    assert.ok(!/\n {2}[A-Z]{3} /.test(out), out);
    assert.equal(out.split('\n').filter(Boolean).length, 3); // header, title, url
  });

  test('never prints a zero range', () => {
    const out = renderDigest([job({ salary: '' }), job({ id: 'b', salary: '' })], null);
    assert.ok(!out.includes('0-0'), out);
  });

  test('salary sits above the rationale, below the title', () => {
    const ranks = new Map([['a', { score: 8, rationale: 'good fit', red_flags: [] }]]);
    const lines = renderDigest([job({ salary: 'EUR 90,000/yr' })], ranks).split('\n');
    const t = lines.findIndex((l) => l.includes('Engineer'));
    const s = lines.findIndex((l) => l.includes('EUR 90,000/yr'));
    const r = lines.findIndex((l) => l.includes('good fit'));
    assert.ok(t < s && s < r, lines.join('|'));
  });

  test('the budget still holds when every job states a salary', () => {
    const jobs = Array.from({ length: 60 }, (_, i) => job({
      id: `j${i}`, title: `Senior Staff Platform Engineer Number ${i}`,
      salary: 'EUR 120,000-160,000/yr',
    }));
    const out = renderDigest(jobs, null);
    assert.ok(out.length <= BUDGET, `digest was ${out.length} chars`);
    assert.ok(!/\x1b\[/.test(out));
  });
});

describe('renderDiscord()', () => {
  const jobs = [
    makeJob({ id: 'a', title: 'Staff Platform Engineer', company: 'n8n', remote: true,
      location: 'Greece', salary: 'EUR 127,500-175,300/yr', url: 'https://x/a' }),
    makeJob({ id: 'b', title: 'Payroll Specialist', company: 'Remote.com',
      location: 'Remote-South America', remote: true, url: 'https://x/b' }),
  ];
  const ranks = new Map([
    ['a', { score: 9, rationale: 'Greece listed, salary stated', red_flags: [] }],
    ['b', { score: 0, rationale: 'not engineering', red_flags: ['non-engineering', 'excludes EU'] }],
  ]);

  test('no jobs renders nothing', () => {
    assert.equal(renderDiscord([], ranks), '');
  });

  test('header counts the roles and the ones worth applying to', () => {
    const out = renderDiscord(jobs, ranks);
    assert.match(out, /\*\*2 new roles\*\* · 1 worth applying to/);
  });

  test('a high score reads as an instruction, not a bare number', () => {
    const out = renderDiscord(jobs, ranks);
    assert.match(out, /🟢 \*\*9\/10 · send your CV\*\*/);
    assert.match(out, /🔴 \*\*0\/10 · skip\*\*/);
  });

  test('urls are wrapped in angle brackets so Discord does not unfurl them', () => {
    const out = renderDiscord(jobs, ranks);
    assert.match(out, /\[Staff Platform Engineer\]\(<https:\/\/x\/a>\)/);
  });

  test('salary and location ride along when present', () => {
    const out = renderDiscord(jobs, ranks);
    assert.match(out, /n8n · Remote - Greece · EUR 127,500-175,300\/yr/);
  });

  test('red flags are rendered, and absent flags print no line', () => {
    const out = renderDiscord(jobs, ranks);
    assert.match(out, /⚠️ non-engineering · excludes EU/);
    assert.equal((out.match(/⚠️/g) || []).length, 1);
  });

  test('an unavailable ranker still lists every job', () => {
    const out = renderDiscord(jobs, null);
    assert.match(out, /unranked \(ranker unavailable\)/);
    assert.match(out, /Staff Platform Engineer/);
    assert.match(out, /Payroll Specialist/);
  });

  test('nothing is dropped: every job appears regardless of length', () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      makeJob({ id: `j${i}`, ats_job_id: String(i), title: `Role Number ${i}`, url: `https://x/${i}` }));
    const out = renderDiscord(many, null);
    for (let i = 0; i < 40; i++) assert.match(out, new RegExp(`Role Number ${i}\\b`));
    assert.ok(!out.includes('more'), 'must not fall back to a "+N more" tail');
  });
});

describe('renderDiscordChunks()', () => {
  test('empty in, empty out', () => {
    assert.deepEqual(renderDiscordChunks(''), []);
  });

  test('a short digest stays one message', () => {
    assert.equal(renderDiscordChunks('a\n\nb').length, 1);
  });

  test('every chunk is within the limit and nothing is lost', () => {
    const blocks = Array.from({ length: 30 }, (_, i) => `block ${i} ` + 'x'.repeat(100));
    const text = blocks.join('\n\n');
    const chunks = renderDiscordChunks(text, 500);
    assert.ok(chunks.length > 1, 'should have split');
    for (const c of chunks) assert.ok(c.length <= 500, `chunk of ${c.length} exceeds limit`);
    for (let i = 0; i < 30; i++) assert.ok(chunks.some((c) => c.includes(`block ${i} `)));
  });

  test('splits between blocks, never inside one', () => {
    const text = ['aaa', 'bbb', 'ccc'].map((s) => s.repeat(50)).join('\n\n');
    for (const c of renderDiscordChunks(text, 160)) {
      assert.ok(!/^\n|\n$/.test(c), 'chunk should not start or end mid-join');
    }
  });

  test('a single oversized block is clamped rather than dropped', () => {
    const chunks = renderDiscordChunks('y'.repeat(5000), 200);
    assert.equal(chunks.length, 1);
    assert.ok(chunks[0].length <= 200);
  });
});

describe('renderDiscord() location handling', () => {
  test('a long eligible-country list is condensed to a count', () => {
    const job = makeJob({
      id: 'a', title: 'Staff Engineer', company: 'n8n', remote: true, url: 'https://x/a',
      location: 'Berlin Office; Romania; Norway; Estonia; Latvia; Greece',
    });
    const out = renderDiscord([job], null);
    assert.match(out, /n8n · Remote - 6 locations/);
    assert.ok(!out.includes('Estonia'), 'the full list must not survive');
  });

  test('three or fewer locations are printed as-is', () => {
    const job = makeJob({ id: 'a', company: 'N26', location: 'Berlin, Barcelona', url: 'https://x/a' });
    assert.match(renderDiscord([job], null), /N26 · Berlin, Barcelona/);
  });
});
