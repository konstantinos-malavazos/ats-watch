#!/usr/bin/env node
// Verify the adapter field mappings against LIVE feeds.
//
// The adapters were written without ever seeing a real response (the authoring
// environment blocked every ATS host), so their field names started life as
// hypotheses. This script is how you turn them into facts: it fetches real
// boards, parses them with the real adapters, and reports how much of the
// schema each source actually populates.
//
// A field that is empty on EVERY row is the signature of a wrong field name —
// that is the failure this script exists to catch, and it exits non-zero for it.
//
// Polite by default: one board per ATS, sequentially, through the same client
// the tool itself uses. Pass --all to check every company (sixteen requests at
// other people's job boards — don't do that on a schedule).
//
//   node tools/verify-feeds.mjs
//   node tools/verify-feeds.mjs --all

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { adapterFor } from '../lib/adapters/index.js';
import { politeSequential, getJson } from '../lib/http.js';
import { makeLogger } from '../lib/log.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CHECKED = ['url', 'location', 'posted_at', 'raw_description'];

const log = makeLogger();
const all = process.argv.includes('--all');

const raw = JSON.parse(await readFile(path.join(ROOT, 'companies.json'), 'utf8'));
const list = (Array.isArray(raw) ? raw : raw.companies) ?? [];

// One per ATS unless --all, so a casual run costs two requests, not sixteen.
const targets = all ? list : [...new Map(list.map((c) => [c.ats, c])).values()];
if (!targets.length) {
  log.error('no companies configured');
  process.exit(1);
}

log.info(`checking ${targets.length} source(s)${all ? '' : ' (one per ATS; --all for every company)'}`);

const report = [];
const { failures } = await politeSequential(
  targets,
  async (company) => {
    const adapter = adapterFor(company.ats);
    const payload = await getJson(adapter.buildUrl(company.token), { log, timeoutMs: 30000 });
    const jobs = adapter.parse(payload, company);
    report.push({ company, jobs, payload });
    return jobs;
  },
  { delayMs: 1000, log },
);

let problems = 0;

for (const { company, jobs, payload } of report) {
  console.log(`\n${company.name} (${company.ats}:${company.token}) - ${jobs.length} jobs`);
  if (!jobs.length) {
    console.log('  EMPTY: the board returned no jobs. Wrong token, or the board is genuinely empty.');
    problems++;
    continue;
  }

  const emptyFields = [];
  for (const field of CHECKED) {
    const filled = jobs.filter((j) => j[field] !== null && j[field] !== '').length;
    if (filled === 0) emptyFields.push(field);
    const pct = Math.round((filled / jobs.length) * 100);
    const verdict = filled === 0 ? '  <-- ALWAYS EMPTY, the mapping for this field is probably wrong' : '';
    console.log(`  ${field.padEnd(16)} ${String(pct).padStart(3)}% populated (${filled}/${jobs.length})${verdict}`);
    if (filled === 0) problems++;
  }
  console.log(`  ${'remote'.padEnd(16)} ${jobs.filter((j) => j.remote).length} flagged remote`);

  if (emptyFields.length) {
    // The two payload shapes we support: Greenhouse wraps in {jobs:[...]},
    // Lever returns a bare array. This is a diagnostic, so handle both here
    // rather than widening the adapter contract for it.
    const first = Array.isArray(payload) ? payload[0] : payload?.jobs?.[0];
    if (first && typeof first === 'object') {
      console.log(`  the provider's own top-level keys, for fixing ${emptyFields.join(', ')}:`);
      for (const [k, v] of Object.entries(first)) {
        const t = v === null ? 'null' : Array.isArray(v) ? `array[${v.length}]` : typeof v;
        const peek = typeof v === 'string' ? ` ${JSON.stringify(v.slice(0, 60))}` : '';
        console.log(`    ${k.padEnd(22)} ${t}${peek}`);
      }
    }
  }

  const s = jobs[0];
  console.log('  sample:');
  console.log(`    title       ${s.title}`);
  console.log(`    location    ${JSON.stringify(s.location)}`);
  console.log(`    url         ${s.url}`);
  console.log(`    posted_at   ${s.posted_at}`);
  console.log(`    description ${JSON.stringify(s.raw_description.slice(0, 100))}...`);
}

console.log('');
if (failures.length) {
  console.log(`${failures.length} source(s) failed to fetch - see stderr above`);
  problems += failures.length;
}
if (problems) {
  console.log(`${problems} problem(s) found.`);
  process.exit(1);
}
console.log('All checked sources populate every schema field.');
