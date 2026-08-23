// Plain-JSON state persistence. We deliberately do NOT use node:sqlite (it is
// Stability 1.x on both Node 22 and 24), so this is a JSON file written
// atomically to avoid ever handing a reader a half-written file.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emptyState, STATE_VERSION } from './seen.js';

/** '<repo root>/.ats-watch-state.json', resolved from this module's own
 * location rather than process.cwd() so the state file lands in the same
 * place no matter where the CLI is invoked from. */
export function defaultStatePath() {
  const here = fileURLToPath(import.meta.url); // .../lib/store.js
  const repoRoot = path.dirname(path.dirname(here));
  return path.join(repoRoot, '.ats-watch-state.json');
}

/**
 * Load state from `path`. A missing file is a normal first run, not an
 * error. A version mismatch means a schema bump happened and we start over
 * rather than trying to migrate ad hoc — so that returns an empty state too,
 * without throwing. Anything else wrong with the file (invalid JSON, or a
 * parsed value that isn't a plain object) is genuinely corrupt and throws,
 * so the caller can decide whether to abort or recover.
 */
export async function loadState(statePath) {
  let raw;
  try {
    raw = await fs.readFile(statePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return emptyState();
    throw err;
  }

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
