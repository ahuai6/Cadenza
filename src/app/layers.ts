// The listening dock and the lyric spread share one reversible motion. Layout is measured at its endpoints;
// the frame loop only moves the artwork and reveals the spread within the expanding surface.
import { Drive, duration, part, rectOf, restRect, type Box } from './motion';
import { engine } from './playback/stage';
import { ui, settings } from './state';
import { ASPECTS } from '../engine';
import { fxAspect } from './playback/player';
import { DEFAULT_LYRIC_ASPECT } from '../theme/style';

export const refs = {
  titlebar: null as HTMLElement | null,
  stage: null as HTMLElement | null,
  np: null as HTMLElement | null,
  spread: null as HTMLElement | null,
  npCover: null as HTMLElement | null,
  dock: null as HTMLElement | null,
  dockCover: null as HTMLElement | null,
  card: null as HTMLElement | null,
  fxUi: null as HTMLElement | null,
};

let surface: Box | null = null;
let artwork: { from: Box; to: Box } | null = null;
let chromeBottom = 0;
const centerY = (box: Box) => box.top + box.height / 2;
function measure() {
  chromeBottom = refs.titlebar?.getBoundingClientRect().bottom ?? 0;
  surface = refs.dock ? rectOf(refs.dock) : null;
  const from = refs.dockCover ? rectOf(refs.dockCover) : null;
  const to = refs.npCover ? restRect(refs.npCover) : null;
  // The desktop endpoints share an artwork centerline. A bottom dock or a stacked reading layout uses a fade.
  artwork =
    from && to && from.width > 0 && to.width > 0 && Math.abs(centerY(from) - centerY(to)) < 0.75 ? { from, to } : null;
}

function applyNp(value: number) {
  const p = Math.max(0, Math.min(1, value));
  const { titlebar, stage, np, spread, npCover, dock, card } = refs;
  const fx = engine.view === 'effect';
  const on = p > 0;
  const remaining = 1 - p;
  const from = surface || { left: innerWidth, top: chromeBottom, width: 0, height: innerHeight - chromeBottom };
  const top = chromeBottom + Math.max(0, from.top - chromeBottom) * remaining;
  const edge = `inset(${top.toFixed(2)}px ${((innerWidth - from.left - from.width) * remaining).toFixed(2)}px ${((innerHeight - from.top - from.height) * remaining).toFixed(2)}px ${(from.left * remaining).toFixed(2)}px)`;
  const sample = p.toFixed(4);
  if (titlebar) {
    const shade = part(p, 0.12, 0.93);
    titlebar.style.setProperty('--header-shade', shade.toFixed(4));
    titlebar.toggleAttribute('data-dark-stage', shade >= 0.55);
  }
  if (spread) {
    spread.style.clipPath = edge;
    spread.style.setProperty('--spread', sample);
    spread.dataset.vis = String(on && !fx);
  }
  if (stage) {
    stage.dataset.vis = String(on || fx);
    stage.style.clipPath = on && !fx ? edge : '';
    stage.style.setProperty('--picture-progress', part(p, 0.14, 0.92).toFixed(4));
  }
  if (np) {
    np.dataset.vis = String(on && !fx);
    np.style.setProperty('--spread', sample);
    np.style.setProperty('--spread-info', part(p, 0.35, 0.92).toFixed(4));
    np.style.setProperty('--spread-lyrics', part(p, 0.25, 0.92).toFixed(4));
  }
  if (dock) {
    dock.dataset.expanding = String(on);
    dock.style.setProperty('--dock-content', (1 - part(p, 0, 0.44)).toFixed(4));
    dock.style.setProperty('--dock-cover', artwork ? (on ? '0' : '1') : (1 - part(p, 0.03, 0.26)).toFixed(4));
  }
  card?.style.setProperty('--stage', sample);
  if (npCover) {
    const a = artwork;
    if (a && on && p < 1) {
      const x = (a.from.left + a.from.width / 2 - a.to.left - a.to.width / 2) * remaining;
      const scale = p + remaining * (a.from.width / a.to.width);
      npCover.style.transform = `translateX(${x}px) scale(${scale})`;
    } else npCover.style.transform = '';
    npCover.style.setProperty('--spread-cover', a ? '1' : part(p, 0.24, 0.61).toFixed(4));
  }
}
const np = new Drive(0, applyNp, { stiffness: 188, damping: 24 });
export const npProgress = () => np.x;
export const npDrive = np;
export function refreshSpread() {
  if (np.x <= 0) return;
  measure();
  applyNp(np.x);
}
addEventListener('resize', refreshSpread);

