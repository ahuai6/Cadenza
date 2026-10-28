/* The cover theme: the ambient field (the now-playing page's backdrop, unchanged) with the cover set back behind the
   lyrics: as an album sleeve with its record half out, floating, or blended into its own glow.
   drawCoverSubject is the one drawing of the cover: the backdrop uses it where the cover rests, and the shared-element
   handoff uses it while the cover flies in from the now-playing page, so the hand-over is the same picture throughout.
   vinyl (0..1) is how far the record has slid out from under the sleeve: it comes out after the cover lands. */
import { clamp, D2R } from '../../core/math';
import { mix, rgba, hexOf, W3 } from '../../core/color';
import { register, type Ctx, type BackdropView } from './registry';
import type { RenderFrame } from '../frame';
import { makeCanvas } from '../palette';
import { drawAmbient } from './ambient';

type Img = CanvasImageSource & { width: number; height: number };
interface Layers { key: string; subj: HTMLCanvasElement; vinyl: HTMLCanvasElement | null; blend: HTMLCanvasElement | null }
let cache: Layers | null = null;
function square(src: Img, size: number, blur = 0): HTMLCanvasElement {
  const c = makeCanvas(size, size) as HTMLCanvasElement, g = c.getContext('2d')!; g.imageSmoothingQuality = 'high';
  const sw = (src as any).naturalWidth || src.width, sh = (src as any).naturalHeight || src.height, side = Math.min(sw, sh);
  if (blur > 0) g.filter = `blur(${blur}px)`;
  g.drawImage(src, (sw - side) / 2, (sh - side) / 2, side, side, 0, 0, size, size); return c;
}
function placeholder(f: RenderFrame): HTMLCanvasElement {
  const c = makeCanvas(512, 512) as HTMLCanvasElement, g = c.getContext('2d')!, P = f.pal;
  const gr = g.createLinearGradient(0, 0, 512, 512); gr.addColorStop(0, hexOf(P.accent)); gr.addColorStop(1, hexOf(P.bg2)); g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
  g.fillStyle = rgba(P.bg, 0.35); g.beginPath(); g.arc(330, 210, 150, 0, Math.PI * 2); g.fill(); return c;
}
export function coverLayers(f: RenderFrame): Layers {
  const st = f.style, key = `${f.media.coverKey}|${st.coverBlur}|${st.coverEdge}|${st.text}|${f.media.cover ? '' : st.accent + st.bg2}`;
  if (cache && cache.key === key) return cache;
  const src: Img = f.media.cover || placeholder(f), bl = clamp(st.coverBlur ?? 0);
  const subj = square(src, 512, bl * 16);
  let vinyl: HTMLCanvasElement | null = null, blend: HTMLCanvasElement | null = null;
  if (st.coverEdge === 'album' || !st.coverEdge) {
    const D = 512, v = makeCanvas(D, D) as HTMLCanvasElement, g = v.getContext('2d')!, R = D / 2;
    g.translate(R, R); const body = g.createRadialGradient(0, 0, R * 0.3, 0, 0, R); body.addColorStop(0, '#141416'); body.addColorStop(1, '#0a0a0b');
    g.fillStyle = body; g.beginPath(); g.arc(0, 0, R - 1, 0, 6.283); g.fill();
    for (let rr = R * 0.36; rr < R * 0.97; rr += 2.2) { g.strokeStyle = `rgba(255,255,255,${0.025 + 0.025 * Math.sin(rr * 0.7) ** 2})`; g.lineWidth = 1; g.beginPath(); g.arc(0, 0, rr, 0, 6.283); g.stroke(); }
    g.strokeStyle = 'rgba(255,255,255,.08)'; g.lineWidth = 3; g.beginPath(); g.arc(0, 0, R * 0.95, 0, 6.283); g.stroke();
    g.save(); g.beginPath(); g.arc(0, 0, R * 0.33, 0, 6.283); g.clip(); g.drawImage(subj, -R * 0.33, -R * 0.33, R * 0.66, R * 0.66); g.restore();
    g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 2; g.beginPath(); g.arc(0, 0, R * 0.33, 0, 6.283); g.stroke();
    g.fillStyle = '#0b0b0c'; g.beginPath(); g.arc(0, 0, R * 0.025, 0, 6.283); g.fill();
    vinyl = v;
  }
  if (st.coverEdge === 'blend') {
    // like the sun behind cloud: a rounded panel whose edges dissolve into a glow of its own colours, with a bright rim
    const C = 768, o = 128, n = 512, rad = n * 0.09, comp = makeCanvas(C, C) as HTMLCanvasElement, g = comp.getContext('2d')!;
    const halo = square(src, C, 60); g.globalAlpha = 0.85; g.drawImage(halo, 0, 0);
    g.globalAlpha = 1; g.save(); g.filter = 'blur(10px)'; g.beginPath(); g.roundRect(o - 4, o - 4, n + 8, n + 8, rad); g.fillStyle = '#000'; g.globalCompositeOperation = 'destination-out'; g.fill(); g.restore();
    g.save(); g.beginPath(); g.roundRect(o, o, n, n, rad); g.clip(); g.drawImage(subj, o, o, n, n); g.restore();
    g.globalCompositeOperation = 'screen'; g.globalAlpha = 0.35; g.drawImage(halo, 0, 0); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    g.save(); g.filter = 'blur(6px)'; g.strokeStyle = rgba(mix(f.pal.text, W3, 0.5), 0.55); g.lineWidth = 6; g.beginPath(); g.roundRect(o + 2, o + 2, n - 4, n - 4, rad); g.stroke(); g.restore();
    blend = comp;
  }
  cache = { key, subj, vinyl, blend }; return cache;
}

