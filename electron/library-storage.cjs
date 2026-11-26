const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

async function replace(file, body, canCommit = () => true) {
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    const writer = await fs.open(temporary, 'wx');
    try {
      await writer.writeFile(body);
      await writer.sync();
    } finally {
      await writer.close();
    }
    if (!canCommit()) return false;
    await fs.rename(temporary, file);
    return true;
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

const empty = () => ({
  version: 2,
  folders: [],
  tracks: {},
  favorites: [],
  playlists: [],
  overrides: {},
  fieldOrigins: {},
  derived: {},
});
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

async function assertDirectory(dir) {
  const info = await fs.lstat(dir);
  const normalize = (value) => (process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value));
  if (!info.isDirectory() || info.isSymbolicLink() || normalize(await fs.realpath(dir)) !== normalize(dir)) {
    throw new Error('unsafe Cadenza library directory: ' + dir);
  }
}

async function openLibrary(file) {
  let source;
  try {
    if (!(await fs.lstat(file)).isFile()) throw new Error('unsafe Cadenza library index');
    source = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return empty();
    throw error;
  }
  const prior = JSON.parse(source);
  const data = { ...empty(), ...prior };
  if (
    !record(prior) ||
    ![1, 2].includes(prior.version) ||
    !record(data.tracks) ||
    !Object.entries(data.tracks).every(([id, track]) => record(track) && track.id === id) ||
    !Array.isArray(data.playlists) ||
    !Array.isArray(data.folders) ||
    !Array.isArray(data.favorites) ||
    !record(data.overrides) ||
    !record(data.fieldOrigins) ||
    !record(data.derived)
  ) {
    throw new Error('invalid or unsupported Cadenza library index');
  }
  const obsoleteFields = ['sourceLinks', 'mediaVariants', 'recordingMatches'];
  let migrated = obsoleteFields.some((key) => Object.hasOwn(data, key));
  for (const key of obsoleteFields) delete data[key];
  for (const override of Object.values(data.overrides)) {
    if (!record(override) || !Object.hasOwn(override, 'preferLrc')) continue;
    if (override.preferLrc === true && !override.lyricsSource) override.lyricsSource = 'sidecar:lrc';
    delete override.preferLrc;
    migrated = true;
  }
  if (data.version === 1) {
    // Keep the original index and legacy rhythm blobs for recovery. A sampled key cannot attest to a blob's input.
    const backup = path.join(path.dirname(file), 'db.v1.json');
    try {
      await fs.access(backup);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await replace(backup, source);
    }
    for (const t of Object.values(data.tracks)) {
      for (const key of ['ak', 'analyzed', 'ok', 'failed', 'failWhy', 'loudness', 'loudFailed']) delete t[key];
    }
    data.version = 2;
  }
  if (prior.version === 1 || migrated) await replace(file, JSON.stringify(data));
  return data;
}

module.exports = { openLibrary, replace, assertDirectory };
