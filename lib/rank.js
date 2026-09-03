// Ranking step.
//
// Talks to an OpenAI-compatible /v1/chat/completions endpoint, defaulting to
// DeepSeek. All of it stays env-configurable so a different provider is an env
// change rather than a code change:
//
//   ATS_WATCH_LLM_API_KEY    (falls back to DEEPSEEK_API_KEY)  - required
//   ATS_WATCH_LLM_BASE_URL   default https://api.deepseek.com
//   ATS_WATCH_LLM_MODEL      default deepseek-v4-pro
//   ATS_WATCH_LLM_MAX_TOKENS default: see maxTokens() below
//   ATS_WATCH_LLM_TIMEOUT_MS  default 300000
//
// VERIFIED 2026-08-24 against the live API: POST to
// https://api.deepseek.com/v1/chat/completions with model deepseek-v4-pro
// returns 200 and a parseable ranking. The /v1 segment is undocumented on
// DeepSeek's own reference page (which lists POST /chat/completions) but is
// served, so both paths work.
//
// VERIFIED 2026-09-03: max_tokens of 16560, 22160 and 32768 are all accepted
// with HTTP 200, so the widened budget below cannot 400 the request - the
// 32768 cap is ours, not the provider's.
//
// rankJobs() NEVER throws and never rejects. Every failure path - no key, a
// network error, a non-2xx, an unparseable body, a response that is not the
// JSON we asked for - returns null, which the pipeline treats as "unranked"
// and prints the plain list. A broken ranker must not lose the day's jobs.

/** Cap on description text per job, in characters, to keep the prompt bounded. */
const DESC_BUDGET = 1200;

export const SYSTEM_PROMPT = [
  'You are screening job postings for one specific candidate.',
  'The candidate profile you are given is the ONLY definition of a good match; do not substitute generic notions of prestige, seniority or compensation.',
  '',
  'For each posting, return:',
  '  score      integer 0-10. 0 = irrelevant, 5 = plausible but unremarkable, 8+ = the candidate should apply today.',
  '             Be harsh. Most postings are not a match. Do not cluster scores in the middle.',
  '  rationale  ONE line, at most 140 characters, naming the specific thing that makes this a match or not.',
  '             Reference something concrete from the posting. Never write generic filler.',
  '  red_flags  array of short strings for anything in the posting that conflicts with the profile',
  '',
  'A posting\'s `salary` field is null unless the feed stated a range. Null means unknown, NOT low -',
  'do not penalise a posting for it, and do not infer a figure from the title or the company.',
  '             (location or timezone mismatch, seniority mismatch, an explicit hard-no, contract-only,',
  '             heavy on-call, an industry the candidate excluded). Empty array when there are none.',
  '',
  'Judge only from the text supplied. Do not speculate about the company beyond what the posting says.',
  '',
  'Return JSON ONLY. No prose, no markdown, no code fences, no commentary before or after.',
  'The response must be a single JSON object of exactly this shape:',
  '{"rankings":[{"id":"<the id given>","score":0,"rationale":"","red_flags":[]}]}',
  'Include exactly one entry per posting, using the id supplied with that posting.',
].join('\n');

/** Build the user-side message: the profile, then the postings as JSON. */
export function buildUserPrompt(profile, jobs) {
  const postings = jobs.map((j) => ({
    id: j.id,
    title: j.title,
    company: j.company,
    location: j.location || null,
    remote: j.remote,
    posted_at: j.posted_at,
    salary: j.salary || null,
    description: truncate(j.raw_description, DESC_BUDGET),
  }));
  return [
    '## Candidate profile',
    '',
    String(profile || '').trim() || '(no profile supplied)',
    '',
    `## Postings to score (${postings.length})`,
    '',
    JSON.stringify(postings, null, 2),
    '',
    'Return the JSON object described in the system prompt, and nothing else.',
  ].join('\n');
}

