// Pixi v8's Graphics and GraphicsContext: a list of fill / stroke / cut instructions over recorded paths,
// with v8's chaining rules (a fill right after a stroke of the same path reuses it, and the other way
// round; `cut` punches the path into the last fill or stroke). Drawn with Canvas2D Path2D.
import { Bounds, Matrix, Point, type PointData } from './math';
import { Container, type ContainerOptions, type DestroyOptions } from './container';
import { Color, type ColorSource } from './color';
import type { Texture } from './texture';

export type PathOp =
  | { t: 'M'; x: number; y: number }
  | { t: 'L'; x: number; y: number }
  | { t: 'Q'; cx: number; cy: number; x: number; y: number }
  | { t: 'C'; c1x: number; c1y: number; c2x: number; c2y: number; x: number; y: number }
  | { t: 'A'; x: number; y: number; r: number; s: number; e: number; ccw: boolean }
  | { t: 'AT'; x1: number; y1: number; x2: number; y2: number; r: number }
  | { t: 'E'; x: number; y: number; rx: number; ry: number }
  | { t: 'R'; x: number; y: number; w: number; h: number }
  | { t: 'RR'; x: number; y: number; w: number; h: number; r: number }
  | { t: 'Z' };

export class GraphicsPath {
  ops: PathOp[] = [];
  private last = new Point();
  private p2d: Path2D | null = null;
  clone() {
    const p = new GraphicsPath();
    p.ops = this.ops.slice();
    p.last.copyFrom(this.last);
    return p;
  }
  clear() {
    this.ops = [];
    this.p2d = null;
    return this;
  }
  get empty() {
    return !this.ops.some((o) => o.t !== 'M');
  }
  getLastPoint(out: Point) {
    return out.copyFrom(this.last);
  }
  private push(op: PathOp, x: number, y: number) {
    this.ops.push(op);
    this.last.set(x, y);
    this.p2d = null;
  }
  moveTo(x: number, y: number) {
    this.push({ t: 'M', x, y }, x, y);
  }
  lineTo(x: number, y: number) {
    this.push({ t: 'L', x, y }, x, y);
  }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number) {
    this.push({ t: 'Q', cx, cy, x, y }, x, y);
  }
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) {
    this.push({ t: 'C', c1x, c1y, c2x, c2y, x, y }, x, y);
  }
  arc(x: number, y: number, r: number, s: number, e: number, ccw = false) {
    this.push({ t: 'A', x, y, r, s, e, ccw }, x + Math.cos(e) * r, y + Math.sin(e) * r);
  }
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number) {
    this.push({ t: 'AT', x1, y1, x2, y2, r }, x2, y2);
  }
  ellipse(x: number, y: number, rx: number, ry: number) {
    this.push({ t: 'E', x, y, rx, ry }, x + rx, y);
  }
  rect(x: number, y: number, w: number, h: number) {
    this.push({ t: 'R', x, y, w, h }, x, y);
  }
  roundRect(x: number, y: number, w: number, h: number, r: number) {
    this.push({ t: 'RR', x, y, w, h, r }, x, y);
  }
  closePath() {
    this.ops.push({ t: 'Z' });
    this.p2d = null;
  }
  addPath(p: GraphicsPath) {
    this.ops.push(...p.ops);
    this.p2d = null;
  }
  /** The recorded path as a Path2D (cached until the path changes). */
  toPath2D(): Path2D {
    if (this.p2d) return this.p2d;
    const p = new Path2D();
    for (const o of this.ops) {
      switch (o.t) {
        case 'M':
          p.moveTo(o.x, o.y);
          break;
        case 'L':
          p.lineTo(o.x, o.y);
          break;
        case 'Q':
          p.quadraticCurveTo(o.cx, o.cy, o.x, o.y);
          break;
        case 'C':
          p.bezierCurveTo(o.c1x, o.c1y, o.c2x, o.c2y, o.x, o.y);
          break;
        case 'A':
          if (o.r > 0) p.arc(o.x, o.y, o.r, o.s, o.e, o.ccw);
          break;
        case 'AT':
          p.arcTo(o.x1, o.y1, o.x2, o.y2, Math.max(0, o.r));
          break;
        case 'E':
          p.moveTo(o.x + Math.abs(o.rx), o.y);
          p.ellipse(o.x, o.y, Math.abs(o.rx), Math.abs(o.ry), 0, 0, Math.PI * 2);
          p.closePath();
          break;
        case 'R':
          p.rect(o.x, o.y, o.w, o.h);
          break;
        case 'RR': {
          const r = Math.max(0, Math.min(o.r, Math.abs(o.w) / 2, Math.abs(o.h) / 2));
          if (typeof (p as { roundRect?: unknown }).roundRect === 'function') p.roundRect(o.x, o.y, o.w, o.h, r);
          else p.rect(o.x, o.y, o.w, o.h);
          break;
        }
        case 'Z':
          p.closePath();
          break;
      }
    }
    this.p2d = p;
    return p;
  }
  /** Adds the path's extent under `m` (curves by their hull, arcs by sampling). */
  addBounds(b: Bounds, m: Matrix | null) {
    const add = (x: number, y: number) =>
      m ? b.addPoint(m.a * x + m.c * y + m.tx, m.b * x + m.d * y + m.ty) : b.addPoint(x, y);
    for (const o of this.ops) {
      switch (o.t) {
        case 'M':
        case 'L':
          add(o.x, o.y);
          break;
        case 'Q':
          add(o.cx, o.cy);
          add(o.x, o.y);
          break;
        case 'C':
          add(o.c1x, o.c1y);
          add(o.c2x, o.c2y);
          add(o.x, o.y);
          break;
        case 'A': {
          let d = o.e - o.s;
          if (o.ccw && d > 0) d -= Math.PI * 2;
          else if (!o.ccw && d < 0) d += Math.PI * 2;
          if (Math.abs(d) > Math.PI * 2) d = Math.PI * 2 * Math.sign(d);
          const n = Math.max(2, Math.ceil(Math.abs(d) / (Math.PI / 8)));
          for (let i = 0; i <= n; i += 1) {
            const a = o.s + (d * i) / n;
            add(o.x + Math.cos(a) * o.r, o.y + Math.sin(a) * o.r);
          }
          break;
        }
        case 'AT':
          add(o.x1, o.y1);
          add(o.x2, o.y2);
          break;
        case 'E':
          for (let i = 0; i < 16; i += 1) {
            const a = (i / 16) * Math.PI * 2;
            add(o.x + Math.cos(a) * o.rx, o.y + Math.sin(a) * o.ry);
          }
          break;
        case 'R':
        case 'RR':
          add(o.x, o.y);
          add(o.x + o.w, o.y);
          add(o.x + o.w, o.y + o.h);
          add(o.x, o.y + o.h);
          break;
      }
    }
  }
}

