// The lyrics on the desktop (their own window, electron/desk.cjs): three lines over whatever is on the screen — the
// one being sung, large, lighting character by character as it is sung, and the two after it, smaller. Unlocked, the
// window is dragged by its lines and its buttons show when the pointer is over it (lock, smaller, larger, close);
// locked, it shows only the lyrics and the pointer goes through it. Fed by the main window (playback/desk.ts).
import { useEffect, useRef, useState } from 'react';
import { tx } from '../../i18n';
import { D, type DeskFeed, type DeskState } from '../bridge';
import { Icon } from './icons';
import s from './DeskLyrics.module.css';

export function DeskLyrics() {
  const [feed, setFeed] = useState<DeskFeed | null>(null),
    [st, setSt] = useState<DeskState>({ locked: false, size: 34 }),
    got = useRef(0),
    box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    document.documentElement.dataset.desk = '';
    D?.deskState?.().then((x) => x && setSt(x));
    const a = D?.onDeskFeed?.((d) => {
        got.current = performance.now();
        setFeed(d);
      }),
      b = D?.onDeskState?.((x) => setSt(x));
    return () => {
      a?.();
      b?.();
    };
  }, []);
  // the song's time runs on from the last feed while it plays: each character of the line being sung lights as its
  // moment comes (written straight to the page: no render per frame)
  useEffect(() => {
    let raf = 0;
    const step = () => {
      raf = requestAnimationFrame(step);
      const el = box.current;
      if (!el || !feed) return;
      const t = feed.t + (feed.playing ? (performance.now() - got.current) / 1000 : 0);
      el.querySelectorAll<HTMLElement>('[data-t]').forEach((u) => {
        const on = t >= +u.dataset.t!;
        if ((u.dataset.on === '') !== on) on ? (u.dataset.on = '') : delete u.dataset.on;
      });
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [feed]);
  const lines = feed?.lines || [];
  return (
    <div
      className={s.desk}
      data-locked={st.locked || undefined}
      style={{ '--fs': st.size + 'px' } as React.CSSProperties}
    >
      <div className={s.lines} ref={box}>
        {lines.map((L, i) => (
          <p key={L.t + ':' + i} className={s.line} data-now={i === feed!.cur || undefined}>
            {L.units.some((u) => u.t != null)
              ? L.units.map((u, k) => (
                  <span key={k} data-t={u.t ?? undefined}>
                    {u.c}
                    {u.sp ? ' ' : ''}
                  </span>
                ))
              : L.text}
          </p>
        ))}
      </div>
      {!st.locked && (
        <nav className={s.tools}>
          <button
            type="button"
            title={tx('s.desk.lock')}
            aria-label={tx('s.desk.lock')}
            onClick={() => D?.deskOp?.('lock')}
          >
            <Icon n="lock" size={15} />
          </button>
          <button
            type="button"
            title={tx('s.desk.smaller')}
            aria-label={tx('s.desk.smaller')}
            onClick={() => D?.deskOp?.('smaller')}
          >
            A−
          </button>
          <button
            type="button"
            title={tx('s.desk.bigger')}
            aria-label={tx('s.desk.bigger')}
            onClick={() => D?.deskOp?.('bigger')}
          >
            A+
          </button>
          <button
            type="button"
            title={tx('s.desk.close')}
            aria-label={tx('s.desk.close')}
            onClick={() => D?.deskOp?.('close')}
          >
            <Icon n="close" size={15} />
          </button>
        </nav>
      )}
    </div>
  );
}
