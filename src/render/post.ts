// What goes over the finished picture: the transition blur, flashes, titles (opening and ending), captions, idle dots.
import { subLines, type SubLine, type SubKind } from '../lyrics/subs';
import { clamp, sstep } from '../core/math';
import { eOut } from '../core/ease';
import { rgba, hexOf, mix } from '../core/color';
import { fontStack, captionStack } from '../text/fonts';
import { isLatin } from '../text/script';
import { makeCanvas } from './palette';
import { filterSupported } from './glyphs';
import { gfx, cheapBlurDraw, downsample } from './gfx';
import type { RenderFrame } from './frame';
import type { Ctx } from './effects/registry';

/* ---- transition blur: a true gaussian of the finished frame at a working size the blur allows (no mosaic), with its
   edges extended so the borders blur like the middle, the radius growing with the transition. The working canvases are
   exactly the working size: a canvas filter costs as much as the canvas it draws on, so blurring a small picture on a
   full-size canvas cost twenty times more than the blur itself. ---- */
const WORK = new Map<string, [HTMLCanvasElement, HTMLCanvasElement]>();
function work(w: number, h: number) {
  const key = w + 'x' + h;
  let p = WORK.get(key);
  if (!p) {
    p = [makeCanvas(w, h) as HTMLCanvasElement, makeCanvas(w, h) as HTMLCanvasElement];
    WORK.set(key, p);
    if (WORK.size > 10) WORK.delete(WORK.keys().next().value!);
  }
  return p;
}
export function drawTransition(g: Ctx, f: RenderFrame, k: number) {
  const cv = g.canvas as HTMLCanvasElement,
    w = cv.width,
    h = cv.height,
    R = Math.max(w, h) * 0.014,
    r = k ** 0.9 * R;
  if (r < 0.25) return;
  const tint = mix(mix(f.pal.bg, f.pal.bg2, 0.55), f.pal.dark ? [255, 255, 255] : f.pal.bg2, f.pal.dark ? 0.14 : 0.3),
    mode = gfx();
  // (lite: no blur — the picture dims into the song's colour and back; optimised: the dual-filter blur, no Gaussian)
  if (mode === 'lite') {
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = k * k * 0.55;
    g.fillStyle = hexOf(mix(f.pal.bg, tint, 0.3));
    g.fillRect(0, 0, w, h);
    g.restore();
    return;
  }
  if (mode === 'optimized') {
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    cheapBlurDraw(g, cv, w, h, Math.max(1.6, r * 1.4), 0, 0, w, h, Math.min(1, k * 1.6) * 0.94);
    g.globalAlpha = k * k * 0.085;
    g.fillStyle = hexOf(tint);
    g.fillRect(0, 0, w, h);
    g.restore();
    return;
  }
  // one working scale for the whole transition (from its peak blur, a power of two), so only the blur itself changes as
  // it rises and clears — a scale stepping with the blur re-sampled the picture at every step, which read as grain and a
  // twitch. The picture reaches it by halvings (downsample: averaged, never aliased — one big bilinear step sampled a
  // pixel here and there, and with the camera shaking those samples shimmered through the blur as it cleared)
  const n = filterSupported ? Math.max(1, Math.round(Math.log2(Math.max(2, R / 4)))) : 0,
    fct = 2 ** n,
    small = downsample(cv, w, h, n);
  const w1 = small.w,
    h1 = small.h,
    m = Math.min(30, Math.ceil((R / fct) * 2.6) + 2);
  // (never less blur than the working picture can show — under ~1.5 of its pixels it is the small picture itself that
  // shows; the last of the clearing is carried by the layer's own fade instead)
  const rb = Math.max(1.5, r / fct);
  const [TA, TB] = work(w1 + 2 * m, h1 + 2 * m),
    a = TA.getContext('2d')!,
    b = TB.getContext('2d')!;
  a.imageSmoothingEnabled = b.imageSmoothingEnabled = true;
  a.imageSmoothingQuality = b.imageSmoothingQuality = 'low';
  a.setTransform(1, 0, 0, 1, 0, 0);
  a.globalAlpha = 1;
  a.filter = 'none';
  a.clearRect(0, 0, TA.width, TA.height);
  // (its edges extended — the picture stretched under it — so the borders blur like the middle)
  a.drawImage(small.c, 0, 0, w1, h1, 0, 0, w1 + 2 * m, h1 + 2 * m);
  a.drawImage(small.c, 0, 0, w1, h1, m, m, w1, h1);
  b.setTransform(1, 0, 0, 1, 0, 0);
  b.globalAlpha = 1;
  b.clearRect(0, 0, TB.width, TB.height);
  if (filterSupported) {
    b.filter = `blur(${rb.toFixed(2)}px)`;
    b.drawImage(TA, 0, 0);
    b.filter = 'none';
  } else b.drawImage(TA, 0, 0);
  // frosted glass: the softened picture comes in over the sharp one (smoothly scaled up, no blocks), with a faint veil
  // of the song's own background colour at the peak (lifted a little, so it reads as frosting, not a darker pane) — a
  // loss of focus in the song's colour, never a curtain nor a plastic sheet
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.imageSmoothingEnabled = true;
  (g as any).imageSmoothingQuality = 'high';
  // (back onto exactly the frame: the halvings round their sizes up, so the small picture holds the whole frame in
  // w1 × h1 — drawn at w1·2ⁿ it came out a little larger than the frame, from the top left, and a sharp cover's edges
  // slid against their blurred copy as the blur rose and cleared: a twitch on the looks with things in the backdrop)
  g.globalAlpha = Math.min(1, k * 1.6) * 0.94;
  g.drawImage(TB, m, m, w1, h1, 0, 0, w, h);
  g.globalAlpha = k * k * 0.085;
  g.fillStyle = hexOf(tint);
  g.fillRect(0, 0, w, h);
  g.restore();
}

