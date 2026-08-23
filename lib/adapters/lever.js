// Lever postings API adapter.
//
// Endpoint: GET https://api.lever.co/v0/postings/{site}?mode=json
// (`mode=json` is what makes Lever return JSON instead of an HTML jobs page
// at the same path.)
//
// STATUS: the response shape below is INFERRED from public documentation and
// community write-ups, not observed live. This container's egress proxy
// blocks api.lever.co (403 on CONNECT), so nothing here has been exercised
// against the real API this session (2026-08-23). Treat every field name and
// type as a hypothesis to be confirmed the first time this adapter runs
// somewhere with open egress, not as verified fact.
//
// Inferred shape: the top-level response is a bare ARRAY of postings (no
// wrapper object, unlike Greenhouse), each element:
//   id               string  -> ats_job_id
//   text             string  -> title
//   categories       object  -> categories.location -> location
//                              (categories.commitment, categories.team also
//                              exist but the schema has no field for them)
//   hostedUrl        string  -> url (fall back to applyUrl if hostedUrl is absent)
//   createdAt        number  epoch MILLISECONDS -> posted_at via toIso()
//   descriptionPlain string  plain-text description, already renderable
//   description      string  HTML description, used only when descriptionPlain is missing
//   workplaceType    string  'remote' | 'onsite' | 'hybrid'
//
// remote is true when Lever's own workplaceType says 'remote' OR the location
// text reads as remote by our generic heuristic — the two signals disagree
// often enough (a role tagged onsite for a specific hub city, described in
// prose as "remote-first") that OR-ing them catches more true remote roles
// than trusting either alone.

import { normalise, toIso, htmlToText, looksRemote } from '../schema.js';
import { getJson } from '../http.js';

export const ats = 'lever';

export function buildUrl(site) {
  return `https://api.lever.co/v0/postings/${encodeURIComponent(site)}?mode=json`;
}

/**
 * Pure: (payload, company) -> schema rows. No network. Safe to call directly
 * against a hand-built fixture in tests.
 *
 * @param {any} payload   parsed JSON body from the Lever postings endpoint
 * @param {{ name: string, ats: string, token: string }} company
 */
export function parse(payload, company) {
  const postings = Array.isArray(payload) ? payload : [];
  const out = [];

  for (const it of postings) {
    if (!it || typeof it !== 'object') continue;

    const categories = it.categories && typeof it.categories === 'object' ? it.categories : {};
    const location = categories.location;
    const title = it.text;

    const raw_description = it.descriptionPlain
      ? String(it.descriptionPlain).trim()
      : htmlToText(it.description);

    const row = normalise({
      ats,
      company: company?.name,
      company_token: company?.token,
      ats_job_id: it.id,
      title,
      location,
      remote: it.workplaceType === 'remote' || looksRemote(location, title),
      url: it.hostedUrl ?? it.applyUrl,
      posted_at: toIso(it.createdAt),
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
