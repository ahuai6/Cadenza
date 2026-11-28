// The page's library after an update that carries only what changed (4.0.0 phase 2).
import { describe, expect, it } from 'vitest';
import { lib, libraryIndex, patchLibrary, trackOf } from '../../src/app/state';
import type { LibView, Track } from '../../src/app/bridge';

const song = (id: string, extra: Partial<Track> = {}) => ({ id, title: id, album: 'A', ...extra }) as Track;
const view = (): LibView => ({
  folders: ['C:/m'],
  tracks: [song('a'), song('b'), song('c')],
  favorites: [],
  playlists: [],
});

describe('library patch', () => {
  it('replaces changed songs where they stand, adds new ones at the end and leaves removed ones out', () => {
    const v = view();
    const next = patchLibrary(v, { tracks: [song('b', { plays: 4 }), song('d')], removed: ['a'] });
    expect(next.tracks!.map((t) => t.id)).toEqual(['b', 'c', 'd']);
    expect(next.tracks![0].plays).toBe(4);
    // every song not in the patch is the same object
    expect(next.tracks![1]).toBe(v.tracks[2]);
    expect(next.folders).toBeUndefined();
  });

  it('carries a changed list, and no track list when no song changed', () => {
    const next = patchLibrary(view(), { tracks: [], removed: [], favorites: ['c'] });
    expect(next).toEqual({ favorites: ['c'] });
  });

  it('finds a song by id after each update, and shares one index while the songs stay the same', () => {
    lib.set(view());
    expect(trackOf('b')?.title).toBe('b');
    lib.set(patchLibrary(lib.get(), { tracks: [song('b', { title: 'B2' })], removed: [] }));
    expect(trackOf('b')?.title).toBe('B2');
    expect(trackOf('zz')).toBeNull();
    const { tracks, favorites } = lib.get();
    expect(libraryIndex(tracks, favorites)).toBe(libraryIndex(tracks, favorites));
  });
});
