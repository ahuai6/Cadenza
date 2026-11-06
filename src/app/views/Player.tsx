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
import { player, toggle, next, prev, setMode, setVolume, seekBy, MODES, MODE_ICON, playQueueAt, removeFromQueue, reorderQueue, clearQueue, type Mode } from '../playback/player';
import { hifi, describe } from '../playback/hifi';
import { refs, openNp } from '../layers';
import s from './Player.module.css';

/* ---------- progress: written straight to the DOM on every tick ---------- */
export function Progress({ className = '', times = true }: { className?: string; times?: boolean }) {
  const bar = useRef<HTMLDivElement>(null), cur = useRef<HTMLSpanElement>(null), tot = useRef<HTMLSpanElement>(null), drag = useRef(false);
  const end = () => player.get().session?.musicEnd || 0.01;
  useEffect(() => {
    const paint = (t: number) => { const d = end(), k = Math.min(1, Math.max(0, t / d));
      bar.current?.style.setProperty('--k', k.toFixed(5)); bar.current?.setAttribute('aria-valuenow', String(Math.round(t)));
      // (the ending after the music is not counted: the time stops at the song's length)
      if (cur.current) cur.current.textContent = fmtTime(Math.min(t, d)); if (tot.current) tot.current.textContent = fmtTime(d); };
    paint(engine.time);
    const a = engine.on('tick', p => paint(p.t)), b = player.subscribe((x, y) => { if (x.session !== y.session) paint(engine.time); });
    return () => { a(); b(); };
  }, []);
  const at = (e: React.PointerEvent) => { const r = bar.current!.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * end(); };
  return (
    <div className={s.prog + ' ' + className} data-times={times}>
      {times && <span className={s.pt} ref={cur}>0:00</span>}
      <div className={s.bar} ref={bar} data-test="progress" role="slider" aria-label={tx('s.nowPlaying')} aria-valuemin={0} tabIndex={0}
        onPointerDown={e => { drag.current = true; bar.current!.dataset.drag = 'true'; e.currentTarget.setPointerCapture(e.pointerId); engine.seek(at(e), true); }}
        onPointerMove={e => { if (drag.current) engine.seek(at(e), true); }}
        onPointerUp={e => { if (drag.current) { drag.current = false; bar.current!.dataset.drag = ''; engine.seek(at(e), false); } }}
        onPointerCancel={() => { drag.current = false; bar.current!.dataset.drag = ''; engine.seek(engine.time, false); }}
        onKeyDown={e => { if (e.key === 'ArrowRight') { e.stopPropagation(); seekBy(5); } else if (e.key === 'ArrowLeft') { e.stopPropagation(); seekBy(-5); } }}>
        <i className={s.fill} /><i className={s.head} />
      </div>
      {times && <span className={s.pt} ref={tot}>0:00</span>}
    </div>
  );
}

