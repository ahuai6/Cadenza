// Draws a display tree onto a Canvas2D target, the way Pixi v8 composes it: transforms, alpha and
// tint multiply down the tree, blend modes inherit, masks clip their owner, and a container with
// filters is drawn to a frame of its own, run through them (Canvas2D blur, GL programs) and
// composited back. Text and tinted images are rasterised once per look and kept in a bounded cache.
import { Bounds, Matrix, Rectangle } from './math';
import { Container, type BLEND_MODES } from './container';
import { Graphics, GraphicsPath, type FillStyle, type StrokeStyle } from './graphics';
import { Sprite, Texture, TextureSource, type ImageLike } from './texture';
import { Text, CanvasTextMetrics, type TextStyle } from './text';
import { BlurFilter, type Filter } from './filters';
import { glRunner, drawMeshGl } from './gl';
import { Mesh } from './mesh';
import { cssColor } from './color';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

const COMPOSITE: Partial<Record<BLEND_MODES, GlobalCompositeOperation>> = {
  normal: 'source-over',
  'normal-npm': 'source-over',
  add: 'lighter',
  'add-npm': 'lighter',
  'linear-dodge': 'lighter',
  multiply: 'multiply',
  screen: 'screen',
  'screen-npm': 'screen',
  darken: 'darken',
  lighten: 'lighten',
  min: 'darken',
  max: 'lighten',
  erase: 'destination-out',
  'color-dodge': 'color-dodge',
  'color-burn': 'color-burn',
  'hard-light': 'hard-light',
  'soft-light': 'soft-light',
  difference: 'difference',
  exclusion: 'exclusion',
  overlay: 'overlay',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity',
};
const compositeOf = (b: BLEND_MODES): GlobalCompositeOperation => COMPOSITE[b] ?? 'source-over';

export function makeCanvas(w: number, h: number): AnyCanvas {
  const W = Math.max(1, Math.ceil(w)),
    H = Math.max(1, Math.ceil(h));
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(W, H);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  return c;
}
const ctxOf = (c: AnyCanvas) => c.getContext('2d') as Ctx2D;

/** Multiplies two 0xRRGGBB tints. */
function mulTint(a: number, b: number) {
  if (a === 0xffffff) return b;
  if (b === 0xffffff) return a;
  const ch = (s: number) => Math.round((((a >> s) & 255) * ((b >> s) & 255)) / 255);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** A bounded cache of rasterised bitmaps (text, tinted images), evicted least-recently-used by area. */
class BitmapCache {
  private map = new Map<string, { canvas: AnyCanvas; area: number }>();
  private area = 0;
  constructor(private readonly budget: number) {}
  get(key: string) {
    const hit = this.map.get(key);
    if (hit) {
      this.map.delete(key);
      this.map.set(key, hit);
    }
    return hit?.canvas;
  }
  set(key: string, canvas: AnyCanvas) {
    const area = canvas.width * canvas.height;
    this.map.set(key, { canvas, area });
    this.area += area;
    for (const [k, v] of this.map) {
      if (this.area <= this.budget || k === key) break;
      this.map.delete(k);
      this.area -= v.area;
      if (v.canvas instanceof HTMLCanvasElement) v.canvas.width = v.canvas.height = 0;
    }
  }
  clear() {
    this.map.clear();
    this.area = 0;
  }
}

/** Device pixels per local unit along the larger axis of `m`. */
const scaleOf = (m: Matrix) => Math.max(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d));
/** Rasterisation scale steps: quarter octaves, so a glyph scaling over a shot reuses a few bitmaps. */
const bucket = (s: number) => Math.min(8, Math.max(0.125, 2 ** (Math.ceil(Math.log2(Math.max(s, 1e-3)) * 4) / 4)));

let sourceIds = new WeakMap<object, number>();
let nextSourceId = 1;
const idOf = (o: object) => {
  let id = sourceIds.get(o);
  if (!id) sourceIds.set(o, (id = nextSourceId++));
  return id;
};

