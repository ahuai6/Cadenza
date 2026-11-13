// The lyric list as the now-playing page shows it (Apple Music's way: the sung line sharp, every word lifting as it is
// sung), shared by both appearances: the classic now-playing page and effect lyrics, and the space's lyric list.
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { ui, useStore } from '../state';
import { engine } from '../playback/stage';
import { fontStack, subLines, type LyricLine as Line } from '../../engine';
import s from './NpLyrics.module.css';

/* ---------- lyrics ----------
   Every line is a small mass on a spring toward its place (the line itself moves, so what is under the pointer is what
   is seen). When the sung line changes, the lines above move at once and each line below starts a moment after the one
   above it, so the column flows upward like a wave. Inside the sung line each word lifts on its own as it is sung, and
   fills from the left exactly as far as it is sung — nothing lights up ahead of the voice. A wheel looks around and
   settles back after a moment; clicking a line plays from it. */
const K = 140,
  C = 2 * 0.82 * Math.sqrt(K);
/** How far a word has lifted (0..1, a hair over at the top), as Apple Music lifts it — in stages: a quick first rise as
 *  it is struck (a third of the way in about a tenth of a second), then on with the voice for as long as it is sung (a
 *  slow-in, slow-out curve), and at the end a small float past the top and back, settling. dt: since the word began;
 *  dur: how long it is sung. */
const LIFT = 5;
function liftAt(dt: number, dur: number) {
  if (dt <= 0) return 0;
  const d = Math.max(0.2, dur);
  const strike = 0.32 * (1 - (1 - Math.min(1, dt / 0.11)) ** 3),
    u = Math.min(1, dt / d),
    sung = 0.32 + 0.68 * (u * u * (3 - 2 * u));
  const base = Math.max(strike, dt < 0.11 ? strike : sung),
    v = (dt - d) / 0.5;
  return v <= 0 ? base : 1 + 0.07 * Math.sin(Math.PI * Math.min(1, v)) * (1 - Math.min(1, v));
}
/** A word lit character by character: any word of several characters that is not Latin (it can wrap onto two rows). */
const byUnit = (w: Line['words'][number]) => !w.latin && w.units.length > 1;
interface LS {
  el: HTMLElement;
  y: number;
  v: number;
  ty: number;
  at: number;
  next: number;
}
/** A style written only when it changes: the sung line is painted every frame, but most of its words are sung already or
 *  not yet — writing their same values again made the browser restyle them all each frame for nothing. */
const wrote = new WeakMap<HTMLElement, Record<string, string>>();
/** a wait worth marking: a gap of at least this long (seconds) between the last line's singing and the next line, in the
 *  intro or anywhere in the song; the dots begin this long after the singing is over */
const WAIT_MIN = 5,
  WAIT_AFTER = 0.8;
