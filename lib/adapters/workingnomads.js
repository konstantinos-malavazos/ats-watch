// Working Nomads remote-jobs board adapter.
//
// Endpoint: GET https://www.workingnomads.com/api/exposed_jobs/
//   There is one endpoint and it takes no filter, so the sources.json token
//   is ignored (by convention "all").
//
// STATUS: VERIFIED 2026-10-30 against one live response from
// /api/exposed_jobs/ (38 jobs, published 2026-10-01 to 2026-10-29). Every
// field mapped below was read off that response.
//
// Terms (read 2026-10-30): NO API-specific terms, attribution rule or rate
// limit were found. robots.txt is `User-agent: *` / `Disallow:` (empty, i.e.
// everything allowed), and the site's own footer links "API" to this
// endpoint. The site terms (3.1) prohibit building a competitive product or
// commercially exploiting the service; a personal digest is neither. One call
// per run.
//
// Observed response shape: a BARE JSON ARRAY, no envelope, no pagination.
// Each item has exactly these 8 keys:
//   url           string  https://www.workingnomads.com/job/go/<id>/ (a
//                         redirect link) -> url; there is NO id field, so
//                         ats_job_id is the <id> taken from this url. All 38
//                         live urls matched and all 38 ids were unique. A url
//                         without the segment gives '' and normalise drops it.
//   title         string  -> title
//   company_name  string  -> company / company_token via boardCompany
//   location      string  free text, kept verbatim, e.g. "Time zone: CET
//                         (+/- 3 hours)", "Global" -> location
//   pub_date      string  ISO 8601 with a US Eastern offset
//                         ("2026-10-29T09:50:51-04:00"; -05:00 after the
//                         2026-11-01 DST change) -> posted_at; toIso honours
//                         the offset
//   description   string  HTML -> raw_description via htmlToText
//   category_name, tags (a comma-separated STRING)   unused
// NO PAY FIELD EXISTS, so `salary` is always ''. Everything on the board is
// remote; there is no remote flag.

import { normalise, toIso, htmlToText, boardCompany } from '../schema.js';
import { getJson } from '../http.js';

export const ats = 'workingnomads';

const ENDPOINT = 'https://www.workingnomads.com/api/exposed_jobs/';
const JOB_ID_RE = /\/job\/go\/(\d+)/;

export function buildUrl(_token) {
  return ENDPOINT;
}

/**
 * Pure: (payload, source) -> schema rows. No network.
 *
 * The source entry is deliberately unused: on a board, company and
 * company_token come from each posting, never from sources.json.
 *
 * @param {any} payload  parsed JSON body (a bare array) from Working Nomads
 * @param {{ name: string, ats: string, token: string }} _source
 */
export function parse(payload, _source) {
  const postings = Array.isArray(payload) ? payload : [];
  const out = [];

  for (const it of postings) {
    if (!it || typeof it !== 'object') continue;
    const id = JOB_ID_RE.exec(String(it.url ?? ''))?.[1] ?? '';

    const row = normalise({
      ats,
      ...boardCompany(it.company_name, id),
      ats_job_id: id,
      title: it.title,
      location: it.location,
      remote: true,
      url: it.url,
      posted_at: toIso(it.pub_date),
      salary: '',
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
