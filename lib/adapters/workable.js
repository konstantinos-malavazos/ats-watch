// Workable public job widget adapter.
//
// Endpoint: GET https://apply.workable.com/api/v1/widget/accounts/{account}
//           ?details=true
//
// STATUS: VERIFIED 2026-08-24 against live accounts (blueground, hotjar).
// Every field mapped below was read off a real response.
//
// On endpoint choice: Workable also exposes https://{account}.workable.com
// /spi/v3/jobs, which is the one most write-ups point at, but it answers 401
// without an API token. This tool does no authenticated fetching, so the
// public widget endpoint is the only one in scope. `details=true` is what
// makes the description field come back; without it postings arrive as
// title-and-link stubs.
//
// An unknown account returns 404 (unlike Ashby's empty-array-with-200), so a
// typo in companies.json surfaces as a failed source on stderr.
//
// Observed response shape: { name, description, jobs: [...] }, each posting:
//   shortcode       string  e.g. "0FD01ABC66" -> ats_job_id (`code` is often
//                           an empty string and is NOT the identifier)
//   title           string  -> title
//   employment_type string  'Full-time' | ...
//   telecommuting   boolean Workable's own remote flag
//   country/city/state      location parts, any of which may be ''
//   locations       array   [{ country, countryCode, city, region, hidden }]
//   url / shortlink string  public posting -> url
//   published_on    string  'YYYY-MM-DD' -> posted_at
//   description     string  HTML -> raw_description via htmlToText
//
// NO PAY FIELD EXISTS in this response - the union of keys across every
// posting on a 26-job account contained nothing salary-shaped - so `salary`
// is always ''. Same situation as Greenhouse.

import { normalise, toIso, htmlToText, looksRemote } from '../schema.js';
import { getJson } from '../http.js';

export const ats = 'workable';

export function buildUrl(account) {
  return `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(account)}?details=true`;
}

/**
 * Pure: (payload, company) -> schema rows. No network.
 *
 * @param {any} payload   parsed JSON body from the Workable widget endpoint
 * @param {{ name: string, ats: string, token: string }} company
 */
export function parse(payload, company) {
  const postings = Array.isArray(payload?.jobs) ? payload.jobs : [];
  const out = [];

  for (const it of postings) {
    if (!it || typeof it !== 'object') continue;

    const location = collectLocations(it);
    const title = it.title;

    const row = normalise({
      ats,
      company: company?.name,
      company_token: company?.token,
      ats_job_id: it.shortcode,
      title,
      location,
      remote: it.telecommuting === true || looksRemote(location, title),
      url: it.url ?? it.shortlink ?? it.application_url,
      // published_on is a bare date; created_at is the fallback when a posting
      // has been created but not yet given a publish date.
      posted_at: toIso(it.published_on ?? it.created_at),
      salary: '',
      raw_description: htmlToText(it.description),
    });
    if (row) out.push(row);
  }

  return out;
}

/**
 * Build a readable location from Workable's parts.
 *
 * The flat country/city/state fields describe only the primary location and
 * are frequently partly empty (a remote US role arrives as country "United
 * States" with city and state both ''). The `locations` array carries the full
 * set, so both are merged and deduplicated. Entries marked hidden are the
 * employer's choice not to show a location publicly, and are skipped.
 */
function collectLocations(it) {
  const parts = [];
  const push = (v) => {
    const s = typeof v === 'string' ? v.trim() : '';
    if (s && !parts.includes(s)) parts.push(s);
  };

  push(joinPlace(it.city, it.state, it.country));
  if (Array.isArray(it.locations)) {
    for (const loc of it.locations) {
      if (!loc || typeof loc !== 'object' || loc.hidden === true) continue;
      push(joinPlace(loc.city, loc.region, loc.country));
    }
  }
  return parts.join('; ');
}

function joinPlace(...bits) {
  return bits
    .map((b) => (typeof b === 'string' ? b.trim() : ''))
    .filter(Boolean)
    .join(', ');
}

/** Fetch + parse in one call. Network lives here, not in parse(). */
export async function fetchJobs(company, { log, timeoutMs } = {}) {
  const payload = await getJson(buildUrl(company.token), { timeoutMs, log });
  return parse(payload, company);
}
