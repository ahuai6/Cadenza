// The stage (the engine's picture) and the now-playing page over it: the cover on the left with the song's controls,
// the lyrics on the right. The picture behind is the engine's ambient view — the same backdrop, palette and rhythm the
// effect lyrics use — so it is always the shown song's, and the effect view grows out of it.
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { tx } from '../../i18n';
import { ui, useStore, trackOf, openMenu, lib } from '../state';
import { Icon } from '../ui/icons';
import { IconButton, Cover, Swap, Badge } from '../ui/kit';
import { Drive } from '../motion';
import { engine } from '../playback/stage';
import { player } from '../playback/player';
import { refs, openFx, back } from '../layers';
import { fontStack, subLines, type LyricLine as Line } from '../../engine';
import { QualityTag } from '../ui/quality';
import { Marquee } from '../ui/Marquee';
import { Progress, Transport, ModeButton, Volume, HifiBadge, Heart, toggleQueue } from './Player';
import { pickPlaylist, editMeta, npSettings } from './Modals';
import s from './NowPlaying.module.css';

export function Stage() {
  const el = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { refs.stage = el.current; engine.mount(el.current!); return () => { refs.stage = null; }; }, []);
  return <div data-test="stage" className={s.stage} ref={el} data-vis="false" aria-hidden="true" />;
}