/**
 * Parse a model response into a Map of id -> { score, rationale, red_flags }.
 *
 * Defensive by design: models wrap JSON in code fences, prepend "Here is the
 * JSON:", or return a bare array instead of the wrapper object. We recover
 * from all of those. Returns null only when nothing usable can be extracted,
 * which the caller turns into the unranked fallback.
 */
export function parseRankingResponse(text, jobs) {
  const valid = new Set(jobs.map((j) => j.id));
  const raw = extractJson(text);
  if (!raw) return null;

  const list = Array.isArray(raw) ? raw
    : Array.isArray(raw.rankings) ? raw.rankings
    : Array.isArray(raw.results) ? raw.results
    : null;
  if (!list) return null;

  const out = new Map();
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const id = String(entry.id ?? '').trim();
    if (!valid.has(id) || out.has(id)) continue;
    out.set(id, {
      score: clampScore(entry.score),
      rationale: typeof entry.rationale === 'string' ? entry.rationale.trim() : '',
      red_flags: normaliseFlags(entry.red_flags),
    });
  }
  return out.size ? out : null;
}

/** Pull the first balanced JSON object or array out of a noisy response. */
function extractJson(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  let s = text.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  const direct = tryParse(s);
  if (direct !== undefined) return direct;

  // Scan for a balanced {...} or [...], respecting strings and escapes.
  for (let i = 0; i < s.length; i++) {
    const open = s[i];
    if (open !== '{' && open !== '[') continue;
    const close = open === '{' ? '}' : ']';
    let depth = 0, inStr = false, esc = false;
    for (let j = i; j < s.length; j++) {
      const c = s[j];
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === open) depth++;
      else if (c === close) {
        depth--;
        if (depth === 0) {
          const parsed = tryParse(s.slice(i, j + 1));
          if (parsed !== undefined) return parsed;
          break;
        }
      }
    }
  }
  return null;
}

function tryParse(s) {
  try { return JSON.parse(s); } catch { return undefined; }
}

function clampScore(v) {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim());
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(10, Math.round(n)));
}

function normaliseFlags(v) {
  if (typeof v === 'string') return v.trim() ? [v.trim()] : [];
  if (!Array.isArray(v)) return [];
  return v.map((f) => String(f).trim()).filter(Boolean).slice(0, 6);
}