export interface FillGradientOptions {
  type?: 'linear' | 'radial';
  start?: PointData;
  end?: PointData;
  /** radial: inner and outer circles (centre and radius) */
  center?: PointData;
  innerRadius?: number;
  outerCenter?: PointData;
  outerRadius?: number;
  colorStops?: { offset: number; color: ColorSource }[];
  textureSpace?: 'local' | 'global';
}

export class FillGradient {
  type: 'linear' | 'radial';
  start: PointData;
  end: PointData;
  center: PointData;
  innerRadius: number;
  outerCenter: PointData;
  outerRadius: number;
  colorStops: { offset: number; color: string }[] = [];
  textureSpace: 'local' | 'global';
  destroyed = false;
  constructor(options: FillGradientOptions = {}) {
    this.type = options.type ?? 'linear';
    this.start = options.start ?? { x: 0, y: 0 };
    this.end = options.end ?? { x: 0, y: 1 };
    this.center = options.center ?? { x: 0.5, y: 0.5 };
    this.innerRadius = options.innerRadius ?? 0;
    this.outerCenter = options.outerCenter ?? this.center;
    this.outerRadius = options.outerRadius ?? 0.5;
    this.textureSpace = options.textureSpace ?? 'local';
    for (const s of options.colorStops ?? []) this.addColorStop(s.offset, s.color);
  }
  addColorStop(offset: number, color: ColorSource) {
    this.colorStops.push({ offset, color: Color.shared.setValue(color).toRgbaString() });
    this.colorStops.sort((a, b) => a.offset - b.offset);
    return this;
  }
  /** A canvas gradient for a shape whose (local) bounds are `b` (local space maps 0..1 onto them). */
  toCanvas(g: CanvasRenderingContext2D, b: Bounds): CanvasGradient {
    const local = this.textureSpace === 'local';
    const X = (x: number) => (local ? b.minX + x * (b.maxX - b.minX) : x),
      Y = (y: number) => (local ? b.minY + y * (b.maxY - b.minY) : y),
      R = (r: number) => (local ? r * Math.max(b.maxX - b.minX, b.maxY - b.minY) : r);
    const grad =
      this.type === 'radial'
        ? g.createRadialGradient(
            X(this.center.x),
            Y(this.center.y),
            R(this.innerRadius),
            X(this.outerCenter.x),
            Y(this.outerCenter.y),
            R(this.outerRadius),
          )
        : g.createLinearGradient(X(this.start.x), Y(this.start.y), X(this.end.x), Y(this.end.y));
    for (const s of this.colorStops) grad.addColorStop(Math.max(0, Math.min(1, s.offset)), s.color);
    return grad;
  }
  destroy() {
    this.destroyed = true;
  }
}

