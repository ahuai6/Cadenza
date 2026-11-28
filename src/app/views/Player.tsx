// The player controls (progress, transport, volume, the Hi-Fi badge), the floating player card, and the queue panel,
// which opens from the card, the now-playing page and the effect view alike.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { tx } from '../../i18n';
import { D, Lib } from '../bridge';
import { ui, lib, settings, useStore, useIndex, fmtTime, trackOf } from '../state';
import { Icon } from '../ui/icons';
import { Button, IconButton, Seg, Cover, Swap, kit, usePresence } from '../ui/kit';
import { LiveEq } from '../ui/LiveEq';
import { useReorder } from '../ui/reorder';
import { engine } from '../playback/stage';
import {
  player,
  toggle,
  next,
  prev,
  setMode,
  setVolume,
  seekBy,
  seekFile,
  playback,
  MODES,
  MODE_ICON,
  playQueueAt,
  removeFromQueue,
  reorderQueue,
  clearQueue,
  type Mode,
} from '../playback/player';
import { hifi, describe, refresh as hifiRefresh } from '../playback/hifi';
import { setSettings } from '../actions/settings';
import { refs, openNp, npProgress } from '../layers';
import { Marquee } from '../ui/Marquee';
import { NpLyrics } from '../ui/NpLyrics';
import s from './Player.module.css';

/* ---------- progress: written straight to the DOM on every tick ---------- */
const txt = (el: HTMLElement | null, attr: string, v: string) => {
  if (!el) return;
  if (attr) {
    if (el.getAttribute(attr) !== v) el.setAttribute(attr, v);
  } else if (el.textContent !== v) el.textContent = v;
};
export function Progress({ className = '', times = true }: { className?: string; times?: boolean }) {
  const bar = useRef<HTMLDivElement>(null),
    cur = useRef<HTMLSpanElement>(null),
    tot = useRef<HTMLSpanElement>(null),
    drag = useRef(false);
  const end = () => player.get().duration || 0.01;
  useEffect(() => {
    const paint = (t: number) => {
      const d = end(),
        k = Math.min(1, Math.max(0, t / d));
      bar.current?.style.setProperty('--k', k.toFixed(5));
      txt(bar.current, 'aria-valuenow', String(Math.round(t)));
      // (the ending after the music is not counted: the time stops at the song's length)
      // (the times written only when they change — once a second —: a text written anew each frame is a layout each frame)
      txt(cur.current, '', fmtTime(Math.min(t, d)));
      txt(tot.current, '', fmtTime(d));
    };
    paint(playback.time());
    const a = engine.on('tick', () => paint(playback.time())),
      b = player.subscribe((x, y) => {
        if (x.duration !== y.duration || x.phase !== y.phase || x.id !== y.id) paint(playback.time());
      });
    return () => {
      a();
      b();
    };
  }, []);
  const at = (e: React.PointerEvent) => {
    const r = bar.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * end();
  };
  return (
    <div className={s.prog + ' ' + className} data-times={times}>
      {times && (
        <span className={s.pt} ref={cur}>
          0:00
        </span>
      )}
      <div
        className={s.bar}
        ref={bar}
        data-test="progress"
        role="slider"
        aria-label={tx('s.nowPlaying')}
        aria-valuemin={0}
        tabIndex={0}
        onPointerDown={(e) => {
          drag.current = true;
          bar.current!.dataset.drag = 'true';
          e.currentTarget.setPointerCapture(e.pointerId);
          seekFile(at(e), true);
        }}
        onPointerMove={(e) => {
          if (drag.current) seekFile(at(e), true);
        }}
        onPointerUp={(e) => {
          if (drag.current) {
            drag.current = false;
            bar.current!.dataset.drag = '';
            seekFile(at(e), false);
          }
        }}
        onPointerCancel={() => {
          drag.current = false;
          bar.current!.dataset.drag = '';
          seekFile(playback.time(), false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') {
            e.stopPropagation();
            seekBy(5);
          } else if (e.key === 'ArrowLeft') {
            e.stopPropagation();
            seekBy(-5);
          }
        }}
      >
        <i className={s.fill} />
        <i className={s.head} />
      </div>
      {times && (
        <span className={s.pt} ref={tot}>
          0:00
        </span>
      )}
    </div>
  );
}