export function NowPlaying() {
  const album = useStore(player, x => !!x.album), dir = useStore(player, x => x.dir), shownId = useStore(player, x => x.shownId), hasLyrics = useStore(player, x => x.hasLyrics), session = useStore(player, x => x.session), instr = useStore(lib, () => !!trackOf(shownId)?.instrumental);
  useStore(lib, x => x.tracks);
  const t = trackOf(shownId);
  const amb = useRef<HTMLDivElement>(null), root = useRef<HTMLElement>(null), cover = useRef<HTMLDivElement>(null), top = useRef<HTMLElement>(null), info = useRef<HTMLDivElement>(null), right = useRef<HTMLDivElement>(null), halo = useRef<HTMLDivElement>(null);
  const layer = useStore(ui, x => x.layer), queueOpen = useStore(ui, x => x.queue), qn = useStore(player, x => x.queue.length);
  useLayoutEffect(() => { refs.np = root.current; refs.npAmb = amb.current; refs.npCover = cover.current; refs.npParts = [top.current, info.current, right.current]; });
  useEffect(() => () => { refs.np = null; refs.npAmb = null; refs.npCover = null; refs.npParts = []; }, []);
  // the song's own light, for the glow under the cover and the tint of the shade at the edges (the engine's palette)
  const tone = useMemo(() => { const A = session?.ambient; if (!A) return {}; const c = A.cols[0] || A.base, rgb = (v: number[]) => v.map(x => Math.round(x)).join(',');
    return { '--amb': rgb(c), '--amb-base': rgb(A.base) } as React.CSSProperties; }, [session]);
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
    { label: tx('np.findLyr'), icon: 'search', run: () => npSettings('lyrics') },
    { label: tx('np.set') + '…', icon: 'lyrics', run: () => npSettings('view') },
    '-',
    { label: tx('s.addToPl'), icon: 'plus', run: () => pickPlaylist([t.id]) },
    { label: tx('s.meta.menu'), icon: 'tag', run: () => editMeta(t) },
  ]);
  const live = layer === 'np';
  // above the title: the album, its year and the track's place on it
  const kicker = [t.album, t.year, t.track ? tx('np.trackNo', { n: t.track }) : ''].filter(Boolean).join(' · ');
  return (
    <>
    {/* the cinema around the picture: a shade at the edges in the song's own dark, and a fine grain over the colour */}
    {/* (each as a box that cuts and a layer inside it moving the other way — layers.ts: the opening moves them, it never
        repaints them) */}
    <div className={s.amb} ref={amb} style={tone} data-vis="false" aria-hidden="true"><div className={s.ambIn} data-in /></div>
    <section data-test="np" className={s.np + ' on-picture'} ref={root} style={tone} data-vis="false" aria-hidden={layer === 'none'} inert={layer !== 'np'}>
      <div className={s.sheet} data-in>
      <header className={s.top} ref={top}>
        <div className={s.fade}><IconButton n="chevronDown" label={tx('s.collapse')} onClick={back} /></div>
        {/* what this page shows: its lyrics, the effect lyrics, or the queue over it (the page itself says what is playing) */}
        <nav className={s.views + ' ' + s.fade} aria-label={tx('np.views')}>
          <button type="button" aria-current="page">{tx('np.tab.lyrics')}</button>
          <button type="button" onClick={openFx}><Icon n="sparkles" size={15} />{tx('s.fxLyrics')}</button>
          <button type="button" data-queue-button aria-label={tx('s.queue')} aria-expanded={queueOpen} aria-pressed={queueOpen} onClick={e => toggleQueue(e.currentTarget)}>{tx('np.tab.queue')}{qn > 0 && <i>{qn}</i>}</button>
        </nav>
        <div className={s.topR + ' ' + s.fade}>
          <IconButton n="more" label={tx('s.more')} onClick={more} />
        </div>
      </header>
      <div className={s.main}>
        <div className={s.left}>
          {/* (the cover's own light spilling behind it: the left column's weight against the lyrics) */}
          <div className={s.coverBox}>
            <div className={s.halo + ' ' + s.fade} ref={halo} data-q aria-hidden="true"><Swap k={t.cover || ''} dir={dir} fill><Cover k={t.cover} full /></Swap></div>
            <div className={s.cover} ref={cover} data-test="np-cover">
              {/* (its shadows — the mini cover's and its own — and its picture each on a layer of their own, in its
                  transform: the opening crosses the shadows and rounds the clip, it never repaints the picture) */}
              <i className={s.shM} data-sh="mini" aria-hidden="true" /><i className={s.shP} data-sh="page" aria-hidden="true" />
              <div className={s.coverClip} data-clip><Swap k={t.cover || ''} dir={dir} fill><Cover k={t.cover} full eager /></Swap></div>
            </div>
          </div>
          <div className={s.info} ref={info}>
            <div className={s.fade + ' ' + s.infoIn}>
              <div className={s.meta}>
                <Swap k={t.id} dir={dir}><div>
                  {/* (nothing ends in an ellipsis here: a long one scrolls) */}
                  {kicker && <Marquee className={s.kicker}>{kicker}</Marquee>}
                  <Marquee className={s.title}>{t.title}</Marquee>
                  <Marquee className={s.artist}>{t.artist || tx('s.unknownArtist')}</Marquee>
                  <HifiBadge />
                </div></Swap>
                <span className={s.heart}><Heart id={t.id} /></span>
              </div>
              <div className={s.progWrap}>
                <Progress />
                <div className={s.qrow}><QualityTag t={t} look="glass" />{album && <Badge>{tx('s.albumOn')}</Badge>}</div>
              </div>
              <div className={s.ctl}>
                <div><ModeButton /></div>
                <Transport big />
                <div />
              </div>
              <div className={s.volRow}><Volume /></div>
            </div>
          </div>
        </div>
        <div className={s.right} ref={right}>
          {/* a new song's lyrics come in from the side the queue went (a replan of the same song: in place, at once) */}
          <div key={shownId || ''} className={s.swapIn} style={{ ['--sd' as string]: dir }}>
            {instr ? <div className={s.fade}><Instrumental /></div> : hasLyrics && session ? <NpLyrics key={session.version + ':' + shownId} lines={session.doc.lines} live={live} /> : <div className={s.fade}><NoLyrics /></div>}
          </div>
        </div>
      </div>
      </div>
    </section>
    </>
  );
}
/** A song marked as an instrumental: this, in place of lyrics. */
function Instrumental() { return <div className={s.none}><Icon n="note" size={30} /><b>{tx('s.instr.text')}</b></div>; }
function NoLyrics() { return <div className={s.none}><Icon n="lyrics" size={30} /><b>{tx('s.noLyrics')}</b><p>{tx('s.noLyricsHelp')}</p></div>; }