export interface FillStyle {
  color: number;
  alpha: number;
  texture: Texture | null;
  matrix: Matrix | null;
  fill: FillGradient | null;
}
export interface StrokeStyle extends FillStyle {
  width: number;
  alignment: number;
  cap: CanvasLineCap;
  join: CanvasLineJoin;
  miterLimit: number;
  pixelLine: boolean;
}
export type FillInput =
  | ColorSource
  | FillGradient
  | Texture
  | (Partial<Omit<FillStyle, 'color' | 'fill'>> & { color?: ColorSource; fill?: FillGradient | ColorSource | null });
export type StrokeInput =
  | ColorSource
  | FillGradient
  | (Partial<Omit<StrokeStyle, 'color' | 'fill'>> & { color?: ColorSource; fill?: FillGradient | ColorSource | null });

const DEFAULT_FILL: FillStyle = { color: 0xffffff, alpha: 1, texture: null, matrix: null, fill: null };
const DEFAULT_STROKE: StrokeStyle = {
  ...DEFAULT_FILL,
  width: 1,
  alignment: 0.5,
  cap: 'butt',
  join: 'miter',
  miterLimit: 10,
  pixelLine: false,
};

function isTexture(v: unknown): v is Texture {
  return !!v && typeof v === 'object' && 'source' in v && 'frame' in v;
}

function toStyle<T extends FillStyle>(input: unknown, base: T): T {
  const out: T = { ...base };
  if (input === undefined || input === null) return out;
  if (input instanceof FillGradient) {
    out.fill = input;
    out.color = 0xffffff;
    return out;
  }
  if (isTexture(input)) {
    out.texture = input;
    out.color = 0xffffff;
    return out;
  }
  if (Color.isColorLike(input)) {
    const c = Color.shared.setValue(input as ColorSource);
    out.color = c.toNumber();
    out.alpha = c.alpha;
    out.fill = null;
    return out;
  }
  const o = input as Record<string, unknown>;
  Object.assign(out, o);
  out.fill = null;
  if (o.fill instanceof FillGradient) out.fill = o.fill;
  else if (o.fill !== undefined && o.fill !== null && Color.isColorLike(o.fill))
    out.color = Color.shared.setValue(o.fill as ColorSource).toNumber();
  if (o.color !== undefined) {
    const c = Color.shared.setValue(o.color as ColorSource);
    out.color = c.toNumber();
    if (o.alpha === undefined) out.alpha = c.alpha;
  }
  if (o.alpha === undefined && o.color === undefined) out.alpha = base.alpha;
  return out;
}

