/* The cover theme: the ambient field (the now-playing page's backdrop) through a liquid surface that the low end squeezes
   out from under the cover (liquid.ts), with the cover set back behind the lyrics: as an album sleeve with its record half out, floating, or blended into its own glow.
   drawCoverSubject is the one drawing of the cover: the backdrop uses it where the cover rests, and the shared-element
   handoff uses it while the cover flies in from the now-playing page, so the hand-over is the same picture throughout.
   vinyl (0..1) is how far the record has slid out from under the sleeve: it comes out after the cover lands. */
import { clamp } from '../../core/math';
import { rgba, hexOf } from '../../core/color';
import { register, midShift, type Ctx, type BackdropView } from './registry';
import type { RenderFrame } from '../frame';
import { makeCanvas } from '../palette';
import { drawLiquid } from './liquid';
import { drawRings } from './rings';
import { gfx, cheapBlurDraw } from '../gfx';

type Img = CanvasImageSource & { width: number; height: number };
interface Layers {
  key: string;
  subj: HTMLCanvasElement;
  vinyl: HTMLCanvasElement | null;
  blend: HTMLCanvasElement | null;
}
let cache: Layers | null = null;
function square(src: Img, size: number, blur = 0): HTMLCanvasElement {
  const c = makeCanvas(size, size) as HTMLCanvasElement,
    g = c.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  const sw = (src as any).naturalWidth || src.width,
    sh = (src as any).naturalHeight || src.height,
    side = Math.min(sw, sh);
  if (blur > 0) g.filter = `blur(${blur}px)`;
  g.drawImage(src, (sw - side) / 2, (sh - side) / 2, side, side, 0, 0, size, size);
  return c;
}
function placeholder(f: RenderFrame): HTMLCanvasElement {
  const c = makeCanvas(512, 512) as HTMLCanvasElement,
    g = c.getContext('2d')!,
    P = f.pal;
  const gr = g.createLinearGradient(0, 0, 512, 512);
  gr.addColorStop(0, hexOf(P.accent));
  gr.addColorStop(1, hexOf(P.bg2));
  g.fillStyle = gr;
  g.fillRect(0, 0, 512, 512);
  g.fillStyle = rgba(P.bg, 0.35);
  g.beginPath();
  g.arc(330, 210, 150, 0, Math.PI * 2);
  g.fill();
  return c;
}
/** A record, D pixels across: black grooved vinyl, a rim of light, the cover as its label. */
export function makeVinyl(label: CanvasImageSource, D: number): HTMLCanvasElement {
  const v = makeCanvas(D, D) as HTMLCanvasElement,
    g = v.getContext('2d')!,
    R = D / 2,
    k = D / 512;
  g.translate(R, R);
  const body = g.createRadialGradient(0, 0, R * 0.3, 0, 0, R);
  body.addColorStop(0, '#141416');
  body.addColorStop(1, '#0a0a0b');
  g.fillStyle = body;
  g.beginPath();
  g.arc(0, 0, R - 1, 0, 6.283);
  g.fill();
  for (let rr = R * 0.36; rr < R * 0.97; rr += 2.2 * k) {
    g.strokeStyle = `rgba(255,255,255,${0.025 + 0.025 * Math.sin((rr / k) * 0.7) ** 2})`;
    g.lineWidth = k;
    g.beginPath();
    g.arc(0, 0, rr, 0, 6.283);
    g.stroke();
  }
  g.strokeStyle = 'rgba(255,255,255,.08)';
  g.lineWidth = 3 * k;
  g.beginPath();
  g.arc(0, 0, R * 0.95, 0, 6.283);
  g.stroke();
  g.save();
  g.beginPath();
  g.arc(0, 0, R * 0.33, 0, 6.283);
  g.clip();
  g.drawImage(label, -R * 0.33, -R * 0.33, R * 0.66, R * 0.66);
  g.restore();
  g.strokeStyle = 'rgba(0,0,0,.35)';
  g.lineWidth = 2 * k;
  g.beginPath();
  g.arc(0, 0, R * 0.33, 0, 6.283);
  g.stroke();
  g.fillStyle = '#0b0b0c';
  g.beginPath();
  g.arc(0, 0, R * 0.025, 0, 6.283);
  g.fill();
  return v;
}
/** The cover drawn square (with the placeholder when there is none), for a label or a sleeve. */
export const coverSquare = (f: RenderFrame, size: number) => square(f.media.cover || placeholder(f), size);
export function coverLayers(f: RenderFrame): Layers {
  const st = f.style,
    key = `${f.media.coverKey}|${st.coverEdge}|${st.text}|${f.media.cover ? '' : st.accent + st.bg2}`;
  if (cache && cache.key === key) return cache;
  const src: Img = f.media.cover || placeholder(f);
  const subj = square(src, 512);
  let vinyl: HTMLCanvasElement | null = null,
    blend: HTMLCanvasElement | null = null;
  if (st.coverEdge === 'album' || !st.coverEdge) vinyl = makeVinyl(subj, 512);
  if (st.coverEdge === 'blend') {
    // like the sun behind cloud: the cover (still a square, its corners only softened) glowing out into a haze of its own
    // colours that thins away on every side — a round cloud of light, never a square plate behind it
    const C = 1024,
      n = 512,
      o = (C - n) / 2,
      comp = makeCanvas(C, C) as HTMLCanvasElement,
      g = comp.getContext('2d')!;
    const glow = makeCanvas(C, C) as HTMLCanvasElement,
      gg = glow.getContext('2d')!;
    gg.filter = 'blur(70px)';
    gg.drawImage(subj, o - n * 0.18, o - n * 0.18, n * 1.36, n * 1.36);
    gg.filter = 'none';
    gg.globalCompositeOperation = 'destination-in';
    const fade = gg.createRadialGradient(C / 2, C / 2, n * 0.35, C / 2, C / 2, C / 2);
    fade.addColorStop(0, 'rgba(0,0,0,1)');
    fade.addColorStop(0.55, 'rgba(0,0,0,0.55)');
    fade.addColorStop(1, 'rgba(0,0,0,0)');
    gg.fillStyle = fade;
    gg.fillRect(0, 0, C, C);
    g.globalAlpha = 0.9;
    g.drawImage(glow, 0, 0);
    // the cover with its edges dissolving into the glow (a feathered mask, not a hard edge)
    const face = makeCanvas(C, C) as HTMLCanvasElement,
      fg = face.getContext('2d')!;
    fg.drawImage(subj, o, o, n, n);
    fg.globalCompositeOperation = 'destination-in';
    fg.filter = 'blur(14px)';
    fg.fillStyle = '#000';
    fg.beginPath();
    fg.roundRect(o + 10, o + 10, n - 20, n - 20, n * 0.06);
    fg.fill();
    fg.filter = 'none';
    g.globalAlpha = 1;
    g.drawImage(face, 0, 0);
    g.globalCompositeOperation = 'screen';
    g.globalAlpha = 0.28;
    g.drawImage(glow, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    blend = comp;
  }
  cache = { key, subj, vinyl, blend };
  return cache;
}

/** Where the cover rests in the backdrop's own frame (before the backdrop camera's roll and zoom), in reference px. */
export function coverRest(f: RenderFrame, bd: Pick<BackdropView, 'ox' | 'oy'>): { x: number; y: number; S: number } {
  const S = Math.min(f.W, f.H) * (f.style.coverSize ?? 0.6) * (1 + f.P * 0.012),
    album = (f.style.coverEdge || 'album') === 'album';
  const [sx, sy] = midShift(bd);
  return { x: f.W / 2 - S / 2 + sx - (album ? S * 0.16 : 0), y: f.H * 0.47 - S / 2 + sy, S };
}
/** The cover itself at (x, y, S) in the current transform: sleeve with its record (vinyl: how far it is out), float, or blend. */
/** o.finish (0..1): how much of the scene's own finish the cover wears (its sheen, rim light and groove) — the hand-over
 *  grows it from the page's plain cover; o.shadow false: the caller draws the shadow itself. */
export function drawCoverSubject(
  g: Ctx,
  f: RenderFrame,
  x: number,
  y: number,
  S: number,
  vinyl: number,
  alpha = 1,
  o: { finish?: number; shadow?: boolean } = {},
) {
  // the cover blur is a focus pull on the whole cover — sleeve, record, rim, shadow, glow — as a lens would blur it: the
  // group is drawn on a canvas just its size, blurred there (a filter costs as much as the canvas it works on), and set in
  const bl = clamp(f.style.coverBlur ?? 0);
  if (bl < 0.01) {
    const edge = f.style.coverEdge || 'album';
    if ((edge === 'album' && vinyl <= 0.001) || edge === 'float') sleeveSprite(g, f, x, y, S, alpha, o);
    else coverGroup(g, f, x, y, S, vinyl, alpha, o);
    return;
  }
  const mt = g.getTransform(),
    q = Math.min(2.5, Math.hypot(mt.a, mt.b)),
    edge = f.style.coverEdge || 'album';
  const pl = edge === 'blend' ? S * 0.55 : S * 0.2,
    pr = edge === 'album' ? S * 0.62 : pl,
    pv = edge === 'blend' ? S * 0.55 : S * 0.25;
  const bw = S + pl + pr,
    bh = S + pv * 2,
    W = Math.min(2048, Math.ceil(bw * q)),
    H = Math.min(2048, Math.ceil(bh * q)),
    k = W / bw;
  const A = groupCanvas(0, W, H),
    B = groupCanvas(1, W, H),
    a = A.getContext('2d')!,
    b = B.getContext('2d')!;
  a.setTransform(1, 0, 0, 1, 0, 0);
  a.clearRect(0, 0, W, H);
  a.setTransform(k, 0, 0, k, (pl - x) * k, (pv - y) * k);
  coverGroup(a, f, x, y, S, vinyl, 1, o);
  b.setTransform(1, 0, 0, 1, 0, 0);
  b.clearRect(0, 0, W, H);
  const rb = bl * S * k * 0.035,
    md = gfx();
  if (md === 'default') {
    b.filter = `blur(${rb.toFixed(2)}px)`;
    b.drawImage(A, 0, 0);
    b.filter = 'none';
  } else if (md === 'optimized') cheapBlurDraw(b, A, W, H, rb, 0, 0, W, H);
  else b.drawImage(A, 0, 0);
  g.save();
  g.globalAlpha *= alpha;
  g.drawImage(B, 0, 0, W, H, x - pl, y - pv, bw, bh);
  g.restore();
}
/* The sleeve as it rests — the cover, its soft shadow, its sheen and rim — made once into a picture of its own and drawn
   from it: the shadow is a wide blur, and made anew every frame it was one of the costliest parts of the picture. It is
   made again only when what it shows changes (the cover, its finish, the colours) or its size on screen does by more
   than a step (an eighth of an octave: the beat's breathing is a few per cent, drawn from the same picture). */
let SLEEVE: { key: string; cv: HTMLCanvasElement; m: number } | null = null;
function sleeveSprite(
  g: Ctx,
  f: RenderFrame,
  x: number,
  y: number,
  S: number,
  alpha: number,
  o: { finish?: number; shadow?: boolean },
) {
  const mt = g.getTransform(),
    q = Math.hypot(mt.a, mt.b) || 1,
    Sq = 2 ** (Math.round(Math.log2(Math.max(8, S * q)) * 8) / 8),
    k = Sq / S,
    m = S * 0.35;
  const key = [
    f.media.coverKey,
    f.style.coverEdge || 'album',
    f.pal.dark,
    f.pal.bg.join(),
    Math.round((o.finish ?? 1) * 20),
    o.shadow !== false,
    gfx() === 'lite',
    Math.round(Sq),
  ].join('|');
  if (!SLEEVE || SLEEVE.key !== key) {
    const cv = (SLEEVE?.cv ?? makeCanvas(2, 2)) as HTMLCanvasElement,
      n = Math.ceil((S + 2 * m) * k);
    cv.width = n;
    cv.height = n;
    const c = cv.getContext('2d')!;
    c.setTransform(k, 0, 0, k, 0, 0);
    coverGroup(c, f, m, m, S, 0, 1, o);
    SLEEVE = { key, cv, m };
  }
  g.save();
  g.globalAlpha *= alpha;
  g.imageSmoothingEnabled = true;
  (g as CanvasRenderingContext2D).imageSmoothingQuality = 'high';
  g.drawImage(SLEEVE.cv, x - m, y - m, S + 2 * m, S + 2 * m);
  g.restore();
}
const GROUP: (HTMLCanvasElement | null)[] = [null, null];
function groupCanvas(i: number, w: number, h: number) {
  let c = GROUP[i];
  if (!c || c.width < w || c.height < h || c.width > w * 1.5 || c.height > h * 1.5) {
    c = makeCanvas(w, h) as HTMLCanvasElement;
    GROUP[i] = c;
  }
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  return c;
}
function coverGroup(
  g: Ctx,
  f: RenderFrame,
  x: number,
  y: number,
  S: number,
  vinyl: number,
  alpha = 1,
  o: { finish?: number; shadow?: boolean } = {},
) {
  const L = coverLayers(f),
    edge = f.style.coverEdge || 'album',
    dark = f.pal.dark,
    fin = o.finish ?? 1,
    shOn = o.shadow !== false;
  g.save();
  g.globalAlpha = alpha;
  (g as CanvasRenderingContext2D).imageSmoothingQuality = 'high';
  if (edge === 'album') {
    if (L.vinyl && vinyl > 0.001) {
      const R = S * 0.47,
        cx = x + S * 0.5 + S * 0.38 * vinyl,
        cy = y + S / 2;
      g.save();
      g.shadowColor = 'rgba(0,0,0,.4)';
      g.shadowBlur = gfx() === 'lite' ? 0 : S * 0.05;
      g.translate(cx, cy);
      g.rotate(f.t * 0.9);
      g.drawImage(L.vinyl, -R, -R, 2 * R, 2 * R);
      g.restore();
      const sh = (g as CanvasRenderingContext2D).createConicGradient?.(-0.6, cx, cy);
      if (sh) {
        for (const [p, a] of [
          [0, 0],
          [0.08, 0.1],
          [0.16, 0],
          [0.5, 0],
          [0.58, 0.07],
          [0.66, 0],
          [1, 0],
        ])
          sh.addColorStop(p, `rgba(255,255,255,${a})`);
        g.fillStyle = sh;
        g.beginPath();
        g.arc(cx, cy, R * 0.98, 0, 6.283);
        g.arc(cx, cy, R * 0.34, 0, 6.283, true);
        g.fill();
      }
    }
    if (shOn) {
      g.shadowColor = dark ? 'rgba(0,0,0,.55)' : 'rgba(0,0,0,.3)';
      g.shadowBlur = gfx() === 'lite' ? 0 : S * 0.08;
      g.shadowOffsetY = S * 0.025;
    }
    g.drawImage(L.subj, x, y, S, S);
    g.shadowColor = 'transparent';
    if (fin > 0.003) {
      const a0 = g.globalAlpha;
      g.globalAlpha = a0 * fin;
      const sheen = g.createLinearGradient(x, y, x + S, y + S);
      sheen.addColorStop(0, 'rgba(255,255,255,.16)');
      sheen.addColorStop(0.35, 'rgba(255,255,255,0)');
      sheen.addColorStop(1, 'rgba(0,0,0,.12)');
      g.fillStyle = sheen;
      g.fillRect(x, y, S, S);
      g.strokeStyle = 'rgba(255,255,255,.05)';
      g.lineWidth = S * 0.012;
      g.beginPath();
      g.arc(x + S * 0.5, y + S * 0.5, S * 0.4, 0, 6.283);
      g.stroke();
      g.strokeStyle = 'rgba(255,255,255,.22)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x + 0.5, y + S);
      g.lineTo(x + 0.5, y + 0.5);
      g.lineTo(x + S, y + 0.5);
      g.stroke();
      g.globalAlpha = a0;
    }
  } else if (edge === 'float') {
    const r = S * 0.045;
    if (shOn) {
      g.shadowColor = dark ? 'rgba(0,0,0,.6)' : 'rgba(0,0,0,.28)';
      g.shadowBlur = gfx() === 'lite' ? 0 : S * 0.16;
      g.shadowOffsetY = S * 0.06;
    }
    g.beginPath();
    g.roundRect(x, y, S, S, r);
    g.fillStyle = hexOf(f.pal.bg);
    g.fill();
    g.shadowColor = 'transparent';
    g.clip();
    g.drawImage(L.subj, x, y, S, S);
  } else if (L.blend) {
    const k = 2;
    g.drawImage(L.blend, x + S / 2 - (S * k) / 2, y + S / 2 - (S * k) / 2, S * k, S * k);
  }
  g.restore();
}
/** The corner radius the cover has on screen (for the handoff to match): reference px at size S. */
/** The shadow the cover casts in the scene (reference px at size S), for the hand-over to grow into. */
export const coverShadow = (edge: string | undefined, S: number, dark: boolean) =>
  edge === 'float'
    ? { blur: S * 0.16, oy: S * 0.06, a: dark ? 0.6 : 0.28 }
    : edge === 'blend'
      ? { blur: 0, oy: 0, a: 0 }
      : { blur: S * 0.08, oy: S * 0.025, a: dark ? 0.55 : 0.3 };
export const coverRadius = (edge: string | undefined, S: number) =>
  edge === 'float' ? S * 0.045 : edge === 'blend' ? S * 0.09 : 0;

register({
  id: 'cover',
  label: 'bg.cover',
  layer: 'backdrop',
  kind: 'backdrop',
  draw(g, f, a) {
    const c = coverRest(f, a.bd);
    drawLiquid(g, f, a.bd.Ev, a.bd.ox, a.bd.oy, c.x + c.S / 2, c.y + c.S / 2, f.pal.dark ? 0.2 : 0.1);
    a.under?.();
    if (f.style.fx.rings) drawRings(g, f, c.x + c.S / 2, c.y + c.S / 2); // the beat rings, from behind the sleeve
    if (f.coverOwner !== 'backdrop') return; // the handoff is drawing the cover right now
    drawCoverSubject(g, f, c.x, c.y, c.S, f.vinylOut);
    g.fillStyle = rgba(f.pal.bg, f.pal.dark ? 0.16 : 0.18);
    g.fillRect(-a.bd.Ev, -a.bd.Ev, f.W + 2 * a.bd.Ev, f.H + 2 * a.bd.Ev);
  },
});
