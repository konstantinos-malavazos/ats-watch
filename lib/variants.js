// Collapse the same role listed once per location.
//
// Boards re-list one opening for every country it can be filled in, each with
// its own ATS job id. The dedupe tuple (ats, company_token, ats_job_id) cannot
// see that: the ids really are different postings. In one live state file 1247
// of 3497 rows were re-listings — Elastic published one "Principal Product
// Manager" 25 times, Datadog one "Strategic Account Executive" 31 times. Sent
// as-is, they cost 25 rankings and fill the digest with 25 identical entries.
//
// This is deliberately NOT part of dedupe() in lib/seen.js. State must keep
// every ats_job_id, or the copies we collapsed today all look new tomorrow.
// Collapsing happens on the run's selection only, after first-seen, and the
// variant counts travel in a side map — nothing is added to the job objects,
// because lib/schema.js owns the twelve fields and nothing downstream may add
// a thirteenth.

/** Regional shorthands that appear as a title segment in place of a country. */
const REGION_RE = /^(remote|hybrid|on-?site|emea|apac|amea|meta|amer|americas|latam|na|eu|uk|us|usa)$/i;

/**
 * Strip trailing location segments from a title.
 *
 * A segment is only stripped when the posting's own `location` field confirms
 * it is a place, or when it is one of the regional shorthands above. That is
 * what keeps "Staff Backend Engineer, Search" and "Staff Backend Engineer,
 * Payments" apart while joining "... | Canada | Remote" to "... | Spain |
 * Remote": "Search" appears in no location field, "Canada" does.
 *
 * The first segment is never stripped, so a title never collapses to ''.
 */
export function baseTitle(title, location = '') {
  const segments = String(title || '').split(/\s*[|]\s*|\s+[-–—]\s+|\s*,\s*/);
  const loc = String(location || '').toLowerCase();
  while (segments.length > 1) {
    const last = segments[segments.length - 1].replace(/[()]/g, '').trim();
    const isPlace = REGION_RE.test(last)
      || (last.length > 2 && loc.includes(last.toLowerCase()));
    if (!isPlace) break;
    segments.pop();
  }
  return segments.join(' - ').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Collapse re-listings of one role into a single representative posting.
 *
 * The first posting of a group wins, which is the same rule dedupe() uses: the
 * canonical listing comes first and the re-listings follow.
 *
 * @param {Array} jobs
 * @returns {{ jobs: Array, variants: Map<string, {count:number, locations:string[]}> }}
 *   `variants` is keyed by the representative job's id and holds only groups
 *   with more than one posting. The renderers use it to say "+N other
 *   locations"; a job absent from the map was never collapsed.
 */
export function collapseVariants(jobs) {
  const groups = new Map();
  for (const job of jobs) {
    const key = `${job.ats}:${job.company_token}:${baseTitle(job.title, job.location)}`;
    const group = groups.get(key);
    if (group) group.push(job);
    else groups.set(key, [job]);
  }

  const out = [];
  const variants = new Map();
  for (const group of groups.values()) {
    const [first] = group;
    out.push(first);
    if (group.length === 1) continue;
    const locations = [];
    for (const j of group) {
      const where = String(j.location || '').trim();
      if (where && !locations.includes(where)) locations.push(where);
    }
    variants.set(first.id, { count: group.length, locations });
  }
  return { jobs: out, variants };
}
