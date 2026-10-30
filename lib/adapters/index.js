// Adapter registry. This is the single place that decides which ATS kinds
// this tool actually speaks, so sources.json validation and the fetch loop
// both fail the same way for an unsupported ats value instead of drifting.
//
// Two kinds of source live here: company feeds (greenhouse, lever, ashby,
// workable - one employer per sources.json entry) and boards (jobicy,
// remotive, workingnomads, and weworkremotely, the only RSS one - many
// employers per entry, company taken from each posting; their keys must match
// BOARDS in schema.js). Ashby and Workable were added 2026-08-24 and the four
// boards 2026-10-30, each once its
// endpoint and response shape could be confirmed live; each adapter's header
// records what was observed and where. The rule that produced them stands: get a verified
// response shape first, do not add an adapter speculatively.

import * as greenhouse from './greenhouse.js';
import * as lever from './lever.js';
import * as ashby from './ashby.js';
import * as workable from './workable.js';
import * as jobicy from './jobicy.js';
import * as remotive from './remotive.js';
import * as workingnomads from './workingnomads.js';
import * as weworkremotely from './weworkremotely.js';

export const ADAPTERS = { greenhouse, lever, ashby, workable, jobicy, remotive, workingnomads, weworkremotely };

/** Look up an adapter by ats name, or throw a clear, actionable error. */
export function adapterFor(atsName) {
  const adapter = ADAPTERS[atsName];
  if (!adapter) {
    const supported = Object.keys(ADAPTERS).join(', ');
    throw new Error(`unsupported ats "${atsName}" (supported: ${supported})`);
  }
  return adapter;
}
