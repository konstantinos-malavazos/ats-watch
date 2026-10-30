import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { envVar } from '../lib/env.js';

// The project was renamed from ats-watch to job-watch. JOB_WATCH_* is the
// name; ATS_WATCH_* is still read so an existing env file keeps working.
describe('envVar()', () => {
  const NAMES = ['JOB_WATCH_ENVTEST_X', 'ATS_WATCH_ENVTEST_X'];
  let saved;

  beforeEach(() => {
    saved = {};
    for (const k of NAMES) {
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

  test('reads the new JOB_WATCH_ name', () => {
    process.env.JOB_WATCH_ENVTEST_X = 'new';
    assert.equal(envVar('ENVTEST_X'), 'new');
  });

  test('falls back to the old ATS_WATCH_ name when only it is set', () => {
    process.env.ATS_WATCH_ENVTEST_X = 'old';
    assert.equal(envVar('ENVTEST_X'), 'old');
  });

  test('the new name wins when both are set', () => {
    process.env.JOB_WATCH_ENVTEST_X = 'new';
    process.env.ATS_WATCH_ENVTEST_X = 'old';
    assert.equal(envVar('ENVTEST_X'), 'new');
  });

  test('an empty new name falls through to the old one, as || always did', () => {
    process.env.JOB_WATCH_ENVTEST_X = '';
    process.env.ATS_WATCH_ENVTEST_X = 'old';
    assert.equal(envVar('ENVTEST_X'), 'old');
  });

  test('neither set -> undefined', () => {
    assert.equal(envVar('ENVTEST_X'), undefined);
  });
});
