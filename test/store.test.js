import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadState, saveState } from '../lib/store.js';
import { emptyState, STATE_VERSION } from '../lib/seen.js';

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ats-watch-store-test-'));
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

describe('atomic write', () => {
  test('no .tmp-* file is left behind after a successful save', async () => {
    const statePath = tmpStatePath('atomic.json');
    await saveState(statePath, emptyState());
    const dirEntries = await fs.readdir(tmpDir);
    const tmpLeftovers = dirEntries.filter((f) => f.includes('.tmp-'));
    assert.deepEqual(tmpLeftovers, []);
  });
});
