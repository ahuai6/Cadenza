/* Shared elements between the now-playing page (DOM) and the picture (canvas). On the way in, the page hands over where
   its cover and its lyric lines are; the engine takes them over and flies them to their places in the scene: the cover
   to where the cover theme rests it (turning to the backdrop's roll as it goes, its corners becoming the theme's), then
   the record slides out from under it; the current line to the words it becomes, crossfading into them. On the way
   out the same flight runs back to where the page measures its elements now. One progress value drives all of it. */
import { clamp, lerp, sstep, D2R } from '../core/math';
import { cubicBezier } from '../core/ease';
import { rgba } from '../core/color';
import type { RenderFrame } from '../render/frame';
import type { Ctx } from '../render/effects/registry';
import { coverRest, drawCoverSubject, coverRadius } from '../render/effects/cover';

export interface WinRect { left: number; top: number; width: number; height: number }
export interface HandoffCover { rect: WinRect; radius: number }
export interface HandoffLine { i: number; rect: WinRect; text: string; font: string; px: number; color: string }
export interface HandoffSpec { cover?: HandoffCover | null; lines?: HandoffLine[] }

const FLY = cubicBezier(0.32, 0.72, 0, 1);       // the drawer curve: leaves at once, settles long
/** The timeline of a hand-over, as a function of its progress p (0 = the page, 1 = the picture). */
export function phases(p: number) {
  return {
    cover: FLY(clamp(p / 0.72)),                         // the cover leads
    scene: sstep(clamp((p - 0.12) / 0.7)),                // the picture follows it out
    vinyl: sstep(clamp((p - 0.74) / 0.26)),               // the record comes out once the sleeve has landed
    line: (k: number) => FLY(clamp((p - 0.06 - 0.05 * k) / 0.66)),
  };
}

/** Where the cover lands on screen (reference px), its rotation (deg) and corner radius; null when no cover is drawn. */
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
  p = 0; target = 0; private from = 0; private t0 = 0; private dur = 1100; spec: HandoffSpec = {};
  /** converts a window rect to reference px of the frame */
  toRef: (r: WinRect) => { x: number; y: number; w: number; h: number } = r => ({ x: r.left, y: r.top, w: r.width, h: r.height });
  private done: (() => void) | null = null;
  go(target: number, spec: HandoffSpec, ms = 1100): Promise<void> {
    this.from = this.p; this.target = target; this.t0 = performance.now(); this.dur = ms * Math.max(0.35, Math.abs(target - this.p)); this.spec = spec;
    this.done?.();
    return new Promise(res => { this.done = res; });
  }
  jump(p: number) { this.p = this.target = p; this.done?.(); this.done = null; }
  /** Advance by the interface clock; true while moving. */
  tick(): boolean {
    if (this.p === this.target) return false;
    const u = clamp((performance.now() - this.t0) / this.dur); this.p = this.from + (this.target - this.from) * u;
    if (u >= 1) { this.p = this.target; const d = this.done; this.done = null; d?.(); }
    return true;
  }
  get moving() { return this.p !== this.target || (this.p > 0 && this.p < 1); }
  get active() { return this.p > 0.0001 && this.p < 0.9999; }

  /** Draw the flying cover and lines over the frame. */
  draw(g: Ctx, f: RenderFrame) {
    if (!this.active) return;
    const ph = phases(this.p), sp = this.spec;
    g.save(); g.setTransform(f.px, 0, 0, f.px, 0, 0);
    if (sp.cover) {
      const a = this.toRef(sp.cover.rect), tg = coverTarget(f), u = ph.cover;
      const S0 = a.w, cx = lerp(a.x + a.w / 2, tg.cx, u), cy = lerp(a.y + a.h / 2, tg.cy, u), S = lerp(S0, tg.S, u), rot = lerp(0, tg.rot, u);
      const rad = lerp(sp.cover.radius * a.w / Math.max(1, sp.cover.rect.width), tg.radius, u);
      const alpha = tg.fade ? 1 - sstep(clamp((this.p - 0.7) / 0.3)) : 1;
      g.save(); g.translate(cx, cy); g.rotate(rot * D2R);
      if (rad > 0.5) { g.beginPath(); g.roundRect(-S / 2, -S / 2, S, S, rad); g.clip(); }
      drawCoverSubject(g, f, -S / 2, -S / 2, S, tg.fade ? 0 : ph.vinyl, alpha);
      g.restore();
    }
    // lines: the page's lines fly to their words in the scene, then hand over to them
    for (const L of sp.lines || []) {
      const P = f.plan.lines[L.i]; if (!P) continue; const k = Math.max(0, (sp.lines || []).indexOf(L)), u = ph.line(k);
      const a = this.toRef(L.rect), vis = (f.vis || []).filter(v => v.S.line === P);
      let tx = a.x + a.w / 2, ty = a.y + a.h / 2 - 30 * u, ts = 1;
      if (vis.length) { let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (const v of vis) { const hw = v.S.lw * v.p.k / 2, hh = v.S.lh * v.p.k / 2; x0 = Math.min(x0, v.p.sx - hw); x1 = Math.max(x1, v.p.sx + hw); y0 = Math.min(y0, v.p.sy - hh); y1 = Math.max(y1, v.p.sy + hh); }
        tx = f.W / 2 + (x0 + x1) / 2; ty = f.H / 2 + (y0 + y1) / 2; ts = clamp((x1 - x0) / Math.max(1, a.w), 0.3, 6); }
      const x = lerp(a.x + a.w / 2, tx, u), y = lerp(a.y + a.h / 2, ty, u), s = lerp(1, ts, u), al = (1 - sstep(clamp((u - 0.62) / 0.3))) * (vis.length ? 1 : 1 - u);
      if (al < 0.01) continue;
      g.save(); g.translate(x, y); g.scale(s, s); g.globalAlpha = al; g.font = L.font.replace(/(\d+(\.\d+)?)px/, `${(L.px * a.w / Math.max(1, L.rect.width)).toFixed(2)}px`);
      g.fillStyle = L.color; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(L.text, 0, 0, a.w * 1.2); g.restore();
    }
    g.restore();
  }
  /** While the lines fly, the scene's own words for them wait, then fade in as the flight hands over. */
  wordAlpha(lineIndex: number): number {
    if (!this.active || !this.spec.lines) return 1;
    const k = this.spec.lines.findIndex(L => L.i === lineIndex); if (k < 0) return 1;
    return sstep(clamp((phases(this.p).line(k) - 0.62) / 0.3));
  }
  get coverOwner(): 'backdrop' | 'handoff' | 'none' { return this.p >= 0.9999 ? 'backdrop' : this.p <= 0.0001 ? 'none' : this.spec.cover ? 'handoff' : 'backdrop'; }
  get vinyl() { return phases(this.p).vinyl; }
  get scene() { return phases(this.p).scene; }
}
export const _rgba = rgba;