export type GraphicsInstruction =
  | { action: 'fill'; data: { style: FillStyle; path: GraphicsPath; hole?: GraphicsPath } }
  | { action: 'stroke'; data: { style: StrokeStyle; path: GraphicsPath; hole?: GraphicsPath } }
  | {
      action: 'texture';
      data: {
        image: Texture;
        dx: number;
        dy: number;
        dw: number;
        dh: number;
        transform: Matrix;
        alpha: number;
        style: number;
      };
    };

export class GraphicsContext {
  instructions: GraphicsInstruction[] = [];
  private active = new GraphicsPath();
  private tick = 0;
  private fillStyleValue: FillStyle = { ...DEFAULT_FILL };
  private strokeStyleValue: StrokeStyle = { ...DEFAULT_STROKE };
  private boundsCache: Bounds | null = null;
  /** Bumped on every change; renderers cache by it. */
  version = 0;
  destroyed = false;

  get fillStyle(): FillStyle {
    return this.fillStyleValue;
  }
  set fillStyle(v: FillInput) {
    this.fillStyleValue = toStyle(v, DEFAULT_FILL);
  }
  get strokeStyle(): StrokeStyle {
    return this.strokeStyleValue;
  }
  set strokeStyle(v: StrokeInput) {
    this.strokeStyleValue = toStyle(v, DEFAULT_STROKE);
  }
  setFillStyle(v: FillInput) {
    this.fillStyle = v;
    return this;
  }
  setStrokeStyle(v: StrokeInput) {
    this.strokeStyle = v;
    return this;
  }
  private changed() {
    this.version += 1;
    this.boundsCache = null;
  }
  private nextPath() {
    const p = this.active.getLastPoint(new Point());
    this.active = new GraphicsPath();
    this.active.moveTo(p.x, p.y);
  }
  fill(style?: FillInput, alpha?: number) {
    const last = this.instructions[this.instructions.length - 1];
    const path = this.tick === 0 && last?.action === 'stroke' ? last.data.path : this.active.clone();
    if (style !== undefined) this.fillStyleValue = toStyle(style, DEFAULT_FILL);
    if (alpha !== undefined) this.fillStyleValue.alpha = alpha;
    this.instructions.push({ action: 'fill', data: { style: { ...this.fillStyleValue }, path } });
    this.changed();
    this.nextPath();
    this.tick = 0;
    return this;
  }
  stroke(style?: StrokeInput) {
    const last = this.instructions[this.instructions.length - 1];
    const path = this.tick === 0 && last?.action === 'fill' ? last.data.path : this.active.clone();
    if (style !== undefined) this.strokeStyleValue = toStyle(style, DEFAULT_STROKE);
    this.instructions.push({ action: 'stroke', data: { style: { ...this.strokeStyleValue }, path } });
    this.changed();
    this.nextPath();
    this.tick = 0;
    return this;
  }
  cut() {
    for (let i = 0; i < 2; i += 1) {
      const ins = this.instructions[this.instructions.length - 1 - i];
      const hole = this.active.clone();
      if (ins && (ins.action === 'stroke' || ins.action === 'fill')) {
        if (ins.data.hole) ins.data.hole.addPath(hole);
        else {
          ins.data.hole = hole;
          break;
        }
      }
    }
    this.changed();
    this.nextPath();
    return this;
  }
  texture(texture: Texture, tint?: ColorSource, dx = 0, dy = 0, dw = texture.frame.width, dh = texture.frame.height) {
    this.instructions.push({
      action: 'texture',
      data: {
        image: texture,
        dx,
        dy,
        dw,
        dh,
        transform: new Matrix(),
        alpha: 1,
        style: tint === undefined ? 0xffffff : Color.shared.setValue(tint).toNumber(),
      },
    });
    this.changed();
    return this;
  }
  beginPath() {
    this.active = new GraphicsPath();
    return this;
  }
  private op() {
    this.tick += 1;
    return this.active;
  }
  moveTo(x: number, y: number) {
    this.op().moveTo(x, y);
    return this;
  }
  lineTo(x: number, y: number) {
    this.op().lineTo(x, y);
    return this;
  }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number) {
    this.op().quadraticCurveTo(cx, cy, x, y);
    return this;
  }
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) {
    this.op().bezierCurveTo(c1x, c1y, c2x, c2y, x, y);
    return this;
  }
  arc(x: number, y: number, r: number, start: number, end: number, ccw = false) {
    this.op().arc(x, y, r, start, end, ccw);
    return this;
  }
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number) {
    this.op().arcTo(x1, y1, x2, y2, r);
    return this;
  }
  closePath() {
    this.op().closePath();
    return this;
  }
  rect(x: number, y: number, w: number, h: number) {
    this.op().rect(x, y, w, h);
    return this;
  }
  roundRect(x: number, y: number, w: number, h: number, r = 5) {
    this.op().roundRect(x, y, w, h, r);
    return this;
  }
  circle(x: number, y: number, r: number) {
    const p = this.op();
    p.moveTo(x + r, y);
    p.arc(x, y, r, 0, Math.PI * 2);
    p.closePath();
    return this;
  }
  ellipse(x: number, y: number, rx: number, ry: number) {
    this.op().ellipse(x, y, rx, ry);
    return this;
  }
  /** A polygon from flat [x, y, …] numbers or points; closed unless `close` is false. */
  poly(points: number[] | PointData[], close = true) {
    const p = this.op();
    const flat: number[] =
      typeof points[0] === 'number' ? (points as number[]) : (points as PointData[]).flatMap((q) => [q.x, q.y]);
    if (flat.length < 2) return this;
    p.moveTo(flat[0], flat[1]);
    for (let i = 2; i + 1 < flat.length; i += 2) p.lineTo(flat[i], flat[i + 1]);
    if (close) p.closePath();
    return this;
  }
  regularPoly(x: number, y: number, radius: number, sides: number, rotation = 0) {
    const pts: number[] = [];
    const delta = (Math.PI * 2) / sides;
    const start = -Math.PI / 2 + rotation;
    for (let i = 0; i < sides; i += 1)
      pts.push(x + radius * Math.cos(start + delta * i), y + radius * Math.sin(start + delta * i));
    return this.poly(pts);
  }
  star(x: number, y: number, points: number, radius: number, innerRadius = radius / 2, rotation = 0) {
    const pts: number[] = [];
    const n = points * 2;
    const delta = (Math.PI * 2) / n;
    const start = -Math.PI / 2 + rotation;
    for (let i = 0; i < n; i += 1) {
      const r = i % 2 ? innerRadius : radius;
      pts.push(x + r * Math.cos(start + delta * i), y + r * Math.sin(start + delta * i));
    }
    return this.poly(pts);
  }
  clear() {
    this.instructions = [];
    this.active = new GraphicsPath();
    this.tick = 0;
    this.changed();
    return this;
  }
  get bounds(): Bounds {
    if (this.boundsCache) return this.boundsCache;
    const b = new Bounds();
    for (const ins of this.instructions) {
      if (ins.action === 'texture') {
        b.addFrame(ins.data.dx, ins.data.dy, ins.data.dx + ins.data.dw, ins.data.dy + ins.data.dh);
        continue;
      }
      const pb = new Bounds();
      ins.data.path.addBounds(pb, null);
      if (ins.action === 'stroke') {
        const s = ins.data.style;
        pb.pad((1 - s.alignment) * s.width);
      }
      b.addBounds(pb);
    }
    this.boundsCache = b;
    return b;
  }
  /** Adds the drawn extent under `m`. */
  addBoundsTo(out: Bounds, m: Matrix) {
    const b = this.bounds;
    if (!b.isEmpty()) out.addBounds(b, m);
  }
  unload() {}
  destroy() {
    this.destroyed = true;
    this.instructions = [];
  }
}

