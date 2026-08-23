import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isWellFormed } from '../lib/schema.js';
import * as greenhouse from '../lib/adapters/greenhouse.js';
import * as lever from '../lib/adapters/lever.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMPANY = { name: 'Test Co', ats: 'greenhouse', token: 'testco' };

function loadFixture(name) {
  const text = readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
  return JSON.parse(text);
}

describe('greenhouse adapter', () => {
  const payload = loadFixture('greenhouse.json');
  const rows = greenhouse.parse(payload, COMPANY);

  test('fixture loads and parses', () => {
    assert.ok(Array.isArray(rows));
    assert.ok(rows.length > 0);
  });

  test('every returned row is well-formed and tagged ats=greenhouse', () => {
    for (const row of rows) {
      assert.ok(isWellFormed(row), `not well-formed: ${JSON.stringify(row)}`);
      assert.equal(row.ats, 'greenhouse');
    }
  });

  test('the row missing a title is dropped', () => {
    assert.ok(!rows.some((r) => r.ats_job_id === '5004'));
  });

  test('remote row: title/url/location/remote/posted_at', () => {
    const row = rows.find((r) => r.ats_job_id === '5001');
    assert.ok(row);
    assert.equal(row.title, 'Senior Platform Engineer');
    assert.equal(row.url, 'https://boards.greenhouse.io/testco/jobs/5001');
    assert.equal(row.location, 'Remote - United States');
    assert.equal(row.remote, true);
    // posted_at prefers first_published over updated_at
    assert.equal(row.posted_at, '2026-08-08T15:30:00.000Z');
  });

  test('non-remote row: title/url/location/remote/posted_at', () => {
    const row = rows.find((r) => r.ats_job_id === '5002');
    assert.ok(row);
    assert.equal(row.title, 'Front Desk Receptionist');
    assert.equal(row.location, 'Austin, TX');
    assert.equal(row.remote, false);
    assert.equal(row.posted_at, '2026-08-06T09:15:00.000Z');
  });

  test('row with a null location object does not throw and yields empty location', () => {
    const row = rows.find((r) => r.ats_job_id === '5003');
    assert.ok(row);
    assert.equal(row.location, '');
    // no first_published on this row -> falls back to updated_at
    assert.equal(row.posted_at, '2026-08-05T18:45:00.000Z');
  });

  test('double-escaped HTML description comes out as readable plain text', () => {
    const row = rows.find((r) => r.ats_job_id === '5001');
    assert.ok(row);
    assert.ok(!row.raw_description.includes('<'), `residual '<' in: ${row.raw_description}`);
    assert.ok(!row.raw_description.includes('&amp;'), `residual '&amp;' in: ${row.raw_description}`);
  });

  test('malformed payloads return [] rather than throwing', () => {
    for (const bad of [null, undefined, {}, 'a string', []]) {
      assert.deepEqual(greenhouse.parse(bad, COMPANY), []);
    }
  });
});

describe('lever adapter', () => {
  const COMPANY_LEVER = { name: 'Test Co', ats: 'lever', token: 'testco' };
  const payload = loadFixture('lever.json');
  const rows = lever.parse(payload, COMPANY_LEVER);

  test('fixture loads and parses', () => {
    assert.ok(Array.isArray(rows));
    assert.ok(rows.length > 0);
  });

  test('every returned row is well-formed and tagged ats=lever', () => {
    for (const row of rows) {
      assert.ok(isWellFormed(row), `not well-formed: ${JSON.stringify(row)}`);
      assert.equal(row.ats, 'lever');
    }
  });

  test('remote row: title/url/location/remote/posted_at', () => {
    const row = rows.find((r) => r.ats_job_id === 'lev-1001');
    assert.ok(row);
    assert.equal(row.title, 'Staff Distributed Systems Engineer');
    assert.equal(row.url, 'https://jobs.lever.co/testco/lev-1001');
    assert.equal(row.location, 'Remote');
    assert.equal(row.remote, true);
    assert.equal(row.posted_at, '2026-08-10T09:00:00.000Z');
  });

  test('non-remote row: title/url/location/remote/posted_at', () => {
    const row = rows.find((r) => r.ats_job_id === 'lev-1002');
    assert.ok(row);
    assert.equal(row.title, 'Store Operations Manager');
    assert.equal(row.location, 'Chicago, IL');
    assert.equal(row.remote, false);
    assert.equal(row.posted_at, '2026-08-09T14:20:00.000Z');
  });

  test('row with a missing categories object does not throw and yields empty location', () => {
    const row = rows.find((r) => r.ats_job_id === 'lev-1003');
    assert.ok(row);
    assert.equal(row.location, '');
    // HTML description (no descriptionPlain) is stripped, tags and entities gone
    assert.ok(!row.raw_description.includes('<'));
    assert.ok(!row.raw_description.includes('&amp;'));
    assert.ok(row.raw_description.includes('design system'));
  });

  test('url falls back to applyUrl when hostedUrl is absent', () => {
    const row = rows.find((r) => r.ats_job_id === 'lev-1004');
    assert.ok(row);
    assert.equal(row.url, 'https://jobs.lever.co/testco/lev-1004/apply');
  });

  test('remote is true when location text says remote even if workplaceType disagrees', () => {
    const row = rows.find((r) => r.ats_job_id === 'lev-1004');
    assert.ok(row);
    assert.equal(row.remote, true); // workplaceType: onsite, but location "Remote - EU"
  });

  test('explicit onsite-only posting is not remote', () => {
    const row = rows.find((r) => r.ats_job_id === 'lev-1005');
    assert.ok(row);
    assert.equal(row.remote, false);
  });

  test('malformed payloads return [] rather than throwing', () => {
    for (const bad of [null, undefined, {}, 'a string', []]) {
      assert.deepEqual(lever.parse(bad, COMPANY_LEVER), []);
    }
  });
});

// Regression: Lever leaves description/descriptionPlain empty on many postings
// and puts the prose in one of its other five text fields. Reading description
// alone produced an empty raw_description on every row of a real board
// (api.lever.co/v0/postings/ledger, verified 2026-08-23).
describe('lever description collection', () => {
  const company = { name: 'Test Co', ats: 'lever', token: 'testco' };
  const rows = lever.parse(loadFixture('lever.json'), company);

  test('falls back to salaryDescriptionPlain when description is empty', () => {
    const row = rows.find((r) => r.ats_job_id === 'lev-1006');
    assert.ok(row, 'fixture row lev-1006 should parse');
    assert.equal(row.raw_description, 'Since 2014 we have been building the secure gateway.');
  });

  test('assembles opening + body + additional when description is empty', () => {
    const row = rows.find((r) => r.ats_job_id === 'lev-1007');
    assert.ok(row);
    assert.match(row.raw_description, /We are hiring a backend engineer\./);
    assert.match(row.raw_description, /You will own the ingest pipeline\./);
    assert.match(row.raw_description, /Benefits include learning budget\./);
  });

  test('no row on the fixture board has an empty description', () => {
    const empty = rows.filter((r) => !r.raw_description);
    assert.equal(empty.length, 0, `rows with empty description: ${empty.map((r) => r.ats_job_id)}`);
  });

  test('does not duplicate text already covered by description', () => {
    const out = lever.parse([{
      id: 'dup', text: 'Role', categories: { location: 'X' },
      hostedUrl: 'https://x', createdAt: 1755000000000,
      descriptionPlain: 'Alpha beta gamma.',
      openingPlain: 'Alpha beta gamma.',
    }], company);
    assert.equal(out[0].raw_description, 'Alpha beta gamma.');
  });
});