export function Transport({ big }: { big?: boolean }) {
  const playing = useStore(player, (x) => x.intent),
    loading = useStore(player, (x) => x.loading);
  return (
    <div className={s.trans} data-test="transport" data-big={big || undefined}>
      <IconButton
        n="prev"
        label={tx('s.prev')}
        size={big ? 'lg' : undefined}
        iconSize={big ? 22 : 18}
        onClick={() => prev()}
      />
      <IconButton
        n={playing ? 'pause' : 'play'}
        label={tx(playing ? 's.pause' : 's.play')}
        solid
        size={big ? 'xl' : 'lg'}
        iconSize={big ? 28 : 20}
        className={s.playb}
        data-loading={loading}
        onClick={() => toggle()}
      />
      <IconButton
        n="next"
        label={tx('s.next')}
        size={big ? 'lg' : undefined}
        iconSize={big ? 22 : 18}
        onClick={() => next()}
      />
    </div>
  );
}
/** The desktop lyrics on and off (electron/desk.cjs); the same setting as Settings → Desktop lyrics. */
export function DeskButton() {
  const on = useStore(settings, (x) => !!x.deskLyrics);
  if (!D?.deskFeed) return null;
  return (
    <IconButton n="lyrics" label={tx('s.desk')} pressed={on} onClick={() => void setSettings({ deskLyrics: !on })} />
  );
}
/** How the queue moves on; one click steps to the next mode. */
export function ModeButton() {
  const mode = useStore(player, (x) => x.mode);
  return (
    <IconButton
      n={MODE_ICON[mode]}
      label={tx('s.mode.' + mode)}
      pressed={mode !== 'stop'}
      onClick={() => setMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length])}
    />
  );
}
export function Volume() {
  const v = useStore(player, (x) => x.volume),
    route = useStore(player, (x) => x.route),
    fixedVol = useStore(settings, (x) => x.fixedVolume);
  // bit-perfect output: the volume belongs to the DAC or the amplifier
  if (route === 'hifi' && fixedVol !== false)
    return (
      <span className={s.volFixed} title={tx('s.volFixed')}>
        <Icon n="volume" size={17} />
        DAC
      </span>
    );
  return (
    <label className={s.vol} title={tx('s.volume')}>
      <Icon n={v > 0 ? 'volume' : 'mute'} size={17} />
      <input
        type="range"
        className={kit.range}
        min="0"
        max="1"
        step="0.01"
        value={v}
        style={{ ['--p' as string]: `${v * 100}%` }}
        onChange={(e) => setVolume(+e.target.value)}
        aria-label={tx('s.volume')}
      />
    </label>
  );
}
/** Hi-Fi passthrough on or off in one press (the same setting as Settings → Audio → Output). Only where it exists. */
export function HifiSwitch({ className = '', hidden }: { className?: string; hidden?: boolean }) {
  const h = useStore(hifi),
    on = useStore(settings, (x) => x.audioOut === 'hifi');
  useEffect(() => {
    hifiRefresh();
  }, []);
  if (!h.supported) return null;
  return (
    <button
      type="button"
      className={`${s.hifiSw} ${className}`}
      aria-pressed={on}
      aria-hidden={hidden || undefined}
      tabIndex={hidden ? -1 : 0}
      title={tx('s.set.out.hifi')}
      data-test="hifi-switch"
      onClick={() => setSettings({ audioOut: on ? 'standard' : 'hifi' })}
    >
      <i aria-hidden="true" />
      Hi-Fi
    </button>
  );
}
/** What is playing and what reaches the DAC: "FLAC 24/96 → 96 kHz / 24 bit · Bit-perfect". */
export function HifiBadge() {
  const h = useStore(hifi),
    route = useStore(player, (x) => x.route);
  useStore(settings, (x) => x.fixedVolume);
  if (route !== 'hifi') return null;
  const d = describe(h);
  if (!d) return null;
  return (
    <div className={s.hifi} data-k={d.bitperfect ? 'bp' : d.exclusive ? 'ex' : 'sh'}>
      <span>{d.src}</span>
      <span aria-hidden="true">→</span>
      <span>{d.out}</span>
      <em>{tx(d.bitperfect ? 's.hifi.bitperfect' : d.exclusive ? 's.hifi.exclusive' : 's.hifi.shared')}</em>
      {d.resample && <em>{tx('s.hifi.resampled')}</em>}
    </div>
  );
}
export function Heart({ id, size }: { id: string; size?: 'sm' | 'lg' }) {
  const on = useStore(lib, (x) => x.favorites.includes(id));
  return (
    <IconButton
      n="heart"
      size={size}
      filled={on}
      on={on}
      data-fav=""
      label={tx(on ? 's.unfav' : 's.fav')}
      onClick={() => Lib!.favorite(id, !on)}
    />
  );
}
export function QueueButton({ glass }: { glass?: boolean }) {
  const open = useStore(ui, (x) => x.queue),
    n = useStore(player, (x) => x.queue.length);
  return (
    <IconButton
      n="queue"
      glass={glass}
      label={tx('s.queue')}
      pressed={open}
      aria-expanded={open}
      count={n}
      data-queue-button
      onClick={(e) => toggleQueue(e.currentTarget as HTMLElement)}
    />
  );
}
/** Open or close the queue, anchored at the control that asked for it. */
export function toggleQueue(at: HTMLElement) {
  queueAnchor = at;
  ui.set({ queue: !ui.get().queue });
}
let queueAnchor: HTMLElement | null = null;

