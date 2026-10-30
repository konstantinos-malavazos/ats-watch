import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  loadState, saveState, defaultStatePath, legacyStatePath, statePathsFor,
} from '../lib/store.js';
import { emptyState, selectNew, STATE_VERSION } from '../lib/seen.js';
import * as greenhouse from '../lib/adapters/greenhouse.js';

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'job-watch-store-test-'));
const cleanupPaths = [];

function tmpStatePath(name) {
  const p = path.join(tmpDir, name);
  cleanupPaths.push(p);
  return p;
}

after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('round-trip save/load', () => {
  test('saved state loads back identical', async () => {
    const statePath = tmpStatePath('roundtrip.json');
    const state = {
      version: STATE_VERSION,
      jobs: { 'greenhouse:acme:1': { first_seen: 'a', last_seen: 'b', ats: 'greenhouse', company_token: 'acme', ats_job_id: '1', title: 't', url: 'u' } },
    };
    await saveState(statePath, state);
    const loaded = await loadState(statePath);
    assert.deepEqual(loaded, state);
  });
});

describe('missing file', () => {
  test('loadState on a nonexistent path returns emptyState()', async () => {
    const statePath = tmpStatePath('does-not-exist.json');
    const loaded = await loadState(statePath);
    assert.deepEqual(loaded, emptyState());
  });
});

describe('version mismatch', () => {
  test('loadState returns emptyState() when the version field does not match', async () => {
    const statePath = tmpStatePath('old-version.json');
    await fs.writeFile(statePath, JSON.stringify({ version: STATE_VERSION + 1, jobs: { x: 1 } }), 'utf8');
    const loaded = await loadState(statePath);
    assert.deepEqual(loaded, emptyState());
  });
});

describe('corrupt JSON', () => {
  test('loadState throws on invalid JSON', async () => {
    const statePath = tmpStatePath('corrupt.json');
    await fs.writeFile(statePath, '{ not valid json', 'utf8');
    await assert.rejects(() => loadState(statePath));
  });

  test('loadState throws when the top-level value is not a plain object', async () => {
    const statePath = tmpStatePath('array-top-level.json');
    await fs.writeFile(statePath, JSON.stringify([1, 2, 3]), 'utf8');
    await assert.rejects(() => loadState(statePath));
  });
});

// The project was renamed from ats-watch to job-watch. The state file is the
// only copy of what has already been reported, so the old file must be read
// when the new one does not exist yet - or every known job is reported again.
describe('rename: state file paths', () => {
  test('the default state file is .job-watch-state.json at the repo root', () => {
    assert.equal(path.basename(defaultStatePath()), '.job-watch-state.json');
  });

  test('the legacy state file is .ats-watch-state.json beside it', () => {
    assert.equal(path.basename(legacyStatePath()), '.ats-watch-state.json');
    assert.equal(path.dirname(legacyStatePath()), path.dirname(defaultStatePath()));
  });

  test('no --state: the default path, falling back to the legacy one', () => {
    assert.deepEqual(statePathsFor(null), {
      statePath: defaultStatePath(), fallbackPath: legacyStatePath(),
    });
  });

  test('an explicit --state never falls back', () => {
    assert.deepEqual(statePathsFor('/somewhere/state.json'), {
      statePath: '/somewhere/state.json', fallbackPath: null,
    });
  });
});

