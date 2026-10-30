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
  stage: null as HTMLElement | null, np: null as HTMLElement | null, npAmb: null as HTMLElement | null, npCover: null as HTMLElement | null, npParts: [] as (HTMLElement | null)[],
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
  // the area's edge is a 1 px line (an inset shadow moved in by a pixel); the picture one pixel inside meets that line
  // all the way round the corner at the area's radius less 5 px (measured on the rendered corner: larger left a sliver of
  // the page between them, smaller covered the line)
  { const pg = document.querySelector('main[data-scroll]'); if (pg) pageR = Math.max(0, radiusOf(pg) - 5); }
};
function applyNp(p: number) {
  const { stage, np, npCover, mini } = refs; if (!stage || !np) return;
  const on = p > 0.0005, H = innerHeight;
  np.dataset.vis = String(on); stage.dataset.vis = String(on || engine.view === 'effect');
  // the mini cover back in the card: its own shadow comes in as it does on hover (the card's transition), from none —
  // the flying cover's shadow has faded out on its way down, so nothing jumps where the two hand over
  if (mini) { const was = mini.style.visibility === 'hidden'; mini.style.visibility = on ? 'hidden' : '';
    if (!on && was) { mini.style.boxShadow = 'none'; void mini.offsetWidth; requestAnimationFrame(() => { mini.style.boxShadow = ''; }); } }
  // the cover: from the card to its place, its corners from the card's to the page's
  let coverTop = 0;
  if (npCover && B) {
    const from = A || { left: B.left + B.width * 0.3, top: H, width: B.width * 0.4, height: B.height * 0.4 }, u = p;
    const x = from.left + (B.left - from.left) * u, y = from.top + (B.top - from.top) * u, w = from.width + (B.width - from.width) * u, sc = w / B.width;
    coverTop = y;
    npCover.style.transform = p >= 0.9995 ? '' : `translate(${(x - B.left).toFixed(2)}px, ${(y - B.top).toFixed(2)}px) scale(${sc.toFixed(4)})`;
    const r = miniR + (coverR - miniR) * part(p, 0, 1); npCover.style.borderRadius = p >= 0.9995 ? '' : `${(r / Math.max(0.05, sc)).toFixed(2)}px`;
    // its shadow: from the mini cover's to the page's as it flies (on screen; the element is scaled), so neither end jumps
    // (closing, it fades out over the last stretch, the mini cover's own then fading in: see above)
    if (p >= 0.9995 || !A) npCover.style.boxShadow = ''; else { const k = sc > 0.05 ? 1 / sc : 20, u2 = part(p, 0, 1), fadeK = npDrive.target === 0 ? part(p, 0, 0.22) : 1;
      npCover.style.boxShadow = `0 ${((miniSh.oy + (PAGE_SH.oy - miniSh.oy) * u2) * k).toFixed(2)}px ${((miniSh.blur + (PAGE_SH.blur - miniSh.blur) * u2) * k).toFixed(2)}px rgba(0,0,0,${((miniSh.a + (PAGE_SH.a - miniSh.a) * u2) * fadeK).toFixed(3)})`; }
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
  // (the play page's own shade and grain go with the picture: the same shape, the same fade)
  const amb = refs.npAmb; if (amb) { amb.dataset.vis = String(on); amb.style.clipPath = clip; amb.style.opacity = p >= 0.9995 ? '' : part(p, 0, 0.3).toFixed(3); }
  // while it rises, the page casts a soft shade up onto what it is covering: a wide falloff above its leading edge,
  // fading out at the sides, deepest mid-way through the move and gone once it has landed (or closed) — a sheet sliding
  // over the library, not a line drawn on it
  { const sh = edgeShade(), k2 = on && p < 0.9995 ? Math.sin(Math.PI * Math.min(1, p)) ** 0.8 : 0;
    if (k2 < 0.01) sh.style.display = 'none'; else { const h = Math.min(140, 40 + Rb.height * 0.12), L = Rb.left + Math.max(0, left), Wd = Rb.width - Math.max(0, left) - Math.max(0, right);
      Object.assign(sh.style, { display: '', left: L.toFixed(1) + 'px', width: Math.max(0, Wd).toFixed(1) + 'px', top: (Rb.top + Math.max(0, top) - h + 2).toFixed(1) + 'px', height: h.toFixed(1) + 'px', opacity: (0.9 * k2).toFixed(3) }); } }
  // the page's controls and lyrics arrive once the cover has nearly landed
  const q = part(p, 0.45, 0.95);
  for (const el of refs.npParts) if (el) { el.style.opacity = String(q); el.style.transform = q >= 1 ? '' : `translateY(${((1 - q) * 14).toFixed(2)}px)`; }
}
let shadeEl: HTMLDivElement | null = null;
function edgeShade() { if (shadeEl) return shadeEl; const d = document.createElement('div'); d.setAttribute('aria-hidden', 'true');
  Object.assign(d.style, { position: 'fixed', zIndex: '39', pointerEvents: 'none', display: 'none',
    background: 'linear-gradient(to top, rgba(6,4,12,0.32), rgba(6,4,12,0.14) 35%, rgba(6,4,12,0.04) 70%, rgba(6,4,12,0))',
    WebkitMaskImage: 'linear-gradient(to right, transparent, #000 14%, #000 86%, transparent)', maskImage: 'linear-gradient(to right, transparent, #000 14%, #000 86%, transparent)' });
  document.body.appendChild(d); return (shadeEl = d); }
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
    // (put back after two frames — or, should the window be hidden meanwhile and draw no frames, a moment later anyway:
    // a picture left shown at an unseen opacity would sit over the page and take its clicks)
    let back = false; const settle = () => { if (back) return; back = true;
      el.style.opacity = el.style.pointerEvents = stage.style.pointerEvents = ''; warming = false;
      if (closed()) { applyNp(0); stage.style.opacity = ''; } else stage.style.opacity = '';      // (opening meanwhile: the page's own progress has taken over)
    };
    requestAnimationFrame(() => requestAnimationFrame(settle)); setTimeout(settle, 250);
  });
}
engine.on('frame', () => { if (np.x === 0) warmPage(); });
addEventListener('resize', () => { if (np.x > 0 && engine.view !== 'effect') { measure(); applyNp(np.x); } });

