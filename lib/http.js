// A polite fetcher for public ATS feeds. "Polite" here means two concrete
// things: we identify ourselves with a real User-Agent naming the project and
// a contact URL (so an ATS operator annoyed by our traffic has somewhere to
// look before blocking us), and we never hit a source in parallel — see
// politeSequential below, which is the only place this codebase is allowed to
// call multiple ATS endpoints in one run.

import { setTimeout as sleep } from 'node:timers/promises';

export const USER_AGENT =
  'ats-watch/0.1 (personal job watcher; +https://github.com/konstantinos-malavazos/ats-watch)';

/**
 * Fetch `url` and parse the body as JSON. Rejects on a non-2xx status or on
 * a body that isn't valid JSON, in both cases with a message that names the
 * URL so a failure in politeSequential's catch is legible without needing to
 * re-derive which source it came from.
 *
 * @param {string} url
 * @param {{ timeoutMs?: number, log?: import('./log.js').Logger }} [opts]
 */
export async function getJson(url, { timeoutMs = 15000, log } = {}) {
  log?.info('fetching', url);
  const res = await fetch(url, {
    headers: {
      'user-agent': USER_AGENT,
      accept: 'application/json',
    },
    // AbortSignal.timeout builds a signal that fires on its own after
    // timeoutMs; no manual AbortController/clearTimeout bookkeeping needed.
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
  }

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    // Deliberately not including the body in the error: ATS error pages are
    // sometimes full HTML documents and dumping one into the log would drown
    // out everything else in a multi-source run.
    throw new Error(`GET ${url} did not return valid JSON`);
  }
}

/**
 * Run fn(item) once per item, strictly one at a time, sleeping delayMs
 * between calls (never before the first or after the last). A single ATS is
 * one operator's infrastructure; running sources concurrently would multiply
 * our footprint on whichever one happens to be slow, which is the opposite
 * of polite. Sequential also gives us a predictable, easy-to-reason-about
 * request pattern to point to if anyone ever asks what this tool does.
 *
 * A throwing fn does not abort the run: one dead or rate-limiting source
 * must not take down the digest for every other company being watched. The
 * error is logged and recorded in `failures` instead.
 *
 * @template T, R
 * @param {T[]} items
 * @param {(item: T) => Promise<R[]>} fn
 * @param {{ delayMs?: number, log?: import('./log.js').Logger }} [opts]
 * @returns {Promise<{ results: R[], failures: { item: T, error: Error }[] }>}
 */
export async function politeSequential(items, fn, { delayMs = 1000, log } = {}) {
  const results = [];
  const failures = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (i > 0) await sleep(delayMs);
    try {
      const out = await fn(item);
      results.push(...out);
    } catch (error) {
      log?.error(`source failed: ${describe(item)}`, error);
      failures.push({ item, error });
    }
  }

  return { results, failures };
}

function describe(item) {
  if (item === null || typeof item !== 'object') return String(item);
  // Best-effort label for the common shape ({ name, ats, token }) without
  // assuming callers only ever pass company records through here.
  return item.name ?? item.token ?? item.id ?? JSON.stringify(item);
}