describe('rename: loadState fallback', () => {
  const sub = async (name) => {
    const dir = path.join(tmpDir, name);
    await fs.mkdir(dir, { recursive: true });
    return { dir, next: path.join(dir, '.job-watch-state.json'), old: path.join(dir, '.ats-watch-state.json') };
  };
  const stateWith = (key) => ({
    version: STATE_VERSION,
    jobs: { [key]: { first_seen: 'a', last_seen: 'b', ats: 'greenhouse', company_token: 'acme', ats_job_id: key, title: 't', url: 'u' } },
  });
  const makeLog = () => {
    const infos = [];
    return { infos, info: (m) => infos.push(m), warn() {}, error() {} };
  };

  test('only the legacy file exists -> it is read, and that is logged once', async () => {
    const { next, old } = await sub('legacy-only');
    await fs.writeFile(old, JSON.stringify(stateWith('old-1')), 'utf8');
    const log = makeLog();
    const loaded = await loadState(next, { fallbackPath: old, log });
    assert.deepEqual(Object.keys(loaded.jobs), ['old-1']);
    assert.equal(log.infos.length, 1);
    assert.ok(log.infos[0].includes(old), 'the log names the legacy file');
  });

  test('both exist -> the new file wins and nothing is logged', async () => {
    const { next, old } = await sub('both');
    await fs.writeFile(old, JSON.stringify(stateWith('old-1')), 'utf8');
    await fs.writeFile(next, JSON.stringify(stateWith('new-1')), 'utf8');
    const log = makeLog();
    const loaded = await loadState(next, { fallbackPath: old, log });
    assert.deepEqual(Object.keys(loaded.jobs), ['new-1']);
    assert.deepEqual(log.infos, []);
  });

  test('no fallbackPath (an explicit --state) -> a missing file is empty, the legacy file beside it is ignored', async () => {
    const { next, old } = await sub('explicit');
    await fs.writeFile(old, JSON.stringify(stateWith('old-1')), 'utf8');
    const loaded = await loadState(next);
    assert.deepEqual(loaded, emptyState());
  });

  test('neither exists -> emptyState(), a normal first run', async () => {
    const { next, old } = await sub('neither');
    assert.deepEqual(await loadState(next, { fallbackPath: old }), emptyState());
  });

  test('a corrupt legacy file still throws, exactly as a corrupt state file does', async () => {
    const { next, old } = await sub('corrupt-legacy');
    await fs.writeFile(old, '{ nope', 'utf8');
    await assert.rejects(() => loadState(next, { fallbackPath: old }), /Corrupt state file/);
  });

  test('legacy state -> nothing re-reported, saved to the new path, legacy file untouched', async () => {
    const { next, old } = await sub('end-to-end');
    const here = path.dirname(fileURLToPath(import.meta.url));
    const payload = JSON.parse(readFileSync(path.join(here, 'fixtures', 'greenhouse.json'), 'utf8'));
    const jobs = greenhouse.parse(payload, { name: 'GH Co', ats: 'greenhouse', token: 'ghco' });
    assert.ok(jobs.length > 0, 'fixture yields jobs');

    // Yesterday's run, under the old name.
    const first = selectNew(jobs, emptyState(), '2026-10-29T12:00:00.000Z');
    assert.equal(first.counts.fresh, jobs.length);
    await saveState(old, first.nextState);
    const legacyBytes = await fs.readFile(old, 'utf8');
    const legacyMtime = (await fs.stat(old)).mtimeMs;

    // Today's run, under the new name: same jobs, nothing new.
    const state = await loadState(next, { fallbackPath: old });
    const today = selectNew(jobs, state, '2026-10-30T12:00:00.000Z');
    assert.equal(today.counts.fresh, 0);
    await saveState(next, today.nextState);

    // Tomorrow reads the new file and still finds nothing new.
    const tomorrow = selectNew(jobs, await loadState(next, { fallbackPath: old }), '2026-10-31T12:00:00.000Z');
    assert.equal(tomorrow.counts.fresh, 0);

    assert.equal(await fs.readFile(old, 'utf8'), legacyBytes, 'legacy file content unchanged');
    assert.equal((await fs.stat(old)).mtimeMs, legacyMtime, 'legacy file not rewritten');
  });
});

describe('atomic write', () => {
  test('no .tmp-* file is left behind after a successful save', async () => {
    const statePath = tmpStatePath('atomic.json');
    await saveState(statePath, emptyState());
    const dirEntries = await fs.readdir(tmpDir);
    const tmpLeftovers = dirEntries.filter((f) => f.includes('.tmp-'));
    assert.deepEqual(tmpLeftovers, []);
  });
});