/* The engine prewarms the ambient frame during idle time. It remains behind the closed dock. */
let warmed: unknown = null;
let warming = false;
engine.on('frame', () => {
  if (!refs.stage || warming || np.x || ui.get().layer !== 'none' || !engine.session || warmed === engine.session)
    return;
  warming = true;
  const run = () => {
    warming = false;
    if (!np.x && ui.get().layer === 'none' && engine.warmPicture()) warmed = engine.session;
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 800 });
  else setTimeout(run, 200);
});

/* ---------- np ⇄ fx: a full-screen blur ---------- */
/** The song's own deepest tone (its cover's base colour, sunk most of the way to black): the effect view's letterbox
 *  and the blur's veil take it, so they sit with the play page instead of a fixed near-black. */
function deepTone(): [number, number, number] {
  const A = engine.session?.ambient;
  const b = A ? A.base : [10, 8, 16];
  return [0, 1, 2].map((i) => Math.round(b[i] * 0.22 + 4)) as [number, number, number];
}
const hex = (c: number[]) => '#' + c.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
const veil = document.createElement('div');
Object.assign(veil.style, { position: 'fixed', inset: '0', zIndex: '60', pointerEvents: 'none', display: 'none' });
document.body.appendChild(veil);
let veilK = 0;
const setVeil = (k: number) => {
  veilK = k;
  veil.style.display = k > 0.002 ? '' : 'none';
  const b = (k * 26).toFixed(1);
  // (lite: no backdrop blur — the veil dims a little more instead)
  const lite = document.documentElement.dataset.gfx === 'lite';
  veil.style.backdropFilter = lite ? 'none' : `blur(${b}px) saturate(${(1 + 0.15 * k).toFixed(3)})`;
  veil.style.background = `rgba(${deepTone().join(',')}, ${((lite ? 0.62 : 0.18) * k).toFixed(3)})`;
};
const frame = () => new Promise<number>((r) => requestAnimationFrame(r));
// (one tween drives the veil at a time: a newer one, of this request or a later one, takes it over from where it is)
let veilTok = 0;
async function tween(to: number, ms: number, ease: (u: number) => number, my: number) {
  if (!ms) {
    setVeil(to);
    return my === tok;
  }
  const from = veilK,
    t0 = performance.now(),
    mine = ++veilTok;
  for (;;) {
    const u = Math.min(1, (performance.now() - t0) / ms);
    setVeil(from + (to - from) * ease(u));
    if (u >= 1) return true;
    await frame();
    if (my !== tok || mine !== veilTok) return false;
  }
}
const easeIn = (u: number) => u * u * (3 - 2 * u) * 0.4 + u * u * 0.6,
  easeOut = (u: number) => 1 - (1 - u) ** 3;
