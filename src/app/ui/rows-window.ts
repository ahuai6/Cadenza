// A long list of rows of one height draws only the rows near the scroller's view: the rows above and below are space,
// so a library of thousands of songs costs what one screen of it costs. The row height is read from a drawn row (and
// again when the window or the text size changes it).
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** rows drawn beyond each edge of the view, so a quick scroll does not show blank space before they are drawn */
const OVERSCAN = 12;
/** fewer rows than this are always all drawn (cheap, and every row stays reachable by find-in-page and tabbing) */
export const WINDOW_MIN = 160;
/** the height assumed for a row before one is measured (px; the songs' rows: 72 px and 4 px padding) */
const FIRST_GUESS = 80;

export function useRowsWindow(count: number, enabled: boolean, box: RefObject<HTMLElement | null>) {
  const on = enabled && count >= WINDOW_MIN;
  const [range, setRange] = useState({ from: 0, to: on ? Math.min(count, 2 * OVERSCAN) : count });
  const height = useRef(FIRST_GUESS);
  const update = useCallback(() => {
    const el = box.current;
    if (!el || !on) return;
    const scroller = el.closest<HTMLElement>('[data-scroll]') || document.documentElement;
    const row = el.querySelector<HTMLElement>('[role="listitem"]');
    if (row && row.offsetHeight > 0) height.current = row.offsetHeight;
    const h = height.current;
    const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    const start = Math.max(0, -top),
      end = start + scroller.clientHeight;
    const from = Math.max(0, Math.floor(start / h) - OVERSCAN),
      to = Math.min(count, Math.ceil(end / h) + OVERSCAN);
    setRange((r) => (r.from === from && r.to === to ? r : { from, to }));
  }, [box, count, on]);
  useLayoutEffect(() => {
    if (!on) setRange((r) => (r.from === 0 && r.to === count ? r : { from: 0, to: count }));
    else update();
  }, [on, count, update]);
  useEffect(() => {
    const el = box.current;
    if (!el || !on) return;
    const scroller = el.closest<HTMLElement>('[data-scroll]') || window;
    let frame = 0;
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    scroller.addEventListener('scroll', later, { passive: true });
    const resize = new ResizeObserver(later);
    resize.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener('scroll', later);
      resize.disconnect();
    };
  }, [box, on, update]);
  const from = on ? Math.min(range.from, count) : 0,
    to = on ? Math.min(range.to, count) : count;
  /** Scroll so that row `i` is in the middle of the view (it is then drawn). */
  const reveal = useCallback(
    (i: number) => {
      const el = box.current;
      if (!el) return;
      const scroller = el.closest<HTMLElement>('[data-scroll]');
      if (!scroller) return;
      const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
      scroller.scrollTop = top + i * height.current - scroller.clientHeight / 2 + height.current / 2;
      update();
    },
    [box, update],
  );
  return {
    on,
    from,
    to,
    padTop: from * height.current,
    padBottom: (count - to) * height.current,
    reveal,
  };
}
