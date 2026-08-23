// CLI argument parsing. Pure: no process.exit, no stdout/stderr writes, no
// filesystem checks. This module only decides what the flags MEAN; the
// caller (bin entry point) decides how to report a thrown Error and what
// exit code to use.
//
// Defaults for --companies are resolved from this module's own location via
// import.meta.url rather than process.cwd(), so `node /abs/path/to/bin.js`
// behaves identically regardless of the caller's working directory.

import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_COMPANIES_PATH = path.join(REPO_ROOT, 'companies.json');

const RELATIVE_SINCE_RE = /^(\d+)([dwm])$/i;

export const HELP_TEXT = `Usage: ats-watch [options]

Options:
  --dry-run           Fetch and rank but touch no state.
  --since <date>      Only consider jobs seen since this date. Accepts an
                       ISO date (YYYY-MM-DD or full ISO-8601), or a
                       relative form like 7d / 2w / 1m (days/weeks/months
                       ago).
  --companies <path>  Path to companies.json (default: repo root).
  --state <path>      Path to the state file (default: store.defaultStatePath()).
  --limit <n>         Cap the number of jobs printed. Positive integer.
  --quiet             Suppress info-level stderr chatter.
  --no-rank           Skip ranking and print the unranked list.
  --help, -h          Show this help and exit.
`;

/**
 * Parse argv into the options this CLI understands.
 *
 * @param {string[]} [argv] - defaults to process.argv.slice(2)
 * @returns {{
 *   dryRun: boolean, since: string|null, companiesPath: string,
 *   statePath: string|null, limit: number|null, quiet: boolean,
 *   noRank: boolean, help: boolean,
 * }}
 * @throws {Error} on an unknown option, a missing value, or an invalid
 *   --since / --limit.
 */
export function parseCliArgs(argv = process.argv.slice(2)) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        'dry-run': { type: 'boolean', default: false },
        since: { type: 'string' },
        companies: { type: 'string' },
        state: { type: 'string' },
        limit: { type: 'string' },
        quiet: { type: 'boolean', default: false },
        'no-rank': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (err) {
    // node:util throws its own TypeError for unknown options / missing
    // values / stray positionals; re-throw as a plain Error with the same
    // message so the caller's error handling doesn't need to know about
    // parseArgs internals.
    throw new Error(err.message);
  }

  return {
    dryRun: values['dry-run'],
    since: parseSince(values.since),
    companiesPath: values.companies ? path.resolve(values.companies) : DEFAULT_COMPANIES_PATH,
    statePath: values.state ? path.resolve(values.state) : null,
    limit: parseLimit(values.limit),
    quiet: values.quiet,
    noRank: values['no-rank'],
    help: values.help,
  };
}

/** Normalise --since into an ISO-8601 UTC string, or null when absent. */
function parseSince(raw) {
  if (raw === undefined) return null;

  const rel = RELATIVE_SINCE_RE.exec(raw.trim());
  if (rel) {
    const amount = Number(rel[1]);
    const unit = rel[2].toLowerCase();
    const d = new Date();
    if (unit === 'd') {
      d.setUTCDate(d.getUTCDate() - amount);
    } else if (unit === 'w') {
      d.setUTCDate(d.getUTCDate() - amount * 7);
    } else {
      d.setUTCMonth(d.getUTCMonth() - amount);
    }
    return d.toISOString();
  }

  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) return d.toISOString();

  throw new Error(
    `Invalid --since "${raw}": expected an ISO date (YYYY-MM-DD or full `
    + 'ISO-8601) or a relative form like 7d / 2w / 1m.',
  );
}

/** Parse --limit into a positive integer, or null when absent. */
function parseLimit(raw) {
  if (raw === undefined) return null;
  if (!/^\d+$/.test(raw.trim())) {
    throw new Error(`Invalid --limit "${raw}": expected a positive integer.`);
  }
  const n = Number(raw);
  if (n <= 0) {
    throw new Error(`Invalid --limit "${raw}": expected a positive integer.`);
  }
  return n;
}
