// The stage (the engine's picture) and the now-playing page over it: the cover on the left with the song's controls,
// the lyrics on the right. The picture behind is the engine's ambient view — the same backdrop, palette and rhythm the
// effect lyrics use — so it is always the shown song's, and the effect view grows out of it.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { tx } from '../../i18n';
import { ui, useStore, trackOf, openMenu, lib } from '../state';
import { Icon } from '../ui/icons';
import { Button, IconButton, Cover } from '../ui/kit';
import { Drive } from '../motion';
import { engine, canvas } from '../playback/stage';
import { player } from '../playback/player';
import { refs, openFx, back } from '../layers';
import type { Line } from '../../lyrics/model';
import { QualityTag } from '../ui/quality';
import { Progress, Transport, ModeButton, Volume, HifiBadge, Heart, QueueButton } from './Player';
import { pickPlaylist, editMeta } from './Modals';
import s from './NowPlaying.module.css';

export function Stage() {
  const el = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { refs.stage = el.current; engine.mount(el.current!); return () => { refs.stage = null; }; }, []);
  return <div data-test="stage" className={s.stage} ref={el} data-vis="false" aria-hidden="true" />;
}

export function NowPlaying() {
  const shownId = useStore(player, x => x.shownId), hasLyrics = useStore(player, x => x.hasLyrics), session = useStore(player, x => x.session);
  useStore(lib, x => x.tracks);
  const t = trackOf(shownId);
  const root = useRef<HTMLElement>(null), cover = useRef<HTMLDivElement>(null), top = useRef<HTMLElement>(null), info = useRef<HTMLDivElement>(null), right = useRef<HTMLDivElement>(null);
  const layer = useStore(ui, x => x.layer);
  useLayoutEffect(() => { refs.np = root.current; refs.npCover = cover.current; refs.npParts = [top.current, info.current, right.current]; });
  useEffect(() => () => { refs.np = null; refs.npCover = null; refs.npParts = []; }, []);
  // full screen: the controls rest out of sight while the pointer does (any move, key or wheel brings them back)
  const full = useStore(ui, x => x.win.full);
  useEffect(() => {
    const el = root.current; if (!el || !full || layer !== 'np') { if (el) el.dataset.idle = 'false'; return; }
    let tm = 0; const wake = () => { el.dataset.idle = 'false'; clearTimeout(tm); tm = window.setTimeout(() => { if (!el.querySelector(':focus-visible, [aria-expanded="true"]')) el.dataset.idle = 'true'; }, 2600); };
    wake(); const evs = ['pointermove', 'pointerdown', 'keydown', 'wheel'] as const; evs.forEach(e => addEventListener(e, wake, { passive: true }));
    return () => { clearTimeout(tm); evs.forEach(e => removeEventListener(e, wake)); el.dataset.idle = 'false'; };
  }, [full, layer]);
  if (!t) return null;
  const more = (e: React.MouseEvent) => openMenu(e, [
    { label: tx('s.addToPl'), icon: 'plus', run: () => pickPlaylist([t.id]) },
    { label: tx('s.meta.menu'), icon: 'tag', run: () => editMeta(t) },
  ]);
  const live = layer === 'np';
  return (
    <section data-test="np" className={s.np + ' on-picture'} ref={root} data-vis="false" aria-hidden={layer === 'none'} inert={layer !== 'np'}>
      <header className={s.top} ref={top}>
        <div className={s.fade}><IconButton n="chevronDown" glass label={tx('s.collapse')} onClick={back} /></div>
        <div className={s.topR + ' ' + s.fade}>
          <Button glass icon="sparkles" onClick={openFx}>{tx('s.fxLyrics')}</Button>
          <IconButton n="more" glass label={tx('s.more')} onClick={more} />
        </div>
      </header>
      <div className={s.main}>
        <div className={s.left}>
          <div className={s.cover} ref={cover} data-test="np-cover"><Cover k={t.cover} full eager /></div>
          <div className={s.info} ref={info}>
            <div className={s.fade} style={{ display: 'grid', gap: 14 }}>
              <div className={s.meta}>
                <div><b>{t.title}</b><small>{[t.artist || tx('s.unknownArtist'), t.album].filter(Boolean).join(' — ')}</small><HifiBadge /></div>
                <Heart id={t.id} />
              </div>
              <div className={s.qrow}><QualityTag t={t} look="glass" /></div>
              <Progress />
              <div className={s.ctl}>
                <div><ModeButton /></div>
                <Transport big />
                <div><Volume /><QueueButton /></div>
              </div>
            </div>
          </div>
        </div>
        <div className={s.right} ref={right}>
          {hasLyrics && session ? <NpLyrics key={session.version + ':' + shownId} lines={session.doc.lines} live={live} /> : <div className={s.fade}><NoLyrics /></div>}
        </div>
      </div>
    </section>
  );
}
function NoLyrics() { return <div className={s.none}><Icon n="lyrics" size={30} /><b>{tx('s.noLyrics')}</b><p>{tx('s.noLyricsHelp')}</p></div>; }