/** The dock and spread use the same transport and song model. Its artwork is the origin of the shared move. */
export function ListeningDock() {
  const shownId = useStore(player, (x) => x.shownId || x.id),
    dir = useStore(player, (x) => x.dir),
    expanded = useStore(ui, (x) => x.layer !== 'none');
  useStore(lib, (x) => x.tracks);
  const track = trackOf(shownId),
    dock = useRef<HTMLElement>(null),
    artwork = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    refs.dock = dock.current;
    refs.dockCover = artwork.current;
    return () => {
      refs.dock = null;
      refs.dockCover = null;
    };
  }, [track?.id]);
  if (!track) return null;
  return (
    <aside className={s.dock} ref={dock} inert={expanded} aria-label={tx('s.nowPlaying')} data-test="listening-dock">
      <div className={s.dockContent}>
        <header className={s.dockHead}>
          <b>{tx('s.nowPlaying')}</b>
          <IconButton n="chevronLeft" label={tx('s.expand')} onClick={openNp} />
        </header>
        <button type="button" className={s.dockArtwork} aria-label={tx('s.expand')} onClick={openNp}>
          <span ref={artwork} data-test="dock-cover">
            <Swap k={track.cover || ''} dir={dir} fill>
              <Cover k={track.cover} full eager />
            </Swap>
          </span>
        </button>
        <div className={s.dockBody}>
          <div className={s.dockMeta}>
            <div>
              <Marquee className={s.dockTitle}>{track.title}</Marquee>
              <Marquee className={s.dockByline}>
                {[track.artist || tx('s.unknownArtist'), track.album].filter(Boolean).join(' · ')}
              </Marquee>
            </div>
            <Heart id={track.id} />
          </div>
          <Progress />
          <div className={s.dockTransport}>
            <ModeButton />
            <Transport big />
            <QueueButton />
          </div>
          <div className={s.dockExtras}>
            <Volume />
            <DeskButton />
            <HifiSwitch />
          </div>
          <DockLyrics live={!expanded} />
        </div>
        <Button className={s.compactExpand} kind="ghost" icon="lyrics" onClick={openNp}>
          {tx('s.expand')}
        </Button>
      </div>
    </aside>
  );
}

