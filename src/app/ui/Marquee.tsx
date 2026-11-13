// Text that never ends in an ellipsis: when it fits it simply stands; when it is longer than its place it slides slowly
// to its end and back (a pause at each end), the edges fading, so the whole of it can be read.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import s from './Marquee.module.css';

export function Marquee({ children, className }: { children: ReactNode; className?: string }) {
  const box = useRef<HTMLSpanElement>(null),
    inner = useRef<HTMLSpanElement>(null),
    [d, setD] = useState(0);
  useLayoutEffect(() => {
    const b = box.current,
      i = inner.current;
    if (!b || !i) return;
    // (not laid out — a page not shown, display: none — measures nothing: what was measured stands. Measured then as
    // all overflow, the text was set scrolling and set back the moment the page showed, a flash every time it opened)
    const f = () => {
      if (!b.getClientRects().length) return;
      setD(Math.max(0, Math.ceil(i.scrollWidth - b.clientWidth)));
    };
    f();
    const ro = new ResizeObserver(f);
    ro.observe(b);
    ro.observe(i);
    return () => ro.disconnect();
  }, [children]);
  const run = d > 1;
  // (the time: the distance at about 28 px a second, and the pauses)
  return (
    <span
      ref={box}
      className={s.mq + (className ? ' ' + className : '')}
      data-run={run || undefined}
      style={run ? ({ '--mq-d': `${d}px`, '--mq-t': `${(4 + d / 28).toFixed(1)}s` } as React.CSSProperties) : undefined}
    >
      <span ref={inner} className={s.in}>
        {children}
      </span>
    </span>
  );
}