/* ---------- lyrics ----------
   Every line is a small mass on a spring toward its place (the line itself moves, so what is under the pointer is what
   is seen). When the sung line changes, the lines above move at once and each line below starts a moment after the one
   above it, so the column flows upward like a wave. Inside the sung line each word lifts on its own as it is sung, and
   fills from the left exactly as far as it is sung — nothing lights up ahead of the voice. A wheel looks around and
   settles back after a moment; clicking a line plays from it. */
const K = 140, C = 2 * 0.82 * Math.sqrt(K);
/** How far a word has lifted (0..1, a hair over at the top), as Apple Music lifts it — in stages: a quick first rise as
 *  it is struck (a third of the way in about a tenth of a second), then on with the voice for as long as it is sung (a
 *  slow-in, slow-out curve), and at the end a small float past the top and back, settling. dt: since the word began;
 *  dur: how long it is sung. */
const LIFT = 5;
function liftAt(dt: number, dur: number) {
  if (dt <= 0) return 0; const d = Math.max(0.2, dur);
  const strike = 0.32 * (1 - (1 - Math.min(1, dt / 0.11)) ** 3), u = Math.min(1, dt / d), sung = 0.32 + 0.68 * (u * u * (3 - 2 * u));
  const base = Math.max(strike, dt < 0.11 ? strike : sung), v = (dt - d) / 0.5;
  return v <= 0 ? base : 1 + 0.07 * Math.sin(Math.PI * Math.min(1, v)) * (1 - Math.min(1, v));
}
/** A word lit character by character: any word of several characters that is not Latin (it can wrap onto two rows). */
const byUnit = (w: Line['words'][number]) => !w.latin && w.units.length > 1;
interface LS { el: HTMLElement; y: number; v: number; ty: number; at: number; next: number }
/** A style written only when it changes: the sung line is painted every frame, but most of its words are sung already or
 *  not yet — writing their same values again made the browser restyle them all each frame for nothing. */
const wrote = new WeakMap<HTMLElement, Record<string, string>>();
function put(el: HTMLElement, k: string, v: string) { let m = wrote.get(el); if (!m) wrote.set(el, m = {}); if (m[k] === v) return; m[k] = v;
  if (k === 'translate') el.style.translate = v; else el.style.setProperty(k, v); }
