// Remotive remote-jobs board adapter.
//
// Endpoint: GET https://remotive.com/api/remote-jobs?category={token}
//   token is a Remotive category slug, e.g. "software-dev".
//
// STATUS: VERIFIED 2026-10-30 against one live response from
// /api/remote-jobs?category=software-dev (12 jobs, the whole category).
// Every field mapped below was read off that response.
//
// DATES: `publication_date` carries NO offset ("2026-10-27T12:56:13") and the
// zone is stated nowhere. new Date() would read it as the machine's local
// time, so a naive date-time is TREATED AS UTC here (a "Z" is appended before
// toIso). Shared toIso is deliberately left alone.
//
// Terms (the response's "0-legal-notice" and the API docs at
// https://remotive.com/api-documentation -> github.com/remotive-com/
// remote-jobs-api, read 2026-10-30): link back to the Remotive URL AND name
// Remotive as the source ("via Remotive" plus the posting's remotive.com
// `url`); jobs are delayed by 24 hours; "we advise max. 4 times a day", and
// excessive requests are blocked - so ONE call per run. Conflict on record:
// robots.txt has `Disallow: /api/*` and `Disallow: /*category=` under
// `User-agent: *`, while the API docs explicitly grant developer use. The API
// terms are the specific grant and were followed (owner decision, GH-5 Q14).
//
// Observed response shape: { "00-warning", "0-legal-notice", "job-count",
// "total-job-count", jobs: [...] }, each posting:
//   id                          integer -> ats_job_id (also ends the url)
//   title                       string  -> title
//   company_name                string  can end in whitespace -> company /
//                                       company_token via boardCompany (trims)
//   candidate_required_location string  free text, e.g. "Worldwide",
//                                       "USA, Canada, USA timezones" -> location
//   url                         string  remotive.com listing page -> url
//   publication_date            string  naive ISO date-time -> posted_at (UTC)
//   salary                      string  FREE TEXT ("70K-80K", "$1000 per
//                               task", often "") -> salary, verbatim
//   description                 string  HTML -> raw_description via htmlToText
//   category, tags, job_type, company_logo, company_logo_url   unused
// Everything on the board is remote; there is no remote flag.

import { normalise, toIso, htmlToText, boardCompany } from '../schema.js';
import { getJson } from '../http.js';

export const ats = 'remotive';

// A date-time with a time part and nothing after it: no "Z", no "+hh:mm".
const NAIVE_DATETIME_RE = /T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

export function buildUrl(category) {
  return `https://remotive.com/api/remote-jobs?category=${encodeURIComponent(category)}`;
}

/** Read an offset-less Remotive date-time as UTC; pass anything else through. */
function utcDate(v) {
  const s = typeof v === 'string' ? v.trim() : v;
  return toIso(typeof s === 'string' && NAIVE_DATETIME_RE.test(s) ? `${s}Z` : s);
}

/**
 * Pure: (payload, source) -> schema rows. No network.
 *
 * The source entry is deliberately unused: on a board, company and
 * company_token come from each posting, never from sources.json.
 *
 * @param {any} payload  parsed JSON body from the Remotive API
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
      ...boardCompany(it.company_name, id),
      ats_job_id: id,
      title: it.title,
      location: it.candidate_required_location,
      remote: true,
      url: it.url,
      posted_at: utcDate(it.publication_date),
      salary: it.salary,
      raw_description: htmlToText(it.description),
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
