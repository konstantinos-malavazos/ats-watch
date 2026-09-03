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

/**
 * Keep only jobs the ranker scored at `minScore` or above.
 *
 * Applied AFTER ranking, so it is the last thing between the pipeline and the
 * renderer. Two deliberate exemptions:
 *
 *   - `ranks` of null (the ranker was unavailable, or --no-rank) filters
 *     nothing. An unranked run must still show the day's jobs.
 *   - a job the ranker returned no entry for is KEPT. A short map from the
 *     model is invisible to parseRankingResponse, and dropping the jobs it
 *     silently omitted would turn a model hiccup into a job you never see.
 *
 * `minScore` of 0 or null means no filtering at all.
 */
export function filterByScore(jobs, ranks, minScore) {
  if (!ranks || !minScore || minScore <= 0) return jobs;
  return jobs.filter((j) => {
    const r = ranks.get(j.id);
    if (!r || !Number.isFinite(r.score)) return true;
    return r.score >= minScore;
  });
}

// --- title filter --------------------------------------------------------
//
// Roughly two thirds of what the configured boards publish is not an
// engineering role at all: of the 3497 postings in one live state file, 890
// were sales, 203 customer success, 165 finance and legal, 147 marketing and
// 90 recruitment. Every one of them used to reach the ranker, cost tokens, and
// score 0-2. This drops the obvious ones before the ranker sees them.
//
// The rules are ordered, and the LAST one is the important one: a title that
// matches nothing is KEPT. The filter only removes titles it recognises as
// go-to-market or back-office; it never has to recognise engineering to let a
// job through. That is what keeps a new kind of role from vanishing silently.
//
// MEASURED against those 3497 live titles: 1583 dropped, 1914 kept, and of the
// dropped rows only three carried an engineering word - "Customer Success
// Engineer" and its two regional twins, which are support roles. Re-run that
// scan before widening either pattern; see the note in CLAUDE.md.
//
// RE-MEASURED 2026-09-03 against 4019 live titles, after a digest carried a
// Fraud Investigator, an Internal Control Apprentice, a Financial Promotions
// Manager, a Vendor Management Internship and a Senior Partner Manager. The
// financial-crime, risk-operations and partner-management families added below
// take the drop count from 1726 to 1816 - 90 more rows, zero of them carrying
// an engineering word. The single casualty of the first attempt, "Staff
// Applied Scientist, Financial Forecasting", is why ENGINEERING_RE now rescues
// "applied scientist": the rescue rule is the right place to fix a false drop,
// not a narrower exclusion.

/**
 * Dropped whatever else the title says. These are the families where an
 * engineering word in the title does not make it an engineering job: a Sales
 * Engineer, a Solutions Architect and a Forward Deployed Engineer all sit on
 * the revenue side of the house.
 */
export const GO_TO_MARKET_RE = new RegExp([
  'sales engineer', 'pre-?sales', 'customer engineer', 'solutions? engineer',
  'solutions? architect', 'consulting architect', 'forward deployed',
  'success architect', 'partner (technical )?(advisor|engineer|architect)',
  'partner (manager|director)', 'partnerships? manager', 'partner development',
  'account executive', '\\bsales\\b', 'business development', '\\bbdr\\b', '\\bsdr\\b',
  'account manager', 'account director', 'customer success', '\\brenewals\\b',
  '\\bterritory\\b', 'recruit(er|ing|ment)', 'talent acquisition', '\\bsourcer\\b',
  '\\bpayroll\\b', '\\bfp&a\\b', '\\bcounsel\\b', '\\bhris\\b',
].join('|'), 'i');

/**
 * Rescues a title from EXCLUDED_RE below. "Senior Frontend Engineer, Marketing
 * Website" is an engineering job that happens to say "marketing"; without this
 * rule the word alone would drop it.
 */
export const ENGINEERING_RE = new RegExp([
  '\\bengineer(ing)?\\b', '\\bdeveloper\\b', '\\bsre\\b', '\\bdevops\\b',
  '\\bprogrammer\\b', '\\bsoftware\\b', '\\barchitect\\b',
  '\\bdata (scientist|engineer)\\b', '\\bmachine learning\\b',
  '\\bplatform\\b', '\\binfrastructure\\b', '\\bbackend\\b', '\\bfrontend\\b',
  '\\bfull ?stack\\b', '\\bsecurity\\b', '\\bsystems?\\b', '\\bqa\\b',
  '\\bresearch scientist\\b', '\\bapplied scientist\\b', '\\btechnical writer\\b',
].join('|'), 'i');

/** Back-office families, dropped only when ENGINEERING_RE did not rescue them. */
export const EXCLUDED_RE = new RegExp([
  '\\bmarketing\\b', '\\bbrand\\b', '\\bseo\\b', 'communications', 'social media',
  'demand gen', 'content (writer|manager|strategist)', 'copywriter',
  '\\bpeople (ops|partner|analytics)\\b', '\\bhr\\b', 'human resources',
  '\\bbenefits\\b', 'compensation analyst', '\\blegal\\b', 'paralegal',
  'compliance officer', 'account(ant|ing)\\b', '\\bfinance\\b', '\\btax\\b',
  '\\baudit(or)?\\b', 'controller', 'treasury', 'procurement', 'deal desk',
  'revenue (analytics|operations|analyst)', 'executive assistant',
  'chief of staff', 'office manager', 'workplace', 'enablement', 'events?( |$)',
  'community manager', 'customer support', 'technical support',
  'onboarding specialist', 'mobility specialist', 'immigration',
  'partnerships?\\b', '\\bchannel\\b',
  '\\bfraud\\b', 'investigator', 'financial crime', '\\baml\\b', '\\bkyc\\b',
  '\\bunderwrit', '\\bdispute', '\\bcollections\\b', '\\bfinancial\\b',
  'internal control', '\\bvendor management\\b',
].join('|'), 'i');

/** 'keep' or 'drop' for one title. Exported for the tests that pin the rules. */
export function titleVerdict(title) {
  const t = String(title || '');
  if (GO_TO_MARKET_RE.test(t)) return 'drop';
  if (ENGINEERING_RE.test(t)) return 'keep';
  if (EXCLUDED_RE.test(t)) return 'drop';
  return 'keep'; // unrecognised is not the same as unwanted.
}

/**
 * Drop postings whose title is plainly not an engineering role.
 *
 * Runs before the ranker, so what it removes costs nothing to score. Every
 * dropped title is written to stderr, because a filter you cannot audit is a
 * filter you cannot trust.
 */
export function filterTitles(jobs, { log } = {}) {
  const kept = [];
  const dropped = [];
  for (const job of jobs) {
    if (titleVerdict(job.title) === 'keep') kept.push(job);
    else dropped.push(job);
  }
  if (dropped.length && log) {
    log.info(`title filter dropped ${dropped.length} of ${jobs.length}:`);
    for (const j of dropped) log.info(`  - ${j.company}: ${j.title}`);
  }
  return kept;
}
