// We Work Remotely RSS adapter. The only RSS source; every other adapter
// reads JSON.
//
// Endpoint: GET https://weworkremotely.com/categories/<token>.rss
//   The sources.json token is the category slug, one entry per category:
//   remote-back-end-programming-jobs, remote-full-stack-programming-jobs,
//   remote-devops-sysadmin-jobs.
//
// STATUS: VERIFIED 2026-10-30 against all three category feeds (9 + 79 + 33 =
// 121 items, no overlap), served 200 application/rss+xml with no challenge.
// Every element mapped below was read off those responses.
//
// Terms (read 2026-10-30, https://weworkremotely.com/remote-job-rss-feed):
// "Anyone can use the feed, all we ask is that you attribute the links back to
// We Work Remotely." The digest links each role to its WWR url and names the
// board ("via We Work Remotely"), which is that attribution. robots.txt is
// `Allow: /`; the terms and conditions say nothing on automated access or
// rate limits. One request per category per run.
//
// Observed item shape (RSS 2.0, every item carries all of these):
//   title        "Company: Title", entity-escaped (`&amp;`). Split on the FIRST
//                ':' and trim both sides: seen live as "Fivetran : Global
//                Alliance Lead, Capgemini" (space before the colon) and "Yooli:
//                FULL TIME: Software Engineer Position ..." (a second colon that
//                belongs to the title). No colon -> company '' -> boardCompany
//                gives "(company not listed)" and the whole string is the title.
//   region       -> location, verbatim. UNRELIABLE: "Anywhere in the World" on
//                114 of 121 items, including some whose description says
//                US-only. Residency is the ranker's call, from the description.
//   country, state, skills, category, type, expires_at   unused (country holds
//                emoji flags and sometimes 70+ names; state is HQ-ish)
//   description  HTML escaped as entities (`&lt;p&gt;`, and `&amp;nbsp;`
//                double-escaped). NO CDATA anywhere -> raw_description via
//                htmlToText, whose repeated passes decode then strip.
//   pubDate      RFC 822 in UTC ("Thu, 29 Oct 2026 22:31:03 +0000") -> posted_at.
//                Three live items are dated 2024 with a future expires_at
//                (renewed); they are kept as-is.
//   guid, link   identical, https://weworkremotely.com/remote-jobs/<slug>.
//                There is no numeric id: ats_job_id is <slug>. An item with no
//                title or no such link is skipped.
//   media:content  optional logo, ignored.
// No salary field (81 of 121 descriptions mention pay in free text), so
// `salary` is ''. Everything on the board is remote.

import { normalise, toIso, htmlToText, boardCompany } from '../schema.js';
import { getText } from '../http.js';

export const ats = 'weworkremotely';

/** Tells tools/verify-feeds.mjs to fetch with getText, not getJson. */
export const format = 'rss';

const ITEM_RE = /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/g;
const SLUG_RE = /\/remote-jobs\/([^/?#\s]+)/;

export function buildUrl(token) {
  return `https://weworkremotely.com/categories/${token}.rss`;
}

/** Inner text of the first <tag> in an item, entities decoded, tags stripped. */
function field(item, tag) {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(item);
  return m ? htmlToText(m[1]) : '';
}

/** "Company: Title" -> { company, title }, split on the first ':' only. */
function splitTitle(raw) {
  const i = raw.indexOf(':');
  if (i < 0) return { company: '', title: raw };
  return { company: raw.slice(0, i).trim(), title: raw.slice(i + 1).trim() };
}

/**
 * Pure: (xml, source) -> schema rows. No network.
 *
 * The source entry is deliberately unused: on a board, company and
 * company_token come from each posting, never from sources.json.
 *
 * @param {any} xml  the RSS body as text
 * @param {{ name: string, ats: string, token: string }} _source
 */
export function parse(xml, _source) {
  if (typeof xml !== 'string') return [];
  const out = [];

  for (const [, item] of xml.matchAll(ITEM_RE)) {
    const link = field(item, 'link');
    const id = SLUG_RE.exec(link)?.[1] ?? '';
    const { company, title } = splitTitle(field(item, 'title'));

    const row = normalise({
      ats,
      ...boardCompany(company, id),
      ats_job_id: id,
      title,
      location: field(item, 'region'),
      remote: true,
      url: link,
      posted_at: toIso(field(item, 'pubDate')),
      salary: '',
      raw_description: field(item, 'description'),
    });
    if (row) out.push(row);
  }

  return out;
}

/** Fetch + parse in one call. Network lives here, not in parse(). */
export async function fetchJobs(source, { log, timeoutMs } = {}) {
  const xml = await getText(buildUrl(source.token), { timeoutMs, log });
  return parse(xml, source);
}
