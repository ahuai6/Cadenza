/* Shared elements between the now-playing page (DOM) and the picture (canvas). On the way in, the page hands over where
   its cover and its lyric lines are; the engine takes them over and flies them to their places in the scene: the cover
   to where the cover theme rests it (turning to the backdrop's roll as it goes, its corners becoming the theme's), then
   the record slides out from under it; the current line to the words it becomes, crossfading into them. On the way
   out the same flight runs back to where the page measures its elements now. One progress value drives all of it. */
import { clamp, lerp, sstep, D2R } from '../core/math';
import { fontStack } from '../text/fonts';
import { rgba } from '../core/color';
import { captionLayout } from '../render/post';
import type { RenderFrame } from '../render/frame';
import type { Ctx } from '../render/effects/registry';
import { coverRest, drawCoverSubject, coverRadius, coverShadow } from '../render/effects/cover';

export interface WinRect { left: number; top: number; width: number; height: number }
export interface HandoffCover { rect: WinRect; radius: number }
/** A lyric line on the page: its box, its text and type, and (when the page wraps it) its rows. */
/** A lyric line on the page: its box, its text and type, its rows (as the page wraps it) and each word's own box. */
export interface HandoffLine { i: number; rect: WinRect; text: string; font: string; px: number; color: string; alpha?: number; rows?: { rect: WinRect; text: string }[]; words?: { rect: WinRect; text: string }[];
  /** its translation / romanisation lines as the page shows them (they fly down to the captions) */ subs?: { rect: WinRect; text: string; font: string; px: number }[] }
export interface HandoffSpec { cover?: HandoffCover | null; lines?: HandoffLine[] }

/** The timeline of a hand-over, as a function of its progress p (0 = the page, 1 = the picture). p itself moves on a
 *  critically damped spring, so every part starts softly and lands softly, and a reversal keeps its momentum. */
export function phases(p: number) {
  return {
    cover: clamp(p / 0.72),                               // the cover leads
    scene: sstep(clamp((p - 0.06) / 0.74)),               // the picture follows it out
    vinyl: sstep(clamp((p - 0.78) / 0.22)),               // the record comes out once the sleeve has landed
    line: (k: number) => clamp((p - 0.03 - 0.035 * k) / 0.84),
  };
}
const ease = (u: number) => u * u * (3 - 2 * u) * 0.35 + u * 0.65;        // a touch of ease on top of the spring

/** Where the cover lands in the picture (reference px, centre), with its roll and corners; `fade` when the theme has no cover. */
export function coverTarget(f: RenderFrame): { cx: number; cy: number; S: number; rot: number; radius: number; fade: boolean } {
  const fx = f.cam.fx, roll = fx.r - f.cam.cont.r, zoom = fx.z, bd = { ox: fx.x * 0.5 - f.cam.hand[0] * 0.35, oy: fx.y * 0.5 - f.cam.hand[1] * 0.35 };
  if (f.style.bgStyle === 'cover' && !(f.media.mv && f.media.mv.k > 0.5)) {
    const c = coverRest(f, bd), x = c.x + c.S / 2 - f.W / 2, y = c.y + c.S / 2 - f.H / 2, cr = Math.cos(roll * D2R), sr = Math.sin(roll * D2R);
    return { cx: f.W / 2 + (x * cr - y * sr) * zoom, cy: f.H / 2 + (x * sr + y * cr) * zoom, S: c.S * zoom, rot: roll, radius: coverRadius(f.style.coverEdge, c.S * zoom), fade: false };
  }
  const S = Math.min(f.W, f.H) * 0.42; return { cx: f.W / 2, cy: f.H * 0.47, S, rot: 0, radius: S * 0.06, fade: true };
}

