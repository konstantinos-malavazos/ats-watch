import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dedupe, selectNew, emptyState } from '../lib/seen.js';
import * as greenhouse from '../lib/adapters/greenhouse.js';
import * as lever from '../lib/adapters/lever.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadFixture(name) {
  return JSON.parse(readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
}

function realFixtureJobs() {
  const ghPayload = loadFixture('greenhouse.json');
  const lvPayload = loadFixture('lever.json');
  const ghJobs = greenhouse.parse(ghPayload, { name: 'GH Co', ats: 'greenhouse', token: 'ghco' });
  const lvJobs = lever.parse(lvPayload, { name: 'Lever Co', ats: 'lever', token: 'lvco' });
  return [...ghJobs, ...lvJobs];
}

function makeJob(overrides = {}) {
  return {
    id: 'x', ats: 'greenhouse', company: 'Acme', company_token: 'acme',
    ats_job_id: '1', title: 'Engineer', location: '', remote: false,
    url: 'https://x', posted_at: null, raw_description: '',
    ...overrides,
  };
}

describe('dedupe()', () => {
  test('collapses repeated tuples, first occurrence wins, order preserved', () => {
    const a = makeJob({ ats_job_id: '1', title: 'First' });
    const b = makeJob({ ats_job_id: '2', title: 'Second' });
    const aAgain = makeJob({ ats_job_id: '1', title: 'First (retitled)' });
    const out = dedupe([a, b, aAgain]);
    assert.equal(out.length, 2);
    assert.equal(out[0].title, 'First'); // first occurrence wins
    assert.equal(out[1].title, 'Second');
  });

  test('no duplicates -> unchanged length and order', () => {
    const a = makeJob({ ats_job_id: '1' });
    const b = makeJob({ ats_job_id: '2' });
    const c = makeJob({ ats_job_id: '3' });
    const out = dedupe([a, b, c]);
    assert.deepEqual(out.map((j) => j.ats_job_id), ['1', '2', '3']);
  });
});

describe('selectNew() on empty state', () => {
  test('every job is fresh; nextState has one entry per job with first_seen === last_seen === now', () => {
    const now = '2026-08-23T00:00:00.000Z';
    const jobs = [makeJob({ ats_job_id: '1' }), makeJob({ ats_job_id: '2' })];
    const { fresh, nextState, counts } = selectNew(jobs, emptyState(), now);

    assert.equal(fresh.length, 2);
    assert.equal(Object.keys(nextState.jobs).length, 2);
    for (const rec of Object.values(nextState.jobs)) {
      assert.equal(rec.first_seen, now);
      assert.equal(rec.last_seen, now);
    }
    assert.deepEqual(counts, { fetched: 2, unique: 2, fresh: 2, known: 0 });
  });
});

describe('the important one: repeated runs over real fixtures', () => {
  test('second run over the same fixtures produces zero new jobs', () => {
    const jobs = realFixtureJobs();
    assert.ok(jobs.length > 5, 'sanity: fixtures actually produced jobs');

    const first = selectNew(jobs, emptyState(), '2026-08-23T00:00:00.000Z');
    assert.equal(first.fresh.length, jobs.length);

    const second = selectNew(jobs, first.nextState, '2026-08-24T00:00:00.000Z');
    assert.equal(second.fresh.length, 0);
    assert.equal(second.counts.known, jobs.length);
  });

  test('third run after adding one genuinely new posting yields exactly that one', () => {
    const jobs = realFixtureJobs();
    const first = selectNew(jobs, emptyState(), '2026-08-23T00:00:00.000Z');

    const newPosting = makeJob({ ats: 'greenhouse', company_token: 'ghco', ats_job_id: '999999', title: 'Brand New Role' });
    const third = selectNew([...jobs, newPosting], first.nextState, '2026-08-25T00:00:00.000Z');

    assert.equal(third.fresh.length, 1);
    assert.equal(third.fresh[0].ats_job_id, '999999');
  });

  test('a retitled posting (same tuple, changed title) is not fresh on the second run, but its stored fields update', () => {
    const jobs = realFixtureJobs();
    const first = selectNew(jobs, emptyState(), '2026-08-23T00:00:00.000Z');

    const retitled = jobs.map((j, i) => (i === 0 ? { ...j, title: `${j.title} (Updated)`, url: `${j.url}?v=2` } : j));
    const second = selectNew(retitled, first.nextState, '2026-08-24T00:00:00.000Z');

    assert.equal(second.fresh.length, 0, 'retitled postings must not resurface as new');

    const key = `${jobs[0].ats}:${jobs[0].company_token}:${jobs[0].ats_job_id}`;
    const rec = second.nextState.jobs[key];
    assert.equal(rec.first_seen, '2026-08-23T00:00:00.000Z', 'first_seen is preserved');
    assert.equal(rec.last_seen, '2026-08-24T00:00:00.000Z', 'last_seen advances');
    assert.equal(rec.title, `${jobs[0].title} (Updated)`); // stored record does track the latest title/url
  });
});

describe('selectNew is pure', () => {
  test('the state object passed in is not mutated', () => {
    const jobs = realFixtureJobs();
    const seedState = selectNew(jobs, emptyState(), '2026-08-23T00:00:00.000Z').nextState;
    const before = structuredClone(seedState);

    const extra = makeJob({ ats: 'greenhouse', company_token: 'ghco', ats_job_id: 'purity-check' });
    selectNew([...jobs, extra], seedState, '2026-08-24T00:00:00.000Z');

    assert.deepEqual(seedState, before);
  });
});

describe('counts', () => {
  test('fetched/unique/fresh/known are consistent, including duplicates within one run', () => {
    const a = makeJob({ ats_job_id: '1' });
    const aDup = makeJob({ ats_job_id: '1', title: 'dup in same fetch' });
    const b = makeJob({ ats_job_id: '2' });
    const { counts } = selectNew([a, aDup, b], emptyState(), '2026-08-23T00:00:00.000Z');

    assert.equal(counts.fetched, 3);
    assert.equal(counts.unique, 2);
    assert.equal(counts.fresh, 2);
    assert.equal(counts.known, 0);
    assert.equal(counts.unique, counts.fresh + counts.known);
  });

  test('known count reflects jobs already present in prior state', () => {
    const jobs = [makeJob({ ats_job_id: '1' }), makeJob({ ats_job_id: '2' }), makeJob({ ats_job_id: '3' })];
    const first = selectNew(jobs, emptyState(), '2026-08-23T00:00:00.000Z');
    const second = selectNew(jobs, first.nextState, '2026-08-24T00:00:00.000Z');

    assert.equal(second.counts.fetched, 3);
    assert.equal(second.counts.unique, 3);
    assert.equal(second.counts.fresh, 0);
    assert.equal(second.counts.known, 3);
  });
});
