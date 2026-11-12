// The layers and the moves between them, run from one place (docs/DESIGN.md, 動態):
//   none ⇄ np   the sheet (the library's paper) and the stage (the play page and its picture). One spring progress, p:
//               0 the sheet is up and covers the stage; 1 the sheet is away below the window and the stage is whole.
//               In between, both move as one: the sheet slides down as the stage comes forward (grows from 0.9, moves
//               down 36 px into place, brightens) — and back the same way, so a reversal mid-way simply turns. Nothing
//               flies between the two: the bar's small cover fades in as the stage's leaves, each in its own place.
//   np ⇄ fx     a full-screen blur: everything softens, the view changes underneath (the page hides, the picture becomes
//               the effect lyrics at 16:9 over the whole window), and it all comes back into focus. Nothing has to fly
//               between two renderings of the same thing, so nothing can flicker, change colour or jump.
import { Drive, part } from './motion';
import { engine } from './playback/stage';
import { ui, settings } from './state';
import { ASPECTS } from '../engine';
import { fxAspect } from './playback/player';

export const refs = {
  sheet: null as HTMLElement | null,
  stage: null as HTMLElement | null,
  np: null as HTMLElement | null,
  npAmb: null as HTMLElement | null,
  npCover: null as HTMLElement | null,
  npParts: [] as (HTMLElement | null)[],
  card: null as HTMLElement | null,
  mini: null as HTMLElement | null,
  fxUi: null as HTMLElement | null,
};

/* ---------- none ⇄ np ---------- */
/** how far back the stage stands under the sheet: its size, its lift (px) and its light */
const BACK_SCALE = 0.9,
  BACK_LIFT = 36,
  BACK_LIGHT = 0.18;
/** (kept for the callers that measured the old flight: the sheet's move needs no measuring) */
const measure = () => {};
function applyNp(p: number) {
  const { stage, np, sheet, mini, card } = refs;
  if (!stage || !np) return;
  const on = p > 0.0005,
    rest = p >= 0.9995;
  np.dataset.vis = String(on);
  stage.dataset.vis = String(on || engine.view === 'effect');
  // the stage: forward as the sheet leaves (one transform and one opacity on layers of their own: nothing is repainted)
  const back = rest
      ? ''
      : `translate3d(0,${(-BACK_LIFT * (1 - p)).toFixed(2)}px,0) scale(${(BACK_SCALE + (1 - BACK_SCALE) * p).toFixed(4)})`,
    light = rest ? '' : (BACK_LIGHT + (1 - BACK_LIGHT) * p).toFixed(3);
  for (const el of [stage, np, refs.npAmb]) {
    if (!el) continue;
    el.style.transform = back;
    el.style.opacity = light;
  }
  if (refs.npAmb) refs.npAmb.dataset.vis = String(on);
  // the sheet: down by its own height (and a little more, for its shadow), gone once away
  if (sheet) {
    sheet.style.transform = on ? `translate3d(0,${(p * innerHeight).toFixed(1)}px,0)` : '';
    sheet.style.visibility = rest ? 'hidden' : '';
  }
  // the bar: over the stage it is clear and says nothing of the song (the stage does); over the sheet it is the sheet's
  // own colour and carries the small cover and the title
  if (card) card.style.setProperty('--stage', p.toFixed(3));
  if (mini) mini.style.visibility = '';
  // the stage's own words arrive as it lands
  const q = part(p, 0.45, 0.95);
  for (const el of refs.npParts)
    if (el) {
      el.style.opacity = String(q);
      el.style.transform = q >= 1 ? '' : `translateY(${((1 - q) * 14).toFixed(2)}px)`;
    }
  np.querySelectorAll<HTMLElement>('[data-q]').forEach((el) => el.style.setProperty('--q', q.toFixed(3)));
}
const np = new Drive(0, (x) => applyNp(x), { stiffness: 150, damping: 23 });
export const npProgress = () => np.x;
/** for the tests: the expand progress itself */
export const npDrive = np;
/* ---------- warming the page up ----------
   The first time the page opens, everything in it is new to the browser: its styles and layout (the whole lyric list),
   its large text, its blurs, the picture's canvas and the engine's first ambient frame. Each song, at an idle moment
   while the page is closed, the page and its picture are shown for two frames at an opacity nobody can see (and never
   under the pointer), so all of that is made before the page opens for real. */
let warmed: unknown = null,
  warming = false;
const idleCb = (fn: () => void) =>
  typeof requestIdleCallback !== 'undefined' ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 200);
function warmPage() {
  const { np: el, stage } = refs,
    s = engine.session;
  if (!el || !stage || !s || warming || warmed === s) return;
  warming = true;
  idleCb(() => {
    const closed = () => ui.get().layer === 'none' && np.x === 0 && np.target === 0 && engine.view === 'hidden';
    if (!closed()) {
      warming = false;
      return;
    }
    if (!engine.warmPicture()) {
      warming = false;
      return;
    } // (the song isn't ready yet: try again on a later frame)
    warmed = s;
    el.style.opacity = stage.style.opacity = '0.001';
    el.style.pointerEvents = stage.style.pointerEvents = 'none';
    el.dataset.vis = stage.dataset.vis = 'true';
    // (put back after two frames — or, should the window be hidden meanwhile and draw no frames, a moment later anyway:
    // a picture left shown at an unseen opacity would sit over the page and take its clicks)
    let back = false;
    const settle = () => {
      if (back) return;
      back = true;
      el.style.opacity = el.style.pointerEvents = stage.style.pointerEvents = '';
      warming = false;
      if (closed()) {
        applyNp(0);
        stage.style.opacity = '';
      } else stage.style.opacity = ''; // (opening meanwhile: the page's own progress has taken over)
    };
    requestAnimationFrame(() => requestAnimationFrame(settle));
    setTimeout(settle, 250);
  });
}
engine.on('frame', () => {
  if (np.x === 0) warmPage();
});
addEventListener('resize', () => {
  if (np.x > 0 && engine.view !== 'effect') {
    measure();
    applyNp(np.x);
  }
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
  if (!(await tween(1, 300, easeIn, my))) return false;
  swap();
  await frame();
  await frame();
  // the title bar follows the clearing, not the swap: it shows again only once the blur starts to lift (two slow first
  // frames of the new view would otherwise let it fade in over a picture still fully blurred)
  document.documentElement.dataset.fxbar = document.documentElement.dataset.fxmode;
  if (my !== tok) return false;
  return tween(0, 460, easeOut, my);
}
/** The effect lyrics' frame shape (Settings: 16:9, 16:10, 9:16, 1:1), as a ratio. */
const fxRatio = () => ASPECTS[fxAspect()] || 16 / 9;
const toFx = () => {
  document.documentElement.dataset.fxmode = 'true';
  if (refs.stage) refs.stage.style.clipPath = '';
  engine.setAspectBox(fxRatio(), hex(deepTone()));
  engine.setView('effect', {}, { instant: true });
  syncFx();
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
engine.setAspectBox({ cover: 16 / 9 });
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
    void tween(0, 360, easeOut, my);
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
    if (np.x < 0.0005) {
      applyNp(0.0006);
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
