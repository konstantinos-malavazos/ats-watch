// Post-selection filtering: applied to the fresh jobs only, after first-seen
// selection and before ranking.

/**
 * Keep jobs posted on or after `sinceIso`.
 *
 * Jobs whose feed gave us no posted_at are KEPT. We cannot prove such a job is
 * old, and silently dropping it would be the one failure mode this tool must
 * not have — a job you never see is worse than a job you skim past.
 */
export function filterSince(jobs, sinceIso) {
  if (!sinceIso) return jobs;
  const cutoff = Date.parse(sinceIso);
  if (Number.isNaN(cutoff)) return jobs;
  return jobs.filter((j) => {
    if (!j.posted_at) return true;
    const t = Date.parse(j.posted_at);
    return Number.isNaN(t) ? true : t >= cutoff;
  });
}

/** Cap the list length. `limit` of null means no cap. */
export function applyLimit(jobs, limit) {
  return limit && limit > 0 ? jobs.slice(0, limit) : jobs;
}
