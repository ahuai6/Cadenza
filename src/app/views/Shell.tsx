// The desktop app, as a stage (docs/DESIGN.md): the playing song is the stage (the engine's picture and the play page);
// the library, the poster wall, the workshop and the settings are pages on one sheet of paper that rises over it; the
// player bar is the stage's apron, there in both; the title bar floats above everything with the places to go.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { tx, lang as langStore } from '../../i18n';
import { D } from '../bridge';
import { ui, lib, settings, useStore, keep, type Page } from '../state';
import { Icon } from '../ui/icons';
import { ContextMenu, Toast, Turn } from '../ui/kit';
import { player } from '../playback/player';
import { RHYTHM_VERSION } from '../../engine';
import mark from '../brand/mark.svg';
import { LibraryView } from './Library';
import { PosterWall } from './Wall';
import { SettingsView } from './Settings';
import { boot, bindKeys, go } from '../actions/boot';
import { PlayerCard, QueuePanel } from './Player';
import { Stage, NowPlaying } from './NowPlaying';
import { EffectView } from './Effect';
import { ModalHost, askText, editMeta, exportTrack } from './Modals';
import { WorkshopPage, sendToWorkshop } from './workshop/Workshop';
import { setHost } from '../commands';
import { Guard } from '../ui/Guard';
import { refs, openNp } from '../layers';
import { MiniLyrics } from '../ui/MiniLyrics';
import s from './Shell.module.css';

function resolveTheme(t: string) {
  return t === 'light' || t === 'dark' ? t : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
/** The playing song's colour, for the whole interface (tokens.css: --song-h, --song-c): the hue of its cover's leading
 *  colour, and how colourful it is. With no song: a warm grey. */
function useSongColour() {
  const session = useStore(player, (x) => x.session);
  const [h, c] = useMemo(() => {
    const A = session?.ambient,
      rgb = A ? A.cols[0] || A.base : null;
    if (!rgb) return [30, 0.25];
    const [r, g, b] = rgb.map((v: number) => v / 255),
      max = Math.max(r, g, b),
      min = Math.min(r, g, b),
      d = max - min;
    if (d < 0.02) return [30, 0.1];
    const hue = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4,
      sat = d / (1 - Math.abs(max + min - 1) || 1);
    return [Math.round(hue * 60), +Math.max(0.15, Math.min(1, sat * 1.3)).toFixed(2)];
  }, [session]);
  useLayoutEffect(() => {
    const r = document.documentElement.style;
    r.setProperty('--song-h', String(h));
    r.setProperty('--song-c', String(c));
  }, [h, c]);
}
function useTheme() {
  const t = useStore(settings, (x) => x.theme),
    tone = useStore(settings, (x) => x.tone);
  useLayoutEffect(() => {
    const apply = () => {
      const r = document.documentElement;
      r.dataset.theme = resolveTheme(t);
      r.dataset.tone = tone === 'white' ? 'white' : 'paper';
    };
    apply();
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [t, tone]);
}

export function Shell() {
  const page = useStore(ui, (x) => x.page),
    layer = useStore(ui, (x) => x.layer),
    modal = useStore(ui, (x) => !!x.modal),
    menu = useStore(ui, (x) => !!x.menu);
  const hasTrack = useStore(player, (x) => !!x.id),
    songId = useStore(player, (x) => x.shownId || x.id);
  const lng = useStore(langStore, (x) => x.lang);
  const [ready, setReady] = useState(false);
  const sheet = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    refs.sheet = sheet.current;
    return () => {
      refs.sheet = null;
    };
  });
  useTheme();
  useSongColour();
  // start (the settings, the library, the last song, the analysis) and the keys: actions/boot.ts
  useEffect(() => boot(() => setReady(true)), []);
  useEffect(bindKeys, []);
  // (what this interface can do for the library's commands: ask a name, open the tag editor, the export, the workshop)
  useEffect(
    () => setHost({ ask: askText, editTags: editMeta, exportVideo: exportTrack, toWorkshop: sendToWorkshop }),
    [],
  );
  // full screen over the picture: the window's buttons (leaving full screen) show only while the pointer moves, as the
  // play page's and the effect view's own controls do
  const full = useStore(ui, (x) => x.win.full),
    mini = useStore(ui, (x) => !!x.win.mini),
    [idle, setIdle] = useState(false);
  useEffect(() => {
    if (!full || layer === 'none') {
      setIdle(false);
      return;
    }
    let tm = 0;
    const wake = () => {
      setIdle(false);
      clearTimeout(tm);
      tm = window.setTimeout(() => setIdle(true), 2600);
    };
    const evs = ['pointermove', 'pointerdown', 'keydown', 'wheel'] as const;
    evs.forEach((e) => addEventListener(e, wake, { passive: true }));
    wake();
    return () => {
      clearTimeout(tm);
      evs.forEach((e) => removeEventListener(e, wake));
    };
  }, [full, layer]);

  if (!ready) return <div className={s.boot} />;
  const top = modal ? 'modal' : menu ? 'menu' : layer;
  return (
    // a language change rebuilds the interface (every label is read again)
    <div
      key={lng}
      className={s.shell}
      data-page={page}
      data-layer={layer}
      data-top={top}
      data-idle={idle || undefined}
      data-mini={mini || undefined}
      data-card={(page !== 'workshop' && hasTrack) || undefined}
    >
      <TitleBar />
      {/* the sheet: one page of it at a time. It rises over the stage and sinks away (layers.ts moves it) */}
      <main
        data-scroll
        data-test="sheet"
        className={s.page}
        ref={sheet}
        aria-hidden={layer !== 'none'}
        inert={layer !== 'none'}
      >
        {/* a page turns: the old one fades out, the new one rises in */}
        <Turn k={page} className={s.pageInner}>
          <Guard name="page" k={page}>
            {page === 'library' && <LibraryView />}
            {page === 'wall' && <PosterWall />}
            {page === 'settings' && <SettingsView />}
            {page === 'workshop' && <WorkshopPage />}
          </Guard>
        </Turn>
      </main>
      {/* (each large part in a Guard: one failing shows nothing of itself until the next song — never a white window) */}
      {page !== 'workshop' && hasTrack && (
        <Guard name="player bar" k={songId}>
          <PlayerCard />
        </Guard>
      )}
      <Stage />
      {hasTrack && (
        <Guard name="now playing" k={songId}>
          <NowPlaying />
        </Guard>
      )}
      {hasTrack && (
        <Guard name="effect lyrics" k={songId}>
          <EffectView />
        </Guard>
      )}
      <Guard name="queue" k={songId}>
        <QueuePanel />
      </Guard>
      <ModalHost />
      {mini && <MiniLyrics />}
      <ContextMenu />
      <Toast />
    </div>
  );
}

