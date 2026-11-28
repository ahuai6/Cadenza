// The library index's snapshot and journal (electron/library-store.cjs, 4.0.0 phase 2).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createLibraryStore } = require('../../electron/library-store.cjs');
const { openLibrary } = require('../../electron/library-storage.cjs');

type Db = {
  folders: string[];
  tracks: Record<string, Record<string, unknown>>;
  favorites: string[];
  overrides: Record<string, unknown>;
};
const dirs: string[] = [];
function place() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cadenza-store-'));
  dirs.push(dir);
  return { file: path.join(dir, 'db.json'), journal: path.join(dir, 'db.journal') };
}
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
const song = (id: string, extra = {}) => ({ id, path: `C:/music/${id}.flac`, plays: 0, ...extra });

describe('library store', () => {
  it('appends only what was marked, and reads it back on the next open', async () => {
    const { file, journal } = place();
    const store = createLibraryStore(file, { compactMin: Infinity });
    const db: Db = await store.open();
    for (const id of ['a', 'b', 'c']) db.tracks[id] = song(id);
    store.markWhole();
    await store.flush();
    const snapshot = fs.statSync(file).size;
    db.tracks.b.plays = 3;
    store.mark('tracks', 'b');
    db.favorites.unshift('c');
    store.markList('favorites');
    await store.flush();
    expect(fs.statSync(file).size).toBe(snapshot);
    const lines = fs.readFileSync(journal, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).ops).toEqual([
      ['tracks', 'b', song('b', { plays: 3 })],
      ['favorites', null, ['c']],
    ]);
    const again: Db = await createLibraryStore(file).open();
    expect(again.tracks.b.plays).toBe(3);
    expect(again.tracks.a).toEqual(song('a'));
    expect(again.favorites).toEqual(['c']);
  });

  it('removes a map entry marked after it was deleted', async () => {
    const { file } = place();
    const store = createLibraryStore(file, { compactMin: Infinity });
    const db: Db = await store.open();
    db.overrides.a = { title: 'Mine' };
    store.mark('overrides', 'a');
    await store.flush();
    delete db.overrides.a;
    store.mark('overrides', 'a');
    await store.flush();
    expect((await createLibraryStore(file).open()).overrides).toEqual({});
  });

  it('drops a line cut short by a crash and starts a clean journal', async () => {
    const { file, journal } = place();
    const store = createLibraryStore(file, { compactMin: Infinity });
    const db: Db = await store.open();
    db.tracks.a = song('a');
    store.mark('tracks', 'a');
    await store.flush();
    fs.appendFileSync(journal, '{"seq":2,"ops":[["tracks","b",{"id":"b"');
    const reopened: Db = await createLibraryStore(file).open();
    expect(Object.keys(reopened.tracks)).toEqual(['a']);
    expect(fs.readFileSync(journal, 'utf8')).toBe('');
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).tracks.a).toEqual(song('a'));
  });

  it('folds the journal into the snapshot when it outgrows it, without replaying a line twice', async () => {
    const { file, journal } = place();
    const store = createLibraryStore(file, { compactMin: 0 });
    const db: Db = await store.open();
    db.tracks.a = song('a');
    store.mark('tracks', 'a');
    await store.flush();
    // (the snapshot is tiny: the next save folds everything into it)
    db.tracks.a.plays = 1;
    store.mark('tracks', 'a');
    await store.flush();
    expect(fs.readFileSync(journal, 'utf8')).toBe('');
    const written = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(written.tracks.a.plays).toBe(1);
    // a journal left behind by a crash right after the snapshot: its lines are already in the snapshot
    fs.writeFileSync(journal, JSON.stringify({ seq: written.journalSeq, ops: [['tracks', 'a', song('a')]] }) + '\n');
    expect((await createLibraryStore(file).open()).tracks.a.plays).toBe(1);
  });

  it('leaves a whole index in db.json that the earlier reader opens as it is', async () => {
    const { file } = place();
    const store = createLibraryStore(file, { compactMin: Infinity });
    const db: Db = await store.open();
    db.folders.push('C:/music');
    store.markList('folders');
    db.tracks.a = song('a', { plays: 2 });
    store.mark('tracks', 'a');
    await store.flush();
    await store.compactNow();
    const earlier = await openLibrary(file);
    expect(earlier.folders).toEqual(['C:/music']);
    expect(earlier.tracks.a.plays).toBe(2);
  });

  it('writes nothing when nothing was marked', async () => {
    const { file, journal } = place();
    const store = createLibraryStore(file);
    await store.open();
    await store.flush();
    expect(fs.existsSync(journal)).toBe(false);
    expect(fs.existsSync(file)).toBe(false);
  });
});