/** Soften everything, change what is underneath, give it two frames to draw, and bring it back into focus. */
async function blurSwap(swap: () => void, my: number) {
  if (!duration('--t-enter')) {
    swap();
    document.documentElement.dataset.fxbar = document.documentElement.dataset.fxmode;
    setVeil(0);
    return true;
  }
  if (!(await tween(1, duration('--t-med'), easeIn, my))) return false;
  swap();
  await frame();
  await frame();
  // the title bar follows the clearing, not the swap: it shows again only once the blur starts to lift (two slow first
  // frames of the new view would otherwise let it fade in over a picture still fully blurred)
  document.documentElement.dataset.fxbar = document.documentElement.dataset.fxmode;
  if (my !== tok) return false;
  return tween(0, duration('--t-panel'), easeOut, my);
}
/** The effect lyrics' frame shape (Settings: 16:9, 16:10, 9:16, 1:1), as a ratio. */
const fxRatio = () => ASPECTS[fxAspect()] || ASPECTS[DEFAULT_LYRIC_ASPECT];
const toFx = () => {
  document.documentElement.dataset.fxmode = 'true';
  if (refs.stage) refs.stage.style.clipPath = '';
  engine.setAspectBox(fxRatio(), hex(deepTone()));
  engine.setView('effect', {}, { instant: true });
  syncFx();
  applyNp(np.x);
};
const toNp = () => {
  document.documentElement.dataset.fxmode = 'false';
  engine.setAspectBox({ cover: fxRatio() });
  engine.setView('ambient', {}, { instant: true });
  syncFx();
  applyNp(np.x);
};
// the page and the effect controls follow the view (the page hides under the effect lyrics; their controls show)
function syncFx() {
  const h = engine.view === 'effect' ? 1 : 0,
    el = refs.np,
    s = String(h);
  if (el) {
    el.style.setProperty('--h', s);
    el.dataset.flying = 'false';
    el.dataset.fx = String(h > 0);
  }
  if (refs.fxUi) refs.fxUi.style.setProperty('--h', s);
}
engine.setAspectBox({ cover: fxRatio() });
// (the shape changed while the effect lyrics are up: the picture's box takes it at once)
settings.subscribe((x, y) => {
  if (x.fxAspect !== y.fxAspect)
    engine.setAspectBox(engine.view === 'effect' ? fxRatio() : { cover: fxRatio() }, hex(deepTone()));
});
engine.on('frame', () => {
  const el = refs.np;
  if (el && el.dataset.fx !== String(engine.view === 'effect')) syncFx();
});

/* ---------- the requests ---------- */
let tok = 0;
async function go(target: 'none' | 'np' | 'fx') {
  const my = ++tok;
  // a request that interrupts a blur leaves the veil wherever it was: when this one does not go straight into a blur of
  // its own (which starts from the veil as it is), the veil clears now instead of staying over everything
  const swapsNow = engine.view === 'effect' ? target !== 'fx' : target === 'fx' && np.x >= 0.999 && np.target === 1;
  if (!swapsNow && veilK > 0) {
    document.documentElement.dataset.fxbar = document.documentElement.dataset.fxmode;
    void tween(0, duration('--t-enter'), easeOut, my);
  }
  if (target === 'none') {
    if (engine.view === 'effect') {
      if (!(await blurSwap(toNp, my))) return;
    }
    measure();
    const done = await np.to(0);
    if (!done || my !== tok) return;
    engine.setView('hidden');
    applyNp(0);
    return;
  }
  if (engine.view === 'hidden') engine.setView('ambient');
  if (np.x < 0.999 || np.target !== 1) {
    if (engine.view === 'effect') {
      if (!(await blurSwap(toNp, my))) return;
    }
    if (np.x < 0.0005 && !refs.npCover) {
      await frame();
      await frame();
      if (my !== tok) return;
    }
    measure();
    const done = np.to(1);
    if (target === 'np') {
      await done;
      return;
    }
    if (!(await done) || my !== tok) return;
  }
  if (target === 'np') {
    if (engine.view === 'effect') await blurSwap(toNp, my);
    return;
  }
  if (engine.view !== 'effect') await blurSwap(toFx, my);
}
// (which layer is up, for the stylesheet: with none, the picture never takes the pointer — the page under it does)
document.documentElement.dataset.layer = ui.get().layer;
// back in a window that was hidden (closed to the tray, minimised): a close the hidden window never finished drawing is
// finished now, so nothing half-shown is left over the page
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || ui.get().layer !== 'none') return;
  if (np.target === 0) {
    if (np.x > 0) np.jump?.(0);
    if (engine.view !== 'effect') {
      engine.setView('hidden');
      applyNp(0);
    }
    if (refs.stage) refs.stage.style.opacity = '';
  }
});
ui.subscribe((s, prev) => {
  if (s.layer !== prev.layer) {
    document.documentElement.dataset.layer = s.layer;
    go(s.layer);
  }
  if (s.win.full !== prev.win.full) {
    document.documentElement.dataset.winfull = String(s.win.full);
    if (np.x > 0 && engine.view !== 'effect') {
      measure();
      applyNp(np.x);
    }
  }
});
document.documentElement.dataset.winfull = String(ui.get().win.full);
export const openNp = () => ui.set({ layer: 'np', queue: false });
export const openFx = () => ui.set({ layer: 'fx', queue: false });
/** One step back: effect lyrics → now playing → the page. */
export const back = () => {
  const l = ui.get().layer;
  ui.set({ layer: l === 'fx' ? 'np' : 'none' });
};
