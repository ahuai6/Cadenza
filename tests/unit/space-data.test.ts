// The space interface's rooms come from the library: songs by title, albums by name (a page of sixteen in the nave),
// the favourites as the first playlist, and nothing that is not in the library any more.
import { describe, it, expect } from 'vitest';
import { fromLibrary, navePage, navePages, NAVE_SLOTS, indexLetter, letterSpan } from '../../src/app/space/data';
import type { Track, Playlist } from '../../src/app/bridge';

const track = (id: string, title: string, album: string, artist = 'A', cover: string | null = null): Track => ({
  id,
  file: `/m/${id}.flac`,
  folder: '/m',
  title,
  artist,
  album,
  albumArtist: '',
  genre: [],
  year: 2020,
  track: null,
  disc: null,
  duration: 200,
  codec: 'flac',
  bitrate: 0,
  sampleRate: 44100,
  bits: 16,
  lossless: true,
  ext: 'flac',
  composer: '',
  lyricist: '',
  cover,
  lrc: false,
  embedded: false,
  protected: false,
  analyzed: 0,
  added: 0,
  plays: 0,
  last: 0,
  looked: false,
  edited: false,
  coverSet: false,
  tags: { title, artist, album, albumArtist: '', year: 2020, genre: [], track: null, disc: null },
});

describe('space data', () => {
  const tracks = [
    track('1', '夜裡的歌', '北方', 'B', 'c1'),
    track('2', 'Alpha', '北方', 'B', 'c1'),
    track('3', '清晨', 'Glass', 'C'),
    track('4', 'Beta', '', 'D'),
  ];
  const lists: Playlist[] = [{ id: 'p1', name: '雨天', created: 0, tracks: ['3', 'gone', '1'] }];
  const L = fromLibrary(tracks, ['2', 'gone'], lists);
  it('lists every song once, in A to Z index order (a Chinese title under its pinyin initial)', () => {
    expect(L.songs.map((s) => s.id).sort()).toEqual(['1', '2', '3', '4']);
    expect(L.songs.map((s) => s.title)).toEqual(['Alpha', 'Beta', '清晨', '夜裡的歌']);
    expect(L.songs.map((s) => s.letter)).toEqual(['A', 'B', 'Q', 'Y']);
  });
  it('gives every title its index letter', () => {
    expect(['Émile', 'きゃぴ', 'カラオケ', '晴天', '123', '!?', '안녕', 'ゆめ'].map(indexLetter)).toEqual([
      'E',
      'K',
      'K',
      'Q',
      '#',
      '#',
      '#',
      'Y',
    ]);
    expect(letterSpan(L.songs)).toBe('A – Y');
    expect(letterSpan(L.songs.slice(0, 1))).toBe('A');
  });
  it('groups albums by name, leaves out songs with no album, and keeps a cover', () => {
    expect(L.albums.map((a) => a.title).sort()).toEqual(['Glass', '北方']);
    const n = L.albums.find((a) => a.title === '北方')!;
    expect(n.ids.sort()).toEqual(['1', '2']);
    expect(n.cover).toBe('c1');
  });
  it('puts the favourites first and drops songs no longer in the library', () => {
    expect(L.playlists.map((p) => p.id)).toEqual(['favorites', 'p1']);
    expect(L.playlists[0].ids).toEqual(['2']);
    expect(L.playlists[1].ids).toEqual(['3', '1']);
  });
  it('turns the nave in pages of sixteen', () => {
    const many = fromLibrary(
      Array.from({ length: 40 }, (_, i) => track(String(i), 't' + i, 'album ' + i)),
      [],
      [],
    );
    expect(navePages(many)).toBe(3);
    expect(navePage(many, 0)).toHaveLength(NAVE_SLOTS);
    expect(navePage(many, 2)).toHaveLength(8);
    expect(navePages(fromLibrary([], [], []))).toBe(1);
  });
  it('signs the library so an unchanged rescan rebuilds nothing', () => {
    expect(fromLibrary(tracks, ['2'], lists).sig).toBe(fromLibrary([...tracks].reverse(), ['2'], lists).sig);
    expect(fromLibrary(tracks, ['2'], lists).sig).not.toBe(fromLibrary(tracks, ['3'], lists).sig);
  });
});
