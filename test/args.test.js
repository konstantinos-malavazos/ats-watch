import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseCliArgs } from '../lib/args.js';

describe('parseCliArgs() defaults', () => {
  test('no flags -> sane defaults', () => {
    const opts = parseCliArgs([]);
    assert.equal(opts.dryRun, false);
    assert.equal(opts.since, null);
    assert.ok(opts.companiesPath.endsWith('companies.json'));
    assert.equal(opts.statePath, null);
    assert.equal(opts.limit, null);
    assert.equal(opts.quiet, false);
    assert.equal(opts.noRank, false);
    assert.equal(opts.help, false);
  });
});

describe('boolean flags', () => {
  test('--dry-run', () => {
    assert.equal(parseCliArgs(['--dry-run']).dryRun, true);
  });

  test('--quiet', () => {
    assert.equal(parseCliArgs(['--quiet']).quiet, true);
  });

  test('--no-rank', () => {
    assert.equal(parseCliArgs(['--no-rank']).noRank, true);
  });

  test('--help / -h', () => {
    assert.equal(parseCliArgs(['--help']).help, true);
    assert.equal(parseCliArgs(['-h']).help, true);
  });
});

describe('--since', () => {
  test('ISO date form (YYYY-MM-DD)', () => {
    const opts = parseCliArgs(['--since', '2026-08-01']);
    assert.equal(opts.since, new Date('2026-08-01').toISOString());
  });

  test('full ISO-8601 form', () => {
    const opts = parseCliArgs(['--since', '2026-08-01T12:00:00Z']);
    assert.equal(opts.since, '2026-08-01T12:00:00.000Z');
  });

  test('relative form: days', () => {
    const opts = parseCliArgs(['--since', '7d']);
    const expected = new Date();
    expected.setUTCDate(expected.getUTCDate() - 7);
    // compare to the minute to avoid test-clock flakiness
    assert.equal(opts.since.slice(0, 16), expected.toISOString().slice(0, 16));
  });

  test('relative form: weeks', () => {
    const opts = parseCliArgs(['--since', '2w']);
    const expected = new Date();
    expected.setUTCDate(expected.getUTCDate() - 14);
    assert.equal(opts.since.slice(0, 16), expected.toISOString().slice(0, 16));
  });

  test('relative form: months', () => {
    const opts = parseCliArgs(['--since', '1m']);
    const expected = new Date();
    expected.setUTCMonth(expected.getUTCMonth() - 1);
    assert.equal(opts.since.slice(0, 16), expected.toISOString().slice(0, 16));
  });

  test('invalid --since throws', () => {
    assert.throws(() => parseCliArgs(['--since', 'not-a-date']));
  });
});

describe('--limit', () => {
  test('valid positive integer', () => {
    assert.equal(parseCliArgs(['--limit', '5']).limit, 5);
  });

  test('invalid (non-numeric) --limit throws', () => {
    assert.throws(() => parseCliArgs(['--limit', 'abc']));
  });

  test('invalid (zero) --limit throws', () => {
    assert.throws(() => parseCliArgs(['--limit', '0']));
  });

  test('invalid (negative) --limit throws', () => {
    assert.throws(() => parseCliArgs(['--limit', '-3']));
  });
});

describe('unknown flags', () => {
  test('an unrecognised option throws', () => {
    assert.throws(() => parseCliArgs(['--totally-unknown']));
  });
});

describe('--companies / --state', () => {
  test('--companies overrides the default path', () => {
    const opts = parseCliArgs(['--companies', './somewhere/companies.json']);
    assert.ok(opts.companiesPath.endsWith('somewhere/companies.json'));
  });

  test('--state overrides the default (null) state path', () => {
    const opts = parseCliArgs(['--state', './somewhere/state.json']);
    assert.ok(opts.statePath.endsWith('somewhere/state.json'));
  });
});
