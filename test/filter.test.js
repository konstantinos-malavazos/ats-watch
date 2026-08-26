import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { filterSince, applyLimit, filterByScore, filterTitles, titleVerdict } from '../lib/filter.js';

function makeJob(overrides = {}) {
  return {
    id: 'id1', ats: 'greenhouse', company: 'Acme', company_token: 'acme',
    ats_job_id: '1', title: 'Engineer', location: '', remote: false,
    url: 'https://x', posted_at: '2026-08-20T00:00:00Z', raw_description: '',
    ...overrides,
  };
}

describe('filterSince()', () => {
  const cutoff = '2026-08-20T00:00:00Z';

  test('keeps jobs with null posted_at', () => {
    const jobs = [makeJob({ posted_at: null })];
    assert.equal(filterSince(jobs, cutoff).length, 1);
  });

  test('drops jobs older than the cutoff', () => {
    const jobs = [makeJob({ posted_at: '2026-08-19T23:59:59Z' })];
    assert.equal(filterSince(jobs, cutoff).length, 0);
  });

  test('keeps jobs exactly equal to the cutoff', () => {
    const jobs = [makeJob({ posted_at: cutoff })];
    assert.equal(filterSince(jobs, cutoff).length, 1);
  });

  test('keeps jobs newer than the cutoff', () => {
    const jobs = [makeJob({ posted_at: '2026-08-21T00:00:00Z' })];
    assert.equal(filterSince(jobs, cutoff).length, 1);
  });

  test('null sinceIso -> no filtering at all', () => {
    const jobs = [makeJob({ posted_at: '2020-01-01T00:00:00Z' }), makeJob({ posted_at: null })];
    assert.equal(filterSince(jobs, null).length, 2);
  });

  test('a mix of old, new, and null posted_at filters correctly', () => {
    const jobs = [
      makeJob({ ats_job_id: 'old', posted_at: '2020-01-01T00:00:00Z' }),
      makeJob({ ats_job_id: 'new', posted_at: '2027-01-01T00:00:00Z' }),
      makeJob({ ats_job_id: 'unknown', posted_at: null }),
    ];
    const kept = filterSince(jobs, cutoff).map((j) => j.ats_job_id);
    assert.deepEqual(kept.sort(), ['new', 'unknown']);
  });
});

describe('applyLimit()', () => {
  const jobs = [makeJob({ ats_job_id: '1' }), makeJob({ ats_job_id: '2' }), makeJob({ ats_job_id: '3' })];

  test('caps the list length', () => {
    assert.equal(applyLimit(jobs, 2).length, 2);
  });

  test('limit larger than the list returns the whole list', () => {
    assert.equal(applyLimit(jobs, 100).length, 3);
  });

  test('null limit means no cap', () => {
    assert.equal(applyLimit(jobs, null).length, 3);
  });

  test('limit of 0 is falsy and treated as no cap', () => {
    assert.equal(applyLimit(jobs, 0).length, 3);
  });
});

describe('filterByScore()', () => {
  const jobs = [
    makeJob({ id: 'hi', ats_job_id: 'hi' }),
    makeJob({ id: 'lo', ats_job_id: 'lo' }),
    makeJob({ id: 'none', ats_job_id: 'none' }),
  ];
  const ranks = new Map([
    ['hi', { score: 8, rationale: '', red_flags: [] }],
    ['lo', { score: 3, rationale: '', red_flags: [] }],
  ]);

  test('drops jobs scored below the cutoff', () => {
    const kept = filterByScore(jobs, ranks, 7).map((j) => j.id);
    assert.deepEqual(kept, ['hi', 'none']);
  });

  test('keeps a job scored exactly at the cutoff', () => {
    const at = new Map([['hi', { score: 7, rationale: '', red_flags: [] }]]);
    assert.equal(filterByScore([jobs[0]], at, 7).length, 1);
  });

  test('keeps jobs the ranker returned no entry for', () => {
    const kept = filterByScore([jobs[2]], ranks, 10).map((j) => j.id);
    assert.deepEqual(kept, ['none']);
  });

  test('null ranks filters nothing', () => {
    assert.equal(filterByScore(jobs, null, 9).length, 3);
  });

  test('a null or zero cutoff filters nothing', () => {
    assert.equal(filterByScore(jobs, ranks, null).length, 3);
    assert.equal(filterByScore(jobs, ranks, 0).length, 3);
  });
});

describe('titleVerdict()', () => {
  test('drops go-to-market titles that carry an engineering word', () => {
    for (const t of [
      'Enterprise Sales Engineer - Nordics',
      'Principal Presales Customer Engineer',
      'Consulting Architect - Observability',
      'Staff Forward Deployed Engineer',
      'Solutions Architect, EMEA',
    ]) assert.equal(titleVerdict(t), 'drop', t);
  });

  test('drops back-office titles', () => {
    for (const t of [
      'Strategic Account Executive', 'Sales Development Representative',
      'Senior Recruiter', 'Deal Desk Analyst', 'Lead Legal Counsel, Employment (EMEA)',
      'Senior FP&A Analyst', 'Staff HRIS Analyst', 'Enterprise Customer Success Manager',
    ]) assert.equal(titleVerdict(t), 'drop', t);
  });

  test('an engineering word rescues a title from the back-office list', () => {
    for (const t of [
      'Senior Frontend Engineer, Marketing Website',
      'Marketing AI Engineer',
      'Senior Software Engineer, Billing and Finance',
    ]) assert.equal(titleVerdict(t), 'keep', t);
  });

  test('keeps plain engineering titles', () => {
    for (const t of [
      'Staff Backend Engineer, Developer Experience', 'Senior Software Engineer',
      'Site Reliability Engineer', 'Principal Security Engineer',
    ]) assert.equal(titleVerdict(t), 'keep', t);
  });

  test('an unrecognised title is KEPT, not dropped', () => {
    for (const t of [
      'AI Transformation Owner', 'Field CTO (Japan)', 'Group Product Manager, Cloud Security',
      'Distinguished Architect, AI', 'Country Manager', '',
    ]) assert.equal(titleVerdict(t), 'keep', t);
  });
});

describe('filterTitles()', () => {
  test('splits the list and leaves the kept order alone', () => {
    const jobs = [
      makeJob({ ats_job_id: '1', title: 'Senior Software Engineer' }),
      makeJob({ ats_job_id: '2', title: 'Strategic Account Executive' }),
      makeJob({ ats_job_id: '3', title: 'Staff Platform Engineer' }),
    ];
    assert.deepEqual(filterTitles(jobs).map((j) => j.ats_job_id), ['1', '3']);
  });

  test('logs every dropped title', () => {
    const lines = [];
    const log = { info: (m) => lines.push(m), warn: () => {}, error: () => {} };
    filterTitles([makeJob({ title: 'Enterprise Sales Engineer' })], { log });
    assert.ok(lines.some((l) => l.includes('Enterprise Sales Engineer')));
  });
});
