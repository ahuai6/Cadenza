// The library index on disk: a snapshot (db.json, the same document earlier builds read and write) and a journal
// (db.journal) of the entries changed since it was written. A save appends one line with only the entries marked as
// changed, so its cost follows the change, not the size of the library. The journal is folded into a new snapshot once
// it outgrows a share of the snapshot, after a change of the whole index, and on close.
//
// The index is a document of keyed maps (a song, the user's edits of it, where each edit came from, what is known of a
// recording's content) and short lists (folders, favourites, playlists). A journal line is
//   {"seq":n,"ops":[[name,key,value],…]}
// where `key` is null for a list and `value` null for a removed map entry. The snapshot records the last line it holds
// (`journalSeq`), so a crash between writing a snapshot and emptying the journal replays nothing twice; a line cut short
// by a crash is the last one written and is dropped.
const fs = require('node:fs/promises');
const { isDeepStrictEqual } = require('node:util');
const { openLibrary, replace } = require('./library-storage.cjs');

const MAPS = ['tracks', 'overrides', 'fieldOrigins', 'derived'];
const LISTS = ['folders', 'favorites', 'playlists'];
/** a journal smaller than this is never compacted on size alone (bytes) */
const COMPACT_MIN = 1024 * 1024;
/** compacted once the journal is larger than this share of the snapshot */
const COMPACT_SHARE = 0.5;

function createLibraryStore(file, options = {}) {
  const journalFile = file.replace(/\.json$/, '') + '.journal';
  let db = null;
  let seq = 0;
  let snapshotBytes = 0;
  let journalBytes = 0;
  let whole = false;
  const marked = new Map(MAPS.map((name) => [name, new Set()]));
  const lists = new Set();
  let queue = Promise.resolve();

  async function open() {
    db = await openLibrary(file);
    seq = Number.isSafeInteger(db.journalSeq) ? db.journalSeq : 0;
    delete db.journalSeq;
    snapshotBytes = (await fs.stat(file).catch(() => null))?.size || 0;
    const text = await fs.readFile(journalFile, 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
    let replayed = 0,
      torn = false;
    for (const line of text.split('\n')) {
      if (!line) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        torn = true;
        break;
      }
      if (!Number.isSafeInteger(entry?.seq) || !Array.isArray(entry.ops)) {
        torn = true;
        break;
      }
      if (entry.seq <= seq) continue;
      for (const op of entry.ops) apply(op);
      seq = entry.seq;
      replayed++;
    }
    journalBytes = Buffer.byteLength(text);
    // (a line cut short, or a journal already folded in: start the next one clean)
    if (!options.readOnly && (torn || (journalBytes && !replayed))) await compact();
    return db;
  }

  function apply([name, key, value]) {
    if (MAPS.includes(name) && typeof key === 'string') {
      if (value === null) delete db[name][key];
      else db[name][key] = value;
    } else if (LISTS.includes(name) && key === null && Array.isArray(value)) db[name] = value;
  }

  /** An entry of a keyed map changed (or was removed): it goes into the next save. */
  function mark(name, key) {
    marked.get(name).add(key);
  }
  /** A list changed (folders, favourites, playlists). */
  function markList(name) {
    lists.add(name);
  }
  /** Most of the index changed at once (caches cleared): the next save writes a new snapshot. */
  function markWhole() {
    whole = true;
  }
  const pending = () => whole || lists.size > 0 || [...marked.values()].some((keys) => keys.size > 0);

  function takeOps() {
    const ops = [];
    for (const [name, keys] of marked) {
      for (const key of keys) ops.push([name, key, Object.hasOwn(db[name], key) ? db[name][key] : null]);
      keys.clear();
    }
    for (const name of lists) ops.push([name, null, db[name]]);
    lists.clear();
    return ops;
  }

  /** Write what was marked since the last save (in order with every other write of the index). */
  function flush() {
    const run = queue
      .catch(() => {})
      .then(async () => {
        if (!pending()) return;
        if (whole || journalBytes > Math.max(options.compactMin ?? COMPACT_MIN, snapshotBytes * COMPACT_SHARE))
          return compact();
        // (the values are read now, as they stand: a later change marks them again)
        const line = JSON.stringify({ seq: seq + 1, ops: takeOps() }) + '\n';
        const handle = await fs.open(journalFile, 'a');
        try {
          await handle.writeFile(line);
          await handle.sync();
        } finally {
          await handle.close();
        }
        seq++;
        journalBytes += Buffer.byteLength(line);
        if (options.check) await verify();
      });
    queue = run;
    return run;
  }

  /** Fold everything into a new snapshot and start an empty journal. */
  async function compact() {
    whole = false;
    takeOps();
    const body = JSON.stringify({ ...db, journalSeq: seq });
    await replace(file, body);
    snapshotBytes = Buffer.byteLength(body);
    // (the snapshot holds every line up to `seq`: an old journal left by a crash here is skipped on the next open)
    await replace(journalFile, '');
    journalBytes = 0;
    if (options.check) await verify();
  }

  /** Test aid: the index read back from disk must equal the one in memory once nothing is left to save. */
  async function verify() {
    if (pending()) return;
    const reread = createLibraryStore(file, { readOnly: true });
    const disk = await reread.open();
    if (!isDeepStrictEqual(JSON.parse(JSON.stringify(disk)), JSON.parse(JSON.stringify(db))))
      console.error('[library store] the index on disk differs from the one in memory');
  }

  return {
    open,
    mark,
    markList,
    markWhole,
    flush,
    compactNow: () => {
      const run = queue.catch(() => {}).then(compact);
      queue = run;
      return run;
    },
    get pending() {
      return pending();
    },
  };
}

module.exports = { createLibraryStore, MAPS, LISTS };
