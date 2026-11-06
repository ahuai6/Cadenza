/* The lyric layer on the GPU (WebGL2). The lyric pass (lyrics.ts) is drawn unchanged into a recording context that
   looks like a 2D canvas to it; everything it draws is an image — the glyph ladder's blurred levels, the shadows, the
   sharp glyphs (all from bitmaps here: glyphs.ts setAllBitmap), the outlines — so each draw becomes one textured quad
   with its full transform and opacity. The bitmaps live in a few large atlas textures (uploaded once), and a frame's
   quads go out in a handful of instanced draws, in the order they were drawn (source-over, premultiplied: what the
   canvas does). The finished layer is set into the frame in one copy.
   What it saves: the 2D canvas records and replays each of those hundreds of image draws and state changes one by one
   on the page's thread; here they are a few numbers each in one buffer.
   Whenever WebGL2 is not there, or its context is lost, the lyric pass draws onto the frame as before. */
import { setAllBitmap, sharpBm } from './glyphs';
import { EM } from '../text/metrics';
import { makeCanvas } from './palette';
import type { Ctx } from './effects/registry';

type Src = (ImageBitmap | HTMLCanvasElement | OffscreenCanvas) & { width: number; height: number };
type M = [number, number, number, number, number, number];
const mul = (m: M, a: number, b: number, c: number, d: number, e: number, f: number): M =>
  [m[0] * a + m[2] * b, m[1] * a + m[3] * b, m[0] * c + m[2] * d, m[1] * c + m[3] * d, m[0] * e + m[2] * f + m[4], m[1] * e + m[3] * f + m[5]];

/* ---------- the atlas: shelves on 2048² pages; a bitmap too big for a shelf gets a texture of its own ---------- */
// (BIG: past this a bitmap gets a texture of its own — the glyphs never do now (glyphs.ts caps them for this layer under
// it), only an odd large image; OWN_MAX: the graphics memory those may hold, by size, not count)
const PAGE = 2048, MAX_PAGES = 10, BIG = 1100, GUT = 2, OWN_MAX = 64e6;
interface Slot { tex: WebGLTexture; u0: number; v0: number; u1: number; v1: number; page: Page | null }
interface Page { tex: WebGLTexture; shelves: { y: number; h: number; x: number }[]; top: number; /** what is on it */ srcs: object[]; /** the layer it was last drawn from */ used: number }

/* ---------- the recording context ---------- */
const norm = (makeCanvas(1, 1) as HTMLCanvasElement).getContext('2d')!;
const colours = new Map<string, string>(), fonts = new Map<string, string>();
const normColour = (c: unknown) => { if (typeof c !== 'string') return c; let v = colours.get(c); if (v == null) { norm.fillStyle = '#000'; norm.fillStyle = c; v = norm.fillStyle as string; colours.set(c, v); } return v; };
const normFont = (f: string) => { let v = fonts.get(f); if (v == null) { norm.font = f; v = norm.font; fonts.set(f, v); } return v; };
const DUMMY_GRAD = { addColorStop() { /* (a sharp glyph's gradient is the bitmap's own here) */ } };
class Rec {
  m: M = [1, 0, 0, 1, 0, 0]; globalAlpha = 1; private _fill: unknown = '#000'; private _stroke: unknown = '#000'; private _font = '10px sans-serif';
  textAlign = 'center'; textBaseline = 'middle'; imageSmoothingEnabled = true; globalCompositeOperation = 'source-over'; filter = 'none';
  private stack: { m: M; a: number; f: unknown; s: unknown; font: string }[] = [];
  constructor(private out: GpuLyrics) {}
  get canvas() { return this.out.canvas; }
  get fillStyle() { return this._fill; } set fillStyle(v: unknown) { this._fill = normColour(v); }
  get strokeStyle() { return this._stroke; } set strokeStyle(v: unknown) { this._stroke = normColour(v); }
  get font() { return this._font; } set font(v: string) { this._font = normFont(v); }
  save() { this.stack.push({ m: this.m, a: this.globalAlpha, f: this._fill, s: this._stroke, font: this._font }); }
  restore() { const s = this.stack.pop(); if (!s) return; this.m = s.m; this.globalAlpha = s.a; this._fill = s.f; this._stroke = s.s; this._font = s.font; }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number) { this.m = [a, b, c, d, e, f]; }
  getTransform() { const [a, b, c, d, e, f] = this.m; return { a, b, c, d, e, f } as DOMMatrix; }
  transform(a: number, b: number, c: number, d: number, e: number, f: number) { this.m = mul(this.m, a, b, c, d, e, f); }
  translate(x: number, y: number) { this.m = mul(this.m, 1, 0, 0, 1, x, y); }
  scale(x: number, y: number) { this.m = mul(this.m, x, 0, 0, y, 0, 0); }
  rotate(r: number) { const c = Math.cos(r), s = Math.sin(r); this.m = mul(this.m, c, s, -s, c, 0, 0); }
  createLinearGradient() { return DUMMY_GRAD as unknown as CanvasGradient; }
  drawImage(src: Src, ...a: number[]) {
    if (a.length === 8) this.out.quad(src, a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7], this.m, this.globalAlpha);
    else if (a.length === 4) this.out.quad(src, 0, 0, src.width, src.height, a[0], a[1], a[2], a[3], this.m, this.globalAlpha);
    else this.out.quad(src, 0, 0, src.width, src.height, a[0], a[1], src.width, src.height, this.m, this.globalAlpha);
  }
  /** Text (a harmony): from its sharp bitmap, as the glyphs are — at the size it is seen. */
  fillText(txt: string, x: number, y: number) {
    const px = +(this._font.match(/([\d.]+)px/)?.[1] ?? EM), k = px / EM, font = this._font.replace(/[\d.]+px/, `${EM}px`);
    const G = px * Math.sqrt(Math.abs(this.m[0] * this.m[3] - this.m[1] * this.m[2])); if (G < 0.5) return;
    const e = sharpBm(font, txt, G, typeof this._fill === 'string' ? this._fill : '#fff'), s = e.s * k;
    this.out.quad(e.bm as Src, 0, 0, e.w, e.h, x - e.w / 2 * s, y - e.h / 2 * s, e.w * s, e.h * s, this.m, this.globalAlpha);
  }
}