/** The places to go, in the middle of the title bar: the song playing, and the pages of the sheet. */
const NAV: [Page, string][] = [
  ['library', 's.library'],
  ['wall', 's.wall'],
  ['workshop', 's.workshop'],
];
function TitleBar() {
  const st = useStore(ui, (x) => x.win),
    page = useStore(ui, (x) => x.page),
    layer = useStore(ui, (x) => x.layer),
    hasTrack = useStore(player, (x) => !!x.shownId);
  const onStage = layer !== 'none';
  return (
    <header
      data-test="titlebar"
      className={s.tb}
      onDoubleClick={(e) => {
        if (!(e.target as HTMLElement).closest('button,input')) D?.win('max');
      }}
    >
      <div className={s.brand}>
        <img src={mark} alt="" />
        <span className="display">Cadenza</span>
      </div>
      <nav className={s.places} aria-label="Cadenza" data-test="places">
        <button type="button" aria-current={onStage ? 'page' : undefined} disabled={!hasTrack} onClick={openNp}>
          {tx('s.nowPlaying')}
        </button>
        {NAV.map(([k, label]) => (
          <button
            key={k}
            type="button"
            data-page={k}
            aria-current={!onStage && page === k ? 'page' : undefined}
            onClick={() => (ui.get().page === k ? ui.set({ layer: 'none', queue: false }) : go(k))}
          >
            {tx(label)}
          </button>
        ))}
      </nav>
      <div className={s.tbEnd}>
        <Activity />
        <button
          type="button"
          className={s.round}
          data-page="settings"
          aria-current={!onStage && page === 'settings' ? 'page' : undefined}
          title={tx('s.settings')}
          aria-label={tx('s.settings')}
          onClick={() => (ui.get().page === 'settings' ? ui.set({ layer: 'none', queue: false }) : go('settings'))}
        >
          <Icon n="settings" size={18} />
        </button>
        <div className={s.winbtns}>
          {/* the small window on top: the app stays in the foreground (Windows throttles a background app's Bluetooth audio) */}
          <button
            type="button"
            aria-pressed={!!st.mini}
            title={tx(st.mini ? 's.unmini' : 's.mini')}
            aria-label={tx(st.mini ? 's.unmini' : 's.mini')}
            onClick={() => D?.win('mini')}
          >
            <Icon n="pip" size={16} />
          </button>
          <button
            type="button"
            title={tx(st.full ? 's.unfullscreen' : 's.fullscreen')}
            aria-label={tx(st.full ? 's.unfullscreen' : 's.fullscreen')}
            onClick={() => D?.win('full')}
          >
            <Icon n={st.full ? 'unfull' : 'full'} size={16} />
          </button>
          {!st.full && (
            <>
              <button type="button" title={tx('s.min')} aria-label={tx('s.min')} onClick={() => D?.win('min')}>
                <Icon n="min" size={16} />
              </button>
              <button
                type="button"
                title={tx(st.max ? 's.restore' : 's.max')}
                aria-label={tx(st.max ? 's.restore' : 's.max')}
                onClick={() => D?.win('max')}
              >
                <Icon n={st.max ? 'restore' : 'max'} size={15} />
              </button>
              <button
                type="button"
                data-close
                title={tx('s.quit')}
                aria-label={tx('s.quit')}
                onClick={() => D?.win('close')}
              >
                <Icon n="close" size={16} />
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

/** Work going on in the background (reading the folders, reading the songs' rhythm): a quiet mark beside the settings,
 *  which says what it is when asked (hover, focus). Nothing when there is none. */
function Activity() {
  const prog = useStore(lib, (x) => x.progress),
    tracks = useStore(lib, (x) => x.tracks),
    an = useStore(lib, (x) => x.analysis);
  let done = 0,
    total = 0;
  // (without a progress event yet: the songs read by this version of the rhythm analysis — an older one is to be redone)
  if (an) {
    done = an.done;
    total = an.total;
  } else {
    const playable = tracks.filter((t) => !t.protected);
    total = playable.length;
    done = playable.filter((t) => t.analyzed === RHYTHM_VERSION).length;
  }
  const text = prog.phase === 'scan' ? tx('s.scanning', prog) : done < total ? tx('s.analyzing', { done, total }) : '';
  if (!text) return null;
  return (
    <span className={s.busy} role="status" title={text} aria-label={text} data-test="activity">
      <i />
    </span>
  );
}
export { keep };