/** Where the cover rests in the backdrop's own frame (before the backdrop camera's roll and zoom), in reference px. */
export function coverRest(f: RenderFrame, bd: Pick<BackdropView, 'ox' | 'oy'>): { x: number; y: number; S: number } {
  const S = Math.min(f.W, f.H) * (f.style.coverSize ?? 0.6) * (1 + f.P * 0.012), album = (f.style.coverEdge || 'album') === 'album';
  return { x: f.W / 2 - S / 2 + bd.ox * 0.6 - (album ? S * 0.16 : 0), y: f.H * 0.47 - S / 2 + bd.oy * 0.6, S };
}
/** The cover itself at (x, y, S) in the current transform: sleeve with its record (vinyl: how far it is out), float, or blend. */
/** o.finish (0..1): how much of the scene's own finish the cover wears (its sheen, rim light and groove) — the hand-over
 *  grows it from the page's plain cover; o.shadow false: the caller draws the shadow itself. */
export function drawCoverSubject(g: Ctx, f: RenderFrame, x: number, y: number, S: number, vinyl: number, alpha = 1, o: { finish?: number; shadow?: boolean } = {}) {
  const L = coverLayers(f), edge = f.style.coverEdge || 'album', dark = f.pal.dark, fin = o.finish ?? 1, shOn = o.shadow !== false;
  g.save(); g.globalAlpha = alpha; (g as CanvasRenderingContext2D).imageSmoothingQuality = 'high';
  if (edge === 'album') {
    if (L.vinyl && vinyl > 0.001) {
      const R = S * 0.47, cx = x + S * 0.5 + S * 0.38 * vinyl, cy = y + S / 2;
      g.save(); g.shadowColor = 'rgba(0,0,0,.4)'; g.shadowBlur = S * 0.05; g.translate(cx, cy); g.rotate(f.t * 0.9); g.drawImage(L.vinyl, -R, -R, 2 * R, 2 * R); g.restore();
      const sh = (g as CanvasRenderingContext2D).createConicGradient?.(-0.6, cx, cy);
      if (sh) { for (const [p, a] of [[0, 0], [0.08, 0.1], [0.16, 0], [0.5, 0], [0.58, 0.07], [0.66, 0], [1, 0]]) sh.addColorStop(p, `rgba(255,255,255,${a})`);
        g.fillStyle = sh; g.beginPath(); g.arc(cx, cy, R * 0.98, 0, 6.283); g.arc(cx, cy, R * 0.34, 0, 6.283, true); g.fill(); }
    }
    if (shOn) { g.shadowColor = dark ? 'rgba(0,0,0,.55)' : 'rgba(0,0,0,.3)'; g.shadowBlur = S * 0.08; g.shadowOffsetY = S * 0.025; }
    g.drawImage(L.subj, x, y, S, S); g.shadowColor = 'transparent';
    if (fin > 0.003) { const a0 = g.globalAlpha; g.globalAlpha = a0 * fin;
      const sheen = g.createLinearGradient(x, y, x + S, y + S); sheen.addColorStop(0, 'rgba(255,255,255,.16)'); sheen.addColorStop(0.35, 'rgba(255,255,255,0)'); sheen.addColorStop(1, 'rgba(0,0,0,.12)');
      g.fillStyle = sheen; g.fillRect(x, y, S, S);
      g.strokeStyle = 'rgba(255,255,255,.05)'; g.lineWidth = S * 0.012; g.beginPath(); g.arc(x + S * 0.5, y + S * 0.5, S * 0.4, 0, 6.283); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,.22)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x + 0.5, y + S); g.lineTo(x + 0.5, y + 0.5); g.lineTo(x + S, y + 0.5); g.stroke(); g.globalAlpha = a0; }
  } else if (edge === 'float') {
    const r = S * 0.045; if (shOn) { g.shadowColor = dark ? 'rgba(0,0,0,.6)' : 'rgba(0,0,0,.28)'; g.shadowBlur = S * 0.16; g.shadowOffsetY = S * 0.06; }
    g.beginPath(); g.roundRect(x, y, S, S, r); g.fillStyle = hexOf(f.pal.bg); g.fill(); g.shadowColor = 'transparent'; g.clip(); g.drawImage(L.subj, x, y, S, S);
  } else if (L.blend) { const k = 1.5; g.drawImage(L.blend, x + S / 2 - S * k / 2, y + S / 2 - S * k / 2, S * k, S * k); }
  g.restore();
}
/** The corner radius the cover has on screen (for the handoff to match): reference px at size S. */
/** The shadow the cover casts in the scene (reference px at size S), for the hand-over to grow into. */
export const coverShadow = (edge: string | undefined, S: number, dark: boolean) => (edge === 'float' ? { blur: S * 0.16, oy: S * 0.06, a: dark ? 0.6 : 0.28 } : edge === 'blend' ? { blur: 0, oy: 0, a: 0 } : { blur: S * 0.08, oy: S * 0.025, a: dark ? 0.55 : 0.3 });
export const coverRadius = (edge: string | undefined, S: number) => (edge === 'float' ? S * 0.045 : edge === 'blend' ? S * 0.09 : 0);

register({ id: 'cover', label: 'bg.cover', layer: 'backdrop', kind: 'backdrop',
  draw(g, f, a) {
    drawAmbient(g, f, a.bd.Ev, f.pal.dark ? 0.2 : 0.1);
    if (f.coverOwner !== 'backdrop') return;                       // the handoff is drawing the cover right now
    const c = coverRest(f, a.bd); drawCoverSubject(g, f, c.x, c.y, c.S, f.vinylOut);
    g.fillStyle = rgba(f.pal.bg, f.pal.dark ? 0.16 : 0.18); g.fillRect(-a.bd.Ev, -a.bd.Ev, f.W + 2 * a.bd.Ev, f.H + 2 * a.bd.Ev);
  } });
export const _D2R = D2R;