export function NpLyrics({ lines, live, compact = false }: { lines: Line[]; live: boolean; compact?: boolean }) {
  const box = useRef<HTMLDivElement>(null), lineEls = useRef<(HTMLElement | null)[]>([]), view = useStore(ui, x => x.npLyr);
  // the lyric face chosen for this page (or the interface's own)
  const faceStyle = useMemo(() => { if (!view.font || view.font === 'ui') return {}; const f = fontStack(view.font, lines.map(L => L.text).join('').slice(0, 200)); return { fontFamily: f.stack, fontWeight: f.w }; }, [view.font, lines]);
  const st = useRef({ tops: [] as number[], ls: [] as (LS | null)[], cur: -2, manual: 0, raf: 0, last: 0, mTm: 0 });
  // when each line becomes the current one: as it starts — or, as Apple Music does, half a beat early when the line
  // before is sung well before it (a breath of a beat or more): the page is already there when the voice comes in
  const starts = useMemo(() => { const map = engine.session?.map; return lines.map((L, i) => { const P = lines[i - 1], bl = map ? map.beatLen(L.t) : 0.5;
    // (a line that starts while the one before is still sounding, by the lyrics' own end, becomes current once that ends)
    const lastW = P?.words.at(-1), held = lastW && lastW.endGiven && lastW.end > L.t ? lastW.end : -Infinity;
    return Math.max(held, P && L.t - Math.min(P.sung, P.end) >= bl ? L.t - bl / 2 : L.t - 0.15); }); }, [lines]);
  const findLine = (t: number) => { let lo = 0, hi = lines.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (starts[m] <= t) { r = m; lo = m + 1; } else hi = m - 1; } return r; };
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
  // (one state of light per line: a line timed only as a whole has a single fill and glow on the line itself, which its
  // words, their characters and its harmonies all inherit — none carries one of its own, so no row or character can
  // light at another moment than the rest; a line timed word by word has one on each of its drawn words or characters)
  const leaves = (el: HTMLElement) => el.querySelectorAll<HTMLElement>('[data-w]:not([data-u-w]), [data-u], [data-h]');
  const mark = (idx: number) => lineEls.current.forEach((el, i) => { if (!el) return; const d = i - idx, whole = !lines[i]?.kar;
    // a line left before its last word had lifted all the way: its words go the rest of the way up (softly, by the
    // transition) and stay there, never held half-way — and it stays lit, as sung
    if (d !== 0 && el.dataset.on === 'true') { leaves(el).forEach(w => { if (w.style.translate && !whole) put(w, 'translate', `0 ${w.dataset.h != null ? -LIFT * 0.6 : -LIFT}px`); if (!whole) put(w, '--p', '1'); });
      if (whole) put(el, '--p', '1'); }
    // (becoming current, a line timed as a whole starts from dark on the line itself, its parts holding nothing of their own)
    if (d === 0 && whole) { leaves(el).forEach(w => { w.style.removeProperty('--p'); w.style.removeProperty('--gl'); const m = wrote.get(w); if (m) { delete m['--p']; delete m['--gl']; } }); put(el, '--p', '0'); put(el, '--gl', '0'); }
    el.style.setProperty('--d', String(Math.min(5, Math.abs(d)))); el.dataset.on = String(d === 0); });
  const measure = () => {
    const S = st.current; lineEls.current.forEach(el => { if (el) el.style.transform = ''; });
    S.tops = lineEls.current.map(el => (el ? el.offsetTop : 0));
    S.ls = lineEls.current.map(el => el ? { el, y: 0, v: 0, ty: 0, at: 0, next: 0 } : null);
  };
  useLayoutEffect(() => {
    // (before the first line: none is current — the first is not lit before it is sung)
    const S = st.current; measure(); const i = findLine(engine.time); S.cur = i; mark(i); aim(i, false, true);
    const ro = new ResizeObserver(() => { const keep = S.ls; measure(); S.ls.forEach((w, i) => { const o = keep[i]; if (w && o) { w.y = o.y; w.v = o.v; } }); aim(S.cur, false, true); });
    if (box.current) ro.observe(box.current);
    return () => { cancelAnimationFrame(S.raf); S.raf = 0; ro.disconnect(); };
  }, [lines, view.size, view.subs, view.reads]);   // (a new size or the translations shown or not: the lines are measured again)
  useEffect(() => {
    if (!live) return;
    const S = st.current, i0 = findLine(engine.time); if (i0 !== S.cur) { S.cur = i0; mark(i0); aim(i0, false, true); }   // catch up after being away
    return engine.on('tick', p => {
      const i = findLine(p.t);
      if (i !== S.cur) { S.cur = i; mark(i); aim(i, !S.manual, false); }
      // (the current line — and a line already begun under it, still waiting to be current: its words are sung meanwhile)
      paint(i); if (lines[i + 1] && p.t >= lines[i + 1].t) paint(i + 1);
      function paint(i: number) {
      const L = lines[i], el = lineEls.current[i]; if (!L || !el) return;
      const ws = el.querySelectorAll<HTMLElement>('[data-w]'), lvl = p.rs ? p.rs.level : 0.5;
      // a line timed only as a whole lights as a whole, at once, from the moment it is the current line (or its own time,
      // if that is sooner), as Apple Music does: one fill on the line — never dark while current, never faded in
      const t0w = Math.min(starts[i] ?? L.t, L.t);
      if (!L.kar) { const on = p.t >= t0w ? 1 : 0; put(el, '--p', String(on)); put(el, '--gl', (0.6 * lvl * on).toFixed(3)); }
      // each word: its fill (how far it is sung), its glow (only once it is all but sung) and its own lift as it is sung
      L.words.forEach((w, k) => { const e = ws[k]; if (!e) return;
        // (a word is all sung by the time the next one starts: with no gap, or a tiny one, it does not trail on under it)
        const nx = L.words[k + 1], end = nx && nx.t > w.t ? Math.min(w.end, nx.t) : w.end;
        const fill = (el: HTMLElement, t0: number, t1: number) => { const q = Math.min(1, Math.max(0, (p.t - t0) / Math.max(0.08, t1 - t0))), gl = Math.min(1, Math.max(0, (q - 0.6) / 0.4));
          put(el, '--p', q.toFixed(3)); put(el, '--gl', (gl * gl * lvl).toFixed(3)); put(el, 'translate', `0 ${(-LIFT * liftAt(p.t - t0, t1 - t0)).toFixed(2)}px`); };
        // a word drawn character by character (one that may wrap onto the next row): each character fills in its own
        // time, so a second row lights up only once it is sung
        if (byUnit(w) && L.kar) { const us = e.querySelectorAll<HTMLElement>('[data-u]'), n = w.units.length, span = Math.max(0.08, w.end - w.t);
          const at = (i: number) => w.units[i]?.t ?? w.t + span * 0.85 * i / n;
          us.forEach((u, i) => fill(u, at(i), i + 1 < n ? at(i + 1) : end)); }
        // (a line timed only as a whole: lit on the line itself, above — its words do not lift one by one: that is a
        // word being sung, which a line timed as a whole has none of)
        else if (!L.kar) put(e, 'translate', '');
        else fill(e, w.t, end); });
      // the harmonies: each from its own first sound to its last (at least as long as the word it goes with)
      const hs = el.querySelectorAll<HTMLElement>('[data-h]');
      L.words.filter(w => w.harm).forEach((w, k) => { const e = hs[k], H = w.harm!; if (!e) return;
        // (a line timed only as a whole: its harmonies light with it, at once, as its words do)
        if (!L.kar) { put(e, 'translate', ''); return; }
        const t0 = isFinite(H.t) ? H.t : w.t, last = H.units[H.units.length - 1]?.t ?? t0;
        const t1 = Math.max(t0 + 0.3, last + 0.25, w.end), q = Math.min(1, Math.max(0, (p.t - t0) / Math.max(0.08, t1 - t0)));
        put(e, '--p', q.toFixed(3)); put(e, 'translate', `0 ${(-LIFT * 0.6 * liftAt(p.t - t0, t1 - t0)).toFixed(2)}px`); });
      }
    });
  }, [lines, live]);
  const wheel = (e: React.WheelEvent) => { const S = st.current; S.manual -= e.deltaY; clearTimeout(S.mTm); aim(S.cur, false, false); if (box.current) box.current.dataset.manual = 'true';
    S.mTm = window.setTimeout(() => { S.manual = 0; aim(S.cur, false, false); if (box.current) box.current.dataset.manual = 'false'; }, 2600); };
  return (
    <div className={s.lyr + (compact ? ' ' + s.compact : '')} ref={box} onWheel={wheel} data-blur={view.blur} data-subs={view.subs} style={{ ['--np-fs' as string]: view.size, ...faceStyle } as React.CSSProperties}>
      {lines.map((L, i) => (
        <button key={i} type="button" data-test="line" className={s.line} data-whole={!L.kar || undefined} ref={el => { lineEls.current[i] = el; }} onClick={() => { st.current.manual = 0; engine.seek(Math.max(0, L.t - 0.05)); if (!engine.isPlaying) engine.play(); }}>
          {L.words.length ? L.words.map((w, k) => <Fragment key={k}>{byUnit(w) ? <span data-w data-u-w className={s.wu}>{w.units.map((u, i) => <span key={i} data-u className={s.w}>{u.c}</span>)}</span> : <span data-w className={s.w}>{w.disp ?? w.text}{k < L.words.length - 1 && (w.gap ?? (w.latin && L.words[k + 1].latin)) ? ' ' : ''}</span>}</Fragment>) : <span data-w className={s.w}>{L.text}</span>}
          {/* the harmonies, as Apple Music shows backing vocals: their own smaller line under the words, each lit as it is sung */}
          {L.words.some(w => w.harm) && <span className={s.harmRow}>{L.words.filter(w => w.harm).map((w, k, a) => <span key={k} data-h className={s.w}>{w.harm!.text}{k < a.length - 1 ? ' ' : ''}</span>)}</span>}
          {/* readings (softer than translations; one that only repeats the line left out), translations, and a translation's
              bracketed part on a line of its own, as a harmony is */}
          {subLines(L, view.reads !== false).map((x, k) => <small key={k} data-kind={x.kind}>{x.s}</small>)}
        </button>
      ))}
    </div>
  );
}
export { Drive };