export interface RenderOptions {
  /** CSS px of the target's visible area (filters are clipped to it). */
  width: number;
  height: number;
  /** device px per CSS px */
  resolution: number;
  /** clear the target first (default true) */
  clear?: boolean;
  /** an extra transform from the root's space to the target's CSS px */
  transform?: Matrix;
}

interface Frame {
  ctx: Ctx2D;
  /** stage CSS px → this frame's device px */
  base: Matrix;
  res: number;
  /** the frame's own rectangle in stage CSS px (its viewport) */
  view: Rectangle;
}

export interface StageStats {
  nodes: number;
  draws: number;
  filters: number;
  rasters: number;
}

export class StageRenderer {
  resolution = 1;
  private texts = new BitmapCache(48 * 1024 * 1024);
  private tints = new BitmapCache(16 * 1024 * 1024);
  private pool: AnyCanvas[] = [];
  readonly stats: StageStats = { nodes: 0, draws: 0, filters: 0, rasters: 0 };
  private tmpLocal = new Matrix();
  /** matrices for one render, reused from frame to frame (the per-frame path allocates none once warm) */
  private mats: Matrix[] = [];
  private matN = 0;
  private mat() {
    if (this.matN === this.mats.length) this.mats.push(new Matrix());
    return this.mats[this.matN++];
  }

