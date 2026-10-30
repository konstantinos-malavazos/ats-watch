// Jobicy remote-jobs board adapter.
//
// Endpoint: GET https://jobicy.com/api/jobs?{token}
//   token is the whole query string from sources.json, e.g.
//   "count=50&geo=greece&industry=engineering".
//
// STATUS: VERIFIED 2026-10-30 against live responses from
// /api/jobs?count=100&geo=europe&industry=engineering and
// /api/v2/remote-jobs?count=50&geo=europe&industry=engineering|dev, plus a
// count=100&geo=greece&industry=engineering response that the fixture is cut
// from. Both paths returned the same envelope and the same 17 job keys.
// /api/jobs is used because it is the path the current docs give; v2 still
// answered on 2026-10-30. geo=greece on /api/jobs was confirmed live the same
// day: the board seed and a verify-feeds run each returned 50 rows with every
// mapped field populated.
//
// Query values, observed: `industry=dev` is DEPRECATED - the response carries
// `x-jobicy-deprecated-industry: dev` / `x-jobicy-replacement-industry:
// engineering` and the two bodies were byte-identical - so use
// `industry=engineering`. `geo=greece` is a listed slug and returns only
// Anywhere / Europe / EMEA / multi-region rows, i.e. roles open to someone in
// Greece; `geo=europe` adds single-country rows (UK-only, Spain-only, ...).
// The feed holds only the last 7 days. Pagination is cursor-based
// (`nextCursor`, `hasMore`); this adapter reads ONE page per run and ignores
// the cursor by decision.
//
// Terms (https://jobi.cy/apidocs -> /jobs-rss-feed, read 2026-10-30): no key
// or account needed; "Polling ... must not exceed once per hour"; credit
// Jobicy as the source and keep apply links on Jobicy's own job pages. The
// digest's "via Jobicy" plus the posting's jobicy.com `url` as the link meet
// that. robots.txt does not disallow /api/.
//
// Observed response shape: { apiVersion, jobCount, nextCursor, hasMore,
// appliedFilters, jobs: [...], ... }, each posting:
//   id              integer  e.g. 157993 -> ats_job_id
//   jobTitle        string   -> title (may carry " | UK | Remote" segments)
//   companyName     string   -> company / company_token via boardCompany
//   jobGeo          string   NOT an array; values joined by ",  " (comma +
//                            TWO spaces) -> location, whitespace collapsed
//   url             string   https://jobicy.com/jobs/<id>-<slug> -> url
//   pubDate         string   ISO 8601, always "+00:00" -> posted_at
//   jobDescription  string   HTML -> raw_description via htmlToText
//   salaryMin/Max   number   absent on most rows (on the geo=greece response
//                            the keys are missing, not null)
//   salaryCurrency  string   ISO code; can be absent while min/max are set
//   salaryPeriod    string   'yearly' | 'hourly' | absent
//   jobExcerpt, jobIndustry, jobType, jobLevel, companyLogo   unused
// Everything on the board is remote; there is no remote flag.

import { normalise, toIso, htmlToText, formatSalary, boardCompany } from '../schema.js';
import { getJson } from '../http.js';

export const ats = 'jobicy';

const BASE = 'https://jobicy.com/api/jobs';

// Jobicy's period words -> the INTERVALS keys formatSalary understands. An
// unknown or missing period prints no suffix.
const PERIODS = { yearly: 'per-year-salary', hourly: 'per-hour-salary' };

export function buildUrl(token) {
  return `${BASE}?${token}`;
}

/**
 * Pure: (payload, source) -> schema rows. No network.
 *
 * The source entry is deliberately unused: on a board, company and
 * company_token come from each posting, never from sources.json.
 *
 * @param {any} payload  parsed JSON body from the Jobicy jobs API
 * @param {{ name: string, ats: string, token: string }} _source
 */
export function parse(payload, _source) {
  const postings = Array.isArray(payload?.jobs) ? payload.jobs : [];
  const out = [];

  for (const it of postings) {
    if (!it || typeof it !== 'object') continue;
    const id = it.id === null || it.id === undefined ? '' : String(it.id);

    const row = normalise({
      ats,
      ...boardCompany(it.companyName, id),
      ats_job_id: id,
      title: it.jobTitle,
      location: String(it.jobGeo ?? '').replace(/\s+/g, ' ').trim(),
      remote: true,
      url: it.url,
      posted_at: toIso(it.pubDate),
      salary: formatSalary({
        min: it.salaryMin,
        max: it.salaryMax,
        currency: it.salaryCurrency,
        interval: PERIODS[it.salaryPeriod],
      }),
      raw_description: htmlToText(it.jobDescription),
    });
    if (row) out.push(row);
  }

  return out;
}

/** Fetch + parse in one call. Network lives here, not in parse(). */
export async function fetchJobs(source, { log, timeoutMs } = {}) {
  const payload = await getJson(buildUrl(source.token), { timeoutMs, log });
  return parse(payload, source);
}
