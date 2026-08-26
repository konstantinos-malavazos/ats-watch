import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { collapseVariants, baseTitle } from '../lib/variants.js';

function makeJob(overrides = {}) {
  return {
    id: 'id1', ats: 'greenhouse', company: 'Acme', company_token: 'acme',
    ats_job_id: '1', title: 'Engineer', location: '', remote: false,
    url: 'https://x', posted_at: null, raw_description: '', salary: '',
    ...overrides,
  };
}

describe('baseTitle()', () => {
  test('strips a trailing segment the location field confirms', () => {
    assert.equal(
      baseTitle('Staff Product Manager, OpenTelemetry | Canada | Remote', 'Canada'),
      'staff product manager - opentelemetry',
    );
  });

  test('keeps a trailing segment that is not a place', () => {
    assert.equal(
      baseTitle('Staff Backend Engineer, Search', 'Berlin'),
      'staff backend engineer - search',
    );
  });

  test('strips a regional shorthand with no location field at all', () => {
    assert.equal(baseTitle('Forward Deployed Engineer - EMEA', ''), 'forward deployed engineer');
  });

  test('never strips the whole title', () => {
    assert.equal(baseTitle('Remote', 'Remote'), 'remote');
  });
});

describe('collapseVariants()', () => {
  test('collapses one role listed per country, keeping the first', () => {
    const jobs = [
      makeJob({ id: 'a', ats_job_id: 'a', title: 'Principal PM | Spain', location: 'Spain' }),
      makeJob({ id: 'b', ats_job_id: 'b', title: 'Principal PM | Canada', location: 'Canada' }),
      makeJob({ id: 'c', ats_job_id: 'c', title: 'Principal PM | UK', location: 'UK' }),
    ];
    const { jobs: out, variants } = collapseVariants(jobs);
    assert.deepEqual(out.map((j) => j.id), ['a']);
    assert.deepEqual(variants.get('a'), { count: 3, locations: ['Spain', 'Canada', 'UK'] });
  });

  test('does not collapse different roles at the same company', () => {
    const jobs = [
      makeJob({ id: 'a', ats_job_id: 'a', title: 'Backend Engineer, Search', location: 'Berlin' }),
      makeJob({ id: 'b', ats_job_id: 'b', title: 'Backend Engineer, Payments', location: 'Berlin' }),
    ];
    const { jobs: out, variants } = collapseVariants(jobs);
    assert.equal(out.length, 2);
    assert.equal(variants.size, 0);
  });

  test('does not collapse the same title at different companies', () => {
    const jobs = [
      makeJob({ id: 'a', ats_job_id: 'a', company_token: 'acme' }),
      makeJob({ id: 'b', ats_job_id: 'b', company_token: 'globex' }),
    ];
    assert.equal(collapseVariants(jobs).jobs.length, 2);
  });

  test('a single posting produces no variant entry', () => {
    const { jobs: out, variants } = collapseVariants([makeJob()]);
    assert.equal(out.length, 1);
    assert.equal(variants.size, 0);
  });

  test('empty in, empty out', () => {
    const { jobs: out, variants } = collapseVariants([]);
    assert.deepEqual(out, []);
    assert.equal(variants.size, 0);
  });
});