/* ---------- the GPU side ---------- */
/** (a bitmap is uploaded through a 2D canvas: for an ImageBitmap WebGL ignores how it is asked to premultiply, and
 *  leaves it to how the bitmap was made — a canvas is uploaded as asked) */
const UP = makeCanvas(16, 16) as HTMLCanvasElement, upg = UP.getContext('2d', { willReadFrequently: true })!;   // (in memory: uploaded without a read back from the graphics card)
// (uploaded as a w × h rectangle from its top left corner: WebGL2's sized texSubImage2D)
function viaCanvas(src: Src): TexImageSource {
  if (!(typeof ImageBitmap !== 'undefined' && src instanceof ImageBitmap)) return src as TexImageSource;
  if (UP.width < src.width || UP.height < src.height) { UP.width = Math.max(UP.width, src.width); UP.height = Math.max(UP.height, src.height); }
  upg.setTransform(1, 0, 0, 1, 0, 0); upg.globalCompositeOperation = 'copy'; upg.drawImage(src, 0, 0); upg.globalCompositeOperation = 'source-over';
  return UP;
}
const VS = `#version 300 es
layout(location=0) in vec2 corner;
layout(location=1) in vec4 m0;      // a, b, c, d
layout(location=2) in vec4 m1;      // e, f, alpha, -
layout(location=3) in vec4 rect;    // dx, dy, dw, dh
layout(location=4) in vec4 uv;      // u0, v0, u1, v1
uniform vec2 size;
out vec2 vUv; out float vA;
void main() {
  vec2 p = rect.xy + corner * rect.zw;
  vec2 q = vec2(m0.x * p.x + m0.z * p.y + m1.x, m0.y * p.x + m0.w * p.y + m1.y);
  gl_Position = vec4(q.x / size.x * 2.0 - 1.0, 1.0 - q.y / size.y * 2.0, 0.0, 1.0);
  vUv = mix(uv.xy, uv.zw, corner); vA = m1.z;
}`;
const FS = `#version 300 es
precision mediump float;
uniform sampler2D tex; in vec2 vUv; in float vA; out vec4 o;
void main() { o = texture(tex, vUv) * vA; }`;
const F = 16;   // floats per quad

