// The poster wall: every song of a chosen list as a poster, laid out four ways.
//   grid    — even rows, the calm way to browse
//   mosaic  — a dense collage; favourites and the most played take larger tiles
//   gallery — one poster at a time on a curved 3D shelf (wheel, drag or arrow keys), the rest receding at either side
//   drift   — columns gliding slowly at different speeds, an ambient display for a second screen
import { useEffect, useMemo, useRef, useState } from 'react';
import { tx } from '../../i18n';
import { coverUrl, type Track } from '../bridge';
import { ui, lib, useStore, useIndex, keep } from '../state';
import { player, playIds } from '../playback/player';
import { Icon } from '../ui/icons';
import { Button, Seg, Empty } from '../ui/kit';
import { LiveEq } from '../ui/LiveEq';
import { hashStr } from '../../core/rng';
import s from './Wall.module.css';

const LAYOUTS: [string, string, string][] = [['grid', 's.wall.grid', 'grid'], ['mosaic', 's.wall.mosaic', 'wall'], ['flow', 's.wall.flow', 'flow'], ['drift', 's.wall.drift', 'drift']];
const h01 = (x: string) => (hashStr(x) >>> 0) / 4294967295;

export function PosterWall() {
  const tracks = useStore(lib, x => x.tracks), favorites = useStore(lib, x => x.favorites), playlists = useStore(lib, x => x.playlists);
  const idx = useIndex(), layout = useStore(ui, x => x.wallLayout), source = useStore(ui, x => x.wallSource);
  const list = useMemo(() => {
    const ids = source === 'all' ? tracks.map(t => t.id) : source === 'fav' ? favorites : (playlists.find(p => p.id === source) || { tracks: [] }).tracks;
    return ids.map(id => idx.byId.get(id)).filter((t): t is Track => !!t && !t.protected);
  }, [tracks, favorites, playlists, source, idx]);
  const play = (t: Track) => { const ids = list.map(x => x.id); playIds(ids, ids.indexOf(t.id)); };
  const plays = useMemo(() => { const v = list.map(t => t.plays).sort((a, b) => b - a); return v[Math.floor(v.length * 0.15)] || Infinity; }, [list]);
  return (
    <div className={s.wall}>
      <header className={s.head}>
        <h1>{tx('s.wall')}</h1>
        <label className={s.sel}><span>{tx('s.wall.source')}</span>
          <select value={source} onChange={e => { ui.set({ wallSource: e.target.value }); keep('wallSource', e.target.value); }}>
            <option value="all">{tx('s.wall.all')}</option><option value="fav">{tx('s.favorites')}</option>
            {playlists.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></label>
        <Seg role="tablist" fit size="sm" value={layout} label={tx('s.wall.layout')} onChange={v => { ui.set({ wallLayout: v }); keep('wallLayout', v); }} options={LAYOUTS.map(([k, l, ic]) => [k, tx(l), ic])} />
        <span className={s.help}>{tx('s.wall.help')}</span>
      </header>
      {!list.length ? <Empty title={tx('s.empty.results')} icon="wall" />
        : layout === 'flow' ? <Gallery list={list} play={play} />
        : layout === 'drift' ? <Drift list={list} play={play} />
        : <div className={layout === 'mosaic' ? s.mosaic : s.grid}>
            {list.map((t, i) => { const big = layout === 'mosaic' && (favorites.includes(t.id) || t.plays >= plays || h01(t.id) > 0.86) ? 2 : 1;
              return <Poster key={t.id} t={t} play={play} span={big} delay={Math.min(i, 40) * 14} />; })}
          </div>}
    </div>
  );
}
function Poster({ t, play, span = 1, delay = 0 }: { t: Track; play: (t: Track) => void; span?: number; delay?: number }) {
  const cur = useStore(player, x => x.id === t.id), playing = useStore(player, x => x.playing);
  return (
    <button type="button" className={s.poster} data-span={span} style={{ animationDelay: `${delay}ms` }} onClick={() => play(t)} title={`${t.title} — ${t.artist}`}>
      {t.cover ? <img src={coverUrl(t.cover, span > 1)} alt="" loading="lazy" decoding="async" draggable={false} /> : <span className={s.ph}><Icon n="note" size={28} /></span>}
      {cur && playing && <span className={s.now}><LiveEq /></span>}
      <span className={s.cap}><b>{t.title}</b><small>{t.artist}</small></span>
    </button>
  );
}
// the gallery: a position that eases toward the chosen poster; every poster is placed from its distance to it
function Gallery({ list, play }: { list: Track[]; play: (t: Track) => void }) {
  const [i, setI] = useState(() => Math.max(0, list.findIndex(t => t.id === player.get().id)));
  const pos = useRef(i), raf = useRef(0), box = useRef<HTMLDivElement>(null), els = useRef<(HTMLButtonElement | null)[]>([]), drag = useRef<{ x: number; s: number; on: boolean } | null>(null), dragged = useRef(0);
  const n = list.length, target = useRef(i);
  const go = (k: number) => { target.current = Math.max(0, Math.min(n - 1, k)); setI(Math.round(target.current)); };
  useEffect(() => {
    const step = () => { pos.current += (target.current - pos.current) * 0.14; if (Math.abs(target.current - pos.current) < 0.001) pos.current = target.current;
      const w = box.current ? box.current.clientWidth : 1200;
      els.current.forEach((el, k) => { if (!el) return; const d = k - pos.current, ad = Math.abs(d); if (ad > 9) { el.style.display = 'none'; return; } el.style.display = '';
        const x = Math.sign(d) * (Math.min(ad, 1) * w * 0.2 + Math.max(0, ad - 1) * w * 0.085), z = -Math.min(ad, 1) * 220 - Math.max(0, ad - 1) * 90, ry = -Math.sign(d) * Math.min(ad, 1) * 52;
        el.style.transform = `translate3d(${x}px,0,${z}px) rotateY(${ry}deg)`; el.style.zIndex = String(100 - Math.round(ad * 10)); el.style.opacity = String(Math.max(0, 1 - Math.max(0, ad - 5) * 0.25)); });
      raf.current = requestAnimationFrame(step); };
    raf.current = requestAnimationFrame(step); return () => cancelAnimationFrame(raf.current);
  }, [n]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if ((e.target as HTMLElement).closest('input,select,textarea') || ui.get().layer !== 'none') return; if (e.key === 'ArrowRight') go(target.current + 1); else if (e.key === 'ArrowLeft') go(target.current - 1); else if (e.key === 'Enter') play(list[Math.round(target.current)]); };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k); });
  const t = list[i];
  return (
    <div className={s.gallery} ref={box} onWheel={e => go(target.current + Math.sign(e.deltaY || e.deltaX) * (Math.abs(e.deltaY) > 60 ? 1 : 0.5))}
      // a press only becomes a drag once it moves: until then the pointer is not captured, so a click reaches the poster
      // (or the play button) under it; after a drag, the click that ends it is swallowed
      onPointerDown={e => { if (e.button !== 0) return; drag.current = { x: e.clientX, s: target.current, on: false }; }}
      onPointerMove={e => { const d = drag.current; if (!d) return;
        if (!d.on && Math.abs(e.clientX - d.x) > 6) { d.on = true; e.currentTarget.setPointerCapture(e.pointerId); }
        if (d.on) target.current = Math.max(0, Math.min(n - 1, d.s - (e.clientX - d.x) / 160)); }}
      onPointerUp={() => { const d = drag.current; drag.current = null; if (d?.on) { go(Math.round(target.current)); dragged.current = performance.now(); } }}
      onPointerCancel={() => { drag.current = null; }}
      onClickCapture={e => { if (performance.now() - dragged.current < 250) { e.stopPropagation(); e.preventDefault(); } }}>
      <div className={s.shelf}>
        {list.map((x, k) => (
          <button key={x.id} type="button" className={s.gpost} ref={el => { els.current[k] = el; }} onClick={() => (k === i ? play(x) : go(k))}>
            {x.cover ? <img src={coverUrl(x.cover, Math.abs(k - i) < 3)} alt="" draggable={false} /> : <span className={s.ph}><Icon n="note" size={40} /></span>}
          </button>
        ))}
      </div>
      {t && <div className={s.gcap}><b>{t.title}</b><small>{[t.artist, t.album].filter(Boolean).join(' — ')}</small>
        <Button kind="primary" size="sm" icon="play" onClick={() => play(t)}>{tx('s.play')}</Button></div>}
    </div>
  );
}
// drift: five columns, each a loop of posters moving at its own pace; hovering pauses the column under the pointer
function Drift({ list, play }: { list: Track[]; play: (t: Track) => void }) {
  const cols = 5, perCol = Math.max(6, Math.ceil(list.length / cols));
  const columns = useMemo(() => Array.from({ length: cols }, (_, c) => { const a: Track[] = []; for (let k = 0; k < perCol; k++) a.push(list[(c * 7 + k * cols + c) % list.length]); return a; }), [list, perCol]);
  return (
    <div className={s.drift}>
      {columns.map((col, c) => (
        <div key={c} className={s.dcol} style={{ ['--dur' as string]: `${(60 + c * 17) * Math.max(1, perCol / 10)}s`, ['--dir' as string]: c % 2 ? 'reverse' : 'normal' }}>
          <div className={s.dtrack}>{[...col, ...col].map((t, k) => <Poster key={k} t={t} play={play} />)}</div>
        </div>
      ))}
    </div>
  );
}
