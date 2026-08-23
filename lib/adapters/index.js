// Adapter registry. This is the single place that decides which ATS kinds
// this tool actually speaks, so companies.json validation and the fetch loop
// both fail the same way for an unsupported ats value instead of drifting.
//
// Ashby and Workable are listed in schema.js's ATS_KINDS (they're real ATS
// providers a future company entry could name) but have NO adapter here.
// Deliberately unimplemented pending verification: this session's egress is
// blocked to every ATS host, including apply.workable.com and Ashby's API,
// so there was nothing to infer their field mappings against with any
// confidence beyond guessing. Do not add them speculatively — get a verified
// response shape first.

import * as greenhouse from './greenhouse.js';
import * as lever from './lever.js';

export const ADAPTERS = { greenhouse, lever };

/** Look up an adapter by ats name, or throw a clear, actionable error. */
export function adapterFor(atsName) {
  const adapter = ADAPTERS[atsName];
  if (!adapter) {
    const supported = Object.keys(ADAPTERS).join(', ');
    throw new Error(`unsupported ats "${atsName}" (supported: ${supported})`);
  }
  return adapter;
}