/* ---------- the spread's transport ---------- */
export function PlayerCard() {
  const id = useStore(player, (x) => x.id),
    onStage = useStore(ui, (x) => x.layer === 'np'),
    // (full screen on the play page, the pointer still: the bar rests out of sight with the page's own controls)
    idle = useStore(ui, (x) => x.idle && x.layer === 'np');
  useStore(lib, (x) => x.tracks);
  const t = trackOf(id),
    card = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    refs.card = card.current;
    // (a bar made while the stage is up — a new song — starts in the stage's colours; layers.ts keeps it so)
    if (card.current) {
      card.current.style.setProperty('--stage', npProgress().toFixed(3));
    }
    return () => {
      refs.card = null;
    };
  });
  if (!t) return null;
  return (
    <div className={s.card + ' on-picture'} ref={card} data-test="card" data-idle={idle || undefined} inert={!onStage}>
      <Progress className={s.line} />
      <div className={s.row}>
        <div className={s.spreadLeft}>
          <HifiSwitch />
        </div>
        <div className={s.center}>
          <ModeButton />
          <Transport />
          <span className={s.even} aria-hidden="true" />
        </div>
        <div className={s.right}>
          <div className={s.end}>
            <Volume />
            <DeskButton />
            <QueueButton />
            <Heart id={t.id} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** The reading page's lyrics, fitted to the listening dock's available width. */
function DockLyrics({ live }: { live: boolean }) {
  const session = useStore(player, (x) => x.session),
    has = useStore(player, (x) => x.hasLyrics);
  if (!has || !session?.doc.lines.length) return null;
  return (
    <div className={s.dockLyrics} aria-live="off" data-test="bar-lyric">
      <NpLyrics lines={session.doc.lines} live={live} layout="dock" song={session.showing} />
    </div>
  );
}

/* ---------- the queue ---------- */
export function QueuePanel() {
  const open = useStore(ui, (x) => x.queue),
    hasSong = useStore(player, (x) => !!x.id);
  const presence = usePresence(open && hasSong);
  const box = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (box.current && !box.current.contains(t) && !t.closest('[data-queue-button]') && !t.closest('[role="menu"]'))
        ui.set({ queue: false });
    };
    addEventListener('pointerdown', away, true);
    return () => removeEventListener('pointerdown', away, true);
  }, [open]);
  if (!presence.shown) return null;
  return <QueueBody box={box} closing={presence.closing} />;
}
function QueueBody({ box, closing }: { box: React.MutableRefObject<HTMLElement | null>; closing: boolean }) {
  const p = useStore(player),
    idx = useIndex(),
    [pos, setPos] = useState<React.CSSProperties | null>(null);
  const pict = useStore(ui, (x) => x.layer !== 'none'); // (over the picture: the dark glass of the play page)
  const items = useMemo(
    () => p.queue.map((id, i) => ({ key: p.queueKeys[i], t: idx.byId.get(id) })),
    [p.queue, p.queueKeys, idx],
  );
  const { shown, down, listProps } = useReorder(items, (list) => reorderQueue(list.map((x) => x.key)), {
    scroller: '[data-qlist]',
    ignore: '[data-x]',
  });
  // Anchor to the current trigger and size the scrollable panel to the space on that side.
  useLayoutEffect(() => {
    const place = () => {
      const a = queueAnchor?.isConnected ? queueAnchor.getBoundingClientRect() : null;
      const top = Math.max(12, (refs.titlebar?.getBoundingClientRect().bottom ?? 0) + 12);
      if (!a) {
        setPos({ right: 12, top, maxHeight: innerHeight - top - 12 });
        return;
      }
      const right = `clamp(12px, ${innerWidth - a.right}px, calc(100vw - var(--queue-width) - 12px))`,
        triggerTop = Math.min(a.top, innerHeight - 12),
        triggerBottom = Math.max(a.bottom, top - 10),
        above = triggerTop - top - 10,
        below = innerHeight - triggerBottom - 22,
        openAbove = above >= below;
      setPos(
        openAbove
          ? { right, bottom: innerHeight - triggerTop + 10, maxHeight: Math.min(620, above) }
          : { right, top: triggerBottom + 10, maxHeight: Math.min(620, below) },
      );
    };
    const onScroll = (e: Event) => {
      if (e.target instanceof Element && queueAnchor && e.target.contains(queueAnchor)) place();
    };
    place();
    addEventListener('resize', place);
    addEventListener('scroll', onScroll, true);
    return () => {
      removeEventListener('resize', place);
      removeEventListener('scroll', onScroll, true);
    };
  }, []);
  useEffect(() => {
    const el = box.current?.querySelector('[data-cur="true"]');
    if (el) el.scrollIntoView({ block: 'center' });
  }, []);
  const cur = shown.findIndex((x) => x.key === p.queueKeys[p.index]),
    rest = Math.max(0, shown.length - 1 - cur);
  return (
    <section
      data-test="queue"
      className={s.queue + ' glass' + (pict ? ' on-picture' : '')}
      data-presence=""
      data-closing={closing || undefined}
      inert={closing}
      ref={(el) => {
        box.current = el;
      }}
      style={pos || { visibility: 'hidden' }}
      aria-label={tx('s.queue')}
    >
      <header className={s.qhead}>
        <div>
          <b>{tx('s.queue')}</b>
          <small>{tx('s.queue.count', { n: items.length, rest })}</small>
        </div>
        <button
          type="button"
          className="muted"
          disabled={items.length < 2}
          onClick={() => clearQueue()}
          style={{ fontSize: 12.5, fontWeight: 600 }}
        >
          {tx('s.queue.clear')}
        </button>
      </header>
      {/* the modes as icons on one line; the chosen one is named below (labels never wrap or squeeze) */}
      <div className={s.qmodes}>
        <Seg
          size="sm"
          value={p.mode}
          label={tx('s.mode')}
          onChange={(m: Mode) => setMode(m)}
          options={MODES.map((m) => [m, '', MODE_ICON[m], tx('s.mode.' + m)])}
        />
        <small className={s.qmode}>
          <b>{tx('s.mode.' + p.mode)}</b> · {tx('s.mode.' + p.mode + '.help')}
        </small>
      </div>
      <div className={s.qlist} role="list" data-qlist {...listProps}>
        {shown.map((x, k) => {
          if (!x.t) return null;
          const i = p.queueKeys.indexOf(x.key),
            isCur = i === p.index;
          return (
            <div
              key={x.key}
              role="listitem"
              className={s.qrow}
              data-cur={isCur}
              onPointerDown={(e) => down(e, k)}
              onDoubleClick={() => playQueueAt(i)}
            >
              <span className={s.qgrip} aria-hidden="true">
                <Icon n="grip" size={14} />
              </span>
              <span className={s.qcover} onClick={() => playQueueAt(i)}>
                <Cover k={x.t!.cover} />
                {isCur && p.playing && (
                  <span className={s.qeq}>
                    <LiveEq />
                  </span>
                )}
              </span>
              <span className={s.qtext} onClick={() => playQueueAt(i)}>
                <b>{x.t!.title}</b>
                <small>{x.t!.artist || tx('s.unknownArtist')}</small>
              </span>
              <span className={s.qtime}>{fmtTime(x.t!.duration)}</span>
              {isCur ? (
                <span />
              ) : (
                <IconButton
                  n="close"
                  size="sm"
                  iconSize={14}
                  className={s.qx}
                  data-x
                  label={tx('s.queue.remove')}
                  onClick={() => removeFromQueue(i)}
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
