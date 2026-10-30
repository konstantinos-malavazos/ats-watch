// Loading the sources file (sources.json): the company careers feeds and the
// job-board sources a run fetches.
//
// sources.json was called companies.json before the project was renamed to
// job-watch. When the default file is absent, the old one is read instead
// (`fallbackPath`), so a clone that has not been renamed keeps working. An
// explicit --sources path never falls back.

import { readFile } from 'node:fs/promises';
import { adapterFor } from './adapters/index.js';

/**
 * @param {string} sourcesPath
 * @param {{ info: Function, warn: Function }} log
 * @param {{ fallbackPath?: string|null }} [opts]
 * @returns {Promise<object[]>} the valid entries; [] when there is no file
 */
export async function loadSources(sourcesPath, log, { fallbackPath = null } = {}) {
  let file = sourcesPath;
  let text = await readIfExists(file);
  if (text === null && fallbackPath) {
    text = await readIfExists(fallbackPath);
    if (text !== null) {
      log.info(`no sources file at ${sourcesPath} - read the pre-rename ${fallbackPath}`);
      file = fallbackPath;
    }
  }
  if (text === null) {
    log.warn(`no sources file at ${sourcesPath}`);
    return [];
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`sources file at ${file} is not valid JSON: ${err.message}`);
  }

  const list = Array.isArray(parsed) ? parsed : parsed && parsed.companies;
  if (!Array.isArray(list)) {
    throw new Error(`sources file at ${file} must be an array, or an object with a "companies" array`);
  }

  return list.filter((c) => {
    if (!c || !c.ats || !c.token) {
      log.warn(`skipping sources entry without ats/token: ${JSON.stringify(c)}`);
      return false;
    }
    try {
      adapterFor(c.ats);
    } catch (err) {
      log.warn(`skipping ${c.name || c.token}: ${err.message}`);
      return false;
    }
    return true;
  });
}

/** The file's text, or null when it does not exist. */
async function readIfExists(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}