export class Handoff {
  /** progress (0 page .. 1 picture), animated by the engine toward `target` */
  p = 0; target = 0; private v = 0; private last = 0; spec: HandoffSpec = {};
  /** converts a window rect to reference px of the frame */
  toRef: (r: WinRect) => { x: number; y: number; w: number; h: number } = r => ({ x: r.left, y: r.top, w: r.width, h: r.height });
  private done: (() => void) | null = null;
  private byWord = new Map<number, boolean>();
  go(target: number, spec: HandoffSpec): Promise<void> {
    if (this.p === this.target) this.last = performance.now();
    this.target = target; this.spec = spec;
    this.done?.();
    return new Promise(res => { this.done = res; });
  }
  jump(p: number) { this.p = this.target = p; this.v = 0; this.done?.(); this.done = null; }
  /** Advance by the interface clock (a critically damped spring, about 0.9 s to land); true while moving. */
  tick(): boolean {
    if (this.p === this.target && this.v === 0) return false;
    const now = performance.now(), dt = clamp((now - (this.last || now)) / 1000, 0, 1 / 30); this.last = now;
    const w = 6.6;
    for (let i = 0; i < 4; i++) { const h = dt / 4, a = -w * w * (this.p - this.target) - 2 * w * this.v; this.v += a * h; this.p += this.v * h; }
    if (Math.abs(this.p - this.target) < 0.0015 && Math.abs(this.v) < 0.02) { this.p = this.target; this.v = 0; const d = this.done; this.done = null; d?.(); }
    return true;
  }
  get moving() { return this.p !== this.target || (this.p > 0 && this.p < 1); }
  get active() { return this.p > 0.0001 && this.p < 0.9999; }