export function Transport({ big }: { big?: boolean }) {
  const playing = useStore(player, x => x.playing), loading = useStore(player, x => x.loading);
  return (
    <div className={s.trans} data-big={big || undefined}>
      <IconButton n="prev" label={tx('s.prev')} size={big ? 'lg' : undefined} iconSize={big ? 22 : 18} onClick={() => prev()} />
      <IconButton n={playing ? 'pause' : 'play'} label={tx(playing ? 's.pause' : 's.play')} solid size={big ? 'xl' : 'lg'} iconSize={big ? 28 : 20} className={s.playb} data-loading={loading} onClick={() => toggle()} />
      <IconButton n="next" label={tx('s.next')} size={big ? 'lg' : undefined} iconSize={big ? 22 : 18} onClick={() => next()} />
    </div>
  );
}
/** How the queue moves on; one click steps to the next mode. */
export function ModeButton() {
  const mode = useStore(player, x => x.mode);
  return <IconButton n={MODE_ICON[mode]} label={tx('s.mode.' + mode)} pressed={mode !== 'stop'} onClick={() => setMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length])} />;
}
export function Volume() {
  const v = useStore(player, x => x.volume), route = useStore(player, x => x.route), fixedVol = useStore(settings, x => x.fixedVolume);
  // bit-perfect output: the volume belongs to the DAC or the amplifier
  if (route === 'hifi' && fixedVol !== false) return <span className={s.volFixed} title={tx('s.volFixed')}><Icon n="volume" size={17} />DAC</span>;
  return <label className={s.vol} title={tx('s.volume')}><Icon n={v > 0 ? 'volume' : 'mute'} size={17} />
    <input type="range" className={kit.range} min="0" max="1" step="0.01" value={v} style={{ ['--p' as string]: `${v * 100}%` }} onChange={e => setVolume(+e.target.value)} aria-label={tx('s.volume')} /></label>;
}
/** What is playing and what reaches the DAC: "FLAC 24/96 → 96 kHz / 24 bit · Bit-perfect". */
export function HifiBadge() {
  const h = useStore(hifi), route = useStore(player, x => x.route); useStore(settings, x => x.fixedVolume);
  if (route !== 'hifi') return null;
  const d = describe(h); if (!d) return null;
  return (
    <div className={s.hifi} data-k={d.bitperfect ? 'bp' : d.exclusive ? 'ex' : 'sh'}>
      <span>{d.src}</span><span aria-hidden="true">→</span><span>{d.out}</span>
      <em>{tx(d.bitperfect ? 's.hifi.bitperfect' : d.exclusive ? 's.hifi.exclusive' : 's.hifi.shared')}</em>
      {d.resample && <em>{tx('s.hifi.resampled')}</em>}
    </div>
  );
}
export function Heart({ id, size }: { id: string; size?: 'sm' | 'lg' }) {
  const on = useStore(lib, x => x.favorites.includes(id));
  return <IconButton n="heart" size={size} filled={on} on={on} data-fav="" label={tx(on ? 's.unfav' : 's.fav')} onClick={() => Lib!.favorite(id, !on)} />;
}
export function QueueButton({ glass }: { glass?: boolean }) {
  const open = useStore(ui, x => x.queue), n = useStore(player, x => x.queue.length);
  return <IconButton n="queue" glass={glass} label={tx('s.queue')} pressed={open} aria-expanded={open} count={n} data-queue-button
    onClick={e => toggleQueue(e.currentTarget as HTMLElement)} />;
}
/** Open or close the queue, anchored at the control that asked for it. */
export function toggleQueue(at: HTMLElement) { queueAnchor = at.getBoundingClientRect(); ui.set({ queue: !ui.get().queue }); }
let queueAnchor: DOMRect | null = null;

/* ---------- the card at the bottom ---------- */
export function PlayerCard() {
  const id = useStore(player, x => x.id), dir = useStore(player, x => x.dir); useStore(lib, x => x.tracks);
  const t = trackOf(id), card = useRef<HTMLDivElement>(null), mini = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => { refs.card = card.current; refs.mini = mini.current; return () => { refs.card = null; refs.mini = null; }; });
  if (!t) return null;
  return (
    <div className={s.card} ref={card} data-test="card">
      <button type="button" className={s.id} title={tx('s.expand')} onClick={openNp}>
        <span ref={mini} className={s.mini}><Swap k={t.cover || ''} dir={dir} fill><Cover k={t.cover} className={s.mini} /></Swap></span>
        <Swap k={t.id} dir={dir}><span className={s.text}><b>{t.title}</b><small>{t.artist || tx('s.unknownArtist')}</small></span></Swap>
      </button>
      <div className={s.center}>
        <Transport />
        <Progress />
      </div>
      <div className={s.end}>
        <Volume />
        <QueueButton />
        <Heart id={t.id} />
        <IconButton n="chevronUp" label={tx('s.expand')} onClick={openNp} />
      </div>
    </div>
  );
}

