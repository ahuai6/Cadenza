// The layers above the page and the moves between them, run from one place:
//   none ⇄ np   the player card opens into the now-playing page. One spring progress drives every part: the cover leaves
//               the card first and flies to its place; the picture behind it (the engine's ambient view — the song's
//               own backdrop) comes out of the card with the cover, its top edge led by the cover, then spreads until it
//               covers the window; the page's controls arrive last. Closing is the same progress running back, so a
//               reversal mid-way simply turns around, and nothing can be left stuck between states.
//   np ⇄ fx     the now-playing page hands over to the effect lyrics inside the engine (engine/handoff.ts): the cover
//               and the visible lyric lines fly into the scene on the canvas while the backdrop turns into the theme's;
//               the page's own copies hide for the flight and its controls fade by the same progress.
import { Drive, part, rectOf, restRect, type Box } from './motion';
import type { HandoffSpec, HandoffLine } from '../engine';
import { engine } from './playback/stage';
import { ui } from './state';

export const refs = {
  stage: null as HTMLElement | null, np: null as HTMLElement | null, npCover: null as HTMLElement | null, npParts: [] as (HTMLElement | null)[],
  card: null as HTMLElement | null, mini: null as HTMLElement | null, fxUi: null as HTMLElement | null,
  /** the lyric lines the page shows now (measured for the hand-over), and a way to bring them to the current moment */
  lines: null as null | (() => HandoffLine[]), syncLines: null as null | (() => void),
};

/* ---------- none ⇄ np ---------- */
let A: Box | null = null, B: Box | null = null, C: Box | null = null, coverR = 22, miniR = 9;
const measure = () => {
  const { mini, npCover, card } = refs;
  A = mini && mini.isConnected && mini.offsetParent ? rectOf(mini) : null;
  B = npCover ? restRect(npCover) : null;
  C = card && card.isConnected ? rectOf(card) : null;
  // the resting corner, read with the flight's own inline corner set aside (a reversal mid-way must not read its own value)
  if (npCover) { const keep = npCover.style.borderRadius; npCover.style.borderRadius = ''; { const v = parseFloat(getComputedStyle(npCover).borderTopLeftRadius); coverR = Number.isFinite(v) ? v : 0; } npCover.style.borderRadius = keep; }
  if (mini) { const v = parseFloat(getComputedStyle(mini).borderTopLeftRadius); miniR = Number.isFinite(v) ? v : 9; }
};
function applyNp(p: number) {
  const { stage, np, npCover, mini } = refs; if (!stage || !np) return;
  const W = innerWidth, H = innerHeight, on = p > 0.0005;
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
    npCover.style.opacity = A ? '1' : String(part(p, 0, 0.4));
  }
  // the picture: it grows out of the card in step with the cover — every edge moves by the same progress as the cover's
  // flight, so the two read as one movement (its top never falls behind the cover). Near the card it fades into the
  // card's own colour, so opening starts from the card and closing ends on it
  const c = C || { left: W * 0.2, top: H - 90, width: W * 0.6, height: 76 };
  let top = c.top * (1 - p); if (npCover && B && p < 0.999) top = Math.min(top, coverTop - 26 * (1 - p));
  const left = c.left * (1 - p), right = (W - c.left - c.width) * (1 - p), bottom = (H - c.top - c.height) * (1 - p), rad = 20 * (1 - p);
  const clip = p >= 0.9995 ? '' : `inset(${Math.max(0, top).toFixed(1)}px ${right.toFixed(1)}px ${bottom.toFixed(1)}px ${left.toFixed(1)}px round ${rad.toFixed(1)}px)`;
  stage.style.clipPath = clip; stage.style.opacity = p >= 0.9995 ? '' : part(p, 0, 0.16).toFixed(3);
  // (the page's shade is drawn in the picture itself, so it is clipped and faded with it)
  // the page's controls and lyrics arrive once the cover has nearly landed
  const q = part(p, 0.45, 0.95);
  for (const el of refs.npParts) if (el) { el.style.opacity = String(q); el.style.transform = q >= 1 ? '' : `translateY(${((1 - q) * 14).toFixed(2)}px)`; }
}
const np = new Drive(0, x => applyNp(x), { stiffness: 150, damping: 23 });
export const npProgress = () => np.x;
/** for the tests: the expand progress itself */
export const npDrive = np;
addEventListener('resize', () => { if (np.x > 0) { measure(); applyNp(np.x); } });

/* ---------- np ⇄ fx ---------- */
function handoffSpec(): HandoffSpec {
  refs.syncLines?.();
  const { npCover } = refs;
  return { cover: npCover ? { rect: restRect(npCover), radius: coverR } : null, lines: refs.lines?.() || [] };
}
// the page mirrors the hand-over's progress: its own cover and lines hide while they fly, its controls fade
engine.on('frame', () => {
  const h = engine.handoff.p, el = refs.np; if (!el) return;
  const s = h.toFixed(3); if (el.style.getPropertyValue('--h') !== s) { el.style.setProperty('--h', s); el.dataset.flying = String(h > 0.0005 && h < 0.9995); el.dataset.fx = String(h > 0.0005); }
  if (refs.fxUi) refs.fxUi.style.setProperty('--h', s);
});

/* ---------- the requests ---------- */
let tok = 0;
async function go(target: 'none' | 'np' | 'fx') {
  const my = ++tok;
  if (target === 'none') {
    if (engine.view === 'effect') { await engine.setView('ambient', handoffSpec()); if (my !== tok) return; }
    measure(); const done = await np.to(0); if (!done || my !== tok) return;
    engine.setView('hidden'); applyNp(0);
    return;
  }
  if (engine.view === 'hidden') { engine.setView('ambient'); }
  if (np.x < 0.999 || np.target !== 1) {
    if (np.x < 0.0005) { applyNp(0.0006); await new Promise(r => requestAnimationFrame(r)); if (my !== tok) return; }
    measure(); const done = np.to(1);
    if (target === 'np') { if (engine.view === 'effect') engine.setView('ambient', handoffSpec()); await done; return; }
    if (!(await done) || my !== tok) return;
  }
  if (target === 'np') { if (engine.view === 'effect') await engine.setView('ambient', handoffSpec()); return; }
  if (engine.view !== 'effect') await engine.setView('effect', handoffSpec());
}
ui.subscribe((s, prev) => { if (s.layer !== prev.layer) go(s.layer); });
export const openNp = () => ui.set({ layer: 'np', queue: false });
export const openFx = () => ui.set({ layer: 'fx', queue: false });
/** One step back: effect lyrics → now playing → the page. */
export const back = () => { const l = ui.get().layer; ui.set({ layer: l === 'fx' ? 'np' : 'none' }); };
