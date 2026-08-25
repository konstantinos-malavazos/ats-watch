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

// How long an entry survives after it stops appearing on its board. Nothing
// ever left state before this, so a filled job sat there forever: 363 bytes
// each, ~75 new postings a day, ~11 MB after a year, all of it parsed and
// rewritten on every run.
//
// Only entries missing from the CURRENT run are candidates, and every entry
// this run touched has last_seen === now, so the window is 90 consecutive days
// of absence from the board. That is the safety margin: a board that 404s, or
// a company that pauses hiring for a quarter, does not lose its history and
// re-report the same jobs as new. An entry with no readable last_seen is kept,
// because deleting on unparseable data is the one mistake that shows up as a
// flood of false "new" postings.
export const PRUNE_AFTER_DAYS = 90;

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
 *
 * The returned state is also pruned: see PRUNE_AFTER_DAYS. Freshness is decided
 * against `prior` before anything is dropped, so pruning can never turn a job
 * this run actually saw into a new one.
 */
export function selectNew(jobs, state, now = new Date().toISOString(), { pruneAfterDays = PRUNE_AFTER_DAYS } = {}) {
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

  const pruned = prune(nextJobs, now, pruneAfterDays);

  return {
    fresh,
    nextState: { version: STATE_VERSION, jobs: nextJobs },
    counts: {
      fetched: jobs.length,
      unique: unique.length,
      fresh: fresh.length,
      known: unique.length - fresh.length,
      pruned,
    },
  };
}

/**
 * Drop entries that stopped appearing on their board more than `days` ago.
 * Mutates the caller's own fresh copy of the map, never the state passed in,
 * so selectNew stays pure. Returns the number removed.
 */
function prune(nextJobs, now, days) {
  if (!(days > 0)) return 0;
  const cutoff = Date.parse(now) - days * 86400000;
  if (Number.isNaN(cutoff)) return 0;

  let removed = 0;
  for (const [key, rec] of Object.entries(nextJobs)) {
    const seen = Date.parse(rec && rec.last_seen);
    if (Number.isNaN(seen) || seen >= cutoff) continue;
    delete nextJobs[key];
    removed += 1;
  }
  return removed;
}
