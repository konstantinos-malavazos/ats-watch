// Plain-JSON state persistence. We deliberately do NOT use node:sqlite (it is
// Stability 1.x on both Node 22 and 24), so this is a JSON file written
// atomically to avoid ever handing a reader a half-written file.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emptyState, STATE_VERSION } from './seen.js';

/** '<repo root>/.job-watch-state.json', resolved from this module's own
 * location rather than process.cwd() so the state file lands in the same
 * place no matter where the CLI is invoked from. */
export function defaultStatePath() {
  return path.join(repoRoot(), '.job-watch-state.json');
}

/** '<repo root>/.ats-watch-state.json': the state file from before the
 * project was renamed to job-watch. Read when the default file does not exist
 * yet, so the first run under the new name reports nothing already known. It
 * is never written, moved or deleted here - the owner removes it by hand. */
export function legacyStatePath() {
  return path.join(repoRoot(), '.ats-watch-state.json');
}

/**
 * Where to load and save state. With no --state the default file is used and
 * the legacy one is its fallback; an explicit --state means exactly that file,
 * so it never falls back to anything.
 *
 * @param {string|null} explicitPath
 * @returns {{ statePath: string, fallbackPath: string|null }}
 */
export function statePathsFor(explicitPath) {
  return explicitPath
    ? { statePath: explicitPath, fallbackPath: null }
    : { statePath: defaultStatePath(), fallbackPath: legacyStatePath() };
}

function repoRoot() {
  const here = fileURLToPath(import.meta.url); // .../lib/store.js
  return path.dirname(path.dirname(here));
}

/**
 * Load state from `path`. A missing file is a normal first run, not an
 * error. A version mismatch means a schema bump happened and we start over
 * rather than trying to migrate ad hoc — so that returns an empty state too,
 * without throwing. Anything else wrong with the file (invalid JSON, or a
 * parsed value that isn't a plain object) is genuinely corrupt and throws,
 * so the caller can decide whether to abort or recover.
 *
 * `fallbackPath` (see statePathsFor) is read, read-only, when `statePath`
 * does not exist: the pre-rename .ats-watch-state.json. It goes through the
 * same parsing and version check.
 *
 * @param {string} statePath
 * @param {{ fallbackPath?: string|null, log?: { info: Function } }} [opts]
 */
export async function loadState(statePath, { fallbackPath = null, log } = {}) {
  let raw = await readIfExists(statePath);
  if (raw === null && fallbackPath) {
    raw = await readIfExists(fallbackPath);
    if (raw !== null) {
      log?.info(`no state at ${statePath} yet - read the pre-rename ${fallbackPath}; state will be written to the new path`);
      statePath = fallbackPath; // so a corrupt-file error names the file actually read
    }
  }
  if (raw === null) return emptyState();

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Corrupt state file at ${statePath}: invalid JSON (${err.message})`);
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Corrupt state file at ${statePath}: expected a JSON object at the top level`);
  }

  if (parsed.version !== STATE_VERSION) {
    // Schema bump: old records may not match what the rest of the pipeline
    // expects, so we start clean instead of guessing at a migration.
    return emptyState();
  }

  const jobs = parsed.jobs;
  return {
    version: STATE_VERSION,
    jobs: (jobs && typeof jobs === 'object' && !Array.isArray(jobs)) ? jobs : {},
  };
}

/** The file's text, or null when it does not exist. */
async function readIfExists(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Save state to `path` atomically: write to a pid-scoped temp file, then
 * rename over the target. rename() on the same filesystem is atomic, so a
 * reader (or a concurrent run) never observes a partially-written file.
 */
export async function saveState(statePath, state) {
  await fs.mkdir(path.dirname(statePath), { recursive: true });

  const tmpPath = `${statePath}.tmp-${process.pid}`;
  const data = `${JSON.stringify(state, null, 2)}\n`;

  try {
    await fs.writeFile(tmpPath, data, 'utf8');
    await fs.rename(tmpPath, statePath);
  } catch (err) {
    try {
      await fs.unlink(tmpPath);
    } catch {
      // Best effort cleanup; the original error is what matters.
    }
    throw err;
  }
}
