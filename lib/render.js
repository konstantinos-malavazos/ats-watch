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
 * @param {Array} jobs         fresh jobs, already filtered
 * @param {Map|null} ranks     job.id -> { score, rationale, red_flags }, or
 *                             null when the ranker is unavailable (we then
 *                             print the unranked list rather than losing the
 *                             day's jobs)
 * @param {Map|null} variants  job.id -> { count, locations }, for a role the
 *                             board listed once per location; see
 *                             lib/variants.js. Absent means "not collapsed".
 * @returns {string} digest, '' when there is nothing to say
 */
export function renderDigest(jobs, ranks = null, variants = null) {
  if (!jobs.length) return '';

  const ordered = ranks ? sortByScore(jobs, ranks) : jobs;
  const header = `${ordered.length} new role${ordered.length === 1 ? '' : 's'}`;

  const blocks = [];
  let used = header.length;
  let shown = 0;

  for (const job of ordered) {
    const block = renderJob(job, ranks && ranks.get(job.id), variants && variants.get(job.id));
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

function renderJob(job, rank, variant) {
  const score = rank && Number.isFinite(rank.score) ? `[${rank.score}] ` : '';
  const where = placeOf(job);
  const lines = [`${score}${job.title} - ${job.company}${where ? ` (${where})` : ''}`];
  const also = alsoIn(variant);
  if (also) lines.push(`  ${also}`);

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

/**
 * One line for a role the board listed once per location. The count is the
 * useful part - the locations themselves are on the posting, and listing
 * twenty-six of them would cost more of the budget than they are worth.
 */
function alsoIn(variant) {
  if (!variant || variant.count < 2) return '';
  const n = variant.count - 1;
  return `also listed in ${n} other location${n === 1 ? '' : 's'}`;
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

// --- Discord rendering ---------------------------------------------------
//
// A second renderer, for the delivery path only. renderDigest() above is the
// product on stdout and stays plain text within BUDGET; this one targets one
// specific surface and is free to use Discord's markdown.
//
// It is deliberately NOT capped. A digest of eight roles does not fit in 1500
// characters, and silently dropping half of them behind "+N more" hides jobs
// the whole tool exists to surface. The caller splits the result into
// messages; renderDiscordChunks() below does that on block boundaries.

/**
 * Score bands. The point of the badge is to answer "do I act on this?" without
 * having to interpret a number, so the wording is an instruction, not a label.
 */
const BANDS = [
  { min: 8, badge: '🟢', verdict: 'send your CV' },
  { min: 6, badge: '🟡', verdict: 'worth a look' },
  { min: 3, badge: '⚪', verdict: 'probably not' },
  { min: 0, badge: '🔴', verdict: 'skip' },
];

function bandFor(score) {
  return BANDS.find((b) => score >= b.min) || BANDS[BANDS.length - 1];
}

/**
 * Render the digest as Discord markdown.
 *
 * @param {Array} jobs         fresh jobs, already filtered
 * @param {Map|null} ranks     job.id -> { score, rationale, red_flags }, or null
 * @param {Map|null} variants  job.id -> { count, locations }; see lib/variants.js
 * @returns {string} '' when there is nothing to say
 */
export function renderDiscord(jobs, ranks = null, variants = null) {
  if (!jobs.length) return '';

  const ordered = ranks ? sortByScore(jobs, ranks) : jobs;
  const worth = ranks
    ? ordered.filter((j) => scoreOf(ranks, j) >= 8).length
    : 0;

  const count = `**${ordered.length} new role${ordered.length === 1 ? '' : 's'}**`;
  const header = ranks
    ? `${count} · ${worth} worth applying to`
    : `${count} · unranked (ranker unavailable)`;

  return [
    header,
    ...ordered.map((j) => renderDiscordJob(
      j,
      ranks && ranks.get(j.id),
      variants && variants.get(j.id),
    )),
  ].join('\n\n');
}

/**
 * Location for the Discord line.
 *
 * Ashby boards list every eligible country individually - one n8n posting
 * carries twenty-six - which would swamp the entry. Past three, the count is
 * the useful signal; the specific country is in the rationale and the posting.
 */
function whereForDiscord(job) {
  const w = placeOf(job);
  if (!w) return '';
  const parts = w.split(';').map((x) => x.trim()).filter(Boolean);
  if (parts.length <= 3) return oneLine(w, 90);
  return `${job.remote ? 'Remote' : 'Multiple sites'} - ${parts.length} locations`;
}

function renderDiscordJob(job, rank, variant) {
  const lines = [];
  const where = whereForDiscord(job);

  if (rank && Number.isFinite(rank.score)) {
    const { badge, verdict } = bandFor(rank.score);
    lines.push(`${badge} **${rank.score}/10 · ${verdict}**`);
  }

  // Angle brackets round the URL suppress Discord's link preview per-link, so
  // a digest of twenty roles doesn't unfurl into twenty embeds.
  lines.push(job.url ? `**[${job.title}](<${job.url}>)**` : `**${job.title}**`);

  const meta = [job.company, where, job.salary, alsoIn(variant)].filter(Boolean).join(' · ');
  if (meta) lines.push(meta);

  // Blockquote the rationale: it is the model talking, not the posting.
  if (rank && rank.rationale) lines.push(`> ${oneLine(rank.rationale, 200)}`);
  if (rank && Array.isArray(rank.red_flags) && rank.red_flags.length) {
    lines.push(`⚠️ ${oneLine(rank.red_flags.join(' · '), 200)}`);
  }
  return lines.join('\n');
}

/**
 * Split a rendered Discord digest into messages of at most `max` characters.
 *
 * Splits between blocks, never inside one, so a role is never cut in half and
 * a URL never lands broken across two messages. A single block longer than
 * `max` is emitted on its own and hard-clamped — it cannot be sent otherwise.
 *
 * @param {string} text  output of renderDiscord()
 * @param {number} max   Discord's own limit is 2000; default leaves headroom
 * @returns {string[]}   '' in, [] out
 */
export function renderDiscordChunks(text, max = 1900) {
  if (!text) return [];
  const blocks = text.split('\n\n');
  const out = [];
  let cur = '';

  for (const block of blocks) {
    const piece = cur ? `${cur}\n\n${block}` : block;
    if (piece.length <= max) { cur = piece; continue; }
    if (cur) out.push(cur);
    cur = block.length <= max ? block : clamp(block, max);
  }
  if (cur) out.push(cur);
  return out;
}
