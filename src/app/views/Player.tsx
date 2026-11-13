// The player controls (progress, transport, volume, the Hi-Fi badge), the floating player card, and the queue panel,
// which opens from the card, the now-playing page and the effect view alike.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { tx } from '../../i18n';
import { Lib } from '../bridge';
import { ui, lib, settings, useStore, useIndex, fmtTime, trackOf } from '../state';
import { Icon } from '../ui/icons';
import { IconButton, Seg, Cover, Swap, kit } from '../ui/kit';
import { LiveEq } from '../ui/LiveEq';
import { useReorder } from '../ui/reorder';
import { Drive } from '../motion';
import { engine } from '../playback/stage';
import {
  player,
  toggle,
  next,
  prev,
  setMode,
  setVolume,
  seekBy,
  MODES,
  MODE_ICON,
  playQueueAt,
  removeFromQueue,
  reorderQueue,
  clearQueue,
  type Mode,
} from '../playback/player';
import { hifi, describe } from '../playback/hifi';
import { refs, openNp, npProgress } from '../layers';
import { splitBrackets } from '../../engine';
import { Marquee } from '../ui/Marquee';
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
  const end = () => player.get().session?.musicEnd || 0.01;
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
    paint(engine.time);
    const a = engine.on('tick', (p) => paint(p.t)),
      b = player.subscribe((x, y) => {
        if (x.session !== y.session) paint(engine.time);
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
          engine.seek(at(e), true);
        }}
        onPointerMove={(e) => {
          if (drag.current) engine.seek(at(e), true);
        }}
        onPointerUp={(e) => {
          if (drag.current) {
            drag.current = false;
            bar.current!.dataset.drag = '';
            engine.seek(at(e), false);
          }
        }}
        onPointerCancel={() => {
          drag.current = false;
          bar.current!.dataset.drag = '';
          engine.seek(engine.time, false);
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
  const playing = useStore(player, (x) => x.playing),
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
  queueAnchor = at.getBoundingClientRect();
  ui.set({ queue: !ui.get().queue });
}
let queueAnchor: DOMRect | null = null;

/* ---------- the card at the bottom ---------- */
export function PlayerCard() {
  const id = useStore(player, (x) => x.id),
    dir = useStore(player, (x) => x.dir),
    onStage = useStore(ui, (x) => x.layer !== 'none');
  useStore(lib, (x) => x.tracks);
  const t = trackOf(id),
    card = useRef<HTMLDivElement>(null),
    mini = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    refs.card = card.current;
    refs.mini = mini.current;
    // (a bar made while the stage is up — a new song — starts in the stage's colours; layers.ts keeps it so)
    if (card.current) {
      card.current.dataset.onPicture = String(npProgress() > 0.5);
      card.current.style.setProperty('--stage', npProgress().toFixed(3));
    }
    return () => {
      refs.card = null;
      refs.mini = null;
    };
  });
  if (!t) return null;
  return (
    // the stage's apron: the same bar under the stage and under the sheet. Over the stage it is clear and leaves the song
    // to the stage (its cover, title and sung line fade: --stage, set by layers.ts); over the sheet it carries them
    // (its colours turn to the stage's half way through the move, with its ground: layers.ts sets data-on-picture)
    <div className={s.card} ref={card} data-test="card" data-stage={onStage}>
      <Progress className={s.line} />
      <div className={s.row}>
        <div className={s.id}>
          <button
            type="button"
            className={s.miniBtn}
            title={tx('s.expand')}
            aria-label={tx('s.expand')}
            tabIndex={onStage ? -1 : 0}
            onClick={openNp}
          >
            <span ref={mini} className={s.mini}>
              <Swap k={t.cover || ''} dir={dir} fill>
                <Cover k={t.cover} className={s.mini} />
              </Swap>
            </span>
          </button>
          <Swap k={t.id} dir={dir}>
            <span className={s.text} data-test="bar-text">
              <Marquee className={s.tTitle}>{t.title}</Marquee>
              <Marquee className={s.tArtist}>{t.artist || tx('s.unknownArtist')}</Marquee>
            </span>
          </Swap>
        </div>
        <div className={s.center}>
          <ModeButton />
          <Transport />
          <span className={s.even} aria-hidden="true" />
        </div>
        <div className={s.right}>
          <BarLyric />
          <div className={s.end}>
            <Volume />
            <QueueButton />
            <Heart id={t.id} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** The line being sung, in the bar: its own words only (no harmony, translation or reading). A new line comes in as the
 *  last goes (a short cross-fade, rising a little); one that fits stands centred in its room, one too long starts at the
 *  left and scrolls to its end and back in stages (Marquee). Nothing when the song has no words. */
function BarLyric() {
  const session = useStore(player, (x) => x.session),
    has = useStore(player, (x) => x.hasLyrics),
    [i, setI] = useState(-1);
  const lines = has && session ? session.doc.lines : null;
  useEffect(() => {
    if (!lines?.length) {
      setI(-1);
      return;
    }
    const find = (t: number) => {
      let lo = 0,
        hi = lines.length - 1,
        r = -1;
      while (lo <= hi) {
        const m = (lo + hi) >> 1;
        if (lines[m].t - 0.15 <= t) {
          r = m;
          lo = m + 1;
        } else hi = m - 1;
      }
      return r;
    };
    // (a line is shown from its start until the next begins — or, after a long rest, until it has been sung)
    const at = (t: number) => {
      const k = find(t),
        L = lines[k];
      return k >= 0 && L && t <= Math.max(L.end, L.sung ?? L.end) + 4 ? k : -1;
    };
    setI(at(engine.time));
    let cur = at(engine.time);
    return engine.on('tick', (p) => {
      const k = at(p.t);
      if (k !== cur) {
        cur = k;
        setI(k);
      }
    });
  }, [lines]);
  // (the line index held is the last song's until the effect above has run for the new one: read it only if it is there)
  const L = i >= 0 && lines ? lines[i] : undefined,
    text = L ? splitBrackets(L.text || '').main.trim() : '';
  return (
    <div className={s.barLyr} aria-live="off" data-test="bar-lyric">
      {text && (
        <span key={i} className={s.barLine}>
          <Marquee className={s.barMq}>{text}</Marquee>
        </span>
      )}
    </div>
  );
}

/* ---------- the queue ---------- */
export function QueuePanel() {
  const open = useStore(ui, (x) => x.queue),
    hasSong = useStore(player, (x) => !!x.id);
  const [live, setLive] = useState(false),
    box = useRef<HTMLElement | null>(null);
  const drive = useMemo(
    () =>
      new Drive(
        0,
        (x) => {
          const el = box.current;
          if (!el) return;
          el.style.opacity = String(Math.min(1, x * 1.4));
          el.style.transform =
            x >= 1 ? '' : `translateY(${((1 - x) * 10).toFixed(2)}px) scale(${(0.97 + 0.03 * x).toFixed(4)})`;
        },
        { stiffness: 320, damping: 30 },
      ),
    [],
  );
  useEffect(() => {
    if (open && hasSong) {
      setLive(true);
      requestAnimationFrame(() => drive.to(1));
    } else if (live)
      drive.to(0).then((done) => {
        if (done) setLive(false);
      });
  }, [open, hasSong]);
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
  if (!live) return null;
  return <QueueBody box={box} />;
}
function QueueBody({ box }: { box: React.MutableRefObject<HTMLElement | null> }) {
  const p = useStore(player),
    idx = useIndex(),
    [pos, setPos] = useState<React.CSSProperties | null>(null);
  const pict = useStore(ui, (x) => x.layer !== 'none'); // (over the picture: the dark glass of the play page)
  const items = useMemo(() => p.queue.map((id) => ({ id, t: idx.byId.get(id) })).filter((x) => x.t), [p.queue, idx]);
  const { shown, down, listProps } = useReorder(items, (list) => reorderQueue(list.map((x) => x.id)), {
    scroller: '[data-qlist]',
    ignore: '[data-x]',
  });
  // above the button that opened it, aligned to its right edge (below it when there is no room above)
  useLayoutEffect(() => {
    const place = () => {
      const a = queueAnchor || (refs.card ? refs.card.getBoundingClientRect() : null);
      if (!a) {
        setPos({ right: 16, bottom: 110 });
        return;
      }
      const right = Math.max(12, innerWidth - a.right),
        above = a.top > innerHeight * 0.45;
      setPos(
        above
          ? { right, bottom: innerHeight - a.top + 10, ['--oy' as string]: '100%' }
          : { right, top: a.bottom + 10, ['--oy' as string]: '0%' },
      );
    };
    place();
    addEventListener('resize', place);
    return () => removeEventListener('resize', place);
  }, []);
  useEffect(() => {
    const el = box.current?.querySelector('[data-cur="true"]');
    if (el) el.scrollIntoView({ block: 'center' });
  }, []);
  const cur = shown.findIndex((x) => x.id === p.id),
    rest = Math.max(0, shown.length - 1 - cur);
  return (
    <section
      data-test="queue"
      className={s.queue + ' glass' + (pict ? ' on-picture' : '')}
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
          const isCur = x.id === p.id,
            i = p.queue.indexOf(x.id);
          return (
            <div
              key={x.id}
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
