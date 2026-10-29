// The layers above the page and the moves between them, run from one place:
//   none ⇄ np   the player card opens into the now-playing page, which takes the main area (the sidebar and title bar stay;
//               in full screen it takes the whole screen). One spring progress drives every part: the page rises from
//               the card's bottom edge and covers the area upward — its corners squaring off as it reaches the edges —
//               while the cover flies from the card to its place (its shadow turning from the mini's into the page's);
//               page and cover are on the one spring and land together, and the page's controls arrive last. Closing is the same progress running back, so a reversal mid-way simply turns.
//   np ⇄ fx     a full-screen blur: everything softens, the view changes underneath (the page hides, the picture becomes
//               the effect lyrics at 16:9 over the whole window), and it all comes back into focus. Nothing has to fly
//               between two renderings of the same thing, so nothing can flicker, change colour or jump.
import { Drive, part, rectOf, restRect, type Box } from './motion';
import { engine } from './playback/stage';
import { ui } from './state';

export const refs = {
  stage: null as HTMLElement | null, np: null as HTMLElement | null, npCover: null as HTMLElement | null, npParts: [] as (HTMLElement | null)[],
  card: null as HTMLElement | null, mini: null as HTMLElement | null, fxUi: null as HTMLElement | null,
};

/* ---------- none ⇄ np ---------- */
let A: Box | null = null, B: Box | null = null, C: Box | null = null, R: Box | null = null, coverR = 0, miniR = 9, cardR = 20, pageR = 20, miniSh = { a: 0.25, oy: 2, blur: 8 };
const PAGE_SH = { a: 0.45, oy: 24, blur: 70 };   // the page cover's own shadow (NowPlaying.module.css .cover)
const radiusOf = (el: Element) => { const v = parseFloat(getComputedStyle(el).borderTopLeftRadius); return Number.isFinite(v) ? v : 0; };
const measure = () => {
  const { mini, npCover, card, stage } = refs;
  A = mini && mini.isConnected && mini.offsetParent ? rectOf(mini) : null;
  B = npCover ? restRect(npCover) : null;
  C = card && card.isConnected ? rectOf(card) : null;
  if (stage) { const keep = stage.style.clipPath; stage.style.clipPath = ''; R = rectOf(stage); stage.style.clipPath = keep; }
  // the resting corners, read with the flight's own inline corner set aside (a reversal mid-way must not read its own value)
  if (npCover) { const keep = npCover.style.borderRadius; npCover.style.borderRadius = ''; coverR = radiusOf(npCover); npCover.style.borderRadius = keep; }
  if (mini) miniR = radiusOf(mini) || 9; if (card) cardR = radiusOf(card) || 20;
  // the mini cover's own shadow (y offset, blur, alpha), which the flying cover's shadow turns into
  if (mini) { const m = /rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(?:,\s*([\d.]+))?\)\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px/.exec(getComputedStyle(mini).boxShadow || '');
    miniSh = m ? { a: m[1] != null ? +m[1] : 1, oy: +m[3], blur: +m[4] } : { a: 0.25, oy: 2, blur: 8 }; }
  { const pg = document.querySelector('main[data-scroll]'); if (pg) pageR = Math.max(0, (radiusOf(pg) || 20) - 1.6); }   // inside the area's own corner, over the inner half of its line (no hairline of background between the two smoothed edges)
};
function applyNp(p: number) {
  const { stage, np, npCover, mini } = refs; if (!stage || !np) return;
  const on = p > 0.0005, H = innerHeight;
  np.dataset.vis = String(on); stage.dataset.vis = String(on || engine.view === 'effect');
  if (mini) mini.style.visibility = on ? 'hidden' : '';
  // the cover: from the card to its place, its corners from the card's to the page's
  let coverTop = 0;
  if (npCover && B) {
    const from = A || { left: B.left + B.width * 0.3, top: H, width: B.width * 0.4, height: B.height * 0.4 }, u = p;
    const x = from.left + (B.left - from.left) * u, y = from.top + (B.top - from.top) * u, w = from.width + (B.width - from.width) * u, sc = w / B.width;
    coverTop = y;
    npCover.style.transform = p >= 0.9995 ? '' : `translate(${(x - B.left).toFixed(2)}px, ${(y - B.top).toFixed(2)}px) scale(${sc.toFixed(4)})`;
    const r = miniR + (coverR - miniR) * part(p, 0, 1); npCover.style.borderRadius = p >= 0.9995 ? '' : `${(r / Math.max(0.05, sc)).toFixed(2)}px`;
    // its shadow: from the mini cover's to the page's as it flies (on screen; the element is scaled), so neither end jumps
    if (p >= 0.9995 || !A) npCover.style.boxShadow = ''; else { const k = sc > 0.05 ? 1 / sc : 20, u2 = part(p, 0, 1);
      npCover.style.boxShadow = `0 ${((miniSh.oy + (PAGE_SH.oy - miniSh.oy) * u2) * k).toFixed(2)}px ${((miniSh.blur + (PAGE_SH.blur - miniSh.blur) * u2) * k).toFixed(2)}px rgba(0,0,0,${(miniSh.a + (PAGE_SH.a - miniSh.a) * u2).toFixed(3)})`; }
    npCover.style.opacity = A ? '1' : String(part(p, 0, 0.4));
  }
  // the page: from the card's bottom edge upward over the area (its own box), sides and bottom following the top
  const Rb = R || rectOf(stage), c = C || { left: Rb.left + Rb.width * 0.1, top: Rb.top + Rb.height - 90, width: Rb.width * 0.8, height: 76 };
  // (every edge on the same spring as the cover: the page and the cover land together)
  const tp = p, sp = p, bp = p;
  let top = (c.top + c.height - Rb.top) * (1 - tp); if (npCover && B && p < 0.999) top = Math.min(top, coverTop - Rb.top - 26 * (1 - p));
  const left = (c.left - Rb.left) * (1 - sp), right = (Rb.left + Rb.width - c.left - c.width) * (1 - sp), bottom = (Rb.top + Rb.height - c.top - c.height) * (1 - bp);
  // the corners: the card's all round, landing on the main area's own shape (its top-left corner rounded, like the page
  // under it; in full screen, square)
  const k = part(p, 0.55, 1), full = document.documentElement.dataset.winfull === 'true', rTL = cardR + ((full ? 0 : pageR) - cardR) * k, rO = cardR * (1 - k);
  const clip = p >= 0.9995 ? (full ? '' : `inset(0 round ${pageR}px 0 0 0)`) : `inset(${Math.max(0, top).toFixed(1)}px ${Math.max(0, right).toFixed(1)}px ${Math.max(0, bottom).toFixed(1)}px ${Math.max(0, left).toFixed(1)}px round ${rTL.toFixed(1)}px ${rO.toFixed(1)}px ${rO.toFixed(1)}px ${rO.toFixed(1)}px)`;
  stage.style.clipPath = clip; stage.style.opacity = p >= 0.9995 ? '' : part(p, 0, 0.12).toFixed(3);
  // the page's controls and lyrics arrive once the cover has nearly landed
  const q = part(p, 0.45, 0.95);
  for (const el of refs.npParts) if (el) { el.style.opacity = String(q); el.style.transform = q >= 1 ? '' : `translateY(${((1 - q) * 14).toFixed(2)}px)`; }
}
const np = new Drive(0, x => applyNp(x), { stiffness: 150, damping: 23 });
export const npProgress = () => np.x;
/** for the tests: the expand progress itself */
export const npDrive = np;
/* ---------- warming the page up ----------
   The first time the page opens, everything in it is new to the browser: its styles and layout (the whole lyric list),
   its large text, its blurs, the picture's canvas and the engine's first ambient frame. Each song, at an idle moment
   while the page is closed, the page and its picture are shown for two frames at an opacity nobody can see (and never
   under the pointer), so all of that is made before the page opens for real. */
