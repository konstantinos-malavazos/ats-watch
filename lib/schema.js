// The normalised job schema. Every adapter MUST return objects with exactly
// these fields and these names. Nothing else in the pipeline may invent fields.
//
//   id              string   stable digest of the dedupe tuple (see jobKey)
//   ats             string   'greenhouse' | 'lever' | 'ashby' | 'workable'
//   company         string   display name, from companies.json
//   company_token   string   board token / site slug used in the request
//   ats_job_id      string   the provider's own id for the posting, as a string
//   title           string
//   location        string   '' when the feed does not say
//   remote          boolean
//   url             string   public apply/description URL
//   posted_at       string   ISO-8601 UTC, or null when the feed does not say
//   raw_description string   tags stripped, entities decoded, whitespace collapsed
//
// Dedupe tuple is (ats, company_token, ats_job_id).
//
// Note on the tuple: the brief said (ats, company, ats_job_id). We key on
// company_token rather than the display name because the token is the value
// actually used to address the feed and is immutable, whereas `company` is a
// human label in companies.json. Renaming "Acme" to "Acme Inc." must not make
// every one of its postings look brand new. Same tuple, stable half of it.

import { createHash } from 'node:crypto';

export const ATS_KINDS = ['greenhouse', 'lever', 'ashby', 'workable'];

/** Canonical dedupe key for a job. */
export function jobKey({ ats, company_token, ats_job_id }) {
  return `${ats}:${company_token}:${ats_job_id}`;
}

/** Short stable id derived from the dedupe key. */
export function jobId(job) {
  return createHash('sha256').update(jobKey(job)).digest('hex').slice(0, 16);
}

const FIELDS = [
  'id', 'ats', 'company', 'company_token', 'ats_job_id', 'title',
  'location', 'remote', 'url', 'posted_at', 'raw_description',
];

/**
 * Coerce an adapter's output into the schema: fills defaults, computes `id`,
 * and drops anything the adapter invented. Returns null if the row lacks the
 * identity fields, since a job we cannot key is a job we cannot dedupe.
 */
export function normalise(partial) {
  const ats = str(partial.ats);
  const company_token = str(partial.company_token);
  const ats_job_id = str(partial.ats_job_id);
  const title = str(partial.title);
  if (!ats || !company_token || !ats_job_id || !title) return null;

  const job = {
    id: '',
    ats,
    company: str(partial.company) || company_token,
    company_token,
    ats_job_id,
    title,
    location: str(partial.location),
    remote: Boolean(partial.remote),
    url: str(partial.url),
    posted_at: toIso(partial.posted_at),
    raw_description: str(partial.raw_description),
  };
  job.id = jobId(job);
  return job;
}

/** True when `row` has every schema field and no extras. Used by tests. */
export function isWellFormed(row) {
  if (row === null || typeof row !== 'object') return false;
  const keys = Object.keys(row).sort();
  return keys.length === FIELDS.length
    && FIELDS.slice().sort().every((f, i) => keys[i] === f);
}

function str(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

/** Accepts epoch millis, epoch seconds, or a date string. Returns ISO or null. */
export function toIso(v) {
  if (v === null || v === undefined || v === '') return null;
  let d;
  if (typeof v === 'number') {
    // Lever uses epoch millis; anything below this threshold is plainly seconds.
    d = new Date(v < 1e11 ? v * 1000 : v);
  } else if (/^\d+$/.test(String(v).trim())) {
    const n = Number(String(v).trim());
    d = new Date(n < 1e11 ? n * 1000 : n);
  } else {
    d = new Date(String(v));
  }
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  '#39': "'", '#160': ' ', ndash: '-', mdash: '-', hellip: '...', rsquo: "'",
  lsquo: "'", ldquo: '"', rdquo: '"',
};

/** Feeds hand back HTML in description fields; the ranker wants prose. */
export function stripHtml(html) {
  if (!html) return '';
  return String(html)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      const k = e.toLowerCase();
      if (k in ENTITIES) return ENTITIES[k];
      if (k.startsWith('#x')) return cp(parseInt(k.slice(2), 16));
      if (k.startsWith('#')) return cp(parseInt(k.slice(1), 10));
      return m;
    })
    .replace(/[ \t ]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Repeatedly strip/decode until the text stops changing.
 *
 * Feeds escape their description HTML to differing and undocumented depths:
 * some hand back real tags, some `&lt;p&gt;`, some double up again as
 * `&amp;lt;p&amp;gt;`. We could not verify which depth any given ATS actually
 * uses (see the adapter headers), so rather than hardcode a pass count we
 * iterate to a fixed point. stripHtml is idempotent on clean text, so this
 * terminates on its own; maxPasses is a guard against pathological input,
 * not the mechanism.
 */
export function htmlToText(input, maxPasses = 4) {
  let cur = String(input ?? '');
  for (let i = 0; i < maxPasses; i++) {
    const next = stripHtml(cur);
    if (next === cur) break;
    cur = next;
  }
  return cur.trim();
}

function cp(n) {
  return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
}

const REMOTE_RE = /\b(remote|distributed|work from home|wfh|anywhere)\b/i;
const NOT_REMOTE_RE = /\b(no|not|non)[- ]remote\b|\bremote[- ]?(ineligible|not)\b|\bon[- ]?site only\b/i;

/** Best-effort remote detection from whatever text the feed gives us. */
export function looksRemote(...parts) {
  const text = parts.filter(Boolean).join(' ');
  if (NOT_REMOTE_RE.test(text)) return false;
  return REMOTE_RE.test(text);
}
