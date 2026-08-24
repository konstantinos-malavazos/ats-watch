import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isWellFormed } from '../lib/schema.js';
import * as greenhouse from '../lib/adapters/greenhouse.js';
import * as lever from '../lib/adapters/lever.js';
import * as ashby from '../lib/adapters/ashby.js';
import * as workable from '../lib/adapters/workable.js';

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

describe('salary mapping', () => {
  const leverCompany = { name: 'Test Co', ats: 'lever', token: 'testco' };
  const leverRows = lever.parse(loadFixture('lever.json'), leverCompany);

  test('lever maps a stated salaryRange', () => {
    const row = leverRows.find((r) => r.ats_job_id === 'lev-1008');
    assert.ok(row);
    assert.equal(row.salary, 'EUR 75,000-95,000/yr');
  });

  test('lever renders the all-zero placeholder as empty', () => {
    const row = leverRows.find((r) => r.ats_job_id === 'lev-1009');
    assert.ok(row);
    assert.equal(row.salary, '');
  });

  test('lever leaves salary empty when there is no salaryRange at all', () => {
    const row = leverRows.find((r) => r.ats_job_id === 'lev-1001');
    assert.ok(row);
    assert.equal(row.salary, '');
  });

  test('greenhouse leaves salary empty: the live response carries no pay field', () => {
    const rows = greenhouse.parse(loadFixture('greenhouse.json'), COMPANY);
    assert.ok(rows.length > 0);
    assert.ok(rows.every((r) => r.salary === ''));
  });

  test('salary is part of the schema on every row', () => {
    assert.ok(leverRows.every((r) => typeof r.salary === 'string'));
    assert.ok(leverRows.every((r) => isWellFormed(r)));
  });
});


