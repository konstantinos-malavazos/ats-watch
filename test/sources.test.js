import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadSources } from '../lib/sources.js';

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'job-watch-sources-test-'));
after(async () => { await fs.rm(tmpDir, { recursive: true, force: true }); });

function makeLog() {
  const infos = [], warns = [];
  return { infos, warns, info: (m) => infos.push(m), warn: (m) => warns.push(m), error() {} };
}

async function dirWith(name, files) {
  const dir = path.join(tmpDir, name);
  await fs.mkdir(dir, { recursive: true });
  for (const [file, body] of Object.entries(files)) {
    await fs.writeFile(path.join(dir, file), JSON.stringify(body), 'utf8');
  }
  return { sources: path.join(dir, 'sources.json'), companies: path.join(dir, 'companies.json') };
}

const acme = { name: 'Acme', ats: 'greenhouse', token: 'acme' };
const beta = { name: 'Beta', ats: 'lever', token: 'beta' };

describe('loadSources()', () => {
  test('reads the { companies: [...] } shape', async () => {
    const p = await dirWith('shape-object', { 'sources.json': { companies: [acme] } });
    assert.deepEqual(await loadSources(p.sources, makeLog()), [acme]);
  });

  test('reads a bare array', async () => {
    const p = await dirWith('shape-array', { 'sources.json': [acme] });
    assert.deepEqual(await loadSources(p.sources, makeLog()), [acme]);
  });

  test('drops entries without ats/token and entries for an unknown ATS, with a warning each', async () => {
    const p = await dirWith('invalid', { 'sources.json': [acme, { name: 'x' }, { ats: 'nope', token: 't' }] });
    const log = makeLog();
    assert.deepEqual(await loadSources(p.sources, log), [acme]);
    assert.equal(log.warns.length, 2);
  });

  test('invalid JSON throws', async () => {
    const dir = path.join(tmpDir, 'bad-json');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'sources.json'), '{ nope', 'utf8');
    await assert.rejects(() => loadSources(path.join(dir, 'sources.json'), makeLog()), /not valid JSON/);
  });
});

// companies.json was renamed to sources.json. A clone that still has only the
// old file keeps working until it is renamed.
describe('loadSources() rename fallback', () => {
  test('sources.json absent -> companies.json is read, and that is logged', async () => {
    const p = await dirWith('legacy-only', { 'companies.json': { companies: [beta] } });
    const log = makeLog();
    assert.deepEqual(await loadSources(p.sources, log, { fallbackPath: p.companies }), [beta]);
    assert.ok(log.infos.some((m) => m.includes(p.companies)), 'the log names the old file');
    assert.deepEqual(log.warns, []);
  });

  test('both present -> sources.json wins', async () => {
    const p = await dirWith('both', { 'sources.json': [acme], 'companies.json': [beta] });
    assert.deepEqual(await loadSources(p.sources, makeLog(), { fallbackPath: p.companies }), [acme]);
  });

  test('no fallbackPath (an explicit --sources) -> a missing file is empty, companies.json beside it is ignored', async () => {
    const p = await dirWith('explicit', { 'companies.json': [beta] });
    const log = makeLog();
    assert.deepEqual(await loadSources(p.sources, log), []);
    assert.equal(log.warns.length, 1);
  });

  test('neither present -> empty, with a warning', async () => {
    const p = await dirWith('neither', {});
    const log = makeLog();
    assert.deepEqual(await loadSources(p.sources, log, { fallbackPath: p.companies }), []);
    assert.equal(log.warns.length, 1);
  });
});
