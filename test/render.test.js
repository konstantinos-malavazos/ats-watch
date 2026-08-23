import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderDigest, BUDGET } from '../lib/render.js';

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
