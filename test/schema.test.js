import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { jobKey, jobId, normalise, isWellFormed, toIso, stripHtml, looksRemote, formatSalary } from '../lib/schema.js';

describe('jobKey / jobId stability', () => {
  const base = { ats: 'greenhouse', company_token: 'acme', ats_job_id: '42', title: 'Engineer', url: 'https://x', location: 'NYC' };

  test('same tuple -> same id', () => {
    assert.equal(jobId(base), jobId({ ...base }));
  });

  test('changing ats changes the id', () => {
    assert.notEqual(jobId(base), jobId({ ...base, ats: 'lever' }));
  });

  test('changing company_token changes the id', () => {
    assert.notEqual(jobId(base), jobId({ ...base, company_token: 'acme2' }));
  });

  test('changing ats_job_id changes the id', () => {
    assert.notEqual(jobId(base), jobId({ ...base, ats_job_id: '43' }));
  });

  test('changing title does NOT change the id', () => {
    assert.equal(jobId(base), jobId({ ...base, title: 'Different Title' }));
  });

  test('changing url does NOT change the id', () => {
    assert.equal(jobId(base), jobId({ ...base, url: 'https://y' }));
  });

  test('changing location does NOT change the id', () => {
    assert.equal(jobId(base), jobId({ ...base, location: 'SF' }));
  });

  test('jobKey is the plain colon-joined tuple', () => {
    assert.equal(jobKey(base), 'greenhouse:acme:42');
  });
});

describe('normalise()', () => {
  test('fills defaults for a minimal valid row', () => {
    const row = normalise({
      ats: 'greenhouse',
      company_token: 'acme',
      ats_job_id: '1',
      title: 'Engineer',
    });
    assert.ok(row);
    assert.equal(row.company, 'acme'); // falls back to company_token
    assert.equal(row.location, '');
    assert.equal(row.remote, false);
    assert.equal(row.url, '');
    assert.equal(row.posted_at, null);
    assert.equal(row.raw_description, '');
    assert.ok(isWellFormed(row));
  });

  test('drops a row missing ats', () => {
    assert.equal(normalise({ company_token: 'a', ats_job_id: '1', title: 't' }), null);
  });

  test('drops a row missing company_token', () => {
    assert.equal(normalise({ ats: 'lever', ats_job_id: '1', title: 't' }), null);
  });

  test('drops a row missing ats_job_id', () => {
    assert.equal(normalise({ ats: 'lever', company_token: 'a', title: 't' }), null);
  });

  test('drops a row missing title', () => {
    assert.equal(normalise({ ats: 'lever', company_token: 'a', ats_job_id: '1' }), null);
  });

  test('drops a row with an empty-string title', () => {
    assert.equal(normalise({ ats: 'lever', company_token: 'a', ats_job_id: '1', title: '   ' }), null);
  });

  test('strips adapter-invented extra fields', () => {
    const row = normalise({
      ats: 'lever', company_token: 'a', ats_job_id: '1', title: 't',
      totallyMadeUp: 'nope', another: { x: 1 },
    });
    assert.ok(row);
    assert.ok(isWellFormed(row));
    assert.equal('totallyMadeUp' in row, false);
    assert.equal('another' in row, false);
  });

  test('output always passes isWellFormed()', () => {
    const row = normalise({
      ats: 'greenhouse', company: 'Acme Inc', company_token: 'acme', ats_job_id: '9',
      title: 'Staff Engineer', location: 'Remote', remote: true, url: 'https://x',
      posted_at: '2026-01-01T00:00:00Z', raw_description: 'hello',
    });
    assert.ok(isWellFormed(row));
  });

  test('computed id matches jobId() of the resulting row', () => {
    const row = normalise({ ats: 'lever', company_token: 'a', ats_job_id: '7', title: 't' });
    assert.equal(row.id, jobId(row));
  });
});

describe('toIso()', () => {
  test('epoch millis', () => {
    assert.equal(toIso(1735689600000), new Date(1735689600000).toISOString());
  });

  test('epoch seconds (below the millis threshold)', () => {
    assert.equal(toIso(1735689600), new Date(1735689600 * 1000).toISOString());
  });

  test('numeric string epoch seconds', () => {
    assert.equal(toIso('1735689600'), new Date(1735689600 * 1000).toISOString());
  });

  test('ISO string passes through as ISO', () => {
    assert.equal(toIso('2026-01-01T00:00:00Z'), '2026-01-01T00:00:00.000Z');
  });

  test('garbage string -> null', () => {
    assert.equal(toIso('not a date at all'), null);
  });

  test('null -> null', () => {
    assert.equal(toIso(null), null);
  });

  test('undefined -> null', () => {
    assert.equal(toIso(undefined), null);
  });

  test('empty string -> null', () => {
    assert.equal(toIso(''), null);
  });
});

