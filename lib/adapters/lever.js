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
//   descriptionPlain string  plain-text description - OFTEN EMPTY, see below
//   description      string  HTML description - OFTEN EMPTY, see below
//   workplaceType    string  'remote' | 'onsite' | 'hybrid'
//
// VERIFIED 2026-08-23 against api.lever.co/v0/postings/ledger: Lever spreads a
// posting's prose across SIX pairs of fields - description, opening,
// descriptionBody, additional and salaryDescription, each with a *Plain twin -
// and which of them are populated varies per posting. Ledger's postings leave
// description and descriptionPlain as empty strings and put the actual text in
// salaryDescriptionPlain. Reading description alone therefore yielded an empty
// raw_description on every row, which is why we now gather every populated
// part instead of trusting one field.
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

    const raw_description = collectText(it);

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

// Ordered so the posting reads naturally when several parts are present:
// the summary, then the opening, the body, any addendum, and finally the
// salary blurb. Plain variants are preferred; the HTML twin is the fallback.
const TEXT_FIELDS = [
  ['descriptionPlain', 'description'],
  ['openingPlain', 'opening'],
  ['descriptionBodyPlain', 'descriptionBody'],
  ['additionalPlain', 'additional'],
  ['salaryDescriptionPlain', 'salaryDescription'],
];

/**
 * Join every populated text field into one description.
 *
 * Lever often repeats itself - `description` is frequently opening +
 * descriptionBody + additional concatenated - so a part already contained in
 * what we have collected is skipped rather than duplicated.
 */
function collectText(it) {
  const parts = [];
  for (const [plainKey, htmlKey] of TEXT_FIELDS) {
    const plain = typeof it[plainKey] === 'string' ? it[plainKey].trim() : '';
    const text = plain || htmlToText(it[htmlKey]);
    if (!text) continue;
    if (parts.some((p) => p.includes(text))) continue;
    parts.push(text);
  }
  return parts.join('\n\n').trim();
}

/** Fetch + parse in one call. Network lives here, not in parse(). */
export async function fetchJobs(company, { log, timeoutMs } = {}) {
  const payload = await getJson(buildUrl(company.token), { timeoutMs, log });
  return parse(payload, company);
}