  /** Renders `root` into `ctx`. The root's own transform applies (Pixi's stage is usually identity). */
  render(root: Container, ctx: Ctx2D, o: RenderOptions) {
    this.resolution = o.resolution;
    const s = this.stats;
    s.nodes = s.draws = s.filters = s.rasters = 0;
    this.matN = 0;
    const base = new Matrix(o.resolution, 0, 0, o.resolution, 0, 0);
    if (o.transform) Matrix.multiply(base, o.transform, base);
    if (o.clear !== false) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }
    const frame: Frame = { ctx, base, res: o.resolution, view: new Rectangle(0, 0, o.width, o.height) };
    ctx.save();
    this.node(root, frame, new Matrix(), 1, 'normal', 0xffffff, root.parent ? root.parent.worldTransform : null);
    ctx.restore();
  }

  /** Pixi's `renderer.generateTexture`: the tree drawn into a texture of its own. */
  generateTexture(options: { target: Container; frame?: Rectangle; resolution?: number } | Container): Texture {
    const o = options instanceof Container ? { target: options } : options;
    const res = o.resolution ?? this.resolution;
    const b = o.frame ?? o.target.getLocalBounds().rectangle;
    const c = makeCanvas(b.width * res, b.height * res);
    const g = ctxOf(c);
    const frame: Frame = {
      ctx: g,
      base: new Matrix(res, 0, 0, res, -b.x * res, -b.y * res),
      res,
      view: new Rectangle(b.x, b.y, b.width, b.height),
    };
    // the target's own transform is left out: its content is drawn in its own space
    this.content(o.target, frame, new Matrix(), 1, 'normal', 0xffffff);
    return new Texture({ source: new TextureSource(c as unknown as ImageLike, res) });
  }

  clearCaches() {
    this.texts.clear();
    this.tints.clear();
  }

  private canvas(w: number, h: number): AnyCanvas {
    const c = this.pool.pop() ?? makeCanvas(w, h);
    const W = Math.max(1, Math.ceil(w)),
      H = Math.max(1, Math.ceil(h));
    if (c.width !== W || c.height !== H) {
      c.width = W;
      c.height = H;
    } else {
      const g = ctxOf(c);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, W, H);
    }
    return c;
  }
  private release(c: AnyCanvas) {
    if (this.pool.length < 8) this.pool.push(c);
  }

  /**
   * One node: `parentWorld` is the parent's stage transform (null: the root of the tree, whose parent
   * is the stage itself), `alpha`, `blend` and `tint` what it inherits.
   */
  private node(
    n: Container,
    f: Frame,
    parentWorld: Matrix,
    alpha: number,
    blend: BLEND_MODES,
    tint: number,
    rootParent?: Matrix | null,
  ) {
    if (!n.visible || !n.renderable || n.maskOwner || n.destroyed) return;
    const a = alpha * n.alpha;
    if (a <= 0.0005) return;
    const world = Matrix.multiply(rootParent ?? parentWorld, n.updateLocalTransform(this.tmpLocal), this.mat());
    const b = n.blendMode === 'inherit' ? blend : n.blendMode;
    const t = mulTint(tint, n.tint);
    this.stats.nodes += 1;
    const filters = n.filters?.filter((x) => x.enabled);
    if (filters?.length) {
      this.filtered(n, f, world, a, b, t, filters);
      return;
    }
    if (n.mask) {
      this.masked(n, f, world, a, b, t);
      return;
    }
    this.content(n, f, world, a, b, t);
  }

  /** The node's own drawing and its children, without its filters or mask. */
  private content(n: Container, f: Frame, world: Matrix, a: number, b: BLEND_MODES, t: number) {
    if (n instanceof Graphics) this.graphics(n, f, world, a, b, t);
    else if (n instanceof Text) this.text(n, f, world, a, b, t);
    else if (n instanceof Sprite) this.sprite(n, f, world, a, b, t);
    else if (n instanceof Mesh) this.mesh(n, f, world, a, b);
    else {
      const draw = (n as { drawCustom?: (g: Ctx2D, m: Matrix, alpha: number) => void }).drawCustom;
      if (draw) {
        const m = Matrix.multiply(f.base, world, this.mat());
        f.ctx.globalCompositeOperation = compositeOf(b);
        draw.call(n, f.ctx, m, a);
      }
    }
    const kids = n.sortableChildren ? [...n.children].sort((x, y) => x.zIndex - y.zIndex) : n.children;
    for (const c of kids) this.node(c, f, world, a, b, t);
  }

  private setTransform(f: Frame, world: Matrix) {
    const m = Matrix.multiply(f.base, world, this.mat());
    f.ctx.setTransform(m.a, m.b, m.c, m.d, m.tx, m.ty);
    return m;
  }

  private paint(g: Ctx2D, style: FillStyle, tint: number, path: GraphicsPath) {
    if (style.fill) {
      const b = new Bounds();
      path.addBounds(b, null);
      return style.fill.toCanvas(g as CanvasRenderingContext2D, b);
    }
    if (style.texture?.source.resource) {
      const p = g.createPattern(style.texture.source.resource as CanvasImageSource, 'repeat');
      if (p) return p;
    }
    return cssColor(mulTint(style.color, tint), 1);
  }

  private graphics(n: Graphics, f: Frame, world: Matrix, a: number, b: BLEND_MODES, t: number) {
    const ins = n.context.instructions;
    if (!ins.length) return;
    const g = f.ctx;
    const m = this.setTransform(f, world);
    g.globalCompositeOperation = compositeOf(b);
    for (const i of ins) {
      if (i.action === 'texture') {
        const d = i.data;
        const src = d.image.source.resource;
        if (!src) continue;
        g.globalAlpha = a * d.alpha;
        const img = d.style !== 0xffffff ? this.tinted(d.image, d.style) : (src as CanvasImageSource);
        g.drawImage(img, d.dx, d.dy, d.dw, d.dh);
        this.stats.draws += 1;
        continue;
      }
      const style = i.data.style;
      if (style.alpha <= 0) continue;
      g.globalAlpha = a * style.alpha;
      let path = i.data.path.toPath2D();
      let rule: CanvasFillRule = 'nonzero';
      if (i.data.hole) {
        const p = new Path2D();
        p.addPath(path);
        p.addPath(i.data.hole.toPath2D());
        path = p;
        rule = 'evenodd';
      }
      if (i.action === 'fill') {
        g.fillStyle = this.paint(g, style, t, i.data.path);
        g.fill(path, rule);
      } else {
        const s = style as StrokeStyle;
        if (s.width <= 0) continue;
        g.strokeStyle = this.paint(g, s, t, i.data.path);
        g.lineWidth = s.pixelLine ? f.res / Math.max(1e-6, scaleOf(m)) : s.width;
        g.lineCap = s.cap;
        g.lineJoin = s.join;
        g.miterLimit = s.miterLimit;
        g.stroke(path);
      }
      this.stats.draws += 1;
    }
  }

  /** A tinted copy of a texture's frame (Pixi multiplies the premultiplied colour by the tint). */
  private tinted(tex: Texture, tint: number): CanvasImageSource {
    const src = tex.source.resource as CanvasImageSource;
    const key = `${idOf(tex.source)}.${tex.source.version}.${tint}.${tex.frame.x},${tex.frame.y},${tex.frame.width},${tex.frame.height}`;
    const hit = this.tints.get(key);
    if (hit) return hit;
    const r = tex.source.resolution;
    const c = makeCanvas(tex.frame.width * r, tex.frame.height * r);
    const g = ctxOf(c);
    g.drawImage(src, tex.frame.x * r, tex.frame.y * r, c.width, c.height, 0, 0, c.width, c.height);
    tintInPlace(g, c, tint);
    this.tints.set(key, c);
    return c;
  }

  private sprite(n: Sprite, f: Frame, world: Matrix, a: number, b: BLEND_MODES, t: number) {
    const tex = n.texture;
    const src = tex.source.resource;
    if (!src || tex === Texture.EMPTY) return;
    const g = f.ctx;
    this.setTransform(f, world);
    g.globalAlpha = a;
    g.globalCompositeOperation = compositeOf(b);
    const { width: w, height: h } = tex.frame;
    const x0 = -n.anchor.x * w,
      y0 = -n.anchor.y * h;
    if (t !== 0xffffff) g.drawImage(this.tinted(tex, t), x0, y0, w, h);
    else {
      const r = tex.source.resolution;
      g.drawImage(src as CanvasImageSource, tex.frame.x * r, tex.frame.y * r, w * r, h * r, x0, y0, w, h);
    }
    this.stats.draws += 1;
  }

  private text(n: Text, f: Frame, world: Matrix, a: number, b: BLEND_MODES, t: number) {
    if (!n.text) return;
    const g = f.ctx;
    const m = Matrix.multiply(f.base, world, this.mat());
    const res = bucket(scaleOf(m));
    const style = n.style;
    const key = `${n.text}\u0000${textKey(style)}\u0000${res}\u0000${t}`;
    let c = this.texts.get(key);
    const measured = n.measured;
    const pad = style.padding;
    if (!c) {
      c = rasterText(n.text, style, res, measured);
      if (t !== 0xffffff) tintInPlace(ctxOf(c), c, t);
      this.texts.set(key, c);
      this.stats.rasters += 1;
    }
    g.setTransform(m.a, m.b, m.c, m.d, m.tx, m.ty);
    g.globalAlpha = a;
    g.globalCompositeOperation = compositeOf(b);
    const x0 = -n.anchor.x * measured.width - pad,
      y0 = -n.anchor.y * measured.height - pad;
    g.drawImage(c as CanvasImageSource, x0, y0, c.width / res, c.height / res);
    this.stats.draws += 1;
  }

  /** A mesh with a program of its own (Folia's full-screen shader quads): drawn on the GL canvas, then over the target. */
  private mesh(n: Mesh, f: Frame, world: Matrix, a: number, b: BLEND_MODES) {
    const prog = n.shader?.glProgram;
    if (!prog) return;
    const runner = glRunner();
    if (!runner.ok) return;
    const W = f.ctx.canvas.width,
      H = f.ctx.canvas.height;
    const m = Matrix.multiply(f.base, world, this.mat());
    const out = drawMeshGl(runner, W, H, {
      glProgram: prog,
      resources: n.shader!.resources,
      positions: n.geometry.positions,
      uvs: n.geometry.uvs,
      indices: n.geometry.indices,
      matrix: [m.a, m.b, m.c, m.d, m.tx, m.ty],
      alpha: a,
    });
    if (!out) return;
    const g = f.ctx;
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = compositeOf(b);
    g.drawImage(out as CanvasImageSource, 0, 0);
    g.restore();
    this.stats.draws += 1;
  }

  /** The node's area on the stage (CSS px) for its filters: `filterArea` or its padded bounds, in view. */
  private filterFrame(n: Container, f: Frame, world: Matrix, filters: Filter[]): Rectangle | null {
    const bounds = new Bounds();
    if (n.filterArea) bounds.addRect(n.filterArea, world);
    else {
      const save = n.filters;
      // own bounds without the filters' padding, then padded once by the whole chain
      n.filters = null;
      n.collectBounds(bounds, world);
      n.filters = save;
      bounds.pad(filters.reduce((s, x) => s + x.padding, 0));
    }
    if (bounds.isEmpty()) return null;
    const clip = filters.every((x) => x.clipToViewport);
    let x0 = bounds.minX,
      y0 = bounds.minY,
      x1 = bounds.maxX,
      y1 = bounds.maxY;
    if (clip) {
      x0 = Math.max(x0, f.view.x);
      y0 = Math.max(y0, f.view.y);
      x1 = Math.min(x1, f.view.right);
      y1 = Math.min(y1, f.view.bottom);
    }
    if (x1 - x0 < 0.5 || y1 - y0 < 0.5) return null;
    // whole device pixels, so the frame's texels line up with the target's
    return new Rectangle(
      Math.floor(x0),
      Math.floor(y0),
      Math.ceil(x1) - Math.floor(x0),
      Math.ceil(y1) - Math.floor(y0),
    );
  }

  private filtered(n: Container, f: Frame, world: Matrix, a: number, b: BLEND_MODES, t: number, filters: Filter[]) {
    this.stats.filters += 1;
    const area = this.filterFrame(n, f, world, filters);
    if (!area) return;
    // Pixi runs a container's chain at the lowest resolution any of its filters asks for.
    let res = f.res;
    for (const x of filters) if (x.resolution !== 'inherit') res = Math.min(res, x.resolution);
    res = Math.max(0.05, res);
    // never larger than the target can show
    const MAX = 4096;
    res = Math.min(res, MAX / Math.max(area.width, area.height));
    let cur = this.canvas(area.width * res, area.height * res);
    const inner: Frame = {
      ctx: ctxOf(cur),
      base: new Matrix(res, 0, 0, res, -area.x * res, -area.y * res),
      res,
      view: area,
    };
    inner.ctx.save();
    if (n.mask) this.masked(n, inner, world, 1, 'normal', t);
    else this.content(n, inner, world, 1, 'normal', t);
    inner.ctx.restore();
    let i = 0;
    while (i < filters.length) {
      const x = filters[i];
      if (x.kind === 'blur') {
        const bl = x as BlurFilter;
        const sigma = bl.sigma(Math.max(Math.abs(bl.strengthX), Math.abs(bl.strengthY))) * res;
        if (sigma > 0.05) {
          const next = this.canvas(cur.width, cur.height);
          const g = ctxOf(next);
          g.filter = `blur(${sigma.toFixed(2)}px)`;
          g.drawImage(cur as CanvasImageSource, 0, 0);
          g.filter = 'none';
          this.release(cur);
          cur = next;
        }
        i += 1;
        continue;
      }
      // a run of GL filters in one go
      let j = i;
      while (j < filters.length && filters[j].kind === 'gl') j += 1;
      const run = filters.slice(i, j);
      i = j;
      const runner = glRunner();
      if (!runner.ok) continue;
      let back: AnyCanvas | null = null;
      if (run.some((x) => x.blendRequired)) {
        back = this.canvas(cur.width, cur.height);
        // what is already drawn under the frame, in the target's pixels
        const p0 = f.base.apply({ x: area.x, y: area.y }),
          p1 = f.base.apply({ x: area.right, y: area.bottom });
        ctxOf(back).drawImage(
          f.ctx.canvas as CanvasImageSource,
          p0.x,
          p0.y,
          Math.max(1, p1.x - p0.x),
          Math.max(1, p1.y - p0.y),
          0,
          0,
          back.width,
          back.height,
        );
      }
      const out = runner.run(cur, area.width, area.height, res, run, { x: area.x, y: area.y }, back);
      if (back) this.release(back);
      if (out) {
        const next = this.canvas(cur.width, cur.height);
        ctxOf(next).drawImage(out as CanvasImageSource, 0, 0);
        this.release(cur);
        cur = next;
      }
    }
    const g = f.ctx;
    const m = f.base;
    g.setTransform(m.a, m.b, m.c, m.d, m.tx, m.ty);
    g.globalAlpha = a;
    const last = filters[filters.length - 1];
    g.globalCompositeOperation = compositeOf(last.blendMode !== 'normal' ? last.blendMode : b);
    g.drawImage(cur as CanvasImageSource, area.x, area.y, area.width, area.height);
    this.stats.draws += 1;
    this.release(cur);
  }

  /** The mask's stage transform: through its own parents when it is in a tree, else beside its owner. */
  private maskWorld(mask: Container, owner: Container, ownerWorld: Matrix) {
    if (mask.parent) return mask.worldTransform;
    const parentWorld = owner.parent ? owner.parent.worldTransform : new Matrix();
    void ownerWorld;
    return Matrix.multiply(parentWorld, mask.localTransform, new Matrix());
  }

  private masked(n: Container, f: Frame, world: Matrix, a: number, b: BLEND_MODES, t: number) {
    const mask = n.mask!;
    const mw = this.maskWorld(mask, n, world);
    const g = f.ctx;
    // A graphics of fills alone clips directly; anything else is drawn as an alpha mask.
    if (
      mask instanceof Graphics &&
      mask.children.length === 0 &&
      mask.context.instructions.every((i) => i.action === 'fill')
    ) {
      g.save();
      this.setTransform(f, mw);
      const p = new Path2D();
      for (const i of mask.context.instructions) if (i.action === 'fill') p.addPath(i.data.path.toPath2D());
      g.clip(p);
      this.content(n, f, world, a, b, t);
      g.restore();
      return;
    }
    const W = g.canvas.width,
      H = g.canvas.height;
    const layer = this.canvas(W, H);
    const lf: Frame = { ctx: ctxOf(layer), base: f.base, res: f.res, view: f.view };
    this.content(n, lf, world, 1, 'normal', t);
    const mc = this.canvas(W, H);
    const mf: Frame = { ctx: ctxOf(mc), base: f.base, res: f.res, view: f.view };
    const vis = mask.visible;
    const owner = mask.maskOwner;
    mask.visible = true;
    mask.maskOwner = null;
    this.content(mask, mf, mw, 1, 'normal', 0xffffff);
    mask.visible = vis;
    mask.maskOwner = owner;
    const lg = ctxOf(layer);
    lg.setTransform(1, 0, 0, 1, 0, 0);
    lg.globalAlpha = 1;
    lg.globalCompositeOperation = 'destination-in';
    lg.drawImage(mc as CanvasImageSource, 0, 0);
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = a;
    g.globalCompositeOperation = compositeOf(b);
    g.drawImage(layer as CanvasImageSource, 0, 0);
    g.restore();
    this.release(mc);
    this.release(layer);
  }
}

