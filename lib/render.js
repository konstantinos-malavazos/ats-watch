// STDOUT IS THE PRODUCT.
//
// A normal run prints a short plain-text digest and nothing else. No ANSI, no
// banners, no box drawing — this goes straight into a Discord message. Zero new
// jobs prints nothing at all and the process exits 0.
//
// Budget: BUDGET chars. We render whole entries only and, if we run out of
// room, stop and add a one-line "+N more" tail rather than truncating a URL
// into something unclickable.

export const BUDGET = 1500;

/**
 * @param {Array} jobs      fresh jobs, already filtered
 * @param {Map|null} ranks  job.id -> { score, rationale, red_flags }, or null
 *                          when the ranker is unavailable (we then print the
 *                          unranked list rather than losing the day's jobs)
 * @returns {string} digest, '' when there is nothing to say
 */
export function renderDigest(jobs, ranks = null) {
  if (!jobs.length) return '';

  const ordered = ranks ? sortByScore(jobs, ranks) : jobs;
  const header = `${ordered.length} new role${ordered.length === 1 ? '' : 's'}`;

  const blocks = [];
  let used = header.length;
  let shown = 0;

  for (const job of ordered) {
    const block = renderJob(job, ranks && ranks.get(job.id));
    // +2 for the blank line joining this block to the previous text.
    const cost = block.length + 2;
    const tail = ordered.length - shown - 1;
    const reserve = tail > 0 ? `\n+${tail} more`.length : 0;
    if (used + cost + reserve > BUDGET && shown > 0) break;
    blocks.push(block);
    used += cost;
    shown += 1;
  }

  let out = [header, ...blocks].join('\n\n');
  const omitted = ordered.length - shown;
  if (omitted > 0) out += `\n+${omitted} more`;
  return clamp(out, BUDGET);
}

function renderJob(job, rank) {
  const score = rank && Number.isFinite(rank.score) ? `[${rank.score}] ` : '';
  const where = placeOf(job);
  const lines = [`${score}${job.title} - ${job.company}${where ? ` (${where})` : ''}`];

  // Printed only when the posting actually states a range, so the common case
  // costs nothing against the character budget.
  if (job.salary) lines.push(`  ${job.salary}`);
  if (rank && rank.rationale) lines.push(`  ${oneLine(rank.rationale, 140)}`);
  if (rank && Array.isArray(rank.red_flags) && rank.red_flags.length) {
    lines.push(`  flags: ${oneLine(rank.red_flags.join('; '), 100)}`);
  }
  if (job.url) lines.push(`  ${job.url}`);
  return lines.join('\n');
}

function placeOf(job) {
  if (!job.remote) return job.location;
  // Feeds often already say "Remote" in the location string; prefixing our own
  // would render "Remote - Remote - United States".
  if (!job.location) return 'Remote';
  return /\bremote\b/i.test(job.location) ? job.location : `Remote - ${job.location}`;
}

function sortByScore(jobs, ranks) {
  return jobs.slice().sort((a, b) => {
    const sa = scoreOf(ranks, a), sb = scoreOf(ranks, b);
    if (sa !== sb) return sb - sa;
    return a.title.localeCompare(b.title);
  });
}

function scoreOf(ranks, job) {
  const r = ranks.get(job.id);
  return r && Number.isFinite(r.score) ? r.score : -1;
}

function oneLine(s, max) {
  const flat = String(s).replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}...` : flat;
}

function clamp(s, max) {
  return s.length <= max ? s : `${s.slice(0, max - 3).trimEnd()}...`;
}