/* ---------- np ⇄ fx: a full-screen blur ---------- */
/** The song's own deepest tone (its cover's base colour, sunk most of the way to black): the effect view's letterbox
 *  and the blur's veil take it, so they sit with the play page instead of a fixed near-black. */
function deepTone(): [number, number, number] { const A = engine.session?.ambient; const b = A ? A.base : [10, 8, 16]; return [0, 1, 2].map(i => Math.round(b[i] * 0.22 + 4)) as [number, number, number]; }
const hex = (c: number[]) => '#' + c.map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
const veil = document.createElement('div');
Object.assign(veil.style, { position: 'fixed', inset: '0', zIndex: '60', pointerEvents: 'none', display: 'none' });
document.body.appendChild(veil);
let veilK = 0;
const setVeil = (k: number) => { veilK = k; veil.style.display = k > 0.002 ? '' : 'none'; const b = (k * 26).toFixed(1);
  // (lite: no backdrop blur — the veil dims a little more instead)
  const lite = document.documentElement.dataset.gfx === 'lite';
  veil.style.backdropFilter = lite ? 'none' : `blur(${b}px) saturate(${(1 + 0.15 * k).toFixed(3)})`; veil.style.background = `rgba(${deepTone().join(',')}, ${((lite ? 0.62 : 0.18) * k).toFixed(3)})`; };
const frame = () => new Promise<number>(r => requestAnimationFrame(r));
// (one tween drives the veil at a time: a newer one, of this request or a later one, takes it over from where it is)
let veilTok = 0;
async function tween(to: number, ms: number, ease: (u: number) => number, my: number) {
  const from = veilK, t0 = performance.now(), mine = ++veilTok;
  for (;;) { const u = Math.min(1, (performance.now() - t0) / ms); setVeil(from + (to - from) * ease(u)); if (u >= 1) return true; await frame(); if (my !== tok || mine !== veilTok) return false; }
}
const easeIn = (u: number) => u * u * (3 - 2 * u) * 0.4 + u * u * 0.6, easeOut = (u: number) => 1 - (1 - u) ** 3;
/** Soften everything, change what is underneath, give it two frames to draw, and bring it back into focus. */
async function blurSwap(swap: () => void, my: number) {
  if (!(await tween(1, 300, easeIn, my))) return false;
  swap(); await frame(); await frame();
  // the title bar follows the clearing, not the swap: it shows again only once the blur starts to lift (two slow first
  // frames of the new view would otherwise let it fade in over a picture still fully blurred)
  document.documentElement.dataset.fxbar = document.documentElement.dataset.fxmode; if (my !== tok) return false;
  return tween(0, 460, easeOut, my);
}
const toFx = () => { document.documentElement.dataset.fxmode = 'true'; if (refs.stage) refs.stage.style.clipPath = ''; engine.setAspectBox(16 / 9, hex(deepTone())); engine.setView('effect', {}, { instant: true }); syncFx(); };
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
  // a request that interrupts a blur leaves the veil wherever it was: when this one does not go straight into a blur of
  // its own (which starts from the veil as it is), the veil clears now instead of staying over everything
  const swapsNow = engine.view === 'effect' ? target !== 'fx' : target === 'fx' && np.x >= 0.999 && np.target === 1;
  if (!swapsNow && veilK > 0) { document.documentElement.dataset.fxbar = document.documentElement.dataset.fxmode; void tween(0, 360, easeOut, my); }
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
// (which layer is up, for the stylesheet: with none, the picture never takes the pointer — the page under it does)
document.documentElement.dataset.layer = ui.get().layer;
// back in a window that was hidden (closed to the tray, minimised): a close the hidden window never finished drawing is
// finished now, so nothing half-shown is left over the page
document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible' || ui.get().layer !== 'none') return;
  if (np.target === 0) { if (np.x > 0) np.jump?.(0); if (engine.view !== 'effect') { engine.setView('hidden'); applyNp(0); } if (refs.stage) refs.stage.style.opacity = ''; } });
ui.subscribe((s, prev) => { if (s.layer !== prev.layer) { document.documentElement.dataset.layer = s.layer; go(s.layer); } if (s.win.full !== prev.win.full) { document.documentElement.dataset.winfull = String(s.win.full); if (np.x > 0 && engine.view !== 'effect') { measure(); applyNp(np.x); } } });
document.documentElement.dataset.winfull = String(ui.get().win.full);
export const openNp = () => ui.set({ layer: 'np', queue: false });
export const openFx = () => ui.set({ layer: 'fx', queue: false });
/** One step back: effect lyrics → now playing → the page. */
export const back = () => { const l = ui.get().layer; ui.set({ layer: l === 'fx' ? 'np' : 'none' }); };