/* ---- titles ---- */
function spacing(g: Ctx, px: number) {
  if ('letterSpacing' in g) (g as any).letterSpacing = px + 'px';
}
/** The ending's card (title and credits); returns how visible it is. */
export function drawEndCard(g: Ctx, f: RenderFrame) {
  const T = f.plan.titles;
  if (!T.end) return 0;
  // (a picture of the effect view only: leaving it for the play page takes the card with it)
  const o = eOut(clamp((f.t - T.end.t0) / 0.9)) * f.view.effect;
  if (o <= 0.003) return 0;
  bigTitle(g, f, T.title, T.credits, T.end.t0, Infinity, o);
  return o;
}
const graphemes = (s: string): string[] => {
  const Seg = (
    Intl as unknown as {
      Segmenter?: new (l?: string, o?: object) => { segment(s: string): Iterable<{ segment: string }> };
    }
  ).Segmenter;
  return Seg ? [...new Seg(undefined, { granularity: 'grapheme' }).segment(s)].map((x) => x.segment) : [...s];
};
/** The song's name, large — set and moved as the lyrics are, not laid over a dimmed picture: each character comes in
 *  after the one before it (rising a little, unfolding from a slight turn, settling with a soft overshoot), floats and
 *  breathes with the beat while it is up, and leaves one by one, lifting away as it fades. The credits come in under
 *  it a moment later, small. t0: when it starts coming in; t1: when it starts to leave (Infinity: it stays). */