  /** The flying cover, drawn where the backdrop draws its own cover (under the words), so it never changes layer. */
  drawCover(g: Ctx, f: RenderFrame) {
    const sp = this.spec; if (!this.active || !sp.cover) return;
    const ph = phases(this.p), a = this.toRef(sp.cover.rect), tg = coverTarget(f), u = ease(ph.cover);
    const cx = lerp(a.x + a.w / 2, tg.cx, u), cy = lerp(a.y + a.h / 2, tg.cy, u), S = lerp(a.w, tg.S, u), rot = lerp(0, tg.rot, u);
    const rad = lerp(sp.cover.radius * a.w / Math.max(1, sp.cover.rect.width), tg.radius, u);
    const alpha = tg.fade ? 1 - sstep(clamp((this.p - 0.7) / 0.3)) : 1;
    // its shadow: from the page's (CSS 0 24px 70px, 45 %) to the one the scene gives it, all the way
    // (canvas shadows are in device px; the scene's cover gives its own in the backdrop's units, as it draws them)
    const kd = a.w / Math.max(1, sp.cover.rect.width) * f.px, sh0 = { blur: 35 * kd, oy: 24 * kd, a: 0.45 }, sh1 = coverShadow(f.style.coverEdge, tg.S, f.pal.dark);
    const sb = lerp(sh0.blur, tg.fade ? sh0.blur : sh1.blur, u), so = lerp(sh0.oy, tg.fade ? sh0.oy : sh1.oy, u), sa = lerp(sh0.a, tg.fade ? sh0.a : sh1.a, u) * alpha;
    g.save(); g.setTransform(f.px, 0, 0, f.px, 0, 0); g.translate(cx, cy); g.rotate(rot * D2R);
    if (sa > 0.005) { g.save(); g.shadowColor = `rgba(0,0,0,${sa.toFixed(3)})`; g.shadowBlur = sb; g.shadowOffsetY = so; g.fillStyle = '#000'; g.beginPath(); g.roundRect(-S / 2, -S / 2, S, S, Math.max(0, rad)); g.fill(); g.restore(); }
    if (rad > 0.5) { g.beginPath(); g.roundRect(-S / 2, -S / 2, S, S, rad); g.clip(); }
    drawCoverSubject(g, f, -S / 2, -S / 2, S, tg.fade ? 0 : ph.vinyl, alpha, { finish: ph.scene, shadow: false });
    g.restore();
  }
  /** The page's words, each flying to the word it becomes in the scene and growing into it: position, size and turn
   *  meet the scene's glyph exactly, and the two are crossfaded only where they coincide. */
  draw(g: Ctx, f: RenderFrame) {
    if (!this.active) return;
    const ph = phases(this.p), sp = this.spec;
    g.save(); g.setTransform(f.px, 0, 0, f.px, 0, 0); g.textAlign = 'center'; g.textBaseline = 'middle';
    const fc = fontStack(f.style.font, f.plan.doc.lines.map(L => L.text).join('').slice(0, 400)), sceneFont = (px: number) => `${fc.w} ${px.toFixed(2)}px ${fc.stack}`;
    (sp.lines || []).forEach((L, li) => {
      const P = f.plan.lines[L.i]; if (!P) return;
      const a = this.toRef(L.rect), kr = a.w / Math.max(1, L.rect.width), lineVis = (f.vis || []).filter(v => v.S.line === P);
      // word for word when the page and the scene split the line alike; otherwise the line flies whole to the scene's words
      const byWord = !!L.words && L.words.length > 1 && L.words.length === P.words.length, words = byWord ? L.words! : [{ rect: L.rect, text: L.text }];
      this.byWord.set(L.i, byWord);
      words.forEach((Wd, k) => {
        const u = ease(ph.line(li + k * 0.35)), b = this.toRef(Wd.rect), x0 = b.x + b.w / 2, y0 = b.y + b.h / 2, px0 = L.px * kr;
        const vs = byWord ? lineVis.filter(q => q.S.k === k) : lineVis;
        let x1 = x0, y1 = y0 - 24, px1 = px0, r1 = 0, hand = 0;
        if (vs.length) { x1 = f.W / 2 + vs.reduce((s, v) => s + v.p.sx, 0) / vs.length; y1 = f.H / 2 + vs.reduce((s, v) => s + v.p.sy, 0) / vs.length;
          px1 = vs.reduce((s, v) => s + v.glyphPx, 0) / vs.length / f.px; const v = vs[0]; r1 = v.S.tilt + v.p.rot + v.ws.frot; hand = byWord || vs.length === 1 ? 1 : 0; }
        const x = lerp(x0, x1, u), y = lerp(y0, y1, u), pxs = lerp(px0, px1, u), rot = lerp(0, r1, u);
        // the page's type gives way to the scene's own type over the flight, and the scene's glyph takes over on landing
        const fade = hand ? 1 - sstep(clamp((u - 0.86) / 0.14)) : 1 - sstep(clamp(u / 0.55)), al = fade * lerp(L.alpha ?? 1, 1, u); if (al < 0.01) return;
        g.save(); g.translate(x, y); g.rotate(rot * D2R); g.fillStyle = L.color;
        const mixT = sstep(clamp((u - 0.2) / 0.6));
        if (mixT < 1) { g.globalAlpha = al * (1 - mixT); g.font = L.font.replace(/(\d+(\.\d+)?)px/, `${pxs.toFixed(2)}px`); g.fillText(Wd.text, 0, 0); }
        if (mixT > 0) { g.globalAlpha = al * mixT; g.font = sceneFont(pxs); g.fillText(Wd.text, 0, 0); }
        g.restore();
      });
      // the sung line's translation and romanisation glide down to where the picture shows them as captions (and grow or
      // shrink to their size there); the other lines' fade out with their lines
      if (L.subs?.length) { const cur = li === 0, cap = captionLayout(f, L.subs.map(x => x.text), f.H * 0.9), u = ease(clamp(ph.line(li) * 1.3));
        L.subs.forEach((sb, k) => { const b = this.toRef(sb.rect), x0 = b.x + b.w / 2, y0 = b.y + b.h / 2, px0 = sb.px * kr;
          const x = cur ? lerp(x0, f.W / 2, u) : x0, y = cur ? lerp(y0, cap[k].y, u) : y0 - 18 * u, pxs = cur ? lerp(px0, cap[k].sz, u) : px0;
          const al = (cur ? 1 - sstep(clamp((u - 0.7) / 0.3)) : (1 - sstep(clamp(u / 0.5)))) * (L.alpha ?? 1) * 0.75; if (al < 0.01) return;
          g.save(); g.fillStyle = L.color; g.globalAlpha = al; g.font = sb.font.replace(/(\d+(\.\d+)?)px/, `${pxs.toFixed(2)}px`); g.fillText(sb.text, x, y); g.restore(); });
      }
    });
    g.restore();
  }
  /** While the lines fly, the scene's own words for them wait, then fade in as the flight hands over. */
  wordAlpha(lineIndex: number, k = 0): number {
    if (!this.active || !this.spec.lines) return 1;
    const li = this.spec.lines.findIndex(L => L.i === lineIndex); if (li < 0) return 1;
    const bw = this.byWord.get(lineIndex) ?? false, u = ease(phases(this.p).line(li + (bw ? k : 0) * 0.35));
    return bw ? sstep(clamp((u - 0.86) / 0.14)) : sstep(clamp((u - 0.55) / 0.45));
  }
  get coverOwner(): 'backdrop' | 'handoff' | 'none' { return this.p >= 0.9999 ? 'backdrop' : this.p <= 0.0001 ? 'none' : this.spec.cover ? 'handoff' : 'backdrop'; }
  get vinyl() { return phases(this.p).vinyl; }
  get scene() { return phases(this.p).scene; }
}
export const _rgba = rgba;