function put(el: HTMLElement, k: string, v: string) {
  let m = wrote.get(el);
  if (!m) wrote.set(el, (m = {}));
  if (m[k] === v) return;
  m[k] = v;
  if (k === 'translate') el.style.translate = v;
  else el.style.setProperty(k, v);
}
let gens = 0;
export function NpLyrics({ lines, live, compact = false }: { lines: Line[]; live: boolean; compact?: boolean }) {
  const box = useRef<HTMLDivElement>(null),
    lineEls = useRef<(HTMLElement | null)[]>([]),
    view = useStore(ui, (x) => x.npLyr),
    // (each set of lines gets lines of its own: a line of the song before never lends its place — and what was written
    // on it, its words lifted and lit — to a line of this one)
    gen = useMemo(() => ++gens, [lines]);
  // the lyric face chosen for this page (or the interface's own)
  const faceStyle = useMemo(() => {
    if (!view.font || view.font === 'ui') return {};
    const f = fontStack(
      view.font,
      lines
        .map((L) => L.text)
        .join('')
        .slice(0, 200),
    );
    return { fontFamily: f.stack, fontWeight: f.w };
  }, [view.font, lines]);
  const st = useRef({
    tops: [] as number[],
    ls: [] as (LS | null)[],
    cur: -2,
    manual: 0,
    raf: 0,
    last: 0,
    mTm: 0,
    wait: -1,
  });
  // when each line becomes the current one: as it starts — or, as Apple Music does, half a beat early when the line
  // before is sung well before it (a breath of a beat or more): the page is already there when the voice comes in
  const starts = useMemo(() => {
    const map = engine.session?.map;
    return lines.map((L, i) => {
      const P = lines[i - 1],
        bl = map ? map.beatLen(L.t) : 0.5;
      // (a line that starts while the one before is still sounding, by the lyrics' own end, becomes current once that ends)
      const lastW = P?.words.at(-1),
        held = lastW && lastW.endGiven && lastW.end > L.t ? lastW.end : -Infinity;
      return Math.max(held, P && L.t - Math.min(P.sung, P.end) >= bl ? L.t - bl / 2 : L.t - 0.15);
    });
  }, [lines]);
  const findLine = (t: number) => {
    let lo = 0,
      hi = lines.length - 1,
      r = -1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (starts[m] <= t) {
        r = m;
        lo = m + 1;
      } else hi = m - 1;
    }
    return r;
  };
  const step = (now: number) => {
    const S = st.current,
      dt = Math.min(0.05, Math.max(0.001, (now - S.last) / 1000));
    S.last = now;
    let moving = false;
    for (const w of S.ls) {
      if (!w) continue;
      if (now >= w.at && w.ty !== w.next) w.ty = w.next;
      if (w.ty !== w.next) moving = true;
      for (let k = 0; k < 2; k++) {
        const h = dt / 2;
        w.v += (K * (w.ty - w.y) - C * w.v) * h;
        w.y += w.v * h;
      }
      if (Math.abs(w.ty - w.y) > 0.12 || Math.abs(w.v) > 0.3) moving = true;
      else {
        w.y = w.ty;
        w.v = 0;
      }
      w.el.style.transform = `translate3d(0,${w.y.toFixed(2)}px,0)`;
    }
    S.raf = moving ? requestAnimationFrame(step) : 0;
  };
  const kick = () => {
    const S = st.current;
    if (!S.raf) {
      S.last = performance.now();
      S.raf = requestAnimationFrame(step);
    }
  };
  // new places around line idx: a wave when the music moves on, together when the user scrolls, at once when jumping
  const aim = (idx: number, wave: boolean, jump: boolean) => {
    const S = st.current,
      H = box.current ? box.current.clientHeight : 600,
      anchor = H * (compact ? 0.38 : 0.3),
      a = S.tops[Math.max(0, idx)] || 0,
      now = performance.now();
    S.ls.forEach((w, i) => {
      if (!w) return;
      const d = i - idx,
        ty = anchor - a + S.manual;
      w.next = ty;
      w.at = now + (wave ? Math.max(0, Math.min(d + 1, 9)) * 52 : 0);
      if (jump) {
        w.y = w.ty = ty;
        w.v = 0;
        w.at = now;
        w.el.style.transform = `translate3d(0,${ty}px,0)`;
      }
    });
    if (!jump) kick();
  };
  // (one state of light per line: a line timed only as a whole has a single fill and glow on the line itself, which its
  // words, their characters and its harmonies all inherit — none carries one of its own, so no row or character can
  // light at another moment than the rest; a line timed word by word has one on each of its drawn words or characters)
  const leaves = (el: HTMLElement) => el.querySelectorAll<HTMLElement>('[data-w]:not([data-u-w]), [data-u], [data-h]');
  const mark = (idx: number) =>
    lineEls.current.forEach((el, i) => {
      if (!el) return;
      const d = i - idx,
        whole = !lines[i]?.kar;
      // a line left before its last word had lifted all the way: its words go the rest of the way up (softly, by the
      // transition) and stay there, never held half-way — and it stays lit, as sung
      if (d !== 0 && el.dataset.on === 'true') {
        leaves(el).forEach((w) => {
          if (w.style.translate && !whole) put(w, 'translate', `0 ${w.dataset.h != null ? -LIFT * 0.6 : -LIFT}px`);
          if (!whole) put(w, '--p', '1');
        });
        if (whole) put(el, '--p', '1');
      }
      // a line still to come holds nothing from an earlier pass (a seek back, or the line of another song that had this
      // place): its words wait at rest, unlit — never lifted, to drop the moment its voice comes in
      if (d > 0 && el.dataset.sung === 'true') {
        leaves(el).forEach((w) => {
          put(w, 'translate', '');
          put(w, '--p', '0');
          put(w, '--gl', '0');
        });
        put(el, '--p', '0');
        put(el, '--gl', '0');
        delete el.dataset.sung;
      }
      if (d <= 0) el.dataset.sung = 'true';
      // (becoming current, a line timed as a whole starts from dark on the line itself, its parts holding nothing of their own)
      if (d === 0 && whole) {
        leaves(el).forEach((w) => {
          w.style.removeProperty('--p');
          w.style.removeProperty('--gl');
          const m = wrote.get(w);
          if (m) {
            delete m['--p'];
            delete m['--gl'];
          }
        });
        put(el, '--p', '0');
        put(el, '--gl', '0');
      }
      el.style.setProperty('--d', String(Math.min(5, Math.abs(d))));
      el.dataset.on = String(d === 0);
    });
  const measure = () => {
    const S = st.current;
    lineEls.current.forEach((el) => {
      if (el) el.style.transform = '';
    });
    S.tops = lineEls.current.map((el) => (el ? el.offsetTop : 0));
    S.ls = lineEls.current.map((el) => (el ? { el, y: 0, v: 0, ty: 0, at: 0, next: 0 } : null));
  };
  useLayoutEffect(() => {
    // (before the first line: none is current — the first is not lit before it is sung)
    const S = st.current;
    measure();
    const i = findLine(engine.time);
    S.cur = i;
    mark(i);
    aim(i, false, true);
    const ro = new ResizeObserver(() => {
      const keep = S.ls;
      measure();
      S.ls.forEach((w, i) => {
        const o = keep[i];
        if (w && o) {
          w.y = o.y;
          w.v = o.v;
        }
      });
      aim(S.cur, false, true);
    });
    if (box.current) ro.observe(box.current);
    return () => {
      cancelAnimationFrame(S.raf);
      S.raf = 0;
      ro.disconnect();
    };
  }, [lines, view.size, view.subs, view.reads]); // (a new size or the translations shown or not: the lines are measured again)
  useEffect(() => {
    if (!live) return;
    const S = st.current,
      i0 = findLine(engine.time);
    if (i0 !== S.cur) {
      S.cur = i0;
      mark(i0);
      aim(i0, false, true);
    } // catch up after being away
    return engine.on('tick', (p) => {
      const i = findLine(p.t);
      if (i !== S.cur) {
        S.cur = i;
        mark(i);
        aim(i, !S.manual, false);
      }
      // a long wait (the intro, a break): the line to come is already in its place, three dots over it filling with the
      // wait itself — when the voice comes in the line only lights, it does not arrive
      {
        const N = lines[i + 1],
          // (from when the singing is over — not when the line stops being current, a few bars later)
          sungEnd = i < 0 ? 0 : lines[i].sung,
          from = i < 0 ? 0 : sungEnd + WAIT_AFTER,
          to = N ? starts[i + 1] : 0,
          w = N && to - sungEnd >= WAIT_MIN && to - from >= 2 && p.t >= from && p.t < to ? i + 1 : -1;
        if (w !== S.wait) {
          const was = lineEls.current[S.wait];
          if (was) delete was.dataset.wait;
          S.wait = w;
          const el = lineEls.current[w];
          if (el) {
            el.dataset.wait = 'true';
            if (!S.manual) aim(w, true, false);
          }
        }
        if (w >= 0) {
          const el = lineEls.current[w];
          if (el) put(el, '--wait', Math.min(1, (p.t - from) / (to - from)).toFixed(3));
        }
      }
      // (the current line — and a line already begun under it, still waiting to be current: its words are sung meanwhile)
      paint(i);
      if (lines[i + 1] && p.t >= lines[i + 1].t) paint(i + 1);
      function paint(i: number) {
        const L = lines[i],
          el = lineEls.current[i];
        if (!L || !el) return;
        const ws = el.querySelectorAll<HTMLElement>('[data-w]'),
          lvl = p.rs ? p.rs.level : 0.5;
        // a line timed only as a whole lights as a whole, at once, from the moment it is the current line (or its own time,
        // if that is sooner), as Apple Music does: one fill on the line — never dark while current, never faded in
        const t0w = Math.min(starts[i] ?? L.t, L.t);
        if (!L.kar) {
          const on = p.t >= t0w ? 1 : 0;
          put(el, '--p', String(on));
          put(el, '--gl', (0.6 * lvl * on).toFixed(3));
        }
        // each word: its fill (how far it is sung), its glow (only once it is all but sung) and its own lift as it is sung
        L.words.forEach((w, k) => {
          const e = ws[k];
          if (!e) return;
          // (a word is all sung by the time the next one starts: with no gap, or a tiny one, it does not trail on under it)
          const nx = L.words[k + 1],
            end = nx && nx.t > w.t ? Math.min(w.end, nx.t) : w.end;
          const fill = (el: HTMLElement, t0: number, t1: number) => {
            const q = Math.min(1, Math.max(0, (p.t - t0) / Math.max(0.08, t1 - t0))),
              gl = Math.min(1, Math.max(0, (q - 0.6) / 0.4));
            put(el, '--p', q.toFixed(3));
            put(el, '--gl', (gl * gl * lvl).toFixed(3));
            put(el, 'translate', `0 ${(-LIFT * liftAt(p.t - t0, t1 - t0)).toFixed(2)}px`);
          };
          // a word drawn character by character (one that may wrap onto the next row): each character fills in its own
          // time, so a second row lights up only once it is sung
          if (byUnit(w) && L.kar) {
            const us = e.querySelectorAll<HTMLElement>('[data-u]'),
              n = w.units.length,
              span = Math.max(0.08, w.end - w.t);
            const at = (i: number) => w.units[i]?.t ?? w.t + (span * 0.85 * i) / n;
            us.forEach((u, i) => fill(u, at(i), i + 1 < n ? at(i + 1) : end));
          }
          // (a line timed only as a whole: lit on the line itself, above — its words do not lift one by one: that is a
          // word being sung, which a line timed as a whole has none of)
          else if (!L.kar) put(e, 'translate', '');
          else fill(e, w.t, end);
        });
        // the harmonies: each from its own first sound to its last (at least as long as the word it goes with)
        const hs = el.querySelectorAll<HTMLElement>('[data-h]');
        L.words
          .filter((w) => w.harm)
          .forEach((w, k) => {
            const e = hs[k],
              H = w.harm!;
            if (!e) return;
            // (a line timed only as a whole: its harmonies light with it, at once, as its words do)
            if (!L.kar) {
              put(e, 'translate', '');
              return;
            }
            const t0 = isFinite(H.t) ? H.t : w.t,
              last = H.units[H.units.length - 1]?.t ?? t0;
            const t1 = Math.max(t0 + 0.3, last + 0.25, w.end),
              q = Math.min(1, Math.max(0, (p.t - t0) / Math.max(0.08, t1 - t0)));
            put(e, '--p', q.toFixed(3));
            put(e, 'translate', `0 ${(-LIFT * 0.6 * liftAt(p.t - t0, t1 - t0)).toFixed(2)}px`);
          });
      }
    });
  }, [lines, live]);
  const wheel = (e: React.WheelEvent) => {
    const S = st.current;
    S.manual -= e.deltaY;
    clearTimeout(S.mTm);
    aim(S.cur, false, false);
    if (box.current) box.current.dataset.manual = 'true';
    S.mTm = window.setTimeout(() => {
      S.manual = 0;
      aim(S.cur, false, false);
      if (box.current) box.current.dataset.manual = 'false';
    }, 2600);
  };
  return (
    <div
      data-np-lyr
      className={s.lyr + (compact ? ' ' + s.compact : '')}
      ref={box}
      onWheel={wheel}
      data-blur={view.blur}
      data-subs={view.subs}
      style={{ ['--np-fs' as string]: view.size, ...faceStyle } as React.CSSProperties}
    >
      {lines.map((L, i) => (
        <button
          key={gen + ':' + i}
          type="button"
          data-test="line"
          className={s.line}
          data-whole={!L.kar || undefined}
          ref={(el) => {
            lineEls.current[i] = el;
          }}
          onClick={() => {
            st.current.manual = 0;
            engine.seek(Math.max(0, L.t - 0.05));
            if (!engine.isPlaying) engine.play();
          }}
        >
          <i className={s.dots} aria-hidden>
            <i />
            <i />
            <i />
          </i>
          {L.words.length ? (
            L.words.map((w, k) => (
              <Fragment key={k}>
                {byUnit(w) ? (
                  <span data-w data-u-w className={s.wu}>
                    {w.units.map((u, i) => (
                      <span key={i} data-u className={s.w}>
                        {u.c}
                        {
                          /* (the lyrics' own space after the word rides on its last character) */ i ===
                            w.units.length - 1 &&
                          k < L.words.length - 1 &&
                          w.gap
                            ? ' '
                            : ''
                        }
                      </span>
                    ))}
                  </span>
                ) : (
                  <span data-w className={s.w}>
                    {w.disp ?? w.text}
                    {k < L.words.length - 1 && (w.gap ?? (w.latin && L.words[k + 1].latin)) ? ' ' : ''}
                  </span>
                )}
              </Fragment>
            ))
          ) : (
            <span data-w className={s.w}>
              {L.text}
            </span>
          )}
          {/* the harmonies, as Apple Music shows backing vocals: their own smaller line under the words, each lit as it is sung */}
          {L.words.some((w) => w.harm) && (
            <span className={s.harmRow}>
              {L.words
                .filter((w) => w.harm)
                .map((w, k, a) => (
                  <span key={k} data-h className={s.w}>
                    {w.harm!.text}
                    {k < a.length - 1 ? ' ' : ''}
                  </span>
                ))}
            </span>
          )}
          {/* readings (softer than translations; one that only repeats the line left out), translations, and a translation's
              bracketed part on a line of its own, as a harmony is */}
          {subLines(L, view.reads !== false).map((x, k) => (
            <small key={k} data-kind={x.kind}>
              {x.s}
            </small>
          ))}
        </button>
      ))}
    </div>
  );
}