function bigTitle(
  g: Ctx,
  f: RenderFrame,
  title: string,
  credits: [string, string][],
  t0: number,
  t1: number,
  o: number,
) {
  const w = f.W,
    h = f.H,
    fc = fontStack(f.style.font, title),
    Tc = f.pal.text,
    base = Math.min(h, w * 1.1),
    cap = captionStack(title),
    u = f.t - t0,
    still = f.motion < 0.5,
    pulse = (f.rs?.pulse ?? 0) * f.motion;
  const cs = graphemes(title);
  g.save();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  // (a light wash of the scene's ground behind it, only so it reads on a busy picture)
  g.fillStyle = rgba(f.pal.bg, 0.16 * o);
  g.fillRect(0, 0, w, h);
  let tsz = base * (cs.length <= 8 ? 0.2 : 0.15);
  g.font = `${fc.w} ${tsz}px ${fc.stack}`;
  const track = 0.02;
  let widths = cs.map((c) => g.measureText(c).width + tsz * track),
    tw = widths.reduce((a, b) => a + b, 0);
  if (tw > w * 0.86) {
    const k = (w * 0.86) / tw;
    tsz *= k;
    widths = widths.map((x) => x * k);
    tw *= k;
    g.font = `${fc.w} ${tsz}px ${fc.stack}`;
  }
  const csz = Math.max(11, base * 0.024),
    blockH = tsz + (credits.length ? tsz * 0.5 + credits.length * csz * 1.9 : 0),
    cy = h / 2 - blockH / 2 + tsz / 2;
  const breathe = 1 + 0.025 * pulse;
  let x = w / 2 - tw / 2;
  cs.forEach((c, i) => {
    const cw = widths[i],
      cx = x + cw / 2;
    x += cw;
    if (c === ' ') return;
    const v = still ? 1 : clamp((u - i * 0.06) / 0.75),
      ob = 1 + 2.2 * (v - 1) ** 3 + 1.2 * (v - 1) ** 2,
      lv = Number.isFinite(t1) ? clamp((f.t - t1 - i * 0.045) / 0.7) : 0,
      a = Math.min(1, v * 2) * (1 - lv) * o;
    if (a <= 0.003) return;
    const fl = still ? 0 : Math.sin(f.t * 1.1 + i * 0.7) * tsz * 0.012,
      dy = (1 - ob) * tsz * 0.45 - lv * lv * tsz * 0.5 + fl,
      sc = (0.7 + 0.3 * ob) * breathe * (1 + lv * 0.08),
      rot = (1 - ob) * 0.22 * (i % 2 ? 1 : -1);
    g.save();
    g.translate(cx, cy + dy);
    g.rotate(rot);
    g.scale(sc, sc);
    g.globalAlpha = a;
    g.fillStyle = rgba(Tc, 1);
    g.fillText(c, 0, 0);
    g.restore();
  });
  if (credits.length) {
    const ck = still ? 1 : sstep(clamp((u - 0.5 - cs.length * 0.06) / 0.8)),
      cl = Number.isFinite(t1) ? 1 - sstep(clamp((f.t - t1) / 0.5)) : 1;
    let y = cy + tsz * 0.5 + tsz * 0.5 + (1 - ck) * csz;
    for (const [k, v] of credits) {
      g.font = `500 ${csz}px ${cap}`;
      spacing(g, csz * 0.3);
      const kw = k ? g.measureText(k + '　').width : 0,
        vw = g.measureText(v).width,
        x0 = w / 2 - (kw + vw) / 2;
      g.textAlign = 'left';
      g.globalAlpha = ck * cl * o * 0.6;
      g.fillStyle = rgba(Tc, 1);
      if (k) g.fillText(k + '　', x0, y + csz * 0.95);
      g.globalAlpha = ck * cl * o * 0.95;
      g.fillText(v, x0 + kw, y + csz * 0.95);
      y += csz * 1.9;
    }
    spacing(g, 0);
  }
  g.restore();
}
/** The opening title: a card before the first words when the intro allows, otherwise a small title at the top. */
export function drawIntro(g: Ctx, f: RenderFrame) {
  const T = f.plan.titles,
    I = T.intro;
  if (!I || f.t < I.t0 - 0.01 || f.t > I.t1 + 1) return;
  const fin = sstep(clamp((f.t - I.t0) / 0.7)),
    fout = 1 - sstep(clamp((f.t - (I.t1 - 0.8)) / 0.8)),
    o = fin * fout * f.view.effect;
  if (o <= 0.003) return;
  if (I.kind === 'card') {
    // (it comes in and leaves by its characters: the fade only takes it off with the view)
    bigTitle(g, f, T.title, T.artist ? [['', T.artist]] : [], I.t0, I.t1 - 0.8, f.view.effect);
    return;
  }
  const w = f.W,
    h = f.H,
    base = Math.min(h, w * 1.1),
    sz = Math.max(12, base * 0.027),
    cap = captionStack(T.title),
    fc = fontStack(f.style.font, T.title);
  g.save();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const y = h * 0.075 + (1 - fin) * -6;
  g.globalAlpha = o * 0.95;
  g.fillStyle = rgba(f.pal.text, 1);
  g.font = `${Math.min(800, fc.w)} ${sz}px ${fc.stack}`;
  spacing(g, sz * 0.06);
  const line = T.artist ? `${T.title}` : T.title;
  g.fillText(line, w / 2, y);
  if (T.artist) {
    g.globalAlpha = o * 0.6;
    g.font = `500 ${sz * 0.62}px ${cap}`;
    spacing(g, sz * 0.18);
    g.fillText(T.artist, w / 2, y + sz * 1.05);
  }
  spacing(g, 0);
  g.restore();
}