let warmed: unknown = null, warming = false;
const idleCb = (fn: () => void) => (typeof requestIdleCallback !== 'undefined' ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 200));
function warmPage() {
  const { np: el, stage } = refs, s = engine.session; if (!el || !stage || !s || warming || warmed === s) return;
  warming = true;
  idleCb(() => {
    const closed = () => ui.get().layer === 'none' && np.x === 0 && np.target === 0 && engine.view === 'hidden';
    if (!closed()) { warming = false; return; }
    if (!engine.warmPicture()) { warming = false; return; }                // (the song isn't ready yet: try again on a later frame)
    warmed = s;
    el.style.opacity = stage.style.opacity = '0.001'; el.style.pointerEvents = stage.style.pointerEvents = 'none'; el.dataset.vis = stage.dataset.vis = 'true';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.style.opacity = el.style.pointerEvents = stage.style.pointerEvents = ''; warming = false;
      if (closed()) applyNp(0); else stage.style.opacity = '';      // (opening meanwhile: the page's own progress has taken over)
    }));
  });
}
engine.on('frame', () => { if (np.x === 0) warmPage(); });
addEventListener('resize', () => { if (np.x > 0 && engine.view !== 'effect') { measure(); applyNp(np.x); } });

/* ---------- np ⇄ fx: a full-screen blur ---------- */
const veil = document.createElement('div');
Object.assign(veil.style, { position: 'fixed', inset: '0', zIndex: '60', pointerEvents: 'none', display: 'none' });
document.body.appendChild(veil);
let veilK = 0;
const setVeil = (k: number) => { veilK = k; veil.style.display = k > 0.002 ? '' : 'none'; const b = (k * 26).toFixed(1);
  veil.style.backdropFilter = `blur(${b}px) saturate(${(1 + 0.15 * k).toFixed(3)})`; veil.style.background = `rgba(10, 8, 16, ${(0.16 * k).toFixed(3)})`; };
