// The desktop app: a personal music library around the lyric engine. Title bar (its own window buttons), a sidebar
// (Library, Poster wall, Lyric workshop; Settings at the bottom), the page, the floating player card, and above them
// the stage (the engine's picture), the now-playing page and the effect-lyrics controls.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { tx, lang as langStore } from '../../i18n';
import { D } from '../bridge';
import { ui, lib, settings, useStore, keep, type Page } from '../state';
import { Icon } from '../ui/icons';
import { ContextMenu, Toast, Seg, Turn } from '../ui/kit';
import { player } from '../playback/player';
import { RHYTHM_VERSION } from '../../engine';
import mark from '../brand/mark.svg';
import { LibraryView, SECTIONS } from './Library';
import { hifi, refresh as hifiRefresh } from '../playback/hifi';
import { PosterWall } from './Wall';
import { SettingsView } from './Settings';
import { setSettings } from '../actions/settings';
import { boot, bindKeys, go } from '../actions/boot';
import { PlayerCard, QueuePanel } from './Player';
import { Stage, NowPlaying } from './NowPlaying';
import { EffectView } from './Effect';
import { ModalHost } from './Modals';
import { WorkshopPage } from './workshop/Workshop';
import s from './Shell.module.css';

function resolveTheme(t: string) { return t === 'light' || t === 'dark' ? t : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
function useTheme() {
  const t = useStore(settings, x => x.theme), tone = useStore(settings, x => x.tone);
  useLayoutEffect(() => {
    const apply = () => { const r = document.documentElement; r.dataset.theme = resolveTheme(t); r.dataset.tone = tone === 'white' ? 'white' : 'paper'; };
    apply(); const mq = matchMedia('(prefers-color-scheme: dark)'); mq.addEventListener('change', apply); return () => mq.removeEventListener('change', apply);
  }, [t, tone]);
}

export function Shell() {
  const page = useStore(ui, x => x.page), layer = useStore(ui, x => x.layer), modal = useStore(ui, x => !!x.modal), menu = useStore(ui, x => !!x.menu);
  const hasTrack = useStore(player, x => !!x.id);
  const lng = useStore(langStore, x => x.lang);
  const [ready, setReady] = useState(false);
  useTheme();
  // start (the settings, the library, the last song, the analysis) and the keys: actions/boot.ts
  useEffect(() => boot(() => setReady(true)), []);
  useEffect(bindKeys, []);
  // full screen over the picture: the window's buttons (leaving full screen) show only while the pointer moves, as the
  // play page's and the effect view's own controls do
  const full = useStore(ui, x => x.win.full), [idle, setIdle] = useState(false);
  useEffect(() => {
    if (!full || layer === 'none') { setIdle(false); return; }
    let tm = 0; const wake = () => { setIdle(false); clearTimeout(tm); tm = window.setTimeout(() => setIdle(true), 2600); };
    const evs = ['pointermove', 'pointerdown', 'keydown', 'wheel'] as const; evs.forEach(e => addEventListener(e, wake, { passive: true })); wake();
    return () => { clearTimeout(tm); evs.forEach(e => removeEventListener(e, wake)); };
  }, [full, layer]);

  if (!ready) return <div className={s.boot} />;
  const top = modal ? 'modal' : menu ? 'menu' : layer;
  return (
    // a language change rebuilds the interface (every label is read again)
    <div key={lng} className={s.shell} data-page={page} data-layer={layer} data-top={top} data-idle={idle || undefined} data-card={(page !== 'workshop' && hasTrack) || undefined}>
      <TitleBar />
      <div className={s.body}>
        <Sidebar />
        <main data-scroll className={s.page} aria-hidden={layer !== 'none'} inert={layer !== 'none'}>
          {/* a page turns: the old one fades out, the new one rises in */}
          <Turn k={page} className={s.pageInner}>
            {page === 'library' && <LibraryView />}
            {page === 'wall' && <PosterWall />}
            {page === 'settings' && <SettingsView />}
            {page === 'workshop' && <WorkshopPage />}
          </Turn>
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
      <div className={s.brand}><img src={mark} alt="" /><span className="display">Cadenza</span></div>
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
function Sidebar() {
  const page = useStore(ui, x => x.page), prog = useStore(lib, x => x.progress), tracks = useStore(lib, x => x.tracks), an = useStore(lib, x => x.analysis);
  const favorites = useStore(lib, x => x.favorites), section = useStore(ui, x => x.section) || (favorites.length ? 'favorites' : 'songs'), detail = useStore(ui, x => x.detail);
  let done = 0, total = 0;
  // (without a progress event yet: the songs analysed by this version of the rhythm analysis — an older one is to be redone)
  if (an) { done = an.done; total = an.total; } else { const playable = tracks.filter(t => !t.protected); total = playable.length; done = playable.filter(t => t.analyzed === RHYTHM_VERSION).length; }
  const now = useStore(lib, x => x.analysisNow), forId = useStore(lib, x => x.analysisFor), shown = useStore(player, x => x.shownId);
  // (the song playing, read whole while it plays: said as that, not as the library's queue)
  const thisSong = !!forId && forId === shown;
  // the chosen place is marked by one bar that slides to it (from page to page and section to section)
  const navRef = useRef<HTMLDivElement>(null), [mark, setMark] = useState<{ y: number; h: number } | null>(null);
  useLayoutEffect(() => { const el = navRef.current?.querySelector<HTMLElement>('[aria-current="page"]'); setMark(el ? { y: el.offsetTop, h: el.offsetHeight } : null); }, [page, section, detail]);
  return (
    <nav className={s.side} aria-label="Cadenza">
      <div className={s.nav} ref={navRef}>
        {mark && <i className={s.mark} style={{ transform: `translateY(${mark.y}px)`, height: mark.h }} aria-hidden="true" />}
        {NAV.map(([k, ic, label]) => (
          <div key={k} className={s.navGroup}>
            <button type="button" className={s.navi} aria-current={page === k && (k !== 'library' || !!detail) ? 'page' : undefined} data-open={page === k} onClick={() => go(k)}><Icon n={ic} size={18} /><span>{tx(label)}</span></button>
            {/* the library's own sections sit right under it: one click to any of them */}
            {k === 'library' && <div className={s.sub}>
              {SECTIONS.map(([sk, sl, sic]) => (
                <button key={sk} type="button" className={s.subi} aria-current={page === 'library' && !detail && section === sk ? 'page' : undefined}
                  onClick={() => { ui.set({ page: 'library', section: sk, detail: null, layer: 'none', queue: false }); keep('section', sk); }}><Icon n={sic} size={15} /><span>{tx(sl)}</span></button>
              ))}
            </div>}
          </div>
        ))}
      </div>
      <div className={s.sideFoot}>
        {prog.phase === 'scan' && <div className={s.chip} style={{ ['--p' as string]: `${(prog.done / Math.max(1, prog.total)) * 100}%` }}><span>{tx('s.scanning', prog)}</span><i /></div>}
        {thisSong && <div className={s.chip} style={{ ['--p' as string]: `${(now ?? 0) * 100}%` }}><span>{tx('s.analyzingThis', { pct: Math.round((now ?? 0) * 100) })}</span><i /></div>}
        {!thisSong && prog.phase !== 'scan' && done < total && <div className={s.chip} style={{ ['--p' as string]: `${(done / Math.max(1, total)) * 100}%` }}><span>{tx('s.analyzing', { done, total })}{now != null && now > 0.01 ? ` · ${Math.round(now * 100)}%` : ''}</span><i /></div>}
        <OutputSwitch />
        <button type="button" className={s.navi} aria-current={page === 'settings' ? 'page' : undefined} onClick={() => go('settings')}><Icon n="settings" size={18} /><span>{tx('s.settings')}</span></button>
      </div>
    </nav>
  );
}
/** The audio output at hand: standard or Hi-Fi passthrough, one click (only where Hi-Fi is offered). */
function OutputSwitch() {
  const h = useStore(hifi), out = useStore(settings, x => x.audioOut);
  useEffect(() => { hifiRefresh(); }, []);
  if (!h.supported) return null;
  return <div className={s.out}><Seg size="sm" value={out === 'hifi' ? 'hifi' : 'standard'} label={tx('s.set.out')} onChange={v => setSettings({ audioOut: v as 'standard' | 'hifi' })}
    options={[['standard', tx('s.set.out.std')], ['hifi', tx('s.set.out.hifi')]]} /></div>;
}
export { keep };