/* ---- captions: translations under the line, drawn once into bitmaps ---- */
const CAPS = new Map<string, { cv: HTMLCanvasElement; w: number; h: number; base: number }>();
function capSprite(
  txt: string,
  font: string,
  sz: number,
  ls: number,
  maxW: number,
  fill: string,
  shadow: string,
  dpr: number,
) {
  const key = [txt, font, ls, maxW, fill, shadow, dpr].join('|');
  let e = CAPS.get(key);
  if (e) return e;
  const cv = makeCanvas(8, 8) as HTMLCanvasElement,
    g = cv.getContext('2d')!;
  g.font = font;
  spacing(g, ls);
  const tw = Math.min(maxW, g.measureText(txt).width + ls),
    pad = Math.ceil(16 + ls),
    w = Math.ceil(tw + pad * 2),
    h = Math.ceil(sz * 1.7 + pad * 2),
    base = pad + sz * 1.25;
  cv.width = Math.ceil(w * dpr);
  cv.height = Math.ceil(h * dpr);
  g.scale(dpr, dpr);
  g.font = font;
  spacing(g, ls);
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.shadowColor = shadow;
  g.shadowBlur = 8;
  g.fillStyle = fill;
  g.fillText(txt, w / 2 + ls / 2, base, maxW);
  e = { cv, w, h, base };
  CAPS.set(key, e);
  if (CAPS.size > 160) CAPS.delete(CAPS.keys().next().value!);
  return e;
}
/** Where the captions of these sub-lines sit (centre y, size, face), bottom up as drawCaptions stacks them. */
export function captionLayout(f: Pick<RenderFrame, 'W' | 'H'>, subs: (string | SubLine)[], bottom: number) {
  const base = Math.min(f.H, f.W * 1.2),
    out: { y: number; sz: number; font: string }[] = [];
  let y = bottom;
  for (let k = subs.length - 1; k >= 0; k--) {
    const e = subs[k],
      s = typeof e === 'string' ? e : e.s,
      lat = isLatin(s),
      sz = Math.max(lat ? 11 : 12, base * (lat ? 0.019 : 0.021)) * capScale(typeof e === 'string' ? 'sub' : e.kind);
    out[k] = { y: y - sz * 0.35, sz, font: `${lat ? 600 : 500} ${sz}px ${captionStack(s)}` };
    y -= sz * 1.75;
  }
  return out;
}
/** A caption's size and strength by what it is: a translation as ever; a reading softer; a translation's bracketed part
 *  (as a harmony is) smaller and softer still. */
