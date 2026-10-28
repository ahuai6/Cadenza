// The desktop app: a personal music library around the lyric engine. Title bar (its own window buttons), a sidebar
// (Library, Poster wall, Lyric workshop; Settings at the bottom), the page, the floating player card, and above them
// the stage (the engine's picture), the now-playing page and the effect-lyrics controls.
import { useEffect, useLayoutEffect, useState } from 'react';
import { tx, setLang as setI18n, detectLang, LANGS, type Lang, lang as langStore } from '../../i18n';
import { D, Lib } from '../bridge';
import { ui, lib, settings, useStore, keep, type Page } from '../state';
import { Icon } from '../ui/icons';
import { ContextMenu, Toast } from '../ui/kit';
import { engine } from '../playback/stage';
import { player, toggle, seekBy } from '../playback/player';
import { startAnalysis } from '../playback/analysis';
import { back } from '../layers';
import { applyUiFont } from '../uifont';
import mark from '../brand/mark.svg';
import { LibraryView } from './Library';
import { PosterWall } from './Wall';
import { SettingsView } from './Settings';
import { PlayerCard, QueuePanel } from './Player';
import { Stage, NowPlaying } from './NowPlaying';
import { EffectView } from './Effect';
import { ModalHost } from './Modals';
import { WorkshopPage } from './workshop/Workshop';
import s from './Shell.module.css';

function resolveTheme(t: string) { return t === 'light' || t === 'dark' ? t : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
function useTheme() {
  const t = useStore(settings, x => x.theme);
  useLayoutEffect(() => {
    const apply = () => { document.documentElement.dataset.theme = resolveTheme(t); };
    apply(); const mq = matchMedia('(prefers-color-scheme: dark)'); mq.addEventListener('change', apply); return () => mq.removeEventListener('change', apply);
  }, [t]);
}
export async function setLang(l: Lang) { applyUiFont(l); setI18n(l); settings.set({ lang: l }); await D?.setSettings({ lang: l }); }
/** The MV look from the settings. */
export const mvLook = (n: Partial<import('../bridge').Settings>) => ({ dark: n.mvDark ?? 0.34, blur: n.mvBlur ?? 0.12, desat: n.mvDesat ?? 0, fit: !!n.mvFit });
export const renderSettings = (n: { scale: 'auto' | number; fps: number; prerender: boolean }) => ({ scale: n.scale === 'auto' ? 'auto' as const : +n.scale || 1, fps: +n.fps || 0, prerender: n.prerender !== false });

export function Shell() {
  const page = useStore(ui, x => x.page), layer = useStore(ui, x => x.layer), modal = useStore(ui, x => !!x.modal), menu = useStore(ui, x => !!x.menu);
  const hasTrack = useStore(player, x => !!x.id);
  const lng = useStore(langStore, x => x.lang);
  const [ready, setReady] = useState(false);
  useTheme();
  // start: settings, language, the library and its live updates, the background analysis
  useEffect(() => {
    if (!D || !Lib) return;
    (async () => {
      const st = await D.settings(); settings.set(st);
      const l = (st.lang && LANGS.some(([k]) => k === st.lang) ? st.lang : detectLang()) as Lang; applyUiFont(l); setI18n(l);
      engine.setRender(renderSettings(st)); engine.mvLook = mvLook(st);
      lib.set({ ...(await Lib.get()), loaded: true }); setReady(true);
      startAnalysis();
    })();
    const offs = [Lib.onChanged(v => lib.set({ ...v, analysis: null })), Lib.onProgress(p => lib.set({ progress: p })), Lib.onAnalysis(a => lib.set({ analysis: a })),
      D.onWin(win => ui.set({ win }))];
    return () => offs.forEach(f => f());
  }, []);
  // keys: space plays, Esc steps back out of the effect view and the now-playing page, arrows seek there
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input,textarea,select,[contenteditable]')) return;
      const u = ui.get();
      if (e.key === 'Escape') { if (u.modal) ui.set({ modal: null }); else if (u.queue) ui.set({ queue: false }); else if (u.layer !== 'none') back(); }
      else if (e.code === 'Space' && u.page !== 'workshop' || e.code === 'Space' && u.layer !== 'none') { e.preventDefault(); toggle(); }
      else if (e.key === 'F11') { e.preventDefault(); D?.win('full'); }
      else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && u.layer !== 'none' && !u.modal) { e.preventDefault(); seekBy(e.key === 'ArrowRight' ? 5 : -5); }
    };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  }, []);

  if (!ready) return <div className={s.boot} />;
  const top = modal ? 'modal' : menu ? 'menu' : layer;
  return (
    // a language change rebuilds the interface (every label is read again)
    <div key={lng} className={s.shell} data-page={page} data-layer={layer} data-top={top}>
      <TitleBar />
      <div className={s.body}>
        <Sidebar />
        <main data-scroll className={s.page} aria-hidden={layer !== 'none'} inert={layer !== 'none'}>
          <div className={s.pageInner}>
            {page === 'library' && <LibraryView />}
            {page === 'wall' && <PosterWall />}
            {page === 'settings' && <SettingsView />}
            {page === 'workshop' && <WorkshopPage />}
          </div>
        </main>
      </div>
      {page !== 'workshop' && hasTrack && <PlayerCard />}
      <Stage />
      {hasTrack && <NowPlaying />}
      {hasTrack && <EffectView />}
      <QueuePanel />
      <ModalHost />
      <ContextMenu />
      <Toast />
    </div>
  );
}