function textKey(s: TextStyle) {
  const fill = s.fill;
  const fillKey =
    fill && typeof fill === 'object' && !Array.isArray(fill) && !(fill instanceof Float32Array) && 'colorStops' in fill
      ? `g${idOf(fill)}`
      : JSON.stringify(fill);
  return [
    s.font,
    fillKey,
    JSON.stringify(s.stroke),
    JSON.stringify(s.dropShadow),
    s.letterSpacing,
    s.lineHeight,
    s.leading,
    s.padding,
    s.align,
    s.wordWrap ? s.wordWrapWidth : 0,
  ].join('|');
}

function fillOf(g: Ctx2D, fill: TextStyle['fill'], w: number, h: number): string | CanvasGradient | null {
  if (fill === null || fill === undefined || fill === 'transparent') return null;
  if (typeof fill === 'object' && 'colorStops' in fill) {
    const b = new Bounds(0, 0, w, h);
    return (fill as import('./graphics').FillGradient).toCanvas(g as CanvasRenderingContext2D, b);
  }
  if (typeof fill === 'object' && !Array.isArray(fill) && !(fill instanceof Float32Array) && 'alpha' in fill) {
    const o = fill as { color?: import('./color').ColorSource; alpha?: number };
    return cssColor(o.color ?? 0xffffff, o.alpha ?? 1);
  }
  return cssColor(fill as import('./color').ColorSource, 1);
}