const capScale = (k: SubKind) => (k === 'harm' ? 0.84 : k === 'read' ? 0.92 : 1);
const capAlpha = (k: SubKind) => (k === 'harm' ? 0.62 : k === 'read' ? 0.55 : 1);
export function drawCaptions(
  g: Ctx,
  f: RenderFrame,
  bottom: number,
  show: { subs: boolean; reads: boolean; independent?: boolean } = { subs: true, reads: true },
) {
  if (f.cam.ov >= 1 || !f.plan.hasSubs || (!show.subs && !show.reads)) return;
  const w = f.W,
    h = f.H,
    T = f.pal.text; // (going over the ending's ramp: below)
  // (one line's captions at a time: the line begun last — a line held up long, by a harmony that runs on, never stacks
  // its captions over the next one's; the next one takes the place at once)
  let current: (typeof f.plan.doc.lines)[number] | undefined;
  if (show.independent) {
    for (const line of f.plan.doc.lines) if (line.t <= f.t && (!current || line.t >= current.t)) current = line;
  } else {
    for (const { L: line } of f.plan.lines) if (line.t <= f.t && (!current || line.t >= current.t)) current = line;
  }
  if (current) {
    const L = current,
      subs = subLines(show.subs ? L : { ...L, subs: [] }, show.reads);
    if (!subs.length) return;
    const o =
      (f.t >= L.t ? clamp((f.t - L.t - 0.1) / 0.3) : 0) *
      (1 - clamp((f.t - L.end + 0.15) / 0.25)) *
      sstep(clamp((f.view.effect - 0.55) / 0.45)) *
      (1 - f.cam.ov);
    if (o <= 0) return; // (in a hand-over: after the page's own lines have come down)
    // (a single line — no reading, or readings turned off — sits a little lower than the bottom of two: the block is
    // anchored by where it reads as resting at the foot of the picture, not by its last line)
    const base = Math.min(h, w * 1.2);
    let y = bottom + (1 - o) * 8 + (subs.length < 2 ? Math.max(12, base * 0.021) * 1.05 : 0);
    for (let k = subs.length - 1; k >= 0; k--) {
      const { s, kind } = subs[k],
        lat = isLatin(s),
        sz = Math.max(lat ? 11 : 12, base * (lat ? 0.019 : 0.021)) * capScale(kind),
        ls = sz * (lat ? 0.28 : 0.24);
      const font = lat ? `600 ${sz}px ${captionStack(s)}` : `500 ${sz}px ${captionStack(s)}`,
        sp = capSprite(lat ? s.toLowerCase() : s, font, sz, ls, w * 0.92, rgba(T, 1), rgba(f.pal.bg, 0.95), f.px);
      g.save();
      g.globalAlpha = o * (lat ? 0.75 : 0.9) * capAlpha(kind);
      g.drawImage(sp.cv, w / 2 - sp.w / 2, y - sp.base, sp.w, sp.h);
      g.restore();
      y -= sz * 1.75;
    }
  }
}
/* ---- three dots keep time through an idle stretch ---- */
export function drawIdleDots(g: Ctx, f: RenderFrame) {
  const k = f.cam.idle * f.view.effect;
  if (k < 0.01) return;
  const I = f.plan.camera.idle.find((x) => f.t > x.a && f.t < x.b);
  if (!I) return;
  const p = clamp((f.t - I.a) / Math.max(0.5, I.b - I.a)),
    r = Math.min(f.W, f.H) * 0.0105,
    gap = r * 3.6,
    y = f.H * 0.11;
  g.save();
  g.fillStyle = rgba(f.pal.text, 1);
  for (let i = 0; i < 3; i++) {
    const lit = sstep(clamp(p * 3 - i)),
      s = 1 + 0.28 * f.rs.pulse * (0.4 + 0.6 * lit);
    g.globalAlpha = k * (0.22 + 0.68 * lit);
    g.beginPath();
    g.arc(f.W / 2 + (i - 1) * gap, y, r * s, 0, 6.283);
    g.fill();
  }
  g.restore();
}