export interface GraphicsOptions extends ContainerOptions {
  context?: GraphicsContext;
  roundPixels?: boolean;
}

/** Path-building calls forwarded to the context, chainable on the Graphics. */
export class Graphics extends Container {
  context: GraphicsContext;
  roundPixels = false;
  constructor(options: GraphicsOptions | GraphicsContext = {}) {
    const o = options instanceof GraphicsContext ? { context: options } : options;
    super(o);
    this.context = o.context ?? new GraphicsContext();
  }
  get fillStyle() {
    return this.context.fillStyle;
  }
  set fillStyle(v: FillInput) {
    this.context.fillStyle = v;
  }
  get strokeStyle() {
    return this.context.strokeStyle;
  }
  set strokeStyle(v: StrokeInput) {
    this.context.strokeStyle = v;
  }
  setFillStyle(v: FillInput) {
    this.context.setFillStyle(v);
    return this;
  }
  setStrokeStyle(v: StrokeInput) {
    this.context.setStrokeStyle(v);
    return this;
  }
  fill(style?: FillInput, alpha?: number) {
    this.context.fill(style, alpha);
    return this;
  }
  stroke(style?: StrokeInput) {
    this.context.stroke(style);
    return this;
  }
  cut() {
    this.context.cut();
    return this;
  }
  texture(texture: Texture, tint?: ColorSource, dx?: number, dy?: number, dw?: number, dh?: number) {
    this.context.texture(texture, tint, dx, dy, dw, dh);
    return this;
  }
  beginPath() {
    this.context.beginPath();
    return this;
  }
  moveTo(x: number, y: number) {
    this.context.moveTo(x, y);
    return this;
  }
  lineTo(x: number, y: number) {
    this.context.lineTo(x, y);
    return this;
  }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number) {
    this.context.quadraticCurveTo(cx, cy, x, y);
    return this;
  }
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) {
    this.context.bezierCurveTo(c1x, c1y, c2x, c2y, x, y);
    return this;
  }
  arc(x: number, y: number, r: number, start: number, end: number, ccw?: boolean) {
    this.context.arc(x, y, r, start, end, ccw);
    return this;
  }
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number) {
    this.context.arcTo(x1, y1, x2, y2, r);
    return this;
  }
  closePath() {
    this.context.closePath();
    return this;
  }
  rect(x: number, y: number, w: number, h: number) {
    this.context.rect(x, y, w, h);
    return this;
  }
  roundRect(x: number, y: number, w: number, h: number, r?: number) {
    this.context.roundRect(x, y, w, h, r);
    return this;
  }
  circle(x: number, y: number, r: number) {
    this.context.circle(x, y, r);
    return this;
  }
  ellipse(x: number, y: number, rx: number, ry: number) {
    this.context.ellipse(x, y, rx, ry);
    return this;
  }
  poly(points: number[] | PointData[], close?: boolean) {
    this.context.poly(points, close);
    return this;
  }
  regularPoly(x: number, y: number, radius: number, sides: number, rotation?: number) {
    this.context.regularPoly(x, y, radius, sides, rotation);
    return this;
  }
  star(x: number, y: number, points: number, radius: number, innerRadius?: number, rotation?: number) {
    this.context.star(x, y, points, radius, innerRadius, rotation);
    return this;
  }
  clear() {
    this.context.clear();
    return this;
  }
  clone() {
    const g = new Graphics();
    g.context.instructions = this.context.instructions.slice();
    return g;
  }
  protected override addOwnBounds(bounds: Bounds, m: Matrix) {
    this.context.addBoundsTo(bounds, m);
  }
  override destroy(options: boolean | DestroyOptions = false) {
    this.context.destroy();
    super.destroy(options);
  }
}