function truncate(s, max) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}...` : t;
}

const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-v4-pro';
/**
 * Per-request timeout.
 *
 * A reasoning model thinks before it answers, and a batch of two dozen jobs
 * with full descriptions is a large prompt: the first real 23-job run blew
 * straight through the original 60s. Sized for a cron job that would rather
 * wait than lose the day's ranking; override for an interactive run.
 */
const DEFAULT_TIMEOUT_MS = 300000;
function requestTimeoutMs() {
  const env = Number(process.env.ATS_WATCH_LLM_TIMEOUT_MS);
  return Number.isFinite(env) && env > 0 ? Math.floor(env) : DEFAULT_TIMEOUT_MS;
}

/**
 * Output token budget for a batch.
 *
 * deepseek-v4-pro is a REASONING model: it spends tokens on hidden reasoning
 * before emitting the first content token, and those count against max_tokens.
 * Measured against the live API (2026-08-24): a 5-job prompt burnt ~750-1020
 * reasoning tokens, so the previous 256 + jobs*160 budget (1056 for 5 jobs)
 * was consumed entirely by reasoning and came back with finish_reason
 * "length" and empty content - which the pipeline correctly, but uselessly,
 * degraded to the unranked list.
 *
 * HEADROOM covers the reasoning pass; the per-job figure covers the answer.
 * Unused budget is not billed, so it is priced to overshoot.
 *
 * The reasoning term has to scale with the batch too. A flat 2048 was sized
 * against a 5-job prompt and then failed on an 8-job one (2026-09-03: the
 * 5760-token budget for the day's last batch was exhausted mid-answer, and
 * those 8 jobs printed unranked, which walked them straight past --min-score).
 * The model reasons about each posting, so a fixed headroom gets squeezed by
 * exactly the batches too small for the linear per-job term to cover them.
 *
 * No formula is provably enough, because reasoning tokens are spent before
 * any content and are invisible until they have already eaten the answer.
 * That is what the split-on-truncation retry below is for.
 */
const REASONING_HEADROOM = 2048;
const REASONING_PER_JOB = 300;
function maxTokens(jobCount) {
  const env = Number(process.env.ATS_WATCH_LLM_MAX_TOKENS);
  if (Number.isFinite(env) && env > 0) return Math.floor(env);
  return Math.min(32768, REASONING_HEADROOM + REASONING_PER_JOB * jobCount + 512 + jobCount * 400);
}

/**
 * Largest number of postings sent in one request.
 *
 * The model drops entries from large batches: it returns well-formed JSON with
 * fewer rankings than postings, which parseRankingResponse cannot detect - a
 * short map parses exactly like a complete one. Observed repeatedly at 30
 * postings per request. Twenty is the size this project sends.
 */
const DEFAULT_BATCH_SIZE = 20;
function batchSize() {
  const env = Number(process.env.ATS_WATCH_LLM_BATCH_SIZE);
  return Number.isFinite(env) && env > 0 ? Math.floor(env) : DEFAULT_BATCH_SIZE;
}

/**
 * Rank jobs against the profile.
 *
 * Splits the selection into batches of at most batchSize() and issues one
 * request per batch, sequentially - one provider, one request at a time, the
 * same courtesy politeSequential extends to the ATS endpoints.
 *
 * Scores are absolute (the system prompt asks for a 0-10 judgement against the
 * profile, not a ranking), so results from separate batches are comparable and
 * merging them is sound. A batch that fails does not sink the others: whatever
 * came back is returned and the missing jobs print unranked. null is returned
 * only when every batch failed, which keeps the single-batch case - and every
 * failure path documented at the top of this file - behaving exactly as before.
 *
 * @returns {Promise<Map<string, {score:number, rationale:string, red_flags:string[]}>|null>}
 *   null means "ranking unavailable" - the caller prints the unranked list.
 */
export async function rankJobs(jobs, profile, { log, fetchImpl = globalThis.fetch } = {}) {
  if (!jobs.length) return null;

  const apiKey = process.env.ATS_WATCH_LLM_API_KEY || process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    log?.warn('no ATS_WATCH_LLM_API_KEY or DEEPSEEK_API_KEY set - printing unranked list');
    return null;
  }

  const batches = [];
  const size = batchSize();
  for (let i = 0; i < jobs.length; i += size) batches.push(jobs.slice(i, i + size));
  if (batches.length > 1) {
    log?.info(`ranking ${jobs.length} job(s) in ${batches.length} batches of up to ${size}`);
  }

  const merged = new Map();
  let failed = 0;
  for (let i = 0; i < batches.length; i++) {
    const label = batches.length > 1 ? `batch ${i + 1}/${batches.length}: ` : '';
    const ranks = await rankSplitting(batches[i], profile, { log, fetchImpl, apiKey }, label);
    if (!ranks) { failed++; continue; }
    for (const [id, r] of ranks) merged.set(id, r);
  }

  if (failed === batches.length) return null;
  if (failed) log?.warn(`${failed} of ${batches.length} batches failed - those jobs print unranked`);

  const missing = jobs.length - merged.size;
  if (missing > 0) log?.warn(`ranker scored ${merged.size} of ${jobs.length} jobs`);
  return merged;
}

/**
 * Rank one batch, halving it and retrying if the model ran out of budget.
 *
 * A truncated response is the one failure worth retrying: it means the answer
 * was too long for max_tokens, and asking for half the answer is a request we
 * know how to make smaller. Every other failure (no key, HTTP error, garbage
 * body) would fail identically the second time, so it is returned as-is.
 *
 * The extra request is only ever paid on failure, and the alternative is the
 * whole batch printing unranked - which is how eight non-engineering roles got
 * past --min-score 7 into the digest on 2026-09-03. Recursion bottoms out at a
 * single posting, which cannot be split any further.
 */
async function rankSplitting(jobs, profile, ctx, label) {
  const { ranks, truncated } = await rankBatch(jobs, profile, { ...ctx, label });
  if (ranks) return ranks;
  if (!truncated || jobs.length < 2) return null;

  const mid = Math.ceil(jobs.length / 2);
  const halves = [jobs.slice(0, mid), jobs.slice(mid)];
  ctx.log?.warn(`${label}cut off - retrying as ${halves[0].length} + ${halves[1].length}`);

  const out = new Map();
  for (let i = 0; i < halves.length; i++) {
    const part = await rankSplitting(halves[i], profile, ctx, `${label}half ${i + 1}/2: `);
    if (part) for (const [id, r] of part) out.set(id, r);
  }
  return out.size ? out : null;
}

/**
 * One request for one batch. Never throws.
 *
 * @returns {Promise<{ranks: Map|null, truncated: boolean}>} ranks is null on
 *   any failure; truncated says the model hit max_tokens, which is the only
 *   failure a smaller batch can fix.
 */
async function rankBatch(jobs, profile, { log, fetchImpl, apiKey, label }) {
  const baseUrl = (process.env.ATS_WATCH_LLM_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const model = process.env.ATS_WATCH_LLM_MODEL || DEFAULT_MODEL;
  const url = `${baseUrl}/v1/chat/completions`;

  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        // Never log this header. The key is read from the environment and is
        // not written to state, stdout or stderr anywhere in this module.
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(profile, jobs) },
        ],
        // Ask for JSON at the transport level too. Providers that ignore this
        // field are fine: parseRankingResponse copes with fences and prose.
        response_format: { type: 'json_object' },
        temperature: 0,
        max_tokens: maxTokens(jobs.length),
      }),
      signal: AbortSignal.timeout(requestTimeoutMs()),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      log?.error(`${label}ranker HTTP ${res.status} from ${url}${detail ? `: ${trimForLog(detail)}` : ''}`);
      return { ranks: null, truncated: false };
    }

    const body = await res.json();
    const choice = body?.choices?.[0];
    const truncated = choice?.finish_reason === 'length';
    const text = choice?.message?.content;
    if (typeof text !== 'string' || !text.trim()) {
      log?.error(truncated
        ? `${label}ranker spent its entire ${maxTokens(jobs.length)}-token budget on reasoning before emitting any content - raise ATS_WATCH_LLM_MAX_TOKENS or lower ATS_WATCH_LLM_BATCH_SIZE`
        : `${label}ranker returned no message content`);
      return { ranks: null, truncated };
    }

    const ranks = parseRankingResponse(text, jobs);
    if (!ranks) {
      log?.error(truncated
        ? `${label}ranker response was cut off at the ${maxTokens(jobs.length)}-token budget: ${trimForLog(text)}`
        : `${label}ranker response was not the JSON we asked for: ${trimForLog(text)}`);
      return { ranks: null, truncated };
    }

    // A short map is invisible to parseRankingResponse - say so out loud.
    if (ranks.size < jobs.length) {
      log?.warn(`${label}ranker returned ${ranks.size} of ${jobs.length} postings`);
    }
    log?.info(`${label}ranked ${ranks.size} job(s) via ${model}`);
    return { ranks, truncated: false };
  } catch (err) {
    const why = err?.name === 'TimeoutError' || err?.name === 'AbortError'
      ? `timed out after ${requestTimeoutMs()}ms - raise ATS_WATCH_LLM_TIMEOUT_MS or lower ATS_WATCH_LLM_BATCH_SIZE`
      : err?.message || String(err);
    log?.error(`${label}ranker request failed: ${why}`);
    return { ranks: null, truncated: false };
  }
}

/** Keep provider error bodies from flooding stderr. */
function trimForLog(s, max = 300) {
  const flat = String(s).replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}...` : flat;
}