/** Pixi's CanvasTextGenerator: padding around, a shadow pass under the fill, lines placed by its metrics. */
function rasterText(text: string, style: TextStyle, res: number, m: ReturnType<typeof CanvasTextMetrics.measureText>) {
  const pad = style.padding;
  const c = makeCanvas((m.width + pad * 2) * res, (m.height + pad * 2) * res);
  const g = ctxOf(c);
  g.font = style.font;
  g.textBaseline = 'alphabetic';
  g.lineJoin = style.stroke?.join ?? 'miter';
  g.miterLimit = 10;
  try {
    (g as CanvasRenderingContext2D).letterSpacing = `${style.letterSpacing}px`;
  } catch {
    /* older canvases: no letter spacing */
  }
  const sw = style.strokeWidth;
  const fp = m.fontProperties;
  const shift = (m.lineHeight - style.leading - fp.fontSize) / 2;
  const fill = fillOf(g, style.fill, m.width, m.height);
  const stroke = style.stroke && sw > 0 ? cssColor(style.stroke.color ?? 0, style.stroke.alpha ?? 1) : null;
  const lineX = (i: number) => {
    let x = sw / 2;
    if (style.align === 'right') x += m.maxLineWidth - m.lineWidths[i];
    else if (style.align === 'center') x += (m.maxLineWidth - m.lineWidths[i]) / 2;
    return x;
  };
  const lineY = (i: number) => sw / 2 + i * m.lineHeight + fp.ascent + shift;
  const passes = style.dropShadow ? 2 : 1;
  for (let pass = 0; pass < passes; pass += 1) {
    const shadow = style.dropShadow && pass === 0 ? style.dropShadow : null;
    // The shadow pass draws its text far off the canvas and lets the offset bring only the shadow back.
    const away = shadow ? (m.height + pad * 2) * 2 + 64 : 0;
    g.setTransform(res, 0, 0, res, pad * res, pad * res);
    if (shadow) {
      g.shadowColor = cssColor(shadow.color, shadow.alpha);
      g.shadowBlur = shadow.blur * res;
      g.shadowOffsetX = Math.cos(shadow.angle) * shadow.distance * res;
      g.shadowOffsetY = (Math.sin(shadow.angle) * shadow.distance + away) * res;
    } else {
      g.shadowColor = 'rgba(0,0,0,0)';
      g.shadowBlur = 0;
      g.shadowOffsetX = g.shadowOffsetY = 0;
    }
    for (let i = 0; i < m.lines.length; i += 1) {
      const x = lineX(i),
        y = lineY(i) - away;
      if (stroke) {
        g.strokeStyle = shadow ? 'black' : stroke;
        g.lineWidth = sw;
        g.strokeText(m.lines[i], x, y);
      }
      if (fill || shadow) {
        g.fillStyle = shadow ? 'black' : (fill ?? 'rgba(0,0,0,0)');
        if (fill || shadow) g.fillText(m.lines[i], x, y);
      }
    }
  }
  return c;
}

/** Multiplies a bitmap's colour by `tint`, keeping its alpha (exactly, once per cached raster). */
function tintInPlace(g: Ctx2D, c: AnyCanvas, tint: number) {
  const r = ((tint >> 16) & 255) / 255,
    gr = ((tint >> 8) & 255) / 255,
    b = (tint & 255) / 255;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    d[i] *= r;
    d[i + 1] *= gr;
    d[i + 2] *= b;
  }
  g.putImageData(img, 0, 0);
  g.restore();
}
