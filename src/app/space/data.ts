// What the cathedral shows, taken from Cadenza's library: every song (the crossing's wall, by title), the albums (the
// nave, by name, sixteen to a page), the playlists (the north chapel, the favourites first). Pure: the same library
// gives the same rooms, so a rescan that changes nothing rebuilds nothing.
import type { Playlist, Track } from '../bridge';
import { indexOf } from '../state';

export interface SpaceSong { id: string; title: string; artist: string; album: string; albumKey: string; cover: string | null }
export interface SpaceAlbum { key: string; title: string; artist: string; year: number | null; cover: string | null; ids: string[] }
export interface SpacePlaylist { id: string; name: string; note: string; ids: string[] }
export interface SpaceLibrary { songs: SpaceSong[]; albums: SpaceAlbum[]; playlists: SpacePlaylist[]; /** a key that changes whenever any room would */ sig: string }

/** The nave holds sixteen albums at a time (eight bays a side). */
export const NAVE_SLOTS = 16;
/** The north chapel has seven walls for playlists. */
export const LIST_SLOTS = 7;

const albumKey = (t: Track) => (t.album || '').trim().toLowerCase();
const collator = new Intl.Collator(['zh-Hant', 'en'], { numeric: true, sensitivity: 'base' });

export function fromLibrary(tracks: Track[], favorites: string[], playlists: Playlist[], labels = { favorites: '我的最愛', songs: (n: number) => `${n} 首` }): SpaceLibrary {
  const live = new Set(tracks.map(t => t.id));
  const songs: SpaceSong[] = tracks.map(t => ({ id: t.id, title: t.title || t.file.split(/[\\/]/).pop() || '', artist: t.albumArtist || t.artist || '', album: t.album || '', albumKey: albumKey(t), cover: t.cover }))
    .sort((a, b) => collator.compare(a.title, b.title) || collator.compare(a.artist, b.artist));
  const albums: SpaceAlbum[] = indexOf(tracks, favorites).albums.filter(g => g.key)
    .map(g => ({ key: g.key, title: g.name, artist: g.artist || '', year: g.year ?? null, cover: g.cover, ids: g.tracks.map(t => t.id) }));
  const lists: SpacePlaylist[] = [];
  const fav = favorites.filter(id => live.has(id));
  if (fav.length) lists.push({ id: 'favorites', name: labels.favorites, note: labels.songs(fav.length), ids: fav });
  for (const p of playlists) { const ids = p.tracks.filter(id => live.has(id)); lists.push({ id: p.id, name: p.name, note: labels.songs(ids.length), ids }); }
  const sig = [songs.map(s => s.id + s.title + s.cover).join('|'), albums.map(a => a.key + a.cover).join('|'), lists.map(l => l.id + l.name + l.ids.join(',')).join('|')].join('#');
  return { songs, albums, playlists: lists, sig };
}

/** The albums on the nave's walls for one page (empty slots stay bare). */
export const navePage = (lib: SpaceLibrary, page: number) => lib.albums.slice(page * NAVE_SLOTS, (page + 1) * NAVE_SLOTS);
export const navePages = (lib: SpaceLibrary) => Math.max(1, Math.ceil(lib.albums.length / NAVE_SLOTS));

/** The song's rhythm at song time t, for the scene: the accent clock (the floating things' time), how far an accent has
 *  slowed it (0..1: the beams' swell), the quick pulse on every event. `clock` is the rhythm SDK's accentClock. */
export interface SpaceRhythm { clock: number; dip: number; pulse: number }
export function rhythmAt<M>(clock: (map: M, t: number) => number, s: { map?: M; sig?: { pulse(t: number): number } } | null | undefined, t: number): SpaceRhythm | null {
  if (!s?.map || !s.sig) return null;
  const h = 0.03, c0 = clock(s.map, t), v = (clock(s.map, t + h) - c0) / h;
  return { clock: c0, dip: Math.max(0, Math.min(1, (1 - v) / 0.8)), pulse: Math.max(0, Math.min(1, s.sig.pulse(t))) };
}
