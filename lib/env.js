// Environment variables, read under the project's current name first.
//
// The project was renamed from ats-watch to job-watch. Every setting is now
// JOB_WATCH_<SUFFIX>; the old ATS_WATCH_<SUFFIX> is still read when the new
// one is unset (or empty, the same || semantics every call site already had),
// so an existing env file or crontab keeps working unchanged. The new name
// wins when both are set.

/**
 * @param {string} suffix - e.g. 'LLM_API_KEY'
 * @returns {string|undefined}
 */
export function envVar(suffix) {
  return process.env[`JOB_WATCH_${suffix}`] || process.env[`ATS_WATCH_${suffix}`];
}
