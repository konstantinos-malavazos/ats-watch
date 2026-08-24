// Adapter registry. This is the single place that decides which ATS kinds
// this tool actually speaks, so companies.json validation and the fetch loop
// both fail the same way for an unsupported ats value instead of drifting.
//
// All four ATS kinds in schema.js's ATS_KINDS now have an adapter. Ashby and
// Workable were added 2026-08-24 once their endpoints and response shapes
// could be confirmed against live boards; each adapter's header records what
// was observed and where. The rule that produced them stands: get a verified
// response shape first, do not add an adapter speculatively.

import * as greenhouse from './greenhouse.js';
import * as lever from './lever.js';
import * as ashby from './ashby.js';
import * as workable from './workable.js';

export const ADAPTERS = { greenhouse, lever, ashby, workable };

/** Look up an adapter by ats name, or throw a clear, actionable error. */
export function adapterFor(atsName) {
  const adapter = ADAPTERS[atsName];
  if (!adapter) {
    const supported = Object.keys(ADAPTERS).join(', ');
    throw new Error(`unsupported ats "${atsName}" (supported: ${supported})`);
  }
  return adapter;
}
