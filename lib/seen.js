// Dedupe and first-seen selection. This is the part that actually breaks, so
// it is deliberately small, pure, and covered by tests.
//
// Contract:
//   dedupe(jobs)                  -> jobs with duplicate tuples collapsed, order kept
//   selectNew(jobs, state, now)   -> { fresh, nextState, counts }
//
// `state` is the plain object held by lib/store.js: { version, jobs: {key: rec} }.
// selectNew is PURE — it returns the next state rather than mutating the one
// passed in, which is what makes --dry-run trivially correct: run it, print the
// result, throw the new state away.

import { jobKey } from './schema.js';

export const STATE_VERSION = 1;

export function emptyState() {
  return { version: STATE_VERSION, jobs: {} };
}

/**
 * Collapse rows sharing a dedupe tuple. First occurrence wins, because feeds
 * list the canonical posting first and repeats tend to be cross-listings.
 */
export function dedupe(jobs) {
  const out = [];
  const seen = new Set();
  for (const job of jobs) {
    const key = jobKey(job);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(job);
  }
  return out;
}

/**
 * Split this run's jobs into those never seen before and those we already
 * know about, and produce the state to persist.
 *
 * A job is "fresh" iff its dedupe tuple is absent from `state.jobs`. That is
 * the whole rule. We deliberately do NOT treat a changed title or a changed
 * posted_at as new — retitled postings are the single largest source of
 * false positives in this kind of watcher.
 */
export function selectNew(jobs, state, now = new Date().toISOString()) {
  const prior = (state && state.jobs) || {};
  const nextJobs = { ...prior };
  const unique = dedupe(jobs);
  const fresh = [];

  for (const job of unique) {
    const key = jobKey(job);
    const known = prior[key];
    if (known) {
      nextJobs[key] = { ...known, last_seen: now, title: job.title, url: job.url };
    } else {
      fresh.push(job);
      nextJobs[key] = {
        first_seen: now,
        last_seen: now,
        ats: job.ats,
        company_token: job.company_token,
        ats_job_id: job.ats_job_id,
        title: job.title,
        url: job.url,
      };
    }
  }

  return {
    fresh,
    nextState: { version: STATE_VERSION, jobs: nextJobs },
    counts: {
      fetched: jobs.length,
      unique: unique.length,
      fresh: fresh.length,
      known: unique.length - fresh.length,
    },
  };
}
