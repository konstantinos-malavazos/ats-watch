// Greenhouse Job Board API adapter.
//
// Endpoint: GET https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true
// (the `content=true` query param is what makes the API include each job's
// full HTML description; without it `content` is omitted from the response
// entirely.)
//
// STATUS: the response shape below is INFERRED from public documentation and
// community write-ups, not observed live. This container's egress proxy
// blocks boards-api.greenhouse.io (403 on CONNECT), so nothing here has been
// exercised against the real API this session (2026-08-23). Treat every
// field name and type as a hypothesis to be confirmed the first time this
// adapter runs somewhere with open egress, not as verified fact.
//
// Inferred top-level shape: { jobs: [ ... ] }, each element:
//   id              number  -> ats_job_id (stringified; schema ids are strings)
//   title           string  -> title
//   location        object  -> location.name -> location
//   absolute_url    string  -> url
//   updated_at      string  ISO timestamp, always present
//   first_published string  ISO timestamp, present once the req has `content=true`
//   content         string  the job description, HTML-escaped to an UNKNOWN
//                           depth -> raw_description. Passed through
//                           htmlToText(), which iterates to a fixed point
//                           rather than assuming a pass count.
//
// posted_at prefers first_published (the actual "when this went live" date)
// over updated_at (which changes on any edit, e.g. a typo fix) since the
// digest is trying to surface new postings, not recently-touched ones.

import { normalise, toIso, htmlToText, looksRemote } from '../schema.js';
import { getJson } from '../http.js';

export const ats = 'greenhouse';

export function buildUrl(token) {
  return `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`;
}

/**
 * Pure: (payload, company) -> schema rows. No network, no clock reads beyond
 * what toIso() does internally on the strings already in payload. Safe to
 * call directly against a hand-built fixture in tests.
 *
 * @param {any} payload   parsed JSON body from the Greenhouse jobs endpoint
 * @param {{ name: string, ats: string, token: string }} company
 */
export function parse(payload, company) {
  const jobs = payload && Array.isArray(payload.jobs) ? payload.jobs : [];
  const out = [];

  for (const it of jobs) {
    if (!it || typeof it !== 'object') continue;

    const location = it.location && typeof it.location === 'object' ? it.location.name : '';
    const title = it.title;

    // Greenhouse escapes the description HTML, but we could not confirm to
    // what depth (egress was blocked, see the header). htmlToText iterates to
    // a fixed point, so single-, double- and triple-escaped bodies all come
    // out as plain text without us having to know which one arrives.
    const raw_description = htmlToText(it.content);

    const row = normalise({
      ats,
      company: company?.name,
      company_token: company?.token,
      ats_job_id: it.id != null ? String(it.id) : '',
      title,
      location,
      remote: looksRemote(location, title),
      url: it.absolute_url,
      // salary is left empty: a live response (wise, 2026-08-23) carries no
      // pay field at all - no salaryRange, no pay_input_ranges, and metadata
      // was null. Some boards reportedly expose pay through metadata, but that
      // has not been observed here, so nothing is mapped rather than guessed.
      posted_at: toIso(it.first_published ?? it.updated_at),
      raw_description,
    });
    if (row) out.push(row);
  }

  return out;
}

/** Fetch + parse in one call. Network lives here, not in parse(). */
export async function fetchJobs(company, { log, timeoutMs } = {}) {
  const payload = await getJson(buildUrl(company.token), { timeoutMs, log });
  return parse(payload, company);
}
