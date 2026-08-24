// Ashby job board API adapter.
//
// Endpoint: GET https://api.ashbyhq.com/posting-api/job-board/{board}
//           ?includeCompensation=true
//
// STATUS: VERIFIED 2026-08-24 against live boards (linear, ramp, posthog).
// Every field mapped below was read off a real response, not inferred. An
// unknown board returns 200 with an empty jobs array rather than a 404, so a
// typo in companies.json shows up as a silent zero rather than an error -
// check stderr counts after adding one.
//
// Observed response shape: { jobs: [...], apiVersion: "1" }, each posting:
//   id                 string  UUID -> ats_job_id
//   title              string  -> title
//   location           string  primary location, e.g. "Europe", "Miami, FL"
//   secondaryLocations array   [{ location, address }] - additional locations
//   publishedAt        string  ISO-8601 with offset -> posted_at
//   isListed           boolean false = pulled from the public board; skipped
//   isRemote           boolean Ashby's own remote flag
//   workplaceType      string  'Remote' | 'Hybrid' | 'OnSite'
//   jobUrl             string  public posting -> url (applyUrl is the form)
//   descriptionPlain   string  plain text - populated on every row observed
//   descriptionHtml    string  HTML twin, used as a fallback
//   compensation       object  only present with ?includeCompensation=true
//
// Compensation is opt-in per employer: of the boards checked, ramp published a
// range on 131 of 137 postings while linear and posthog published none at all.
// `scrapeableCompensationSalarySummary` ("$211.4K - $290.6K") is preferred over
// `compensationTierSummary` ("$211.4K – $290.6K • Offers Equity") because the
// latter appends equity and benefit prose to the range. Both are already
// display-ready strings, so formatSalary() (which expects {min,max,currency})
// does not apply here.

import { normalise, toIso, htmlToText, looksRemote } from '../schema.js';
import { getJson } from '../http.js';

export const ats = 'ashby';

export function buildUrl(board) {
  return `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}?includeCompensation=true`;
}

/**
 * Pure: (payload, company) -> schema rows. No network.
 *
 * @param {any} payload   parsed JSON body from the Ashby job board endpoint
 * @param {{ name: string, ats: string, token: string }} company
 */
export function parse(payload, company) {
  const postings = Array.isArray(payload?.jobs) ? payload.jobs : [];
  const out = [];

  for (const it of postings) {
    if (!it || typeof it !== 'object') continue;
    // isListed false means the employer has unpublished it from the board.
    // Absent means listed: only an explicit false is treated as hidden.
    if (it.isListed === false) continue;

    const location = collectLocations(it);
    const title = it.title;

    const row = normalise({
      ats,
      company: company?.name,
      company_token: company?.token,
      ats_job_id: it.id,
      title,
      location,
      // Ashby exposes two remote signals that can disagree, the same way
      // Lever's do; OR them together with the location heuristic.
      remote: it.isRemote === true
        || String(it.workplaceType || '').toLowerCase() === 'remote'
        || looksRemote(location, title),
      url: it.jobUrl ?? it.applyUrl,
      posted_at: toIso(it.publishedAt),
      salary: salaryOf(it),
      raw_description: descriptionOf(it),
    });
    if (row) out.push(row);
  }

  return out;
}

/**
 * Primary location plus any secondaries, deduplicated.
 *
 * A posting open in several places lists the extras in secondaryLocations, and
 * the ranker cares: "Remote (US)" alone reads as a hard no for a Europe-based
 * candidate when the same posting is also open in Berlin.
 */
function collectLocations(it) {
  const parts = [];
  const push = (v) => {
    const s = typeof v === 'string' ? v.trim() : '';
    if (s && !parts.includes(s)) parts.push(s);
  };
  push(it.location);
  if (Array.isArray(it.secondaryLocations)) {
    for (const sec of it.secondaryLocations) push(sec?.location);
  }
  return parts.join('; ');
}

/** Plain text preferred; the HTML twin is the fallback. */
function descriptionOf(it) {
  const plain = typeof it.descriptionPlain === 'string' ? it.descriptionPlain.trim() : '';
  return plain || htmlToText(it.descriptionHtml);
}

/** Already-formatted range string, or '' when the employer publishes none. */
function salaryOf(it) {
  const comp = it.compensation;
  if (!comp || typeof comp !== 'object') return '';
  for (const key of ['scrapeableCompensationSalarySummary', 'compensationTierSummary']) {
    const v = comp[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

/** Fetch + parse in one call. Network lives here, not in parse(). */
export async function fetchJobs(company, { log, timeoutMs } = {}) {
  const payload = await getJson(buildUrl(company.token), { timeoutMs, log });
  return parse(payload, company);
}