function TitleBar() {
  const st = useStore(ui, x => x.win), page = useStore(ui, x => x.page), search = useStore(ui, x => x.search);
  return (
    <header data-test="titlebar" className={s.tb} onDoubleClick={e => { if (!(e.target as HTMLElement).closest('button,input')) D?.win('max'); }}>
      <div className={s.brand}><img src={mark} alt="" /><span>Cadenza</span></div>
      <div className={s.tbMid}>
        {page === 'library' && (
          <label className={s.search}><Icon n="search" size={16} />
            <input type="search" placeholder={tx('s.search')} value={search} onChange={e => ui.set({ search: e.target.value })} /></label>
        )}
      </div>
      <div className={s.winbtns}>
        <button type="button" title={tx(st.full ? 's.unfullscreen' : 's.fullscreen')} aria-label={tx(st.full ? 's.unfullscreen' : 's.fullscreen')} onClick={() => D?.win('full')}><Icon n={st.full ? 'unfull' : 'full'} size={16} /></button>
        {!st.full && <>
          <button type="button" title={tx('s.min')} aria-label={tx('s.min')} onClick={() => D?.win('min')}><Icon n="min" size={16} /></button>
          <button type="button" title={tx(st.max ? 's.restore' : 's.max')} aria-label={tx(st.max ? 's.restore' : 's.max')} onClick={() => D?.win('max')}><Icon n={st.max ? 'restore' : 'max'} size={15} /></button>
          <button type="button" data-close title={tx('s.quit')} aria-label={tx('s.quit')} onClick={() => D?.win('close')}><Icon n="close" size={16} /></button>
        </>}
      </div>
    </header>
  );
}

const NAV: [Page, string, string][] = [['library', 'library', 's.library'], ['wall', 'wall', 's.wall'], ['workshop', 'workshop', 's.workshop']];
export function go(page: Page) { const u = ui.get(); if (u.page === page && !u.detail) return; ui.set({ page, detail: null, layer: 'none', queue: false }); }
function Sidebar() {
  const page = useStore(ui, x => x.page), prog = useStore(lib, x => x.progress), tracks = useStore(lib, x => x.tracks), an = useStore(lib, x => x.analysis);
  let done = 0, total = 0;
  if (an) { done = an.done; total = an.total; } else { const playable = tracks.filter(t => !t.protected); total = playable.length; done = playable.filter(t => t.analyzed > 0).length; }
  return (
    <nav className={s.side} aria-label="Cadenza">
      <div className={s.nav}>
        {NAV.map(([k, ic, label]) => (
          <button key={k} type="button" className={s.navi} aria-current={page === k ? 'page' : undefined} onClick={() => go(k)}><Icon n={ic} size={19} /><span>{tx(label)}</span></button>
        ))}
      </div>
      <div className={s.sideFoot}>
        {prog.phase === 'scan' && <div className={s.chip} style={{ ['--p' as string]: `${(prog.done / Math.max(1, prog.total)) * 100}%` }}><i /><span>{tx('s.scanning', prog)}</span></div>}
        {prog.phase !== 'scan' && done < total && <div className={s.chip} style={{ ['--p' as string]: `${(done / Math.max(1, total)) * 100}%` }}><i /><span>{tx('s.analyzing', { done, total })}</span></div>}
        <button type="button" className={s.navi} aria-current={page === 'settings' ? 'page' : undefined} onClick={() => go('settings')}><Icon n="settings" size={19} /><span>{tx('s.settings')}</span></button>
      </div>
    </nav>
  );
}
export { keep };
// read by the desktop tests
import * as playerApi from '../playback/player';
import * as layers from '../layers';
import { ws as workshop, engine as wsEngine } from './workshop/project';
Object.assign((window as any).__cadenza, { ui, lib, settings, player: playerApi.player, api: playerApi, layers, workshop, wsEngine });
