import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isWellFormed, ATS_KINDS } from '../lib/schema.js';
import * as greenhouse from '../lib/adapters/greenhouse.js';
import * as lever from '../lib/adapters/lever.js';
import * as ashby from '../lib/adapters/ashby.js';
import * as workable from '../lib/adapters/workable.js';
import * as jobicy from '../lib/adapters/jobicy.js';
import * as remotive from '../lib/adapters/remotive.js';
import * as workingnomads from '../lib/adapters/workingnomads.js';
import * as weworkremotely from '../lib/adapters/weworkremotely.js';
import { adapterFor, ADAPTERS } from '../lib/adapters/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMPANY = { name: 'Test Co', ats: 'greenhouse', token: 'testco' };

function loadFixture(name) {
  const text = readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
  return JSON.parse(text);
}

/** A fixture read as raw text, for the RSS board. */
function loadText(name) {
  return readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
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

// Board fixtures below are REAL responses saved 2026-10-30, trimmed to a few
// postings (see each fixture's _fixture_note / README). Edge cases the live
// boards did not contain (an empty company, a URL with no id, the -05:00
// offset) are built inline here, never added to the fixtures.
//
// On a board, company and company_token come from each posting. The source
// entry's name and token must never reach a row, so each board's source uses
// values that would be easy to spot if they leaked.
describe('jobicy adapter', () => {
  const SOURCE = { name: 'Jobicy', ats: 'jobicy', token: 'count=50&geo=greece&industry=engineering' };
  const rows = jobicy.parse(loadFixture('jobicy.json'), SOURCE);
  const byId = (id) => rows.find((r) => r.ats_job_id === id);

  test('parses every fixture posting, well-formed and tagged ats=jobicy', () => {
    assert.equal(rows.length, 5);
    for (const row of rows) {
      assert.ok(isWellFormed(row), `not well-formed: ${JSON.stringify(row)}`);
      assert.equal(row.ats, 'jobicy');
    }
  });

  test('builds the documented /api/jobs URL from the token query string', () => {
    assert.equal(
      jobicy.buildUrl('count=50&geo=greece&industry=engineering'),
      'https://jobicy.com/api/jobs?count=50&geo=greece&industry=engineering',
    );
  });

  test('maps id, title, url and pubDate from a real posting', () => {
    const row = byId('157993');
    assert.ok(row);
    assert.equal(row.title, 'Staff Software Engineer');
    assert.equal(row.company, 'Bloomreach');
    assert.equal(row.url, 'https://jobicy.com/jobs/157993-staff-software-engineer-14');
    assert.equal(row.posted_at, '2026-10-30T12:34:34.000Z');
    assert.equal(row.location, 'Europe');
  });

  test('jobGeo joined by comma + two spaces comes out single-spaced', () => {
    assert.equal(byId('149734').location, 'Europe, Norway');
    assert.equal(byId('157109').location, 'EMEA, LATAM, Canada, USA');
  });

  test('every row is remote', () => {
    assert.ok(rows.every((r) => r.remote === true));
  });

  test('company_token is per posting, never the source token or name', () => {
    const tokens = new Set(rows.map((r) => r.company_token));
    assert.deepEqual([...tokens].sort(), ['bloomreach', 'enode', 'revenuecat', 'supabase', 'synthesia']);
    for (const row of rows) {
      assert.notEqual(row.company_token, SOURCE.token);
      assert.notEqual(row.company, SOURCE.name);
    }
  });

  test('salary: yearly range, min==max, missing currency, and no salary at all', () => {
    assert.equal(byId('157993').salary, 'CZK 1,520,000-1,900,000/yr');
    assert.equal(byId('157109').salary, 'USD 230,000/yr');
    assert.equal(byId('156779').salary, '180,000/yr'); // Synthesia: currency key absent
    assert.equal(byId('149734').salary, ''); // Enode: no salary keys at all
  });

  test('an hourly period prints /hr, with or without a currency', () => {
    // Shapes seen live on the geo=europe response (Ads Quality Rater rows).
    const [withCur, noCur] = jobicy.parse({ jobs: [
      { id: 157764, jobTitle: 'Rater', companyName: 'X', url: 'https://jobicy.com/jobs/157764-x',
        pubDate: '2026-10-29T08:00:00+00:00', salaryMin: 7, salaryMax: 7, salaryCurrency: 'USD', salaryPeriod: 'hourly' },
      { id: 151868, jobTitle: 'Rater', companyName: 'X', url: 'https://jobicy.com/jobs/151868-x',
        pubDate: '2026-10-29T08:00:00+00:00', salaryMin: 10, salaryMax: 10, salaryCurrency: null, salaryPeriod: 'hourly' },
    ] }, SOURCE);
    assert.equal(withCur.salary, 'USD 7/hr');
    assert.equal(noCur.salary, '10/hr');
  });

  test('description HTML is reduced to text', () => {
    const row = byId('157993');
    assert.ok(!row.raw_description.includes('<'), row.raw_description);
    assert.match(row.raw_description, /^Bloomreach is building the world’s premier agentic platform/);
  });

  test('a posting with no company name is kept as (company not listed)', () => {
    const [row] = jobicy.parse({ jobs: [
      { id: 999001, jobTitle: 'Backend Engineer', companyName: '  ', jobGeo: 'Europe',
        url: 'https://jobicy.com/jobs/999001-x', pubDate: '2026-10-29T08:00:00+00:00' },
    ] }, SOURCE);
    assert.ok(row);
    assert.equal(row.company, '(company not listed)');
    assert.equal(row.company_token, '_unlisted-999001');
  });

  test('malformed payloads return [] rather than throwing', () => {
    for (const bad of [null, undefined, {}, 'a string', []]) {
      assert.deepEqual(jobicy.parse(bad, SOURCE), []);
    }
  });
});

describe('remotive adapter', () => {
  const SOURCE = { name: 'Remotive', ats: 'remotive', token: 'software-dev' };
  const rows = remotive.parse(loadFixture('remotive.json'), SOURCE);
  const byId = (id) => rows.find((r) => r.ats_job_id === id);

  test('parses every fixture posting, well-formed and tagged ats=remotive', () => {
    assert.equal(rows.length, 4);
    for (const row of rows) {
      assert.ok(isWellFormed(row), `not well-formed: ${JSON.stringify(row)}`);
      assert.equal(row.ats, 'remotive');
    }
  });

  test('builds the category URL from the token', () => {
    assert.equal(
      remotive.buildUrl('software-dev'),
      'https://remotive.com/api/remote-jobs?category=software-dev',
    );
  });

  test('maps id, title, url and location verbatim from a real posting', () => {
    const row = byId('2091135');
    assert.ok(row);
    assert.equal(row.title, 'Senior Back-end Developer');
    assert.equal(row.company, 'Lemon.io');
    assert.equal(row.url, 'https://remotive.com/remote-jobs/software-development/senior-back-end-developer-2091135');
    assert.equal(row.location, 'Europe, USA, Canada, Australia, Singapore, Mexico, Saudi Arabia');
    assert.equal(row.remote, true);
  });

  test('free-text salary is kept verbatim, an empty one stays empty', () => {
    assert.equal(byId('2069746').salary, '$170k - $200k');
    assert.equal(byId('2091158').salary, '$1000 per task');
    assert.equal(byId('2091135').salary, '');
  });

  test('a trailing space in company_name is trimmed for display and token', () => {
    const row = byId('1680495');
    assert.equal(row.company, 'Coalition Technologies');
    assert.equal(row.company_token, 'coalition-technologies');
  });

  test('company_token is per posting, never the source token or name', () => {
    assert.deepEqual(
      [...new Set(rows.map((r) => r.company_token))].sort(),
      ['askable', 'coalition-technologies', 'lemon-io', 'mitre-media'],
    );
    for (const row of rows) {
      assert.notEqual(row.company_token, SOURCE.token);
      assert.notEqual(row.company, SOURCE.name);
    }
  });

  test('offset-less publication_date is read as UTC even when TZ is not UTC', () => {
    // Live value on 2026-10-30: "2026-10-27T12:56:13", no offset. new Date()
    // would read that as local time; the adapter must pin it to UTC.
    const saved = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      const fresh = remotive.parse(loadFixture('remotive.json'), SOURCE);
      const row = fresh.find((r) => r.ats_job_id === '2091135');
      assert.equal(row.posted_at, '2026-10-27T12:56:13.000Z');
    } finally {
      if (saved === undefined) delete process.env.TZ;
      else process.env.TZ = saved;
    }
  });

  test('description HTML is reduced to text', () => {
    const row = byId('2091158');
    assert.ok(!row.raw_description.includes('<'), row.raw_description);
    assert.match(row.raw_description, /^We're looking for experienced software engineers/);
  });

  test('a posting with no company name is kept as (company not listed)', () => {
    const [row] = remotive.parse({ jobs: [
      { id: 999002, title: 'Backend Engineer', company_name: '', candidate_required_location: 'Worldwide',
        url: 'https://remotive.com/remote-jobs/software-development/x-999002',
        publication_date: '2026-10-27T12:56:13', salary: '' },
    ] }, SOURCE);
    assert.ok(row);
    assert.equal(row.company, '(company not listed)');
    assert.equal(row.company_token, '_unlisted-999002');
  });

  test('malformed payloads return [] rather than throwing', () => {
    for (const bad of [null, undefined, {}, 'a string', []]) {
      assert.deepEqual(remotive.parse(bad, SOURCE), []);
    }
  });
});

describe('workingnomads adapter', () => {
  const SOURCE = { name: 'Working Nomads', ats: 'workingnomads', token: 'all' };
  const rows = workingnomads.parse(loadFixture('workingnomads.json'), SOURCE);
  const byId = (id) => rows.find((r) => r.ats_job_id === id);
  // One posting in the live shape, for the edge cases built inline.
  const posting = (over) => ({
    url: 'https://www.workingnomads.com/job/go/999003/', title: 'Backend Engineer',
    description: '<p>x</p>', company_name: 'Acme', category_name: 'Development',
    tags: 'go,english', location: 'Europe', pub_date: '2026-10-29T09:50:51-04:00', ...over,
  });

  test('parses the bare-array fixture, well-formed and tagged ats=workingnomads', () => {
    assert.equal(rows.length, 4);
    for (const row of rows) {
      assert.ok(isWellFormed(row), `not well-formed: ${JSON.stringify(row)}`);
      assert.equal(row.ats, 'workingnomads');
    }
  });

  test('buildUrl ignores the token: there is one endpoint and no filter', () => {
    assert.equal(workingnomads.buildUrl('all'), 'https://www.workingnomads.com/api/exposed_jobs/');
    assert.equal(workingnomads.buildUrl(undefined), 'https://www.workingnomads.com/api/exposed_jobs/');
  });

  test('ats_job_id is the number in the /job/go/<id>/ url', () => {
    const row = byId('1981017');
    assert.ok(row, `ids: ${rows.map((r) => r.ats_job_id)}`);
    assert.equal(row.url, 'https://www.workingnomads.com/job/go/1981017/');
    assert.equal(row.title, 'Senior Magento Developer');
    assert.equal(row.company, 'Lemon.io');
    assert.equal(row.location, 'Europe, LATAM, APAC, the U.S., Canada');
  });

  test('a url without a /job/go/<id>/ segment is dropped', () => {
    assert.deepEqual(workingnomads.parse([posting({ url: 'https://www.workingnomads.com/jobs/backend-engineer' })], SOURCE), []);
  });

  test('location is kept verbatim, "Time zone: ..." prefix included', () => {
    assert.equal(byId('1925654').location, 'Time zone: CET (+/- 3 hours)');
    assert.equal(byId('1925645').location, 'CET (+/- 3 hours)');
  });

  test('a -04:00 (EDT) pub_date becomes the exact UTC instant', () => {
    // Live value: "2026-10-29T09:50:51-04:00".
    assert.equal(byId('1981017').posted_at, '2026-10-29T13:50:51.000Z');
  });

  test('a -05:00 (EST, after 2026-11-01) pub_date becomes the exact UTC instant', () => {
    const [row] = workingnomads.parse([posting({ pub_date: '2026-11-02T09:50:51-05:00' })], SOURCE);
    assert.equal(row.posted_at, '2026-11-02T14:50:51.000Z');
  });

  test('every row is remote and has no salary (the feed has no pay field)', () => {
    for (const row of rows) {
      assert.equal(row.remote, true);
      assert.equal(row.salary, '');
    }
  });

  test('company_token is per posting, never the source token or name', () => {
    assert.deepEqual(
      [...new Set(rows.map((r) => r.company_token))].sort(),
      ['lemon-io', 'proxify', 'telus-digital'],
    );
    for (const row of rows) {
      assert.notEqual(row.company_token, SOURCE.token);
      assert.notEqual(row.company, SOURCE.name);
    }
  });

  test('description HTML is reduced to text', () => {
    const row = byId('1957823');
    assert.ok(!row.raw_description.includes('<'), row.raw_description);
    assert.match(row.raw_description, /Join our elite team of Senior Raters/);
  });

  test('a posting with no company name is kept as (company not listed)', () => {
    const [row] = workingnomads.parse([posting({ company_name: null })], SOURCE);
    assert.ok(row);
    assert.equal(row.company, '(company not listed)');
    assert.equal(row.company_token, '_unlisted-999003');
  });

  test('malformed payloads return [] rather than throwing', () => {
    for (const bad of [null, undefined, {}, 'a string', [], [null, 7]]) {
      assert.deepEqual(workingnomads.parse(bad, SOURCE), []);
    }
  });
});

// The WWR fixture is REAL trimmed test data: 4 of the 79 items in the
// full-stack category feed saved 2026-10-30, descriptions cut short (see the
// comment at the top of the .xml). Edge cases the live feed did not contain are
// built inline with wwrItem(), never added to the fixture.
describe('weworkremotely adapter', () => {
  const SOURCE = { name: 'We Work Remotely (full-stack)', ats: 'weworkremotely', token: 'remote-full-stack-programming-jobs' };
  const rows = weworkremotely.parse(loadText('weworkremotely.xml'), SOURCE);
  const byId = (id) => rows.find((r) => r.ats_job_id === id);

  test('parses every fixture item, well-formed and tagged ats=weworkremotely', () => {
    assert.equal(rows.length, 4);
    for (const row of rows) {
      assert.ok(isWellFormed(row), `not well-formed: ${JSON.stringify(row)}`);
      assert.equal(row.ats, 'weworkremotely');
    }
  });

  test('builds the category feed URL from the token', () => {
    assert.equal(
      weworkremotely.buildUrl('remote-back-end-programming-jobs'),
      'https://weworkremotely.com/categories/remote-back-end-programming-jobs.rss',
    );
  });

  test('maps a real item: company/title split, url, id from the link slug, region, pubDate', () => {
    const row = byId('toptal-senior-deployment-engineer-with-llm-and-gpu-infrastructure-experience');
    assert.ok(row, `ids: ${rows.map((r) => r.ats_job_id)}`);
    assert.equal(row.company, 'Toptal');
    assert.equal(row.company_token, 'toptal');
    assert.equal(row.title, 'Senior Deployment Engineer with LLM and GPU Infrastructure experience');
    assert.equal(row.url, 'https://weworkremotely.com/remote-jobs/toptal-senior-deployment-engineer-with-llm-and-gpu-infrastructure-experience');
    assert.equal(row.location, 'EMEA Only');
    assert.equal(row.posted_at, '2026-10-22T18:59:03.000Z');
    assert.equal(row.remote, true);
    assert.equal(row.salary, '');
  });

  // One item in the live element order, for the edge cases built inline.
  // Values are XML-escaped as the live feed escapes them.
  const wwrItem = (over = {}) => {
    const f = {
      title: 'Acme: Backend Engineer', region: 'Anywhere in the World', country: '',
      description: '&lt;p&gt;Build things.&lt;/p&gt;', pubDate: 'Thu, 29 Oct 2026 22:31:03 +0000',
      link: 'https://weworkremotely.com/remote-jobs/acme-backend-engineer', ...over,
    };
    const tags = ['title', 'region', 'country', 'description', 'pubDate', 'link']
      .filter((t) => f[t] !== undefined).map((t) => `<${t}>${f[t]}</${t}>`).join('\n      ');
    return `<item>\n      ${tags}\n      <guid>${f.link ?? ''}</guid>\n    </item>`;
  };
  const feed = (...items) => `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel>\n    ${items.join('\n    ')}\n</channel></rss>`;
  const one = (over) => weworkremotely.parse(feed(wwrItem(over)), SOURCE);

  test('a space before the first colon is trimmed off the company (real "Fivetran : ...")', () => {
    const row = byId('fivetran-global-alliance-lead-capgemini');
    assert.ok(row);
    assert.equal(row.company, 'Fivetran');
    assert.equal(row.company_token, 'fivetran');
    assert.equal(row.title, 'Global Alliance Lead, Capgemini');
  });

  test('only the first colon splits: a second one stays in the title (real "Yooli: FULL TIME: ...")', () => {
    const row = byId('yooli-full-time-software-engineer-position-react-and-rest-1');
    assert.ok(row);
    assert.equal(row.company, 'Yooli');
    assert.equal(row.title, 'FULL TIME: Software Engineer Position - React and Rest');
  });

  test('inline: "Acme: Engineer: Platform" -> Acme / "Engineer: Platform"', () => {
    const [row] = one({ title: 'Acme: Engineer: Platform' });
    assert.equal(row.company, 'Acme');
    assert.equal(row.title, 'Engineer: Platform');
  });

  test('an entity in the title is decoded (real "Oil &amp; Gas")', () => {
    const row = byId('celonis-client-value-partner-cvp-oil-gas-industry');
    assert.ok(row);
    assert.equal(row.company, 'Celonis');
    assert.equal(row.title, 'Client Value Partner (CVP) - Oil & Gas Industry');
  });

  test('the entity-escaped HTML description comes out as plain text', () => {
    const row = byId('fivetran-global-alliance-lead-capgemini');
    assert.ok(!/[<>]|&lt;|&gt;|&amp;/.test(row.raw_description), row.raw_description);
    assert.match(row.raw_description, /^Headquarters: Remote, Colorado, United States, AMER\n+From Fivetran’s founding until now/);
  });

  test('a double-escaped &amp;nbsp; in a description does not survive as text', () => {
    // Live shape (Yooli, Bitovi): "...healthcare.&amp;nbsp;&lt;/li&gt;".
    const [row] = one({ description: '&lt;li&gt;We build software.&amp;nbsp;&lt;/li&gt;' });
    assert.equal(row.raw_description, 'We build software.');
  });

  test('region is the location, verbatim; country is not used', () => {
    // Fivetran's live country is "🇺🇸 United States of America", region "Anywhere in the World".
    assert.equal(byId('fivetran-global-alliance-lead-capgemini').location, 'Anywhere in the World');
    const [row] = one({ region: 'EMEA Only', country: '🇩🇪 Germany, 🇬🇷 Greece' });
    assert.equal(row.location, 'EMEA Only');
  });

  test('a 2024 pubDate is kept, not dropped (three live items are renewed 2024 posts)', () => {
    const [row] = one({ pubDate: 'Sun, 16 Jun 2024 18:08:52 +0000' });
    assert.equal(row.posted_at, '2024-06-16T18:08:52.000Z');
  });

  test('no colon in the title -> (company not listed), whole string kept as the title', () => {
    const [row] = one({ title: 'Backend Engineer' });
    assert.equal(row.company, '(company not listed)');
    assert.equal(row.company_token, '_unlisted-acme-backend-engineer');
    assert.equal(row.title, 'Backend Engineer');
  });

  test('an empty company part (": Title") is also (company not listed)', () => {
    const [row] = one({ title: ' : Backend Engineer' });
    assert.equal(row.company, '(company not listed)');
    assert.equal(row.title, 'Backend Engineer');
  });

  test('company_token is per posting, never the source token or name', () => {
    assert.deepEqual(
      [...new Set(rows.map((r) => r.company_token))].sort(),
      ['celonis', 'fivetran', 'toptal', 'yooli'],
    );
    for (const row of rows) {
      assert.notEqual(row.company_token, SOURCE.token);
      assert.notEqual(row.company, SOURCE.name);
    }
  });

  test('an item with no title, no link, or a link without /remote-jobs/<slug> is skipped', () => {
    const good = wwrItem({ link: 'https://weworkremotely.com/remote-jobs/kept' });
    const out = weworkremotely.parse(feed(
      wwrItem({ title: undefined }),
      wwrItem({ link: undefined }),
      wwrItem({ link: 'https://weworkremotely.com/categories/remote-devops-sysadmin-jobs' }),
      good,
    ), SOURCE);
    assert.deepEqual(out.map((r) => r.ats_job_id), ['kept']);
  });

  test('the channel <title> and <link> are not read as an item', () => {
    // feed() has a channel with no items of its own; the fixture's channel title
    // "We Work Remotely: Full-Stack Programming Jobs" must not become a row.
    assert.ok(!rows.some((r) => r.company === 'We Work Remotely'));
    assert.deepEqual(weworkremotely.parse(feed(), SOURCE), []);
  });

  test('malformed payloads return [] rather than throwing', () => {
    for (const bad of [null, undefined, {}, [], 7, '', 'not xml', '<item>unclosed']) {
      assert.deepEqual(weworkremotely.parse(bad, SOURCE), []);
    }
  });
});

describe('board adapters are registered', () => {
  test('adapterFor resolves jobicy, remotive, workingnomads and weworkremotely to their modules', () => {
    assert.equal(adapterFor('jobicy'), jobicy);
    assert.equal(adapterFor('remotive'), remotive);
    assert.equal(adapterFor('workingnomads'), workingnomads);
    assert.equal(adapterFor('weworkremotely'), weworkremotely);
  });

  test('ATS_KINDS and the ADAPTERS registry name exactly the same kinds', () => {
    // A board added to BOARDS but not registered (or the reverse) fails here.
    assert.deepEqual([...ATS_KINDS].sort(), Object.keys(ADAPTERS).sort());
  });
});
