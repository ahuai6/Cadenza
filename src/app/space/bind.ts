// The one door between Cadenza and the cathedral (docs/SPACE.md): the scene reads the library, the song playing and its
// lyrics here, and plays through here; it never reaches the stores or the player itself. Reads are cheap and made once
// a frame by the scene (no per-frame subscriptions); a change of library is announced, gathered over a moment, so a scan
// that adds songs one by one rebuilds the rooms once.
import { lib, trackOf } from '../state';
import { coverUrl } from '../bridge';
import { player, playIds, toggle, next, prev, switchOutput } from '../playback/player';
import { setSettings } from '../actions/settings';
import { engine, audioContext } from '../playback/stage';
import { fromLibrary, type SpaceLibrary } from './data';

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
}

export function createBind(): SpaceBind {
  let cur = build(), timer = 0;
  const subs = new Set<(l: SpaceLibrary) => void>();
  function build() { const s = lib.get(); return fromLibrary(s.tracks, s.favorites, s.playlists); }
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
    audio: () => ({ ctx: audioContext(), route: (n) => engine.audioRoute(n), hifi: !!engine.clock.external,
      useStandard: async () => { await setSettings({ audioOut: 'standard' }); await switchOutput(); } }),
  };
}
