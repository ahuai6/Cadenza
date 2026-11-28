// What the listener makes and chooses in the page, kept by the main process with the library (library/kept/): the
// saved looks and motion styles, the workshop's project, the listening choices made for songs, and the queue last
// played. Each is one file, written whole and atomically when it changes; the page holds a copy for synchronous reads
// (src/app/kept.ts). Earlier builds kept these in the page's localStorage; the page moves them here once and leaves the
// old copies where they were, so an earlier build still finds its own.
const fs = require('node:fs/promises');
const path = require('node:path');
const { replace, assertDirectory } = require('./library-storage.cjs');

/** each kept item, with the most it may weigh as JSON (bytes) and whether changing it is an edit */
const ITEMS = {
  themes: { max: 4 * 1024 * 1024, edit: true },
  motions: { max: 4 * 1024 * 1024, edit: true },
  project: { max: 32 * 1024 * 1024, edit: true },
  choices: { max: 4 * 1024 * 1024, edit: false },
  queue: { max: 2 * 1024 * 1024, edit: false },
};
/** read with the page at start (the project only when the workshop opens) */
const AT_START = ['themes', 'motions', 'choices', 'queue'];
const MOVED = 'moved.json';

function createKept(dir) {
  const file = (key) => path.join(dir, key + '.json');
  // writes of one item run in order; a write queued behind another replaces what that one would have written
  const chains = new Map();
  const latest = new Map();

  async function ready() {
    await fs.mkdir(dir, { recursive: true });
    await assertDirectory(dir);
  }
  async function read(key) {
    try {
      return JSON.parse(await fs.readFile(file(key), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      console.error('[kept] unreadable', key, error.message);
      return null;
    }
  }
  async function exists(name) {
    return fs.access(path.join(dir, name)).then(
      () => true,
      () => false,
    );
  }
  async function start() {
    await ready();
    const values = {};
    for (const key of AT_START) values[key] = await read(key);
    return { values, moved: await exists(MOVED) };
  }
  function write(key, value) {
    const body = value === null ? null : JSON.stringify(value);
    latest.set(key, body);
    const run = (chains.get(key) || Promise.resolve())
      .catch(() => {})
      .then(async () => {
        if (!latest.has(key)) return;
        const next = latest.get(key);
        latest.delete(key);
        if (next === null) await fs.rm(file(key), { force: true });
        else await replace(file(key), next);
      });
    chains.set(key, run);
    return run;
  }
  /** Take the items an earlier build kept in the page, once: none replaces one already kept here. */
  async function move(values) {
    if (await exists(MOVED)) return false;
    for (const [key, value] of Object.entries(values || {})) {
      if (!Object.hasOwn(ITEMS, key) || value == null || (await read(key)) !== null) continue;
      if (Buffer.byteLength(JSON.stringify(value)) > ITEMS[key].max) continue;
      await write(key, value);
    }
    await replace(path.join(dir, MOVED), JSON.stringify({ from: 'localStorage', at: Date.now() }));
    return true;
  }
  const settled = () => Promise.allSettled([...chains.values()]);
  return { start, read, write, move, settled };
}

function register(ipcMain, kept, { fromMain, canEdit }) {
  const valid = (key, value) =>
    Object.hasOwn(ITEMS, key) && (value === null || Buffer.byteLength(JSON.stringify(value)) <= ITEMS[key].max);
  ipcMain.handle('kept:start', (event) => (fromMain(event) ? kept.start() : null));
  ipcMain.handle('kept:get', (event, key) => (fromMain(event) && Object.hasOwn(ITEMS, key) ? kept.read(key) : null));
  ipcMain.handle('kept:set', async (event, key, value) => {
    if (!fromMain(event) || !valid(key, value) || (ITEMS[key].edit && !canEdit(event))) return false;
    await kept.write(key, value);
    return true;
  });
  ipcMain.handle('kept:move', (event, values) => (fromMain(event) ? kept.move(values) : false));
}

module.exports = { createKept, register, ITEMS };