export class GpuLyrics {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas; readonly ctx: Ctx;
  private gl: WebGL2RenderingContext; private prog: WebGLProgram; private buf: WebGLBuffer; private uSize: WebGLUniformLocation;
  private data = new Float32Array(F * 1024); private n = 0; private tex: WebGLTexture | null = null;
  private slots = new WeakMap<object, Slot>(); private pages: Page[] = []; private own: WebGLTexture[] = []; private ownSize = new Map<WebGLTexture, number>(); private ownBytes = 0; private bigOf = new Map<WebGLTexture, object[]>();
  private dry = false; lost = false; w = 0; h = 0;
  /** the live layers drawn so far (a look ahead counts as the layer before it: it never empties a page that one used) */ private frameNo = 0; private fbo: WebGLFramebuffer | null = null;
  /** quads drawn and bitmaps uploaded in the last frame (for the profiler) */ stats = { quads: 0, uploads: 0, draws: 0 };
  private constructor(canvas: HTMLCanvasElement | OffscreenCanvas, gl: WebGL2RenderingContext) {
    this.canvas = canvas; this.gl = gl; this.ctx = new Rec(this) as unknown as Ctx;
    const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader'); return s; };
    const p = gl.createProgram()!; gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link');
    this.prog = p; this.uSize = gl.getUniformLocation(p, 'size')!;
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const corners = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, corners); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.buf = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    for (let i = 0; i < 4; i++) { gl.enableVertexAttribArray(1 + i); gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, F * 4, i * 16); gl.vertexAttribDivisor(1 + i, 1); }
    gl.useProgram(p); gl.uniform1i(gl.getUniformLocation(p, 'tex'), 0);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    (canvas as HTMLCanvasElement).addEventListener?.('webglcontextlost', (e: Event) => { e.preventDefault(); this.lost = true; console.warn('[gpu] WebGL lyric layer context lost: lyrics go back to the 2D canvas'); });
  }
  static create(): GpuLyrics | null {
    try {
      const cv: any = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(16, 16) : makeCanvas(16, 16);
      const gl = cv.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true }) as WebGL2RenderingContext | null;
      return gl ? new GpuLyrics(cv, gl) : null;
    } catch (e) { console.warn('GPU lyrics unavailable', e); return null; }
  }
  /** Can it draw (its context not lost: a driver reset, a GPU switch — then the lyrics go back to the 2D canvas for good). */
  alive() { if (!this.lost && this.gl.isContextLost()) this.lost = true; return !this.lost; }
  /** Start a layer of w × h device pixels (dry: make and upload what it needs, draw nothing — a look ahead). */
  begin(w: number, h: number, dry = false) {
    const gl = this.gl; this.dry = dry; this.n = 0; if (!dry) this.frameNo++; this.stats = { quads: 0, uploads: 0, draws: 0 };
    if (!dry) {
      // (the canvas only grows: the live picture and an export of another size take turns on it, each drawn into its
      // top left corner — a canvas resized every frame would be made anew every frame)
      if (this.canvas.width < w || this.canvas.height < h) { this.canvas.width = Math.max(this.canvas.width, w); this.canvas.height = Math.max(this.canvas.height, h); }
      const y = this.canvas.height - h; gl.viewport(0, y, w, h); gl.enable(gl.SCISSOR_TEST); gl.scissor(0, y, w, h);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.useProgram(this.prog); gl.uniform2f(this.uSize, w, h); this.w = w; this.h = h; }
    setAllBitmap(true);
    const r = this.ctx as unknown as Rec; r.setTransform(1, 0, 0, 1, 0, 0); r.globalAlpha = 1;
  }
  /** The finished layer: its top left w × h (to be drawn over the frame at its origin, 1:1). */
  end() { this.flush(); setAllBitmap(false); return this.canvas; }
  private slot(src: Src): Slot | null {
    let s = this.slots.get(src); if (s) return s;
    const gl = this.gl, w = src.width, h = src.height; if (!w || !h) return null;
    this.stats.uploads++;
    if (w > BIG || h > BIG) {
      const tex = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, tex); this.params();
      const c = viaCanvas(src); if (c === UP) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, UP); }
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c); this.own.push(tex); this.ownSize.set(tex, w * h * 4); this.ownBytes += w * h * 4;
      while (this.own.length > 1 && (this.ownBytes > OWN_MAX || this.own.length > 48)) { this.flush(); const old = this.own.shift()!; this.ownBytes -= this.ownSize.get(old) ?? 0; this.ownSize.delete(old); for (const k of this.bigOf.get(old) ?? []) this.slots.delete(k); this.bigOf.delete(old); if (this.tex === old) this.tex = null; gl.deleteTexture(old); }   // (the oldest big one goes — what is waiting to be drawn with it first: it is made again if it is seen again)
      s = { tex, u0: 0, v0: 0, u1: 1, v1: 1, page: null }; this.slots.set(src, s); this.bigOf.set(tex, [src]); return s;
    }
    let at = this.place(w + GUT * 2, h + GUT * 2);
    // (all pages full: the page drawn from longest ago is emptied and filled again — its texture kept, nothing made anew;
    // never one this layer is drawing from: then the glyph waits for the next frame. Emptying every page at once and
    // refilling them made a close-up zooming along a long word allocate and upload the whole atlas every frame.)
    if (!at) { const old = this.pages.filter(p => p.used !== this.frameNo).sort((a, b) => a.used - b.used)[0]; if (!old) return null;
      this.flush(); for (const k of old.srcs) this.slots.delete(k); old.srcs = []; old.shelves = []; old.top = 0; if (this.tex === old.tex) this.tex = null;
      // (emptied for real: a glyph is uploaded over its own rectangle only, and what was round it before showed through
      // its gutter as stray lines)
      const fb = (this.fbo ||= gl.createFramebuffer()!); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, old.tex, 0);
      const sc = gl.isEnabled(gl.SCISSOR_TEST); gl.disable(gl.SCISSOR_TEST); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); if (sc) gl.enable(gl.SCISSOR_TEST); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      at = this.place(w + GUT * 2, h + GUT * 2); if (!at) return null; }
    const [pg, x, y] = at; gl.bindTexture(gl.TEXTURE_2D, pg.tex); const c = viaCanvas(src); if (c === UP) gl.texSubImage2D(gl.TEXTURE_2D, 0, x + GUT, y + GUT, w, h, gl.RGBA, gl.UNSIGNED_BYTE, UP); else gl.texSubImage2D(gl.TEXTURE_2D, 0, x + GUT, y + GUT, gl.RGBA, gl.UNSIGNED_BYTE, c);
    s = { tex: pg.tex, u0: (x + GUT) / PAGE, v0: (y + GUT) / PAGE, u1: (x + GUT + w) / PAGE, v1: (y + GUT + h) / PAGE, page: pg }; this.slots.set(src, s); pg.srcs.push(src); return s;
  }
  private params() { const gl = this.gl; gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); }
  private place(w: number, h: number): [Page, number, number] | null {
    for (const pg of this.pages) {
      for (const sh of pg.shelves) if (h <= sh.h && sh.h <= h * 1.5 + 8 && sh.x + w <= PAGE) { const x = sh.x; sh.x += w; return [pg, x, sh.y]; }
      if (pg.top + h <= PAGE) { const sh = { y: pg.top, h, x: w }; pg.shelves.push(sh); pg.top += h; return [pg, 0, sh.y]; }
    }
    if (this.pages.length >= MAX_PAGES) return null;
    const gl = this.gl, tex = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, tex); this.params();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, PAGE, PAGE, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const pg: Page = { tex, shelves: [{ y: 0, h, x: w }], top: h, srcs: [], used: this.frameNo }; this.pages.push(pg); return [pg, 0, 0];
  }
  quad(src: Src, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number, m: M, alpha: number) {
    if (alpha <= 0.002 || !dw || !dh) return;
    const s = this.slot(src); if (!s) return; if (s.page) s.page.used = this.frameNo; if (this.dry) return;
    // (the quads waiting are drawn with their own texture, bound as they are drawn: an upload meanwhile binds another)
    if (this.tex !== s.tex) { this.flush(); this.tex = s.tex; }
    if ((this.n + 1) * F > this.data.length) { if (this.n >= 16384) this.flush(); else { const d = new Float32Array(this.data.length * 2); d.set(this.data); this.data = d; } }
    const W = src.width, H = src.height, du = s.u1 - s.u0, dv = s.v1 - s.v0, o = this.n * F, d = this.data;
    d[o] = m[0]; d[o + 1] = m[1]; d[o + 2] = m[2]; d[o + 3] = m[3]; d[o + 4] = m[4]; d[o + 5] = m[5]; d[o + 6] = Math.min(1, alpha); d[o + 7] = 0;
    d[o + 8] = dx; d[o + 9] = dy; d[o + 10] = dw; d[o + 11] = dh;
    d[o + 12] = s.u0 + sx / W * du; d[o + 13] = s.v0 + sy / H * dv; d[o + 14] = s.u0 + (sx + sw) / W * du; d[o + 15] = s.v0 + (sy + sh) / H * dv;
    this.n++; this.stats.quads++;
  }
  private flush() {
    if (!this.n || this.dry) { this.n = 0; return; }
    const gl = this.gl; gl.bindTexture(gl.TEXTURE_2D, this.tex); gl.bindBuffer(gl.ARRAY_BUFFER, this.buf); gl.bufferData(gl.ARRAY_BUFFER, this.data.subarray(0, this.n * F), gl.STREAM_DRAW);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.n); this.n = 0; this.stats.draws++;
  }
}
