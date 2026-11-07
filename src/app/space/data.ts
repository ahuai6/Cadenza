// What the cathedral shows, taken from Cadenza's library: every song (the crossing's wall, by title), the albums (the
// nave, by name, sixteen to a page), the playlists (the north chapel, the favourites first). Pure: the same library
// gives the same rooms, so a rescan that changes nothing rebuilds nothing.
import type { Playlist, Track } from '../bridge';
import { indexOf } from '../state';

export interface SpaceSong { id: string; title: string; artist: string; album: string; albumKey: string; cover: string | null; /** its place in the A to Z index ('#': digits, symbols, scripts with no letter) */ letter: string }
export interface SpaceAlbum { key: string; title: string; artist: string; year: number | null; cover: string | null; ids: string[] }
export interface SpacePlaylist { id: string; name: string; note: string; ids: string[] }
export interface SpaceLibrary { songs: SpaceSong[]; albums: SpaceAlbum[]; playlists: SpacePlaylist[]; /** a key that changes whenever any room would */ sig: string }

/** The nave holds sixteen albums at a time (eight bays a side). */
export const NAVE_SLOTS = 16;
/** The north chapel has seven walls for playlists. */
export const LIST_SLOTS = 7;

const albumKey = (t: Track) => (t.album || '').trim().toLowerCase();
const collator = new Intl.Collator(['zh-Hant', 'en'], { numeric: true, sensitivity: 'base' });
// the index letter of a title, as a phone's contacts do it: a Latin letter is itself (accents dropped), a Chinese character
// takes its pinyin's initial (found against the first character of each initial in pinyin order), kana their row's
// romanisation; digits, symbols and other scripts go under #
const PINYIN = new Intl.Collator('zh-u-co-pinyin', { sensitivity: 'base' });
const PY_FIRST: [string, string][] = [['A', '阿'], ['B', '八'], ['C', '嚓'], ['D', '搭'], ['E', '鵝'], ['F', '发'], ['G', '旮'], ['H', '哈'], ['J', '丌'], ['K', '咔'], ['L', '垃'], ['M', '妈'], ['N', '拿'], ['O', '噢'], ['P', '啪'],
  ['Q', '七'], ['R', '蚺'], ['S', '仨'], ['T', '他'], ['W', '屲'], ['X', '夕'], ['Y', '丫'], ['Z', '帀']];
// each kana's Hepburn initial, in the order of あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん, then the voiced ones
const KANA = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをんがぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽ';
const KANA_L = 'AIUEOKKKKKSSSSSTCTTTNNNNNHHFHHMMMMMYYYRRRRRWONGGGGGZJZZZDJZDDBBBBBPPPPP';
export function indexLetter(title: string): string {
  const ch = [...title.trim().normalize('NFKC')].find(c => /[\p{L}\p{N}]/u.test(c)); if (!ch) return '#';
  const lat = ch.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase(); if (/^[A-Z]$/.test(lat)) return lat;
  if (/\p{Script=Han}/u.test(ch)) { let k = '#'; for (const [L, first] of PY_FIRST) { if (PINYIN.compare(ch, first) >= 0) k = L; else break; } return k; }
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(ch)) { const h = String.fromCharCode(/\p{Script=Katakana}/u.test(ch) && ch >= 'ァ' && ch <= 'ヶ' ? ch.charCodeAt(0) - 0x60 : ch.charCodeAt(0)), small = 'ぁぃぅぇぉっゃゅょゎ', big = 'あいうえおつやゆよわ', q = small.includes(h) ? big[small.indexOf(h)] : h, i = KANA.indexOf(q);
    if (i >= 0) return KANA_L[i]; }
  return '#';
}
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#';

export function fromLibrary(tracks: Track[], favorites: string[], playlists: Playlist[], labels = { favorites: '我的最愛', songs: (n: number) => `${n} 首` }): SpaceLibrary {
  const live = new Set(tracks.map(t => t.id));
  const songs: SpaceSong[] = tracks.map(t => { const title = t.title || t.file.split(/[\\/]/).pop() || ''; return { id: t.id, title, artist: t.albumArtist || t.artist || '', album: t.album || '', albumKey: albumKey(t), cover: t.cover, letter: indexLetter(title) }; })
    .sort((a, b) => LETTERS.indexOf(a.letter) - LETTERS.indexOf(b.letter) || collator.compare(a.title, b.title) || collator.compare(a.artist, b.artist));
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

/** The index letters a run of songs covers, for a tier's sign: 'A', 'A – C', '#'. */
export function letterSpan(songs: SpaceSong[]): string { const a = songs[0]?.letter, b = songs[songs.length - 1]?.letter; return !a ? '' : a === b ? a : `${a} – ${b}`; }

/** The rhythm's events between t0 and t1, weighted as the effect lyrics' beat rings weigh them (a downbeat more than an
 *  offbeat, a strong accent most). `map` is the rhythm SDK's RhythmMap. */
export interface SpaceBeat { t: number; w: number; strong: boolean }
interface EventLike { t: number; off?: boolean; pos: number; tier: number; s: number }
export function beatsIn(map: { meter: number; eventsIn(a: number, b: number, tier?: 0 | 1 | 2): EventLike[] } | null | undefined, t0: number, t1: number): SpaceBeat[] {
  if (!map) return [];
  return map.eventsIn(t0, t1, 1).map(e => { const down = !e.off && Math.round(e.pos) % map.meter === 0;
    return { t: e.t, w: Math.max(.25, Math.min(1.4, (down ? .75 : .4) * (.6 + .25 * Math.max(0, Math.min(2.4, e.s))) + (e.tier === 2 ? .35 : 0))), strong: e.tier === 2 && e.s >= 1.15 }; });
}

/** The song's rhythm at song time t, for the scene: the accent clock (the floating things' time), how far an accent has
 *  slowed it (0..1: the beams' swell), the quick pulse on every event. `clock` is the rhythm SDK's accentClock. */
export interface SpaceRhythm { clock: number; dip: number; pulse: number }
export function rhythmAt<M>(clock: (map: M, t: number) => number, s: { map?: M; sig?: { pulse(t: number): number } } | null | undefined, t: number): SpaceRhythm | null {
  if (!s?.map || !s.sig) return null;
  const h = 0.03, c0 = clock(s.map, t), v = (clock(s.map, t + h) - c0) / h;
  return { clock: c0, dip: Math.max(0, Math.min(1, (1 - v) / 0.8)), pulse: Math.max(0, Math.min(1, s.sig.pulse(t))) };
}