/* ---------- lyrics ----------
   Every line is a small mass on a spring toward its place (the line itself moves, so what is under the pointer is what
   is seen). When the sung line changes, the lines above move at once and each line below starts a moment after the one
   above it, so the column flows upward like a wave. Inside the sung line each word lifts on its own as it is sung, and
   fills from the left exactly as far as it is sung — nothing lights up ahead of the voice. A wheel looks around and
   settles back after a moment; clicking a line plays from it. */
const K = 140, C = 2 * 0.82 * Math.sqrt(K);
interface LS { el: HTMLElement; y: number; v: number; ty: number; at: number; next: number }
export function NpLyrics({ lines, live, compact = false }: { lines: Line[]; live: boolean; compact?: boolean }) {
  const box = useRef<HTMLDivElement>(null), lineEls = useRef<(HTMLElement | null)[]>([]);
  const st = useRef({ tops: [] as number[], ls: [] as (LS | null)[], cur: -2, manual: 0, raf: 0, last: 0, mTm: 0 });
  const findLine = (t: number) => { let lo = 0, hi = lines.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (lines[m].t <= t + 0.15) { r = m; lo = m + 1; } else hi = m - 1; } return r; };
  const step = (now: number) => {
    const S = st.current, dt = Math.min(0.05, Math.max(0.001, (now - S.last) / 1000)); S.last = now; let moving = false;
    for (const w of S.ls) { if (!w) continue;
      if (now >= w.at && w.ty !== w.next) w.ty = w.next; if (w.ty !== w.next) moving = true;
      for (let k = 0; k < 2; k++) { const h = dt / 2; w.v += (K * (w.ty - w.y) - C * w.v) * h; w.y += w.v * h; }
      if (Math.abs(w.ty - w.y) > 0.12 || Math.abs(w.v) > 0.3) moving = true; else { w.y = w.ty; w.v = 0; }
      w.el.style.transform = `translate3d(0,${w.y.toFixed(2)}px,0)`;
    }
    S.raf = moving ? requestAnimationFrame(step) : 0;
  };
  const kick = () => { const S = st.current; if (!S.raf) { S.last = performance.now(); S.raf = requestAnimationFrame(step); } };
  // new places around line idx: a wave when the music moves on, together when the user scrolls, at once when jumping
  const aim = (idx: number, wave: boolean, jump: boolean) => {
    const S = st.current, H = box.current ? box.current.clientHeight : 600, anchor = H * (compact ? 0.38 : 0.3), a = S.tops[Math.max(0, idx)] || 0, now = performance.now();
    S.ls.forEach((w, i) => { if (!w) return;
      const d = i - idx, ty = anchor - a + S.manual; w.next = ty; w.at = now + (wave ? Math.max(0, Math.min(d + 1, 9)) * 52 : 0);
      if (jump) { w.y = w.ty = ty; w.v = 0; w.at = now; w.el.style.transform = `translate3d(0,${ty}px,0)`; } });
    if (!jump) kick();
  };
  const mark = (idx: number) => lineEls.current.forEach((el, i) => { if (!el) return; const d = i - idx; el.style.setProperty('--d', String(Math.min(5, Math.abs(d)))); el.dataset.on = String(d === 0); });
  const measure = () => {
    const S = st.current; lineEls.current.forEach(el => { if (el) el.style.transform = ''; });
    S.tops = lineEls.current.map(el => (el ? el.offsetTop : 0));
    S.ls = lineEls.current.map(el => el ? { el, y: 0, v: 0, ty: 0, at: 0, next: 0 } : null);
  };
  useLayoutEffect(() => {
    const S = st.current; measure(); const i = Math.max(0, findLine(engine.time)); S.cur = i; mark(i); aim(i, false, true);
    const ro = new ResizeObserver(() => { const keep = S.ls; measure(); S.ls.forEach((w, i) => { const o = keep[i]; if (w && o) { w.y = o.y; w.v = o.v; } }); aim(S.cur, false, true); });
    if (box.current) ro.observe(box.current);
    return () => { cancelAnimationFrame(S.raf); S.raf = 0; ro.disconnect(); };
  }, [lines]);
  useEffect(() => {
    if (!live) return;
    const S = st.current, i0 = Math.max(0, findLine(engine.time)); if (i0 !== S.cur) { S.cur = i0; mark(i0); aim(i0, false, true); }   // catch up after being away
    return engine.on('tick', p => {
      const i = findLine(p.t);
      if (i !== S.cur && i >= 0) { S.cur = i; mark(i); aim(i, !S.manual, false); }
      const L = lines[i], el = lineEls.current[i]; if (!L || !el) return;
      const ws = el.querySelectorAll<HTMLElement>('[data-w]'), lvl = p.rs ? p.rs.level : 0.5;
      // each word: its fill (how far it is sung), its glow (only once it is all but sung) and its own lift as it is sung
      L.words.forEach((w, k) => { const q = Math.min(1, Math.max(0, (p.t - w.t) / Math.max(0.08, w.end - w.t))), e = ws[k]; if (!e) return;
        const gl = Math.min(1, Math.max(0, (q - 0.6) / 0.4)), r = Math.min(1, Math.max(0, (p.t - w.t) / 0.42)), lift = 1 - (1 - r) ** 3;
        e.style.setProperty('--p', q.toFixed(3)); e.style.setProperty('--gl', (gl * gl * lvl).toFixed(3)); e.style.translate = `0 ${(-5 * lift).toFixed(2)}px`; });
    });
  }, [lines, live]);
  const wheel = (e: React.WheelEvent) => { const S = st.current; S.manual -= e.deltaY; clearTimeout(S.mTm); aim(S.cur, false, false);
    S.mTm = window.setTimeout(() => { S.manual = 0; aim(S.cur, false, false); }, 2600); };
  return (
    <div className={s.lyr + (compact ? ' ' + s.compact : '')} ref={box} onWheel={wheel}>
      {lines.map((L, i) => (
        <button key={i} type="button" data-test="line" className={s.line} ref={el => { lineEls.current[i] = el; }} onClick={() => { st.current.manual = 0; engine.seek(Math.max(0, L.t - 0.05)); if (!engine.isPlaying) engine.play(); }}>
          {L.words.length ? L.words.map((w, k) => <span key={k} data-w className={s.w}>{w.text}{k < L.words.length - 1 && w.latin ? ' ' : ''}</span>) : <span data-w className={s.w}>{L.text}</span>}
          {L.subs.map((x, k) => <small key={k}>{x}</small>)}
        </button>
      ))}
    </div>
  );
}
export { Drive };
