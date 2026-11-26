// The library and the listening dock share a book. The dock opens into the full lyric spread without moving the page.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { tx, lang as langStore } from '../../i18n';
import { D } from '../bridge';
import { ui, lib, settings, useStore, trackOf, keep, type Page } from '../state';
import { Icon } from '../ui/icons';
import { ContextMenu, Cover, Toast, Turn } from '../ui/kit';
import { player } from '../playback/player';
import { BackgroundActivity } from '../ui/BackgroundActivity';
import mark from '../brand/mark.svg';
import { LibraryView } from './Library';
import { PosterWall } from './Wall';
import { SettingsView } from './Settings';
import { boot, bindKeys, go } from '../actions/boot';
import { ListeningDock, PlayerCard, QueuePanel } from './Player';
import { Stage, NowPlaying } from './NowPlaying';
import { EffectView } from './Effect';
import { ModalHost, askText, editMeta, exportTrack } from './Modals';
import { WorkshopPage, sendToWorkshop } from './workshop/Workshop';
import { setHost } from '../commands';
import { Guard } from '../ui/Guard';
import { back, openNp, refs, refreshSpread } from '../layers';
import { MiniLyrics } from '../ui/MiniLyrics';
import { EditModeButton, MusicHallButton } from '../ui/EditModeButton';
import s from './Shell.module.css';

function resolveTheme(t: string) {
  return t === 'light' || t === 'dark' ? t : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
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
  useTheme();
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
    idle = useStore(ui, (x) => x.idle);
  useEffect(() => {
    const setIdle = (v: boolean) => ui.get().idle !== v && ui.set({ idle: v });
    if (!full || layer === 'none') {
      setIdle(false);
      return;
    }
    let tm = 0;
    const wake = () => {
      setIdle(false);
      clearTimeout(tm);
      // (not while something has the keyboard's focus or a menu is open: what is being used stays)
      tm = window.setTimeout(() => {
        if (!document.querySelector(':focus-visible, [aria-expanded="true"]')) setIdle(true);
      }, 2600);
    };
    const evs = ['pointermove', 'pointerdown', 'keydown', 'wheel'] as const;
    evs.forEach((e) => addEventListener(e, wake, { passive: true }));
    wake();
    return () => {
      clearTimeout(tm);
      evs.forEach((e) => removeEventListener(e, wake));
      setIdle(false);
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
      <ChapterWash />
      <TitleBar />
      <main data-scroll data-test="sheet" className={s.page} aria-hidden={layer !== 'none'} inert={layer !== 'none'}>
        {/* a page turns: the old one fades out, the new one rises in */}
        <Turn k={page} className={s.pageInner} boxClassName={s.pageBox}>
          <Guard name="page" k={page}>
            {page === 'library' && <LibraryView />}
            {page === 'wall' && <PosterWall />}
            {page === 'settings' && <SettingsView />}
            {page === 'workshop' && <WorkshopPage />}
          </Guard>
        </Turn>
      </main>
      {page !== 'workshop' && hasTrack && <ListeningDock />}
      {/* (each large part in a Guard: one failing shows nothing of itself until the next song — never a white window) */}
      {hasTrack && (
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

/** The cover's tint belongs to the window surface, so the title bar and scroller see the same light. */
function ChapterWash() {
  const album = useStore(ui, (x) => (x.page === 'library' && x.detail?.kind === 'album' ? x.detail.key : null));
  const cover = useStore(
    lib,
    (x) => album !== null && x.tracks.find((t) => t.cover && (t.album || '').trim().toLowerCase() === album)?.cover,
  );
  return (
    <div className={s.ambience} aria-hidden="true">
      <Turn k={cover || ''} className={s.ambienceLayer} boxClassName={s.ambienceLayer}>
        {cover && <Cover k={cover} className={s.wash} eager />}
      </Turn>
    </div>
  );
}

/** The places to go, in the middle of the title bar: the song playing, and the pages of the sheet. */
const NAV: [Page, string][] = [
  ['library', 's.library'],
  ['wall', 's.wall'],
  ['workshop', 's.workshop'],
];
let beforeSettings: Page = 'library';
function TitleBar() {
  const bar = useRef<HTMLElement>(null);
  const st = useStore(ui, (x) => x.win),
    page = useStore(ui, (x) => x.page),
    layer = useStore(ui, (x) => x.layer),
    song = useStore(player, (x) => x.shownId || x.id),
    hasTrack = useStore(lib, () => !!trackOf(song));
  const onStage = layer !== 'none';
  useLayoutEffect(() => {
    refs.titlebar = bar.current;
    refreshSpread();
    return () => {
      refs.titlebar = null;
    };
  }, []);
  return (
    <header
      data-test="titlebar"
      ref={bar}
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
        {NAV.map(([k, label]) => (
          <button
            key={k}
            type="button"
            data-page={k}
            aria-current={page === k ? 'page' : undefined}
            onClick={() => (ui.get().page === k ? ui.set({ layer: 'none', queue: false }) : go(k))}
          >
            {tx(label)}
          </button>
        ))}
      </nav>
      <div className={s.tbEnd}>
        <BackgroundActivity className={s.busy} />
        <MusicHallButton className={s.hallEntry} />
        <EditModeButton className={s.modeEntry} />
        <button
          type="button"
          className={s.spreadAction}
          disabled={!hasTrack}
          aria-label={tx(onStage ? 's.collapse' : 's.expand')}
          onClick={onStage ? back : openNp}
        >
          <span aria-hidden="true" data-hidden={onStage || undefined}>
            {tx('s.expand')}
          </span>
          <span aria-hidden="true" data-hidden={!onStage || undefined}>
            {tx('s.collapse')}
          </span>
        </button>
        <button
          type="button"
          className={s.round}
          data-page="settings"
          aria-current={page === 'settings' ? 'page' : undefined}
          title={tx('s.settings')}
          aria-label={tx('s.settings')}
          onClick={() => {
            const u = ui.get();
            // (the settings are opened by this button, and closed by it: back to the page they were opened over)
            if (u.page === 'settings' && u.layer === 'none') go(beforeSettings);
            else if (u.page === 'settings') ui.set({ layer: 'none', queue: false });
            else {
              beforeSettings = u.page;
              go('settings');
            }
          }}
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

export { keep };
