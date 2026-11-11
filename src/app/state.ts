// The interface's state: a few small stores, read in components with useStore. Everything per frame (playback time,
// progress bars, the lyric highlight) goes to the DOM through refs on the engine's tick, never through these.
import { useMemo, useSyncExternalStore } from 'react';
import { createStore, type Store } from '../core/emitter';
import type { LibView, Settings, Track } from './bridge';

export function useStore<T extends object, R = T>(s: Store<T>, sel?: (v: T) => R): R {
  return useSyncExternalStore(s.subscribe, () => (sel ? sel(s.get()) : (s.get() as unknown as R)));
}
export const remember = <T>(k: string, d: T): T => { try { const v = localStorage.getItem('cz-' + k); return v == null ? d : JSON.parse(v); } catch { return d; } };
export const keep = (k: string, v: unknown) => { try { localStorage.setItem('cz-' + k, JSON.stringify(v)); } catch { /* private mode */ } };

export type Page = 'library' | 'wall' | 'workshop' | 'settings';
export type Detail = { kind: 'album' | 'artist' | 'genre' | 'playlist'; key: string } | null;
/** A menu's entry: an action (run), or a submenu (sub) that opens beside it. */
export interface MenuItem { label: string; icon?: string; danger?: boolean; disabled?: boolean; run?: () => void; sub?: (MenuItem | '-')[] }
/** Where the user is. `layer` is what they asked to see on top of the page; the stage animates toward it. */
export const ui = createStore({
  page: 'library' as Page, section: remember<string | null>('section', null), detail: null as Detail, search: '',
  layer: 'none' as 'none' | 'np' | 'fx', queue: false, win: { max: false, full: false, mini: false } as { max: boolean; full: boolean; mini?: boolean; min?: boolean },
  modal: null as null | { kind: string; [k: string]: unknown }, menu: null as null | { x: number; y: number; items: (MenuItem | '-')[] },
  toast: null as null | { text: string; id: number },
  wallLayout: remember('wallLayout', 'mosaic'), wallSource: remember('wallSource', 'all'),
  /** the play page's lyrics: their size, the soft focus on the lines around the sung one, translations shown */
  npLyr: { font: 'ui', reads: true, ...remember('npLyr', { size: 1, blur: true, subs: true }) } as { size: number; blur: boolean; subs: boolean; reads: boolean; font: string },
});
export const lib = createStore({ ...({ folders: [], tracks: [], favorites: [], playlists: [] } as LibView), loaded: false,
  progress: { phase: 'idle', done: 0, total: 0 }, analysis: null as null | { done: number; total: number },
  /** how far the song being analysed now is (0..1), null between songs */ analysisNow: null as null | number,
  /** which song that is */ analysisFor: null as null | string });
export const settings = createStore<Settings>({ theme: 'system', scanOnLaunch: true, openAtLogin: false, closeToTray: false, lang: '', scale: 'auto', fps: 0, prerender: true,
  audioOut: 'standard', audioMode: 'exclusive', audioDevice: '', fixedVolume: true, volBalance: true, mvDark: 0.34, mvBlur: 0.12, mvDesat: 0, mvFit: false, rhythmEngine: 'auto', rhythmDrums: true, gfx: 'default', version: '' });

let toastTm = 0;
export function toast(text: string, ms = 2600) { ui.set({ toast: { text, id: Date.now() } }); clearTimeout(toastTm); toastTm = window.setTimeout(() => ui.set({ toast: null }), ms); }
export function openMenu(e: { clientX: number; clientY: number; preventDefault(): void; stopPropagation(): void }, items: (MenuItem | '-' | false | null | undefined)[]) {
  e.preventDefault(); e.stopPropagation();
  const list = items.filter(Boolean) as (MenuItem | '-')[];
  ui.set({ menu: { x: e.clientX, y: e.clientY, items: list.filter((x, i) => x !== '-' || (i > 0 && i < list.length - 1 && list[i - 1] !== '-')) } });
}

/* ---------- indexes over the library, rebuilt only when the track list changes ---------- */
export interface Group { key: string; name: string; tracks: Track[]; cover: string | null; artist?: string; year?: number | null }
const keyOf = (s: string) => s.trim().toLowerCase();
export function indexOf(tracks: Track[], favorites: string[]) {
  const byId = new Map(tracks.map(t => [t.id, t])), fav = new Set(favorites);
  const group = (keyF: (t: Track) => string | string[]) => { const m = new Map<string, Group>();
    for (const t of tracks) for (const raw of ([] as string[]).concat(keyF(t))) { const name = (raw || '').trim(), k = keyOf(name);
      let g = m.get(k); if (!g) { g = { key: k, name, tracks: [], cover: null }; m.set(k, g); } g.tracks.push(t); if (!g.cover && t.cover) g.cover = t.cover; }
    return [...m.values()].sort((a, b) => (+!a.key) - (+!b.key) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })); };
  const albums = group(t => t.album).map(g => { g.artist = g.tracks.map(t => t.albumArtist || t.artist).find(Boolean) || ''; g.year = g.tracks.map(t => t.year).find(Boolean) || null;
    g.tracks.sort((a, b) => (a.disc || 0) - (b.disc || 0) || (a.track || 0) - (b.track || 0) || a.title.localeCompare(b.title)); return g; });
  const artists = group(t => { const a = (t.albumArtist || t.artist || '').split(/\s*(?:,|;|、|&|\/| feat\.? | ft\.? )\s*/i).filter(Boolean).slice(0, 3); return a.length ? a : ['']; });
  const genres = group(t => (t.genre && t.genre.length ? t.genre : ['']));
  return { byId, fav, albums, artists, genres };
}
export function useIndex() {
  const tracks = useStore(lib, s => s.tracks), favorites = useStore(lib, s => s.favorites);
  return useMemo(() => indexOf(tracks, favorites), [tracks, favorites]);
}
export const trackOf = (id: string | null | undefined) => (id ? lib.get().tracks.find(t => t.id === id) || null : null);
export const fmtTime = (s: number) => { s = Math.max(0, s || 0); return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`; };
export const match = (q: string, ...xs: unknown[]) => !q || xs.some(x => x != null && String(x).toLowerCase().includes(q));