// Both fixtures below are REAL responses (ramp's Ashby board, blueground's
// Workable account, fetched 2026-08-24) with descriptions truncated for
// reviewability, plus two hand-added rows each for edge cases the live boards
// did not happen to contain. Unlike the older SYNTHETIC fixtures, these prove
// the shape as well as the parsing.
describe('ashby adapter', () => {
  const COMPANY_ASHBY = { name: 'Ramp', ats: 'ashby', token: 'ramp' };
  const rows = ashby.parse(loadFixture('ashby.json'), COMPANY_ASHBY);

  test('parses and every row is well-formed and tagged ats=ashby', () => {
    assert.ok(rows.length > 0);
    for (const row of rows) {
      assert.ok(isWellFormed(row), `not well-formed: ${JSON.stringify(row)}`);
      assert.equal(row.ats, 'ashby');
    }
  });

  test('builds the documented URL and asks for compensation', () => {
    assert.equal(
      ashby.buildUrl('ramp'),
      'https://api.ashbyhq.com/posting-api/job-board/ramp?includeCompensation=true',
    );
  });

  test('isListed:false is dropped, and so is a row with no title', () => {
    assert.ok(!rows.some((r) => r.ats_job_id === 'synthetic-unlisted'));
    assert.ok(!rows.some((r) => r.ats_job_id === 'synthetic-no-title'));
  });

  test('salary comes through as the already-formatted range', () => {
    const row = rows.find((r) => r.ats_job_id === '34413f8d-26bf-4bbc-8ade-eb309a0e2245');
    assert.ok(row);
    assert.equal(row.salary, '$211.4K - $290.6K');
  });

  test('falls back to the tier summary when the scrapeable field is null', () => {
    // This internship posting leaves scrapeableCompensationSalarySummary null
    // but does publish a tier summary. Real row, real null.
    const row = rows.find((r) => r.ats_job_id === '67fadb77-43d8-4449-954b-d4cf2c6d3b8b');
    assert.ok(row);
    assert.equal(row.salary, '$11.7K per month');
  });

  test('a posting with no published range at all gets an empty salary', () => {
    const [row] = ashby.parse({ jobs: [{
      id: 'nopay', title: 'No Pay Stated', location: 'Remote',
      publishedAt: '2026-08-01T00:00:00.000+00:00',
      jobUrl: 'https://jobs.ashbyhq.com/x/nopay', descriptionPlain: 'x',
      compensation: { scrapeableCompensationSalarySummary: null, compensationTierSummary: null },
    }] }, COMPANY_ASHBY);
    assert.equal(row.salary, '');
  });

  test('secondary locations are appended to the primary one', () => {
    const row = rows.find((r) => r.ats_job_id === '34413f8d-26bf-4bbc-8ade-eb309a0e2245');
    assert.match(row.location, /^New York, NY \(HQ\);/);
    assert.ok(row.location.includes('Remote (US)'), row.location);
  });

  test("isRemote wins over a workplaceType that does not say 'Remote'", () => {
    // Ramp tags this Hybrid but flags isRemote true; the two disagree and we
    // trust the more permissive signal, as the Lever adapter does.
    const row = rows.find((r) => r.ats_job_id === '34413f8d-26bf-4bbc-8ade-eb309a0e2245');
    assert.equal(row.remote, true);
  });

  test('an OnSite posting with no remote signal is not marked remote', () => {
    const row = rows.find((r) => r.ats_job_id === '6a20b3b8-8111-4cbd-be4b-423b60660738');
    assert.equal(row.remote, false);
  });

  test('publishedAt with an offset normalises to ISO UTC', () => {
    for (const row of rows) assert.match(row.posted_at, /^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  test('an empty board yields no rows rather than throwing', () => {
    assert.deepEqual(ashby.parse({ jobs: [], apiVersion: '1' }, COMPANY_ASHBY), []);
    assert.deepEqual(ashby.parse(null, COMPANY_ASHBY), []);
  });
});

describe('workable adapter', () => {
  const COMPANY_WORKABLE = { name: 'Blueground', ats: 'workable', token: 'blueground' };
  const rows = workable.parse(loadFixture('workable.json'), COMPANY_WORKABLE);

  test('parses and every row is well-formed and tagged ats=workable', () => {
    assert.ok(rows.length > 0);
    for (const row of rows) {
      assert.ok(isWellFormed(row), `not well-formed: ${JSON.stringify(row)}`);
      assert.equal(row.ats, 'workable');
    }
  });

  test('builds the public widget URL with details=true', () => {
    assert.equal(
      workable.buildUrl('blueground'),
      'https://apply.workable.com/api/v1/widget/accounts/blueground?details=true',
    );
  });

  test('keys on shortcode, not the frequently-empty code field', () => {
    assert.ok(rows.some((r) => r.ats_job_id === '0FD01ABC66'));
  });

  test('a row with no title is dropped', () => {
    assert.ok(!rows.some((r) => r.ats_job_id === 'NOTITLE01'));
  });

  test('city, region and country are joined, and duplicates collapse', () => {
    // The flat city/state/country fields and the locations[] entry describe
    // the same place here, so the result is one location, not two.
    const row = rows.find((r) => r.ats_job_id === '3C3D8183F6');
    assert.ok(row);
    assert.equal(row.location, 'Athens, Attica, Greece');
  });

  test('a second, genuinely different location is kept alongside the first', () => {
    const [row] = workable.parse({ jobs: [{
      title: 'Two Places', shortcode: 'TWO01', url: 'https://apply.workable.com/j/TWO01',
      published_on: '2026-08-20', city: 'Athens', state: 'Attica', country: 'Greece',
      locations: [
        { country: 'Greece', city: 'Athens', region: 'Attica', hidden: false },
        { country: 'Netherlands', city: 'Amsterdam', region: null, hidden: false },
      ],
      description: '<p>x</p>',
    }] }, COMPANY_WORKABLE);
    assert.equal(row.location, 'Athens, Attica, Greece; Amsterdam, Netherlands');
  });

  test('a hidden location is not leaked into the location string', () => {
    const row = rows.find((r) => r.ats_job_id === 'HIDDEN01');
    assert.ok(row);
    assert.equal(row.location, '');
  });

  test('telecommuting drives the remote flag', () => {
    assert.equal(rows.find((r) => r.ats_job_id === '0FD01ABC66').remote, true);
    assert.equal(rows.find((r) => r.ats_job_id === '3C3D8183F6').remote, false);
  });

  test('a bare YYYY-MM-DD published_on becomes ISO UTC', () => {
    const row = rows.find((r) => r.ats_job_id === '0FD01ABC66');
    assert.equal(row.posted_at, '2026-08-18T00:00:00.000Z');
  });

  test('description HTML is reduced to text', () => {
    const row = rows.find((r) => r.ats_job_id === 'HIDDEN01');
    assert.equal(row.raw_description, 'Location withheld by the employer.');
  });

  test('Workable states no pay, so salary is always empty', () => {
    for (const row of rows) assert.equal(row.salary, '');
  });

  test('an empty account yields no rows rather than throwing', () => {
    assert.deepEqual(workable.parse({ jobs: [] }, COMPANY_WORKABLE), []);
    assert.deepEqual(workable.parse(null, COMPANY_WORKABLE), []);
  });
});
