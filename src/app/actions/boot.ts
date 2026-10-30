// Starting the interface, whatever it looks like: the settings (and the engine configured from them), the language,
// the library and its live updates, the last song (paused), the background analysis; the keys; moving between pages.
// And the hooks the desktop tests read (window.__cadenza): a new interface keeps them by keeping this module.
import { detectLang, setLang as setI18n, LANGS, words, type Lang } from '../../i18n';
import { D, Lib } from '../bridge';
import { ui, lib, settings, type Page } from '../state';
import * as playerApi from '../playback/player';
import { toggle, seekBy, resumeLast } from '../playback/player';
import { startAnalysis, pauseAnalysis } from '../playback/analysis';
import { applyEngineConfig } from '../engineConfig';
import * as layers from '../layers';
import { back } from '../layers';
import { applyUiFont } from '../uifont';
import { setSettings } from './settings';
import { ws as workshop, engine as wsEngine } from '../workshop/project';

/** Start: `ready` is called once the settings and the library are in. Returns the cleanup (the live updates off). */
export function boot(ready: () => void): () => void {
  if (!D || !Lib) return () => {};
  const d = D, l = Lib;
  (async () => {
    const st = await d.settings(); settings.set(st);
    const lg = (st.lang && LANGS.some(([k]) => k === st.lang) ? st.lang : detectLang()) as Lang; await applyUiFont(lg, st.uiFont || 'default', words(lg)); setI18n(lg);
    applyEngineConfig(st);
    lib.set({ ...(await l.get()), loaded: true }); ready();
    resumeLast().catch(() => {});   // (the last song, paused: the play page is ready before it is opened)
    startAnalysis();
  })();
  const offs = [l.onChanged(v => lib.set({ ...v, analysis: null })), l.onProgress(p => lib.set({ progress: p })), l.onAnalysis(a => lib.set({ analysis: a })),
    d.onWin(win => ui.set({ win }))];
  return () => offs.forEach(f => f());
}
/** The keys: space plays, Esc steps back out of the effect view and the now-playing page, arrows seek there. */
export function bindKeys(): () => void {
  const k = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input,textarea,select,[contenteditable]')) return;
    const u = ui.get();
    if (e.key === 'Escape') { if (u.modal) ui.set({ modal: null }); else if (u.queue) ui.set({ queue: false }); else if (u.layer !== 'none') back(); }
    else if (e.code === 'Space' && u.page !== 'workshop' || e.code === 'Space' && u.layer !== 'none') { e.preventDefault(); toggle(); }
    else if (e.key === 'F11') { e.preventDefault(); D?.win('full'); }
    else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && u.layer !== 'none' && !u.modal) { e.preventDefault(); seekBy(e.key === 'ArrowRight' ? 5 : -5); }
  };
  addEventListener('keydown', k); return () => removeEventListener('keydown', k);
}
/** Go to a page (closing the now-playing and effect layers). */
export function go(page: Page) { const u = ui.get(); if (u.page === page && !u.detail) return; ui.set({ page, detail: null, layer: 'none', queue: false }); }

// read by the desktop tests
Object.assign((window as any).__cadenza, { ui, lib, settings, setSettings, player: playerApi.player, api: playerApi, layers, workshop, wsEngine, pauseAnalysis });