/* ---------- the queue ---------- */
export function QueuePanel() {
  const open = useStore(ui, x => x.queue), hasSong = useStore(player, x => !!x.id);
  const [live, setLive] = useState(false), box = useRef<HTMLElement | null>(null);
  const drive = useMemo(() => new Drive(0, x => { const el = box.current; if (!el) return; el.style.opacity = String(Math.min(1, x * 1.4)); el.style.transform = x >= 1 ? '' : `translateY(${((1 - x) * 10).toFixed(2)}px) scale(${(0.97 + 0.03 * x).toFixed(4)})`; }, { stiffness: 320, damping: 30 }), []);
  useEffect(() => { if (open && hasSong) { setLive(true); requestAnimationFrame(() => drive.to(1)); } else if (live) drive.to(0).then(done => { if (done) setLive(false); }); }, [open, hasSong]);
  useEffect(() => { if (!open) return;
    const away = (e: PointerEvent) => { const t = e.target as HTMLElement; if (box.current && !box.current.contains(t) && !t.closest('[data-queue-button]') && !t.closest('[role="menu"]')) ui.set({ queue: false }); };
    addEventListener('pointerdown', away, true); return () => removeEventListener('pointerdown', away, true); }, [open]);
  if (!live) return null;
  return <QueueBody box={box} />;
}
function QueueBody({ box }: { box: React.MutableRefObject<HTMLElement | null> }) {
  const p = useStore(player), idx = useIndex(), [pos, setPos] = useState<React.CSSProperties | null>(null);
  const pict = useStore(ui, x => x.layer !== 'none');   // (over the picture: the dark glass of the play page)
  const items = useMemo(() => p.queue.map(id => ({ id, t: idx.byId.get(id) })).filter(x => x.t), [p.queue, idx]);
  const { shown, down, listProps } = useReorder(items, list => reorderQueue(list.map(x => x.id)), { scroller: '[data-qlist]', ignore: '[data-x]' });
  // above the button that opened it, aligned to its right edge (below it when there is no room above)
  useLayoutEffect(() => { const place = () => { const a = queueAnchor || (refs.card ? refs.card.getBoundingClientRect() : null); if (!a) { setPos({ right: 16, bottom: 110 }); return; }
    const right = Math.max(12, innerWidth - a.right), above = a.top > innerHeight * 0.45;
    setPos(above ? { right, bottom: innerHeight - a.top + 10, ['--oy' as string]: '100%' } : { right, top: a.bottom + 10, ['--oy' as string]: '0%' }); };
    place(); addEventListener('resize', place); return () => removeEventListener('resize', place); }, []);
  useEffect(() => { const el = box.current?.querySelector('[data-cur="true"]'); if (el) el.scrollIntoView({ block: 'center' }); }, []);
  const cur = shown.findIndex(x => x.id === p.id), rest = Math.max(0, shown.length - 1 - cur);
  return (
    <section data-test="queue" className={s.queue + ' glass' + (pict ? ' on-picture' : '')} ref={el => { box.current = el; }} style={pos || { visibility: 'hidden' }} aria-label={tx('s.queue')}>
      <header className={s.qhead}>
        <div><b>{tx('s.queue')}</b><small>{tx('s.queue.count', { n: items.length, rest })}</small></div>
        <button type="button" className="muted" disabled={items.length < 2} onClick={() => clearQueue()} style={{ fontSize: 12.5, fontWeight: 600 }}>{tx('s.queue.clear')}</button>
      </header>
      {/* the modes as icons on one line; the chosen one is named below (labels never wrap or squeeze) */}
      <div className={s.qmodes}>
        <Seg size="sm" value={p.mode} label={tx('s.mode')} onChange={(m: Mode) => setMode(m)} options={MODES.map(m => [m, '', MODE_ICON[m], tx('s.mode.' + m)])} />
        <small className={s.qmode}><b>{tx('s.mode.' + p.mode)}</b> · {tx('s.mode.' + p.mode + '.help')}</small>
      </div>
      <div className={s.qlist} role="list" data-qlist {...listProps}>
        {shown.map((x, k) => { const isCur = x.id === p.id, i = p.queue.indexOf(x.id); return (
          <div key={x.id} role="listitem" className={s.qrow} data-cur={isCur} onPointerDown={e => down(e, k)} onDoubleClick={() => playQueueAt(i)}>
            <span className={s.qgrip} aria-hidden="true"><Icon n="grip" size={14} /></span>
            <span className={s.qcover} onClick={() => playQueueAt(i)}><Cover k={x.t!.cover} />{isCur && p.playing && <span className={s.qeq}><LiveEq /></span>}</span>
            <span className={s.qtext} onClick={() => playQueueAt(i)}><b>{x.t!.title}</b><small>{x.t!.artist || tx('s.unknownArtist')}</small></span>
            <span className={s.qtime}>{fmtTime(x.t!.duration)}</span>
            {isCur ? <span /> : <IconButton n="close" size="sm" iconSize={14} className={s.qx} data-x label={tx('s.queue.remove')} onClick={() => removeFromQueue(i)} />}
          </div>); })}
      </div>
    </section>
  );
}
