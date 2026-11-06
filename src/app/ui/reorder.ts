// Dragging rows into a new order: a row follows the pointer once it has moved a few pixels (so clicks and double-clicks
// still work), the rows it passes make room, the scroller scrolls at its edges, and the new order shows at once
// (onReorder saves it behind).
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPE } from 'react';

interface Drag { i: number; j: number; y0: number; s0: number; page: HTMLElement | null; on: boolean; pid: number; row: HTMLElement; last: number; h: number; tick: number }
export function useReorder<T>(items: T[], onReorder: ((list: T[]) => void) | null | undefined, { scroller = '[data-scroll]', ignore = 'button' } = {}) {
  const [local, setLocal] = useState<T[] | null>(null), box = useRef<HTMLDivElement>(null), drag = useRef<Drag | null>(null);
  useEffect(() => { setLocal(null); }, [items]);
  const shown = local || items;
  useLayoutEffect(() => { if (box.current) for (const r of box.current.children as HTMLCollectionOf<HTMLElement>) { r.style.transition = 'none'; r.style.transform = ''; r.dataset.drag = ''; } }, [shown]);
  const ease = 'transform var(--t-fade) var(--ease)';   // (the tokens: tokens.css)
  const layout = () => {
    const d = drag.current; if (!d || !box.current) return;
    const dy = d.last - d.y0 + (d.page ? d.page.scrollTop - d.s0 : 0);
    if (!d.on) { if (Math.abs(dy) < 5) return; d.on = true; try { d.row.setPointerCapture(d.pid); } catch { /* gone */ } d.row.dataset.drag = 'true';
      d.h = d.row.offsetHeight + (parseFloat(getComputedStyle(box.current).rowGap) || 0);
      for (const r of box.current.children as HTMLCollectionOf<HTMLElement>) r.style.transition = r === d.row ? 'none' : ease;
      // (the edge scroll on animation frames, at 750 px a second by the time since the last — the same speed and as smooth
      // at any refresh rate; a 16 ms timer held it to 60 steps a second)
      let at = 0; const edge = (now: number) => { if (drag.current !== d) return; const dt = Math.min(0.05, at ? (now - at) / 1000 : 1 / 60); at = now;
        const p = d.page; if (p) { const r = p.getBoundingClientRect(), v = d.last < r.top + 50 ? -750 : d.last > r.bottom - 60 ? 750 : 0; if (v) { p.scrollTop += v * dt; layout(); } }
        d.tick = requestAnimationFrame(edge); };
      d.tick = requestAnimationFrame(edge); }
    const n = shown.length, j = Math.max(0, Math.min(n - 1, d.i + Math.round(dy / d.h))); d.j = j;
    [...(box.current.children as HTMLCollectionOf<HTMLElement>)].forEach((r, k) => { if (k === d.i) { r.style.transform = `translateY(${dy}px)`; return; }
      const sh = k > d.i && k <= j ? -d.h : k < d.i && k >= j ? d.h : 0; r.style.transform = sh ? `translateY(${sh}px)` : ''; });
  };
  const down = (e: RPE<HTMLElement>, i: number) => {
    if (!onReorder || e.button !== 0 || (e.target as HTMLElement).closest(ignore) || !box.current) return;
    const page = box.current.closest(scroller) as HTMLElement | null;
    drag.current = { i, j: i, y0: e.clientY, s0: page ? page.scrollTop : 0, page, on: false, pid: e.pointerId, row: e.currentTarget, last: e.clientY, h: 1, tick: 0 };
  };
  const move = (e: RPE) => { if (drag.current) { drag.current.last = e.clientY; layout(); } };
  const up = () => { const d = drag.current; drag.current = null; if (!d || !box.current) return; cancelAnimationFrame(d.tick); if (!d.on) return;
    // the click that ends a drag is not a click on the row
    const eat = (e: Event) => { e.stopPropagation(); e.preventDefault(); }; addEventListener('click', eat, true); setTimeout(() => removeEventListener('click', eat, true), 0);
    if (d.j === d.i) { for (const r of box.current.children as HTMLCollectionOf<HTMLElement>) { r.style.transition = ease; r.style.transform = ''; } d.row.dataset.drag = ''; return; }
    const next = shown.slice(); const [x] = next.splice(d.i, 1); next.splice(d.j, 0, x);
    setLocal(next); onReorder!(next); };
  return { shown, down, listProps: { ref: box, onPointerMove: move, onPointerUp: up, onPointerCancel: up } };
}
