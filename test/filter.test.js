import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { filterSince, applyLimit } from '../lib/filter.js';

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