describe('stripHtml()', () => {
  test('removes tags', () => {
    assert.equal(stripHtml('<p>Hello <b>world</b></p>'), 'Hello world');
  });

  test('decodes &amp; &lt; &#39; &#x27; &nbsp;', () => {
    const out = stripHtml('Salt &amp; Pepper &lt;3 it&#39;s great&#x27;s &nbsp; here');
    assert.ok(!out.includes('&amp;'));
    assert.equal(out.includes('&'), true); // decoded ampersand itself is fine
    assert.ok(out.includes("it's"));
    assert.ok(out.includes("great's"));
    assert.ok(!/&lt;/.test(out));
    assert.ok(!/&#39;/.test(out));
    assert.ok(!/&#x27;/.test(out));
    assert.ok(!/&nbsp;/.test(out));
  });

  test('drops script and style contents entirely', () => {
    const out = stripHtml('<p>Keep me</p><script>evil()</script><style>.x{color:red}</style><p>Also keep</p>');
    assert.ok(!out.includes('evil()'));
    assert.ok(!out.includes('color:red'));
    assert.ok(out.includes('Keep me'));
    assert.ok(out.includes('Also keep'));
  });

  test('block tags become newlines', () => {
    const out = stripHtml('<p>One</p><p>Two</p>');
    // the closing </p> becomes a newline; the following opening <p> is then
    // stripped to a space by the generic tag-strip pass, so a single space
    // of leftover indentation before "Two" is expected and fine.
    assert.ok(/One\n\s*Two/.test(out), `expected a newline between blocks, got: ${JSON.stringify(out)}`);
  });

  test('collapses whitespace', () => {
    const out = stripHtml('<p>Too    many\n\n\n\nspaces</p>');
    assert.ok(!/ {2,}/.test(out));
    assert.ok(!/\n{3,}/.test(out));
  });

  test('empty/falsy input -> empty string', () => {
    assert.equal(stripHtml(''), '');
    assert.equal(stripHtml(null), '');
    assert.equal(stripHtml(undefined), '');
  });
});

describe('looksRemote()', () => {
  test('positive cases', () => {
    assert.equal(looksRemote('Remote'), true);
    assert.equal(looksRemote('This role is fully distributed'), true);
    assert.equal(looksRemote('Work from home available'), true);
    assert.equal(looksRemote('Remote (Anywhere in the US)'), true);
    assert.equal(looksRemote('', 'Senior Engineer, Remote'), true);
  });

  // Canonical writes every remote role as "Home based - <region>" and never
  // uses the word "remote". Before this, 297 of its 303 fully-remote postings
  // reached the ranker looking on-site.
  test('"home based" counts as remote, hyphenated or spaced', () => {
    assert.equal(looksRemote('Home based - EMEA'), true);
    assert.equal(looksRemote('Home Based - Americas'), true);
    assert.equal(looksRemote('home-based'), true);
  });

  test('a role open both home based and office based is still remote', () => {
    assert.equal(
      looksRemote('Home based - Worldwide; Office Based - Taipei, Taiwan'),
      true,
    );
  });

  test('office based alone is not remote', () => {
    assert.equal(looksRemote('Office Based - Taipei, Taiwan'), false);
  });

  test('no speculative matches: "virtual" and "flexible" are not remote signals', () => {
    // Deliberately excluded - they produce false positives and the live scan
    // found no posting that needed them.
    assert.equal(looksRemote('Virtual Reality Engineer'), false);
    assert.equal(looksRemote('Flexible working hours, Berlin'), false);
  });

  test('"non-remote" is not treated as remote', () => {
    assert.equal(looksRemote('This is a non-remote position'), false);
  });

  test('"onsite only" is not treated as remote', () => {
    assert.equal(looksRemote('Onsite only, no exceptions'), false);
    assert.equal(looksRemote('On-site only'), false);
  });

  test('plain office location is not remote', () => {
    assert.equal(looksRemote('Austin, TX'), false);
  });
});

// Lever attaches a salaryRange to postings that state no salary at all, with
// min and max both 0 (verified live against api.lever.co/v0/postings/ledger).
// "Object present" therefore does not mean "salary stated".
describe('formatSalary()', () => {
  test('the all-zero placeholder renders as empty, not "AUD 0-0/yr"', () => {
    assert.equal(formatSalary({ min: 0, max: 0, currency: 'AUD', interval: 'per-year-salary' }), '');
  });

  test('a stated range renders with currency, separators and interval', () => {
    assert.equal(
      formatSalary({ min: 75000, max: 95000, currency: 'eur', interval: 'per-year-salary' }),
      'EUR 75,000-95,000/yr',
    );
  });

  test('collapses a range whose ends are equal', () => {
    assert.equal(formatSalary({ min: 80000, max: 80000, currency: 'GBP', interval: 'per-year-salary' }), 'GBP 80,000/yr');
  });

  test('renders when only one end is stated', () => {
    assert.equal(formatSalary({ min: 0, max: 95000, currency: 'EUR', interval: 'per-year-salary' }), 'EUR 95,000/yr');
  });

  test('maps the non-yearly intervals', () => {
    assert.equal(formatSalary({ min: 45, max: 60, currency: 'USD', interval: 'per-hour-salary' }), 'USD 45-60/hr');
    assert.equal(formatSalary({ min: 6000, max: 7000, currency: 'EUR', interval: 'per-month-salary' }), 'EUR 6,000-7,000/mo');
  });

  test('degrades rather than throwing on unknown or missing parts', () => {
    assert.equal(formatSalary({ min: 5000, max: 6000, currency: 'EUR', interval: 'mystery' }), 'EUR 5,000-6,000');
    assert.equal(formatSalary({ min: 5000, max: 6000 }), '5,000-6,000');
    assert.equal(formatSalary(null), '');
    assert.equal(formatSalary(undefined), '');
    assert.equal(formatSalary('nonsense'), '');
    assert.equal(formatSalary({}), '');
  });
});
