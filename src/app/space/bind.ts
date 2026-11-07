// The one door between Cadenza and the cathedral (docs/SPACE.md): the scene reads the library, the song playing and its
// lyrics here, and plays through here; it never reaches the stores or the player itself. Reads are cheap and made once
// a frame by the scene (no per-frame subscriptions); a change of library is announced, gathered over a moment, so a scan
// that adds songs one by one rebuilds the rooms once.
import { lib, trackOf, settings } from '../state';
import { coverUrl, type Settings } from '../bridge';
import { player, playIds, toggle, next, prev } from '../playback/player';
import { setSettings } from '../actions/settings';
import { engine, audioContext } from '../playback/stage';
import { accentClock } from '../../engine';
import { ts } from './i18n';
import { fromLibrary, rhythmAt, type SpaceLibrary, type SpaceRhythm } from './data';

export interface NowLine { t: number; end: number; sung: number; text: string }
export interface SpaceNow {
  id: string | null; title: string; artist: string; album: string; cover: string | null; coverFull: string | null;
  playing: boolean; t: number; dur: number; lines: NowLine[];
}
export interface SpaceBind {
  library(): SpaceLibrary;
  /** called (gathered, at most every 1.5 s) when the library's rooms would change */
  onLibrary(f: (l: SpaceLibrary) => void): () => void;
  now(): SpaceNow;
  play(ids: string[], index?: number): void;
  toggle(): void; next(): void; prev(): void;
  /** a cover's address: the small one (walls, collages) or the full one (the nave's frames, the sanctuary) */
  cover(key: string | null, full?: boolean): string | null;
  /** the page's audio (Cadenza's one context); where the song goes; whether the Hi-Fi output plays it (outside the page) */
  audio(): { ctx: AudioContext; route(node: AudioNode | null): void; hifi: boolean; useStandard(): Promise<void> };
  /** the song's rhythm at song time t (null: no song, or not read yet): the accent clock (the drifting things' time),
   *  how far an accent has slowed it (0..1, the beams' swell), the quick pulse on every event (the scene's breath) */
  rhythm(t: number): SpaceRhythm | null;
  /** the scene's colour: from the playing song's cover (its ambient palette), or the fixed colour the settings name;
   *  null while neither (the wheat house colours) */
  tint(): [number, number, number] | null;
  /** the space's own settings */
  prefs(): SpacePrefs;
  onPrefs(f: (p: SpacePrefs) => void): () => void;
}
/** The space's settings in the scene's terms. */
export interface SpacePrefs { beams: boolean; beatBeams: boolean; pulse: boolean; dream: boolean; line: 'thin' | 'mid' | 'bold'; shadow: 'high' | 'mid' | 'low'; res: number;
  walk: number; look: number; lyric: 's' | 'm' | 'l'; follow: boolean; music: boolean; musicVol: number; immersive: boolean; motion: 'full' | 'reduced'; gfx: 'default' | 'optimized' | 'lite' }

const SYS_REDUCED = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
function prefsOf(st: Settings): SpacePrefs {
  return { beams: st.spaceBeams !== false, beatBeams: st.spaceBeatBeams !== false, pulse: st.spacePulse !== false, dream: st.spaceDream !== false, line: st.spaceLine || 'mid', shadow: st.spaceShadow || 'high',
    res: st.spaceScale || 1, walk: st.spaceWalk || 1, look: st.spaceLook || 1, lyric: st.spaceLyric || 'm', follow: !!st.spaceFollow, music: st.spaceAmbient !== false, musicVol: st.spaceAmbientVol ?? 0.6,
    immersive: !!st.spaceImmersive, motion: st.spaceReduced || SYS_REDUCED ? 'reduced' : 'full', gfx: st.gfx === 'optimized' || st.gfx === 'lite' ? st.gfx : 'default' };
}
export function createBind(): SpaceBind {
  let cur = build(), timer = 0;
  const subs = new Set<(l: SpaceLibrary) => void>();
  function build() { const s = lib.get(); return fromLibrary(s.tracks, s.favorites, s.playlists, { favorites: ts('favorites'), songs: (n) => ts('songs', { n }) }); }
  lib.subscribe(() => { clearTimeout(timer); timer = window.setTimeout(() => { const n = build(); if (n.sig === cur.sig) return; cur = n; subs.forEach(f => f(cur)); }, 1500); });
  let linesFor: unknown = null, lines: NowLine[] = [];
  return {
    library: () => cur,
    onLibrary(f) { subs.add(f); return () => subs.delete(f); },
    now() {
      const p = player.get(), id = p.shownId || p.id, t = trackOf(id), s = p.session;
      if (s?.doc !== linesFor) { linesFor = s?.doc ?? null; lines = (s?.doc?.lines || []).filter(L => L.text.trim()).map(L => ({ t: L.t, end: L.end, sung: L.sung, text: L.text })); }
      return { id: id ?? null, title: t?.title || '', artist: t?.albumArtist || t?.artist || '', album: t?.album || '', cover: coverUrl(t?.cover) || null, coverFull: coverUrl(t?.cover, true) || null,
        playing: p.playing, t: engine.time, dur: s?.musicEnd || t?.duration || 0, lines };
    },
    play(ids, index = 0) { if (ids.length) playIds(ids, index).catch(() => {}); },
    toggle, next: () => { next().catch(() => {}); }, prev: () => { prev().catch(() => {}); },
    cover: (key, full = false) => coverUrl(key, full) || null,
    rhythm: (t) => rhythmAt(accentClock, player.get().session, t),
    tint() {
      const st = settings.get();
      if (st.spaceTint === 'fixed') { const m = /^#?([0-9a-f]{6})$/i.exec(st.spaceTintColor || ''); if (m) { const n = parseInt(m[1], 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; } }
      const a = player.get().session?.ambient; return a ? (a.cols[0] || a.base) as [number, number, number] : null;
    },
    prefs: () => prefsOf(settings.get()),
    onPrefs(f) { let last = JSON.stringify(prefsOf(settings.get())); return settings.subscribe(() => { const p = prefsOf(settings.get()), k = JSON.stringify(p); if (k !== last) { last = k; f(p); } }); },
    audio: () => ({ ctx: audioContext(), route: (n) => engine.audioRoute(n), hifi: !!engine.clock.external,
      useStandard: () => setSettings({ audioOut: 'standard' }) }),
  };
}
