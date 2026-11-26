// The space interface: the music library as a cathedral to walk through (docs/SPACE.md). It is the second appearance
// half of the interface: it keeps the logic half (state, actions, playback, the bridge) exactly as the classic pages do.
// The scene reads the library and the song playing through bind.ts, and plays through it; the settings page is React,
// opened by the scene (the gear, the , key, the south chapel's sculptures).
import { useEffect, useRef, useState } from 'react';
import { boot } from '../actions/boot';
import { bindEditingKey } from '../editing';
import { ensureFont } from '../../engine';
import { createWorld } from './world';
import { createBind, isNight } from './bind';
import { hudHtml } from './hud';
import { SpaceSettings } from './SpaceSettings';
import { PlayerExtras, SpacePanel, WinButtons, type Panel } from './SpacePanels';
import { SpaceDetail, type Detail } from './SpaceDetail';
import { ContextMenu, Toast, usePresence } from '../ui/kit';
import { menuFor, setHost } from '../commands';
import { ModalHost, askText, editMeta } from '../ui/dialogs';
import { targetOf } from './targets';
import { MiniLyrics } from '../ui/MiniLyrics';
import { lang as langStore } from '../../i18n';
import { useStore, settings, ui, openMenu } from '../state';
import './space.css';
import s from './SpaceShell.module.css';

// every face the scene's textures and the HUD draw with, loaded before the first texture is drawn
const FACES: [string, string][] = [
  ['serif', '聖堂中殿全部歌曲歌單設定播放中清晨的光'],
  ['notosans', '聖堂中殿全部歌曲'],
  ['sansmed', '聖堂中殿全部歌曲清晨的光落在窗邊 Morning light'],
  ['tiempos', 'The Nave Crossing'],
];

export function SpaceShell() {
  const root = useRef<HTMLDivElement>(null),
    [ready, setReady] = useState(false),
    [cfg, setCfg] = useState<{ open: boolean; section?: string }>({ open: false }),
    [gen, setGen] = useState(0),
    [panel, setPanel] = useState<Panel>(null),
    [extra, setExtra] = useState<HTMLElement | null>(null),
    [detail, setDetail] = useState<Detail>(null),
    [winHost, setWinHost] = useState<HTMLElement | null>(null);
  const world = useRef<{ dispose(): void; takePointer(): void; closed(): void; pause(on: boolean): void } | null>(null);
  const lang = useStore(langStore, (x) => x.lang),
    lite = useStore(settings, (x) => x.gfx === 'lite'),
    // (dusk or midnight: the scene is built for one of them, and built again when it changes)
    [night, setNight] = useState(() => isNight(settings.get())),
    mini = useStore(ui, (x) => !!x.win.mini),
    away = useStore(ui, (x) => !!x.win.min);
  const cfgPresence = usePresence(cfg.open);
  const lastDetail = useRef(detail);
  if (detail) lastDetail.current = detail;
  const detailPresence = usePresence(!!detail);
  const tone = useStore(settings, (x) => x.tone);
  useEffect(() => {
    document.documentElement.dataset.theme = night ? 'dark' : 'light';
    document.documentElement.dataset.tone = tone === 'white' ? 'white' : 'paper';
  }, [night, tone]);
  useEffect(() => boot(() => setReady(true)), []);
  useEffect(bindEditingKey, []);
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)'),
      check = () => setNight(isNight(settings.get()));
    const off = settings.subscribe(check);
    mq.addEventListener('change', check);
    return () => {
      off();
      mq.removeEventListener('change', check);
    };
  }, []);
  useEffect(() => {
    if (!ready || !root.current) return;
    let gone = false;
    Promise.all(FACES.map(([k, t]) => ensureFont(k, t).catch(() => {}))).then(() => {
      if (gone) return;
      setExtra(document.getElementById('p-extra'));
      setWinHost(document.getElementById('win-btns'));
      world.current = createWorld(createBind(), {
        openSettings: (section) => {
          setPanel(null);
          setDetail(null);
          setCfg({ open: true, section });
        },
        show: (d) => {
          setDetail(d);
          if (d) {
            setPanel(null);
            setCfg((c) => (c.open ? { open: false } : c));
          }
        },
        closeSettings: () => setCfg((c) => (c.open ? { open: false } : c)),
        toggleSettings: () => {
          setPanel(null);
          setDetail(null);
          setCfg((c) => {
            if (!c.open) return { open: true };
            world.current?.takePointer();
            return { open: false };
          });
        },
        menu: (d, x, y) => {
          const t = targetOf(d);
          if (!t) return world.current?.takePointer();
          const at = { clientX: x, clientY: y, preventDefault() {}, stopPropagation() {} };
          openMenu(at, menuFor(t));
        },
        // a lost graphics context: a fresh canvas and scene a moment later (the HUD remounts with it)
        lost: () => setTimeout(() => setGen((g) => g + 1), 600),
      });
    });
    return () => {
      gone = true;
      world.current?.dispose();
      world.current = null;
    };
  }, [ready, lang, gen, night]);
  // (a menu closed: the view held again, if it was let out for the menu)
  const menuOpen = useStore(ui, (x) => !!x.menu),
    modalOpen = useStore(ui, (x) => !!x.modal);
  useEffect(() => {
    if (!menuOpen && !modalOpen) world.current?.takePointer();
  }, [menuOpen, modalOpen]);
  // (what the space can do for the library's commands: ask a name, open a song's information)
  useEffect(() => setHost({ ask: askText, editTags: editMeta }), []);
  useEffect(() => {
    document.getElementById('mini')?.setAttribute('aria-pressed', String(mini));
    world.current?.pause(mini || away);
  }, [mini, away, gen, lang, ready]);
  const close = () => {
    setCfg({ open: false });
    world.current?.takePointer();
  };
  return (
    <div
      className={`space-root ${s.space}${cfg.open ? ' space-cfg' : ''}${lite ? ' space-lite' : ''}${mini ? ' space-mini' : ''}`}
      data-test="space"
    >
      {/* a language change rebuilds the HUD and the scene's labels */}
      {ready && (
        <div
          key={lang + ':' + gen + ':' + night}
          ref={root}
          className={s.hud}
          dangerouslySetInnerHTML={{ __html: hudHtml() }}
        />
      )}
      {ready && cfgPresence.shown && (
        <SpaceSettings section={cfg.section} closing={cfgPresence.closing} onClose={close} />
      )}
      {ready && (
        <PlayerExtras
          host={extra}
          panel={panel}
          setPanel={(p) => {
            if (p) {
              setCfg({ open: false });
              setDetail(null);
            }
            setPanel(p);
          }}
        />
      )}
      {ready && detailPresence.shown && lastDetail.current && (
        <SpaceDetail
          detail={detail || lastDetail.current}
          closing={detailPresence.closing}
          onClose={() => {
            setDetail(null);
            world.current?.closed();
          }}
        />
      )}
      {ready && <ContextMenu />}
      {ready && <ModalHost />}
      {ready && <Toast />}
      {ready && <WinButtons host={winHost} />}
      {ready && mini && <MiniLyrics />}
      {ready && (
        <SpacePanel
          panel={cfg.open ? null : panel}
          onClose={() => {
            setPanel(null);
            world.current?.takePointer();
          }}
        />
      )}
    </div>
  );
}