const frame = () => new Promise<number>(r => requestAnimationFrame(r));
async function tween(to: number, ms: number, ease: (u: number) => number, my: number) {
  const from = veilK, t0 = performance.now();
  for (;;) { const u = Math.min(1, (performance.now() - t0) / ms); setVeil(from + (to - from) * ease(u)); if (u >= 1) return true; await frame(); if (my !== tok) return false; }
}
const easeIn = (u: number) => u * u * (3 - 2 * u) * 0.4 + u * u * 0.6, easeOut = (u: number) => 1 - (1 - u) ** 3;
/** Soften everything, change what is underneath, give it two frames to draw, and bring it back into focus. */
async function blurSwap(swap: () => void, my: number) {
  if (!(await tween(1, 300, easeIn, my))) return false;
  swap(); await frame(); await frame(); if (my !== tok) return false;
  return tween(0, 460, easeOut, my);
}
const toFx = () => { document.documentElement.dataset.fxmode = 'true'; if (refs.stage) refs.stage.style.clipPath = ''; engine.setAspectBox(16 / 9, '#07060b'); engine.setView('effect', {}, { instant: true }); syncFx(); };
const toNp = () => { document.documentElement.dataset.fxmode = 'false'; engine.setAspectBox({ cover: 16 / 9 }); engine.setView('ambient', {}, { instant: true }); syncFx(); applyNp(np.x); };
// the page and the effect controls follow the view (the page hides under the effect lyrics; their controls show)
function syncFx() {
  const h = engine.view === 'effect' ? 1 : 0, el = refs.np, s = String(h);
  if (el) { el.style.setProperty('--h', s); el.dataset.flying = 'false'; el.dataset.fx = String(h > 0); }
  if (refs.fxUi) refs.fxUi.style.setProperty('--h', s);
}
engine.setAspectBox({ cover: 16 / 9 });
engine.on('frame', () => { const el = refs.np; if (el && el.dataset.fx !== String(engine.view === 'effect')) syncFx(); });

/* ---------- the requests ---------- */
let tok = 0;
async function go(target: 'none' | 'np' | 'fx') {
  const my = ++tok;
  if (target === 'none') {
    if (engine.view === 'effect') { if (!(await blurSwap(toNp, my))) return; }
    measure(); const done = await np.to(0); if (!done || my !== tok) return;
    engine.setView('hidden'); applyNp(0);
    return;
  }
  if (engine.view === 'hidden') engine.setView('ambient');
  if (np.x < 0.999 || np.target !== 1) {
    if (engine.view === 'effect') { if (!(await blurSwap(toNp, my))) return; }
    if (np.x < 0.0005) { applyNp(0.0006); await frame(); if (my !== tok) return; }
    measure(); const done = np.to(1);
    if (target === 'np') { await done; return; }
    if (!(await done) || my !== tok) return;
  }
  if (target === 'np') { if (engine.view === 'effect') await blurSwap(toNp, my); return; }
  if (engine.view !== 'effect') await blurSwap(toFx, my);
}
ui.subscribe((s, prev) => { if (s.layer !== prev.layer) go(s.layer); if (s.win.full !== prev.win.full) { document.documentElement.dataset.winfull = String(s.win.full); if (np.x > 0 && engine.view !== 'effect') { measure(); applyNp(np.x); } } });
document.documentElement.dataset.winfull = String(ui.get().win.full);
export const openNp = () => ui.set({ layer: 'np', queue: false });
export const openFx = () => ui.set({ layer: 'fx', queue: false });
/** One step back: effect lyrics → now playing → the page. */
export const back = () => { const l = ui.get().layer; ui.set({ layer: l === 'fx' ? 'np' : 'none' }); };
